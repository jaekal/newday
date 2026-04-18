// src/services/staff/staffImportService.js
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { Op } from 'sequelize';

import {
  User,
  StaffProfile,
  SkuExposure,
  RosterEntry,
} from '../../models/index.js';

import {
  normalizeRowKeys,
  normalizeStr,
  normalizeEmail,
  normalizeUsername,
  makeGetVal,
  safeNull,
  toUpper,
  genFallbackEmail,
  genFallbackUsername,
  normalizeDomainUsername,
} from './staffShared.js';

import {
  buildRosterMap,
  scopeStaffByRosterBuildingShift,
  computeTenureLabel,
  getEffectiveRosterBuildingShift,
  computeProfileHealth,
  computeFilterOptionsFromStaff,
  buildPaginationForStaff,
  defaultFilters,
} from './staffAccessService.js';

function parseUploadRows(file) {
  if (!file) {
    return { error: 'No file uploaded.', rows: null };
  }

  const originalName = file.originalname.toLowerCase();
  const isExcel = originalName.endsWith('.xlsx') || originalName.endsWith('.xls');
  const isCsv = originalName.endsWith('.csv');

  if (!isExcel && !isCsv) {
    return {
      error: 'Unsupported file type. Please upload CSV or Excel (.xlsx).',
      rows: null,
    };
  }

  try {
    if (isExcel) {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      return {
        error: null,
        rows: XLSX.utils.sheet_to_json(sheet, { defval: '' }),
      };
    }

    const text = file.buffer.toString('utf8');
    return {
      error: null,
      rows: parse(text, { columns: true, skip_empty_lines: true, trim: true }),
    };
  } catch (err) {
    console.error('IMPORT PARSE ERROR:', err);
    return {
      error: 'Failed to parse file. Check format and headers.',
      rows: null,
    };
  }
}

async function buildStaffListRenderModel({ viewer, skuImportSummary = null, skuImportError = null }) {
  const role = viewer.role || 'STAFF';

  const allStaff = await User.findAll({
    where: { role: { [Op.in]: ['STAFF', 'LEAD', 'SUPERVISOR'] } },
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
    order: [['name', 'ASC']],
  });

  const rosterRows = await RosterEntry.findAll();
  const rosterMap = buildRosterMap(rosterRows);

  const scoped = scopeStaffByRosterBuildingShift(allStaff, viewer, rosterMap);

  scoped.forEach((s) => {
    const p = s.StaffProfile;
    s.tenureLabel = p?.startDate ? computeTenureLabel(p.startDate) : null;

    const eff = getEffectiveRosterBuildingShift(s, rosterMap);
    s.rosterBuilding = eff.rosterBuilding || '';
    s.rosterShift = eff.rosterShift || '';
    s.profileHealth = computeProfileHealth(s);
  });

  const {
    rosterBuildingOptions,
    rosterShiftOptions,
    positionTypeOptions,
  } = computeFilterOptionsFromStaff(scoped, rosterMap);

  return {
    staff: scoped,
    skuImportSummary,
    skuImportError,
    searchQuery: '',
    currentUserRole: role,
    viewerRole: role,
    filters: defaultFilters(),
    pagination: buildPaginationForStaff(scoped),
    buildingOptions: rosterBuildingOptions,
    shiftOptions: rosterShiftOptions,
    positionTypeOptions,
  };
}

export async function importSkuExposureFile({ file, viewer }) {
  const parsed = parseUploadRows(file);
  if (parsed.error) {
    return {
      statusCode: 400,
      viewModel: await buildStaffListRenderModel({
        viewer,
        skuImportSummary: null,
        skuImportError: parsed.error,
      }),
    };
  }

  let created = 0;
  let updated = 0;
  let errors = 0;
  const errorDetails = [];

  for (const raw of parsed.rows) {
    const row = normalizeRowKeys(raw);

    const staffUsername = normalizeUsername(row.staffUsername || '');
    const staffEmail = normalizeEmail(row.staffEmail || '');
    const employeeId = normalizeStr(row.employeeId || '');
    const sku = normalizeStr(row.sku || '');
    const timesWorkedRaw = row.timesWorked;
    const lastWorkedAt = row.lastWorkedAt || null;

    if (!sku || (!staffUsername && !staffEmail && !employeeId)) {
      errors++;
      errorDetails.push(`Missing sku or staff identifier for row (sku=${sku || 'N/A'})`);
      continue;
    }

    try {
      let staffUser = null;

      if (staffUsername) {
        staffUser = await User.findOne({ where: { username: staffUsername } });
      } else if (staffEmail) {
        staffUser = await User.findOne({ where: { email: staffEmail } });
      } else if (employeeId) {
        const prof = await StaffProfile.findOne({
          where: { employeeId },
          include: [{ model: User, as: 'User' }],
        });
        staffUser = prof ? prof.User : null;
      }

      if (!staffUser) {
        errors++;
        errorDetails.push(
          `Staff not found for sku="${sku}" (username=${staffUsername}, email=${staffEmail}, employeeId=${employeeId})`
        );
        continue;
      }

      const timesWorked =
        timesWorkedRaw !== undefined && timesWorkedRaw !== '' ? Number(timesWorkedRaw) : 1;

      const existing = await SkuExposure.findOne({
        where: { staffId: staffUser.id, sku },
      });

      if (existing) {
        existing.timesWorked = Number.isNaN(timesWorked) ? existing.timesWorked : timesWorked;
        if (lastWorkedAt) existing.lastWorkedAt = lastWorkedAt;
        await existing.save();
        updated++;
      } else {
        await SkuExposure.create({
          staffId: staffUser.id,
          sku,
          timesWorked: Number.isNaN(timesWorked) ? 1 : timesWorked,
          lastWorkedAt,
        });
        created++;
      }
    } catch (err) {
      console.error('SKU IMPORT → row error:', err);
      errors++;
      errorDetails.push(`Error importing sku="${sku}" for staffUsername=${staffUsername}: ${err.message}`);
    }
  }

  const summaryLines = [
    `SKU IMPORT → Created: ${created}`,
    `SKU IMPORT → Updated: ${updated}`,
    `SKU IMPORT → Errors: ${errors}`,
  ];

  if (errorDetails.length > 0) {
    summaryLines.push('Some errors:');
    errorDetails.slice(0, 5).forEach((line) => summaryLines.push(`- ${line}`));
    if (errorDetails.length > 5) summaryLines.push(`...and ${errorDetails.length - 5} more`);
  }

  return {
    statusCode: 200,
    viewModel: await buildStaffListRenderModel({
      viewer,
      skuImportSummary: summaryLines.join('\n'),
      skuImportError: null,
    }),
  };
}

export async function importStaffFile({ file, viewer }) {
  const role = viewer.role || 'STAFF';
  const parsed = parseUploadRows(file);

  if (parsed.error) {
    return {
      statusCode: 400,
      view: 'staff/import',
      viewModel: {
        currentUserRole: role,
        viewerRole: role,
        errorMessage: parsed.error,
        summaryMessage: null,
      },
    };
  }

  let createdUsers = 0;
  let updatedUsers = 0;
  let createdProfiles = 0;
  let updatedProfiles = 0;
  let rosterUpserts = 0;
  let errors = 0;
  const errorDetails = [];

  for (const raw of parsed.rows) {
    const row = normalizeRowKeys(raw);
    const getVal = makeGetVal(row);

    const name = getVal('name', 'Name');
    const usernameRaw = getVal('username', 'Username');
    const emailRaw = getVal('email', 'Email');
    const roleStr = getVal('role', 'Role');
    const phone = getVal('phone', 'Phone');
    const avatarPath = getVal('avatarPath', 'AvatarPath', 'avatar');

    const employeeId = getVal('employeeId', 'EmployeeId', 'Employee ID');
    const positionType = getVal('positionType', 'PositionType', 'Position Type');
    const startDate = getVal('startDate', 'StartDate', 'Start Date');
    const dateOfBirth = getVal('dateOfBirth', 'DateOfBirth', 'Date Of Birth');

    const carMake = getVal('carMake', 'CarMake', 'Car Make');
    const carModel = getVal('carModel', 'CarModel', 'Car Model');
    const licensePlate = getVal('licensePlate', 'LicensePlate', 'License Plate');

    const domainName = getVal('domainName', 'DomainName', 'Domain Name');
    const domainUsername = getVal('domainUsername', 'DomainUsername', 'Domain Username');

    const highestEducationLevel = getVal(
      'highestEducationLevel',
      'HighestEducationLevel',
      'Highest Education Level'
    );
    const schoolName = getVal('schoolName', 'SchoolName', 'School Name');
    const degreeName = getVal('degreeName', 'DegreeName', 'Degree Name');
    const fieldOfStudy = getVal('fieldOfStudy', 'FieldOfStudy', 'Field Of Study');
    const graduationYear = getVal('graduationYear', 'GraduationYear', 'Graduation Year');
    const certificationsText = getVal('certificationsText', 'CertificationsText', 'Certifications Text');

    const rosterBuilding = getVal('rosterBuilding', 'RosterBuilding');
    const rosterShift = getVal('rosterShift', 'RosterShift');
    const password = getVal('password', 'Password');

    if (!name || !employeeId || !roleStr || !positionType) {
      errors++;
      errorDetails.push(
        `Missing required fields (need name, employeeId, role, positionType). Row name="${name}", employeeId="${employeeId}".`
      );
      continue;
    }

    try {
      let user = null;

      const normUsername = normalizeUsername(usernameRaw);
      const normEmail = normalizeEmail(emailRaw);

      const profileByEmp = await StaffProfile.findOne({
        where: { employeeId },
        include: [{ model: User, as: 'User' }],
      });
      if (profileByEmp?.User) user = profileByEmp.User;

      if (!user && normEmail) user = await User.findOne({ where: { email: normEmail } });
      if (!user && normUsername) user = await User.findOne({ where: { username: normUsername } });

      const roleUpper = toUpper(roleStr);
      const finalUsername = (normUsername || genFallbackUsername({ employeeId, name })).toLowerCase();
      const finalEmail = (normEmail || genFallbackEmail({ employeeId, username: finalUsername })).toLowerCase();

      if (!user) {
        const payload = {
          name,
          username: finalUsername,
          email: finalEmail,
          role: roleUpper,
          phone: safeNull(phone),
          avatarPath: safeNull(avatarPath),
        };

        if (password) {
          payload.passwordHash = await bcrypt.hash(password, 10);
        }

        user = await User.create(payload);
        createdUsers++;
      } else {
        const payload = {
          name,
          role: roleUpper,
        };

        if (normUsername) payload.username = normUsername;
        if (normEmail) payload.email = normEmail;
        if (phone !== undefined) payload.phone = safeNull(phone);
        if (avatarPath !== undefined) payload.avatarPath = safeNull(avatarPath);
        if (password) payload.passwordHash = await bcrypt.hash(password, 10);

        await user.update(payload);
        updatedUsers++;
      }

      let profile = await StaffProfile.findOne({ where: { userId: user.id } });

      const normalizedDU = normalizeDomainUsername(domainUsername || user.username || '');
      const rb = safeNull(rosterBuilding);
      const rs = safeNull(rosterShift);

      const profilePayload = {
        domainName: safeNull(domainName),
        domainUsername: normalizedDU ? normalizedDU : safeNull(domainUsername),
        employeeId: safeNull(employeeId),
        positionType: toUpper(positionType),
        startDate: safeNull(startDate),
        dateOfBirth: safeNull(dateOfBirth),
        carMake: safeNull(carMake),
        carModel: safeNull(carModel),
        licensePlate: safeNull(licensePlate),
        highestEducationLevel: safeNull(highestEducationLevel),
        schoolName: safeNull(schoolName),
        degreeName: safeNull(degreeName),
        fieldOfStudy: safeNull(fieldOfStudy),
        graduationYear: safeNull(graduationYear),
        certificationsText: safeNull(certificationsText),
        building: rb,
        shift: rs,
      };

      if (!profile) {
        await StaffProfile.create({ userId: user.id, ...profilePayload });
        createdProfiles++;
      } else {
        await profile.update(profilePayload);
        updatedProfiles++;
      }

      const rosterKey = normalizeDomainUsername(
        normalizedDU || profilePayload.domainUsername || user.username || ''
      );

      if (rosterKey && (rb || rs || employeeId)) {
        const existingRoster = await RosterEntry.findOne({ where: { domainUsername: rosterKey } });

        if (!existingRoster) {
          await RosterEntry.create({
            domainUsername: rosterKey,
            employeeId: safeNull(employeeId),
            building: rb,
            shift: rs,
          });
        } else {
          const patch = {};
          const emp = safeNull(employeeId);
          if (emp) patch.employeeId = emp;
          if (rb) patch.building = rb;
          if (rs) patch.shift = rs;

          if (Object.keys(patch).length) {
            await existingRoster.update(patch);
          }
        }

        rosterUpserts++;
      }
    } catch (err) {
      console.error('STAFF IMPORT → row error:', err);
      errors++;
      errorDetails.push(`Error importing row for employeeId="${employeeId}": ${err.message}`);
    }
  }

  return {
    statusCode: 200,
    view: 'staff/import-result',
    viewModel: {
      currentUserRole: role,
      viewerRole: role,
      created: createdUsers + createdProfiles,
      updated: updatedUsers + updatedProfiles,
      failed: errors,
      errorDetails,
    },
  };
}
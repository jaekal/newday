// src/services/staff/staffMutationService.js
import {
  User,
  StaffProfile,
  RosterEntry,
} from '../../models/index.js';

import {
  getViewer,
  buildRosterMap,
  canViewerAccessStaff,
} from './staffAccessService.js';

import {
  normalizeUsername,
  normalizeEmail,
  toUpper,
  safeNull,
  normalizeDomainUsername,
} from './staffShared.js';

export async function updateStaffProfileById({ req, staffId }) {
  const staff = await User.findByPk(staffId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });
  if (!staff) throw new Error('Staff not found');

  const viewer = await getViewer(req);
  if (!viewer) throw new Error('Viewer not found');

  const rosterRows = await RosterEntry.findAll();
  const rosterMap = buildRosterMap(rosterRows);

  if (!canViewerAccessStaff(viewer, staff, rosterMap)) {
    throw new Error('Forbidden');
  }

  const {
    name,
    username,
    email,
    role,
    phone,
    avatarPath,
    domainName,
    domainUsername,
    employeeId,
    positionType,
    startDate,
    dateOfBirth,
    carMake,
    carModel,
    licensePlate,
    highestEducationLevel,
    schoolName,
    degreeName,
    fieldOfStudy,
    graduationYear,
    certificationsText,
    rosterBuilding,
    rosterShift,
  } = req.body;

  const userPayload = {};
  if (name != null && String(name).trim() !== '') userPayload.name = String(name).trim();
  if (username != null && String(username).trim() !== '') userPayload.username = normalizeUsername(username);
  if (email != null && String(email).trim() !== '') userPayload.email = normalizeEmail(email);
  if (role != null && String(role).trim() !== '') userPayload.role = toUpper(role);
  if (phone != null) userPayload.phone = safeNull(phone);
  if (avatarPath != null) userPayload.avatarPath = safeNull(avatarPath);

  if (Object.keys(userPayload).length) {
    await staff.update(userPayload);
  }

  let profile = staff.StaffProfile;
  const normalizedDomain = normalizeDomainUsername(domainUsername || username || staff.username || '');
  const rb = safeNull(rosterBuilding);
  const rs = safeNull(rosterShift);

  const profilePayload = {
    domainName: safeNull(domainName),
    domainUsername: normalizedDomain ? normalizedDomain : safeNull(domainUsername),
    employeeId: safeNull(employeeId),
    positionType: positionType ? toUpper(positionType) : (profile?.positionType || 'TECHNICIAN'),
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

  if (profile) {
    await profile.update(profilePayload);
  } else {
    profile = await StaffProfile.create({ userId: staff.id, ...profilePayload });
  }

  const dn = normalizeDomainUsername(
    normalizedDomain || profile?.domainUsername || staff.username || ''
  );

  if (dn) {
    const existingRoster = await RosterEntry.findOne({ where: { domainUsername: dn } });

    if (!existingRoster) {
      await RosterEntry.create({
        domainUsername: dn,
        employeeId: safeNull(employeeId) || safeNull(profilePayload.employeeId),
        building: rb,
        shift: rs,
      });
    } else {
      const rosterPatch = {};
      const emp = safeNull(employeeId);
      if (emp) rosterPatch.employeeId = emp;
      if (rb) rosterPatch.building = rb;
      if (rs) rosterPatch.shift = rs;

      if (Object.keys(rosterPatch).length) {
        await existingRoster.update(rosterPatch);
      }
    }
  }

  return staff;
}

export async function uploadResumeForStaff({ req, staffId }) {
  const staff = await User.findByPk(staffId, {
    include: [{ model: StaffProfile, as: 'StaffProfile' }],
  });

  if (!staff) throw new Error('Staff not found');

  const viewer = await getViewer(req);
  if (!viewer) throw new Error('Viewer not found');

  const rosterRows = await RosterEntry.findAll();
  const rosterMap = buildRosterMap(rosterRows);

  if (!canViewerAccessStaff(viewer, staff, rosterMap)) {
    throw new Error('Forbidden');
  }

  if (!req.file) throw new Error('No file uploaded');

  const relativePath = `/uploads/staff_docs/${req.file.filename}`;
  const originalName = req.file.originalname;

  let profile = staff.StaffProfile;
  if (!profile) {
    profile = await StaffProfile.create({
      userId: staff.id,
      resumePath: relativePath,
      resumeOriginalName: originalName,
    });
  } else {
    await profile.update({
      resumePath: relativePath,
      resumeOriginalName: originalName,
    });
  }

  return profile;
}
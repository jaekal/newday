// src/seedDemoData.js
//
// Creates a realistic demo dataset for "John Doe" so every scoring board,
// chart, and panel in the tool has something to render.
//
// Run once:   node src/seedDemoData.js
// Re-run safe: the script checks for existing records before inserting,
//              so running it multiple times is harmless.
//
// Creates:
//   • 1 manager user   (Jane Smith  — reviews John)
//   • 1 staff user     (John Doe    — the subject)
//   • 1 StaffProfile   (John Doe)
//   • 12 MonthlyReviews spanning the last 12 months (manager-submitted)
//   •  6 self-reviews  (John Doe rating himself — every other month)
//   •  5 incidents     (mix of POSITIVE, COACHING, FORMAL)
//   •  3 goals         (OPEN, IN_PROGRESS, DONE)
//   •  1 ReviewAssignment linking Jane → John

import bcrypt from 'bcryptjs';
import {
  initDb,
  User,
  StaffProfile,
  MonthlyReview,
  Goal,
  Incident,
  ReviewAssignment,
} from './models/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function avg(...vals) {
  const v = vals.filter((x) => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Returns { periodMonth, periodYear } for N months ago from today. */
function monthsAgo(n) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return { periodMonth: d.getMonth() + 1, periodYear: d.getFullYear() };
}

/** Returns a DATEONLY string for N months ago. */
function dateMonthsAgo(n, day = 10) {
  const d = new Date();
  d.setDate(day);
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Score profiles — 12 months of plausible scores showing a gradual improvement
// trend, one dip around month 6, and a strong finish.
// Scores are 1–5 integers.
// ─────────────────────────────────────────────────────────────────────────────

const REVIEW_PROFILES = [
  // 12 months ago  → steady 3s
  { people:[3,3,3], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,3], comment:'John is settling in and meeting basic expectations across the board. Attendance is consistent.' },
  // 11
  { people:[3,4,3], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,4], comment:'Showing more initiative this month. Proactive flag was raised — John started tracking his own metrics.' },
  // 10
  { people:[4,3,3], ownership:[3,4,3], quality:[3,4,3], partnership:[4,3,3], comment:'Solid month. Communication has improved noticeably on the floor. Problem-solving instinct is developing.' },
  // 9
  { people:[4,4,3], ownership:[3,3,4], quality:[4,3,3], partnership:[3,4,4], comment:'Good consistency. Collaboration with the day shift team has been a standout — helped two colleagues debug escalated tickets.' },
  // 8
  { people:[4,4,4], ownership:[4,4,3], quality:[3,4,4], partnership:[4,4,3], comment:'Strongest month yet. Beginning to show real ownership over his test bench. Comments from leads are positive.' },
  // 7 — dip
  { people:[3,3,4], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,3], comment:'Dip in output this month — personal factors contributed. Attendance slightly off. Discussed in 1:1; action plan in place.' },
  // 6
  { people:[4,3,4], ownership:[4,3,3], quality:[3,4,3], partnership:[4,3,4], comment:'Bouncing back. Integrity and Build Trust scores are consistently high. Ownership still a development area.' },
  // 5
  { people:[4,4,4], ownership:[4,4,4], quality:[4,4,3], partnership:[4,3,4], comment:'Strong return to form. Results orientation has clicked — throughput is above team average for the shift.' },
  // 4
  { people:[4,4,4], ownership:[4,4,4], quality:[4,4,4], partnership:[4,4,4], comment:'Excellent month across all buckets. John is becoming a quiet anchor on the shift. Peers rely on him for guidance.' },
  // 3
  { people:[5,4,4], ownership:[4,4,4], quality:[4,5,4], partnership:[4,4,4], comment:'Communication bucket hit a 5 this month — his tech writeback quality is being used as a training reference.' },
  // 2
  { people:[4,5,5], ownership:[5,4,4], quality:[4,4,5], partnership:[4,5,4], comment:'Near-perfect month. Only slight drop is efficiency — complex assignment cluster slowed throughput but quality held.' },
  // 1 month ago
  { people:[5,5,4], ownership:[4,5,5], quality:[5,4,5], partnership:[5,4,5], comment:'Outstanding period. John is operating at a level where a Lead track conversation is warranted. Recommend recognition.' },
];

// Self-review profiles — submitted every other month (6 out of 12)
// Slightly more conservative than manager scores (realistic self-assessment)
const SELF_PROFILES = [
  { monthsBack: 11, people:[3,3,3], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,3], comment:'Honestly feel I am still learning the rhythm. Trying to be more proactive.' },
  { monthsBack:  9, people:[4,3,3], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,4], comment:'Better month personally. Collaboration felt easier once I understood the escalation path.' },
  { monthsBack:  7, people:[3,3,3], ownership:[3,3,3], quality:[3,3,3], partnership:[3,3,3], comment:'Tough month. Attendance issues I own. Commitments made in 1:1 — will follow through.' },
  { monthsBack:  5, people:[4,4,4], ownership:[3,4,3], quality:[3,4,3], partnership:[4,3,4], comment:'Much better. I feel like I am contributing meaningfully now. Still working on efficiency habits.' },
  { monthsBack:  3, people:[4,4,4], ownership:[4,4,4], quality:[4,4,4], partnership:[4,4,4], comment:'Consistent effort. Communication has become second nature. Ready for more responsibility.' },
  { monthsBack:  1, people:[4,5,4], ownership:[4,5,4], quality:[4,4,5], partnership:[5,4,4], comment:'Best month I have had. Proud of the writeback quality and helping two newer techs troubleshoot.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

(async () => {
  await initDb();
  console.log('\n── Manager-tool v2 demo seed ──────────────────────────────────────────────\n');

  const PASSWORD = 'Demo1234!';
  const hash     = await bcrypt.hash(PASSWORD, 10);

  // ── 1. Manager user (Jane Smith) ──────────────────────────────────────────
  let jane = await User.findOne({ where: { username: 'jane.smith' } });
  if (!jane) {
    jane = await User.create({
      name: 'Jane Smith', username: 'jane.smith', email: 'jane.smith@demo.local',
      role: 'MANAGER', phone: '555-0101', passwordHash: hash, isEnabled: true,
    });
    console.log('✓ Created manager: jane.smith  (password: ' + PASSWORD + ')');
  } else {
    console.log('– Manager jane.smith already exists, skipping');
  }

  // ── 2. Staff user (John Doe) ───────────────────────────────────────────────
  let john = await User.findOne({ where: { username: 'john.doe' } });
  if (!john) {
    john = await User.create({
      name: 'John Doe', username: 'john.doe', email: 'john.doe@demo.local',
      role: 'STAFF', phone: '555-0202', passwordHash: hash, isEnabled: true,
    });
    console.log('✓ Created staff:   john.doe   (password: ' + PASSWORD + ')');
  } else {
    console.log('– Staff john.doe already exists, skipping');
  }

  // ── 3. StaffProfile for John ───────────────────────────────────────────────
  let johnProfile = await StaffProfile.findOne({ where: { userId: john.id } });
  if (!johnProfile) {
    johnProfile = await StaffProfile.create({
      userId: john.id, employeeId: 'EMP-0042',
      positionType: 'TECHNICIAN', startDate: dateMonthsAgo(14),
      building: 'Building A', shift: 'Day',
      domainName: 'CORP', domainUsername: 'john.doe',
      aboutMe: 'Hardware technician with a focus on server repair and test automation. Continuous learner.',
      keyStrengths: 'Reliability, technical troubleshooting, peer mentoring',
      developmentFocus: 'Ownership metrics, leadership readiness, throughput efficiency',
      technicalSkills: 'Server test & repair, ZT racks, escalation triage, burn-in procedures',
      softSkills: 'Communication, integrity, teamwork',
    });
    console.log('✓ Created StaffProfile for John Doe (Building A / Day / TECHNICIAN)');
  } else {
    console.log('– StaffProfile already exists for john.doe, skipping');
  }

  // ── 4. ReviewAssignment: Jane → John ──────────────────────────────────────
  let assignment = await ReviewAssignment.findOne({
    where: { reviewerId: jane.id, staffId: john.id },
  });
  if (!assignment) {
    assignment = await ReviewAssignment.create({
      reviewerId: jane.id, staffId: john.id, active: true,
    });
    console.log('✓ Created ReviewAssignment: jane.smith → john.doe');
  } else {
    console.log('– ReviewAssignment already exists, skipping');
  }

  // ── 5. Manager-submitted monthly reviews (12 months) ──────────────────────
  let reviewsCreated = 0;
  for (let i = 0; i < REVIEW_PROFILES.length; i++) {
    const p  = REVIEW_PROFILES[i];
    const mb = 12 - i;                      // 12 months ago → 1 month ago
    const { periodMonth, periodYear } = monthsAgo(mb);

    const existing = await MonthlyReview.findOne({
      where: { staffId: john.id, submitterId: jane.id, periodMonth, periodYear },
    });
    if (existing) continue;

    const bPeople      = avg(...p.people);
    const bOwnership   = avg(...p.ownership);
    const bQuality     = avg(...p.quality);
    const bPartnership = avg(...p.partnership);
    const overall      = avg(bPeople, bOwnership, bQuality, bPartnership);

    await MonthlyReview.create({
      staffId:     john.id,
      submitterId: jane.id,
      periodMonth, periodYear,
      isSelfReview: false,
      positionTypeSnapshot: 'TECHNICIAN',

      positiveAttitude:      p.people[0],
      proactive:             p.people[1],
      integrity:             p.people[2],

      accountability2:       p.ownership[0],
      problemSolving:        p.ownership[1],
      efficiency:            p.ownership[2],

      resultsOrientation:    p.quality[0],
      communication:         p.quality[1],
      continuousImprovement: p.quality[2],

      teamwork2:             p.partnership[0],
      collaboration:         p.partnership[1],
      buildTrust:            p.partnership[2],

      bucketPeopleAvg:      bPeople,
      bucketOwnershipAvg:   bOwnership,
      bucketQualityAvg:     bQuality,
      bucketPartnershipAvg: bPartnership,
      overallBucketAvg:     overall,

      comment: p.comment,
    });
    reviewsCreated++;
  }
  console.log(`✓ Created ${reviewsCreated} manager reviews (${12 - reviewsCreated} already existed)`);

  // ── 6. Self-reviews (6 months) ─────────────────────────────────────────────
  let selfCreated = 0;
  for (const sp of SELF_PROFILES) {
    const { periodMonth, periodYear } = monthsAgo(sp.monthsBack);

    const existing = await MonthlyReview.findOne({
      where: { staffId: john.id, submitterId: john.id, periodMonth, periodYear },
    });
    if (existing) continue;

    const bPeople      = avg(...sp.people);
    const bOwnership   = avg(...sp.ownership);
    const bQuality     = avg(...sp.quality);
    const bPartnership = avg(...sp.partnership);
    const overall      = avg(bPeople, bOwnership, bQuality, bPartnership);

    await MonthlyReview.create({
      staffId:     john.id,
      submitterId: john.id,
      periodMonth, periodYear,
      isSelfReview: true,
      positionTypeSnapshot: 'TECHNICIAN',

      positiveAttitude:      sp.people[0],
      proactive:             sp.people[1],
      integrity:             sp.people[2],

      accountability2:       sp.ownership[0],
      problemSolving:        sp.ownership[1],
      efficiency:            sp.ownership[2],

      resultsOrientation:    sp.quality[0],
      communication:         sp.quality[1],
      continuousImprovement: sp.quality[2],

      teamwork2:             sp.partnership[0],
      collaboration:         sp.partnership[1],
      buildTrust:            sp.partnership[2],

      bucketPeopleAvg:      bPeople,
      bucketOwnershipAvg:   bOwnership,
      bucketQualityAvg:     bQuality,
      bucketPartnershipAvg: bPartnership,
      overallBucketAvg:     overall,

      comment: sp.comment,
    });
    selfCreated++;
  }
  console.log(`✓ Created ${selfCreated} self-reviews (${SELF_PROFILES.length - selfCreated} already existed)`);

  // ── 7. Incidents ───────────────────────────────────────────────────────────
  const INCIDENTS = [
    {
      incidentDate: dateMonthsAgo(10, 5),
      title: 'Q3 Production Contributor Award',
      type: 'POSITIVE', tone: 'RECOGNITION',
      impactArea: 'QUALITY', theme: 'INITIATIVE', severity: 'LOW',
      requiresFollowUp: false, followUpStatus: 'NO_ACTION',
      details: 'John was nominated by two leads for his consistency during the Q3 surge. Repair throughput was 12% above team average.',
    },
    {
      incidentDate: dateMonthsAgo(8, 15),
      title: 'Attendance — two late arrivals in one week',
      type: 'COACHING', tone: 'ATTENDANCE_NOTE',
      impactArea: 'PEOPLE', theme: 'ATTENDANCE', severity: 'LOW',
      requiresFollowUp: true, followUpStatus: 'CLOSED',
      details: 'John arrived 25 minutes late on Tuesday and 15 minutes late on Thursday. Discussed in brief 1:1. No prior record. Acknowledged and corrected.',
      followUpOutcome: 'No further occurrences. Issue resolved.',
    },
    {
      incidentDate: dateMonthsAgo(7, 8),
      title: 'Test procedure shortcut — post-repair retest skipped',
      type: 'FORMAL', tone: 'POLICY_VIOLATION',
      impactArea: 'QUALITY', theme: 'PROCESS_IMPROVEMENT', severity: 'MEDIUM',
      requiresFollowUp: true, followUpStatus: 'CLOSED',
      details: 'John skipped the mandatory post-repair retest on three units during a high-volume shift. Units were flagged during end-of-line QC. No customer impact. Retraining completed.',
      followUpOutcome: 'Retraining on SOP-QA-07 completed. Test pass rates returned to 100% within two weeks.',
    },
    {
      incidentDate: dateMonthsAgo(4, 20),
      title: 'Peer mentoring — onboarded two new technicians',
      type: 'POSITIVE', tone: 'ACHIEVEMENT',
      impactArea: 'PEOPLE', theme: 'TEAMWORK', severity: 'LOW',
      requiresFollowUp: false, followUpStatus: 'NO_ACTION',
      details: 'John volunteered to shadow-train two newly onboarded technicians for their first two weeks. Both reached independent certification ahead of schedule.',
    },
    {
      incidentDate: dateMonthsAgo(1, 12),
      title: 'Writeback documentation quality flag — commendation',
      type: 'POSITIVE', tone: 'PROFESSIONAL_COMMENDATION',
      impactArea: 'QUALITY', theme: 'PROCESS_IMPROVEMENT', severity: 'LOW',
      requiresFollowUp: false, followUpStatus: 'NO_ACTION',
      details: 'Quality team flagged three of John\'s writebacks as best-in-class for completeness and clarity. Examples are being incorporated into the new onboarding guide.',
    },
  ];

  let incCreated = 0;
  for (const inc of INCIDENTS) {
    const exists = await Incident.findOne({
      where: { staffId: john.id, title: inc.title },
    });
    if (exists) continue;

    await Incident.create({ ...inc, staffId: john.id, submitterId: jane.id });
    incCreated++;
  }
  console.log(`✓ Created ${incCreated} incidents (${INCIDENTS.length - incCreated} already existed)`);

  // ── 8. Goals ───────────────────────────────────────────────────────────────
  const GOALS = [
    {
      title: 'Achieve 95% post-repair retest compliance',
      description: 'Maintain zero post-repair retest skips for 90 consecutive days following the August coaching conversation. Tracked via QC dashboard weekly.',
      category: 'Quality', priority: 'HIGH', status: 'DONE',
      successCriteria: 'Zero QC flags related to skipped retests for 90 days.',
      measure: 'QC dashboard flag count', progress: 100,
      dueDate: dateMonthsAgo(2),
    },
    {
      title: 'Complete advanced rack assignment certification',
      description: 'Pass the ZT Advanced Rack Assignment & Configuration cert by end of quarter. Covers customer-specific configurations and escalation routing for non-standard builds.',
      category: 'Training', priority: 'MEDIUM', status: 'IN_PROGRESS',
      successCriteria: 'Passing score on certification exam; cert added to employee record.',
      measure: 'Certification exam score', progress: 65,
      dueDate: dateMonthsAgo(-2), // 2 months in the future
    },
    {
      title: 'Lead shadow program — prepare for Lead track consideration',
      description: 'Shadow the current day-shift Lead for at least 8 sessions over 3 months. Document observations and identify 3 areas where John would run things differently. Present a short writeup to manager.',
      category: 'Leadership Development', priority: 'HIGH', status: 'OPEN',
      successCriteria: '8 shadow sessions logged; written reflection submitted.',
      measure: 'Sessions completed / reflection submitted', progress: 20,
      dueDate: dateMonthsAgo(-4), // 4 months in the future
    },
  ];

  let goalsCreated = 0;
  for (const g of GOALS) {
    const exists = await Goal.findOne({ where: { ownerId: john.id, title: g.title } });
    if (exists) continue;
    await Goal.create({ ...g, ownerId: john.id });
    goalsCreated++;
  }
  console.log(`✓ Created ${goalsCreated} goals (${GOALS.length - goalsCreated} already existed)`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n── Login credentials ───────────────────────────────────────────────────────');
  console.log('  Manager:  username=jane.smith   password=' + PASSWORD);
  console.log('  Staff:    username=john.doe     password=' + PASSWORD);
  console.log('\n── Navigate to ─────────────────────────────────────────────────────────────');
  console.log('  Dashboard:      http://localhost:3377/');
  console.log('  John\'s profile: http://localhost:3377/staff  → click John Doe');
  console.log('  Goals:          http://localhost:3377/goals');
  console.log('  Incidents:      http://localhost:3377/incidents');
  console.log('  Reviews:        http://localhost:3377/reviews/my');
  console.log('────────────────────────────────────────────────────────────────────────────\n');

  process.exit(0);
})();

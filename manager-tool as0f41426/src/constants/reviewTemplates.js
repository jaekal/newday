// src/constants/reviewTemplates.js

export const POSITION_TYPES = ['TECHNICIAN', 'LEAD', 'CHAMPION', 'SPECIALIST', 'SUPERVISOR', 'MANAGER'];

// For each position → for each core category, we define a description
export const POSITION_CRITERIA = {
  TECHNICIAN: {
    positiveAttitude: 'Brings a constructive attitude to the floor, responds well to feedback.',
    proactive: 'Volunteers to help, stays engaged, looks for next task without waiting.',
    integrity: 'Follows procedures honestly, reports issues accurately, avoids shortcuts.',
    accountability: 'Owns mistakes, closes assigned tasks, communicates when blocked.',
    problemSolving: 'Uses logs, tools, and escalation paths to resolve issues effectively.',
    efficiency: 'Manages time well on stations, minimizes rework and idle time.',
    results: 'Delivers reliable test/repair outcomes with low repeat failures.',
    communication: 'Escalates clearly, hands off cleanly between shifts, asks clarifying questions.',
    continuousImprovement: 'Suggests improvements, adopts new processes quickly.',
    teamwork: 'Supports teammates, helps balance queues, shares knowledge.',
    collaboration: 'Works smoothly with QC, Warehouse, Engineering, etc.',
    buildTrust: 'Consistent, reliable, and trusted to work independently on assigned tasks.',
  },

  LEAD: {
    positiveAttitude: 'Sets tone for the area, maintains composure, reinforces positive culture.',
    proactive: 'Anticipates floor issues, preps for next shift, clears blockers before they appear.',
    integrity: 'Models adherence to SOP/QMS; enforces standards fairly and consistently.',
    accountability: 'Owns area performance and follow-through on actions and passdowns.',
    problemSolving: 'Resolves escalations, validates technician repairs, supports root-cause thinking.',
    efficiency: 'Optimizes workflow, manages queues, aligns techs to priority work.',
    results: 'Drives output, FPY, and reduced repeat failures in their zone.',
    communication: 'Provides clear passdowns, updates supervisors, keeps technicians informed.',
    continuousImprovement: 'Runs small experiments, helps refine processes with MQE/Engineering.',
    teamwork: 'Aligns technicians, champions, and support roles toward shared goals.',
    collaboration: 'Works with Supervisors, Engineering, Quality, and Planning to keep flow healthy.',
    buildTrust: 'Seen as a fair, reliable, go-to person on the floor for guidance and decisions.',
  },

  CHAMPION: {
    positiveAttitude: 'Brings calm confidence to tough problems, encourages techs under pressure.',
    proactive: 'Surfaces risks early, pushes for fixes before issues become chronic.',
    integrity: 'Maintains accurate technical documentation, doesn’t cut corners in analysis.',
    accountability: 'Owns the technical quality of their domain (RLT, SLT, MRS, networking, etc.).',
    problemSolving: 'Handles the hardest escalations; defines troubleshooting trees and root causes.',
    efficiency: 'Improves test flows and troubleshooting steps to reduce cycle time and waste.',
    results: 'Drives measurable improvements in FPY, repeat failures, and defect escapes.',
    communication: 'Translates complex technical issues into clear guidance for techs and leads.',
    continuousImprovement: 'Builds training, updates SOPs, and leads improvement pilots.',
    teamwork: 'Partners tightly with leads, supervisors, and engineers to drive adoption.',
    collaboration: 'Coordinates across teams (Quality, MQE, Eng, Maintenance) on fixes.',
    buildTrust: 'Recognized SME whose guidance is trusted and followed across shifts.',
  },

  SUPERVISOR: {
    positiveAttitude: 'Keeps team grounded during change, sets a steady and constructive tone.',
    proactive: 'Plans staffing, shifts priorities, and preps for spikes before they hit.',
    integrity: 'Makes fair decisions, respects policy, and ensures compliance is non-negotiable.',
    accountability: 'Owns shift-level output, quality, and safety outcomes.',
    problemSolving: 'Makes clear, timely decisions balancing speed, quality, and risk.',
    efficiency: 'Aligns headcount and resources to maximize throughput and OEE.',
    results: 'Delivers on goals: output, FPY, WIP, downtime, and strategic initiatives.',
    communication: 'Keeps managers, peers, and cross-functional teams informed and aligned.',
    continuousImprovement: 'Sponsors CI projects and ensures changes actually stick.',
    teamwork: 'Builds a healthy, collaborative environment across leads and champions.',
    collaboration: 'Partners with upstream/downstream teams to keep the whole value chain healthy.',
    buildTrust: 'Team believes in their word, follow-through, and fairness.',
  },

  SUPPORT: {
    positiveAttitude: 'Approaches support tasks with a service mindset and calm demeanor.',
    proactive: 'Anticipates needs (tools, carts, materials, reports) before they’re requested.',
    integrity: 'Maintains accurate records and handles sensitive information correctly.',
    accountability: 'Closes loops on requests, follows through on log updates and tracking.',
    problemSolving: 'Unblocks small issues quickly without creating additional noise.',
    efficiency: 'Keeps admin/logistics work flowing with minimal rework or delay.',
    results: 'Improves smoothness of operations through timely, accurate support.',
    communication: 'Provides clear, timely updates to techs, leads, and supervisors.',
    continuousImprovement: 'Helps refine trackers, reports, and workflows.',
    teamwork: 'Acts as a reliable partner for floor teams and leadership.',
    collaboration: 'Works across departments (Warehouse, IT, Planning, MQE) effectively.',
    buildTrust: 'Known as someone who quietly gets things done and can be counted on.',
  },
};

import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * Seeded module videos use a small pool of **long‑standing, embed‑allowed** YouTube IDs.
 * Many arbitrary IDs fail (removed, embedding disabled, or region‑blocked). We rotate a
 * verified pool; module text still teaches the topic. Uses privacy‑enhanced embed domain.
 */
const YT_EMBED_POOL = [
  "HJOpjJX3nhE", // TED — Julian Treasure (listening / communication)
  "Ks-_Mh1QhMc", // TED — Amy Cuddy (presence / confidence)
  "M7lc1UVf-VE", // Google-uploaded sample (widely used; reliable embed)
  "aqz-KE-bpKQ", // Blender — Big Buck Bunny (open movie; stable)
  "jNQXAC9IVRw", // First YouTube upload — always embeddable (demo / history)
] as const;

function yt(n: number): string {
  const id = YT_EMBED_POOL[n % YT_EMBED_POOL.length];
  return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;
}

/** Stock images (Unsplash — direct image URLs). */
const IMG = {
  team: "https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&w=1200&q=80",
  meeting: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&w=1200&q=80",
  safetyGear: "https://images.unsplash.com/photo-1581092160562-40aa08f7a57e?auto=format&w=1200&q=80",
  warehouse: "https://images.unsplash.com/photo-1581092918056-0c4c3ac0b0c0?auto=format&w=1200&q=80",
  office: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&w=1200&q=80",
  handshake: "https://images.unsplash.com/photo-1521791136064-7986c2920216?auto=format&w=1200&q=80",
  datacenter: "https://images.unsplash.com/photo-1558494949-ef010cbdcc31?auto=format&w=1200&q=80",
  serverRack: "https://images.unsplash.com/photo-1597852074816-d933c7d2b988?auto=format&w=1200&q=80",
  ergonomics: "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&w=1200&q=80",
};

type Q = {
  id: string;
  type: "MULTIPLE_CHOICE" | "TRUE_FALSE" | "MULTI_SELECT";
  difficulty: "EASY" | "MEDIUM" | "HARD";
  points: number;
  stem: string;
  explanation?: string;
  tags: string[];
  options?: { id: string; text: string; isCorrect: boolean }[];
  correctAnswer: string;
};

type Mod = {
  id: string;
  title: string;
  description: string;
  order: number;
  category: string;
  estimatedMinutes: number;
  videoUrl: string;
  content: string;
};

type Asm = {
  id: string;
  title: string;
  description: string;
  timeLimit: number;
  passingScore: number;
  questionIds: string[];
};

type CourseSpec = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  modules: Mod[];
  questions: Q[];
  assessments: Asm[];
};

const catalog: CourseSpec[] = [
  {
    id: "course-soft-communication",
    title: "Professional Communication at Work",
    description:
      "Build clarity, empathy, and confidence in everyday workplace conversations—meetings, email, and listening.",
    imageUrl: IMG.meeting,
    modules: [
      {
        id: "mod-soft-1",
        title: "Listening and clarity",
        description: "Why listening comes first and how to reduce misunderstandings.",
        order: 1,
        category: "Foundations",
        estimatedMinutes: 25,
        videoUrl: yt(0),
        content: `![Team discussion](${IMG.team})

# Listening first

Strong communication starts with **listening**. When people feel heard, conflicts shrink and decisions get faster.

## In this module

- Barriers to listening (noise, assumptions, interrupting)
- The HAIL framework (Honesty, Authenticity, Integrity, Love) from the linked talk
- Practical habits: paraphrase, ask clarifying questions, pause before responding

Watch the video, then reflect: *Which listening habit will you practice this week?*`,
      },
      {
        id: "mod-soft-2",
        title: "Written communication & tone",
        description: "Email and chat that stays respectful under pressure.",
        order: 2,
        category: "Writing",
        estimatedMinutes: 20,
        videoUrl: yt(1),
        content: `![Office collaboration](${IMG.office})

# Tone in digital messages

Slack and email strip away body language—**word choice** carries the emotional load.

## Checklist before you send

1. **Goal** — What do you want the reader to do?
2. **Audience** — Executive summary first, details after.
3. **Warmth** — Please/thank you, avoid absolute blame ("you always").

## Activity

Rewrite one blunt message into a concise, respectful version (3–5 sentences).`,
      },
      {
        id: "mod-soft-3",
        title: "Difficult conversations",
        description: "Frame issues without shutting people down.",
        order: 3,
        category: "Dialogue",
        estimatedMinutes: 22,
        videoUrl: yt(2),
        content: `![Handshake](${IMG.handshake})

# Courageous dialogue

Difficult conversations need **psychological safety**: separate intent from impact, share observations before conclusions.

## A simple script

- **Observation** — What you noticed (facts).
- **Impact** — How it affected the team or work.
- **Request** — Specific change or experiment.

Pair the framework with curiosity—ask "What am I missing?"`,
      },
      {
        id: "mod-soft-4",
        title: "Presentation presence",
        description: "Short talks that land with busy stakeholders.",
        order: 4,
        category: "Delivery",
        estimatedMinutes: 18,
        videoUrl: yt(3),
        content: `![Presentation](${IMG.meeting})

# Executive summaries

Leaders want **answer first**, evidence second.

## Structure

1. **Bottom line** in one sentence.
2. **Three supporting points** max.
3. **Ask** — Decision, input, or awareness?

Practice a 60-second “elevator” version of a current project.`,
      },
    ],
    questions: [
      {
        id: "q-soft-1",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "Active listening includes paraphrasing what you heard to confirm understanding.",
        explanation: "Reflecting back reduces misinterpretation.",
        tags: ["listening"],
        options: [
          { id: "t", text: "True", isCorrect: true },
          { id: "f", text: "False", isCorrect: false },
        ],
        correctAnswer: "t",
      },
      {
        id: "q-soft-2",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "Which subject line is most appropriate for a cross-team blocker?",
        explanation: "Specific + timeframe helps triage.",
        tags: ["email"],
        options: [
          { id: "a", text: "URGENT!!!!!!!!!!!!!!!!", isCorrect: false },
          { id: "b", text: "Invoice API — prod errors since 09:00 UTC (need DBA)", isCorrect: true },
          { id: "c", text: "Hey", isCorrect: false },
          { id: "d", text: "Question", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-soft-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "In a difficult conversation, what should come first?",
        explanation: "Observations before judgments reduce defensiveness.",
        tags: ["feedback"],
        options: [
          { id: "a", text: "Your personality is the problem", isCorrect: false },
          { id: "b", text: "Verifiable observations and shared goals", isCorrect: true },
          { id: "c", text: "A formal warning", isCorrect: false },
          { id: "d", text: "Gossip with peers for consensus", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-soft-4",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Which habit most improves clarity in chat messages?",
        tags: ["writing"],
        options: [
          { id: "a", text: "Long paragraphs with multiple topics", isCorrect: false },
          { id: "b", text: "One thread per topic with a clear ask", isCorrect: true },
          { id: "c", text: "Only @channel pings", isCorrect: false },
          { id: "d", text: "Avoiding all punctuation", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-soft-5",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "Psychological safety means never giving critical feedback.",
        explanation: "Safety means feedback is about work behaviors, not personal attacks.",
        tags: ["psychological-safety"],
        options: [
          { id: "t", text: "True", isCorrect: false },
          { id: "f", text: "False", isCorrect: true },
        ],
        correctAnswer: "f",
      },
      {
        id: "q-soft-6",
        type: "MULTI_SELECT",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Select all that typically belong in the opening of an executive update.",
        tags: ["presentations"],
        options: [
          { id: "a", text: "Recommendation or decision needed", isCorrect: true },
          { id: "b", text: "Every meeting minute from the last month", isCorrect: false },
          { id: "c", text: "Key risks or dependencies", isCorrect: true },
          { id: "d", text: "Irrelevant personal anecdotes", isCorrect: false },
        ],
        correctAnswer: JSON.stringify(["a", "c"]),
      },
    ],
    assessments: [
      {
        id: "asm-soft-1",
        title: "Communication foundations check",
        description: "Modules 1–2: listening and written tone.",
        timeLimit: 15,
        passingScore: 70,
        questionIds: ["q-soft-1", "q-soft-2", "q-soft-3"],
      },
      {
        id: "asm-soft-2",
        title: "Dialogue & presence quiz",
        description: "Modules 3–4: difficult conversations and presentations.",
        timeLimit: 15,
        passingScore: 70,
        questionIds: ["q-soft-4", "q-soft-5", "q-soft-6"],
      },
    ],
  },

  {
    id: "course-safety-foundations",
    title: "Workplace Safety Foundations",
    description:
      "Core concepts: hazards, controls, PPE, reporting, and a proactive safety mindset for office and industrial settings.",
    imageUrl: IMG.safetyGear,
    modules: [
      {
        id: "mod-safe-1",
        title: "Hazard identification",
        description: "Spot energy sources, chemicals, ergonomics, and psychosocial hazards.",
        order: 1,
        category: "Awareness",
        estimatedMinutes: 20,
        videoUrl: yt(4),
        content: `![Safety gear](${IMG.safetyGear})

# What is a hazard?

A **hazard** is anything with potential to cause harm. **Risk** combines likelihood and severity.

## Categories

- Physical (noise, slips, moving parts)
- Chemical (dust, fumes)
- Ergonomic (repetition, awkward posture)
- Psychosocial (stress, fatigue)

*Report near-misses*—they are free lessons.`,
      },
      {
        id: "mod-safe-2",
        title: "Hierarchy of controls",
        description: "Eliminate, substitute, engineering, admin, PPE—in that order.",
        order: 2,
        category: "Controls",
        estimatedMinutes: 22,
        videoUrl: yt(5),
        content: `![Industrial setting](${IMG.warehouse})

# Controls pyramid

1. **Elimination** — Remove the hazard.
2. **Substitution** — Safer material or process.
3. **Engineering** — Guards, ventilation, machine interlocks.
4. **Administrative** — Procedures, training, rotation.
5. **PPE** — Last line of defense.

If training is your only control, ask what else can change upstream.`,
      },
      {
        id: "mod-safe-3",
        title: "PPE selection and fit",
        description: "When PPE is required and how to inspect it.",
        order: 3,
        category: "PPE",
        estimatedMinutes: 18,
        videoUrl: yt(6),
        content: `![PPE](${IMG.safetyGear})

# Right PPE for the task

Match PPE to the **hazard assessment**: eye, face, hearing, respiratory, hand, foot.

## Before each use

- Inspect for cracks, tears, expiry (especially fall protection and cartridges).
- Ensure **fit**—a leaking respirator is decoration.`,
      },
      {
        id: "mod-safe-4",
        title: "Incidents and emergency response",
        description: "Who to call, what to document, evacuation basics.",
        order: 4,
        category: "Response",
        estimatedMinutes: 20,
        videoUrl: yt(7),
        content: `![Team safety briefing](${IMG.team})

# Reporting saves lives

Early reporting fixes systemic issues. Know:

- **Alarm points** and muster areas
- **Spill kits / AED / eyewash** locations
- **Stop work authority** when conditions change`,
      },
    ],
    questions: [
      {
        id: "q-safe-1",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "PPE should be the first control you rely on when designing a safer task.",
        explanation: "PPE is typically the last line after elimination/substitution/engineering.",
        tags: ["hierarchy"],
        options: [
          { id: "t", text: "True", isCorrect: false },
          { id: "f", text: "False", isCorrect: true },
        ],
        correctAnswer: "f",
      },
      {
        id: "q-safe-2",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "Which is an example of an engineering control?",
        tags: ["controls"],
        options: [
          { id: "a", text: "A new policy document", isCorrect: false },
          { id: "b", text: "Machine guard or local exhaust ventilation", isCorrect: true },
          { id: "c", text: "Safety glasses", isCorrect: false },
          { id: "d", text: "Team meeting", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-safe-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Why are near-miss reports valuable?",
        tags: ["reporting"],
        options: [
          { id: "a", text: "They replace insurance", isCorrect: false },
          { id: "b", text: "They reveal weaknesses before someone gets hurt", isCorrect: true },
          { id: "c", text: "They are only for regulatory fines", isCorrect: false },
          { id: "d", text: "They should be hidden to avoid blame", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-safe-4",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Before using a chemical respirator, you should verify:",
        tags: ["ppe"],
        options: [
          { id: "a", text: "It matches the hazard and passes a fit test", isCorrect: true },
          { id: "b", text: "It is any mask from the storeroom", isCorrect: false },
          { id: "c", text: "It is optional if windows are open", isCorrect: false },
          { id: "d", text: "Only the color matters", isCorrect: false },
        ],
        correctAnswer: "a",
      },
      {
        id: "q-safe-5",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "A slippery floor near a high-traffic door is primarily an ergonomic hazard.",
        explanation: "It is primarily a slip/trip (physical) hazard.",
        tags: ["hazards"],
        options: [
          { id: "t", text: "True", isCorrect: false },
          { id: "f", text: "False", isCorrect: true },
        ],
        correctAnswer: "f",
      },
    ],
    assessments: [
      {
        id: "asm-safe-1",
        title: "Safety awareness quiz",
        description: "Hazards and hierarchy of controls.",
        timeLimit: 15,
        passingScore: 70,
        questionIds: ["q-safe-1", "q-safe-2", "q-safe-3"],
      },
      {
        id: "asm-safe-2",
        title: "PPE & reporting",
        description: "PPE fit and incident mindset.",
        timeLimit: 12,
        passingScore: 70,
        questionIds: ["q-safe-4", "q-safe-5"],
      },
    ],
  },

  {
    id: "course-6s-workplace",
    title: "6S Workplace Organization",
    description:
      "Implement Sort, Set in Order, Shine, Standardize, Sustain, and Safety for a cleaner, faster, and safer workplace.",
    imageUrl: IMG.warehouse,
    modules: [
      {
        id: "mod-6s-1",
        title: "Sort & Red-tag",
        description: "Remove what does not belong; decide keep vs relocate vs discard.",
        order: 1,
        category: "Seiri",
        estimatedMinutes: 25,
        videoUrl: yt(8),
        content: `![Organized workspace](${IMG.warehouse})

# Sort (Seiri)

**Only what you need, where you need it.** Use red tags for questionable items and a deadline to decide.

## Benefits

- Frees floor space
- Surfaces bottlenecks
- Reduces search time`,
      },
      {
        id: "mod-6s-2",
        title: "Set in Order",
        description: "A place for everything; visual cues and FIFO where needed.",
        order: 2,
        category: "Seiton",
        estimatedMinutes: 22,
        videoUrl: yt(9),
        content: `![Labels and lines](${IMG.warehouse})

# Set in order

- **Shadow boards** for tools
- **Floor markings** for pedestrian vs forklift lanes
- **Min/max** signals for replenishment`,
      },
      {
        id: "mod-6s-3",
        title: "Shine & inspect",
        description: "Cleaning as inspection—find leaks, cracks, and abnormalities early.",
        order: 3,
        category: "Seiso",
        estimatedMinutes: 20,
        videoUrl: yt(10),
        content: `![Cleaning](${IMG.warehouse})

# Shine is not housekeeping only

When operators own basic cleaning, **abnormalities surface** before failures cascade.`,
      },
      {
        id: "mod-6s-4",
        title: "Standardize & Sustain",
        description: "Checklists, audits, and leadership routines that keep gains.",
        order: 4,
        category: "Seiketsu & Shitsuke",
        estimatedMinutes: 24,
        videoUrl: yt(11),
        content: `![Team audit](${IMG.team})

# Make the standard visible

- **Standard work** photos at the point of use
- **Layered audits** (hourly → weekly → monthly)
- **KPI boards** for 6S score by zone`,
      },
      {
        id: "mod-6s-5",
        title: "Safety as the 6th S",
        description: "Integrate hazard checks into every 6S walk.",
        order: 5,
        category: "Safety",
        estimatedMinutes: 18,
        videoUrl: yt(12),
        content: `![Safety walk](${IMG.safetyGear})

# Safety embedded

Each 6S tour asks: *What could hurt someone here today?* Tie findings to the hierarchy of controls.`,
      },
    ],
    questions: [
      {
        id: "q-6s-1",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "The first S in 6S focuses on:",
        tags: ["sort"],
        options: [
          { id: "a", text: "Shining floors only", isCorrect: false },
          { id: "b", text: "Separating needed from unneeded items", isCorrect: true },
          { id: "c", text: "Scheduling meetings", isCorrect: false },
          { id: "d", text: "Buying more storage", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-6s-2",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "Visual controls (labels, shadows, floor tape) support Set in Order.",
        tags: ["visual"],
        options: [
          { id: "t", text: "True", isCorrect: true },
          { id: "f", text: "False", isCorrect: false },
        ],
        correctAnswer: "t",
      },
      {
        id: "q-6s-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Why is Shine (Seiso) considered more than cleaning?",
        tags: ["shine"],
        options: [
          { id: "a", text: "It replaces maintenance budgets", isCorrect: false },
          { id: "b", text: "Cleaning reveals equipment abnormalities early", isCorrect: true },
          { id: "c", text: "It is only for customer tours", isCorrect: false },
          { id: "d", text: "It eliminates the need for PPE", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-6s-4",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Sustain (Shitsuke) is best supported by:",
        tags: ["sustain"],
        options: [
          { id: "a", text: "One-time training with no follow-up", isCorrect: false },
          { id: "b", text: "Audits, coaching, and visible standards", isCorrect: true },
          { id: "c", text: "Punitive-only enforcement", isCorrect: false },
          { id: "d", text: "Removing all metrics", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-6s-5",
        type: "MULTI_SELECT",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Select all that are common 6S audit findings.",
        tags: ["audit"],
        options: [
          { id: "a", text: "Blocked exits or fire equipment", isCorrect: true },
          { id: "b", text: "Missing or outdated labels", isCorrect: true },
          { id: "c", text: "Perfectly maintained standards every time with zero gaps", isCorrect: false },
          { id: "d", text: "Tools without a home location", isCorrect: true },
        ],
        correctAnswer: JSON.stringify(["a", "b", "d"]),
      },
    ],
    assessments: [
      {
        id: "asm-6s-1",
        title: "6S principles check",
        description: "Sort through Shine.",
        timeLimit: 14,
        passingScore: 70,
        questionIds: ["q-6s-1", "q-6s-2", "q-6s-3"],
      },
      {
        id: "asm-6s-2",
        title: "Sustain & safety integration",
        description: "Standard work and audits.",
        timeLimit: 12,
        passingScore: 70,
        questionIds: ["q-6s-4", "q-6s-5"],
      },
    ],
  },

  {
    id: "course-team-collaboration",
    title: "Teamwork & Psychological Safety",
    description:
      "Practical habits for inclusive teamwork: async collaboration, trust, and constructive debate.",
    imageUrl: IMG.team,
    modules: [
      {
        id: "mod-team-1",
        title: "Roles and handoffs",
        description: "RACI-lite and clean handoffs between shifts or time zones.",
        order: 1,
        category: "Structure",
        estimatedMinutes: 20,
        videoUrl: yt(13),
        content: `![Team workshop](${IMG.team})

# Clear ownership

Ambiguous ownership creates thrash. Use **RACI** (Responsible, Accountable, Consulted, Informed) for cross-team efforts.

Document **definition of done** where handoffs happen.`,
      },
      {
        id: "mod-team-2",
        title: "Inclusive meetings",
        description: "Agendas, notes, and space for quieter voices.",
        order: 2,
        category: "Facilitation",
        estimatedMinutes: 18,
        videoUrl: yt(14),
        content: `![Meeting](${IMG.meeting})

# Better meetings

- Agenda published **24h** early
- **Round-robin** input on contentious topics
- Notes with decisions + owners in the same thread`,
      },
      {
        id: "mod-team-3",
        title: "Trust after mistakes",
        description: "Blameless postmortems and learning culture.",
        order: 3,
        category: "Culture",
        estimatedMinutes: 22,
        videoUrl: yt(15),
        content: `![Handshake](${IMG.handshake})

# Blameless retrospectives

Focus on **systems**: what allowed the error? What guardrails do we add?

Celebrate people who surface problems early.`,
      },
    ],
    questions: [
      {
        id: "q-team-1",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "In RACI, who ultimately owns the outcome?",
        tags: ["raci"],
        options: [
          { id: "a", text: "Accountable", isCorrect: true },
          { id: "b", text: "Consulted", isCorrect: false },
          { id: "c", text: "Informed", isCorrect: false },
          { id: "d", text: "Everyone equally without a name", isCorrect: false },
        ],
        correctAnswer: "a",
      },
      {
        id: "q-team-2",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "Psychological safety means everyone always agrees.",
        explanation: "Safety supports respectful disagreement and learning.",
        tags: ["trust"],
        options: [
          { id: "t", text: "True", isCorrect: false },
          { id: "f", text: "False", isCorrect: true },
        ],
        correctAnswer: "f",
      },
      {
        id: "q-team-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "A blameless postmortem primarily focuses on:",
        tags: ["retro"],
        options: [
          { id: "a", text: "Who to punish", isCorrect: false },
          { id: "b", text: "System factors and preventive actions", isCorrect: true },
          { id: "c", text: "Avoiding documentation", isCorrect: false },
          { id: "d", text: "Increasing secrecy", isCorrect: false },
        ],
        correctAnswer: "b",
      },
    ],
    assessments: [
      {
        id: "asm-team-1",
        title: "Teamwork essentials",
        description: "Single assessment covering all modules.",
        timeLimit: 15,
        passingScore: 70,
        questionIds: ["q-team-1", "q-team-2", "q-team-3"],
      },
    ],
  },

  {
    id: "course-ergonomics-safety",
    title: "Ergonomics & Injury Prevention",
    description:
      "Set up workstations, recognize MSD risks, and apply controls for desk and light industrial tasks.",
    imageUrl: IMG.ergonomics,
    modules: [
      {
        id: "mod-ergo-1",
        title: "Neutral posture basics",
        description: "Monitor, chair, keyboard, and mouse alignment.",
        order: 1,
        category: "Office",
        estimatedMinutes: 22,
        videoUrl: yt(16),
        content: `![Stretch](${IMG.ergonomics})

# Neutral posture

- Ears over shoulders over hips
- **Elbows ~90°**, wrists neutral
- **Top third** of monitor at eye level`,
      },
      {
        id: "mod-ergo-2",
        title: "Movement and micro-breaks",
        description: "Combat static loading with pacing.",
        order: 2,
        category: "Movement",
        estimatedMinutes: 18,
        videoUrl: yt(17),
        content: `![Office walk](${IMG.office})

# The 20-20-20 rule (screen work)

Every **20 minutes**, look **20 feet** away for **20 seconds**.

Add **2-minute** stand/stretch breaks between long meetings.`,
      },
      {
        id: "mod-ergo-3",
        title: "Manual handling intro",
        description: "Power zone, foot position, team lifts.",
        order: 3,
        category: "Materials",
        estimatedMinutes: 24,
        videoUrl: yt(18),
        content: `![Warehouse](${IMG.warehouse})

# Lifting principles

- **Plan** the path; remove obstacles
- **Get close** to the load; avoid twisting
- **Team lift** when weight or bulk exceeds safe solo limits`,
      },
      {
        id: "mod-ergo-4",
        title: "Early discomfort reporting",
        description: "When to escalate and job accommodation ideas.",
        order: 4,
        category: "Health",
        estimatedMinutes: 16,
        videoUrl: yt(19),
        content: `![Wellbeing](${IMG.ergonomics})

# Early reporting

RSIs are easier to reverse **early**. Partner with occupational health for adjustments—keyboard trays, sit-stand desks, task rotation.`,
      },
    ],
    questions: [
      {
        id: "q-ergo-1",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "Monitor height should generally place:",
        tags: ["posture"],
        options: [
          { id: "a", text: "Top of screen at or slightly below eye level", isCorrect: true },
          { id: "b", text: "Screen on the floor", isCorrect: false },
          { id: "c", text: "Screen only visible from standing height", isCorrect: false },
          { id: "d", text: "Brightness is the only concern", isCorrect: false },
        ],
        correctAnswer: "a",
      },
      {
        id: "q-ergo-2",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "Micro-breaks can reduce cumulative strain from static postures.",
        tags: ["breaks"],
        options: [
          { id: "t", text: "True", isCorrect: true },
          { id: "f", text: "False", isCorrect: false },
        ],
        correctAnswer: "t",
      },
      {
        id: "q-ergo-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "When lifting a moderate box alone, you should:",
        tags: ["lifting"],
        options: [
          { id: "a", text: "Twist at the waist while holding the load away from the body", isCorrect: false },
          { id: "b", text: "Keep the load close, bend knees, avoid twisting", isCorrect: true },
          { id: "c", text: "Lift quickly without planning the path", isCorrect: false },
          { id: "d", text: "Use one hand to impress coworkers", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-ergo-4",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Persistent numbness in fingers during keyboard work should be:",
        tags: ["reporting"],
        options: [
          { id: "a", text: "Ignored until it becomes severe", isCorrect: false },
          { id: "b", text: "Reported early so accommodations can be explored", isCorrect: true },
          { id: "c", text: "Only discussed informally with peers", isCorrect: false },
          { id: "d", text: "Treated only with louder music", isCorrect: false },
        ],
        correctAnswer: "b",
      },
    ],
    assessments: [
      {
        id: "asm-ergo-1",
        title: "Ergonomics checkpoint",
        description: "Posture, breaks, and lifting.",
        timeLimit: 14,
        passingScore: 70,
        questionIds: ["q-ergo-1", "q-ergo-2", "q-ergo-3"],
      },
      {
        id: "asm-ergo-2",
        title: "Discomfort & controls",
        description: "Reporting and prevention mindset.",
        timeLimit: 10,
        passingScore: 70,
        questionIds: ["q-ergo-4"],
      },
    ],
  },

  {
    id: "course-server-hardware",
    title: "Server Hardware & Data Center Basics",
    description:
      "Form factors, power/cooling, storage interfaces, rack mounting, and hardware failure signals for IT staff.",
    imageUrl: IMG.datacenter,
    modules: [
      {
        id: "mod-srv-1",
        title: "Server form factors",
        description: "Tower, rack, blade; U heights and common chassis sizes.",
        order: 1,
        category: "Hardware",
        estimatedMinutes: 22,
        videoUrl: yt(20),
        content: `## Rack units and planning

In a data center or wiring closet, **rack height** is measured in **U** (units). One **U** equals **1.75 inches** (44.45 mm) of vertical mounting space inside the rack frame.

> **Before you mount anything:** confirm **depth**, **weight capacity**, **power** (circuits / PDUs), **network** drops, and **KVM or serial** access—changing your mind after rails are in is expensive.

### Typical form factors

- **1U–2U** — Most common for **pizza-box** servers, switches, and shallow appliances.
- **4U+** — Often used for **storage shelves**, **GPU-heavy** nodes, or gear that needs extra airflow.
- **Tower vs rack** — Tower servers may use a **conversion kit** or sit on a shelf; prefer **native rack** chassis when you can for cable and cooling discipline.

![Modern data hall — hot/cold aisle layout](${IMG.datacenter})

### What to verify on the rails

1. **Rail kit** matches the **chassis vendor** (or verified third-party) and **rack depth**.
2. **Ear** or **center-mount** style matches your cabinet (two-post vs four-post).
3. **Service clearance**: can you **remove the lid**, swap **drives**, and reach **power supplies** without unloading the whole stack?

![Rails and servers in a cabinet](${IMG.serverRack})

### Quick checklist

| Before install | Why it matters |
|----------------|----------------|
| Label **asset & circuit** | Faster triage when a PDU trips |
| Route **network & power** on opposite sides | Cleaner airflow and fewer accidental pulls |
| Leave **1U gap** where policy allows | Easier service and thermal buffer |

*The video above is an illustrative walkthrough; always follow your site’s **facility standards** and **change control** process.*`,
      },
      {
        id: "mod-srv-2",
        title: "CPU, RAM, and mainboard",
        description: "Sockets, channels, ECC, and DIMM population rules of thumb.",
        order: 2,
        category: "Compute",
        estimatedMinutes: 26,
        videoUrl: yt(21),
        content: `![Hardware](${IMG.serverRack})

# Memory

- Match **rank/speed** per vendor guidance
- **ECC** for data integrity on servers
- Balance channels for bandwidth`,
      },
      {
        id: "mod-srv-3",
        title: "Storage interfaces",
        description: "SATA, SAS, NVMe U.2; RAID concepts at a high level.",
        order: 3,
        category: "Storage",
        estimatedMinutes: 24,
        videoUrl: yt(22),
        content: `![Storage](${IMG.datacenter})

# Interfaces

**NVMe** reduces latency vs SATA/SAS for hot data. Understand **hot-swap** carriers and **LED fault** indicators.`,
      },
      {
        id: "mod-srv-4",
        title: "Power, cooling, and redundancy",
        description: "PSUs, rails, airflow, and PDU basics.",
        order: 4,
        category: "Facility",
        estimatedMinutes: 22,
        videoUrl: yt(23),
        content: `![Cooling](${IMG.datacenter})

# Redundancy

**N+1** cooling, **dual PSUs**, **A/B power** feeds in Tier designs. Label **circuit IDs** at the rack.`,
      },
      {
        id: "mod-srv-5",
        title: "Remote management (out-of-band)",
        description: "BMC/iDRAC/iLO concepts—power cycle without a truck roll.",
        order: 5,
        category: "Operations",
        estimatedMinutes: 20,
        videoUrl: yt(24),
        content: `![Lights-out management](${IMG.serverRack})

# BMC

Use **out-of-band** for **power control, sensors, and remote ISO mounts**—but lock down management networks.`,
      },
    ],
    questions: [
      {
        id: "q-srv-1",
        type: "MULTIPLE_CHOICE",
        difficulty: "EASY",
        points: 1,
        stem: "In rack mounting, 2U equipment occupies roughly:",
        tags: ["rack"],
        options: [
          { id: "a", text: "1.75 inches of vertical space", isCorrect: false },
          { id: "b", text: "3.5 inches of vertical space", isCorrect: true },
          { id: "c", text: "19 inches depth only", isCorrect: false },
          { id: "d", text: "Zero space—U is weight only", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-srv-2",
        type: "TRUE_FALSE",
        difficulty: "EASY",
        points: 1,
        stem: "ECC memory can detect/correct some single-bit memory errors common in servers.",
        tags: ["memory"],
        options: [
          { id: "t", text: "True", isCorrect: true },
          { id: "f", text: "False", isCorrect: false },
        ],
        correctAnswer: "t",
      },
      {
        id: "q-srv-3",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Which interface typically offers the lowest latency for local SSDs in modern servers?",
        tags: ["storage"],
        options: [
          { id: "a", text: "NVMe over PCIe", isCorrect: true },
          { id: "b", text: "USB 2.0", isCorrect: false },
          { id: "c", text: "Parallel ATA", isCorrect: false },
          { id: "d", text: "Floppy disk", isCorrect: false },
        ],
        correctAnswer: "a",
      },
      {
        id: "q-srv-4",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "Dual redundant power supplies primarily improve:",
        tags: ["power"],
        options: [
          { id: "a", text: "CPU clock speed automatically", isCorrect: false },
          { id: "b", text: "Availability when one PSU or feed fails", isCorrect: true },
          { id: "c", text: "Wireless throughput", isCorrect: false },
          { id: "d", text: "Monitor refresh rate", isCorrect: false },
        ],
        correctAnswer: "b",
      },
      {
        id: "q-srv-5",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        points: 2,
        stem: "A Baseboard Management Controller (BMC) is most associated with:",
        tags: ["bmc"],
        options: [
          { id: "a", text: "Out-of-band management (power, sensors, remote console)", isCorrect: true },
          { id: "b", text: "Only GPU rendering", isCorrect: false },
          { id: "c", text: "Customer Wi-Fi marketing", isCorrect: false },
          { id: "d", text: "Printer toner levels", isCorrect: false },
        ],
        correctAnswer: "a",
      },
    ],
    assessments: [
      {
        id: "asm-srv-1",
        title: "Hardware foundations quiz",
        description: "Form factors, memory, storage.",
        timeLimit: 14,
        passingScore: 70,
        questionIds: ["q-srv-1", "q-srv-2", "q-srv-3"],
      },
      {
        id: "asm-srv-2",
        title: "Power & operations quiz",
        description: "Redundancy and remote management.",
        timeLimit: 12,
        passingScore: 70,
        questionIds: ["q-srv-4", "q-srv-5"],
      },
    ],
  },
];

async function upsertQuestion(
  db: PrismaClient,
  instructorId: string,
  courseId: string,
  q: Q
) {
  await db.question.upsert({
    where: { id: q.id },
    update: {},
    create: {
      id: q.id,
      authorId: instructorId,
      courseId,
      type: q.type,
      difficulty: q.difficulty,
      points: q.points,
      stem: q.stem,
      explanation: q.explanation,
      tags: q.tags,
      options: (q.options ?? undefined) as Prisma.InputJsonValue | undefined,
      correctAnswer: q.correctAnswer,
    },
  });
}

async function linkAssessment(db: PrismaClient, courseId: string, a: Asm) {
  await db.assessment.upsert({
    where: { id: a.id },
    update: {},
    create: {
      id: a.id,
      courseId: courseId,
      title: a.title,
      description: a.description,
      type: "QUIZ",
      timeLimit: a.timeLimit,
      maxAttempts: 3,
      passingScore: a.passingScore,
      shuffleQuestions: true,
      shuffleOptions: true,
      showFeedback: true,
    },
  });

  for (let i = 0; i < a.questionIds.length; i++) {
    const qid = a.questionIds[i];
    await db.assessmentQuestion.upsert({
      where: { assessmentId_questionId: { assessmentId: a.id, questionId: qid } },
      update: { order: i, isPinned: true },
      create: {
        assessmentId: a.id,
        questionId: qid,
        order: i,
        isPinned: true,
      },
    });
  }
}

export async function seedCatalogCourses(
  db: PrismaClient,
  instructorId: string,
  studentIds: string[]
) {
  for (const spec of catalog) {
    await db.course.upsert({
      where: { id: spec.id },
      update: {
        title: spec.title,
        description: spec.description,
        imageUrl: spec.imageUrl,
        status: "PUBLISHED",
        instructorId,
      },
      create: {
        id: spec.id,
        title: spec.title,
        description: spec.description,
        imageUrl: spec.imageUrl,
        status: "PUBLISHED",
        instructorId,
      },
    });

    for (const m of spec.modules) {
      await db.module.upsert({
        where: { id: m.id },
        update: {
          title: m.title,
          description: m.description,
          order: m.order,
          content: m.content,
          videoUrl: m.videoUrl,
          category: m.category,
          estimatedMinutes: m.estimatedMinutes,
          courseId: spec.id,
        },
        create: {
          id: m.id,
          courseId: spec.id,
          title: m.title,
          description: m.description,
          order: m.order,
          content: m.content,
          videoUrl: m.videoUrl,
          category: m.category,
          estimatedMinutes: m.estimatedMinutes,
        },
      });
    }

    for (const q of spec.questions) {
      await upsertQuestion(db, instructorId, spec.id, q);
    }

    for (const a of spec.assessments) {
      await linkAssessment(db, spec.id, a);
    }

    for (const sid of studentIds) {
      await db.enrollment.upsert({
        where: { userId_courseId: { userId: sid, courseId: spec.id } },
        update: {},
        create: { userId: sid, courseId: spec.id, status: "ACTIVE" },
      });
    }
  }

  console.log(`✓ Catalog: ${catalog.length} courses (soft skills, safety, 6S, ergonomics, server hardware)`);
}

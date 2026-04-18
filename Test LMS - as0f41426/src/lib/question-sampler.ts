import { db } from "@/lib/db";

const QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "FILL_IN_BLANK",
  "SEQUENCE",
] as const;

const DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export type PoolRule = {
  tags?: string[];
  difficulty?: DifficultyLevel;
  type?: QuestionType;
  count: number;
};

export type QuestionSnapshot = {
  questionId: string;
  order: number;
  optionOrder?: string[];
};

/** Fisher-Yates shuffle */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseTags(tags: string | null | undefined) {
  const parsed = parseJson<unknown>(tags, []);
  return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === "string") : [];
}

function parseOptions(options: string | null | undefined) {
  const parsed = parseJson<unknown>(options, null);
  return Array.isArray(parsed) ? (parsed as Array<{ id: string }>) : null;
}

/**
 * Samples questions for an assessment attempt.
 * Returns a snapshot (questionId + shuffled option order) to be stored on the Attempt.
 */
export async function sampleQuestions(
  courseId: string | null,
  poolConfig: PoolRule[],
  pinnedQuestionIds: string[],
  shuffleOptions: boolean
): Promise<QuestionSnapshot[]> {
  const usedIds = new Set<string>(pinnedQuestionIds);
  const sampledIds: string[] = [...pinnedQuestionIds];

  for (const rule of poolConfig) {
    const candidates = await db.question.findMany({
      where: {
        ...(courseId ? { courseId } : {}),
        ...(rule.difficulty ? { difficulty: rule.difficulty } : {}),
        ...(rule.type ? { type: rule.type } : {}),
        id: { notIn: [...usedIds] },
      },
      select: { id: true, options: true, tags: true },
    });

    const filteredCandidates = rule.tags?.length
      ? candidates.filter((candidate) => rule.tags!.some((tag) => parseTags(candidate.tags).includes(tag)))
      : candidates;

    const picked = shuffle(filteredCandidates).slice(0, rule.count);
    for (const q of picked) {
      if (!usedIds.has(q.id)) {
        usedIds.add(q.id);
        sampledIds.push(q.id);
      }
    }
  }

  // Fetch options for all questions to build snapshot
  const questions = await db.question.findMany({
    where: { id: { in: sampledIds } },
    select: { id: true, options: true },
  });

  const questionsById = new Map(questions.map((q) => [q.id, q]));

  const ordered = shuffleOptions
    ? shuffle(sampledIds)
    : sampledIds;

  return ordered.map((questionId, idx) => {
    const q = questionsById.get(questionId);
    let optionOrder: string[] | undefined;

    const opts = parseOptions(q?.options);

    if (opts?.length) {
      optionOrder = shuffleOptions
        ? shuffle(opts.map((o) => o.id))
        : opts.map((o) => o.id);
    }

    return { questionId, order: idx, optionOrder };
  });
}

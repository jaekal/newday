export type QuestionOption = { id: string; text: string; isCorrect: boolean };
type QuestionType =
  | "MULTIPLE_CHOICE"
  | "MULTI_SELECT"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "ESSAY"
  | "FILL_IN_BLANK"
  | "SEQUENCE";

type GradingQuestion = {
  id: string;
  type: string;
  options: string | null;
  correctAnswer: string | null;
  points: number;
};

export type AttemptAnswer = {
  selected?: string[];  // option ids for MC, MS, TF
  text?: string;        // for SHORT_ANSWER, ESSAY, FILL_IN_BLANK
  ordered?: string[];   // option ids for SEQUENCE
};

export type GradingResult = {
  isCorrect: boolean;
  pointsEarned: number;
};

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Auto-grades a single question response.
 * Returns null for question types requiring manual grading (SHORT_ANSWER, ESSAY).
 */
export function autoGradeResponse(
  question: GradingQuestion,
  answer: AttemptAnswer
): GradingResult | null {
  const type = question.type as QuestionType;
  const options = parseJson<QuestionOption[] | null>(question.options, null);
  const { correctAnswer, points } = question;

  switch (type) {
    case "MULTIPLE_CHOICE":
    case "TRUE_FALSE": {
      if (!options?.length) return null;
      const correct = options.find((o) => o.isCorrect);
      if (!correct) return null;
      const selected = answer.selected?.[0];
      const isCorrect = selected === correct.id;
      return { isCorrect, pointsEarned: isCorrect ? points : 0 };
    }

    case "MULTI_SELECT": {
      if (!options?.length) return null;
      const correctIds = new Set(options.filter((o) => o.isCorrect).map((o) => o.id));
      const selectedIds = new Set(answer.selected ?? []);

      // All correct must be selected, no incorrect selected
      const allCorrectSelected = [...correctIds].every((id) => selectedIds.has(id));
      const noIncorrectSelected = [...selectedIds].every((id) => correctIds.has(id));
      const isCorrect = allCorrectSelected && noIncorrectSelected;

      // Partial credit: points * (correct selected - wrong selected) / total correct
      if (isCorrect) {
        return { isCorrect: true, pointsEarned: points };
      }

      const correctHits = [...selectedIds].filter((id) => correctIds.has(id)).length;
      const wrongHits = [...selectedIds].filter((id) => !correctIds.has(id)).length;
      const partial = correctIds.size > 0 ? Math.max(0, correctHits - wrongHits) / correctIds.size : 0;
      return { isCorrect: false, pointsEarned: Math.round(points * partial * 100) / 100 };
    }

    case "FILL_IN_BLANK": {
      if (!correctAnswer) return null;
      const normalized = (s: string) => s.trim().toLowerCase();
      const isCorrect =
        normalized(answer.text ?? "") === normalized(correctAnswer);
      return { isCorrect, pointsEarned: isCorrect ? points : 0 };
    }

    case "SEQUENCE": {
      if (!options?.length || !correctAnswer) return null;

      const parsed = parseJson<unknown>(correctAnswer, []);
      if (!Array.isArray(parsed)) return null;

      const expectedOrder = parsed.filter((value): value is string => typeof value === "string");
      const submittedOrder = answer.ordered ?? [];
      const isCorrect =
        expectedOrder.length === submittedOrder.length &&
        expectedOrder.every((id, index) => submittedOrder[index] === id);

      return { isCorrect, pointsEarned: isCorrect ? points : 0 };
    }

    // Manual grading required
    case "SHORT_ANSWER":
    case "ESSAY":
      return null;

    default:
      return null;
  }
}

/**
 * Grades all auto-gradable responses in an attempt.
 * Returns per-response results plus totals.
 */
export function gradeAttempt(
  questions: GradingQuestion[],
  answers: Map<string, AttemptAnswer>
): {
  results: Map<string, GradingResult | null>;
  autoScore: number;
  autoMaxScore: number;
  needsManualGrading: boolean;
} {
  const results = new Map<string, GradingResult | null>();
  let autoScore = 0;
  let autoMaxScore = 0;
  let needsManualGrading = false;

  for (const q of questions) {
    const answer = answers.get(q.id) ?? {};
    const result = autoGradeResponse(q, answer);
    results.set(q.id, result);

    if (result === null) {
      needsManualGrading = true;
    } else {
      autoScore += result.pointsEarned;
      autoMaxScore += q.points;
    }
  }

  return { results, autoScore, autoMaxScore, needsManualGrading };
}

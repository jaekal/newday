export const QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "FILL_IN_BLANK",
  "SEQUENCE",
] as const;

export const DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];
export type DifficultyLevel = (typeof DIFFICULTY_LEVELS)[number];

export type QuestionOption = { id: string; text: string; imageUrl?: string; isCorrect?: boolean };

export const TYPE_LABEL: Record<QuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple Choice",
  MULTI_SELECT: "Multi Select",
  TRUE_FALSE: "True / False",
  SHORT_ANSWER: "Short Answer",
  ESSAY: "Essay",
  FILL_IN_BLANK: "Fill in Blank",
  SEQUENCE: "Sequence",
};

export const DIFF_COLOR = { EASY: "success", MEDIUM: "warning", HARD: "destructive" } as const;

export function parseCorrectAnswerValue(correctAnswer: string | null | undefined) {
  if (!correctAnswer) return null;

  try {
    return JSON.parse(correctAnswer) as unknown;
  } catch {
    return correctAnswer;
  }
}

export function getQuestionCorrectAnswerText(question: {
  type: QuestionType;
  options?: QuestionOption[] | null;
  correctAnswer?: string | null;
}) {
  if (question.type === "MULTIPLE_CHOICE" || question.type === "TRUE_FALSE") {
    const correct = question.options?.find((option) => option.isCorrect);
    return correct?.text ?? null;
  }

  if (question.type === "MULTI_SELECT") {
    const answers = question.options?.filter((option) => option.isCorrect).map((option) => option.text) ?? [];
    return answers.length ? answers.join(", ") : null;
  }

  if (question.type === "SEQUENCE") {
    const parsed = parseCorrectAnswerValue(question.correctAnswer);
    if (!Array.isArray(parsed) || !question.options?.length) return null;

    const order = new Map(question.options.map((option) => [option.id, option.text]));
    const ordered = parsed
      .map((id) => (typeof id === "string" ? order.get(id) : null))
      .filter((value): value is string => typeof value === "string" && value.length > 0);

    return ordered.length ? ordered.join(" -> ") : null;
  }

  if (question.type === "FILL_IN_BLANK") {
    return question.correctAnswer ?? null;
  }

  return null;
}

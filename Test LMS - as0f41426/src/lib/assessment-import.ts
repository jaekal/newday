export const IMPORT_ASSESSMENT_TYPES = ["QUIZ", "EXAM", "PRACTICE"] as const;
export const IMPORT_QUESTION_TYPES = [
  "MULTIPLE_CHOICE",
  "MULTI_SELECT",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "ESSAY",
  "FILL_IN_BLANK",
] as const;
export const IMPORT_DIFFICULTY_LEVELS = ["EASY", "MEDIUM", "HARD"] as const;

export type ImportedAssessmentType = (typeof IMPORT_ASSESSMENT_TYPES)[number];
export type ImportedQuestionType = (typeof IMPORT_QUESTION_TYPES)[number];
export type ImportedDifficultyLevel = (typeof IMPORT_DIFFICULTY_LEVELS)[number];

export type ImportedQuestionDraft = {
  stem: string;
  type: ImportedQuestionType;
  difficulty: ImportedDifficultyLevel;
  points: number;
  explanation?: string;
  tags: string[];
  options?: Array<{ id: string; text: string; isCorrect: boolean }>;
  correctAnswer?: string;
};

export type ImportedAssessmentDraft = {
  title: string;
  description?: string;
  type: ImportedAssessmentType;
  questions: ImportedQuestionDraft[];
};

type SpreadsheetRow = Record<string, unknown>;
const MIN_IMPORT_STEM_LENGTH = 5;
const IMPORT_NOISE_PATTERNS = [
  /this form will record your name/i,
  /this content is neither created nor endorsed by microsoft/i,
  /^microsoft forms$/i,
  /^general test procedures$/i,
];

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function makeOptionId(index: number) {
  return `opt_${index + 1}`;
}

function toTitleCase(value: string) {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function fileNameToTitle(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return toTitleCase(base || "Imported Assessment");
}

export function coerceAssessmentType(value: string | undefined): ImportedAssessmentType {
  const normalized = cleanText(value).toUpperCase();
  if (normalized === "EXAM" || normalized === "PRACTICE") return normalized;
  return "QUIZ";
}

export function coerceQuestionType(value: string | undefined, optionsCount: number, correctCount: number): ImportedQuestionType {
  const normalized = cleanText(value).toUpperCase().replace(/\s+/g, "_");

  if (IMPORT_QUESTION_TYPES.includes(normalized as ImportedQuestionType)) {
    return normalized as ImportedQuestionType;
  }

  if (optionsCount === 2) {
    return "TRUE_FALSE";
  }
  if (optionsCount > 0 && correctCount > 1) {
    return "MULTI_SELECT";
  }
  if (optionsCount > 0) {
    return "MULTIPLE_CHOICE";
  }

  return normalized.includes("ESSAY") ? "ESSAY" : "SHORT_ANSWER";
}

export function coerceDifficulty(value: string | undefined): ImportedDifficultyLevel {
  const normalized = cleanText(value).toUpperCase();
  if (normalized === "EASY" || normalized === "HARD") return normalized;
  return "MEDIUM";
}

export function parseTagList(value: string | undefined) {
  return cleanText(value)
    .split(/[|,;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeCorrectToken(value: string) {
  return value.trim().toUpperCase().replace(/[.)]/g, "");
}

function isImportNoise(value: string) {
  return IMPORT_NOISE_PATTERNS.some((pattern) => pattern.test(value));
}

function cleanImportedLine(value: string) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function normalizeImportedQuestion(question: ImportedQuestionDraft): ImportedQuestionDraft | null {
  let stem = cleanImportedLine(question.stem);
  let options = question.options
    ?.map((option) => ({
      ...option,
      text: cleanImportedLine(option.text),
    }))
    .filter((option) => option.text && !isImportNoise(option.text));

  if (options?.length) {
    const lastOption = options[options.length - 1]?.text ?? "";
    const stemNeedsHelp =
      stem.length < MIN_IMPORT_STEM_LENGTH ||
      (/^[a-z]/.test(stem) && stem.length < 40);

    const lastOptionLooksLikePrompt =
      lastOption.length >= MIN_IMPORT_STEM_LENGTH &&
      (/[?]$/.test(lastOption) || lastOption.split(" ").length >= 6);

    if (stemNeedsHelp && lastOptionLooksLikePrompt) {
      stem = stem ? `${lastOption} ${stem}` : lastOption;
      options = options.slice(0, -1);
    }
  }

  stem = stem.replace(/\s+/g, " ").trim();
  if (isImportNoise(stem) || stem.length < MIN_IMPORT_STEM_LENGTH) {
    return null;
  }

  const dedupedOptions = options?.filter(
    (option, index, all) =>
      option.text.toLowerCase() !== stem.toLowerCase() &&
      all.findIndex((candidate) => candidate.text.toLowerCase() === option.text.toLowerCase()) === index
  );

  return {
    ...question,
    stem,
    options: dedupedOptions?.length ? dedupedOptions : undefined,
    correctAnswer: question.correctAnswer ? cleanImportedLine(question.correctAnswer) : undefined,
  };
}

function finalizeImportedAssessments(assessments: ImportedAssessmentDraft[]) {
  return assessments
    .map((assessment) => ({
      ...assessment,
      questions: assessment.questions
        .map((question) => normalizeImportedQuestion(question))
        .filter((question): question is ImportedQuestionDraft => question !== null),
    }))
    .filter((assessment) => assessment.questions.length > 0);
}

export function buildOptionsFromDelimited(optionsValue: string | undefined, correctAnswerValue: string | undefined) {
  const items = cleanText(optionsValue)
    .split(/\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!items.length) return undefined;

  const correctTokens = cleanText(correctAnswerValue)
    .split(/[|,;/]/)
    .map(normalizeCorrectToken)
    .filter(Boolean);

  return items.map((item, index) => {
    const optionId = makeOptionId(index);
    const letter = String.fromCharCode(65 + index);
    const isMarkedCorrect = item.startsWith("*");
    const cleaned = item.replace(/^\*/, "").replace(/\(correct\)$/i, "").trim();

    return {
      id: optionId,
      text: cleaned,
      isCorrect:
        isMarkedCorrect ||
        correctTokens.includes(letter) ||
        correctTokens.includes(optionId.toUpperCase()) ||
        correctTokens.includes(cleaned.toUpperCase()),
    };
  });
}

export function buildOptionsFromColumns(row: SpreadsheetRow, correctAnswerValue: string | undefined) {
  const optionColumns = Object.keys(row)
    .filter((key) => /^option[\s_-]*[a-z0-9]+$/i.test(key))
    .sort();

  if (!optionColumns.length) return undefined;

  const correctTokens = cleanText(correctAnswerValue)
    .split(/[|,;/]/)
    .map(normalizeCorrectToken)
    .filter(Boolean);

  const options = optionColumns
    .map((column, index) => {
      const text = cleanText(row[column]);
      if (!text) return null;

      const optionId = makeOptionId(index);
      const letter = column.match(/[a-z0-9]+$/i)?.[0]?.toUpperCase() ?? String.fromCharCode(65 + index);

      return {
        id: optionId,
        text,
        isCorrect:
          correctTokens.includes(letter) ||
          correctTokens.includes(optionId.toUpperCase()) ||
          correctTokens.includes(text.toUpperCase()),
      };
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));

  return options.length ? options : undefined;
}

function getRowValue(row: SpreadsheetRow, ...keys: string[]) {
  const entry = Object.keys(row).find((key) => keys.includes(key.toLowerCase().trim()));
  return entry ? cleanText(row[entry]) : "";
}

export function parseSpreadsheetRows(rows: SpreadsheetRow[], sourceName: string) {
  const grouped = new Map<string, ImportedAssessmentDraft>();

  for (const row of rows) {
    const title = getRowValue(row, "assessment", "assessment title", "quiz", "quiz title") || fileNameToTitle(sourceName);
    const description = getRowValue(row, "assessment description", "description");
    const stem = getRowValue(row, "question", "stem", "prompt");
    if (!stem) continue;

    const correctAnswer = getRowValue(row, "correct answer", "answer", "correct");
    const options =
      buildOptionsFromColumns(row, correctAnswer) ??
      buildOptionsFromDelimited(getRowValue(row, "options", "choices"), correctAnswer);

    const correctCount = options?.filter((option) => option.isCorrect).length ?? 0;
    const questionType = coerceQuestionType(getRowValue(row, "type", "question type"), options?.length ?? 0, correctCount);

    const question: ImportedQuestionDraft = {
      stem,
      type: questionType,
      difficulty: coerceDifficulty(getRowValue(row, "difficulty", "level")),
      points: Number.parseFloat(getRowValue(row, "points", "score")) || 1,
      explanation: getRowValue(row, "explanation", "rationale") || undefined,
      tags: parseTagList(getRowValue(row, "tags", "tag")),
      options,
      correctAnswer: options?.length ? undefined : correctAnswer || undefined,
    };

    if (!grouped.has(title)) {
      grouped.set(title, {
        title,
        description: description || undefined,
        type: coerceAssessmentType(getRowValue(row, "assessment type", "quiz type", "type")),
        questions: [],
      });
    }

    grouped.get(title)?.questions.push(question);
  }

  return finalizeImportedAssessments([...grouped.values()]);
}

export function parsePlainTextAssessment(text: string, sourceName: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return [] as ImportedAssessmentDraft[];

  const questionStart = /^\d+[\).\s-]+/;
  const optionLine = /^[A-H][\).:\-]\s+/i;
  const answerLine = /^(answer|correct answer)\s*[:\-]\s*/i;
  const explanationLine = /^(explanation|rationale)\s*[:\-]\s*/i;
  const tagLine = /^tags?\s*[:\-]\s*/i;

  const title = questionStart.test(lines[0]) ? fileNameToTitle(sourceName) : lines[0];
  const contentLines = questionStart.test(lines[0]) ? lines : lines.slice(1);

  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of contentLines) {
    if (questionStart.test(line) && current.length) {
      blocks.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length) blocks.push(current);

  const questions = blocks
    .map((block) => {
      const [firstLine, ...rest] = block;
      const stem = firstLine.replace(questionStart, "").trim();
      const options: Array<{ id: string; text: string; isCorrect: boolean }> = [];
      let answerText = "";
      let explanation = "";
      let tags: string[] = [];

      for (const line of rest) {
        if (optionLine.test(line)) {
          const textValue = line.replace(optionLine, "").trim();
          options.push({ id: makeOptionId(options.length), text: textValue, isCorrect: false });
          continue;
        }
        if (answerLine.test(line)) {
          answerText = line.replace(answerLine, "").trim();
          continue;
        }
        if (explanationLine.test(line)) {
          explanation = line.replace(explanationLine, "").trim();
          continue;
        }
        if (tagLine.test(line)) {
          tags = parseTagList(line.replace(tagLine, ""));
        }
      }

      const correctTokens = answerText
        .split(/[|,;/]/)
        .map(normalizeCorrectToken)
        .filter(Boolean);

      const normalizedOptions = options.length
        ? options.map((option, index) => ({
            ...option,
            isCorrect:
              correctTokens.includes(String.fromCharCode(65 + index)) ||
              correctTokens.includes(option.text.toUpperCase()),
          }))
        : undefined;

      const correctCount = normalizedOptions?.filter((option) => option.isCorrect).length ?? 0;

      return {
        stem,
        type: coerceQuestionType("", normalizedOptions?.length ?? 0, correctCount),
        difficulty: "MEDIUM" as ImportedDifficultyLevel,
        points: 1,
        explanation: explanation || undefined,
        tags,
        options: normalizedOptions,
        correctAnswer: normalizedOptions?.length ? undefined : answerText || undefined,
      } satisfies ImportedQuestionDraft;
    })
    .filter((question) => question.stem);

  return finalizeImportedAssessments(questions.length
    ? [
        {
          title,
          type: "QUIZ" as ImportedAssessmentType,
          questions,
        },
      ]
    : []);
}

export function parseMicrosoftFormsAssessment(text: string, sourceName: string) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//i.test(line))
    .filter((line) => !/^\d{1,2}\/\d{1,2}\/\d{2},/i.test(line))
    .filter((line) => !/^-- \d+ of \d+ --$/.test(line))
    .filter((line) => !/^\d+\/\d+$/.test(line));

  if (!lines.length) return [] as ImportedAssessmentDraft[];

  const title = lines.find((line) => /Technician Assessment Test/i.test(line)) ?? fileNameToTitle(sourceName);
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^\d+$/.test(line) && current.length) {
      blocks.push(current);
      current = [];
      continue;
    }

    current.push(line);
  }

  if (current.length) {
    blocks.push(current);
  }

  const questions = blocks
    .map((block) => {
      const pointIndex = block.findIndex((line) => /\(\d+(\.\d+)? Point/.test(line));
      if (pointIndex === -1) return null;

      const stem = block[pointIndex].replace(/\(\d+(\.\d+)? Points?\)/i, "").trim();
      const optionLines = block
        .slice(0, pointIndex)
        .filter((line) => line !== "*")
        .filter((line) => !isImportNoise(line));
      const trailingLines = block.slice(pointIndex + 1);
      const answerLine = trailingLines.find((line) => /^(answer|correct answer)\s*[:\-]/i.test(line));
      const explanationLine = trailingLines.find((line) => /^(explanation|rationale)\s*[:\-]/i.test(line));

      const options = optionLines.length
        ? optionLines.map((option, index) => ({
            id: makeOptionId(index),
            text: option,
            isCorrect: false,
          }))
        : undefined;

      const answerText = answerLine?.replace(/^(answer|correct answer)\s*[:\-]\s*/i, "").trim() ?? "";
      const normalizedOptions = options?.map((option, index) => ({
        ...option,
        isCorrect:
          normalizeCorrectToken(answerText) === String.fromCharCode(65 + index) ||
          normalizeCorrectToken(answerText) === option.text.toUpperCase(),
      }));

      const correctCount = normalizedOptions?.filter((option) => option.isCorrect).length ?? 0;

      const question: ImportedQuestionDraft = {
        stem,
        type: coerceQuestionType("", normalizedOptions?.length ?? 0, correctCount),
        difficulty: "MEDIUM" as ImportedDifficultyLevel,
        points: Number.parseFloat(block[pointIndex].match(/\((\d+(?:\.\d+)?) Point/)?.[1] ?? "1") || 1,
        explanation: explanationLine?.replace(/^(explanation|rationale)\s*[:\-]\s*/i, "").trim() || undefined,
        tags: [],
        options: normalizedOptions,
        correctAnswer: normalizedOptions?.length ? undefined : answerText || undefined,
      };

      return question;
    })
    .filter((question): question is ImportedQuestionDraft => question !== null);

  return finalizeImportedAssessments(questions.length
    ? [
        {
          title,
          type: "QUIZ" as ImportedAssessmentType,
          questions,
        },
      ]
    : []);
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ImageInput } from "@/components/ui/image-input";
import { AssessmentImportPanel } from "@/components/course/assessment-import-panel";
import type { ImportedAssessmentDraft, ImportedQuestionDraft } from "@/lib/assessment-import";

const ASSESSMENT_TYPES = ["QUIZ", "EXAM", "PRACTICE"] as const;
type AssessmentType = (typeof ASSESSMENT_TYPES)[number];
const MIN_IMPORTED_STEM_LENGTH = 5;

type CourseAssessmentDraft = {
  id: string;
  title: string;
  description: string;
  type: AssessmentType;
  importedQuestions: ImportedQuestionDraft[];
};

function makeAssessmentDraft(partial?: Partial<CourseAssessmentDraft>): CourseAssessmentDraft {
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    type: "QUIZ",
    importedQuestions: [],
    ...partial,
  };
}

function isUsableImportedQuestion(question: ImportedQuestionDraft) {
  return question.stem.trim().length >= MIN_IMPORTED_STEM_LENGTH;
}

export default function NewCoursePage() {
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [modulePlan, setModulePlan] = useState("");
  const [assessments, setAssessments] = useState<CourseAssessmentDraft[]>([makeAssessmentDraft()]);
  const [error, setError] = useState("");

  const createCourse = trpc.course.create.useMutation();
  const createModule = trpc.course.createModule.useMutation();
  const createAssessment = trpc.assessment.create.useMutation();
  const createQuestions = trpc.question.createMany.useMutation();

  const plannedModules = useMemo(
    () =>
      modulePlan
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    [modulePlan]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");

    try {
      const course = await createCourse.mutateAsync({
        title,
        description: description || undefined,
        imageUrl: imageUrl || undefined,
      });

      for (const [index, moduleTitle] of plannedModules.entries()) {
        await createModule.mutateAsync({
          courseId: course.id,
          title: moduleTitle,
          description: undefined,
          content: undefined,
          videoUrl: undefined,
          order: index + 1,
        });
      }

        for (const assessment of assessments.filter((item) => item.title.trim())) {
          const questionIds: string[] = [];
          const importedQuestions = assessment.importedQuestions.filter(isUsableImportedQuestion);

          if (importedQuestions.length) {
            const createdQuestions = await createQuestions.mutateAsync({
              questions: importedQuestions.map((question) => ({
                courseId: course.id,
                stem: question.stem,
                type: question.type,
                difficulty: question.difficulty,
                points: question.points,
                explanation: question.explanation,
                tags: question.tags,
                options: question.options,
                correctAnswer: question.correctAnswer,
              })),
            });

            questionIds.push(...createdQuestions.map((question) => question.id));
          }

          await createAssessment.mutateAsync({
            courseId: course.id,
            title: assessment.title,
            description: assessment.description || undefined,
            type: assessment.type,
            questionIds: questionIds.length ? questionIds : undefined,
          });
        }

      await utils.course.list.invalidate();
      toast({
        title: "Course created",
        description: "Your modules and assessment drafts are ready.",
        variant: "success",
      });
      router.push(`/courses/${course.id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not create course");
    }
  }

  function updateAssessment(id: string, partial: Partial<CourseAssessmentDraft>) {
    setAssessments((current) =>
      current.map((assessment) => (assessment.id === id ? { ...assessment, ...partial } : assessment))
    );
  }

  function addImportedAssessments(imported: ImportedAssessmentDraft[]) {
    setAssessments((current) => [
      ...current.filter((item) => item.title.trim() || item.importedQuestions.length),
      ...imported.map((assessment) =>
        makeAssessmentDraft({
          title: assessment.title,
          description: assessment.description ?? "",
          type: assessment.type,
          importedQuestions: assessment.questions.filter(isUsableImportedQuestion),
        })
      ),
    ]);
  }

  const isSubmitting =
    createCourse.isPending ||
    createModule.isPending ||
    createAssessment.isPending ||
    createQuestions.isPending;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/courses" className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Courses
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Create Course Fast</h1>
        <p className="text-sm text-gray-600">
          Build the course shell, sketch the module path, and add assessments in one place.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Course Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Title *</label>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Safety Onboarding for New Technicians"
                required
                minLength={3}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Description</label>
              <Textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What will learners complete by the end of this course?"
                rows={4}
              />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Cover Image URL</label>
              <ImageInput
                value={imageUrl}
                onChange={setImageUrl}
                placeholder="https://example.com/course-cover.jpg"
                previewAlt="Course cover preview"
                uploadLabel="Browse cover image"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Module Path</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="text-sm font-medium text-gray-700">One module per line</label>
            <Textarea
              value={modulePlan}
              onChange={(event) => setModulePlan(event.target.value)}
              placeholder={"Welcome and expectations\nMachine safety essentials\nFinal walkthrough"}
              rows={6}
            />
            <div className="flex flex-wrap gap-2">
              {plannedModules.map((moduleTitle, index) => (
                <Badge key={`${moduleTitle}-${index}`} variant="secondary">
                  {index + 1}. {moduleTitle}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Assessments</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={() => setAssessments((current) => [...current, makeAssessmentDraft()])}>
                <Plus className="h-4 w-4" />
                Add Assessment
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {assessments.map((assessment, index) => (
                <div key={assessment.id} className="rounded-xl border border-gray-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900">Assessment {index + 1}</p>
                    {assessments.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssessments((current) => current.filter((item) => item.id !== assessment.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <Input
                    value={assessment.title}
                    onChange={(event) => updateAssessment(assessment.id, { title: event.target.value })}
                    placeholder="Assessment title"
                  />

                  <Textarea
                    value={assessment.description}
                    onChange={(event) => updateAssessment(assessment.id, { description: event.target.value })}
                    placeholder="Optional instructions"
                    rows={2}
                  />

                  <Select
                    value={assessment.type}
                    onValueChange={(value) => updateAssessment(assessment.id, { type: value as AssessmentType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSESSMENT_TYPES.map((assessmentType) => (
                        <SelectItem key={assessmentType} value={assessmentType}>
                          {assessmentType}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {assessment.importedQuestions.length > 0 && (
                    <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      {assessment.importedQuestions.length} imported question(s) will be added to the course bank and linked automatically.
                    </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <AssessmentImportPanel onImport={addImportedAssessments} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Course
          </Button>
          <Link href="/courses">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}

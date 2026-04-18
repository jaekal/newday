"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileUp, Layers3, ClipboardList, Loader2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
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
import type { ImportedAssessmentDraft } from "@/lib/assessment-import";

const COURSE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const ASSESSMENT_TYPES = ["QUIZ", "EXAM", "PRACTICE"] as const;
const EDIT_TABS = ["details", "modules", "assessments", "import"] as const;
type CourseStatus = (typeof COURSE_STATUSES)[number];
type EditTab = (typeof EDIT_TABS)[number];

export default function EditCoursePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: course, isLoading } = trpc.course.byId.useQuery({ courseId });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [status, setStatus] = useState<CourseStatus>("DRAFT");
  const [moduleCategory, setModuleCategory] = useState("");
  const [moduleTitle, setModuleTitle] = useState("");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentType, setAssessmentType] = useState<(typeof ASSESSMENT_TYPES)[number]>("QUIZ");
  const [activeTab, setActiveTab] = useState<EditTab>("details");
  const [error, setError] = useState("");

  const update = trpc.course.update.useMutation({
    onSuccess: async () => {
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Course updated", variant: "success" });
      router.push(`/courses/${courseId}`);
    },
    onError: (updateError) => setError(updateError.message),
  });

  const createModule = trpc.course.createModule.useMutation({
    onSuccess: async () => {
      setModuleCategory("");
      setModuleTitle("");
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Module added", variant: "success" });
    },
    onError: (moduleError) => setError(moduleError.message),
  });

  const createAssessment = trpc.assessment.create.useMutation({
    onSuccess: async () => {
      setAssessmentTitle("");
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Assessment added", variant: "success" });
    },
    onError: (assessmentError) => setError(assessmentError.message),
  });

  const deleteModule = trpc.course.deleteModule.useMutation({
    onSuccess: async () => {
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Module deleted", variant: "success" });
    },
    onError: (deleteError) => setError(deleteError.message),
  });

  const deleteAssessment = trpc.assessment.delete.useMutation({
    onSuccess: async () => {
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Assessment deleted", variant: "success" });
    },
    onError: (deleteError) => setError(deleteError.message),
  });

  const createQuestion = trpc.question.create.useMutation();

  useEffect(() => {
    if (course) {
      setTitle(course.title);
      setDescription(course.description ?? "");
      setImageUrl(course.imageUrl ?? "");
      setStatus((course.status as CourseStatus) ?? "DRAFT");
    }
  }, [course]);

  async function importAssessments(imported: ImportedAssessmentDraft[]) {
    setError("");

    try {
      for (const assessment of imported) {
        const questionIds: string[] = [];

        for (const question of assessment.questions) {
          const createdQuestion = await createQuestion.mutateAsync({
            courseId,
            stem: question.stem,
            type: question.type,
            difficulty: question.difficulty,
            points: question.points,
            explanation: question.explanation,
            tags: question.tags,
            options: question.options,
            correctAnswer: question.correctAnswer,
          });
          questionIds.push(createdQuestion.id);
        }

        await createAssessment.mutateAsync({
          courseId,
          title: assessment.title,
          description: assessment.description,
          type: assessment.type,
          questionIds,
        });
      }

      await utils.course.byId.invalidate({ courseId });
      toast({
        title: "Assessments imported",
        description: `${imported.length} assessment draft(s) were added to this course.`,
        variant: "success",
      });
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed");
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    update.mutate({
      courseId,
      title,
      description: description || undefined,
      imageUrl: imageUrl || undefined,
      status,
    });
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }
  if (!course) return <p className="text-gray-500">Course not found</p>;

  const moduleGroups = course.modules.reduce<Array<{ category: string; modules: typeof course.modules }>>((groups, module) => {
    const category = module.category?.trim() || "Uncategorized";
    const existing = groups.find((group) => group.category === category);
    if (existing) {
      existing.modules.push(module);
    } else {
      groups.push({ category, modules: [module] });
    }
    return groups;
  }, []);

  const tabMeta: Array<{ id: EditTab; label: string; icon: typeof Settings2 }> = [
    { id: "details", label: "Details", icon: Settings2 },
    { id: "modules", label: "Modules", icon: Layers3 },
    { id: "assessments", label: "Assessments", icon: ClipboardList },
    { id: "import", label: "Import", icon: FileUp },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          {course.title}
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Edit Course</h1>
        <p className="text-sm text-gray-600">Keep the course details tidy, then add new modules and assessments without leaving this page.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Status</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{course.status}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Modules</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{course.modules.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gray-500">Assessments</p>
            <p className="mt-2 text-lg font-semibold text-gray-900">{course.assessments.length}</p>
          </CardContent>
        </Card>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {tabMeta.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                  isActive
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "details" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Course Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Title *</label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} required minLength={3} />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-sm font-medium text-gray-700">Description</label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Cover Image URL</label>
                <ImageInput
                  value={imageUrl}
                  onChange={setImageUrl}
                  placeholder="https://example.com/course-cover.jpg"
                  previewAlt="Course cover preview"
                  uploadLabel="Browse cover image"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Status</label>
                <Select value={status} onValueChange={(value) => setStatus(value as CourseStatus)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COURSE_STATUSES.map((courseStatus) => (
                      <SelectItem key={courseStatus} value={courseStatus}>
                        {courseStatus}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-2">
                <Button type="submit" disabled={update.isPending}>
                  {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "modules" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Modules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Build the course path</p>
                  <p className="text-sm text-gray-500">Quick-add modules here, then open the full editor for richer lesson content, sequencing, and checkpoints.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{course.modules.length}</Badge>
                  <Link href={`/courses/${courseId}/modules/new`}>
                    <Button type="button" variant="outline" size="sm">
                      <Plus className="h-4 w-4" />
                      Full Builder
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[180px,1fr,auto]">
                <Input
                  value={moduleCategory}
                  onChange={(event) => setModuleCategory(event.target.value)}
                  placeholder="Category"
                />
                <Input
                  value={moduleTitle}
                  onChange={(event) => setModuleTitle(event.target.value)}
                  placeholder="Add a new module title"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    moduleTitle.trim() &&
                    createModule.mutate({
                      courseId,
                      category: moduleCategory.trim() || undefined,
                      title: moduleTitle.trim(),
                      description: undefined,
                      content: undefined,
                      videoUrl: undefined,
                    })
                  }
                  disabled={createModule.isPending || !moduleTitle.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                {course.modules.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                    No modules yet. Add the first module to start shaping this course.
                  </div>
                )}
                {moduleGroups.map((group) => (
                  <div key={group.category} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{group.category}</Badge>
                      <span className="text-xs text-gray-500">{group.modules.length} module(s)</span>
                    </div>
                    {group.modules.map((module) => (
                      <div
                        key={module.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {module.order}. {module.title}
                          </p>
                          <p className="text-xs text-gray-500">{module.category?.trim() || "Uncategorized"}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <Link href={`/courses/${courseId}/modules/${module.id}/edit`}>
                            <Button type="button" variant="ghost" size="sm" className="text-gray-500">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                          <button
                            type="button"
                            className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            disabled={deleteModule.isPending}
                            onClick={() => {
                              const confirmed = window.confirm(`Delete module "${module.title}"?`);
                              if (confirmed) {
                                deleteModule.mutate({ moduleId: module.id });
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "assessments" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Assessments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Quick assessment authoring</p>
                  <p className="text-sm text-gray-500">Create lightweight placeholders now and refine them later.</p>
                </div>
                <Badge variant="secondary">{course.assessments.length}</Badge>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr,180px,auto]">
                <Input
                  value={assessmentTitle}
                  onChange={(event) => setAssessmentTitle(event.target.value)}
                  placeholder="Assessment title"
                />
                <Select value={assessmentType} onValueChange={(value) => setAssessmentType(value as (typeof ASSESSMENT_TYPES)[number])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSESSMENT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  disabled={createAssessment.isPending || !assessmentTitle.trim()}
                  onClick={() =>
                    createAssessment.mutate({
                      courseId,
                      title: assessmentTitle.trim(),
                      type: assessmentType,
                    })
                  }
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-3">
                {course.assessments.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-sm text-gray-500">
                    No assessments yet. Add one here or jump to the import tab.
                  </div>
                )}
                {course.assessments.map((assessment) => (
                  <div
                    key={assessment.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">{assessment.title}</p>
                      <p className="text-xs text-gray-500">{assessment.type}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                      disabled={deleteAssessment.isPending}
                      onClick={() => {
                        const confirmed = window.confirm(`Delete assessment "${assessment.title}"? Attempts and grades tied to it will also be removed.`);
                        if (confirmed) {
                          deleteAssessment.mutate({ assessmentId: assessment.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "import" && (
          <div className="grid gap-6 lg:grid-cols-[1.2fr,0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Import Guidance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-gray-600">
                <p>
                  Import works best when each assessment has a clear title and each question includes a readable stem,
                  answer options, and a marked correct answer.
                </p>
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                  <p className="font-medium text-gray-900">Recommended sources</p>
                  <ul className="mt-2 space-y-2">
                    <li>Excel or CSV files with columns for title, question, type, difficulty, and answer key.</li>
                    <li>PDF exports that contain numbered questions and visible answer choices.</li>
                    <li>Text files pasted from existing assessments or study guides.</li>
                  </ul>
                </div>
                <p>
                  After import, questions are added to the course question bank and linked to newly created assessments.
                </p>
              </CardContent>
            </Card>

            <AssessmentImportPanel onImport={importAssessments} />
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}

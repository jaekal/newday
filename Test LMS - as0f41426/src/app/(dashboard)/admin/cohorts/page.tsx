"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import {
  Users, Plus, Trash2, X, ChevronRight, Loader2, UserPlus, BookOpen, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Cohort list ──────────────────────────────────────────────────────────────

export default function CohortsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: cohorts, isLoading } = trpc.cohort.list.useQuery();
  const createCohort = trpc.cohort.create.useMutation({
    onSuccess: () => { utils.cohort.list.invalidate(); setCreating(false); setName(""); },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });
  const deleteCohort = trpc.cohort.delete.useMutation({
    onSuccess: () => utils.cohort.list.invalidate(),
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createCohort.mutate({ name, description: desc || undefined });
  }

  if (isLoading)
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>;

  const filteredCohorts = (cohorts ?? []).filter((cohort) =>
    !search ||
    cohort.name.toLowerCase().includes(search.toLowerCase()) ||
    cohort.description?.toLowerCase().includes(search.toLowerCase()),
  );
  const totalMembers = (cohorts ?? []).reduce((sum, cohort) => sum + cohort._count.memberships, 0);
  const totalAssignments = (cohorts ?? []).reduce((sum, cohort) => sum + cohort._count.courses, 0);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        eyebrow="Cohort workspace"
        title="Cohorts"
        description="Group learners, assign custom course paths, and keep training rollouts organized by team, program, or cohort."
        actions={
          <Button onClick={() => setCreating(true)} size="sm" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New Cohort
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Cohorts" value={cohorts?.length ?? 0} detail="Training groups currently configured" />
        <SummaryCard label="Members" value={totalMembers} detail="Learner memberships across all cohorts" />
        <SummaryCard label="Assignments" value={totalAssignments} detail="Course-path assignments already in place" />
      </div>

      <Card className="border-[#ece8dd] bg-[#fcfaf4]">
        <CardContent className="flex flex-col gap-4 pt-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Orchestration tips</p>
            <p className="mt-1 text-sm text-gray-500">
              Use cohorts when the learning path should differ by audience. The custom path editor lets you shorten or focus a course without cloning it.
            </p>
          </div>
          <div className="w-full md:w-72">
            <Input
              placeholder="Search cohorts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {creating && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleCreate} className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex-1 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Cohort details</p>
                <Input
                  placeholder="Cohort name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoFocus
                />
                <Input
                  placeholder="Description (optional)"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
                <p className="text-xs text-gray-500">
                  Keep the name audience-based, like onboarding wave, role, region, or certification group.
                </p>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createCohort.isPending}>
                  {createCohort.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredCohorts.map((c) => (
          <Card
            key={c.id}
            className={cn("cursor-pointer transition-all hover:shadow-md", selected === c.id && "ring-2")}
            style={selected === c.id ? { ringColor: "var(--c-accent)" } as React.CSSProperties : undefined}
            onClick={() => setSelected(selected === c.id ? null : c.id)}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{c.name}</h3>
                    <ChevronRight className={cn("h-4 w-4 text-gray-400 transition-transform", selected === c.id && "rotate-90")} />
                  </div>
                  {c.description && <p className="text-sm text-gray-500 mt-0.5">{c.description}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <Users className="h-3 w-3" />{c._count.memberships} members
                    </Badge>
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />{c._count.courses} courses
                    </Badge>
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteCohort.mutate({ cohortId: c.id }); }}
                  className="text-gray-300 hover:text-red-500 transition-colors p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
        {filteredCohorts.length === 0 && (
          <div className="col-span-2">
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={cohorts?.length ? "No cohorts match this search" : "No cohorts yet"}
              message={cohorts?.length ? "Try a broader search term or create a new cohort for a different audience." : "Create your first cohort to start assigning courses in bulk and tailoring learning paths by audience."}
              action={!cohorts?.length ? <Button onClick={() => setCreating(true)}>Create Cohort</Button> : undefined}
            />
          </div>
        )}
      </div>

      {selected && <CohortDetail cohortId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-black text-gray-900">{value}</p>
        <p className="mt-1 text-sm font-medium text-gray-900">{label}</p>
        <p className="mt-1 text-xs text-gray-500">{detail}</p>
      </CardContent>
    </Card>
  );
}

// ─── Cohort detail panel ──────────────────────────────────────────────────────

function CohortDetail({ cohortId, onClose }: { cohortId: string; onClose: () => void }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: cohort, isLoading } = trpc.cohort.byId.useQuery({ cohortId });
  const { data: allUsers } = trpc.user.list.useQuery({ limit: 200 });
  const { data: allCourses } = trpc.course.list.useQuery({ limit: 100 });

  const addMembers = trpc.cohort.addMembers.useMutation({
    onSuccess: (r) => {
      utils.cohort.byId.invalidate({ cohortId });
      utils.cohort.list.invalidate();
      toast({ title: `Added ${r.added} member(s)`, variant: "success" });
      setMemberSearch("");
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });
  const removeMembers = trpc.cohort.removeMembers.useMutation({
    onSuccess: () => utils.cohort.byId.invalidate({ cohortId }),
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });
  const addCourse = trpc.cohort.addCourse.useMutation({
    onSuccess: () => {
      utils.cohort.byId.invalidate({ cohortId });
      utils.cohort.list.invalidate();
      toast({ title: "Course path assigned and members enrolled", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });
  const updateCoursePath = trpc.cohort.updateCoursePath.useMutation({
    onSuccess: () => {
      utils.cohort.byId.invalidate({ cohortId });
      toast({ title: "Course path updated", variant: "success" });
    },
    onError: (e) => toast({ title: "Failed", description: e.message, variant: "error" }),
  });
  const removeCourse = trpc.cohort.removeCourse.useMutation({
    onSuccess: () => utils.cohort.byId.invalidate({ cohortId }),
  });

  const [memberSearch, setMemberSearch] = useState("");
  const [tab, setTab] = useState<"members" | "courses">("members");
  const [courseEditor, setCourseEditor] = useState<{ courseId: string; mode: "create" | "edit" } | null>(null);

  const { data: selectedCourse, isLoading: isCourseConfigLoading } = trpc.course.byId.useQuery(
    { courseId: courseEditor?.courseId ?? "" },
    { enabled: Boolean(courseEditor?.courseId) },
  );

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>;
  if (!cohort) return null;

  const existingMemberIds = new Set(cohort.memberships.map((m) => m.userId));
  const existingCourseIds = new Set(cohort.courses.map((c) => c.courseId));

  const availableUsers = (allUsers?.users ?? []).filter(
    (u) => !existingMemberIds.has(u.id) && (
      !memberSearch ||
      u.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(memberSearch.toLowerCase())
    )
  );

  const availableCourses = (allCourses?.courses ?? []).filter(
    (c) => !existingCourseIds.has(c.id) && c.status === "PUBLISHED"
  );

  const editingCourse = courseEditor?.mode === "edit"
    ? cohort.courses.find((entry) => entry.courseId === courseEditor.courseId)
    : null;

  return (
    <Card className="border-2" style={{ borderColor: "var(--c-accent)" } as React.CSSProperties}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{cohort.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab rail */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {(["members", "courses"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all",
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t} ({t === "members" ? cohort.memberships.length : cohort.courses.length})
            </button>
          ))}
        </div>

        {tab === "members" && (
          <div className="space-y-3">
            {/* Current members */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {cohort.memberships.map((m) => (
                <div key={m.userId} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{m.user.name}</span>
                    <span className="text-xs text-gray-400 ml-2">{m.user.email}</span>
                    {m.user.employeeId && <span className="text-xs text-gray-400 ml-2">#{m.user.employeeId}</span>}
                  </div>
                  <button
                    onClick={() => removeMembers.mutate({ cohortId, userIds: [m.userId] })}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {cohort.memberships.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No members yet</p>}
            </div>

            {/* Add members */}
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Add Members</p>
              <Input
                placeholder="Search users..."
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                className="h-8 text-sm"
              />
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {availableUsers.slice(0, 20).map((u) => (
                  <div key={u.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                    <div>
                      <span className="text-sm text-gray-900">{u.name}</span>
                      <span className="text-xs text-gray-400 ml-2">{u.email}</span>
                    </div>
                    <button
                      onClick={() => addMembers.mutate({ cohortId, userIds: [u.id] })}
                      disabled={addMembers.isPending}
                      className="text-gray-400 hover:text-green-600 transition-colors"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {!availableUsers.length && <p className="text-xs text-gray-400 text-center py-2">No users found</p>}
              </div>
            </div>
          </div>
        )}

        {tab === "courses" && (
          <div className="space-y-3">
            {/* Current courses */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {cohort.courses.map((cc) => (
                <div key={cc.courseId} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{cc.course.title}</span>
                    <Badge variant="secondary" className="ml-2 text-[10px]">{cc.course.status}</Badge>
                    <span className="text-xs text-gray-400 ml-2">{cc.course._count.enrollments} enrolled</span>
                    <span className="text-xs text-gray-400 ml-2">
                      {cc.moduleSelections.length === 0
                        ? "Full course path"
                        : `${cc.moduleSelections.length}/${cc.course._count.modules} modules assigned`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCourseEditor({ courseId: cc.courseId, mode: "edit" })}
                      className="text-gray-300 hover:text-gray-600 transition-colors"
                      title="Adjust course path"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeCourse.mutate({ cohortId, courseId: cc.courseId })}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {cohort.courses.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No courses yet</p>}
            </div>

            {courseEditor && (
              <div className="border-t pt-3">
                {isCourseConfigLoading || !selectedCourse ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                  </div>
                ) : (
                  <CoursePathEditor
                    key={`${courseEditor.mode}-${courseEditor.courseId}`}
                    mode={courseEditor.mode}
                    course={selectedCourse}
                    initialModuleIds={editingCourse?.moduleSelections.map((selection) => selection.module.id) ?? []}
                    isSaving={addCourse.isPending || updateCoursePath.isPending}
                    onCancel={() => setCourseEditor(null)}
                    onSave={(moduleIds) => {
                      if (courseEditor.mode === "create") {
                        addCourse.mutate(
                          { cohortId, courseId: selectedCourse.id, moduleIds },
                          {
                            onSuccess: () => setCourseEditor(null),
                          },
                        );
                        return;
                      }

                      updateCoursePath.mutate(
                        { cohortId, courseId: selectedCourse.id, moduleIds },
                        {
                          onSuccess: () => setCourseEditor(null),
                        },
                      );
                    }}
                  />
                )}
              </div>
            )}

            {/* Add courses */}
            {availableCourses.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Assign Course Paths</p>
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  {availableCourses.map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-1 px-2 rounded hover:bg-gray-50">
                      <div>
                        <span className="text-sm text-gray-900">{c.title}</span>
                        <span className="text-xs text-gray-400 ml-2">{c._count.modules} modules</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setCourseEditor({ courseId: c.id, mode: "create" })}
                      >
                        Configure
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CoursePathEditor({
  mode,
  course,
  initialModuleIds,
  isSaving,
  onCancel,
  onSave,
}: {
  mode: "create" | "edit";
  course: {
    id: string;
    title: string;
    modules: Array<{
      id: string;
      title: string;
      order: number;
      category?: string | null;
      estimatedMinutes?: number | null;
      prerequisiteModuleId?: string | null;
      prerequisiteModule?: { id: string; title: string; order: number } | null;
    }>;
    pathContext?: {
      visibleModuleCount: number;
      totalModuleCount: number;
    };
  };
  initialModuleIds: string[];
  isSaving: boolean;
  onCancel: () => void;
  onSave: (moduleIds?: string[]) => void;
}) {
  const modules = [...course.modules].sort((a, b) => a.order - b.order);
  const [modeState, setModeState] = useState<"full" | "custom">(initialModuleIds.length > 0 ? "custom" : "full");
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>(initialModuleIds);

  const selectedSet = new Set(selectedModuleIds);
  const totalMinutes = modules.reduce((sum, module) => sum + (module.estimatedMinutes ?? 0), 0);
  const selectedMinutes = modules
    .filter((module) => selectedSet.has(module.id))
    .reduce((sum, module) => sum + (module.estimatedMinutes ?? 0), 0);

  function toggleModule(moduleId: string) {
    setSelectedModuleIds((current) =>
      current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [...current, moduleId],
    );
  }

  return (
    <Card className="bg-gray-50/70 border-dashed">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {mode === "create" ? "Configure cohort course path" : "Adjust cohort course path"}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {course.title} has {modules.length} module{modules.length === 1 ? "" : "s"}. Leave it as a full course or assign only the modules this cohort should complete.
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setModeState("full")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              modeState === "full"
                ? "border-transparent text-white"
                : "border-gray-300 text-gray-600 hover:border-gray-400",
            )}
            style={modeState === "full" ? { background: "var(--c-accent)" } : undefined}
          >
            Full course
          </button>
          <button
            type="button"
            onClick={() => setModeState("custom")}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              modeState === "custom"
                ? "border-transparent text-white"
                : "border-gray-300 text-gray-600 hover:border-gray-400",
            )}
            style={modeState === "custom" ? { background: "var(--c-accent)" } : undefined}
          >
            Custom module path
          </button>
          {modeState === "custom" && (
            <>
              <Badge variant="outline">{selectedModuleIds.length} selected</Badge>
              <Badge variant="secondary">
                {selectedMinutes} / {totalMinutes || 0} min
              </Badge>
            </>
          )}
        </div>

        {modeState === "custom" && (
          <div className="space-y-2 rounded-xl border bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Visible modules</p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedModuleIds(modules.map((module) => module.id))}>
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedModuleIds([])}>
                  Clear
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              Use this to trim the course for a cohort. Prerequisites and pacing hints stay visible so you can keep the path coherent.
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {modules.map((module) => (
                <label
                  key={module.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selectedSet.has(module.id)
                      ? "border-[color:var(--c-accent)] bg-[color:color-mix(in_srgb,var(--c-accent)_8%,white)]"
                      : "border-gray-200 hover:border-gray-300",
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[var(--c-accent)] focus:ring-[var(--c-accent)]"
                    checked={selectedSet.has(module.id)}
                    onChange={() => toggleModule(module.id)}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-gray-900">
                      Module {module.order}: {module.title}
                      </p>
                      {module.estimatedMinutes ? <Badge variant="secondary">{module.estimatedMinutes} min</Badge> : null}
                      {module.prerequisiteModule ? <Badge variant="outline">Requires {module.prerequisiteModule.order}</Badge> : null}
                    </div>
                    <p className="text-xs text-gray-500">{module.category?.trim() || "Uncategorized"}</p>
                    {module.prerequisiteModule ? (
                      <p className="mt-1 text-xs text-gray-500">
                        Prerequisite: Module {module.prerequisiteModule.order} - {module.prerequisiteModule.title}
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-gray-400">No prerequisite</p>
                    )}
                  </div>
                </label>
              ))}
            </div>
            {selectedModuleIds.length === 0 && (
              <p className="text-xs text-amber-600">
                Select at least one module for a custom path, or switch back to full course.
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isSaving || (modeState === "custom" && selectedModuleIds.length === 0)}
            onClick={() => onSave(modeState === "custom" ? selectedModuleIds : undefined)}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {mode === "create" ? "Assign course" : "Save path"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

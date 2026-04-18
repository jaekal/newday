"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/components/ui/toast";
import { ModuleEditorForm } from "@/components/course/module-editor-form";
import { Button } from "@/components/ui/button";

export default function EditModulePage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [error, setError] = useState("");

  const { data: course, isLoading } = trpc.course.byId.useQuery({ courseId });
  const module = useMemo(
    () => course?.modules.find((courseModule) => courseModule.id === moduleId),
    [course, moduleId],
  );

  const updateModule = trpc.course.updateModule.useMutation({
    onSuccess: async () => {
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Module updated", variant: "success" });
      router.push(`/courses/${courseId}/modules/${moduleId}`);
    },
    onError: (updateError) => setError(updateError.message),
  });

  const deleteModule = trpc.course.deleteModule.useMutation({
    onSuccess: async () => {
      await utils.course.byId.invalidate({ courseId });
      toast({ title: "Module deleted", variant: "success" });
      router.push(`/courses/${courseId}/edit`);
    },
    onError: (deleteError) => setError(deleteError.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!course || !module) {
    return <p className="text-gray-500">Module not found</p>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}/modules/${moduleId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back to Module
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Edit Module</h1>
        <p className="text-sm text-gray-600">
          Refine the lesson flow, reorder the module, and keep its content current without recreating it.
        </p>
        <div className="pt-1">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={deleteModule.isPending}
            onClick={() => {
              const confirmed = window.confirm(`Delete module "${module.title}"? This cannot be undone.`);
              if (!confirmed) return;
              setError("");
              deleteModule.mutate({ moduleId });
            }}
          >
            {deleteModule.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {!deleteModule.isPending && <Trash2 className="h-4 w-4" />}
            Delete Module
          </Button>
        </div>
      </div>

      <ModuleEditorForm
        initial={{
          category: module.category,
          title: module.title,
          description: module.description,
          videoUrl: module.videoUrl,
          content: module.content,
          estimatedMinutes: module.estimatedMinutes,
          prerequisiteModuleId: module.prerequisiteModuleId,
          order: module.order,
        }}
        availablePrerequisites={course.modules
          .filter((courseModule) => courseModule.id !== moduleId)
          .map((courseModule) => ({
            id: courseModule.id,
            title: courseModule.title,
            order: courseModule.order,
          }))}
        submitLabel="Save Module"
        submitting={updateModule.isPending}
        error={error}
        onSubmit={(values) => {
          setError("");
          updateModule.mutate({
            moduleId,
            category: values.category,
            title: values.title,
            description: values.description,
            content: values.content,
            videoUrl: values.videoUrl,
            estimatedMinutes: values.estimatedMinutes,
            prerequisiteModuleId: values.prerequisiteModuleId,
            order: values.order,
          });
        }}
      />
    </div>
  );
}

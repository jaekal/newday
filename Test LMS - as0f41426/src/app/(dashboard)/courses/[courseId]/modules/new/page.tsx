"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { ModuleEditorForm } from "@/components/course/module-editor-form";

export default function NewModulePage() {
  const { courseId } = useParams<{ courseId: string }>();
  const router = useRouter();
  const [error, setError] = useState("");
  const { data: course } = trpc.course.byId.useQuery({ courseId });

  const create = trpc.course.createModule.useMutation({
    onSuccess: (module) => router.push(`/courses/${courseId}/modules/${module.id}`),
    onError: (createError) => setError(createError.message),
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Back to Course
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Create Module</h1>
        <p className="text-sm text-gray-600">
          Build a fuller module in one pass with sequencing, video, structured content, and embedded checkpoints.
        </p>
      </div>

      <ModuleEditorForm
        availablePrerequisites={(course?.modules ?? []).map((module) => ({
          id: module.id,
          title: module.title,
          order: module.order,
        }))}
        submitLabel="Create Module"
        submitting={create.isPending}
        error={error}
        onSubmit={(values) => {
          setError("");
          create.mutate({
            courseId,
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

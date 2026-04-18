"use client";

import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2, ArrowLeft, ChevronRight, ChevronLeft,
  Loader2, PlayCircle, BookOpen, Pencil, Lock
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { RichContentViewer, type Block } from "@/components/ui/rich-content-editor";
import { ModuleMarkdownContent } from "@/components/course/module-markdown-content";
import { useSession } from "next-auth/react";
import { getCompletedModuleIds, isModuleUnlocked } from "@/lib/module-path";

export default function ModulePage() {
  const { courseId, moduleId } = useParams<{ courseId: string; moduleId: string }>();
  const router = useRouter();
  const [completed, setCompleted] = useState(false);
  const { toast } = useToast();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string })?.role ?? "STUDENT";

  const { data: course, isLoading } = trpc.course.byId.useQuery({ courseId });
  const completeModule = trpc.course.completeModule.useMutation({
    onSuccess: () => { setCompleted(true); toast({ title: "Module completed!", variant: "success" }); },
    onError: (e) => toast({ title: "Error", description: e.message, variant: "error" }),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }
  if (!course) return <p className="text-gray-500">Course not found</p>;

  const modules = course.modules;
  const moduleIndex = modules.findIndex((m) => m.id === moduleId);
  const module = modules[moduleIndex];

  if (!module) return <p className="text-gray-500">Module not found</p>;

  const prevModule = moduleIndex > 0 ? modules[moduleIndex - 1] : null;
  const nextModule = moduleIndex < modules.length - 1 ? modules[moduleIndex + 1] : null;
  const isInstructor = role === "INSTRUCTOR" || role === "ADMIN" || role === "MANAGER";
  const completedModuleIds = getCompletedModuleIds(modules);
  const isUnlocked = isInstructor || isModuleUnlocked(module, completedModuleIds);

  if (!isUnlocked) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />{course.title}
          </Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-gray-900 truncate">{module.title}</span>
        </div>

        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <Lock className="h-10 w-10 text-amber-500 mx-auto" />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">This module is still locked</h1>
              <p className="text-sm text-gray-500 mt-2">
                Complete "{module.prerequisiteModule?.title ?? "the prerequisite module"}" before starting this lesson.
              </p>
            </div>
            {module.prerequisiteModule ? (
              <Link href={`/courses/${courseId}/modules/${module.prerequisiteModule.id}`}>
                <Button>Go to prerequisite</Button>
              </Link>
            ) : (
              <Link href={`/courses/${courseId}`}>
                <Button variant="outline">Back to course</Button>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href={`/courses/${courseId}`} className="hover:text-gray-700 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />{course.title}
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-gray-900 truncate">{module.title}</span>
      </div>

      {/* Module header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary">Module {moduleIndex + 1} of {modules.length}</Badge>
          {module.category && <Badge variant="outline">{module.category}</Badge>}
          {module.estimatedMinutes ? <Badge variant="outline">{module.estimatedMinutes} min</Badge> : null}
          {completed && <Badge variant="success"><CheckCircle2 className="h-3 w-3 mr-1" />Completed</Badge>}
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{module.title}</h1>
        {module.description && (
          <p className="text-gray-500 mt-1">{module.description}</p>
        )}
        {isInstructor && (
          <div className="mt-3">
            <Link href={`/courses/${courseId}/modules/${moduleId}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4" />
                Edit Module
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Video */}
      {module.videoUrl && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-3">
              <PlayCircle className="h-5 w-5 text-blue-600" />
              <span className="font-medium text-gray-900">Video</span>
            </div>
            <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden">
              <iframe
                src={module.videoUrl}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                title={module.title}
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {module.content ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-5 w-5 text-blue-600" />
              <span className="font-medium text-gray-900">Content</span>
            </div>
            {(() => {
              try {
                const blocks: Block[] = JSON.parse(module.content!);
                if (Array.isArray(blocks) && blocks[0]?.kind) {
                  return <RichContentViewer blocks={blocks} />;
                }
              } catch {}
              return <ModuleMarkdownContent source={module.content!} />;
            })()}
          </CardContent>
        </Card>
      ) : !module.videoUrl ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            No content available for this module yet.
          </CardContent>
        </Card>
      ) : null}

      {/* Mark complete */}
      {!completed && (
        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={() => completeModule.mutate({ moduleId })}
            disabled={completeModule.isPending}
          >
            {completeModule.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Mark as Complete
          </Button>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2 pb-6 border-t border-gray-100">
        {prevModule ? (
          <Link href={`/courses/${courseId}/modules/${prevModule.id}`}>
            <Button variant="outline">
              <ChevronLeft className="h-4 w-4" />
              {prevModule.title}
            </Button>
          </Link>
        ) : (
          <div />
        )}
        {nextModule ? (
          <Link href={`/courses/${courseId}/modules/${nextModule.id}`}>
            <Button>
              {nextModule.title}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        ) : (
          <Link href={`/courses/${courseId}`}>
            <Button variant="outline">Back to Course</Button>
          </Link>
        )}
      </div>
    </div>
  );
}

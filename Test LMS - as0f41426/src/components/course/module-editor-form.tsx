"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Sparkles, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RichContentEditor, type Block } from "@/components/ui/rich-content-editor";

const CATEGORY_PRESETS = [
  "Initialization",
  "RLT Processes",
  "Safety",
  "Operations",
  "Quality Checks",
] as const;

type Props = {
  initial?: {
    category?: string | null;
    title?: string;
    description?: string | null;
    videoUrl?: string | null;
    content?: string | null;
    estimatedMinutes?: number | null;
    prerequisiteModuleId?: string | null;
    order?: number;
  };
  availablePrerequisites?: Array<{
    id: string;
    title: string;
    order: number;
  }>;
  submitting?: boolean;
  submitLabel: string;
  error?: string;
  onSubmit: (values: {
    category?: string;
    title: string;
    description?: string;
    videoUrl?: string;
    content?: string;
    estimatedMinutes?: number;
    prerequisiteModuleId?: string;
    order?: number;
  }) => void;
};

function parseBlocks(content?: string | null) {
  if (!content) return [] as Block[];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed as Block[];
  } catch {}
  return [] as Block[];
}

export function ModuleEditorForm({ initial, availablePrerequisites, submitting, submitLabel, error, onSubmit }: Props) {
  const [category, setCategory] = useState(initial?.category ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [estimatedMinutes, setEstimatedMinutes] = useState(initial?.estimatedMinutes ? String(initial.estimatedMinutes) : "");
  const [prerequisiteModuleId, setPrerequisiteModuleId] = useState(initial?.prerequisiteModuleId ?? "");
  const [order, setOrder] = useState(initial?.order ? String(initial.order) : "");
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlocks(initial?.content));

  useEffect(() => {
    setCategory(initial?.category ?? "");
    setTitle(initial?.title ?? "");
    setDescription(initial?.description ?? "");
    setVideoUrl(initial?.videoUrl ?? "");
    setEstimatedMinutes(initial?.estimatedMinutes ? String(initial.estimatedMinutes) : "");
    setPrerequisiteModuleId(initial?.prerequisiteModuleId ?? "");
    setOrder(initial?.order ? String(initial.order) : "");
    setBlocks(parseBlocks(initial?.content));
  }, [initial]);

  const stats = useMemo(() => {
    const checkpointCount = blocks.filter((block) => block.kind === "checkpoint").length;
    const videoBlockCount = blocks.filter((block) => block.kind === "video").length;
    return {
      blockCount: blocks.length,
      checkpointCount,
      videoBlockCount,
    };
  }, [blocks]);

  function addStarterOutline() {
    if (blocks.length > 0) return;
    setBlocks([
      { id: crypto.randomUUID(), kind: "heading", text: "What learners will cover" },
      { id: crypto.randomUUID(), kind: "text", text: "Add the key ideas, steps, and takeaways for this module here." },
      { id: crypto.randomUUID(), kind: "checkpoint", question: "Quick knowledge check", options: ["Correct answer", "Distractor"], correct: 0 },
    ]);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSubmit({
      title: title.trim(),
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      videoUrl: videoUrl.trim() || undefined,
      content: blocks.length > 0 ? JSON.stringify(blocks) : undefined,
      estimatedMinutes: estimatedMinutes.trim() ? Number(estimatedMinutes) : undefined,
      prerequisiteModuleId: prerequisiteModuleId || undefined,
      order: order.trim() ? Number(order) : undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Module Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Category</label>
            <Select value={CATEGORY_PRESETS.includes(category as (typeof CATEGORY_PRESETS)[number]) ? category : "__custom__"} onValueChange={(value) => {
              if (value === "__custom__") {
                if (!category) setCategory("");
                return;
              }
              setCategory(value);
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>{preset}</SelectItem>
                ))}
                <SelectItem value="__custom__">Custom category</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="e.g. Initialization or RLT Processes"
            />
            <p className="text-xs text-gray-400">Use categories to organize modules into sections on the course path.</p>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Title *</label>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Lockout/Tagout Essentials"
              required
              minLength={2}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Description</label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Summarize what learners will do in this module and why it matters."
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Primary Video URL</label>
            <Input
              value={videoUrl}
              onChange={(event) => setVideoUrl(event.target.value)}
              placeholder="https://youtube.com/embed/..."
              type="url"
            />
            <p className="text-xs text-gray-400">Use an embeddable video URL for the hero video at the top of the module.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Estimated Minutes</label>
            <Input
              value={estimatedMinutes}
              onChange={(event) => setEstimatedMinutes(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="e.g. 15"
              inputMode="numeric"
            />
            <p className="text-xs text-gray-400">Used on learner views to forecast time required for this module.</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Module Order</label>
            <Input
              value={order}
              onChange={(event) => setOrder(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="Auto"
              inputMode="numeric"
            />
            <p className="text-xs text-gray-400">Leave blank to keep the next available position.</p>
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Prerequisite Module</label>
            <Select value={prerequisiteModuleId || "__none__"} onValueChange={(value) => setPrerequisiteModuleId(value === "__none__" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="No prerequisite" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No prerequisite</SelectItem>
                {(availablePrerequisites ?? []).map((module) => (
                  <SelectItem key={module.id} value={module.id}>
                    Module {module.order}: {module.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">Learners must complete this module before the current one unlocks, unless it is excluded from their cohort path.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="text-base">Learning Content</CardTitle>
            <p className="text-xs text-gray-400">
              Mix headings, body text, embedded videos, and checkpoint questions into one guided module.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addStarterOutline} disabled={blocks.length > 0}>
            <Sparkles className="h-4 w-4" />
            Starter Outline
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Blocks</p>
              <p className="mt-2 text-xl font-semibold text-gray-900">{stats.blockCount}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Checkpoints</p>
              <p className="mt-2 text-xl font-semibold text-gray-900">{stats.checkpointCount}</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Video Blocks</p>
              <p className="mt-2 text-xl font-semibold text-gray-900">{stats.videoBlockCount}</p>
            </div>
          </div>

          {videoUrl && (
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
                <Video className="h-4 w-4" />
                Primary video preview
              </div>
              <div className="aspect-video overflow-hidden rounded-lg bg-gray-900">
                <iframe
                  src={videoUrl}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  title="Primary module video preview"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            </div>
          )}

          <RichContentEditor blocks={blocks} onChange={setBlocks} />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting || !title.trim()}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
        <Button type="button" variant="outline" onClick={() => setBlocks([...blocks, { id: crypto.randomUUID(), kind: "text", text: "" }])}>
          <Plus className="h-4 w-4" />
          Add Text Block
        </Button>
      </div>
    </form>
  );
}

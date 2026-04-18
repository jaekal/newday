"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Heading1, Type, Video, HelpCircle, Plus, Trash2, Image as ImageIcon, ChevronUp, ChevronDown } from "lucide-react";
import { ImageInput } from "./image-input";

export type Block =
  | { id: string; kind: "heading"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "image"; url: string; alt?: string; caption?: string }
  | { id: string; kind: "video"; url: string; caption?: string }
  | { id: string; kind: "checkpoint"; question: string; options: string[]; correct: number };

type Props = {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  readOnly?: boolean;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Read-only render ──────────────────────────────────────────────────────────

export function RichContentViewer({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b) => {
        if (b.kind === "heading")
          return <h2 key={b.id} className="text-xl font-bold text-gray-900">{b.text}</h2>;
        if (b.kind === "text")
          return <p key={b.id} className="text-gray-700 whitespace-pre-wrap leading-relaxed">{b.text}</p>;
        if (b.kind === "image")
          return (
            <figure key={b.id} className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={b.url} alt={b.alt ?? b.caption ?? "Module image"} className="w-full object-cover" />
              </div>
              {(b.caption || b.alt) && (
                <figcaption className="text-xs text-gray-400 text-center">
                  {b.caption || b.alt}
                </figcaption>
              )}
            </figure>
          );
        if (b.kind === "video")
          return (
            <div key={b.id}>
              <div className="aspect-video bg-gray-900 rounded-xl overflow-hidden">
                <iframe src={b.url} className="w-full h-full" allowFullScreen title={b.caption ?? "Video"} />
              </div>
              {b.caption && <p className="text-xs text-gray-400 mt-1 text-center">{b.caption}</p>}
            </div>
          );
        if (b.kind === "checkpoint")
          return <CheckpointBlock key={b.id} block={b} />;
        return null;
      })}
    </div>
  );
}

function CheckpointBlock({ block }: { block: Extract<Block, { kind: "checkpoint" }> }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="rounded-xl border-2 p-4 space-y-3" style={{ borderColor: "var(--c-accent)" }}>
      <div className="flex items-center gap-2">
        <HelpCircle className="h-4 w-4 shrink-0" style={{ color: "var(--c-accent)" }} />
        <p className="font-medium text-gray-900 text-sm">{block.question}</p>
      </div>
      <div className="space-y-2">
        {block.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => { setSelected(i); setRevealed(true); }}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-lg border-2 text-sm transition-all",
              selected === i && revealed
                ? i === block.correct
                  ? "border-green-500 bg-green-50 text-green-800"
                  : "border-red-400 bg-red-50 text-red-700"
                : "border-gray-200 hover:border-gray-300",
            )}
          >
            {opt}
          </button>
        ))}
      </div>
      {revealed && (
        <p className={cn("text-xs font-medium", selected === block.correct ? "text-green-600" : "text-red-600")}>
          {selected === block.correct ? "Correct!" : `Correct answer: ${block.options[block.correct]}`}
        </p>
      )}
    </div>
  );
}

// ─── Editor ────────────────────────────────────────────────────────────────────

export function RichContentEditor({ blocks, onChange }: Props) {
  function update(id: string, patch: Partial<Block>) {
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
  }

  function remove(id: string) {
    onChange(blocks.filter((b) => b.id !== id));
  }

  function move(id: string, dir: -1 | 1) {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const next = [...blocks];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  function addBlock(kind: Block["kind"]) {
    const base = { id: uid() };
    let block: Block;
    switch (kind) {
      case "heading":    block = { ...base, kind, text: "" }; break;
      case "text":       block = { ...base, kind, text: "" }; break;
      case "image":      block = { ...base, kind, url: "", alt: "", caption: "" }; break;
      case "video":      block = { ...base, kind, url: "" }; break;
      case "checkpoint": block = { ...base, kind, question: "", options: ["", ""], correct: 0 }; break;
    }
    onChange([...blocks, block]);
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-6">No blocks yet. Add one below.</p>
      )}

      {blocks.map((b, idx) => (
        <div key={b.id} className="group relative rounded-xl border border-gray-200 bg-white overflow-hidden">
          {/* Block controls */}
          <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
            <button onClick={() => move(b.id, -1)} disabled={idx === 0}
              className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => move(b.id, 1)} disabled={idx === blocks.length - 1}
              className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 transition-colors">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => remove(b.id)}
              className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Block content */}
          {b.kind === "heading" && (
            <div className="p-3 flex items-center gap-2">
              <Heading1 className="h-4 w-4 text-gray-400 shrink-0" />
              <input
                className="flex-1 text-lg font-bold text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
                placeholder="Section heading..."
                value={b.text}
                onChange={(e) => update(b.id, { text: e.target.value })}
              />
            </div>
          )}

          {b.kind === "text" && (
            <div className="p-3 flex items-start gap-2">
              <Type className="h-4 w-4 text-gray-400 shrink-0 mt-0.5" />
              <textarea
                className="flex-1 text-sm text-gray-700 outline-none bg-transparent resize-none placeholder:text-gray-300 min-h-[60px]"
                placeholder="Add text content..."
                value={b.text}
                rows={3}
                onChange={(e) => update(b.id, { text: e.target.value })}
              />
            </div>
          )}

          {b.kind === "image" && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-gray-400 shrink-0" />
                <span className="text-sm font-medium text-gray-700">Image block</span>
              </div>
              <ImageInput
                value={b.url}
                onChange={(value) => update(b.id, { url: value })}
                placeholder="Paste an image URL"
                previewAlt={b.alt ?? b.caption ?? "Module image"}
                uploadLabel="Browse image"
              />
              <input
                className="w-full text-xs text-gray-500 outline-none bg-transparent placeholder:text-gray-200"
                placeholder="Alt text (optional)"
                value={b.alt ?? ""}
                onChange={(e) => update(b.id, { alt: e.target.value })}
              />
              <input
                className="w-full text-xs text-gray-400 outline-none bg-transparent placeholder:text-gray-200"
                placeholder="Caption (optional)"
                value={b.caption ?? ""}
                onChange={(e) => update(b.id, { caption: e.target.value })}
              />
            </div>
          )}

          {b.kind === "video" && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Video className="h-4 w-4 text-gray-400 shrink-0" />
                <input
                  className="flex-1 text-sm text-gray-700 outline-none bg-transparent placeholder:text-gray-300"
                  placeholder="Video embed URL (e.g., YouTube embed link)..."
                  value={b.url}
                  onChange={(e) => update(b.id, { url: e.target.value })}
                />
              </div>
              <input
                className="w-full text-xs text-gray-400 outline-none bg-transparent placeholder:text-gray-200"
                placeholder="Caption (optional)"
                value={b.caption ?? ""}
                onChange={(e) => update(b.id, { caption: e.target.value })}
              />
              {b.url && (
                <div className="aspect-video bg-gray-900 rounded-lg overflow-hidden mt-2">
                  <iframe src={b.url} className="w-full h-full" allowFullScreen title="Preview" />
                </div>
              )}
            </div>
          )}

          {b.kind === "checkpoint" && (
            <div className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 shrink-0" style={{ color: "var(--c-accent)" }} />
                <input
                  className="flex-1 text-sm font-medium text-gray-900 outline-none bg-transparent placeholder:text-gray-300"
                  placeholder="Checkpoint question..."
                  value={b.question}
                  onChange={(e) => update(b.id, { question: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 pl-6">
                {b.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      onClick={() => update(b.id, { correct: i })}
                      className={cn(
                        "h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
                        i === b.correct ? "border-green-500 bg-green-500" : "border-gray-300",
                      )}
                    >
                      {i === b.correct && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </button>
                    <input
                      className="flex-1 text-sm text-gray-700 outline-none bg-transparent placeholder:text-gray-300 border-b border-transparent focus:border-gray-200 pb-0.5"
                      placeholder={`Option ${i + 1}`}
                      value={opt}
                      onChange={(e) => {
                        const opts = [...b.options];
                        opts[i] = e.target.value;
                        update(b.id, { options: opts });
                      }}
                    />
                    {b.options.length > 2 && (
                      <button
                        onClick={() => {
                          const opts = b.options.filter((_, j) => j !== i);
                          update(b.id, { options: opts, correct: Math.min(b.correct, opts.length - 1) });
                        }}
                        className="text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => update(b.id, { options: [...b.options, ""] })}
                  className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mt-1"
                >
                  <Plus className="h-3 w-3" />Add option
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Add block toolbar */}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-xs text-gray-400 font-medium">Add:</span>
        {[
          { kind: "heading" as const, icon: Heading1, label: "Heading" },
          { kind: "text" as const, icon: Type, label: "Text" },
          { kind: "image" as const, icon: ImageIcon, label: "Image" },
          { kind: "video" as const, icon: Video, label: "Video" },
          { kind: "checkpoint" as const, icon: HelpCircle, label: "Checkpoint" },
        ].map(({ kind, icon: Icon, label }) => (
          <button
            key={kind}
            onClick={() => addBlock(kind)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-400 hover:text-gray-900 hover:bg-gray-50 transition-all"
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

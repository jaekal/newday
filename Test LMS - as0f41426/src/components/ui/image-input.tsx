"use client";

import { useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  previewAlt?: string;
  uploadLabel?: string;
  compact?: boolean;
};

async function readFileAsDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

export function ImageInput({
  value,
  onChange,
  placeholder = "Paste an image URL",
  previewAlt = "Image preview",
  uploadLabel = "Browse image",
  compact = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    const dataUrl = await readFileAsDataUrl(file);
    onChange(dataUrl);
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        event.preventDefault();
        const dataUrl = await readFileAsDataUrl(file);
        onChange(dataUrl);
        return;
      }
    }

    const pastedText = event.clipboardData.getData("text").trim();
    if (pastedText.startsWith("http://") || pastedText.startsWith("https://") || pastedText.startsWith("data:image/")) {
      onChange(pastedText);
    }
  }

  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-dashed px-3 py-3 transition-colors",
        isDragging ? "border-[var(--c-accent)] bg-gray-50" : "border-gray-200",
        compact && "rounded-lg px-2.5 py-2",
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={async (event) => {
        event.preventDefault();
        setIsDragging(false);
        await handleFiles(event.dataTransfer.files);
      }}
      onPaste={handlePaste}
    >
      <div className={cn("flex flex-wrap items-center gap-2", compact && "gap-1.5")}>
        <Button type="button" variant="outline" size={compact ? "sm" : "default"} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4" />
          {uploadLabel}
        </Button>
        <div className="min-w-[220px] flex-1">
          <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
        </div>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (event) => {
          await handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <ImagePlus className="h-3.5 w-3.5" />
        Drag and drop, paste, browse, or enter an image URL
      </div>

      {value && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt={previewAlt} className="max-h-56 w-full object-contain" />
        </div>
      )}
    </div>
  );
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatScore(score: number, max: number) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return `${score}/${max} (${pct}%)`;
}

export function toCsvValue(value: string | number | boolean | null | undefined) {
  const normalized = value == null ? "" : String(value);
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

export function buildCsv(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
) {
  return [
    headers.map((header) => toCsvValue(header)).join(","),
    ...rows.map((row) => row.map((cell) => toCsvValue(cell)).join(",")),
  ].join("\n");
}

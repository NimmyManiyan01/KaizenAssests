import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateProductSKU(name?: string, existingCodes: string[] = []): string {
  const cleanName = (name || "").trim();
  let prefix = "PRD";

  if (cleanName) {
    const words = cleanName.split(/[\s_-]+/).filter(Boolean);
    const firstWord = words[0];
    if (words.length >= 2) {
      prefix = words.slice(0, 3).map((w) => (w && w[0] ? w[0].toUpperCase() : "")).join("");
    } else if (firstWord) {
      prefix = firstWord.slice(0, 4).toUpperCase();
    }
    prefix = prefix.replace(/[^A-Z0-9]/g, "");
    if (!prefix) prefix = "PRD";
  }

  let seq = 1;
  let candidate = `FG-${prefix}-${String(seq).padStart(3, "0")}`;
  while (existingCodes.includes(candidate) && seq < 999) {
    seq++;
    candidate = `FG-${prefix}-${String(seq).padStart(3, "0")}`;
  }
  return candidate;
}

/**
 * Formats a timestamp into Indian Standard Time (IST, UTC+5:30) following Indian locale conventions.
 * E.g., '16/11/2026, 10:01:47 am'
 */
export function formatToIST(value?: string | null): string {
  if (!value) return "Never";
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const hasTimezone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(normalized);
  const date = new Date(hasTimezone ? normalized : `${normalized}Z`);
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}


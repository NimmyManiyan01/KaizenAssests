export function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parsePositiveNumber(value: unknown): number | null {
  const parsed = parseNonNegativeNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function isValidDateInput(value: string): boolean {
  if (!value.trim()) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function sanitizeVehicleNumber(value: string): string {
  return value.replace(/[^A-Za-z0-9 ]/g, "");
}

export function isValidVehicleNumber(value: string): boolean {
  return /^[A-Za-z0-9 ]+$/.test(value.trim());
}

export function sanitizePersonName(value: string): string {
  return value.replace(/[^A-Za-z ]/g, "");
}

export function isValidPersonName(value: string): boolean {
  return /^[A-Za-z ]+$/.test(value.trim()) && value.trim().length >= 2;
}

export function sanitizeMobileNumber(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 10);
}

export function isValidMobileNumber(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

export function isValidIdentifier(value: string, pattern = /^[A-Za-z0-9/_-]+$/): boolean {
  return pattern.test(value.trim());
}

export function isValidUpload(file: File, allowedTypes: readonly string[], maxBytes = 5 * 1024 * 1024): boolean {
  return allowedTypes.includes(file.type) && file.size > 0 && file.size <= maxBytes;
}

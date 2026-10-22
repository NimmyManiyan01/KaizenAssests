/** Keep wire aliases while exposing consistent GRN fields to the wizard. */
export function normalizeGrnResponse<T>(value: T): T {
  if (Array.isArray(value)) return value.map(normalizeGrnResponse) as T;
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalized = normalizeGrnResponse(entry);
    result[key] = normalized;
    const snake = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (!(snake in result)) result[snake] = normalized;
  }
  return result as T;
}

// Shared helpers for turning messy, hand-maintained mill paperwork into typed values.

/** "16.09.26" | "16-09-2026" | "16/09/26" -> "2026-09-16". Returns null if unparseable. */
export function parseMillDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (!m) return null;
  const [, dd, mm, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const day = Number(dd);
  const month = Number(mm);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Coerces a cell value to a finite number, or undefined. Rejects Excel error strings like #DIV/0!. */
export function toNum(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (raw && typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    return toNum((raw as Record<string, unknown>).result);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s.startsWith("#")) return undefined;
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Coerces a cell to a trimmed string, or "" for empty/null. */
export function toStr(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "object" && "richText" in (raw as Record<string, unknown>)) {
    const parts = (raw as { richText: { text: string }[] }).richText;
    return parts.map((p) => p.text).join("").trim();
  }
  if (typeof raw === "object" && "result" in (raw as Record<string, unknown>)) {
    return toStr((raw as Record<string, unknown>).result);
  }
  return String(raw).trim();
}

/** "12:30" or "12.30" (hours:minutes as commonly hand-written) -> decimal hours. */
export function hhmmToDecimalHours(raw: string): number | undefined {
  const m = raw.match(/(\d{1,3})[:.h](\d{2})/);
  if (!m) return undefined;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return undefined;
  return hours + minutes / 60;
}

export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

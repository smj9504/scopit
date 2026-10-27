/**
 * Scopit - PDF Editor: page ranges as people type them ("1-3, 5, 8-")
 */

/**
 * Page numbers (sorted, unique, 1-based) for a range list like "1-3, 5" or
 * "8-" (to the end). Null when it isn't one, or names a page past `pageCount`.
 */
export function parsePageRanges(text: string, pageCount: number): number[] | null {
  const pages = new Set<number>();
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  for (const part of parts) {
    // "3", "3-5", "3-", "-5" (a second number only after the dash)
    const m = /^(\d+)?\s*(?:(-)\s*(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return null;
    const start = m[1] ? Number(m[1]) : 1;
    const end = m[2] ? (m[3] ? Number(m[3]) : pageCount) : start;
    if (start < 1 || end > pageCount || start > end) return null;
    for (let p = start; p <= end; p++) pages.add(p);
  }
  return Array.from(pages).sort((a, b) => a - b);
}

/** [1, 2, 3, 5] -> "1-3, 5" */
export function formatPageRanges(pages: number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    parts.push(start === sorted[i] ? String(start) : `${start}-${sorted[i]}`);
  }
  return parts.join(', ');
}

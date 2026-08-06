/**
 * Scopit - Packing Tool: Session Status
 * Single source of truth for the draft/completed distinction shown in
 * HistoryTab and computed by PackingTool when saving a session.
 */
import type { EstimateResponse, PackingSessionData, SessionStatus } from './types';

export interface PackingStatusInput {
  /** May carry a transient `_stale` flag set client-side after edits invalidate a calculated result. */
  result?: (EstimateResponse & { _stale?: boolean }) | null;
  manually_completed?: boolean;
  linked_estimate_id?: string;
  linked_invoice_id?: string;
}

/**
 * Draft vs. completed, derived from real signals instead of "a result exists":
 * - A stale result (rooms edited since the last calculate) always forces draft,
 *   even if it was previously marked completed or converted.
 * - Otherwise, completed only when the user explicitly marked it done, or the
 *   session was actually converted into a real Estimate/Invoice.
 */
export function derivePackingStatus(input: PackingStatusInput): SessionStatus {
  if (input.result?._stale) return 'draft';
  const completed = !!(
    input.manually_completed ||
    input.linked_estimate_id ||
    input.linked_invoice_id
  );
  return completed ? 'completed' : 'draft';
}

/** result is stripped in list/summary views; grand_total survives as a top-level fallback. */
export function getGrandTotal(d: PackingSessionData | null | undefined): number | undefined {
  return d?.result?.grand_total ?? d?.grand_total;
}

/**
 * Status for list/summary views, where `status` is normally already the
 * authoritative saved value. Only legacy sessions saved before this field
 * existed fall back to inferring from the presence of a total.
 */
export function deriveHistoryStatus(d: PackingSessionData | null | undefined): SessionStatus {
  return d?.status ?? (getGrandTotal(d) ? 'completed' : 'draft');
}

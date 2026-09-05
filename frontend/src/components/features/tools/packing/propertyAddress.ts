/**
 * Scopit - Packing Tool: Property Address
 * Single source of truth for rendering a session's property address, so the
 * history list, the editor header, the client cards, the generated document
 * titles and the export filenames all show the same thing.
 */
import type { ClientInfo } from './types';

/** Every call site reads this off session data typed as `any`, so accept a partial. */
type PropertyAddressFields = Partial<
  Pick<
    ClientInfo,
    | 'property_address_line1'
    | 'property_address_line2'
    | 'property_city'
    | 'property_state'
    | 'property_zipcode'
  >
>;

/**
 * Full property address — "1234 Oak Street, Suite 210, Springfield, IL 62701".
 * State and ZIP stay in one segment, matching the street/city/state-zip
 * grouping the Estimates and Invoices lists use. Missing parts drop out, so
 * partially filled addresses degrade to whatever is known.
 */
export function formatPropertyAddress(
  clientInfo: PropertyAddressFields | null | undefined,
): string {
  if (!clientInfo) return '';
  const stateZip = [clientInfo.property_state, clientInfo.property_zipcode]
    .filter(Boolean)
    .join(' ');
  return [
    clientInfo.property_address_line1,
    clientInfo.property_address_line2,
    clientInfo.property_city,
    stateZip,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Same address, reduced to what a filename can hold — characters Windows and
 * macOS reject are stripped and runs of whitespace collapsed. Empty when the
 * session has no address, which callers use to fall back to a session id.
 */
export function formatPropertyAddressForFilename(
  clientInfo: PropertyAddressFields | null | undefined,
): string {
  return formatPropertyAddress(clientInfo)
    .replace(/[<>:"/\\|?*]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

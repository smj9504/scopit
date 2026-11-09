/**
 * Official license lookups. Links checked 2026-11-09 (see docs/SOURCES.md).
 * Used on the directory, profiles, the cornerstone guide, and in /admin.
 */
import type { StateCode } from './constants';

export const LICENSE_LOOKUPS: Record<StateCode, { label: string; url: string; publisher: string }> = {
  VA: {
    label: 'Virginia SCC producer search',
    url: 'https://www.scc.virginia.gov/boi/consumerinquiry/',
    publisher: 'Virginia State Corporation Commission, Bureau of Insurance',
  },
  MD: {
    label: 'Maryland Insurance Administration producer search',
    url: 'https://www.apps.insurance.maryland.gov/CompanyProducerInfo/',
    publisher: 'Maryland Insurance Administration',
  },
  DC: {
    label: 'DC DISB license verification',
    url: 'https://disb.dc.gov/service/verify-financial-institution-or-representative-licensed-disb',
    publisher: 'DC Department of Insurance, Securities and Banking',
  },
};

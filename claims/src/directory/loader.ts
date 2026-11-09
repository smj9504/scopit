/**
 * Content loader for the public adjuster directory.
 *
 * Where listings come from is set by CLAIMS_DIRECTORY_SOURCE at build time:
 *   d1       Cloudflare D1 over the REST API (production and previews).
 *            Needs CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN.
 *            A failed fetch fails the build, so a broken token can never
 *            silently empty (or worse, corrupt) the directory.
 *   fixture  The labeled dev fixture in src/dev-fixtures/. Local only:
 *            refused on Cloudflare builds and when CLAIMS_ENV=production.
 *   (unset)  No listings. The directory shows its empty state.
 *
 * Every row passes through toPublicListings(), which drops anything that is
 * not admin-verified with a current, verified license.
 */
import type { Loader } from 'astro/loaders';
import { readFile } from 'node:fs/promises';
import { toPublicListings, VERIFIED_LISTINGS_SQL, type ListingRow } from '../shared/directory';
import { todayIso } from '../shared/dates';
import { queryD1 } from './d1-rest';

export function directoryLoader(): Loader {
  return {
    name: 'scopit-claims-directory',
    async load({ store, logger, parseData }) {
      store.clear();
      const source = (process.env.CLAIMS_DIRECTORY_SOURCE || '').trim();
      const today = todayIso();
      let rows: ListingRow[] = [];
      let fixture = false;

      if (source === 'd1') {
        const accountId = process.env.CF_ACCOUNT_ID;
        const databaseId = process.env.CF_D1_DATABASE_ID;
        const token = process.env.CF_D1_API_TOKEN;
        if (!accountId || !databaseId || !token) {
          throw new Error(
            'CLAIMS_DIRECTORY_SOURCE=d1 needs CF_ACCOUNT_ID, CF_D1_DATABASE_ID, and CF_D1_API_TOKEN. See docs/DEPLOY.md.',
          );
        }
        rows = await queryD1<ListingRow>({ accountId, databaseId, token }, VERIFIED_LISTINGS_SQL);
        logger.info(`Loaded ${rows.length} verified listing row(s) from D1.`);
      } else if (source === 'fixture') {
        if (process.env.CF_PAGES === '1' || process.env.CLAIMS_ENV === 'production') {
          throw new Error('Refusing to build the dev fixture into a Cloudflare or production build.');
        }
        const raw = await readFile(new URL('../dev-fixtures/adjusters.dev.json', import.meta.url), 'utf8');
        rows = (JSON.parse(raw) as { rows: ListingRow[] }).rows;
        fixture = true;
        logger.warn('Using the DEV FIXTURE directory. These adjusters are not real.');
      } else {
        if (process.env.CLAIMS_ENV === 'production') {
          throw new Error('Production builds must set CLAIMS_DIRECTORY_SOURCE=d1.');
        }
        logger.info('No directory source set; the directory will show its empty state.');
      }

      for (const listing of toPublicListings(rows, today, fixture)) {
        const data = await parseData({ id: listing.slug, data: { ...listing } });
        store.set({ id: listing.slug, data });
      }
    },
  };
}

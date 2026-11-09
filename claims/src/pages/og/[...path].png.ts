/**
 * Open Graph images, rendered at build time (1200×630 PNG) in the same
 * "estimate notes" style: one per guide, one per note, and a default.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getGuides, getNotes } from '../../content-helpers';
import { SITE } from '../../site';

interface OgProps {
  label: string;
  title: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const guides = await getGuides();
  const notes = await getNotes();
  return [
    { params: { path: 'default' }, props: { label: 'Guides for homeowners · VA · MD · DC', title: 'Pipe burst? Water damage? You may be able to file a claim.' } },
    ...guides.map((g) => ({ params: { path: `guides/${g.id}` }, props: { label: 'Guide for homeowners', title: g.data.title } })),
    ...notes.map((n) => ({ params: { path: `notes/${n.id}` }, props: { label: 'Estimating note', title: n.data.title } })),
  ];
};

const require = createRequire(import.meta.url);
let fontsPromise: Promise<{ name: string; data: Buffer; weight: 400 | 500 | 600 | 700; style: 'normal' }[]> | null = null;

function loadFonts() {
  fontsPromise ??= (async () => {
    const sans = (w: number) => require.resolve(`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${w}-normal.woff`);
    const mono = require.resolve('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff');
    return [
      { name: 'Plex Sans', data: await readFile(sans(400)), weight: 400 as const, style: 'normal' as const },
      { name: 'Plex Sans', data: await readFile(sans(700)), weight: 700 as const, style: 'normal' as const },
      { name: 'Plex Mono', data: await readFile(mono), weight: 500 as const, style: 'normal' as const },
    ];
  })();
  return fontsPromise;
}

type Node = { type: string; props: Record<string, unknown> & { children?: Node | Node[] | string | (Node | string)[] } };
const h = (type: string, style: Record<string, unknown>, children?: Node['props']['children']): Node => ({
  type,
  props: { style, children },
});

export const GET: APIRoute = async ({ props }) => {
  const { label, title } = props as OgProps;
  const host = new URL(import.meta.env.SITE || 'https://claims.scopit.work').host;
  const titleSize = title.length > 70 ? 58 : title.length > 45 ? 66 : 76;

  const tree = h(
    'div',
    {
      width: '1200px',
      height: '630px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      background: '#f5f4ee',
      padding: '56px 64px',
      border: '12px solid #15201b',
      fontFamily: 'Plex Sans',
      color: '#15201b',
    },
    [
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
        h('div', { display: 'flex', alignItems: 'center', gap: '14px' }, [
          h('div', { fontSize: '34px', fontWeight: 700 }, 'Scopit'),
          h(
            'div',
            { fontFamily: 'Plex Mono', fontSize: '22px', background: '#f4da4a', border: '2px solid #15201b', padding: '2px 10px', letterSpacing: '2px' },
            'CLAIMS',
          ),
        ]),
        h('div', { fontFamily: 'Plex Mono', fontSize: '22px', color: '#4a5750', letterSpacing: '1px' }, label.toUpperCase()),
      ]),
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', { fontSize: `${titleSize}px`, fontWeight: 700, lineHeight: 1.08, letterSpacing: '-1px', maxWidth: '1020px' }, title),
        h('div', { width: '220px', height: '18px', background: '#f4da4a', marginTop: '26px' }),
      ]),
      h('div', { display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #15201b', paddingTop: '18px', fontFamily: 'Plex Mono', fontSize: '22px', color: '#4a5750' }, [
        h('div', {}, `${SITE.name} · Free to read · Not legal advice`),
        h('div', {}, host),
      ]),
    ],
  );

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};

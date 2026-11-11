/**
 * Open Graph images, rendered at build time (1200×630 PNG) in the site's
 * style: warm white, a light headline, and the warm sphere. One per guide,
 * one per note, and a default.
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
type Weight = 300 | 400 | 500 | 600;
let fontsPromise: Promise<{ name: string; data: Buffer; weight: Weight; style: 'normal' }[]> | null = null;

function loadFonts() {
  fontsPromise ??= (async () => {
    const file = (w: Weight) => require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff`);
    const weights: Weight[] = [300, 400, 500, 600];
    return Promise.all(
      weights.map(async (weight) => ({ name: 'Inter', data: await readFile(file(weight)), weight, style: 'normal' as const })),
    );
  })();
  return fontsPromise;
}

type Node = { type: string; props: Record<string, unknown> & { children?: Node | Node[] | string | (Node | string)[] } };
const h = (type: string, style: Record<string, unknown>, children?: Node['props']['children']): Node => ({
  type,
  props: { style, children },
});

/** The site's warm sphere (see .orb in global.css), without the grain. */
const orb = (size: number, extra: Record<string, unknown> = {}) =>
  h('div', {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: '50%',
    backgroundImage: [
      'radial-gradient(circle at 32% 26%, rgba(255,255,255,0.9), rgba(255,255,255,0) 32%)',
      'radial-gradient(circle at 74% 70%, rgba(236,72,120,0.85), rgba(236,72,120,0) 48%)',
      'radial-gradient(circle at 26% 72%, rgba(255,196,70,0.95), rgba(255,196,70,0) 52%)',
      'radial-gradient(circle at 50% 50%, #f07a3a, #c4471f)',
    ].join(', '),
    ...extra,
  });

export const GET: APIRoute = async ({ props }) => {
  const { label, title } = props as OgProps;
  const host = new URL(import.meta.env.SITE || 'https://claims.scopit.work').host;
  const titleSize = title.length > 70 ? 54 : title.length > 45 ? 62 : 70;

  const tree = h(
    'div',
    {
      width: '1200px',
      height: '630px',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      position: 'relative',
      background: '#fdfcfc',
      padding: '56px 64px',
      fontFamily: 'Inter',
      color: '#000000',
    },
    [
      // A cream stage on the right holding the sphere.
      h(
        'div',
        {
          position: 'absolute',
          top: '56px',
          right: '64px',
          width: '300px',
          height: '360px',
          borderRadius: '24px',
          background: '#f5f3f1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        },
        [orb(176)],
      ),
      h('div', { display: 'flex', alignItems: 'center', gap: '12px' }, [
        orb(30),
        h('div', { fontSize: '32px', fontWeight: 600, letterSpacing: '-0.6px' }, 'Scopit'),
        h('div', { fontSize: '32px', fontWeight: 400, letterSpacing: '-0.6px', color: '#6b655e' }, 'Claims'),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', maxWidth: '700px' }, [
        h('div', { fontSize: '24px', fontWeight: 500, color: '#6b655e', marginBottom: '18px' }, label),
        h('div', { fontSize: `${titleSize}px`, fontWeight: 300, lineHeight: 1.08, letterSpacing: '-1.6px' }, title),
      ]),
      h('div', { display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #ebe8e4', paddingTop: '20px', fontSize: '22px', color: '#6b655e' }, [
        h('div', {}, `${SITE.name} · Free to read · Not legal advice`),
        h('div', {}, host),
      ]),
    ],
  );

  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], { width: 1200, height: 630, fonts: await loadFonts() });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
};

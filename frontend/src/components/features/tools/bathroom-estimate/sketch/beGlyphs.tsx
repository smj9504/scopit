/**
 * Plan-view glyphs for the sketch's tools and fixtures: each one is the
 * fixture as the plan draws it from above, so the button and the drawing
 * read alike. 16px, one 1.25 stroke, currentColor.
 */

import React from 'react';
import type { BEFixtureType } from '@/types/bathroomSketch';

const Svg: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const FIXTURE_GLYPHS: Record<BEFixtureType, React.ReactNode> = {
  bathtub: (
    <Svg>
      <rect x="1.5" y="4" width="13" height="8" rx="1" />
      <rect x="3.25" y="5.5" width="9.5" height="5" rx="2.5" />
    </Svg>
  ),
  shower: (
    <Svg>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 2l12 12M14 2L2 14" opacity="0.45" />
      <circle cx="8" cy="8" r="1.4" />
    </Svg>
  ),
  vanity: (
    <Svg>
      <rect x="1.5" y="4" width="13" height="8" rx="1" />
      <ellipse cx="8" cy="8" rx="3.5" ry="2" />
    </Svg>
  ),
  toilet: (
    <Svg>
      <rect x="3.5" y="1.5" width="9" height="3.5" rx="0.75" />
      <ellipse cx="8" cy="9.75" rx="3.25" ry="4.25" />
    </Svg>
  ),
  door: (
    <Svg>
      <path d="M2.5 14V2.5" />
      <path d="M2.5 2.5A11.5 11.5 0 0 1 14 14" opacity="0.55" />
      <path d="M1.5 14h13" />
    </Svg>
  ),
  window: (
    <Svg>
      <rect x="1.5" y="6" width="13" height="4" rx="0.5" />
      <path d="M1.5 8h13" />
    </Svg>
  ),
  mirror: (
    <Svg>
      <rect x="3.5" y="1.5" width="9" height="13" rx="1.5" />
      <path d="M6 6l2.5-2.5M6 9l4.5-4.5" opacity="0.55" />
    </Svg>
  ),
  light: (
    <Svg>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M4.1 4.1l7.8 7.8M11.9 4.1l-7.8 7.8" />
    </Svg>
  ),
  // A box on the wall, its door marked like the plan draws it
  cabinet: (
    <Svg>
      <path d="M1.5 4.5h13" />
      <rect x="2.5" y="4.5" width="11" height="5" rx="0.5" />
      <path d="M2.5 9.5l11-5" opacity="0.55" />
    </Svg>
  ),
  // A lowered ceiling: dashed, as anything overhead on a plan
  soffit: (
    <Svg>
      <rect x="1.5" y="3.5" width="13" height="9" rx="0.5" strokeDasharray="2 1.6" />
      <path d="M1.5 3.5l13 9M14.5 3.5l-13 9" opacity="0.45" />
    </Svg>
  ),
};

/** A wall seen from above: a solid bar */
export const WallGlyph: React.FC = () => (
  <Svg>
    <rect x="1.5" y="6.25" width="13" height="3.5" rx="0.5" fill="currentColor" stroke="none" />
  </Svg>
);

/** A room: its outline with the corners marked, as you click them */
export const RoomGlyph: React.FC = () => (
  <Svg>
    <path d="M3 3h10v10H3z" />
    <circle cx="3" cy="3" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="13" cy="3" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="13" cy="13" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="3" cy="13" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

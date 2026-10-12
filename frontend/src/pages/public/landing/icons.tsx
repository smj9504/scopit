/**
 * Stroke icons used across the landing page. One stroke width and cap style so
 * every glyph reads as part of the same set.
 */
import React from 'react';

type IconProps = { size?: number; strokeWidth?: number };

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({ size = 22, strokeWidth = 2, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const BoxIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5z" />
    <path d="M3 8v8l9 5 9-5V8" />
    <path d="M12 13v8" />
  </Svg>
);

export const HouseIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v10h14V10" />
  </Svg>
);

export const SearchIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Svg>
);

export const PenIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </Svg>
);

export const DropletIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />
  </Svg>
);

export const RoofIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M2 13l10-8 10 8" />
    <path d="M5 11v8h14v-8" />
    <path d="M16 7V4h2v4.6" />
  </Svg>
);

export const TruckIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M2 6h12v10H2z" />
    <path d="M14 9h4l3 3.5V16h-7z" />
    <circle cx="6" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Svg>
);

export const CheckIcon: React.FC<IconProps> = (p) => (
  <Svg strokeWidth={3} size={16} {...p}>
    <path d="M5 12l5 5 9-10" />
  </Svg>
);

export const MenuIcon: React.FC<IconProps> = (p) => (
  <Svg size={20} {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const CloseIcon: React.FC<IconProps> = (p) => (
  <Svg size={20} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

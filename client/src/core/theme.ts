// SPDX-License-Identifier: Apache-2.0
//
// Charter theme → rendered atmosphere. The layout grammar here (four
// phases, relight-never-relayout, sun arc shape) is engine-fixed; every
// color comes from the charter's tokens via the canonical name→color
// mapping. No world-specific constants (CLAUDE.md invariant 5).
import { colorFor, hslToHex } from '@fableton/engine/color';
import type { ThemeTokens } from './types.js';

// Engine defaults for a charter that omits a theme token: deliberately
// nobody's world — neutral stone and bone, a plain gold accent. A world
// must never inherit another world's values (CLAUDE.md invariant 5).
export const ENGINE_DEFAULT_THEME: ThemeTokens = {
  theme: 'unthemed',
  palette: ['stone', 'slate', 'bone', 'midnight'],
  accent: 'gold',
  typography: { display: 'Georgia', mono: 'ui-monospace' },
};

export interface WorldTheme {
  paletteHex: string[];
  accentHex: string;
  display: string;
  mono: string;
}

export interface PhaseLighting {
  /** Emissive intensity for building windows (lamplit evenings glow). */
  windowGlow: number;
  /** Normalized sun direction, y-up. */
  sunPosition: [number, number, number];
  sunIntensity: number;
  sunColor: string;
  ambientIntensity: number;
  gradientTop: string;
  gradientBottom: string;
  fogColor: string;
}

export function deriveTheme(tokens?: Partial<ThemeTokens>): WorldTheme {
  const palette =
    tokens?.palette && tokens.palette.length > 0 ? tokens.palette : ENGINE_DEFAULT_THEME.palette;
  return {
    paletteHex: palette.map(colorFor),
    accentHex: colorFor(tokens?.accent ?? ENGINE_DEFAULT_THEME.accent),
    display: tokens?.typography?.display ?? ENGINE_DEFAULT_THEME.typography.display,
    mono: tokens?.typography?.mono ?? ENGINE_DEFAULT_THEME.typography.mono,
  };
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: ((h * 60) % 360 + 360) % 360, s: s * 100, l: l * 100 };
}

const shade = (hex: string, dl: number, ds = 0): string => {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, Math.min(100, Math.max(0, s + ds)), Math.min(100, Math.max(0, l + dl)));
};

// The engine-fixed day arc: dawn low in the east, noon high, dusk low in
// the west, night a dim moon. Phase changes relight, never relayout.
const PHASE_GRAMMAR = [
  { sun: [30, 14, 8], intensity: 1.5, warmth: +8, ambient: 0.75, skyLift: +6, glow: 0.25 },
  { sun: [6, 30, 6], intensity: 2.2, warmth: 0, ambient: 0.95, skyLift: +14, glow: 0 },
  { sun: [-26, 10, 10], intensity: 1.3, warmth: +16, ambient: 0.6, skyLift: -4, glow: 1 },
  { sun: [-10, 18, -22], intensity: 0.45, warmth: -20, ambient: 0.35, skyLift: -30, glow: 0.8 },
] as const;

export function phaseLighting(phaseIndex: number, theme: WorldTheme): PhaseLighting {
  const grammar = PHASE_GRAMMAR[((phaseIndex % 4) + 4) % 4]!;
  const sky = theme.paletteHex[theme.paletteHex.length - 1]!;
  const ground = theme.paletteHex[0]!;
  const accent = hexToHsl(theme.accentHex);
  return {
    windowGlow: grammar.glow,
    sunPosition: [...grammar.sun] as [number, number, number],
    sunIntensity: grammar.intensity,
    sunColor: hslToHex(
      grammar.warmth >= 0 ? accent.h : 230,
      Math.min(100, 30 + Math.abs(grammar.warmth) * 2),
      78,
    ),
    ambientIntensity: grammar.ambient,
    gradientTop: shade(sky, grammar.skyLift, -5),
    gradientBottom: shade(ground, grammar.skyLift - 8),
    fogColor: shade(sky, grammar.skyLift - 4, -10),
  };
}

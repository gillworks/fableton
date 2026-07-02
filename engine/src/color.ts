// SPDX-License-Identifier: Apache-2.0
//
// The canonical palette-name → color mapping, shared by the generator
// (chunk palettes) and the client (page atmosphere, accents). Browser-safe
// (no node imports) — exported as the "@fableton/engine/color" subpath so
// the client can import it without dragging in server-only modules.
import { deriveSeed } from './generate/rng.js';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

// The color vocabulary is engine grammar — world-agnostic English color
// words, checked in order (most specific first). Charter palette names
// like "soot black" or "ember orange" land where a reader expects;
// anything unrecognized falls back to the hash. Deterministic forever.
const COLOR_WORDS: [RegExp, Hsl][] = [
  [/parchment|cream|ivory/, { h: 45, s: 40, l: 86 }],
  [/soot|coal|charcoal|black/, { h: 28, s: 14, l: 12 }],
  [/umber/, { h: 28, s: 42, l: 32 }],
  [/ember|orange/, { h: 24, s: 82, l: 55 }],
  [/amber|honey|gold/, { h: 42, s: 78, l: 56 }],
  [/moss/, { h: 95, s: 32, l: 38 }],
  [/sage/, { h: 110, s: 18, l: 56 }],
  [/teal/, { h: 180, s: 48, l: 40 }],
  [/indigo/, { h: 245, s: 38, l: 34 }],
  [/navy|dusk|midnight/, { h: 230, s: 34, l: 26 }],
  [/sea|aqua/, { h: 168, s: 34, l: 46 }],
  [/sky|azure/, { h: 202, s: 46, l: 70 }],
  [/green/, { h: 130, s: 40, l: 44 }],
  [/blue/, { h: 215, s: 52, l: 50 }],
  [/red|crimson/, { h: 6, s: 62, l: 48 }],
  [/rust|copper|terracotta/, { h: 18, s: 60, l: 45 }],
  [/brown|earth|mud/, { h: 25, s: 38, l: 35 }],
  [/ash|grey|gray|slate|stone/, { h: 210, s: 9, l: 55 }],
  [/white|snow|bone/, { h: 40, s: 10, l: 92 }],
  [/purple|violet|plum/, { h: 275, s: 40, l: 45 }],
  [/pink|rose/, { h: 340, s: 55, l: 66 }],
];

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Charter palettes are evocative names ("warm parchment"); rendering needs
 * hex. Recognized color words anchor the hue; "dark/deep/banked" and
 * "pale/light/mist" shift lightness; a small hash jitter keeps distinct
 * names distinct. The same name is the same color in every world, on
 * every machine, forever.
 */
export function colorFor(name: string): string {
  const lower = name.toLowerCase();
  const hash = deriveSeed(0, name);
  const word = COLOR_WORDS.find(([re]) => re.test(lower));
  if (!word) {
    return hslToHex(hash % 360, 30 + ((hash >>> 9) % 30), 40 + ((hash >>> 17) % 25));
  }
  let { h, s, l } = word[1];
  if (/dark|deep|banked|shadow/.test(lower)) l -= 14;
  if (/pale|light|mist|faded/.test(lower)) l += 14;
  if (/warm/.test(lower)) h = (h + 354) % 360;
  // Jitter: same keyword, different names → visibly kin, not identical.
  h = (h + ((hash % 13) - 6) + 360) % 360;
  l = clamp(l + (((hash >>> 9) % 7) - 3), 6, 94);
  return hslToHex(h, clamp(s, 0, 100), l);
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

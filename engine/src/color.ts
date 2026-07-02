// SPDX-License-Identifier: Apache-2.0
//
// The canonical palette-name → color mapping, shared by the generator
// (chunk palettes) and the client (page atmosphere, accents). Browser-safe
// (no node imports) — exported as the "@fableton/engine/color" subpath so
// the client can import it without dragging in server-only modules.
import { deriveSeed } from './generate/rng.js';

/**
 * Charter palettes are evocative names ("warm parchment"); rendering needs
 * hex. Hash → hue with fixed sat/light bands, so the same name is the same
 * color in every world, on every machine, forever.
 */
export function colorFor(name: string): string {
  const h = deriveSeed(0, name);
  const hue = h % 360;
  const sat = 30 + ((h >>> 9) % 30);
  const light = 40 + ((h >>> 17) % 25);
  return hslToHex(hue, sat, light);
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

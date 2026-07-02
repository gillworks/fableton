// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { colorFor } from './color.js';

const hexToHsl = (hex: string): { h: number; s: number; l: number } => {
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
  return { h: (((h * 60) % 360) + 360) % 360, s: s * 100, l: l * 100 };
};

describe('colorFor', () => {
  it('is deterministic', () => {
    expect(colorFor('soot black')).toBe(colorFor('soot black'));
  });

  it('reads color words: soot black is dark, ember orange is orange, cream sky is light', () => {
    expect(hexToHsl(colorFor('soot black')).l).toBeLessThan(20);
    const ember = hexToHsl(colorFor('ember orange'));
    expect(ember.h).toBeGreaterThan(10);
    expect(ember.h).toBeLessThan(40);
    expect(hexToHsl(colorFor('cream sky')).l).toBeGreaterThan(75);
  });

  it('applies modifiers: banked coal darker than plain coal, pale stone lighter than stone', () => {
    expect(hexToHsl(colorFor('banked coal')).l).toBeLessThanOrEqual(hexToHsl(colorFor('coal')).l);
    expect(hexToHsl(colorFor('pale stone')).l).toBeGreaterThan(hexToHsl(colorFor('stone')).l);
  });

  it('kindred names differ (jitter) but stay in family', () => {
    expect(colorFor('moss')).not.toBe(colorFor('deep moss'));
    const a = hexToHsl(colorFor('moss'));
    const b = hexToHsl(colorFor('deep moss'));
    expect(Math.abs(a.h - b.h)).toBeLessThan(30);
  });

  it('falls back to the hash for names with no color word', () => {
    expect(colorFor('greta-the-baker')).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorFor('greta-the-baker')).not.toBe(colorFor('tam-the-lamplighter'));
  });
});

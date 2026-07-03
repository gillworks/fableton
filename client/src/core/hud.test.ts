// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { constructionSites, dayOf, hudInk } from './hud.js';
import { ENGINE_DEFAULT_THEME, deriveTheme } from './theme.js';
import { TICKS_PER_DAY } from './types.js';

describe('dayOf', () => {
  it('is 1-based and turns with the engine day length', () => {
    expect(dayOf(0)).toBe(1);
    expect(dayOf(TICKS_PER_DAY - 1)).toBe(1);
    expect(dayOf(TICKS_PER_DAY)).toBe(2);
    expect(dayOf(TICKS_PER_DAY * 41)).toBe(42);
  });
});

describe('constructionSites', () => {
  it('merges api sites with the ?construction= demo override', () => {
    const api = [{ chunk: 'chunk-0-0', pr: 7, url: 'https://example.test/pr/7' }];
    expect(constructionSites(api, '')).toEqual(api);
    expect(constructionSites(api, '?construction=chunk-1-1:142')).toEqual([
      ...api,
      { chunk: 'chunk-1-1', pr: 142 },
    ]);
    expect(constructionSites(undefined, '?construction=nonsense')).toEqual([]);
  });
});

describe('theme defaults (CLAUDE.md invariant 5)', () => {
  it('a charter omitting tokens gets engine defaults, never another world', () => {
    const bare = deriveTheme(undefined);
    expect(bare.display).toBe('Georgia');
    expect(bare.accentHex).toBe(deriveTheme(ENGINE_DEFAULT_THEME).accentHex);
    // The engine default accent is NOT the flagship's amber.
    const fableton = deriveTheme({
      theme: 'warm storybook',
      palette: ['moss', 'warm parchment', 'honey', 'dusk indigo'],
      accent: 'amber',
      typography: { display: 'Alegreya', mono: 'IBM Plex Mono' },
    });
    expect(bare.accentHex).not.toBe(fableton.accentHex);
    expect(bare.paletteHex).not.toEqual(fableton.paletteHex);
  });

  it('partial tokens fall back field by field', () => {
    const partial = deriveTheme({ accent: 'ember orange' });
    expect(partial.accentHex).toBe(deriveTheme({ accent: 'ember orange' }).accentHex);
    expect(partial.display).toBe('Georgia'); // engine default, not a world's face
    expect(partial.paletteHex).toEqual(deriveTheme(undefined).paletteHex);
  });
});

describe('hudInk', () => {
  it('pale skies get ink, dark skies get paper — engine grammar, any world', () => {
    expect(hudInk('#e8e4d4')).toBe('ink'); // a cream Skeinsea sky
    expect(hudInk('#241c14')).toBe('paper'); // a banked Cindervault sky
  });
});

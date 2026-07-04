// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLLOW,
  followSearch,
  followStep,
  parseFollowParam,
  type FollowCam,
} from './follow.js';

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) < eps;

describe('followStep', () => {
  const start: FollowCam = { position: [0, 0, 0], target: [0, 0, 0] };

  it('eases the eye behind the resident and the target onto their torso', () => {
    // Heading 0 → forward is +Z, so the eye trails toward -Z.
    const cam = followStep(start, [10, 0, 10], 0, 1000, DEFAULT_FOLLOW);
    // dt huge → k clamps to 1 → lands exactly on the ideal pose.
    expect(cam.position[0]).toBeCloseTo(10, 6);
    expect(cam.position[1]).toBeCloseTo(DEFAULT_FOLLOW.height, 6);
    expect(cam.position[2]).toBeCloseTo(10 - DEFAULT_FOLLOW.distance, 6);
    expect(cam.target).toEqual([10, DEFAULT_FOLLOW.lookHeight, 10]);
  });

  it('trails along the heading — facing +X puts the eye at -X', () => {
    const cam = followStep(start, [0, 0, 0], Math.PI / 2, 1000, DEFAULT_FOLLOW);
    expect(cam.position[0]).toBeCloseTo(-DEFAULT_FOLLOW.distance, 6);
    expect(near(cam.position[2], 0)).toBe(true);
  });

  it('is deterministic in its inputs (no clocks/globals)', () => {
    const a = followStep(start, [3, 0, 4], 1.2, 0.016);
    const b = followStep(start, [3, 0, 4], 1.2, 0.016);
    expect(a).toEqual(b);
  });

  it('approaches gradually for a small dt and clamps k to [0,1]', () => {
    const step = followStep(start, [10, 0, 0], Math.PI / 2, 0.016, DEFAULT_FOLLOW);
    // One 16ms frame moves only a fraction of the way, never overshoots.
    const k = 0.016 * DEFAULT_FOLLOW.rate;
    expect(step.target[0]).toBeCloseTo(10 * k, 6);
    // Negative dt can't push the camera backward past its current pose.
    const backward = followStep(start, [10, 0, 0], 0, -1, DEFAULT_FOLLOW);
    expect(backward).toEqual(start);
  });
});

describe('parseFollowParam', () => {
  it('accepts the kebab id grammar the generators emit', () => {
    expect(parseFollowParam('?follow=vesper')).toBe('vesper');
    expect(parseFollowParam('?follow=ninth-bell-odd')).toBe('ninth-bell-odd');
    expect(parseFollowParam('?construction=x&follow=haar')).toBe('haar');
  });

  it('returns null for a missing or malformed id (→ explore fallback)', () => {
    expect(parseFollowParam('')).toBeNull();
    expect(parseFollowParam('?follow=')).toBeNull();
    expect(parseFollowParam('?construction=chunk-0-0:1')).toBeNull();
    expect(parseFollowParam('?follow=../etc/passwd')).toBeNull();
    expect(parseFollowParam('?follow=Has Spaces')).toBeNull();
  });
});

describe('followSearch', () => {
  it('sets, clears, and preserves sibling params', () => {
    expect(followSearch('', 'vesper')).toBe('?follow=vesper');
    expect(followSearch('?follow=vesper', null)).toBe('');
    expect(followSearch('?construction=chunk-0-0:1', 'haar')).toBe(
      '?construction=chunk-0-0%3A1&follow=haar',
    );
    expect(followSearch('?construction=chunk-0-0:1&follow=haar', null)).toBe(
      '?construction=chunk-0-0%3A1',
    );
  });
});

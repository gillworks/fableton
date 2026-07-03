// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { TICK_HZ, clockAt, startTickAt, ticksPerPhaseFor } from './clock.js';

const PHASES = ['first light', 'high sun', 'lamplighting', 'hush'] as const;

describe('ticksPerPhaseFor', () => {
  it('spreads the charter day length across the four phases', () => {
    // 6 real hours per world day at 2 Hz → 43 200 ticks/day, 10 800/phase.
    expect(ticksPerPhaseFor(6, 4)).toBe((6 * 3600 * TICK_HZ) / 4);
  });

  it('never collapses below one tick per phase', () => {
    expect(ticksPerPhaseFor(0.0001, 4)).toBe(1);
  });
});

describe('startTickAt', () => {
  it('is zero at the founding instant and clamps a clock skewed before it', () => {
    const founded = Date.parse('2026-07-03T02:00:53Z');
    expect(startTickAt(founded, founded)).toBe(0);
    expect(startTickAt(founded, founded - 5000)).toBe(0);
  });

  it('resumes the derived day and phase after elapsed wall time', () => {
    const founded = Date.parse('2026-07-03T02:00:53Z');
    // A simulated week later, on a 6-hour day: 7*24h = 28 world days gone.
    const tick = startTickAt(founded, founded + 7 * 24 * 3600 * 1000);
    const clock = clockAt(tick, PHASES, ticksPerPhaseFor(6, PHASES.length));
    expect(clock.day).toBe(29);
    expect(clock.phase).toBe('first light');
    // Mid-afternoon restart lands mid-day, not at day 1 (the #57 bug).
    const midDay = startTickAt(founded, founded + 3 * 3600 * 1000);
    const midClock = clockAt(midDay, PHASES, ticksPerPhaseFor(6, PHASES.length));
    expect(midClock.day).toBe(1);
    expect(midClock.phase).toBe('lamplighting');
    expect(midClock.timeOfDay).toBeCloseTo(0.5, 2);
  });
});

// SPDX-License-Identifier: Apache-2.0
//
// The world clock: sim time is a pure function of the tick counter —
// never of wall time (CLAUDE.md invariant 3). Wall time only schedules
// ticks, out in the server layer.
export const TICK_HZ = 2;
export const TICK_DT = 1 / TICK_HZ;

/**
 * Ticks per phase for a charter-tuned day length (issue #57). One world
 * day spans `dayLengthHours` real hours at the fixed tick rate.
 */
export function ticksPerPhaseFor(dayLengthHours: number, phaseCount: number): number {
  return Math.max(1, Math.round((dayLengthHours * 3600 * TICK_HZ) / phaseCount));
}

/**
 * The tick a world resumes at, given when it was founded and what time it
 * is now — day N survives deploys because it is derived, not stored. Pure:
 * the server layer supplies both timestamps (invariant 3 keeps wall-clock
 * reads out of sim code).
 */
export function startTickAt(foundedAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor(((nowMs - foundedAtMs) / 1000) * TICK_HZ));
}

export interface ClockState {
  tick: number;
  phase: string;
  /** 0..1 through the whole day. */
  timeOfDay: number;
  /** 1-based day count. */
  day: number;
}

export function clockAt(tick: number, phases: readonly string[], ticksPerPhase: number): ClockState {
  const dayTicks = ticksPerPhase * phases.length;
  return {
    tick,
    phase: phases[Math.floor(tick / ticksPerPhase) % phases.length]!,
    timeOfDay: Math.round(((tick % dayTicks) / dayTicks) * 1000) / 1000,
    day: Math.floor(tick / dayTicks) + 1,
  };
}

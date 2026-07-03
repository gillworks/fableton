// SPDX-License-Identifier: Apache-2.0
//
// The world clock: sim time is a pure function of the tick counter —
// never of wall time (CLAUDE.md invariant 3). Wall time only schedules
// ticks, out in the server layer.
export const TICK_HZ = 2;
export const TICK_DT = 1 / TICK_HZ;

// Engine-fixed day grammar: 4 charter-named phases per day.
export const DEFAULT_TICKS_PER_PHASE = 600; // 5 minutes per phase at 2 Hz

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

// SPDX-License-Identifier: Apache-2.0
//
// The town calendar: which charter-defined event (if any) is in effect right
// now. Pure and deterministic — a function of the founded_at-derived world
// clock only (issue #57, CLAUDE.md invariant 3). No wall-clock reads, no
// hardcoded festival: the engine interprets charter DATA (invariant 1).
import type { CalendarEvent, Charter } from '../schemas/charter.js';
import type { ClockState } from './clock.js';

type Calendar = Charter['calendar'];

/**
 * Does this event occur on the given 1-based day? Deterministic off the day
 * count: the event lands every `every_days` days, first on `offset_days`.
 */
export function eventOccursOnDay(event: CalendarEvent, day: number): boolean {
  const elapsed = day - 1;
  if (elapsed < event.cadence.offset_days) return false;
  return (elapsed - event.cadence.offset_days) % event.cadence.every_days === 0;
}

/** Is the event in effect at this clock — the right day, and (if it names
 *  phases) the right phase? An empty `phases` means all day. */
export function eventActiveAt(event: CalendarEvent, clock: ClockState): boolean {
  if (!eventOccursOnDay(event, clock.day)) return false;
  return event.phases.length === 0 || event.phases.includes(clock.phase);
}

/**
 * The single event in effect right now — the first in charter declaration
 * order that is active, so overlapping events resolve deterministically.
 * null on an ordinary day, which the HUD and behavior trees read as "no
 * event".
 */
export function activeEvent(calendar: Calendar, clock: ClockState): CalendarEvent | null {
  for (const event of calendar.events) {
    if (eventActiveAt(event, clock)) return event;
  }
  return null;
}

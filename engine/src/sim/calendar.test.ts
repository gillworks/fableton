// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Charter } from '../schemas/charter.js';
import { activeEvent, eventActiveAt, eventOccursOnDay } from './calendar.js';
import type { ClockState } from './clock.js';

const event = (over: Partial<CalendarEvent> & { name: string }): CalendarEvent => ({
  cadence: { every_days: 7, offset_days: 0 },
  phases: [],
  ...over,
});

const clock = (day: number, phase: string): ClockState => ({ tick: 0, phase, timeOfDay: 0, day });

describe('eventOccursOnDay', () => {
  it('lands every every_days days, first on day 1 when offset is 0', () => {
    const weekly = event({ name: 'w', cadence: { every_days: 7, offset_days: 0 } });
    expect([1, 2, 7, 8, 15].map((d) => eventOccursOnDay(weekly, d))).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('shifts the first occurrence by offset_days', () => {
    const offset = event({ name: 'o', cadence: { every_days: 7, offset_days: 2 } });
    // Days before the offset never fire; the first is day 3, then every 7.
    expect([1, 2, 3, 10, 17].map((d) => eventOccursOnDay(offset, d))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it('every_days: 1 is a daily event', () => {
    const daily = event({ name: 'd', cadence: { every_days: 1, offset_days: 0 } });
    expect([1, 2, 3, 99].every((d) => eventOccursOnDay(daily, d))).toBe(true);
  });
});

describe('eventActiveAt', () => {
  const feast = event({ name: 'feast', cadence: { every_days: 3, offset_days: 0 }, phases: ['high sun'] });

  it('requires both the right day and (when named) the right phase', () => {
    expect(eventActiveAt(feast, clock(1, 'high sun'))).toBe(true);
    expect(eventActiveAt(feast, clock(1, 'first light'))).toBe(false); // wrong phase
    expect(eventActiveAt(feast, clock(2, 'high sun'))).toBe(false); // wrong day
  });

  it('empty phases means all day', () => {
    const allDay = event({ name: 'all', cadence: { every_days: 1, offset_days: 0 }, phases: [] });
    expect(eventActiveAt(allDay, clock(5, 'hush'))).toBe(true);
  });
});

describe('activeEvent', () => {
  const calendar = (events: CalendarEvent[]): Charter['calendar'] => ({ events });

  it('returns null on an ordinary day', () => {
    const cal = calendar([event({ name: 'w', cadence: { every_days: 7, offset_days: 0 } })]);
    expect(activeEvent(cal, clock(2, 'high sun'))).toBeNull();
  });

  it('resolves overlapping events by declaration order, deterministically', () => {
    const cal = calendar([
      event({ name: 'first', cadence: { every_days: 1, offset_days: 0 } }),
      event({ name: 'second', cadence: { every_days: 1, offset_days: 0 } }),
    ]);
    // Both are active every day; the first declared wins, every time.
    expect(activeEvent(cal, clock(1, 'high sun'))?.name).toBe('first');
    expect(activeEvent(cal, clock(9, 'hush'))?.name).toBe('first');
  });
});

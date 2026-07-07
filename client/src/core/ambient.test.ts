// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { ambientLabel } from './ambient.js';

describe('ambientLabel', () => {
  it('surfaces both the role and the live activity', () => {
    expect(ambientLabel('baker', 'kneading dough')).toEqual({
      role: 'baker',
      activity: 'kneading dough',
      show: true,
    });
  });

  it('shows the role alone before the first activity streams in', () => {
    expect(ambientLabel('healer', undefined)).toEqual({
      role: 'healer',
      activity: '',
      show: true,
    });
  });

  it('shows the activity alone when the role is unknown', () => {
    expect(ambientLabel(undefined, 'walking home')).toEqual({
      role: '',
      activity: 'walking home',
      show: true,
    });
  });

  it('does not repeat the role when the activity leaf is the role itself', () => {
    expect(ambientLabel('baker', 'Baker')).toEqual({
      role: 'baker',
      activity: '',
      show: true,
    });
  });

  it('trims surrounding whitespace on both parts', () => {
    expect(ambientLabel('  baker  ', '  kneading dough  ')).toEqual({
      role: 'baker',
      activity: 'kneading dough',
      show: true,
    });
  });

  it('hides the tag entirely when there is nothing to say', () => {
    expect(ambientLabel(undefined, undefined)).toEqual({ role: '', activity: '', show: false });
    expect(ambientLabel('', '   ')).toEqual({ role: '', activity: '', show: false });
  });
});

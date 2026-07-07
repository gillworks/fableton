// SPDX-License-Identifier: Apache-2.0
//
// Ambient legibility (issue #62): the floating tag over each resident should
// read who they ARE (role) and what they're DOING (live activity) at a
// glance, without opening the inspect panel. Pure: role + live activity in,
// render-ready parts out — kept out of the R3F layer per ADR-0002 so the
// composition is unit-testable.
export interface AmbientLabel {
  /** The resident's role (identity.kind), or '' when unknown. */
  role: string;
  /** The live behavior-tree leaf label, or '' before the first tick. */
  activity: string;
  /** Whether there is anything worth rendering at all. */
  show: boolean;
}

export function ambientLabel(
  role: string | undefined,
  activity: string | undefined,
): AmbientLabel {
  const r = (role ?? '').trim();
  const a = (activity ?? '').trim();
  // When the activity leaf is literally the role (some idle leaves are named
  // for the vocation), don't say it twice — the role line already carries it.
  const activityText = a.toLowerCase() === r.toLowerCase() ? '' : a;
  return { role: r, activity: activityText, show: r !== '' || activityText !== '' };
}

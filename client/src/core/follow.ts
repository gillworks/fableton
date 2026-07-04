// SPDX-License-Identifier: Apache-2.0
//
// Follow-camera math + deep-link parsing, out of React (ADR-0002): given
// the followed resident's world position and heading, where should the
// camera be this frame? Pure numbers — no three, no globals, no clocks —
// so the trailing pose is testable and deterministic in its inputs.

export interface FollowCam {
  /** Camera eye, world space. */
  position: [number, number, number];
  /** lookAt point, world space. */
  target: [number, number, number];
}

export interface FollowOptions {
  /** Trailing distance behind the resident, world units. */
  distance: number;
  /** Eye height above the resident's feet. */
  height: number;
  /** lookAt height above the resident's feet (roughly the torso). */
  lookHeight: number;
  /** Exponential approach rate; higher eases in faster. */
  rate: number;
}

export const DEFAULT_FOLLOW: FollowOptions = {
  distance: 5.5,
  height: 3,
  lookHeight: 1.1,
  rate: 2.4,
};

const damp = (from: number, to: number, k: number): number => from + (to - from) * k;

/**
 * One frame of the follow camera. The eye trails behind the resident
 * along their heading and eases toward the ideal pose; the target rides
 * their torso so the walk reads as a walk. A mesh rotated `heading` about
 * Y faces +Z rotated by heading — forward = (sin, cos) — so the eye sits
 * opposite that, behind them.
 */
export function followStep(
  current: FollowCam,
  npcPos: readonly [number, number, number],
  heading: number,
  dt: number,
  opts: FollowOptions = DEFAULT_FOLLOW,
): FollowCam {
  const k = Math.min(1, Math.max(0, dt * opts.rate));
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const idealPos: [number, number, number] = [
    npcPos[0] - fx * opts.distance,
    npcPos[1] + opts.height,
    npcPos[2] - fz * opts.distance,
  ];
  const idealTarget: [number, number, number] = [
    npcPos[0],
    npcPos[1] + opts.lookHeight,
    npcPos[2],
  ];
  return {
    position: [
      damp(current.position[0], idealPos[0], k),
      damp(current.position[1], idealPos[1], k),
      damp(current.position[2], idealPos[2], k),
    ],
    target: [
      damp(current.target[0], idealTarget[0], k),
      damp(current.target[1], idealTarget[1], k),
      damp(current.target[2], idealTarget[2], k),
    ],
  };
}

/**
 * Read ?follow=<npc-id> from a URL query string. Returns the candidate id
 * if it's well-formed (the id grammar the generators emit: lowercase
 * kebab, e.g. `vesper`, `ninth-bell-odd`), else null. Whether the id names
 * a real resident is settled against the world's roster at runtime — an
 * unknown id falls back to the explore camera.
 */
export function parseFollowParam(search: string): string | null {
  const raw = new URLSearchParams(search).get('follow');
  if (!raw) return null;
  return /^[a-z0-9][a-z0-9_-]*$/.test(raw) ? raw : null;
}

/**
 * The address-bar query string for a given follow selection, so the
 * followed world is shareable. Passing null clears the param (back to the
 * plain explore URL). Other params are preserved untouched.
 */
export function followSearch(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id) params.set('follow', id);
  else params.delete('follow');
  const q = params.toString();
  return q ? `?${q}` : '';
}

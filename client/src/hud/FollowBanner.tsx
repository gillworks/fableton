// SPDX-License-Identifier: Apache-2.0
//
// The follow banner: while the camera trails a resident, this rides the
// bottom of the frame with their name and live activity label — so the
// "what are they doing right now" stays legible even with the inspect
// panel closed (#80, legibility invariant). It reads the live tree label
// verbatim from the sim, same source as the inspect pill.
import { useEffect, useState, type ReactElement } from 'react';
import { PANEL_Z, HUD_ZOOM } from '../core/hud.js';
import type { SimState } from '../core/interpolator.js';
import type { WorldTheme } from '../core/theme.js';

const INK = '#1a1712';
const PAPER = '#f3ede2';

export interface FollowBannerProps {
  npcId: string;
  name: string;
  sim: SimState;
  theme: WorldTheme;
  onExit: () => void;
}

export function FollowBanner({ npcId, name, sim, theme, onExit }: FollowBannerProps): ReactElement {
  const [activity, setActivity] = useState(sim.activityOf(npcId));

  useEffect(() => {
    setActivity(sim.activityOf(npcId));
    sim.onActivity((npc, act) => {
      if (npc === npcId) setActivity(act);
    });
    // Listeners are additive and closure-guarded on npcId, so any leaked
    // subscription from a prior follow is inert (same pattern as the panel).
  }, [sim, npcId]);

  const mono = `"${theme.mono}", ui-monospace, monospace`;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 22,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: INK,
        color: PAPER,
        borderRadius: 999,
        padding: '9px 10px 9px 16px',
        boxShadow: '0 10px 30px rgba(20, 14, 6, 0.4)',
        fontFamily: mono,
        whiteSpace: 'nowrap',
        zoom: HUD_ZOOM,
        zIndex: PANEL_Z,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: theme.accentHex,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 12.5 }}>
        <span style={{ opacity: 0.62 }}>Following </span>
        <strong>{name}</strong>
        {activity && (
          <>
            <span style={{ opacity: 0.62 }}> · </span>
            {activity}
          </>
        )}
      </span>
      <button
        onClick={onExit}
        style={{
          border: 'none',
          background: 'rgba(243, 237, 226, 0.14)',
          color: PAPER,
          borderRadius: 999,
          padding: '4px 12px',
          fontFamily: mono,
          fontSize: 11.5,
          cursor: 'pointer',
        }}
      >
        Exit
      </button>
    </div>
  );
}

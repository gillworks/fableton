// SPDX-License-Identifier: Apache-2.0
//
// The inspect panel (docs/design.md anatomy, top to bottom): avatar ·
// name · role → bio → activity pill (live tree label) → RELATIONSHIPS →
// lore/tree footer. Parchment-cream in EVERY world — the panel is the
// reader's lamplight — so its surface colors are engine grammar; only
// the accent dot and typography come from the charter.
import { useEffect, useState, type ReactElement } from 'react';
import { PANEL_Z, HUD_ZOOM } from '../core/hud.js';
import { buildPanelData, type NpcDetail, type PanelData } from '../core/inspect.js';
import type { SimState } from '../core/interpolator.js';
import type { WorldTheme } from '../core/theme.js';

const PARCHMENT = '#f6efe0';
const INK = '#2b241c';
const MUTED = '#8a7f6d';

export interface InspectPanelProps {
  npcId: string;
  sim: SimState;
  theme: WorldTheme;
  onClose: () => void;
  /** Whether the camera is currently following this resident. */
  following: boolean;
  onFollow: () => void;
  onExitFollow: () => void;
}

export function InspectPanel({
  npcId,
  sim,
  theme,
  onClose,
  following,
  onFollow,
  onExitFollow,
}: InspectPanelProps): ReactElement | null {
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [activity, setActivity] = useState(sim.activityOf(npcId));
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setPanel(null);
    setFailure(null);
    let stale = false;
    Promise.all([
      fetch(`/api/npcs/${npcId}`).then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<NpcDetail>;
      }),
      fetch('/api/npcs').then((r) => r.json() as Promise<{ id: string; name: string }[]>),
    ])
      .then(([detail, all]) => {
        if (stale) return;
        setPanel(buildPanelData(detail, new Map(all.map((n) => [n.id, n.name]))));
      })
      .catch((e) => setFailure(String(e)));
    return () => {
      stale = true;
    };
  }, [npcId]);

  useEffect(() => {
    setActivity(sim.activityOf(npcId));
    sim.onActivity((npc, act) => {
      if (npc === npcId) setActivity(act);
    });
    // SimState listeners are additive; the stale closure checks npcId so
    // leaked listeners from prior selections are inert.
  }, [sim, npcId]);

  if (failure) return null;

  const mono = `"${theme.mono}", ui-monospace, monospace`;
  const display = `"${theme.display}", Georgia, serif`;

  return (
    <aside
      style={{
        position: 'fixed',
        // Below the clock cluster (#72): the panel must never cover the
        // DAY pill, day bar, or phase selector.
        top: 132,
        right: 14,
        width: 292,
        background: PARCHMENT,
        color: INK,
        borderRadius: 14,
        padding: '18px 20px 14px',
        boxShadow: '0 12px 40px rgba(20, 14, 6, 0.35)',
        fontFamily: display,
        lineHeight: 1.45,
        zoom: HUD_ZOOM,
        zIndex: PANEL_Z,
      }}
    >
      <button
        onClick={onClose}
        aria-label="close"
        style={{
          position: 'absolute',
          top: 10,
          right: 12,
          border: 'none',
          background: 'none',
          color: MUTED,
          fontSize: 16,
          cursor: 'pointer',
          fontFamily: mono,
        }}
      >
        ×
      </button>
      {!panel ? (
        <div style={{ fontFamily: mono, fontSize: 12, color: MUTED }}>reading the lore…</div>
      ) : (
        <>
          <header style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                background: INK,
                color: PARCHMENT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {panel.initial}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 19 }}>{panel.name}</div>
              <div style={{ fontStyle: 'italic', fontSize: 13, color: MUTED }}>{panel.role}</div>
            </div>
          </header>

          <p style={{ margin: '0 0 12px', fontSize: 14 }}>{panel.bio}</p>

          <div
            data-testid="activity-pill"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: INK,
              color: PARCHMENT,
              borderRadius: 999,
              padding: '6px 12px',
              fontFamily: mono,
              fontSize: 11.5,
              marginBottom: 14,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: theme.accentHex,
                flexShrink: 0,
              }}
            />
            {activity}
          </div>

          <button
            onClick={following ? onExitFollow : onFollow}
            style={{
              width: '100%',
              border: following ? `1px solid ${MUTED}` : 'none',
              background: following ? 'transparent' : INK,
              color: following ? MUTED : PARCHMENT,
              borderRadius: 999,
              padding: '8px 12px',
              marginBottom: 14,
              fontFamily: mono,
              fontSize: 12,
              letterSpacing: 0.5,
              cursor: 'pointer',
            }}
          >
            {following ? 'Following — exit' : `Follow ${panel.name}`}
          </button>

          {panel.relationships.length > 0 && (
            <>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: 2,
                  color: MUTED,
                  marginBottom: 6,
                }}
              >
                RELATIONSHIPS
              </div>
              {panel.relationships.map((rel) => (
                <div key={rel.name + rel.clause} style={{ fontSize: 13.5, marginBottom: 4 }}>
                  <strong>{rel.name}</strong>
                  {' — '}
                  <em>{rel.clause}</em>
                </div>
              ))}
            </>
          )}

          {panel.heard.length > 0 && (
            <>
              <div
                data-testid="has-heard"
                style={{
                  fontFamily: mono,
                  fontSize: 10,
                  letterSpacing: 2,
                  color: MUTED,
                  margin: '12px 0 6px',
                }}
              >
                HAS HEARD…
              </div>
              {panel.heard.map((h) => (
                <div key={h.rumor} style={{ fontSize: 13.5, marginBottom: 4 }}>
                  <em>“{h.text}”</em>
                  {' — from '}
                  <strong>{h.from}</strong>
                </div>
              ))}
            </>
          )}

          <div
            style={{
              fontFamily: mono,
              fontSize: 10,
              color: MUTED,
              marginTop: 12,
              borderTop: `1px solid rgba(43, 36, 28, 0.12)`,
              paddingTop: 8,
            }}
          >
            {panel.footer}
          </div>
        </>
      )}
    </aside>
  );
}

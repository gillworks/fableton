// SPDX-License-Identifier: Apache-2.0
//
// The construction inspect panel (issue #99): click a site to read what it is
// becoming, how far along it is, and who is raising it right now. Progress and
// the worker roster come live from /api/construction — the socket delta omits
// them by design — and each worker line pairs a name with the behavior-tree
// label they're running this instant ("Aldous — raising the frame"). Same
// parchment reading surface as the resident inspect panel; the panel is the
// reader's lamplight, so its surface colors are engine grammar.
import { useEffect, useState, type ReactElement } from 'react';
import { PANEL_Z, HUD_ZOOM } from '../core/hud.js';
import { buildSitePanelData } from '../core/construction.js';
import type { SimState } from '../core/interpolator.js';
import type { WorldTheme } from '../core/theme.js';
import type { ConstructionSiteView } from '../core/types.js';

const PARCHMENT = '#f6efe0';
const INK = '#2b241c';
const MUTED = '#8a7f6d';

export interface ConstructionInspectPanelProps {
  siteId: string;
  sim: SimState;
  theme: WorldTheme;
  /** Resident id → display name, for the worker lines. */
  roster: Map<string, string>;
  onClose: () => void;
}

export function ConstructionInspectPanel({
  siteId,
  sim,
  theme,
  roster,
  onClose,
}: ConstructionInspectPanelProps): ReactElement | null {
  const [site, setSite] = useState<ConstructionSiteView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Bumped on any resident activity change so the worker lines recompute
  // between polls — the tree labels stay live.
  const [, forceTick] = useState(0);

  useEffect(() => {
    setSite(null);
    setFailure(null);
    let stopped = false;
    const read = async (): Promise<void> => {
      try {
        const res = await fetch('/api/construction');
        if (!res.ok) throw new Error(`${res.status}`);
        const { sites } = (await res.json()) as { sites: ConstructionSiteView[] };
        if (stopped) return;
        const found = sites.find((s) => s.id === siteId);
        if (!found) throw new Error('site gone');
        setSite(found);
        setFailure(null);
      } catch (e) {
        if (!stopped) setFailure(String(e));
      }
    };
    void read();
    const interval = setInterval(() => void read(), 2000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [siteId]);

  useEffect(() => {
    sim.onActivity(() => forceTick((t) => t + 1));
    // SimState listeners are additive; a leaked one just forces a harmless
    // re-render on the next selection.
  }, [sim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (failure) return null;

  const mono = `"${theme.mono}", ui-monospace, monospace`;
  const display = `"${theme.display}", Georgia, serif`;
  const panel = site ? buildSitePanelData(site, roster, (id) => sim.activityOf(id)) : null;

  return (
    <aside
      style={{
        position: 'fixed',
        top: 132,
        right: 14,
        width: 292,
        background: PARCHMENT,
        color: INK,
        borderRadius: 14,
        padding: '18px 20px 16px',
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
        <div style={{ fontFamily: mono, fontSize: 12, color: MUTED }}>reading the site…</div>
      ) : (
        <>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 4 }}>
            UNDER CONSTRUCTION
          </div>
          <div style={{ fontWeight: 700, fontSize: 19, marginBottom: 2 }}>{panel.name}</div>
          <div style={{ fontStyle: 'italic', fontSize: 13, color: MUTED, marginBottom: 12 }}>{panel.stage}</div>

          {/* The progress bar: how far this stage has come. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 7, borderRadius: 999, background: 'rgba(43, 36, 28, 0.14)', overflow: 'hidden' }}>
              <div style={{ width: `${Math.round(panel.fraction * 100)}%`, height: '100%', background: theme.accentHex }} />
            </div>
            <span style={{ fontFamily: mono, fontSize: 11, color: MUTED, whiteSpace: 'nowrap' }}>{panel.progress}</span>
          </div>

          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: 2, color: MUTED, marginBottom: 6 }}>
            {panel.complete ? 'RAISED BY' : 'RAISING IT NOW'}
          </div>
          {panel.workers.length > 0 ? (
            panel.workers.map((w) => (
              <div key={w.id} style={{ fontSize: 13.5, marginBottom: 4 }}>
                <strong>{w.name}</strong>
                {w.activity ? (
                  <>
                    {' — '}
                    <em>{w.activity}</em>
                  </>
                ) : null}
              </div>
            ))
          ) : (
            <div style={{ fontSize: 13.5, color: MUTED, fontStyle: 'italic' }}>
              {panel.complete ? 'the work is done' : 'no one is on the site just now'}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

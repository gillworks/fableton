// SPDX-License-Identifier: Apache-2.0
//
// The chronicle lineage (issue #59): the town's whole written history,
// newest first, on the same parchment reading surface as the inspect
// panel — the panel is the reader's lamplight, so its surface colors are
// engine grammar; typography and the accent come from the charter. PR
// references render as links when the world knows its repo.
import { useEffect, type ReactElement } from 'react';
import { PANEL_Z, HUD_ZOOM, chronicleSegments } from '../core/hud.js';
import type { WorldTheme } from '../core/theme.js';

const PARCHMENT = '#f6efe0';
const INK = '#2b241c';
const MUTED = '#8a7f6d';

export interface ChroniclePanelProps {
  /** Chronological, newest last — as the chronicle file keeps them. */
  entries: string[];
  theme: WorldTheme;
  repoUrl?: string;
  onClose: () => void;
}

export function ChroniclePanel({ entries, theme, repoUrl, onClose }: ChroniclePanelProps): ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mono = `"${theme.mono}", ui-monospace, monospace`;
  const display = `"${theme.display}", Georgia, serif`;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12, 10, 8, 0.35)', zIndex: PANEL_Z }}
    >
      <aside
        aria-label="chronicle"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 56,
          transform: 'translateX(-50%)',
          width: 'min(620px, calc(100vw - 48px))',
          // Sized for the 150% zoom: 46vh zoomed ≈ 69vh visual, leaving
          // the clock cluster and the bar both visible.
          maxHeight: 'min(420px, 46vh)',
          overflowY: 'auto',
          background: PARCHMENT,
          color: INK,
          borderRadius: 14,
          padding: '16px 22px 18px',
          boxShadow: '0 12px 40px rgba(20, 14, 6, 0.35)',
          fontFamily: display,
          lineHeight: 1.5,
          zoom: HUD_ZOOM,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 3, color: MUTED }}>
            CHRONICLE · NEWEST FIRST
          </span>
          <button
            onClick={onClose}
            aria-label="close"
            style={{
              marginLeft: 'auto',
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
        </div>
        {entries
          .slice()
          .reverse()
          .map((entry, i) => (
            <div
              key={`${entries.length - i}-${entry.slice(0, 24)}`}
              style={{
                display: 'flex',
                gap: 10,
                fontSize: 14.5,
                padding: '7px 0',
                borderTop: i === 0 ? 'none' : '1px solid rgba(43, 36, 28, 0.12)',
                opacity: i === 0 ? 1 : 0.88,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: i === 0 ? theme.accentHex : 'rgba(43, 36, 28, 0.25)',
                  flexShrink: 0,
                  marginTop: 7,
                }}
              />
              <span>
                {chronicleSegments(entry, repoUrl).map((seg, j) =>
                  'href' in seg ? (
                    <a
                      key={j}
                      href={seg.href}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: INK, fontFamily: mono, fontSize: 12, textDecorationColor: theme.accentHex }}
                    >
                      {seg.text}
                    </a>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )}
              </span>
            </div>
          ))}
      </aside>
    </div>
  );
}

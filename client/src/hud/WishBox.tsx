// SPDX-License-Identifier: Apache-2.0
//
// The visitor wish box (issue #79): the viewer end of the feedback funnel
// (docs/architecture.md). A visitor asks the town for something ("build a
// lighthouse"); world-api files it as a GH issue labeled `wish` for the
// steward to triage. Same parchment reading surface as the chronicle
// lineage — engine grammar for the surface, charter typography + accent —
// so it reads as part of the HUD chrome, not a browser dialog. Every
// failure mode degrades to a diegetic line; the well is never a stack
// trace.
import { useEffect, useState, type ReactElement } from 'react';
import { PANEL_Z, HUD_ZOOM } from '../core/hud.js';
import { WISH_MAX_LEN, submitWish, type WishResult } from '../core/wishes.js';
import type { WorldTheme } from '../core/theme.js';

const PARCHMENT = '#f6efe0';
const INK = '#2b241c';
const MUTED = '#8a7f6d';

export interface WishBoxProps {
  theme: WorldTheme;
  onClose: () => void;
}

/** The diegetic line for each outcome — the well answers, never a 500. */
function outcomeLine(result: WishResult): { tone: 'good' | 'quiet'; text: string } {
  switch (result.status) {
    case 'filed':
      return { tone: 'good', text: 'Your wish drifts toward the stewards.' };
    case 'closed':
      return { tone: 'quiet', text: 'The wishing well is quiet in this world.' };
    case 'rate-limited':
      return { tone: 'quiet', text: 'The well needs a moment — make another wish shortly.' };
    case 'rejected':
      return { tone: 'quiet', text: result.message };
    case 'error':
      return { tone: 'quiet', text: 'Your wish did not carry — try again in a moment.' };
  }
}

export function WishBox({ theme, onClose }: WishBoxProps): ReactElement {
  const [wish, setWish] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WishResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mono = `"${theme.mono}", ui-monospace, monospace`;
  const display = `"${theme.display}", Georgia, serif`;
  const trimmed = wish.trim();
  const canSend = trimmed.length >= 3 && !pending && result?.status !== 'filed';

  const send = async (): Promise<void> => {
    if (!canSend) return;
    setPending(true);
    const outcome = await submitWish(trimmed);
    setResult(outcome);
    setPending(false);
  };

  const line = result ? outcomeLine(result) : null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(12, 10, 8, 0.35)', zIndex: PANEL_Z }}
    >
      <aside
        aria-label="make a wish"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          left: '50%',
          bottom: 56,
          transform: 'translateX(-50%)',
          width: 'min(560px, calc(100vw - 48px))',
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
            MAKE A WISH · THE STEWARDS READ EVERY ONE
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

        <p style={{ margin: '0 0 12px', fontStyle: 'italic', fontSize: 14.5, opacity: 0.85 }}>
          Ask the town for something — “build a lighthouse,” “plant an orchard.” It joins the
          backlog for the stewards to weigh.
        </p>

        <textarea
          value={wish}
          onChange={(e) => {
            setWish(e.target.value.slice(0, WISH_MAX_LEN));
            if (result) setResult(null);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void send();
          }}
          placeholder="I wish for…"
          rows={3}
          autoFocus
          disabled={result?.status === 'filed'}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'none',
            background: 'rgba(43, 36, 28, 0.05)',
            border: `1px solid rgba(43, 36, 28, 0.18)`,
            borderRadius: 8,
            padding: '9px 11px',
            color: INK,
            fontFamily: display,
            fontSize: 15,
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, color: MUTED }}>
            {trimmed.length}/{WISH_MAX_LEN}
          </span>
          {line && (
            <span
              style={{
                fontFamily: display,
                fontStyle: 'italic',
                fontSize: 13.5,
                color: line.tone === 'good' ? INK : MUTED,
              }}
            >
              {line.text}
              {result?.status === 'filed' && result.number && (
                <>
                  {' '}
                  {result.url ? (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: INK, fontFamily: mono, fontSize: 12, textDecorationColor: theme.accentHex }}
                    >
                      (#{result.number})
                    </a>
                  ) : (
                    <span style={{ fontFamily: mono, fontSize: 12 }}>(#{result.number})</span>
                  )}
                </>
              )}
            </span>
          )}
          {result?.status === 'filed' ? (
            <button
              onClick={onClose}
              style={{
                marginLeft: 'auto',
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: 1,
                padding: '7px 16px',
                borderRadius: 999,
                border: 'none',
                background: theme.accentHex,
                color: 'rgba(32,27,20,0.92)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              CLOSE
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!canSend}
              style={{
                marginLeft: 'auto',
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: 1,
                padding: '7px 16px',
                borderRadius: 999,
                border: 'none',
                background: canSend ? theme.accentHex : 'rgba(43, 36, 28, 0.15)',
                color: canSend ? 'rgba(32,27,20,0.92)' : MUTED,
                fontWeight: 700,
                cursor: canSend ? 'pointer' : 'default',
              }}
            >
              {pending ? 'CASTING…' : 'CAST THE WISH'}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
//
// The HUD chrome (docs/design.md): engine-fixed anatomy, charter-skinned
// surfaces. Top-left identity block, top-right clock + phase selector,
// bottom chronicle bar. Every color, face, and phase name arrives from
// the parsed charter via theme tokens — zero world constants.
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { dayOf, hudInk, pollChronicle, type ChronicleEntry } from '../core/hud.js';
import type { WorldTheme } from '../core/theme.js';
import type { WorldInfo } from '../core/types.js';

export interface HudProps {
  info: WorldInfo;
  theme: WorldTheme;
  /** The page gradient's top color — decides ink vs paper foreground. */
  backdropHex: string;
  /** Live phase index from the sim. */
  livePhase: number;
  /** Currently rendered phase (override or live). */
  shownPhase: number;
  tick: number;
  onSelectPhase: (index: number | null) => void;
}

const INK = 'rgba(20, 17, 14, 0.82)';
const PAPER = 'rgba(246, 239, 224, 0.92)';

export function Hud({ info, theme, backdropHex, livePhase, shownPhase, tick, onSelectPhase }: HudProps): ReactElement {
  const [latest, setLatest] = useState<ChronicleEntry | null>(null);
  useEffect(() => pollChronicle(setLatest), []);

  const mono = `"${theme.mono}", ui-monospace, monospace`;
  const display = `"${theme.display}", Georgia, serif`;
  const onPale = hudInk(backdropHex) === 'ink';
  const fg = onPale ? 'rgba(32, 27, 20, 0.88)' : PAPER;
  const fgShadow = onPale ? 'none' : '0 1px 12px rgba(0,0,0,0.45)';
  const chip: CSSProperties = {
    fontFamily: mono,
    fontSize: 10,
    letterSpacing: 1,
    padding: '3px 9px',
    borderRadius: 999,
    border: `1px solid ${fg}`,
    color: fg,
    opacity: 0.85,
  };

  return (
    <>
      {/* Top-left: who this world is */}
      <div style={{ position: 'fixed', top: 20, left: 24, color: fg, textShadow: fgShadow }}>
        <div style={{ fontFamily: display, fontWeight: 700, fontSize: 26, letterSpacing: 5, textTransform: 'uppercase' }}>
          {info.world}
        </div>
        <div style={{ fontFamily: display, fontStyle: 'italic', fontSize: 13.5, opacity: 0.85, maxWidth: 380, marginTop: 2 }}>
          {info.premise}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <span style={chip}>CHARTER V{info.charter_version ?? 1}</span>
          <span style={chip}>SEED {info.seed}</span>
        </div>
      </div>

      {/* Top-right: the clock and the four-segment phase selector */}
      <div style={{ position: 'fixed', top: 20, right: 20, textAlign: 'right' }}>
        <div
          style={{
            display: 'inline-block',
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: 2,
            textTransform: 'uppercase',
            background: INK,
            color: PAPER,
            padding: '6px 14px',
            borderRadius: 999,
          }}
        >
          DAY {dayOf(tick)} · {info.phases[shownPhase] ?? '—'}
          {shownPhase !== livePhase ? ' · preview' : ''}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 8, justifyContent: 'flex-end' }}>
          {info.phases.map((phase, index) => (
            <button
              key={phase}
              title={phase + (index === livePhase ? ' (live)' : ' (preview relight)')}
              onClick={() => onSelectPhase(index === livePhase ? null : index)}
              style={{
                width: 34,
                height: 10,
                borderRadius: 999,
                border: `1px solid ${fg}`,
                background: index === shownPhase ? theme.accentHex : 'transparent',
                opacity: index === shownPhase ? 1 : 0.55,
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* Bottom: the chronicle bar, in the world's voice */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          padding: '10px 24px 12px',
          background: 'linear-gradient(transparent, rgba(12, 10, 8, 0.55))',
          color: PAPER,
        }}
      >
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 3, opacity: 0.6 }}>CHRONICLE</span>
        <span style={{ fontFamily: display, fontStyle: 'italic', fontSize: 14, opacity: 0.92 }}>
          {latest ? latest.entry : 'the world holds its breath…'}
        </span>
      </div>
    </>
  );
}

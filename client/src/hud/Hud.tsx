// SPDX-License-Identifier: Apache-2.0
//
// The HUD chrome (docs/design.md): engine-fixed anatomy, charter-skinned
// surfaces. Top-left identity block, top-right clock + phase selector,
// bottom chronicle bar. Every color, face, and phase name arrives from
// the parsed charter via theme tokens — zero world constants.
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { HUD_Z, HUD_ZOOM, dayOf, hudInk, paceLabel, pollChronicle, pollChronicleFile, type ChronicleEntry } from '../core/hud.js';
import { TICKS_PER_DAY } from '../core/types.js';
import type { WorldTheme } from '../core/theme.js';
import type { WorldInfo } from '../core/types.js';
import { ChroniclePanel } from './ChroniclePanel.js';

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
  const [chronicle, setChronicle] = useState<string[] | null>(null);
  const [lineageOpen, setLineageOpen] = useState(false);
  useEffect(() => pollChronicle(setLatest), []);
  useEffect(() => pollChronicleFile(setChronicle), []);

  // The day length is the charter's, not the engine's: the API's pace is
  // authoritative, the constant is only a pre-#57 fallback.
  const ticksPerDay = info.pace?.ticks_per_day ?? TICKS_PER_DAY;

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
      <div style={{ position: 'fixed', top: 20, left: 24, color: fg, textShadow: fgShadow, zoom: HUD_ZOOM, zIndex: HUD_Z }}>
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
      <div style={{ position: 'fixed', top: 20, right: 20, textAlign: 'right', zoom: HUD_ZOOM, zIndex: HUD_Z }}>
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
          DAY {dayOf(tick, ticksPerDay)} · {info.phases[shownPhase] ?? '—'}
          {shownPhase !== livePhase ? ' · preview' : ''}
        </div>
        {/* Today's charter-defined town event, when one is in effect (issue #62). */}
        {info.event && (
          <div
            style={{
              fontFamily: display,
              fontStyle: 'italic',
              fontSize: 14,
              color: fg,
              textShadow: fgShadow,
              marginTop: 6,
            }}
          >
            Today: {info.event}
          </div>
        )}
        {/* The world clock: progress through today, and how fast a day passes */}
        <div
          title={`time of day: ${Math.round(((tick % ticksPerDay) / ticksPerDay) * 100)}%`}
          style={{
            height: 3,
            borderRadius: 999,
            marginTop: 6,
            background: onPale ? 'rgba(32,27,20,0.18)' : 'rgba(246,239,224,0.25)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${((tick % ticksPerDay) / ticksPerDay) * 100}%`,
              height: '100%',
              background: theme.accentHex,
              transition: 'width 1s linear',
            }}
          />
        </div>
        <div style={{ display: 'inline-flex', background: onPale ? 'rgba(246,239,224,0.75)' : 'rgba(20,17,14,0.55)', borderRadius: 999, padding: 3, gap: 2, marginTop: 8 }}>
          {info.phases.map((phase, index) => (
            <button
              key={phase}
              title={phase + (index === livePhase ? ' (live)' : ' (preview relight)')}
              onClick={() => onSelectPhase(index === livePhase ? null : index)}
              style={{
                fontFamily: mono,
                fontSize: 10.5,
                letterSpacing: 0.5,
                padding: '4px 10px',
                borderRadius: 999,
                border: 'none',
                background: index === shownPhase ? theme.accentHex : 'transparent',
                color: index === shownPhase ? 'rgba(32,27,20,0.92)' : fg,
                opacity: index === shownPhase ? 1 : 0.7,
                fontWeight: index === shownPhase ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {phase}
            </button>
          ))}
        </div>
        <div style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 1, color: fg, opacity: 0.6, marginTop: 6 }}>
          1 DAY ≈ {paceLabel(info.pace?.seconds_per_day ?? ticksPerDay / 2)}
        </div>
      </div>

      {/* Bottom: the chronicle bar — the newest line of the town's
          written history (issue #59); the live sim ticker stands in for
          worlds too young to have one. Click opens the lineage. */}
      <div
        onClick={() => chronicle && chronicle.length > 0 && setLineageOpen((v) => !v)}
        role={chronicle && chronicle.length > 0 ? 'button' : undefined}
        title={chronicle && chronicle.length > 0 ? 'read the whole chronicle' : undefined}
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
          cursor: chronicle && chronicle.length > 0 ? 'pointer' : 'default',
          zoom: HUD_ZOOM,
          zIndex: HUD_Z,
        }}
      >
        <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: 3, opacity: 0.6 }}>CHRONICLE</span>
        <span style={{ fontFamily: display, fontStyle: 'italic', fontSize: 14, opacity: 0.92 }}>
          {chronicle?.at(-1) ?? latest?.entry ?? 'the world holds its breath…'}
        </span>
        {chronicle && chronicle.length > 0 && (
          <span style={{ fontFamily: mono, fontSize: 9.5, letterSpacing: 1, opacity: 0.5 }}>
            {lineageOpen ? 'CLOSE' : `READ ALL ${chronicle.length}`}
          </span>
        )}
      </div>
      {lineageOpen && chronicle && chronicle.length > 0 && (
        <ChroniclePanel
          entries={chronicle}
          theme={theme}
          {...(info.repo_url ? { repoUrl: info.repo_url } : {})}
          onClose={() => setLineageOpen(false)}
        />
      )}
    </>
  );
}

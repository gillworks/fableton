// SPDX-License-Identifier: Apache-2.0
//
// Boot: load the world bundle + kit, connect the sim, render the diorama
// over the charter's atmosphere gradient. HUD chrome and the inspect
// panel are their own issues — this is the explorable world itself.
import { Canvas } from '@react-three/fiber';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { loadAssetPieces } from './core/assets.js';
import { coinFor } from './core/chunkMeshes.js';
import type { AssetPiece } from './core/chunkMeshes.js';
import { SimState, connectSim } from './core/interpolator.js';
import { loadWorld, type WorldBundle } from './core/loadWorld.js';
import { deriveTheme, phaseLighting } from './core/theme.js';
import { InspectPanel } from './scene/InspectPanel.js';
import { WorldScene } from './scene/WorldScene.js';

export function App(): ReactElement {
  const [bundle, setBundle] = useState<WorldBundle | null>(null);
  const [pieces, setPieces] = useState<Map<string, AssetPiece[]> | null>(null);
  const [phase, setPhase] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const sim = useMemo(() => new SimState(), []);

  useEffect(() => {
    let disposed = false;
    loadWorld()
      .then(async (b) => {
        const p = await loadAssetPieces(b.registry);
        if (disposed) return;
        setBundle(b);
        setPieces(p);
        sim.onPhase((name) => setPhase(Math.max(0, b.info.phases.indexOf(name))));
      })
      .catch((e) => setFailure(e instanceof Error ? e.message : String(e)));
    const disconnect = connectSim(
      sim,
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sim`,
    );
    return () => {
      disposed = true;
      disconnect();
    };
  }, [sim]);

  if (failure) {
    return <div style={{ padding: 32, fontFamily: 'monospace' }}>world failed to load: {failure}</div>;
  }
  if (!bundle || !pieces) {
    return <div style={{ padding: 32, fontFamily: 'monospace', opacity: 0.6 }}>waking the world…</div>;
  }

  const theme = deriveTheme(bundle.info.theme);
  const lighting = phaseLighting(phase, theme);
  // Cozy default framing: storybook three-quarter view sized to the diorama.
  const coin = coinFor(bundle.manifest.chunks.map((c) => c.origin));
  const span = Math.max(coin.rx, coin.rz);
  const eye: [number, number, number] = [
    coin.center[0] + span * 0.15,
    span * 0.85,
    coin.center[1] + span * 0.95,
  ];

  return (
    <div
      style={{
        height: '100%',
        background: `linear-gradient(${lighting.gradientTop}, ${lighting.gradientBottom})`,
        transition: 'background 2s',
      }}
    >
      <Canvas
        shadows
        gl={{ alpha: true, antialias: true }}
        camera={{ position: eye, fov: 42 }}
        onPointerMissed={() => setSelected(null)}
      >
        <WorldScene
          bundle={bundle}
          pieces={pieces}
          sim={sim}
          theme={theme}
          phaseIndex={phase}
          onSelect={setSelected}
        />
      </Canvas>
      {selected && (
        <InspectPanel npcId={selected} sim={sim} theme={theme} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

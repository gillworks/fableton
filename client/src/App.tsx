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
import { constructionSites } from './core/hud.js';
import { parseFollowParam, followSearch } from './core/follow.js';
import { loadWorld, type WorldBundle } from './core/loadWorld.js';
import type { ConstructionSiteView, WeatherState } from './core/types.js';
import { Hud } from './hud/Hud.js';
import { FollowBanner } from './hud/FollowBanner.js';
import { deriveTheme, phaseLighting } from './core/theme.js';
import { InspectPanel } from './scene/InspectPanel.js';
import { ConstructionInspectPanel } from './scene/ConstructionInspectPanel.js';
import { WorldScene } from './scene/WorldScene.js';

export function App(): ReactElement {
  const [bundle, setBundle] = useState<WorldBundle | null>(null);
  const [pieces, setPieces] = useState<Map<string, AssetPiece[]> | null>(null);
  const [phase, setPhase] = useState(0);
  const [phaseOverride, setPhaseOverride] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);
  const [siteDefs, setSiteDefs] = useState<ConstructionSiteView[]>([]);
  // Follow the resident named in the URL, if any — the shareable deep link.
  const [follow, setFollow] = useState<string | null>(() => parseFollowParam(location.search));
  const [roster, setRoster] = useState<Map<string, string>>(new Map());
  // id→role (identity.kind), for the ambient over-head label (issue #62). The
  // roster endpoint already carries it, so no extra fetch and no per-resident
  // detail call is needed to read a resident's vocation at a glance.
  const [roles, setRoles] = useState<Map<string, string>>(new Map());
  const [weather, setWeather] = useState<WeatherState | null>(null);
  const sim = useMemo(() => new SimState(), []);

  useEffect(() => {
    const dayTimer = setInterval(() => setTick(sim.clock.tick), 1000);
    let disposed = false;
    loadWorld()
      .then(async (b) => {
        const p = await loadAssetPieces(b.registry);
        if (disposed) return;
        setBundle(b);
        setPieces(p);
        sim.onPhase((name) => setPhase(Math.max(0, b.info.phases.indexOf(name))));
        sim.onWeather(setWeather);
      })
      .catch((e) => setFailure(e instanceof Error ? e.message : String(e)));
    // The resident roster: id→name for the follow banner, and the source
    // of truth for validating a deep-linked ?follow= id.
    fetch('/api/npcs')
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string; name: string; kind?: string }[]>) : []))
      .then((all) => {
        if (disposed) return;
        setRoster(new Map(all.map((n) => [n.id, n.name])));
        setRoles(new Map(all.map((n) => [n.id, n.kind ?? ''])));
      })
      .catch(() => undefined);
    // Citizen-construction site definitions (issue #99): static per world, so
    // fetched once. The sim socket then drives each site's stage; the inspect
    // panel polls this same endpoint for live progress and workers.
    fetch('/api/construction')
      .then((r) => (r.ok ? (r.json() as Promise<{ sites: ConstructionSiteView[] }>) : { sites: [] }))
      .then((body) => {
        if (!disposed) setSiteDefs(body.sites ?? []);
      })
      .catch(() => undefined);
    const disconnect = connectSim(
      sim,
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/sim`,
    );
    return () => {
      disposed = true;
      clearInterval(dayTimer);
      disconnect();
    };
  }, [sim]);

  // Keep the address bar in step with the follow state, so the URL you'd
  // copy is the URL that reproduces what you're watching.
  useEffect(() => {
    const search = followSearch(location.search, follow);
    history.replaceState(null, '', `${location.pathname}${search}${location.hash}`);
  }, [follow]);

  // A deep link to an id that isn't a real resident falls back to explore
  // once the roster is known (empty roster = not loaded yet, so wait).
  useEffect(() => {
    if (follow && roster.size > 0 && !roster.has(follow)) setFollow(null);
  }, [follow, roster]);

  // The resident panel and the construction panel are mutually exclusive —
  // opening one closes the other so only one reading surface shows at a time.
  const selectNpc = (id: string): void => {
    setSelected(id);
    setSelectedSite(null);
  };
  const selectSite = (id: string): void => {
    setSelectedSite(id);
    setSelected(null);
  };

  const startFollow = (id: string): void => {
    setFollow(id);
    selectNpc(id); // open the panel too, so name + lore ride along
  };

  if (failure) {
    return <div style={{ padding: 32, fontFamily: 'monospace' }}>world failed to load: {failure}</div>;
  }
  if (!bundle || !pieces) {
    return <div style={{ padding: 32, fontFamily: 'monospace', opacity: 0.6 }}>waking the world…</div>;
  }

  const theme = deriveTheme(bundle.info.theme);
  // The selector previews a relight; the sim clock stays authoritative.
  const shownPhase = phaseOverride ?? phase;
  const lighting = phaseLighting(shownPhase, theme);
  // Studio PRs rendered in-world (docs/design.md); the ?construction= override
  // demos them until the studio emits real refs. Distinct from the citizen
  // construction sites, which come live from the sim via siteDefs.
  const prMarkers = constructionSites(undefined, location.search);
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
        onPointerMissed={() => {
          setSelected(null);
          setSelectedSite(null);
        }}
      >
        <WorldScene
          bundle={bundle}
          pieces={pieces}
          sim={sim}
          theme={theme}
          phaseIndex={shownPhase}
          roles={roles}
          onSelect={selectNpc}
          construction={prMarkers}
          sites={siteDefs}
          onSelectSite={selectSite}
          follow={follow}
          weather={weather}
        />
      </Canvas>
      <Hud
        info={bundle.info}
        theme={theme}
        backdropHex={lighting.gradientTop}
        livePhase={phase}
        shownPhase={shownPhase}
        tick={tick}
        weather={weather}
        onSelectPhase={setPhaseOverride}
      />
      {selected && (
        <InspectPanel
          npcId={selected}
          sim={sim}
          theme={theme}
          onClose={() => setSelected(null)}
          following={follow === selected}
          onFollow={() => startFollow(selected)}
          onExitFollow={() => setFollow(null)}
        />
      )}
      {selectedSite && (
        <ConstructionInspectPanel
          siteId={selectedSite}
          sim={sim}
          theme={theme}
          roster={roster}
          onClose={() => setSelectedSite(null)}
        />
      )}
      {follow && (
        <FollowBanner
          npcId={follow}
          name={roster.get(follow) ?? follow}
          sim={sim}
          theme={theme}
          onExit={() => setFollow(null)}
        />
      )}
    </div>
  );
}

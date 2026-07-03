// SPDX-License-Identifier: Apache-2.0
//
// The studio, visible in-world (docs/design.md): a region under
// construction renders as a wireframe ghost volume + crane + dark
// placard. Engine chrome — identical in every world. Clicking the
// placard opens the PR when the site carries a URL (Phase B studio
// emits them; the ?construction= override demos it today).
import { Html } from '@react-three/drei';
import { OVERLAY_Z_RANGE } from '../core/hud.js';
import type { ReactElement } from 'react';
import { CHUNK_SIZE, type ConstructionSite } from '../core/types.js';

export function ConstructionMarker({
  site,
  origin,
}: {
  site: ConstructionSite;
  origin: [number, number];
}): ReactElement {
  const [cx, cz] = [origin[0] + CHUNK_SIZE / 2, origin[1] + CHUNK_SIZE / 2];
  const mono = 'ui-monospace, monospace';
  return (
    <group position={[cx, 0, cz]}>
      {/* the ghost volume */}
      <mesh position={[0, 2.6, 0]}>
        <boxGeometry args={[CHUNK_SIZE - 3, 5, CHUNK_SIZE - 3]} />
        <meshBasicMaterial color="#f6efe0" wireframe transparent opacity={0.28} />
      </mesh>
      {/* the crane: mast, jib, hook line */}
      <group position={[CHUNK_SIZE / 2 - 4, 0, -CHUNK_SIZE / 2 + 4]}>
        <mesh position={[0, 3.4, 0]}>
          <cylinderGeometry args={[0.14, 0.18, 6.8, 6]} />
          <meshLambertMaterial color="#c9973f" />
        </mesh>
        <mesh position={[-2.1, 6.7, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.1, 0.1, 4.6, 6]} />
          <meshLambertMaterial color="#c9973f" />
        </mesh>
        <mesh position={[-4.2, 5.45, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 2.5, 4]} />
          <meshBasicMaterial color="#f6efe0" />
        </mesh>
      </group>
      {/* the placard */}
      <Html center position={[0, 6.4, 0]} distanceFactor={30} zIndexRange={OVERLAY_Z_RANGE}>
        <a
          href={site.url ?? '#'}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            background: 'rgba(20, 17, 14, 0.92)',
            color: '#f6efe0',
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: 1,
            padding: '6px 12px',
            borderRadius: 6,
            whiteSpace: 'nowrap',
            textDecoration: 'none',
            border: '1px solid rgba(246, 239, 224, 0.35)',
          }}
        >
          UNDER CONSTRUCTION — PR #{site.pr}
        </a>
      </Html>
    </group>
  );
}

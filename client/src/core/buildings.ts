// SPDX-License-Identifier: Apache-2.0
//
// Parametric buildings from three primitives, to the design-mockup
// grammar (docs/design.md): chunky walls, a double-slab hipped roof with
// a generous overhang, a leaning chimney, a too-small door, and amber
// windows that glow by phase. All colors arrive in the building data —
// nothing here belongs to any one world.
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import type { Building } from './types.js';

const WINDOW_AMBER = '#ffc76a';
const DOOR_INK = '#2e2318';

export interface BuiltBuilding {
  group: Group;
  /** Emissive window materials — drive emissiveIntensity by phase. */
  windowMaterials: MeshLambertMaterial[];
}

export function buildBuilding(b: Building): BuiltBuilding {
  const group = new Group();
  group.position.set(b.position[0], b.position[1], b.position[2]);
  group.rotation.y = b.rotation_y ?? 0;
  const windowMaterials: MeshLambertMaterial[] = [];

  const walls = new Mesh(
    new BoxGeometry(b.width, b.height, b.depth),
    new MeshLambertMaterial({ color: b.wall_color }),
  );
  walls.position.y = b.height / 2;
  walls.castShadow = true;
  group.add(walls);

  // The double-slab roof: a wide low slab, then a smaller crown.
  const roof = new MeshLambertMaterial({ color: b.roof_color });
  const slab = new Mesh(new BoxGeometry(b.width + 0.7, 0.3, b.depth + 0.7), roof);
  slab.position.y = b.height + 0.15;
  slab.castShadow = true;
  group.add(slab);
  const crown = new Mesh(
    new BoxGeometry(b.width * 0.58 + 0.2, 0.26, b.depth * 0.58 + 0.2),
    roof,
  );
  crown.position.y = b.height + 0.43;
  group.add(crown);

  // A door slightly too small or too grand, depending on who retired here.
  const door = new Mesh(
    new BoxGeometry(Math.min(0.62, b.width * 0.22), Math.min(1.0, b.height * 0.55), 0.08),
    new MeshLambertMaterial({ color: DOOR_INK }),
  );
  door.position.set(0, Math.min(0.5, b.height * 0.275), b.depth / 2 + 0.02);
  group.add(door);

  // Windows on the two long faces, evenly spread, glowing by phase.
  const count = b.windows ?? 0;
  for (let side = 0; side < 2 && count > 0; side++) {
    for (let i = 0; i < count; i++) {
      const material = new MeshLambertMaterial({
        color: new Color(WINDOW_AMBER).multiplyScalar(0.35),
        emissive: WINDOW_AMBER,
        emissiveIntensity: 0,
      });
      windowMaterials.push(material);
      const window = new Mesh(new BoxGeometry(0.34, 0.4, 0.06), material);
      const spread = ((i + 1) / (count + 1) - 0.5) * b.width;
      window.position.set(spread, b.height * 0.55, (b.depth / 2 + 0.01) * (side === 0 ? 1 : -1));
      group.add(window);
    }
  }

  if (b.chimney) {
    const chimney = new Mesh(
      new BoxGeometry(0.26, 0.9, 0.26),
      new MeshLambertMaterial({ color: b.wall_color }),
    );
    chimney.position.set(b.width * 0.32, b.height + 0.6, -b.depth * 0.22);
    chimney.rotation.z = 0.07; // chimneys lean like question marks
    group.add(chimney);
  }

  return { group, windowMaterials };
}

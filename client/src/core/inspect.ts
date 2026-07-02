// SPDX-License-Identifier: Apache-2.0
//
// Inspect-panel view model (docs/design.md anatomy). Pure: world-api
// detail + the id→name directory + the live activity in, render-ready
// strings out. Nothing here is world-specific; every string comes from
// world data.
export interface NpcDetail {
  id: string;
  identity: { name: string; kind: string; story: string };
  relationships: { to: string; kind: string }[];
  lore: string[];
  tree: string;
}

export interface PanelData {
  id: string;
  initial: string;
  name: string;
  role: string;
  bio: string;
  relationships: { name: string; clause: string }[];
  footer: string;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function buildPanelData(
  detail: NpcDetail,
  nameById: Map<string, string>,
): PanelData {
  return {
    id: detail.id,
    initial: (detail.identity.name[0] ?? '?').toUpperCase(),
    name: detail.identity.name,
    role: detail.identity.kind,
    bio: detail.identity.story,
    relationships: detail.relationships.map((rel) => ({
      name: nameById.get(rel.to) ?? rel.to,
      clause: rel.kind,
    })),
    footer: `lore/${detail.id}.json · tree: ${slug(detail.tree)}`,
  };
}

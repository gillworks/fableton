// SPDX-License-Identifier: Apache-2.0
//
// World bootstrap: metadata + manifest + registry over the same relative
// URLs caddy serves in production (/api, /world, /assets — see
// vite.config.ts for the dev equivalents).
import type { RegistryAsset, WorldInfo, WorldManifest } from './types.js';

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
};

export interface WorldBundle {
  info: WorldInfo;
  manifest: WorldManifest;
  registry: RegistryAsset[];
}

export async function loadWorld(): Promise<WorldBundle> {
  const [info, manifest, registryDoc] = await Promise.all([
    json<WorldInfo>('/api/world'),
    json<WorldManifest>('/world/manifest.json'),
    json<{ assets: RegistryAsset[] }>('/assets/registry.json'),
  ]);
  return { info, manifest, registry: registryDoc.assets };
}

export const fetchChunk = <T>(path: string): Promise<T> =>
  fetch(`/world/${path}`).then((r) => {
    if (!r.ok) throw new Error(`/world/${path}: ${r.status}`);
    return r.json() as Promise<T>;
  });

// SPDX-License-Identifier: Apache-2.0
//
// HUD view logic, out of React: the clock math, the chronicle poller,
// and the construction-site override used to demo markers before the
// studio (Phase B) emits real ones.
import type { ConstructionSite } from './types.js';
import { TICKS_PER_DAY } from './types.js';

/** Perceived luminance 0..1 of a #rrggbb hex. */
export function luminanceOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Engine grammar: pale skies get ink, dark skies get paper. */
export const hudInk = (backdropHex: string): 'ink' | 'paper' =>
  luminanceOf(backdropHex) > 0.55 ? 'ink' : 'paper';

/** Day number, 1-based: the sim clock is a pure function of tick. */
export const dayOf = (tick: number, ticksPerDay: number = TICKS_PER_DAY): number =>
  Math.floor(tick / ticksPerDay) + 1;

/** "20 MIN" under two hours, "6 HR" from there — the pace chip's unit. */
export const paceLabel = (secondsPerDay: number): string => {
  const minutes = Math.round(secondsPerDay / 60);
  return minutes >= 120 ? `${Math.round(minutes / 60)} HR` : `${minutes} MIN`;
};

export interface ChronicleEntry {
  tick: number;
  entry: string;
}

/**
 * Parse worlds/<w>/chronicle.md — the town's written history (issue #59).
 * Contract: `#` heading lines and everything up to the first blank line
 * are the header block; every non-empty line after it is one entry,
 * chronological (the file says "Newest last"). A file with no blank line
 * yields every non-heading line.
 */
export function parseChronicle(md: string): string[] {
  const lines = md.split('\n');
  const firstBlank = lines.findIndex((l) => l.trim() === '');
  const body = firstBlank === -1 ? lines : lines.slice(firstBlank + 1);
  return body.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** One rendered piece of a chronicle entry: plain text, or a PR link. */
export type ChronicleSegment = { text: string } | { text: string; href: string };

/**
 * Split an entry around its `(PR #N)` references so the lineage view can
 * render them as links (the studio-visible-in-world pattern). Without a
 * repo URL the whole entry is one plain segment.
 */
export function chronicleSegments(entry: string, repoUrl?: string): ChronicleSegment[] {
  if (!repoUrl) return [{ text: entry }];
  const segments: ChronicleSegment[] = [];
  const pattern = /\(PR #(\d+)\)/g;
  let cursor = 0;
  for (let m = pattern.exec(entry); m !== null; m = pattern.exec(entry)) {
    if (m.index > cursor) segments.push({ text: entry.slice(cursor, m.index) });
    segments.push({ text: m[0], href: `${repoUrl.replace(/\/$/, '')}/pull/${m[1]}` });
    cursor = m.index + m[0].length;
  }
  if (cursor < entry.length) segments.push({ text: entry.slice(cursor) });
  return segments;
}

/**
 * Poll the written chronicle (a static beside the world data; caddy and
 * vite both serve it at /world/chronicle.md). `null` means the world has
 * no chronicle yet — callers fall back to the live sim ticker.
 */
export function pollChronicleFile(
  onEntries: (entries: string[] | null) => void,
  intervalMs = 15000,
): () => void {
  let stopped = false;
  const read = async (): Promise<void> => {
    try {
      const res = await fetch('/world/chronicle.md', { cache: 'no-store' });
      if (stopped) return;
      // The dev server answers missing statics with the SPA page — only
      // an actual markdown body counts as a chronicle.
      const isHtml = (res.headers.get('content-type') ?? '').includes('text/html');
      onEntries(res.ok && !isHtml ? parseChronicle(await res.text()) : null);
    } catch {
      // a missing chronicle is a young world, not a client error
      if (!stopped) onEntries(null);
    }
  };
  void read();
  const interval = setInterval(() => void read(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/** Poll the chronicle (world-api owns its voice); returns a disposer. */
export function pollChronicle(
  onLatest: (entry: ChronicleEntry | null) => void,
  intervalMs = 5000,
): () => void {
  let stopped = false;
  const read = async (): Promise<void> => {
    try {
      const res = await fetch('/api/chronicle');
      const body = (await res.json()) as { entries: ChronicleEntry[] };
      if (!stopped) onLatest(body.entries.at(-1) ?? null);
    } catch {
      // the chronicle going quiet is not a client error
    }
  };
  void read();
  const interval = setInterval(() => void read(), intervalMs);
  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/**
 * Construction sites: whatever world-api reports, plus a URL override
 * (?construction=<chunkId>:<pr>) for demos and QA until Phase B's studio
 * emits the real thing.
 */
export function constructionSites(
  fromApi: ConstructionSite[] | undefined,
  search: string,
): ConstructionSite[] {
  const sites = [...(fromApi ?? [])];
  const param = new URLSearchParams(search).get('construction');
  if (param) {
    const match = /^([a-z0-9_-]+):(\d+)$/.exec(param);
    if (match) sites.push({ chunk: match[1]!, pr: Number(match[2]) });
  }
  return sites;
}

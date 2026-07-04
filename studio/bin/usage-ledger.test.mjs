// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  CSV_HEADER,
  buildUsageRow,
  renderCsv,
  renderMarkdown,
  summarize,
} from './usage-ledger.mjs';

const NOW = '2026-07-04T00:00:00.000Z';

describe('buildUsageRow', () => {
  it('records real usage from a clean JSON envelope', () => {
    const raw = JSON.stringify({
      result: 'done',
      is_error: false,
      total_cost_usd: 1.25,
      duration_ms: 4200,
      num_turns: 7,
      usage: {
        input_tokens: 100,
        cache_creation_input_tokens: 20,
        cache_read_input_tokens: 30,
        output_tokens: 40,
      },
    });
    const { result, row } = buildUsageRow({ raw, role: 'steward', model: 'm', status: 0, now: NOW });
    expect(result).toBe('done');
    expect(row).toBe(`${NOW},steward,m,100,20,30,40,1.25,4200,7,ok`);
  });

  it('tags an is_error envelope as error', () => {
    const raw = JSON.stringify({ is_error: true, usage: {} });
    const { row } = buildUsageRow({ raw, role: 'qa', model: 'm', status: 0, now: NOW });
    expect(row.endsWith(',error')).toBe(true);
  });

  it('records a killed session (exit 124) as a zeroed timeout row', () => {
    // Simulates `timeout 1s claude` — stdout is not the JSON envelope.
    const { result, row } = buildUsageRow({
      raw: 'partial output before the kill',
      role: 'council',
      model: 'claude-fable-5',
      status: 124,
      now: NOW,
    });
    expect(result).toBe('partial output before the kill');
    expect(row).toBe(`${NOW},council,claude-fable-5,0,0,0,0,0,0,0,timeout`);
  });

  it('treats SIGKILL (137) as timeout and other non-zero exits as crash', () => {
    expect(buildUsageRow({ raw: 'x', role: 'r', model: 'm', status: 137, now: NOW }).row).toContain(
      ',timeout',
    );
    expect(buildUsageRow({ raw: 'x', role: 'r', model: 'm', status: 1, now: NOW }).row).toContain(
      ',crash',
    );
  });
});

describe('summarize / render', () => {
  const csv = [
    CSV_HEADER,
    '2026-07-04T09:00:00Z,council,claude-fable-5,100,0,0,50,2.00,1000,3,ok',
    '2026-07-04T09:05:00Z,council,claude-fable-5,0,0,0,0,0,0,0,timeout',
    '2026-07-04T08:30:00Z,qa,claude-haiku-4-5,10,0,0,5,0.10,500,1,ok',
    '2026-07-04T00:00:00Z,steward,claude-sonnet-5,200,0,0,80,3.00,2000,4,ok',
  ].join('\n');

  it('aggregates per tier in canonical order with exit counts', () => {
    const s = summarize(csv);
    expect(s.map((t) => t.role)).toEqual(['steward', 'qa', 'council']);
    const council = s.find((t) => t.role === 'council');
    expect(council.sessions).toBe(2);
    expect(council.ok).toBe(1);
    expect(council.timeout).toBe(1);
    expect(council.input_tokens).toBe(100);
    expect(council.output_tokens).toBe(50);
    expect(council.cost_usd).toBeCloseTo(2.0);
  });

  it('round-trips the csv surface header and a total is derivable', () => {
    const out = renderCsv(summarize(csv));
    expect(out.split('\n')[0]).toContain('role,sessions,ok,timeout,crash,error');
    expect(out).toContain('council,2,1,1,0,0,100,0,0,50,2.0000');
  });

  it('renders a deterministic markdown surface with a total row', () => {
    const md = renderMarkdown(summarize(csv), { generatedAt: NOW });
    expect(md).toContain(`_Generated: ${NOW}_`);
    expect(md).toContain('| **total** | 4 |');
  });

  it('handles an empty ledger without throwing', () => {
    expect(summarize('')).toEqual([]);
    expect(renderMarkdown([], { generatedAt: NOW })).toContain('No sessions recorded yet.');
    expect(renderCsv([]).trim()).toBe(
      'role,sessions,ok,timeout,crash,error,input_tokens,cache_creation_tokens,cache_read_tokens,output_tokens,cost_usd',
    );
  });
});

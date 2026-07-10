// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WishLedgerDocSchema, type WishLedgerDoc } from './wishLedger.js';

const load = (): unknown =>
  JSON.parse(
    readFileSync(
      new URL('../../test/fixtures/sample-world/wish-ledger.json', import.meta.url),
      'utf8',
    ),
  );

const valid = (): WishLedgerDoc => WishLedgerDocSchema.parse(load());
// A loosely-typed copy for building malformed inputs by spread/mutation.
const raw = (): Record<string, unknown> => load() as Record<string, unknown>;

describe('WishLedgerDocSchema', () => {
  it('accepts a valid ledger and round-trips (parse → serialize → parse)', () => {
    const doc = valid();
    expect(doc.wishes).toHaveLength(3);
    expect(doc.keeper).toBe('greta-the-baker');
    expect(doc.wishes[0]!.pledges[0]!.by).toBe('tam-the-lamplighter');
    expect(doc.wishes[0]!.accounting).toHaveLength(2);
    expect(WishLedgerDocSchema.parse(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it('defaults keeper to winsome and pledges/accounting to empty, wishes notable', () => {
    const doc = WishLedgerDocSchema.parse({
      schema_version: 1,
      wishes: [
        { id: 'a-wish', text: 'a quiet one', sincerity: 'sincere', status: 'standing', recorded_on: 'today' },
      ],
    });
    expect(doc.keeper).toBe('winsome');
    expect(doc.wishes[0]!.pledges).toEqual([]);
    expect(doc.wishes[0]!.accounting).toEqual([]);
    expect(doc.wishes[0]!.notable).toBe(true);
  });

  it('rejects a wrong schema_version', () => {
    expect(() => WishLedgerDocSchema.parse({ ...raw(), schema_version: 2 })).toThrow();
  });

  it('rejects duplicate wish ids', () => {
    const doc = load() as WishLedgerDoc;
    doc.wishes[1]!.id = doc.wishes[0]!.id;
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/duplicate wish id/);
  });

  it('rejects duplicate pledge ids within a wish', () => {
    const doc = load() as WishLedgerDoc;
    const pledge = { ...doc.wishes[0]!.pledges[0]! };
    doc.wishes[0]!.pledges.push(pledge);
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/duplicate pledge id/);
  });

  it('rejects an insincere wish carried as a standing debt', () => {
    const doc = load() as WishLedgerDoc;
    doc.wishes[2]!.status = 'standing'; // the gold-egg goose is insincere
    delete doc.wishes[2]!.closed_on;
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/must have status/);
  });

  it('rejects a sincere wish marked returned', () => {
    const doc = load() as WishLedgerDoc;
    doc.wishes[1]!.status = 'returned';
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/cannot be/);
  });

  it('requires closed_on once a wish leaves standing', () => {
    const doc = load() as WishLedgerDoc;
    delete doc.wishes[0]!.closed_on; // still status "paid"
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/must record closed_on/);
  });

  it('forbids closed_on on a still-standing wish', () => {
    const doc = load() as WishLedgerDoc;
    doc.wishes[1]!.closed_on = 'someday'; // still status "standing"
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/cannot record closed_on/);
  });

  it('rejects a paid wish with an unredeemed pledge', () => {
    const doc = load() as WishLedgerDoc;
    doc.wishes[0]!.pledges[0]!.redeemed = false; // wish is "paid"
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow(/still has an unredeemed pledge/);
  });

  it('rejects a non-slug id and an empty wish text', () => {
    expect(() =>
      WishLedgerDocSchema.parse({
        schema_version: 1,
        wishes: [{ id: 'Not A Slug', text: 'x', sincerity: 'sincere', status: 'standing', recorded_on: 'today' }],
      }),
    ).toThrow();
    const doc = load() as WishLedgerDoc;
    doc.wishes[0]!.text = '';
    expect(() => WishLedgerDocSchema.parse(doc)).toThrow();
  });

  it('rejects unknown keys (strict document)', () => {
    expect(() => WishLedgerDocSchema.parse({ ...raw(), coins_in_till: 9 })).toThrow();
  });
});

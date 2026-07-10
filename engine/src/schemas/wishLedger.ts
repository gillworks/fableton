// SPDX-License-Identifier: Apache-2.0
//
// The wish-ledger is world-DATA: the book the well's attendant keeps of
// wishes fished from the well, the pledges the town makes against them, and
// the debts closed "at compound narrative interest" (petition #172, master
// plan rev 7 goal 1). Today that book lives only in prose — behavior-tree
// labels and chronicle lines (bridge wish PR #144 → Tam's match PR #171).
// This schema gives it a container so a future world-data session can move
// it off-page as JSON.
//
// The seam (docs/architecture.md, CLAUDE.md invariant 1): the *container*
// here is engine/code; the *entries* are world-data authored by the Council
// under `worlds/`. Every word a viewer reads — the wish, the pledge, the
// accounting note — comes from the world, never from engine code. The engine
// holds only the shape and the integrity checks (validate/validateWorld.ts).
import { z } from 'zod';
import { WORLD_DATA_SCHEMA_VERSION, idSlug, nonEmpty } from './common.js';

// A single line in a wish's running account — the "compound narrative
// interest" the chronicle already narrates (a coin becomes a debt becomes a
// fair becomes a bridge). Diegetic and viewer-facing; ordered oldest-first as
// authored. `chronicle_ref` ties the line back to the beat that recorded it
// (e.g. "PR #144") so the inspect panel can cross-link the book to the page.
export const LedgerLineSchema = z.strictObject({
  // The beat this entry was posted — a free diegetic string, not a machine
  // date (the world keeps its own calendar). e.g. "council 2026-07-06".
  on: nonEmpty,
  // The account line the well's book records: "filed under owed, not granted",
  // "counting the stone in her head", "closed at compound interest".
  note: nonEmpty,
  chronicle_ref: nonEmpty.optional(),
});

// One promise made against a wish — a guild's contribution to redeeming it
// (the fair's goose, pot, and match). `by` names the resident who pledged and
// resolves to a real NPC (the world gate checks this, like a rumor's origin).
export const PledgeSchema = z.strictObject({
  id: idSlug,
  // The resident who made the pledge. Must resolve to a placed NPC — a
  // promise from no one is no promise (world gate: asset-refs-resolve).
  by: idSlug,
  // Diegetic, viewer-facing: "a goose for the fair", "a match struck on the
  // bridge stone". Never an enum — the words are the world's.
  what: nonEmpty,
  // Whether the pledge has been kept. A wish is only paid once its standing
  // pledges are redeemed (see the doc-level check below).
  redeemed: z.boolean().default(false),
  // The beat the pledge was kept, when it has been.
  redeemed_on: nonEmpty.optional(),
});

// Sincere wishes are filed "on the left" and carried as debts until paid;
// insincere ones ("gold-egg wishes") have their coins returned and are never
// owed. (winsome.json behavior labels; chronicle PR #144, #171.)
export const WishSincerity = z.enum(['sincere', 'insincere']);
// A sincere wish is `standing` (owed) until its debt is closed (`paid`). An
// insincere wish is `returned` — the coin goes back, no debt is carried.
export const WishStatus = z.enum(['standing', 'paid', 'returned']);

export const WishSchema = z
  .strictObject({
    id: idSlug,
    // The wish itself, as the well recorded it — viewer-facing.
    text: nonEmpty,
    sincerity: WishSincerity,
    status: WishStatus,
    // Who made the wish, if the coin was owned. Wishes are usually anonymous
    // (a coin in a well), so this is optional free text, not an NPC ref.
    wisher: nonEmpty.optional(),
    // The beat the well filed the wish — a free diegetic string.
    recorded_on: nonEmpty,
    // The beat the debt was closed (paid) or the coin returned. Required once
    // the wish leaves `standing` (checked below).
    closed_on: nonEmpty.optional(),
    // Promises made against this wish, in the order the town made them.
    pledges: z.array(PledgeSchema).default([]),
    // The compound-interest account: the running ledger of how the debt grew
    // and was narrated, oldest line first.
    accounting: z.array(LedgerLineSchema).default([]),
    // Notable wishes write a chronicle line on each change of state; quiet
    // ones still live in the book and the inspect panel.
    notable: z.boolean().default(true),
  })
  .check((ctx) => {
    const wish = ctx.value;
    // Insincere coins are returned, never carried as debt; sincere wishes are
    // owed then paid. Keeps the book honest about which entries are debts.
    if (wish.sincerity === 'insincere' && wish.status !== 'returned') {
      ctx.issues.push({
        code: 'custom',
        message: `insincere wish "${wish.id}" must have status "returned" (its coin is returned, never owed)`,
        path: ['status'],
        input: wish.status,
      });
    }
    if (wish.sincerity === 'sincere' && wish.status === 'returned') {
      ctx.issues.push({
        code: 'custom',
        message: `sincere wish "${wish.id}" cannot be "returned" — a sincere wish is owed (standing) then paid`,
        path: ['status'],
        input: wish.status,
      });
    }
    // A closed entry (paid or returned) records when it closed; a standing
    // one has not closed yet.
    if (wish.status !== 'standing' && wish.closed_on === undefined) {
      ctx.issues.push({
        code: 'custom',
        message: `${wish.status} wish "${wish.id}" must record closed_on (the beat its debt was settled)`,
        path: ['closed_on'],
        input: wish.closed_on,
      });
    }
    if (wish.status === 'standing' && wish.closed_on !== undefined) {
      ctx.issues.push({
        code: 'custom',
        message: `standing wish "${wish.id}" cannot record closed_on — it is not settled yet`,
        path: ['closed_on'],
        input: wish.closed_on,
      });
    }
    // A paid wish cannot leave a standing pledge unredeemed — the debt is only
    // closed once every promise against it is kept.
    if (wish.status === 'paid') {
      wish.pledges.forEach((pledge, i) => {
        if (!pledge.redeemed) {
          ctx.issues.push({
            code: 'custom',
            message: `paid wish "${wish.id}" still has an unredeemed pledge "${pledge.id}" — close the pledge or reopen the wish`,
            path: ['pledges', i, 'redeemed'],
            input: pledge.redeemed,
          });
        }
      });
    }
  });

export const WishLedgerDocSchema = z
  .strictObject({
    schema_version: z.literal(WORLD_DATA_SCHEMA_VERSION),
    // The resident who keeps the book. Resolves to a placed NPC (world gate).
    // Fableton's is Winsome, the wishing-well attendant; defaulted so a world
    // that names no keeper still parses to its most common shape.
    keeper: idSlug.default('winsome'),
    wishes: z.array(WishSchema),
  })
  .check((ctx) => {
    const wishSeen = new Set<string>();
    ctx.value.wishes.forEach((wish, i) => {
      if (wishSeen.has(wish.id)) {
        ctx.issues.push({
          code: 'custom',
          message: `duplicate wish id "${wish.id}"`,
          path: ['wishes', i, 'id'],
          input: wish.id,
        });
      }
      wishSeen.add(wish.id);
      // Pledge ids are unique within a wish — two pledges sharing an id could
      // not both be crossed off independently.
      const pledgeSeen = new Set<string>();
      wish.pledges.forEach((pledge, j) => {
        if (pledgeSeen.has(pledge.id)) {
          ctx.issues.push({
            code: 'custom',
            message: `duplicate pledge id "${pledge.id}" in wish "${wish.id}"`,
            path: ['wishes', i, 'pledges', j, 'id'],
            input: pledge.id,
          });
        }
        pledgeSeen.add(pledge.id);
      });
    });
  });

export type LedgerLine = z.infer<typeof LedgerLineSchema>;
export type Pledge = z.infer<typeof PledgeSchema>;
export type Wish = z.infer<typeof WishSchema>;
export type WishLedgerDoc = z.infer<typeof WishLedgerDocSchema>;

# Design language — charter-themed dioramas

Canonical mockups: **"Fableton Worlds.dc.html"** in the [Claude Design project](https://claude.ai/design/p/2f373659-85a5-43c5-882d-453cef794ee6?file=Fableton+Worlds.dc.html) (export lands in `docs/design/` when synced). Decision record: [ADR-0003](adr/0003-design-language.md). Concepts approved 2026-07-02 across three worlds — Fableton (warm storybook), Cindervault (forge-dark), Skeinsea (mist-pale) — same grammar, radically different skins. That is the point: **the UI theme is charter data.**

## The split (mirrors the engine/world split)

**Engine grammar (fixed, identical in every world):** the diorama framing, HUD anatomy, panel anatomy, phase mechanics.
**Charter theme (per-world data):** palette, typography pair, accent color, day-phase *names*, premise line, chronicle voice.

A client PR that hardcodes any charter-side value fails review. A charter that omits a theme token gets engine defaults, never another world's values.

## Engine grammar

### The diorama
The world renders as a low-poly vignette on an **elliptical ground "coin"** centered on the page; the page background is the charter's atmosphere gradient. The world reads as an island diorama, not a fullscreen viewport — explore camera (drag/zoom/orbit) operates within this framing at village scale. Chunky low-poly buildings with slight roof overhangs, blob-topped trees, capsule-figure NPCs in single-color robes, soft phase-dependent shadows.

### HUD anatomy (fixed positions, charter-themed surfaces)
- **Top-left:** world name — display face, letterspaced caps · one-line premise below (italic where the display face is a serif) · chip row: `CHARTER Vn` `SEED n` (mono, outlined pills).
- **Top-right:** `DAY n · <PHASE>` pill (mono caps) + **four-segment phase selector**; the active segment fills with the charter's accent color.
- **Bottom bar:** `CHRONICLE` (mono, letterspaced, muted) + the latest chronicle entry in the world's voice. Entries may reference studio activity by PR (*"Merged: the North Orchard grows (PR #142, CI green)"*).

### Day phases
Exactly **four** per world. Phase changes relight the scene — background gradient, window glow, lamp intensity, shadow length — never relayout it. Phase *names* are charter data (see tokens below).

### The studio, visible in-world
Regions under construction render as a **wireframe ghost volume + crane + dark placard**: `UNDER CONSTRUCTION — PR #nnn` (mono). Clicking links to the open PR. This marker is engine chrome — same in every world.

### NPC activity + inspect panel
- Ambient activity: a **dark rounded tooltip, mono text**, showing the NPC's live behavior-tree label verbatim (*"telling the pond about the wolf again"*). This is why every tree node carries a diegetic label.
- **Inspect panel** (raycast pick → card, top-right): always **parchment-cream, in every world** — the panel is the reader's lamplight, even in Cindervault's dark. Anatomy top-to-bottom:
  1. Avatar circle (initial) · **Name** (display bold) · role line (italic, may carry a wry parenthetical — *"woodcutter, retired (allegedly)"*)
  2. Bio: 2–4 sentences in the world's voice
  3. **Activity pill**: dark bg, accent dot, mono — the live tree label
  4. `RELATIONSHIPS` (mono muted heading): entries as **bold name** — em dash — *italic clause* (*"**the pond** — a good listener"*)
  5. Footer, mono muted: `lore/<npc-id>.json · tree: <namespace>.<state>`

### Data-contract implications (feed ADR-0001 / issue #2)
NPC lore files live at `lore/<kebab-id>.json`; behavior trees are namespaced `<archetype>.<state>`; chronicle entries carry optional PR references; relationships are `{name, clause}` pairs renderable as above.

## Charter theme tokens

Each charter's `aesthetic` supplies (template updated accordingly):

| Token | Fableton (flagship) | Cindervault (divergence) | Skeinsea (divergence) |
|---|---|---|---|
| `theme` | warm storybook | forge-dark | mist-pale |
| `typography` (display + mono) | Alegreya + IBM Plex Mono | Zilla Slab + mono | Jost + mono |
| `palette` | moss ground; muted red/blue/teal roofs; warm window amber; indigo→navy night | ash/umber ground; near-black browns; ember orange; lava-glow channels | glass-green sea; pale stone; slate-sage roofs; cream sky |
| `accent` | amber | ember orange | buoy red / tide gold |
| `day_phases` (exactly 4) | first light · high sun · lamplighting · hush | ashdawn · forge-day · smelt-dusk · banked | morning tide · high glass · gloaming · bell-dark |
| premise (in `identity`) | *The town where fables retired.* | *The city that banked the last fire.* | *The archipelago where the fog remembers.* |

Chronicle voice follows the world (*"Marigold Crumb and Quill are feuding again; the Chronicle is delighted"* vs *"The tide brought back a bell today; nobody claimed it"*) — authored by agents under the charter's tone, not templated.

## For implementers

- Issue #10 (rendering): diorama framing + phase relighting live here.
- Issue #11 (inspect): panel anatomy above is the spec; parchment always.
- HUD chrome (name/premise/chips, phase selector, chronicle bar, construction markers) is its own issue — see the tracker.
- Theme tokens arrive via the parsed charter; the client never imports world-specific constants.

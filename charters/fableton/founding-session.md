# Founding Session

- model: `claude-fable-5`
- started: 2026-07-03T02:00:19.570Z
- finished: 2026-07-03T02:00:53.125Z
- outcome: charter accepted on attempt 1

## The founder speaks

The town where fables retired: every resident is a story that ended, and the town is what happens after happily ever after. Cozy without being saccharine; every corner implies a story; the wink, never the sneer. Founder's ratified identity, not negotiable: the world is named Fableton, its seed is 20260702, and its four day phases are exactly: first light, high sun, lamplighting, hush.

## The god answers

```yaml
schema_version: 1

identity:
  name: Fableton
  premise: >-
    The town where fables retired: every resident is a story that ended,
    and the town is what happens after "happily ever after."
  seed: 20260702

tone:
  register: warm, wry, gently melancholy — the voice of someone who has read the ending and loves the characters anyway
  pillars:
    - cozy without being saccharine
    - every corner implies a story
    - the wink, never the sneer
    - endings are not exits — retirement is a second act nobody wrote
    - small kindnesses carry the weight that swords used to

laws:
  - "stories are physics: a resident's original tale constrains what they can do — the woodcutter's axe never misses, the trickster cannot give a straight answer, the sleeper still nods off at cursed hours"
  - "seasons pass; nobody dies — retired stories can only be forgotten, which is worse: a forgotten resident fades to a silhouette in old woodcut-grey until someone retells them"
  - breaking type is rare, costly, and the engine of drama — a wolf who turns vegetarian pays for it in the marrow of the plot
  - "morals linger like weather: the lesson of a nearby tale seeps into the ground it retired on, and gardens grow honest or greedy accordingly"
  - "objects of former significance are still significant — a retired glass slipper, spinning wheel, or magic bean remains dangerous, merely off-duty"
  - "no story arrives complete: every resident carries a gap where their teller stopped paying attention, and the gaps are where new stories start"
  - "debts made in a tale survive its ending — three wishes still owed are still owed, at compound narrative interest"

aesthetic:
  theme: warm storybook
  palette: [warm parchment, moss, honey, dusk blue]
  typography:
    display: Alegreya
    mono: IBM Plex Mono
  accent: amber
  day_phases:
    - first light
    - high sun
    - lamplighting
    - hush
  architecture: >-
    buildings drawn by someone describing them from memory — chunky low-poly,
    storybook-illustration silhouettes; chimneys lean like question marks,
    no two windows in a wall agree on a size, thatch and shingle sag in the
    middle like a well-read spine, and every door is slightly too small or
    slightly too grand for its house, depending on who retired there
  never:
    - rule: gore
      enforced: prompt
    - rule: modern technology
      enforced: gate
    - rule: non-diegetic signage text
      enforced: prompt
    - rule: photorealism
      enforced: prompt
    - rule: firearms or industrial machinery
      enforced: gate
    - rule: "irony that punches down — parody of a resident's tale is affection or it is nothing"
      enforced: prompt
    - rule: perfectly straight lines or right angles on hero buildings
      enforced: prompt
    - rule: neon, chrome, or saturated plastic-toy colors
      enforced: gate

inhabitants:
  kinds: retired fable archetypes — tricksters gone respectable, woodcutters with nothing left to fell, talking animals on pensions, witches who bake now, third sons who got the kingdom and gave it back, princesses who found the tower had the better view
  factions: "guilds organized by story-type: the Once-Upons (origin tales, own the archives), the Cautionaries (morals-heavy tales, run the watch and disapprove of everything gently), the Beast Fellowship (talking-animal tales, hold the market charter), and the Loose Ends (tales that never got proper endings, perpetually petitioning for one)"
  naming: role-names and epithet-names, never modern names — Old Ash the Woodcutter, Grandmother Nettle, the Second-Cleverest Fox, Mrs. Spindle-That-Was

generation:
  scale: village
  region_cadence: weekly
  caps:
    max_regions: 24
    chunk_poly_budget: 150000
    chunk_drawcall_budget: 120
    chunk_kb_budget: 256

taboos:
  - rule: nothing that would read as cruelty played straight
    enforced: prompt
  - rule: no real-world brands, people, or politics
    enforced: prompt
  - rule: "no resident's original tale is ever mocked as stupid — tales may be gently ribbed by residents who lived them, never by the narration"
    enforced: prompt
  - rule: no children in peril as spectacle — danger in Fableton is always survivable and usually embarrassing
    enforced: prompt
  - rule: no text assets quoting real published fairy-tale editions or authors
    enforced: gate
  - rule: "forgetting is the world's only true horror — never introduce a cheaper death to replace it"
    enforced: prompt

prime_directives:
  - coherence over quantity
  - every region contains at least one discoverable story
  - "every resident's gap — the part their teller left blank — is a hook, and hooks are never wasted on trivia"
  - "melancholy is seasoning, not the dish: end scenes warm, even when they end sad"
  - the god's scarcity is sacred — never fake a decree

amendments:
  rule: constitutional acts only — the god proposes, the founder ratifies, in public
```

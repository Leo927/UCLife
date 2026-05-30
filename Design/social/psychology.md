# Character psychology — temperament & causes

NPCs were undifferentiated, so the relationship machinery in [relationships.md](relationships.md) had nothing to bite on. Psychology gives every character two **independent** axes. Keeping them separate is the whole point: a self-interested Zeon sympathizer and a selfless one are both real and interesting, and collapsing them into one list throws that away.

| Axis | Question | Kind |
|---|---|---|
| **Temperament** | *How* does this character decide and react? | personality |
| **Sympathies toward causes** | *What* do they want for the world? | ideology |

## Temperament

A small set of personality leanings — e.g. self-interested, loyal, idealistic, pragmatic, proud, timid. (Catalog TBD; keep it **small** — these are CK "traits," not a stat tree.)

- **Representation.** `Effect`s on the character `StatSheet` (single-channel rule — no second engine). Source-namespaced (`temperament:proud`).
- **Function.** Temperament scales *how* a character reacts. A proud character takes a slight harder; a pragmatic one forgives a profitable betrayal. It weights the magnitude of opinion deltas and the threshold of drive responses ([../npc-ai.md](../npc-ai.md)).
- **Reveal.** Always-on, through dialogue *tone*. Every line a character speaks is phrased by temperament — free, no gate. The player infers "she's prickly" without ever seeing a tag.

## Causes

Named ideological positions in the UC setting. Each character carries a **sympathy weight per cause, `-1..+1`** (most people are lukewarm on most causes):

- Zeonism / colonial autonomy
- Federation order
- AE corporate pragmatism (neutral profit)
- Pacifism
- (extensible; authored)

- **Shared vocabulary.** Cause tags are the *same* tags used by news entries ([newsfeed.md](newsfeed.md)) and faction alignment. One Zeon-autonomy headline makes a proud Zeonist exult and a Federation loyalist bristle — for free, off content that already exists.
- **Representation.** Sympathies are `Effect`s on the `StatSheet`; cause tags are enums shared with news + factions.

### Reaction formula

A stance, policy, action, or news event is tagged with the causes it advances or antagonizes. A character's reaction:

```
reaction = dot(event.causeTags, character.sympathies) × temperamentScale
```

Positive → opinion of the actor rises (and mood lifts); negative → falls. This one formula powers stance reactions ([relationships.md](relationships.md)), news-driven mood, and drive shifts ([../npc-ai.md](../npc-ai.md)).

### Reveal — deterministic-progressive

Causes reveal on the **first conversation of the (game) day** — the one-meaningful-interaction-per-day lever (Persona social links). **Not a chance roll:** each first-talk reveals the next not-yet-known cause-sympathy, highest magnitude first, until exhausted, then a tag appears on the character in inspector mode.

Deterministic over chance because a roll punishes unlucky players and hides information; progressive reveal turns relationship-building into *visibly unlocking the character sheet over days* — legibility as reward (see [relationships.md](relationships.md) § reward loops). The daily gate also blocks brute-force re-clicking.

## Aggregation — the bridge to politics (Phase 6.4)

Individual sympathies are flavor until they **sum into something the player can move**. A district has a measurable *lean* (the weighted sum of its residents' sympathies); a facility has a loyalty *mood*. Stances and policies shift the aggregate.

- This is where the Guild-3-style **politician path** lives — and why it's faction-tier: policy needs an institution to enact, so it lands when the player runs or leads a faction ([../phasing.md](../phasing.md) Phase 6.4), not before.
- It is also the **connective tissue between the city life-sim and the space / fleet layer**: the city is the *electorate*. A fleet-owning player still walks back into Von Braun because the district's lean is something their stances and standing can move.

Perf: aggregation is a per-district reduce over residents, computed **lazily** (on stance / policy events + daily rollover), not per tick. State N = residents per district (tens). Cache the reduce; invalidate on membership / sympathy change.

## Save contract

Temperament and sympathy `Effect`s serialize with the `StatSheet` (`serializeSheet` strips formulas, `attachFormulas` re-seeds on load). Cause tags are static data. Revealed-to-player flags live per character and round-trip via `EntityKey`.

## Related

- [relationships.md](relationships.md) — the per-pair machinery temperament + causes color
- [newsfeed.md](newsfeed.md) — shares the cause-tag vocabulary; surfaces stances as gossip
- [../npc-ai.md](../npc-ai.md) — temperament + sympathies weight drives
- [faction-management.md](faction-management.md) — Phase 6.4 aggregation → policy

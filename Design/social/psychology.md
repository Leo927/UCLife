# Character psychology — temperament & cause-sympathies

*What differentiates one NPC from another beneath the relationship layer. The mechanics that read this — opinion shifts, propagation, the lazy reveal — live in [relationships.md](relationships.md).*

Psychology is **two orthogonal axes**, deliberately not one list. Collapsing them throws away the most interesting characters — a selfish Zeon sympathizer and a selfless one are both real and read very differently.

| Axis | Question | Word |
|---|---|---|
| **Temperament** | *How* does this character decide and react? | personality |
| **Sympathies toward causes** | *What* does this character want for the world? | ideology |

## Temperament

A character's disposition: self-interested, loyal, idealistic, pragmatic, proud, timid, and so on (Crusader Kings "traits"). Temperament does not pick a side; it scales *how hard* a character reacts to anything and *how* they carry themselves.

- **Always revealed, through dialogue tone.** Temperament colours every line the NPC speaks — it is the cheapest, richest reveal in the game, so it is never gated. A proud character and a timid one deliver the same grievance differently.
- **Scales reactions.** Temperament is the multiplier on opinion shifts: a zealous character swings hard on a stance they care about; a phlegmatic one barely moves.

## Sympathies toward causes

A **cause** is a named ideological position in the UC world:

- **Zeonism / colonial autonomy** — the spacenoid independence movement
- **Federation order** — Earth-led central authority
- **AE corporate pragmatism** — profit and neutrality above allegiance
- **Pacifism** — opposition to militarization at all

Each character holds a weighted **sympathy** toward each cause, `-1..+1` (strongly opposed → strongly for; most people sit near zero on most causes). Sympathies are stored as `Effect`s on the character's `StatSheet` ([../characters/effects.md](../characters/effects.md)) — the single-channel stat engine, reused; there is no second psychology store.

### The reaction formula

Every action, policy, news event, or movement is **tagged** with the causes it advances or antagonizes (the same tag vocabulary `news.json5` already uses). A character's reaction to it is:

```
reaction = dot(event.causeTags, character.sympathies) × temperamentScale
```

A spacenoid-favoring policy (tagged `+colonial-autonomy`) warms a Zeon sympathizer toward whoever backed it and cools a Federation loyalist. This one formula drives news-mood, policy reactions, and the character-to-character political shifts in [relationships.md](relationships.md#politics--character-to-character-deferred-career). It does not run as a global sweep — a character only reacts to a stance once they are **aware** of it (gossip / news / co-location; see [newsfeed.md](newsfeed.md)), which keeps it event-paced and cheap.

## Revealing sympathies

Sympathies are hidden until the player earns them — and earning them is **deterministic and progressive, not a chance roll.** A chance roll punishes unlucky players and hides information; progression turns relationship-building into visibly unlocking the character sheet.

- On the **first conversation of the day** with a character, they express their **strongest not-yet-revealed sympathy** — support or distaste for one cause — in character. That cause is now tagged on them in inspector mode.
- Subsequent days reveal the next-strongest, until exhausted. One reveal per character per day; brute-force re-clicking yields nothing.

This makes **legibility a reward in itself** ([relationships.md](relationships.md#why-the-player-maintains-it)): time invested in a character literally unlocks who they are, before any mechanical payoff.

## Aggregation — the politics payoff

Individual sympathies are flavor until they **sum into something the player can move.** This is the far-future destination, not a near-term feature:

- A **district** has a measurable lean = the weighted sum of its residents' sympathies. A **facility** has a loyalty mood the same way.
- Policies, broadcasts, and the player's public stances shift the aggregate.
- A player who has *joined* a faction can rise inside it by swaying a populace — the **politician career path** ([faction-management.md](faction-management.md)). This is also the load-bearing answer to "why does a fleet-owning player still walk back into Von Braun": the city is the electorate.

Aggregation lands at faction-tier. The per-character reaction mechanic above is the near-term half and ships as soon as causes exist.

## Why this is not wasted simulation

The discipline that keeps psychology from becoming an invisible spreadsheet: **every unit of NPC interiority has a matching player-facing surface that reveals it** (design principle #1, player-model first).

| Interiority | Surface |
|---|---|
| Temperament | Dialogue tone, always on |
| Cause-sympathies | Progressive first-talk reveal + inspector tag |
| A reaction to the player's stance | The lazy grievance/credit reveal ([relationships.md](relationships.md#the-lazy-reveal)) |
| Aggregate district lean | Politics surface (faction-tier) |

If interiority ever outruns its surface, cut the interiority — not the other way around.

## Related

- [relationships.md](relationships.md) — the opinion graph, propagation, lazy reveal, and loyalty that read these axes
- [newsfeed.md](newsfeed.md) — shares the cause-tag vocabulary; the awareness channel that paces reactions
- [../npc-ai.md](../npc-ai.md) — sympathies and temperament feed the drive/utility weights
- [../characters/effects.md](../characters/effects.md) — sympathies are Effects on the StatSheet (single channel)
- [faction-management.md](faction-management.md) — aggregation and the politician career path

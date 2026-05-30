# Relationships & faction reputation

## Relationships

Modeled as Koota relations (entity-to-entity edges with data). Per-pair state is **character-to-character** — the player is just one character, and nothing here is hard-coded to a player surface, so two NPCs relate to each other by the same rules.

Per-pair state on the relation:

- `opinion: -100..+100`
- `lastInteractionTick`
- `nature` — `acquaintance | friend | rival | enemy | kin` (kin = couple / parent / sibling; **authored backstory, not player-startable** — see Romance & kin)
- `grievances` / `credits` — queue of unacknowledged deltas `{ cause, delta, when }`; see Lazy reveal

### Opinion moves both ways

Opinion used to mostly climb, which makes relationships a checklist — the Stardew heart-grind failure: max everyone, then stop caring, because there's no maintenance tension and no opportunity cost. The missing half is what pulls opinion *down*:

1. **Hostile actions** — direct (you attacked them) or propagated (you attacked their friend or kin; see Propagation).
2. **Stance conflict** — you backed a cause they're hostile to; see [psychology.md](psychology.md).
3. **Neglect decay** — slow drift toward a neutral baseline when the pair hasn't interacted. Decay settles at a **stable equilibrium**, it does not bleed to zero. Maintenance is a choice, not a chore.

Most changes are small. Drastic swings come from high-weight actions: betrayal, lethal violence, a major favor.

### Propagation — bounded, event-driven, surfaced

A hostile (or generous) action against a character ripples to characters who care about them. Three hard constraints keep this from becoming noise the player can't perceive:

- **Bounded hops.** Propagation runs **≤2 hops** from the actor over the relation graph. Past friend-of-friend, nobody can hold the causal chain in their head.
- **Event-driven, not per-tick.** The ripple fires on the notable action, as a bounded BFS from the affected node — never a global sweep. Complexity: `O(notable_actions × avg_degree²)`; the Koota relations *are* the graph. **Do not** run global per-tick propagation — that's `O(N²)` over the city per tick and buys nothing.
- **Surfaced, or it's a bug.** Every propagated shift becomes content — see Lazy reveal and the gossip channel in [newsfeed.md](newsfeed.md).

### Lazy reveal — eager state, lazy acknowledgement

The opinion change is **applied at action-time** (eager and honest — every downstream reader sees the true value; the affected NPC gossips and withholds favors correctly even before you next meet). What is lazy is the player's *awareness*: at action-time each affected relation edge also gets a **grievance** (or **credit**) record. The next time the player talks to that NPC, the NPC surfaces it in-character, shows the swing, and clears the record:

> 你三天前打断了我弟弟克劳斯的胳膊。（关系 −18）

Requirements:

- **Specificity.** The record carries who / what / when so the line names the actual deed. A generic "你做了对不起我的事" reads as the NPC randomly turning on the player — that defeats the system.
- **Symmetry.** Favors queue as credits and are thanked for the same way.
- **Save contract.** Grievances / credits live on the relation edge and round-trip via `EntityKey`; there is no global last-N-actions buffer.

**Do not defer the state change itself.** A relationship that only drops when observed is a lie until observed — it breaks drives, recruiting gates, and loyalty, all of which read opinion continuously.

### Romance & kin — authored, not player-startable

NPCs have couples, parents, and siblings as authored backstory — this is what makes "you hurt A's brother" work. The player does **not** start romances or have children: that's a genre pivot (Sims / CK) and a content-guardrail concern given the portrait lineage. Kin edges exist in the graph and propagate; the player simply never originates one.

## The talk verb

Right-click any NPC → a short greeting that now does three jobs:

1. **Settle grievances / credits** (above).
2. **Express temperament** through *how* it's phrased — always on; see [psychology.md](psychology.md).
3. **Occasionally reveal a cause-sympathy** — first conversation of the day, deterministic-progressive; see [psychology.md](psychology.md).

The greeting still varies by stable persona, faction tag, current drive, opinion, and recently-consumed news (gossip layer, [newsfeed.md](newsfeed.md)). No branching tree at first ship; branching is later.

## What relationships are *for* — reward loops

Relationships were inert because they had no payoff. Four loops give them one, smallest-first:

1. **Legibility is itself a reward.** Building a relationship visibly unlocks a character's temperament and causes over days ([psychology.md](psychology.md)). Learning who someone is is worthwhile *before* any mechanical payoff (CK courtier traits; Disco Elysium thoughts).
2. **Favors (non-members).** A friendly non-member will teach a skill, give a discount, or make an introduction. Friendship gates the favor.
3. **Recruiting requires friendship.** You can't hire a captain / pilot / crew member you haven't befriended past a threshold.
4. **Loyalty binds to relationship.** A faction member's loyalty drifts with their relationship to their leader — a negative relationship decays loyalty, a positive one grows it. This is the connective tissue between the social pillar and the fleet pillar: your captains and pilots are NPCs from the pool, so maintaining them *is* the social game.

### Delegation hatch — an escape, not a leash

At fleet-of-30, maintaining every member relationship directly is **fine if the player wants to** — crew loyalty can bind straight to the player. The delegation hatch is an *optional* escape valve, not forced structure: crew loyalty may instead bind to their immediate captain, so the player maintains a few captain relationships and captains carry their crews (the "talk to the captain, not every crewman" discipline in [diegetic-management.md](diegetic-management.md)). The player chooses how much to delegate; the system never drags them out of hands-on maintenance.

## Stance reactions — politics without being a faction

When any character takes a public stance on a cause (backs a policy, joins a movement), their relationship shifts with every character who has sympathies on that cause — fitting causes raise it, antagonized causes lower it ([psychology.md](psychology.md)). The player is just one such character: a Zeon sympathizer warms to you for backing a spacenoid-favoring policy; a Federation loyalist cools.

The player does **not** need to *be* a faction to play this — joining one and taking its stances is enough. Reactions travel through the **awareness channel** (gossip / news / co-location), never a global sweep, so a distant NPC learns your stance the same diegetic way they learn a grievance: next time you talk. The full politician career (e.g. rising inside the Federation) is the faction-tier aggregation payoff — see [psychology.md](psychology.md) § Aggregation and [../phasing.md](../phasing.md).

## Faction reputation

Player has a reputation (`-100…+100`) with each faction. Affects which NPCs will talk, which jobs are available, which areas accept them.

Phase 5.3 ships visible Federation and Zeon presence (consulates, uniformed NPCs); reputation hooks already exist but only AE meaningfully reads them until 5.3 lands.

Faction reputation is the **institutional** aggregate; per-character opinion is the **personal** layer. The aggregation model in [psychology.md](psychology.md) links the two — a district's lean is the sum of its residents' sympathies, and the player's standing moves it.

## Related

- [psychology.md](psychology.md) — temperament + causes that color every interaction here
- [ambitions.md](ambitions.md) — "befriend X" ambitions read opinion
- [newsfeed.md](newsfeed.md) — gossip surfaces grievances / credits and stances
- [../characters/attributes.md](../characters/attributes.md) — Charisma drives opinion drift
- [../npc-ai.md](../npc-ai.md) — opinions + sympathies feed NPC drives

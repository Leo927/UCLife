# Diegetic management

*The surface-design discipline for Phase 6 faction management. Management of fleet, colony, and faction lives on bodies and in places — not in floating menus.*

## Why this file exists

Faction management is the largest menu-pressure surface in the game. The temptation is to ship a stack of roster tables: a fleet panel, a pilot roster, a crew screen, a doctrine slider grid, a governance dialog. Each one is a context tab the player toggles into and out of, none of which is in the world.

That trades the diegetic frame UC Life Sim has built — walkable cities, embodied NPCs, talk-verb interactions — for a spreadsheet UI. The promise that *your bartender becomes your bridge officer* collapses into *your bartender's name appears in row 3 of a list.* Ten hours in, the player's faction is a tab, not a place.

This file establishes the discipline that prevents that. The roster tables in [../fleet.md](../fleet.md#player-facing-surfaces) are not removed — they continue to exist as the data model — but they are demoted to **UI projections** of diegetic surfaces, not the primary verb.

## The principle

**Management lives on bodies and in places.** Two test questions for any new management feature:

1. **Where in the world does this happen?** A physical room, a workstation, a console, a person.
2. **Who is the player talking to?** Not what listbox are they choosing from — who is the responsible NPC?

If the answer is "a floating panel" / "no one in particular," the feature is undesigned. Find the room and find the person.

## Physical hubs

The faction has a small, fixed set of physical hubs. Every management verb maps to one of them:

| Hub | Where | Owner NPC | Verbs at this hub |
|---|---|---|---|
| **Flagship bridge** | The walkable bridge of the player's current ship | Hired captains stand at their stations *here* when their ships are docked with the fleet; an empty station means "ship is detached" | Talk to a captain → set their ship's doctrine, give standing orders, swap captain assignment, scrap / mothball a ship via conversation |
| **War room** | A holographic plot table on the flagship bridge | None — the artifact itself | Fleet-wide formation, DP commit for next engagement, route planning. Info-dense, the one allowed abstraction (see below). |
| **Hangar deck** | The walkable hangar of whichever ship has hangar capacity | Hangar boss (a hired NPC, role-tagged); pilots stand near their assigned MS | Walk up to an MS → retrofit panel; walk up to a pilot → reassign / talk; walk up to the hangar boss → set repair priorities, scrap an MS |
| **Officer's quarters / wardroom** | Bunks + wardroom on the flagship | The officer themselves, off-duty | Long-form talk, friendship deepening, loyalty management — the existing city talk-verb surface, ported aboard |
| **Recruitment post** | A booth at a colony bar / port | Recruitment officer (hired NPC) | Set recruitment criteria *as a conversation*; inspect / approve / reject queued applicants who walk up to the post over game-time |
| **Colony command center** | The walkable command center building of each owned colony | Colony administrator (hired NPC) | Set colony policies, review status, trigger raid response |
| **Council chamber** | A meeting room at the player's largest colony (Phase 6.4) | Senior officers + colony administrators in attendance | Faction-wide governance — taxation, alignment, diplomacy. Each NPC argues a position from their persona, skills, loyalty; the player resolves the room by speaking. |

What's deliberately not on this list: there is no fleet roster *room*, no pilot roster *room*, no crew assignment *room*. The roster is the union of what's walkably present at each hub.

## Order as conversation: first-touch + quick-recall

The pure form — "every order requires walking to the captain on the bridge" — fails at scale. A 20-ship fleet is a death march if you must walk between captains every time you change a doctrine.

The pattern is two-step:

1. **First touch is in person.** The first time the player establishes a relationship with an officer — hire, first doctrine setting, first standing order — they walk to that officer and speak. This is when the order channel is opened.
2. **Quick-recall is via comm.** After first touch, the officer is reachable from a **comm panel** on the flagship bridge: a physical wall of *faces* — portraits, current expression, name, last reported state — one per officer the player has met. Click a face → speak to them remotely.

This preserves the diegetic frame (you are still talking to a person, not toggling a slider) while solving the scale problem (you don't have to be physically next to them to give the order). The comm panel is itself a physical object on the bridge — a real wall — visible whether the player uses it or not.

The comm panel is **not** a fleet roster table. It only shows officers the player has *met and addressed*. Crew that have been auto-assigned but never spoken to do not appear; the player has to walk to them once first.

## The war room is the one allowed abstraction

A multi-ship fleet has formation positions, deployment plans, and route choices that are genuinely high-density spatial information. There is no body to attach this to — it's not "what does Captain Yamada think about the formation," it's the formation itself.

The **war room** is a single physical artifact (a holographic tactical plot) on the flagship bridge. The player walks to it; the player rotates / zooms / drags ship tokens on it; the player issues fleet-wide orders here. It is a UI surface, but it is a *located* one — using it is "I am standing at the chart table," and the visual idiom is a 3D plot, not a list.

The war room is the *only* per-fleet floating-information surface the design grants. Pilots, captains, crew, recruitment, colonies — all of those route through bodies and places.

## Roster panels are projections, not primary

The fleet roster, MS bay, pilot roster, crew assignment, and officer dialog screens described in [../fleet.md](../fleet.md#player-facing-surfaces) continue to exist as **read-mostly projections** — the player can pop them open from the bridge for at-a-glance status. But:

- **Writes route through the diegetic surface.** The roster shows a captain's current doctrine, but you cannot change it from the roster — the doctrine cell opens that captain's face on the comm panel, or routes the player to walk to them if not yet first-touched.
- **No first-time hires from a roster.** Hiring is always a talk-verb action on an embodied NPC, in the world.
- **The roster never lists strangers.** It lists faces the player has met. Crew the player has not addressed appear as anonymous tallies ("47 unmet crew aboard the *Salamis*") until first touch.

This is what makes the roster compatible with the diegetic spine: it's a notebook, not a god panel.

## Recruitment scale via diegetic delegation

Phase 6.4's "open recruitment calls on a colony" — the scale-up that lets the player hire en masse rather than one by one — runs through a hired **recruitment officer** at a recruitment post. The verbs:

- **Walk to the recruitment post**, talk to the officer.
- **Set criteria as conversation** — "我想招机师，至少 30 piloting，最好亲联邦的。"
- **Watch the queue.** NPCs walk up to the post over hours / days of game time. The player can drop in to inspect queued applicants (read persona, skills, loyalty estimate) and approve / reject.
- **Or trust the officer.** A high-Leadership recruitment officer auto-approves applicants matching criteria; a low-skill one mis-hires. This is what the recruitment officer's *skills* mean diegetically.

The "open call" feature is therefore not a menu that produces 30 named NPCs at a click — it is a verb that *causes* 30 NPCs to walk into your colony over the next week, each of whom you can still meet, talk to, and override.

## Governance is a council, not a menu

Phase 6.4 governance choices (taxation, alignment, trade priorities, diplomacy) happen in a **council chamber** at the player's largest colony. The player calls a council; senior officers and colony administrators attend in person. Each NPC argues a position derived from their persona, skills, faction loyalties, and accumulated memory — a Crusader Kings council, embodied. (See also [../npc-ai.md](../npc-ai.md) for the persona / memory shape these arguments draw from.)

The player resolves the room by speaking ("税率从 8% 升到 12%。"). The choice is logged as a faction policy effect; dissenting officers carry a mood penalty for some game-time and may surface in the talk-verb later.

This converts an otherwise spreadsheet-tier feature (a slider grid of policies) into a recurring *event* the player walks into and witnesses opinions colliding. The room is the system.

## Acquisition is part of the surface

Hubs do not just appear when the player has enough credits. The act of
*acquiring* a hub — the first ship, the first colony — is itself a
diegetic arc, not a click. A click that produces a colony has the same
shape as a slider that sets a doctrine: a feature with no body and no
place.

The acquisition pattern: **find a candidate** in the world (a POI on
the campaign map, a hull at a broker), **resolve the human factor**
on-site (an NPC obstacle — pirates to clear, an owner to buy out, a
survivor to hire, a permits clerk to talk to), then **take possession
in a walked moment** (the first walk onto your bridge, the first sit
in the empty administrator's chair). Each step has a body and a place;
none is a transaction dialog the player skips through.

Per-acquisition detail (named candidates, charter NPCs, establishment
package, construction interrupts) lives in
[faction-management.md](faction-management.md#colony-claim-or-build).
This file just establishes the surface principle: the moment of
acquiring is itself a diegetic arc.

## What this constrains

This discipline is a real constraint on what features can ship. Specifically:

- **No new management feature ships without a hub + an owner NPC.** If the next thing is "intelligence operations," it lives at an intel office with a spymaster NPC, not in a tab. If the answer to "where does this live" is "I don't know," the feature is not ready.
- **Walking distance is a real cost.** A management hub three rooms away from the bridge is a hub the player uses reluctantly. Place hubs to amortize travel: bridge + war room + comm panel together, hangar one stair down, command center near the colony entrance. Treat the flagship layout as level design.
- **Comm panel content is an authoring cost.** Each face has reactions, expressions, a few zh-CN lines per state. Budget this — under-authoring the comm panel is the failure mode that turns the feature into a list of names anyway.
- **The war room is the only place to add UI density.** When in doubt, push new info into the war room (which is allowed to be info-rich) rather than spawning a new floating panel.

## Phasing

| Phase | Scope |
|---|---|
| **6.0–6.1** | Diegetic recruitment via talk-verb hire on city NPCs. Walkable bridge + walkable hangar. No comm panel needed yet (single ship). |
| **6.2** | Multi-ship fleet → comm panel as physical object on the bridge. War-room artifact on the bridge for formation + DP commit. Hired captains stand on the flagship bridge when their ships are docked with the fleet. Doctrine + standing-order verbs surfaced as captain conversations. Fleet roster panel demoted to projection. |
| **6.2.5** | Hangar boss NPC owns hangar-wide verbs (repair priority, scrap). Pilots stand near their assigned MS in the hangar. Retrofit panel opened by walking to an MS, not from a menu. |
| **6.3** | Colony command center as the colony management hub; colony administrator owns it. Recruitment post + recruitment officer NPC at colonies. |
| **6.4** | Council chamber at the largest colony. Governance verbs surfaced as council scenes. Faction-tier features all map onto existing physical hubs — no new tabs added. |

## Related

- [faction-management.md](faction-management.md) — what is being managed; this file says how the player physically interacts with it
- [../fleet.md](../fleet.md) — the data model under the diegetic surface; the player-facing surfaces table is reinterpreted by this file
- [../npc-ai.md](../npc-ai.md) — officers' personas + memory feed council debate and comm-panel reactions
- [relationships.md](relationships.md) — first-touch hires extend the talk-verb relationship surface aboard
- [ambitions.md](ambitions.md) — fleet-tier and faction-leader perks make the diegetic surface mechanically rewarding to engage with

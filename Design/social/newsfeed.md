# Newsfeed

*Phase 5.1.*

Date-keyed events from a hand-authored content table (`data/news.json5`). Pre-war: low-grade Zeon autonomy debates, AE contract leaks, civic items, lunar-shipping incidents. War-era: dramatic shifts. Pure flavor that contextualizes drives and seeds Phase 7's war moment with months of foreshadowing.

## Design constraint: missability

The journal records only news the player has actually consumed through one of the channels below. **Missed days stay missed.** This is what turns "newsfeed" from quest log into *behaviour* — the player visits the bar to catch up, pays for back issues, asks coworkers what they heard. A complete always-on chronicle would defeat the system.

## Channels

| Channel | Cost to consume | Where | Notes |
|---|---|---|---|
| **Bar TV** | Zero — passive | Inside any bar | Today's top headline scrolls above the counter; audible chime on new drops. Gives the bar a reason to exist beyond fun-recovery. |
| **Newspaper** | ¥5–10 + ~30 game-min `reading` action | Buy at any shop | Dumps that day's headlines into the journal; back issues compress a week of catch-up. Reading feeds Charisma `recentUse` (informed → better company). |
| **Home radio / holovision** | Zero — opt-in | Apartment tier or higher (not flop) | Reinforces the spend-money-on-housing decision. Lets the player stay informed without socializing — its own life-sim choice. |
| **NPC gossip** | Free; requires the talk verb (once shipped) | Anywhere | 1-line garbled paraphrase, opinion-coloured by the speaker's faction tag. Same headline reads three ways depending on who you ask. |

## Journal panel

HUD panel, read-only, chronological list of headlines the player has consumed through any channel above. Missed entries are absent. Filter by tag (war / civic / AE / Zeon / Federation) for late-game catch-up.

## War-day asymmetry (Phase 7)

UC 0079.01.03 breaks the diegetic rule **once**. The Operation British broadcast force-toasts every player regardless of location: alarm sirens in the streets, every TV in the city tunes to the same feed, NPCs in the bar stop and stare. The rule-break *is* the reason the diegetic system exists — when it shatters, the player feels it.

## Phase 5.1 ship slice

Smallest viable cut, in order:

1. `data/news.json5` content table — 50 hand-authored entries spanning UC 0077–0079, tagged by faction/topic, with a `date` field (UC YYYY.MM.DD) and a `priority` (top-of-broadcast vs. b-roll).
2. Bar TV channel — Konva text element on the bar interior, chime on new headline, advances when player is co-located with the bar counter.
3. Journal HUD panel — chronological list of consumed headlines.

Newspaper, home radio, and gossip layers ship in subsequent slices, each independently valuable. Do not ship all four channels in one cut — the system needs playtest feedback on whether passive ambient (bar) is sufficient before adding paid (newspaper) and home (radio) variants.

## Implementation flag

The `data/news.json5` schema should pin `date` as the canonical key from day one, even though only the bar channel ships first. The same content table feeds all four channels and the Phase 7 war-day toast — schema churn here is expensive later.

## Related

- [ambitions.md](ambitions.md) — ambitions tag news entries; news becomes the player's personal story
- [relationships.md](relationships.md) — gossip channel pipes news through NPCs
- [../setting.md](../setting.md) — timeline-as-state mechanism
- [../phasing.md](../phasing.md) — Phase 7 war asymmetry

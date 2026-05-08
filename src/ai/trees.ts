// Survival fallbacks (tap, trash, rough sleep) are intentionally *last* in
// each subtree so NPCs only use them when they have neither stock nor cash
// (and, for sleep, no claimed bed). Each rough action tags the actor with
// RoughUse so vitals.ts can apply hygiene + HP penalties.
//
// `eat-from-trash` is additionally gated on `isDestitute`: a wealthy NPC
// would rather wait for the shop counter to be staffed again than poison
// themselves, since hunger maxing is survivable for hours. `rough-sleep` is
// NOT gated on wealth — fatigue saturation is fatal, and if every bed is
// rented out, sleeping in the park beats dying of exhaustion. The fix to
// "wealthy NPC sleeping in the park" lives in the sleep selector itself,
// which now tries `findHome` before falling to rough sleep.

import type { RootNodeDefinition } from 'mistreevous/dist/BehaviourTreeDefinition'

export const NPC_TREE: RootNodeDefinition = {
  type: 'root',
  child: {
    type: 'selector',
    children: [
      // Sleep — bed first, then try to rent if homeless, bench as last resort.
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'isExhausted' },
          {
            type: 'selector',
            children: [
              {
                type: 'sequence',
                children: [
                  { type: 'action', call: 'goHome' },
                  { type: 'action', call: 'sleep' },
                ],
              },
              // Homeless with money: claim the best bed they can afford,
              // walk to it, sleep there. findHome FAILED (no bed at any
              // tier they can pay for) drops to rough sleep below.
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'isHomeless' },
                  { type: 'action', call: 'findHome' },
                  { type: 'action', call: 'goHome' },
                  { type: 'action', call: 'sleep' },
                ],
              },
              // Wealth gate is intentionally absent here: Branch 2 above
              // already calls findHome, which only FAILs if no rentable bed
              // exists at any tier the NPC can afford. If we reach this
              // branch, sleeping rough is the only way to avoid the fatigue-
              // saturation HP drain — better a hygiene hit than death.
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'isHomeless' },
                  { type: 'condition', call: 'hasRoughSpot' },
                  { type: 'action', call: 'goToRoughSpot' },
                  { type: 'action', call: 'sleepRough' },
                ],
              },
            ],
          },
        ],
      },
      // Drink — inventory, shop, street tap.
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'isThirsty' },
          {
            type: 'selector',
            children: [
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'hasWater' },
                  { type: 'action', call: 'drink' },
                ],
              },
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'canBuyWater' },
                  { type: 'action', call: 'goToShop' },
                  { type: 'action', call: 'buyWater' },
                  { type: 'action', call: 'leaveShopCounter' },
                ],
              },
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'hasTap' },
                  { type: 'action', call: 'goToTap' },
                  { type: 'action', call: 'drinkAtTap' },
                ],
              },
            ],
          },
        ],
      },
      // Eat — inventory, shop, trash.
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'isHungry' },
          {
            type: 'selector',
            children: [
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'hasMeal' },
                  { type: 'action', call: 'eat' },
                ],
              },
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'canBuyMeal' },
                  { type: 'action', call: 'goToShop' },
                  { type: 'action', call: 'buyMeal' },
                  { type: 'action', call: 'leaveShopCounter' },
                ],
              },
              {
                type: 'sequence',
                children: [
                  { type: 'condition', call: 'isDestitute' },
                  { type: 'condition', call: 'hasTrash' },
                  { type: 'action', call: 'goToTrash' },
                  { type: 'action', call: 'scavenge' },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'needsHome' },
          { type: 'action', call: 'findHome' },
        ],
      },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'needsJob' },
          { type: 'action', call: 'findJob' },
        ],
      },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'shouldWork' },
          { type: 'action', call: 'goToWork' },
          { type: 'action', call: 'work' },
        ],
      },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'isDirty' },
          { type: 'action', call: 'goHome' },
          { type: 'action', call: 'wash' },
        ],
      },
      // Chat sits above bar so a free social outlet beats the paid one
      // when both are available.
      { type: 'action', call: 'chat' },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'isBored' },
          { type: 'condition', call: 'canAffordBar' },
          { type: 'action', call: 'walkToBarSeat' },
          { type: 'action', call: 'revel' },
        ],
      },
      {
        type: 'sequence',
        children: [
          { type: 'condition', call: 'shouldStockUp' },
          { type: 'action', call: 'goToShop' },
          { type: 'action', call: 'stockUp' },
          { type: 'action', call: 'leaveShopCounter' },
        ],
      },
      // wander returns SUCCEEDED every tick (even mid-walk), so the BT keeps
      // re-evaluating chat / critical drives — a friend walking into chat
      // range can preempt mid-stroll.
      { type: 'action', call: 'wander' },
    ],
  },
}

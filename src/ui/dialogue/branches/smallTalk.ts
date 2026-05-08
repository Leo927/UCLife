import { useUI } from '../../uiStore'
import { playUi } from '../../../audio/player'
import { dialogueText, pickByTitle } from '../../../data/dialogueText'
import type { DialogueCtx, DialogueNode } from '../types'

export function rootGreetingFor(ctx: DialogueCtx): string {
  return pickByTitle(dialogueText.greetings, ctx.title, ctx.employed)
}

export function smallTalkChild(ctx: DialogueCtx): DialogueNode {
  const line = pickByTitle(dialogueText.smallTalk, ctx.title, ctx.employed)
  return {
    id: 'smallTalk',
    label: dialogueText.buttons.smallTalk,
    info: line,
    onEnter: () => playUi('ui.npc.smalltalk'),
  }
}

export function farewellChild(ctx: DialogueCtx): DialogueNode {
  const line = pickByTitle(dialogueText.farewells, ctx.title, ctx.employed)
  return {
    id: 'farewell',
    label: dialogueText.buttons.farewell,
    info: line,
    onEnter: () => {
      playUi('ui.npc.farewell')
      setTimeout(
        () => useUI.getState().setDialogNPC(null),
        dialogueText.timings.farewellCloseMs,
      )
    },
  }
}

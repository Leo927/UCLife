import { describe, expect, it } from 'vitest'
import { createWorld } from 'koota'
import { Attributes } from '../ecs/traits'
import { addSkillXp, getSkillXp, setSkillXp, levelOf } from './skills'

// Skill XP rides on the StatSheet as a stat base. These helpers are the
// only sanctioned write path; production code never touches the Skills
// trait (it no longer exists).

function makeCharacter() {
  const w = createWorld()
  const e = w.spawn(Attributes)
  return { w, e }
}

describe('skill helpers', () => {
  it('a fresh character has 0 XP and level 0 across every skill', () => {
    const { e } = makeCharacter()
    for (const id of ['mechanics', 'piloting', 'engineering'] as const) {
      expect(getSkillXp(e, id)).toBe(0)
      expect(levelOf(getSkillXp(e, id))).toBe(0)
    }
  })

  it('setSkillXp and addSkillXp round-trip on the sheet base', () => {
    const { e } = makeCharacter()
    setSkillXp(e, 'mechanics', 250)
    expect(getSkillXp(e, 'mechanics')).toBe(250)
    addSkillXp(e, 'mechanics', 50)
    expect(getSkillXp(e, 'mechanics')).toBe(300)
  })

  it('writing one skill leaves the others untouched', () => {
    const { e } = makeCharacter()
    setSkillXp(e, 'piloting', 800)
    expect(getSkillXp(e, 'piloting')).toBe(800)
    expect(getSkillXp(e, 'mechanics')).toBe(0)
    expect(getSkillXp(e, 'engineering')).toBe(0)
  })

  it('addSkillXp(0) is a no-op (no sheet churn for empty grants)', () => {
    const { e } = makeCharacter()
    setSkillXp(e, 'cooking', 42)
    const before = e.get(Attributes)!.sheet.version
    addSkillXp(e, 'cooking', 0)
    const after = e.get(Attributes)!.sheet.version
    expect(after).toBe(before)
    expect(getSkillXp(e, 'cooking')).toBe(42)
  })
})

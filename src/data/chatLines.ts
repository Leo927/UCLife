// Buckets are by speaker→listener tier. The BT only fires chat at friend
// tier or above; acquaintance lines exist as a safety net if that threshold
// is ever lowered.

import type { RelationTier } from '../systems/relations'

const FRIEND: readonly string[] = [
  '"好久不见啊。"',
  '"你最近怎么样？"',
  '"昨晚我又没睡好。"',
  '"工厂里的活儿真没头。"',
  '"AE 那边压力越来越大。"',
  '"我又被房租逼得没辙。"',
  '"你看着憔悴。"',
  '"听说东街又出事了。"',
  '"咱啥时候能离开这破地方。"',
  '"你说这世道还会更糟吗？"',
  '"我妈来信说地球那边不太平。"',
  '"昨天酒吧又涨价了。"',
  '"对了，那事我帮你问过了。"',
  '"上次的事还记着呢。"',
  '"你最近吃饭还跟得上吗？"',
] as const

const ACQUAINTANCE: readonly string[] = [
  '"嗯。"',
  '"哦，你也在这儿。"',
  '"工资发了吗？"',
  '"店里又涨价了。"',
  '"昨晚那班车晚点。"',
  '"工厂的活真累。"',
  '"街上人少了。"',
  '"听说有人搬走了。"',
  '"今天值班吗？"',
  '"路上小心。"',
] as const

const STRANGER: readonly string[] = [
  '"...你好。"',
  '"嗯，你好。"',
] as const

const POOL: Record<RelationTier, readonly string[]> = {
  friend: FRIEND,
  acquaintance: ACQUAINTANCE,
  stranger: STRANGER,
  rival: ACQUAINTANCE,
  enemy: ACQUAINTANCE,
}

export function pickChatLine(tier: RelationTier): string {
  const pool = POOL[tier] ?? ACQUAINTANCE
  return pool[Math.floor(Math.random() * pool.length)]
}

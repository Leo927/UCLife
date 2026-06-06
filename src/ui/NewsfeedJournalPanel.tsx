// Read-only newsfeed journal (Phase 7.0.A). Lists the headlines the player
// has actually tuned in for at the bar — missed days are absent (missability
// is the system). A "今日头条" hint shows the day's top headline so the player
// knows there's something to catch at the bar. Tag filter for late-game
// catch-up. Toggled from a self-contained button, mirroring EventLogPanel.

import { useState } from 'react'
import { useNewsfeed } from '../sim/newsfeed'
import { useClock } from '../sim/clock'
import { topHeadlineForDate, ucDateKey, getNewsEntry, type NewsTag } from '../data/news'
import { playUi } from '../audio/player'

const TAG_LABELS: Record<NewsTag, string> = {
  war: '战争',
  civic: '民生',
  ae: 'AE',
  zeon: '吉翁',
  federation: '联邦',
  lunar: '月面',
}

const FILTERS: NewsTag[] = ['war', 'civic', 'ae', 'zeon', 'federation', 'lunar']

export function NewsfeedJournalPanel() {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<NewsTag | null>(null)
  const journal = useNewsfeed((s) => s.journal)
  const gameMs = useClock((s) => s.gameDate.getTime())

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { playUi('ui.newsfeed.open'); setOpen(true) }}
        title="打开新闻日志"
        data-testid="newsfeed-toggle"
        style={{
          position: 'fixed', bottom: 8, right: 220, zIndex: 40,
          padding: '4px 10px', fontSize: 12, cursor: 'pointer',
          background: '#1a2030', color: '#cfe', border: '1px solid #345',
          borderRadius: 4,
        }}
      >
        新闻 ({journal.length})
      </button>
    )
  }

  const today = topHeadlineForDate(ucDateKey(new Date(gameMs)))
  // Newest consumed first.
  const rows = [...journal].reverse()
    .map((c) => ({ consumed: c, entry: getNewsEntry(c.id) }))
    .filter((r) => !filter || (r.entry?.tags.includes(filter) ?? false))

  return (
    <div
      data-testid="newsfeed-panel"
      style={{
        position: 'fixed', top: 60, right: 16, width: 360, maxHeight: '70vh',
        overflowY: 'auto', zIndex: 60, background: '#0e1320', color: '#dde',
        border: '1px solid #345', borderRadius: 6, padding: 12,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>新闻日志</strong>
        <button
          type="button"
          onClick={() => { playUi('ui.newsfeed.close'); setOpen(false) }}
          aria-label="关闭"
          style={{ background: 'none', color: '#9ab', border: 'none', cursor: 'pointer', fontSize: 16 }}
        >✕</button>
      </div>

      {today && (
        <div style={{ marginBottom: 10, padding: '6px 8px', background: '#16203a', borderRadius: 4, fontSize: 12 }}>
          <div style={{ color: '#7c9', marginBottom: 2 }}>今日头条 · 前往酒吧收看</div>
          <div>{today.headlineZh}</div>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {FILTERS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setFilter(filter === t ? null : t)}
            style={{
              padding: '2px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 10,
              border: '1px solid #345',
              background: filter === t ? '#2a4' : '#1a2030',
              color: filter === t ? '#021' : '#9ab',
            }}
          >{TAG_LABELS[t]}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ color: '#789', fontSize: 12, padding: '8px 0' }}>
          暂无收看记录。去酒吧守着电视,才会留下今天的新闻。
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map(({ consumed, entry }) => (
            <li key={consumed.id} style={{ padding: '6px 0', borderBottom: '1px solid #223' }}>
              <div style={{ fontSize: 11, color: '#789' }}>{consumed.dateKey}</div>
              <div style={{ fontSize: 13 }}>{entry?.headlineZh ?? consumed.id}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

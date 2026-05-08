import { useEffect, useRef, useState } from 'react'
import { useUI } from '../uiStore'
import { dialogueText } from '../../data/dialogueText'
import type { DialogueNode } from './types'

// Walks `root.children → ... → ...` following the given path of node ids.
// Falls back to the deepest valid ancestor if a leg of the path no longer
// exists (e.g. a branch became unavailable mid-conversation), so the
// player never lands on a stale node.
function nodeAtPath(root: DialogueNode, path: readonly string[]): {
  node: DialogueNode
  validPath: string[]
} {
  let cur = root
  const valid: string[] = []
  for (const id of path) {
    const next = cur.children?.find((c) => c.id === id) ?? null
    if (!next) break
    cur = next
    valid.push(id)
  }
  return { node: cur, validPath: valid }
}

export function DialogueRunner({ root }: { root: DialogueNode }) {
  const [path, setPath] = useState<string[]>([])
  const enteredRef = useRef<string | null>(null)

  const { node: current, validPath } = nodeAtPath(root, path)

  // If the active path was clipped (a branch disappeared), sync state.
  if (validPath.length !== path.length) {
    queueMicrotask(() => setPath(validPath))
  }

  // onEnter fires once per node entry. The id is path-qualified so the
  // same id reused under a different parent still triggers.
  const enterKey = validPath.join('>') || 'root'
  useEffect(() => {
    if (enteredRef.current === enterKey) return
    enteredRef.current = enterKey
    current.onEnter?.()
  }, [enterKey, current])

  const enter = (child: DialogueNode) => {
    if (child.enabled === false) return
    if (child.closeOnEnter) {
      child.onEnter?.()
      useUI.getState().setDialogNPC(null)
      return
    }
    setPath([...path, child.id])
  }

  const back = () => {
    setPath(path.slice(0, -1))
  }

  const kids = current.children ?? []

  return (
    <section
      className="status-section conversation-extension"
      key={enterKey}
      data-dialogue-node={enterKey}
    >
      {current.info && (
        <p className="dialog-response" style={{ whiteSpace: 'pre-line' }}>
          {current.info}
        </p>
      )}
      {current.specialUI?.()}
      {kids.length > 0 && (
        <div className="dialog-options">
          {kids.map((c) => (
            <button
              key={c.id}
              className="dialog-option"
              disabled={c.enabled === false}
              onClick={() => enter(c)}
              title={c.hint}
            >
              {c.label ?? c.id}
              {c.hint && <span className="dialog-option-hint"> · {c.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {validPath.length > 0 && (
        <div className="dialog-options">
          <button className="dialog-option" onClick={back}>
            {dialogueText.buttons.back}
          </button>
        </div>
      )}
    </section>
  )
}

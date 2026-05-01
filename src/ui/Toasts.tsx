import { useUI } from './uiStore'

export function Toasts() {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  if (toasts.length === 0) return null
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismiss(t.id)}>
          <span>{t.text}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={(e) => {
                e.stopPropagation()
                t.action!.onClick()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

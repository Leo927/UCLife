import { useUI } from './uiStore'

export function StatusBarFooter() {
  const toggleStatus = useUI((s) => s.toggleStatus)
  return (
    <button className="status-footer" onClick={toggleStatus}>
      <span className="status-footer-label">状态</span>
      <span className="status-footer-cta">›</span>
    </button>
  )
}

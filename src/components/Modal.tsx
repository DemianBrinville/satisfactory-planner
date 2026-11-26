import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

/** Ventana modal centrada; se cierra con Esc o clic afuera. */
export default function Modal({
  title,
  onClose,
  children,
  width = 520,
}: {
  title: ReactNode
  onClose?: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={() => onClose?.()}>
      <div className="dialog" style={{ width: `min(${width}px, 94vw)` }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} title="Cerrar">
              <X size={18} />
            </button>
          )}
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}

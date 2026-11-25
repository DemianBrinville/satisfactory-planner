import { useEffect } from 'react'
import { buildingsById } from '../data/gameData'
import { useEditor } from '../editor/store'

export interface MenuState {
  x: number
  y: number
  uid: string
  isConveyor: boolean
}

/** Menú de clic derecho sobre una estructura o cinta. */
export default function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const st = useEditor()
  const count = st.selection.length
  const entity = st.entities.find((e) => e.uid === menu.uid)
  const b = entity ? buildingsById.get(entity.buildingId) : null

  useEffect(() => {
    const close = () => onClose()
    window.addEventListener('blur', close)
    return () => window.removeEventListener('blur', close)
  }, [onClose])

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const label = count > 1 ? ` (${count})` : ''

  return (
    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {b && count === 1 && <div className="ctx-title">{b.name}</div>}
      {!menu.isConveyor && (
        <>
          <button onClick={run(st.rotateSelection)}>
            Girar{label} <kbd>R</kbd>
          </button>
          <button onClick={run(st.cutSelection)}>
            Mover / cortar{label} <kbd>Ctrl+X</kbd>
          </button>
          <button onClick={run(st.copySelection)}>
            Copiar{label} <kbd>Ctrl+C</kbd>
          </button>
          <button onClick={run(() => { st.copySelection(); st.startPaste() })}>Duplicar{label}</button>
        </>
      )}
      <button className="danger" onClick={run(st.deleteSelection)}>
        Eliminar{label} <kbd>Supr</kbd>
      </button>
    </div>
  )
}

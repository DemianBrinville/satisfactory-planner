import { CircleArrowDown, CircleArrowUp, Copy, CopyPlus, Gauge, Move, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { computeFlows } from '../editor/flow'
import { clockAdvice } from './Production'
import { buildingsById } from '../data/gameData'
import { useEditor } from '../editor/store'
import { NONE } from '../editor/store'

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
  // ajuste de reloj sugerido (bajarlo o subirlo al porcentaje exacto que pide lo de adelante)
  const advice = useMemo(() => {
    if (!entity || count !== 1) return null
    const f = computeFlows(st.entities, st.conveyors, st.routes ?? NONE, st.floorHeight)
    return clockAdvice(f.nodes.get(entity.uid), entity.clock ?? 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.uid, count])
  const pctTxt = (v: number) => `${Math.round(v * 10000) / 100} %`
  const setClock = (v: number) => entity && st.updateEntity(entity.uid, { clock: Math.min(2.5, Math.max(0.01, Math.round(v * 10000) / 10000)) })

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
      {advice && advice.kind !== 'impossible' && (
        <button className={advice.kind === 'under' ? 'accent-blue' : 'accent-orange'} onClick={run(() => setClock(advice.target))}>
          <span>
            {advice.kind === 'under' ? <CircleArrowDown size={15} /> : <CircleArrowUp size={15} />}
            {advice.kind === 'under' ? 'Bajar' : 'Subir'} reloj al {pctTxt(advice.target)}
          </span>
        </button>
      )}
      {entity && (entity.clock ?? 1) !== 1 && (
        <button onClick={run(() => setClock(1))}>
          <span>
            <Gauge size={15} /> Reloj al 100 %
          </span>
        </button>
      )}
      {!menu.isConveyor && (
        <>
          <button onClick={run(st.rotateSelection)}>
            <span>
              <RotateCw size={15} /> Girar{label}
            </span>
            <kbd>R</kbd>
          </button>
          <button onClick={run(st.cutSelection)}>
            <span>
              <Move size={15} /> Mover{label}
            </span>
            <kbd>Ctrl+X</kbd>
          </button>
          <button onClick={run(st.copySelection)}>
            <span>
              <Copy size={15} /> Copiar{label}
            </span>
            <kbd>Ctrl+C</kbd>
          </button>
          <button onClick={run(() => { st.copySelection(); st.startPaste() })}>
            <span>
              <CopyPlus size={15} /> Duplicar{label}
            </span>
          </button>
        </>
      )}
      <button className="danger" onClick={run(st.deleteSelection)}>
        <span>
          <Trash2 size={15} /> Eliminar{label}
        </span>
        <kbd>Supr</kbd>
      </button>
    </div>
  )
}

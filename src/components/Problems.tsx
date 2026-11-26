import { TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildingsById, itemName } from '../data/gameData'
import i18n from '../i18n'
import { locale } from '../i18n/format'
import { NONE, useEditor } from '../editor/store'
import { problemsOf, type Problem } from '../editor/validation'
import { stationName } from '../editor/trains'

const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 })
const nameOf = (id?: string) => (id ? buildingsById.get(id)?.name ?? id : '')

/** Problemas del plano actual (mismo resultado en el lienzo y en el panel). */
export function useProblems(): Problem[] {
  const entities = useEditor((s) => s.entities)
  const conveyors = useEditor((s) => s.conveyors)
  const wires = useEditor((s) => s.wires) ?? NONE
  const floorHeight = useEditor((s) => s.floorHeight) ?? 8
  const rails = useEditor((s) => s.rails) ?? NONE
  const routes = useEditor((s) => s.routes) ?? NONE
  const map = useEditor((s) => s.map)
  return problemsOf(entities, conveyors, wires, floorHeight, rails, routes, map)
}

/** Texto de un problema, con lo que conviene hacer para resolverlo. */
export function problemText(p: Problem): string {
  const ents = useEditor.getState().entities
  const st = (uid?: string) => {
    const e = uid ? ents.find((x) => x.uid === uid) : undefined
    return e ? stationName(e, ents, (n) => i18n.t('train.stationN', { n })) : ''
  }
  return i18n.t(`problems.${p.kind}`, { a: p.sa ? st(p.sa) : nameOf(p.a), b: p.sb ? st(p.sb) : nameOf(p.b), n: p.n !== undefined ? fmt(p.n) : '', max: p.max ?? '', item: p.item ? itemName(p.item) : '', purity: p.purity ? i18n.t(`purity.${p.purity}` as 'purity.pure').toLowerCase() : '' })
}

/** Lleva la vista al problema: cambia de piso, lo selecciona y lo centra en pantalla. */
export function locateProblem(p: Problem) {
  const s = useEditor.getState()
  if (s.floor !== p.floor) s.setFloor(p.floor)
  s.select(p.uids)
  const cell = document.querySelector('.canvas-cell')?.getBoundingClientRect()
  const w = cell?.width ?? window.innerWidth
  const h = cell?.height ?? window.innerHeight
  const scale = Math.max(s.view.scale, 8)
  s.setView({ scale, offsetX: w / 2 - p.at.x * scale, offsetY: h / 2 - p.at.y * scale })
}

/** Botón de la barra superior con la cantidad de problemas y la lista para ir a cada uno. */
export default function ProblemsButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const problems = useProblems()
  const floor = useEditor((s) => s.floor)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const n = problems.length
  // primero los del piso que se está viendo
  const list = [...problems].sort((a, b) => Number(b.floor === floor) - Number(a.floor === floor) || a.floor - b.floor)

  return (
    <div className="power-settings problems" ref={ref}>
      <button className={'tb-btn' + (n ? ' has-problems' : '')} onClick={() => setOpen(!open)} title={t('problems.title')}>
        <TriangleAlert size={16} />
        <span>{n ? t('problems.count', { count: n }) : t('problems.none')}</span>
      </button>
      {open && (
        <div className="popover problems-pop">
          <h3>{t('problems.title')}</h3>
          {n === 0 ? (
            <p className="ok">{t('problems.allGood')}</p>
          ) : (
            <>
              <p className="muted small">{t('problems.hint')}</p>
              <ul className="problem-list">
                {list.slice(0, 200).map((p) => (
                  <li key={p.id}>
                    <button onClick={() => locateProblem(p)}>
                      <span className="problem-floor">{t('topbar.floor', { n: p.floor })}</span>
                      <span>{problemText(p)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {n > 200 && <p className="muted small">{t('problems.more', { count: n - 200 })}</p>}
            </>
          )}
          <p className="muted small">{t('problems.checks')}</p>
        </div>
      )}
    </div>
  )
}

import { FileUp, Loader2 } from 'lucide-react'
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { buildingsById } from '../data/gameData'
import { locale } from '../i18n/format'
import { useProgress } from '../editor/progress'
import { buildImport, indexSave, readSave, saveProgress, type ImportResult, type SaveIndex } from '../editor/saveFile'
import { useEditor } from '../editor/store'
import { MAP_BOUNDS, MAP_IMAGE } from '../editor/worldMap'
import Modal from './Modal'

const fmt = (n: number) => n.toLocaleString(locale())
const VIEW = 380

/** Ventana para traer fábricas de una partida guardada (.sav) al plano. */
export default function ImportSave({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'pick' | 'reading' | 'choose' | 'done'>('pick')
  const [error, setError] = useState('')
  const [index, setIndex] = useState<SaveIndex | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const [foundations, setFoundations] = useState(true)
  const [architecture, setArchitecture] = useState(false)
  const [useProg, setUseProg] = useState(true)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [progDone, setProgDone] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const planEntities = useEditor((s) => s.entities.length)
  const planMap = useEditor((s) => s.map)

  const open = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setState('reading')
    try {
      const world = await readSave(file)
      const idx = indexSave(world)
      if (!idx.factories.length) throw new Error('empty')
      setIndex(idx)
      setChosen(new Set([0]))
      setState('choose')
    } catch (e) {
      setError((e as Error).message === 'empty' ? t('import.empty') : t('import.failed'))
      setState('pick')
    }
  }

  const progress = index ? saveProgress(index.world) : null

  const doImport = () => {
    if (!index || !chosen.size) return
    const st = useEditor.getState()
    const r = buildImport(index, [...chosen], { foundations, architecture }, { entities: st.entities, map: st.map, floorHeight: st.floorHeight ?? 8 })
    st.importDoc(r)
    if (useProg && progress) {
      useProgress.getState().load({ enabled: true, ...progress })
      setProgDone(true)
    }
    // ir al piso con más estructuras y centrar la vista en lo importado
    const cell = document.querySelector('.canvas-cell')?.getBoundingClientRect()
    const w = cell?.width ?? window.innerWidth
    const h = cell?.height ?? window.innerHeight
    const scale = 4
    useEditor.getState().setFloor(r.floor)
    useEditor.getState().setView({ scale, offsetX: w / 2 - r.center.x * scale, offsetY: h / 2 - r.center.y * scale })
    setResult(r)
    setState('done')
  }

  const toggle = (id: number) =>
    setChosen((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Modal title={t('import.title')} onClose={onClose} width={state === 'choose' ? 860 : 520}>
      {(state === 'pick' || state === 'reading') && (
        <>
          <p>{t('import.intro')}</p>
          <p className="muted small">
            <Trans i18nKey="import.where" components={{ code: <code /> }} />
          </p>
          {error && <p className="bad small">{error}</p>}
          <input ref={input} type="file" accept=".sav" hidden onChange={(e) => open(e.target.files?.[0])} />
          <div className="modal-actions">
            <button className="btn primary" disabled={state === 'reading'} onClick={() => input.current?.click()}>
              {state === 'reading' ? <Loader2 size={15} className="spin" /> : <FileUp size={15} />}
              {state === 'reading' ? t('import.reading') : t('import.choose')}
            </button>
          </div>
        </>
      )}

      {state === 'choose' && index && (
        <div className="map-picker import-save">
          <FactoryMap index={index} chosen={chosen} hover={hover} onToggle={toggle} onHover={setHover} />
          <div className="map-side">
            <p className="small">
              <b>{t('import.session', { name: index.world.session })}</b> · {t('import.factories', { count: index.factories.length })}
            </p>
            <p className="muted small">{t('import.pickHelp')}</p>
            <div className="import-list">
              {index.factories.map((f) => (
                <label key={f.id} className={'import-item' + (hover === f.id ? ' hover' : '')} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}>
                  <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} />
                  <span>
                    <b>{t('import.factory', { n: f.id + 1 })}</b> · {t('import.structures', { count: f.count })}
                    {f.top.length > 0 && (
                      <span className="muted small"> · {f.top.map((x) => `${x.n}× ${buildingsById.get(x.id)?.name ?? x.id}`).join(', ')}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
            <label className="switch">
              <input type="checkbox" checked={foundations} onChange={(e) => setFoundations(e.target.checked)} />
              {t('import.foundations')}
            </label>
            <label className="switch">
              <input type="checkbox" checked={architecture} onChange={(e) => setArchitecture(e.target.checked)} />
              {t('import.architecture')}
            </label>
            {progress && (
              <label className="switch">
                <input type="checkbox" checked={useProg} onChange={(e) => setUseProg(e.target.checked)} />
                {t('import.progress', { phase: progress.phase, n: progress.unlocked.length })}
              </label>
            )}
            <p className="muted small">{planEntities === 0 ? t('import.placeNew') : planMap ? t('import.placeKeep') : t('import.placeRight')}</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setState('pick')}>
                {t('import.other')}
              </button>
              <button className="btn primary" disabled={!chosen.size} onClick={doImport} title={chosen.size ? undefined : t('import.none')}>
                {t('import.import')}
              </button>
            </div>
          </div>
        </div>
      )}

      {state === 'done' && result && (
        <>
          <p>{t('import.summary', { structures: fmt(result.stats.structures), segments: fmt(result.stats.segments), wires: fmt(result.stats.wires) })}</p>
          {result.stats.addedPoles > 0 && <p className="muted small">{t('import.addedPoles', { count: result.stats.addedPoles })}</p>}
          {result.stats.offGrid > 0 && <p className="muted small">{t('import.offGrid', { count: result.stats.offGrid })}</p>}
          {result.stats.skipped > 0 && <p className="muted small">{t('import.skipped', { count: result.stats.skipped })}</p>}
          <p className="muted small">{t('import.floors', { h: useEditor.getState().floorHeight ?? 8 })}</p>
          <p className="muted small">{t('import.portsNote')}</p>
          {progDone && <p className="small ok">{t('import.progressDone')}</p>}
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              {t('common.close')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

/** Mapa con las fábricas de la partida: clic para elegirlas, rueda para acercar, arrastrar para mover. */
function FactoryMap({
  index,
  chosen,
  hover,
  onToggle,
  onHover,
}: {
  index: SaveIndex
  chosen: Set<number>
  hover: number | null
  onToggle: (id: number) => void
  onHover: (id: number | null) => void
}) {
  // vista inicial: todas las fábricas con margen
  const fit = useMemo(() => {
    const fs = index.factories
    const x0 = Math.min(...fs.map((f) => f.x0))
    const y0 = Math.min(...fs.map((f) => f.y0))
    const x1 = Math.max(...fs.map((f) => f.x1))
    const y1 = Math.max(...fs.map((f) => f.y1))
    const size = Math.max(600, x1 - x0, y1 - y0) * 1.25
    return { k: VIEW / size, x: (x0 + x1) / 2 - size / 2, y: (y0 + y1) / 2 - size / 2 }
  }, [index])
  const [view, setView] = useState(fit)
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const px = (n: number) => n / view.k

  const toGameAt = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = el.getBoundingClientRect()
    return { x: view.x + (e.clientX - r.left) / view.k, y: view.y + (e.clientY - r.top) / view.k }
  }
  const hit = (g: { x: number; y: number }) => {
    const pad = px(6)
    const f = index.factories.find((f) => g.x >= f.x0 - pad && g.x <= f.x1 + pad && g.y >= f.y0 - pad && g.y <= f.y1 + pad)
    return f ? f.id : null
  }
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const g = toGameAt(e, e.currentTarget)
    const k = Math.max(VIEW / MAP_BOUNDS.size, Math.min(8, view.k * (e.deltaY < 0 ? 1.25 : 0.8)))
    const r = e.currentTarget.getBoundingClientRect()
    setView({ k, x: g.x - (e.clientX - r.left) / k, y: g.y - (e.clientY - r.top) / k })
  }
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d) {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (Math.hypot(dx, dy) > 3) d.moved = true
      if (d.moved) setView((v) => ({ ...v, x: d.vx - dx / v.k, y: d.vy - dy / v.k }))
      return
    }
    onHover(hit(toGameAt(e, e.currentTarget)))
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      const id = hit(toGameAt(e, e.currentTarget))
      if (id !== null) onToggle(id)
    }
  }

  return (
    <div
      className="map-view"
      style={{ width: VIEW, height: VIEW, cursor: hover !== null ? 'pointer' : 'grab' }}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => onHover(null)}
    >
      <svg width={VIEW} height={VIEW} viewBox={`${view.x} ${view.y} ${VIEW / view.k} ${VIEW / view.k}`}>
        <rect x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} fill="#1d2a30" />
        <image href={MAP_IMAGE} x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} preserveAspectRatio="none" />
        {index.factories.map((f) => {
          const on = chosen.has(f.id)
          const pad = px(3)
          return (
            <g key={f.id}>
              <rect
                x={f.x0 - pad}
                y={f.y0 - pad}
                width={f.x1 - f.x0 + pad * 2}
                height={f.y1 - f.y0 + pad * 2}
                fill={on ? 'rgba(240,150,40,0.35)' : 'rgba(255,255,255,0.12)'}
                stroke={hover === f.id ? '#ffffff' : on ? '#f09628' : 'rgba(255,255,255,0.7)'}
                strokeWidth={px(hover === f.id ? 2.5 : 1.5)}
              />
              <text x={f.x0 - pad} y={f.y0 - pad - px(3)} fontSize={px(11)} fill="#ffffff" stroke="#000" strokeWidth={px(2.5)} paintOrder="stroke">
                {f.id + 1}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

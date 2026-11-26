import { Compass, Map as MapIcon, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { itemName } from '../data/gameData'
import { locale } from '../i18n/format'
import { entityRect, useEditor } from '../editor/store'
import { DEFAULT_MAP, MAP_BOUNDS, MAP_IMAGE, SPOTS, spotColor, toGame, type MapPlacement } from '../editor/worldMap'
import Modal from './Modal'

const fmt = (n: number, d = 0) => n.toLocaleString(locale(), { maximumFractionDigits: d })
const normAngle = (a: number) => {
  const r = ((((Math.round(a * 10) / 10 + 180) % 360) + 360) % 360) - 180
  return r === -180 ? 180 : r
}

/** Botón de la barra superior: ubicar el plano en el mapa real, mostrar el fondo y los yacimientos. */
export default function MapButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const map = useEditor((s) => s.map)
  const setMap = useEditor((s) => s.setMap)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div className="power-settings" ref={ref}>
      <button className={'tb-btn tb-collapse' + (map ? ' on' : '')} onClick={() => setOpen(!open)} title={t('map.title')}>
        <MapIcon size={16} />
        <span>{t('map.button')}</span>
      </button>
      {open && (
        <div className="popover map-pop">
          <h3>{t('map.title')}</h3>
          {!map ? (
            <>
              <p className="muted small">{t('map.intro')}</p>
              <button className="btn primary" onClick={() => (setPicking(true), setOpen(false))}>
                <Compass size={15} /> {t('map.place')}
              </button>
            </>
          ) : (
            <>
              <p className="small">
                {t('map.at', { x: fmt(map.x), y: fmt(map.y), angle: fmt(map.angle, 1) })}
              </p>
              <label className="switch">
                <input type="checkbox" checked={map.show} onChange={(e) => setMap({ show: e.target.checked })} />
                {t('map.showImage')}
              </label>
              {map.show && (
                <div className="flowline">
                  <span>{t('map.opacity')}</span>
                  <input type="range" min={0.1} max={1} step={0.05} value={map.opacity} onChange={(e) => setMap({ opacity: Number(e.target.value) })} />
                </div>
              )}
              <label className="switch">
                <input type="checkbox" checked={map.nodes} onChange={(e) => setMap({ nodes: e.target.checked })} />
                {t('map.showNodes')}
              </label>
              <p className="muted small">{t('map.snapHelp')}</p>
              <div className="modal-actions">
                <button className="btn" onClick={() => setMap(null)}>
                  {t('map.remove')}
                </button>
                <button className="btn primary" onClick={() => (setPicking(true), setOpen(false))}>
                  <Compass size={15} /> {t('map.change')}
                </button>
              </div>
            </>
          )}
          <p className="muted small">{t('map.source')}</p>
        </div>
      )}
      {picking && <MapPicker initial={map ?? null} onClose={() => setPicking(false)} onApply={(m) => (setMap(m), setPicking(false))} />}
    </div>
  )
}

/** Lado del visor del mapa (px): hasta 560, achicándose en pantallas angostas (ahí el panel va abajo). */
const viewSize = () => {
  const w = window.innerWidth * 0.94 - 48
  return Math.round(Math.max(260, Math.min(560, w < 860 ? w : w - 316)))
}

/** Ventana para elegir el punto del mapa que corresponde al origen del plano y el giro de la cuadrícula. */
function MapPicker({ initial, onClose, onApply }: { initial: MapPlacement | null; onClose: () => void; onApply: (m: Partial<MapPlacement>) => void }) {
  const { t } = useTranslation()
  const entities = useEditor((s) => s.entities)
  const [VIEW] = useState(viewSize)
  const [pt, setPt] = useState<{ x: number; y: number } | null>(initial ? { x: initial.x, y: initial.y } : null)
  const [angle, setAngle] = useState(initial?.angle ?? DEFAULT_MAP.angle)
  // vista: píxeles por metro y metro del juego en la esquina superior izquierda
  const fit = VIEW / MAP_BOUNDS.size
  const [view, setView] = useState(() => {
    if (!initial) return { k: fit, x: MAP_BOUNDS.x0, y: MAP_BOUNDS.y0 }
    const k = fit * 6
    return { k, x: initial.x - VIEW / 2 / k, y: initial.y - VIEW / 2 / k }
  })
  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // contorno de lo que ya hay en el plano (o un cuadrado de 64 m si está vacío), para ver dónde cae
  const outline = useMemo(() => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    for (const e of entities) {
      const r = entityRect(e)
      if (!r) continue
      x0 = Math.min(x0, r.x0)
      y0 = Math.min(y0, r.y0)
      x1 = Math.max(x1, r.x1)
      y1 = Math.max(y1, r.y1)
    }
    if (!isFinite(x0)) [x0, y0, x1, y1] = [-32, -32, 32, 32]
    return [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]
  }, [entities])
  const place = pt ? { ...DEFAULT_MAP, x: pt.x, y: pt.y, angle } : null
  const poly = place ? outline.map((p) => toGame(p, place)) : []
  const axis = place ? [toGame({ x: 0, y: 0 }, place), toGame({ x: 40, y: 0 }, place), toGame({ x: 0, y: -40 }, place)] : []

  const toGamePt = (cx: number, cy: number) => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: view.x + (cx - r.left) / view.k, y: view.y + (cy - r.top) / view.k }
  }
  const onWheel = (e: ReactWheelEvent) => {
    const g = toGamePt(e.clientX, e.clientY)
    const k = Math.min(fit * 60, Math.max(fit, view.k * (e.deltaY < 0 ? 1.25 : 0.8)))
    const r = boxRef.current!.getBoundingClientRect()
    setView({ k, x: g.x - (e.clientX - r.left) / k, y: g.y - (e.clientY - r.top) / k })
  }
  const onDown = (e: ReactPointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setView((v) => ({ ...v, x: d.vx - dx / v.k, y: d.vy - dy / v.k }))
  }
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) {
      const g = toGamePt(e.clientX, e.clientY)
      setPt({ x: Math.round(g.x), y: Math.round(g.y) })
    }
  }
  const px = (m: number) => m / view.k // tamaño en metros de N píxeles de pantalla

  return (
    <Modal title={t('map.pickTitle')} onClose={onClose} width={940}>
      <div className="map-picker">
        <div
          ref={boxRef}
          className="map-view"
          style={{ width: VIEW, height: VIEW }}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
        >
          <svg width={VIEW} height={VIEW} viewBox={`${view.x} ${view.y} ${VIEW / view.k} ${VIEW / view.k}`}>
            <rect x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} fill="#1d2a30" />
            <image href={MAP_IMAGE} x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} preserveAspectRatio="none" />
            {SPOTS.filter((s) => s.kind !== 'core').map((s) => (
              <circle key={s.id} cx={s.x} cy={s.y} r={px(s.kind === 'satellite' ? 2 : 3)} fill={spotColor(s.resource)} stroke="#000" strokeWidth={px(0.6)}>
                <title>{`${itemName(s.resource)}${s.purity ? ' · ' + t(`purity.${s.purity}`) : ''}`}</title>
              </circle>
            ))}
            {place && (
              <>
                <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(240,150,40,0.18)" stroke="#f09628" strokeWidth={px(2)} />
                <line x1={axis[0].x} y1={axis[0].y} x2={axis[1].x} y2={axis[1].y} stroke="#e05046" strokeWidth={px(2)} />
                <line x1={axis[0].x} y1={axis[0].y} x2={axis[2].x} y2={axis[2].y} stroke="#4fe0c0" strokeWidth={px(2)} />
                <circle cx={place.x} cy={place.y} r={px(5)} fill="#f09628" stroke="#fff" strokeWidth={px(1.5)} />
              </>
            )}
          </svg>
          <div className="map-zoom">
            <button className="icon-btn sm" title={t('map.fit')} onClick={() => setView({ k: fit, x: MAP_BOUNDS.x0, y: MAP_BOUNDS.y0 })}>
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
        <div className="map-side">
          <p className="muted small">{t('map.pickHelp')}</p>
          <div className="flowline">
            <span>X</span>
            <span>
              <input
                className="small-input wide"
                type="number"
                value={pt?.x ?? ''}
                onChange={(e) => setPt({ x: Number(e.target.value), y: pt?.y ?? 0 })}
              />{' '}
              m
            </span>
          </div>
          <div className="flowline">
            <span>Y</span>
            <span>
              <input
                className="small-input wide"
                type="number"
                value={pt?.y ?? ''}
                onChange={(e) => setPt({ x: pt?.x ?? 0, y: Number(e.target.value) })}
              />{' '}
              m
            </span>
          </div>
          <h3>{t('map.angle')}</h3>
          <div className="flowline">
            <input type="range" min={-180} max={180} step={0.5} value={angle} onChange={(e) => setAngle(normAngle(Number(e.target.value)))} />
            <span>
              <input className="small-input" type="number" step={0.5} value={angle} onChange={(e) => setAngle(normAngle(Number(e.target.value)))} /> °
            </span>
          </div>
          <div className="map-angle-btns">
            {[-90, -45, -15, -5, 5, 15, 45, 90].map((d) => (
              <button key={d} className="btn" onClick={() => setAngle(normAngle(angle + d))}>
                {d > 0 ? '+' : ''}
                {d}°
              </button>
            ))}
            <button className="btn" onClick={() => setAngle(0)}>
              {t('map.north')}
            </button>
          </div>
          <p className="muted small">{t('map.angleHelp')}</p>
          <p className="muted small">
            <span className="axis-x">━</span> {t('map.axisX')} · <span className="axis-y">━</span> {t('map.axisY')}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              {t('account.cancel')}
            </button>
            <button className="btn primary" disabled={!pt} onClick={() => pt && onApply({ x: pt.x, y: pt.y, angle })}>
              {t('map.apply')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

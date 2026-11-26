import { Compass, Crosshair, Map as MapIcon, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { itemName } from '../data/gameData'
import { locale } from '../i18n/format'
import { entityRect, layerOf, useEditor } from '../editor/store'
import { DEFAULT_MAP, MAP_BOUNDS, MAP_IMAGE, SPOTS, spotColor, toGame, toPlan, type MapPlacement } from '../editor/worldMap'
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

/** Ventana para ubicar el plano sobre el mapa: se arrastra para moverlo y se gira desde su centro con la manija. */
function MapPicker({ initial, onClose, onApply }: { initial: MapPlacement | null; onClose: () => void; onApply: (m: Partial<MapPlacement>) => void }) {
  const { t } = useTranslation()
  const entities = useEditor((s) => s.entities)
  const [VIEW] = useState(viewSize)

  // lo que ya hay en el plano: caja (o un cuadrado de 64 m si está vacío) y rectángulos para dibujarlo encima del mapa
  const plan = useMemo(() => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    const rects: { x0: number; y0: number; x1: number; y1: number; base: boolean }[] = []
    for (const e of entities) {
      const r = entityRect(e)
      if (!r) continue
      rects.push({ ...r, base: layerOf(e.buildingId) === 'base' })
      x0 = Math.min(x0, r.x0)
      y0 = Math.min(y0, r.y0)
      x1 = Math.max(x1, r.x1)
      y1 = Math.max(y1, r.y1)
    }
    if (!isFinite(x0)) [x0, y0, x1, y1] = [-32, -32, 32, 32]
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rects }
  }, [entities])

  // el plano se maneja por su centro: punto del juego donde cae el centro, y el giro
  const [center, setCenter] = useState<{ x: number; y: number } | null>(() => (initial ? toGame({ x: plan.cx, y: plan.cy }, initial) : null))
  const [angle, setAngle] = useState(initial?.angle ?? DEFAULT_MAP.angle)
  /** origen del plano (0, 0) en el juego para que su centro quede en `c` con el giro `a` */
  const origin = (c: { x: number; y: number }, a: number) => {
    const g = toGame({ x: plan.cx, y: plan.cy }, { ...DEFAULT_MAP, x: 0, y: 0, angle: a })
    return { x: c.x - g.x, y: c.y - g.y }
  }
  const place = center ? { ...DEFAULT_MAP, ...origin(center, angle), angle } : null

  // vista: píxeles por metro y metro del juego en la esquina superior izquierda
  const fit = VIEW / MAP_BOUNDS.size
  const planSize = Math.max(plan.x1 - plan.x0, plan.y1 - plan.y0, 40)
  const closeK = Math.min(fit * 60, Math.max(fit, (VIEW * 0.4) / planSize))
  const [view, setView] = useState(() =>
    center ? { k: closeK, x: center.x - VIEW / 2 / closeK, y: center.y - VIEW / 2 / closeK } : { k: fit, x: MAP_BOUNDS.x0, y: MAP_BOUNDS.y0 },
  )
  const drag = useRef<
    | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean }
    | { mode: 'move'; gx: number; gy: number; cx: number; cy: number }
    | { mode: 'rotate'; a0: number; m0: number }
    | null
  >(null)
  const [hover, setHover] = useState<'move' | 'rotate' | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const px = (n: number) => n / view.k // N píxeles de pantalla, en metros

  const corners = place
    ? [
        { x: plan.x0, y: plan.y0 },
        { x: plan.x1, y: plan.y0 },
        { x: plan.x1, y: plan.y1 },
        { x: plan.x0, y: plan.y1 },
      ].map((p) => toGame(p, place))
    : []
  // manija de giro: 28 px por encima del borde superior (el norte del plano)
  const handle = place ? toGame({ x: plan.cx, y: plan.y0 - px(28) }, place) : null
  const topMid = place ? toGame({ x: plan.cx, y: plan.y0 }, place) : null

  const toGamePt = (cx: number, cy: number) => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: view.x + (cx - r.left) / view.k, y: view.y + (cy - r.top) / view.k }
  }
  const hit = (g: { x: number; y: number }): 'move' | 'rotate' | null => {
    if (!place || !handle) return null
    if (Math.hypot(g.x - handle.x, g.y - handle.y) <= px(11)) return 'rotate'
    const p = toPlan(g, place)
    const m = px(4)
    return p.x >= plan.x0 - m && p.x <= plan.x1 + m && p.y >= plan.y0 - m && p.y <= plan.y1 + m ? 'move' : null
  }
  const deg = (g: { x: number; y: number }) => (Math.atan2(g.y - center!.y, g.x - center!.x) * 180) / Math.PI

  const onWheel = (e: ReactWheelEvent) => {
    const g = toGamePt(e.clientX, e.clientY)
    const k = Math.min(fit * 60, Math.max(fit, view.k * (e.deltaY < 0 ? 1.25 : 0.8)))
    const r = boxRef.current!.getBoundingClientRect()
    setView({ k, x: g.x - (e.clientX - r.left) / k, y: g.y - (e.clientY - r.top) / k })
  }
  const onDown = (e: ReactPointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const g = toGamePt(e.clientX, e.clientY)
    const h = hit(g)
    if (h === 'rotate') drag.current = { mode: 'rotate', a0: angle, m0: deg(g) }
    else if (h === 'move') drag.current = { mode: 'move', gx: g.x, gy: g.y, cx: center!.x, cy: center!.y }
    else drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false }
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    const g = toGamePt(e.clientX, e.clientY)
    if (!d) return setHover(hit(g))
    if (d.mode === 'move') return setCenter({ x: d.cx + g.x - d.gx, y: d.cy + g.y - d.gy })
    if (d.mode === 'rotate') {
      const a = d.a0 + deg(g) - d.m0
      // con Shift, de a 15°
      return setAngle(normAngle(e.shiftKey ? Math.round(a / 15) * 15 : Math.round(a * 2) / 2))
    }
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (d.moved) setView((v) => ({ ...v, x: d.vx - dx / v.k, y: d.vy - dy / v.k }))
  }
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.mode !== 'pan' || d.moved) return
    // clic suelto en el mapa: el plano va ahí (la primera vez además se acerca la vista)
    const g = toGamePt(e.clientX, e.clientY)
    if (!center) {
      const r = boxRef.current!.getBoundingClientRect()
      const k = Math.max(view.k, closeK)
      setView({ k, x: g.x - (e.clientX - r.left) / k, y: g.y - (e.clientY - r.top) / k })
    }
    setCenter({ x: g.x, y: g.y })
  }
  const cursor = hover === 'rotate' ? 'alias' : hover === 'move' ? 'move' : center ? 'grab' : 'crosshair'

  return (
    <Modal title={t('map.pickTitle')} onClose={onClose} width={940}>
      <div className="map-picker">
        <div
          ref={boxRef}
          className="map-view"
          style={{ width: VIEW, height: VIEW, cursor }}
          onWheel={onWheel}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
        >
          <svg width={VIEW} height={VIEW} viewBox={`${view.x} ${view.y} ${VIEW / view.k} ${VIEW / view.k}`}>
            <rect x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} fill="#1d2a30" />
            <image href={MAP_IMAGE} x={MAP_BOUNDS.x0} y={MAP_BOUNDS.y0} width={MAP_BOUNDS.size} height={MAP_BOUNDS.size} preserveAspectRatio="none" />
            {SPOTS.filter((s) => s.kind !== 'core').map((s) => (
              <circle
                key={s.id}
                cx={s.x}
                cy={s.y}
                r={Math.max(px(s.kind === 'satellite' ? 2 : 3), s.kind === 'satellite' ? 1.5 : 2.5)}
                fill={spotColor(s.resource)}
                stroke="#000"
                strokeWidth={px(0.6)}
              >
                <title>{`${itemName(s.resource)}${s.purity ? ' · ' + t(`purity.${s.purity}`) : ''}`}</title>
              </circle>
            ))}
            {place && handle && topMid && center && (
              <>
                <polygon points={corners.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(240,150,40,0.14)" stroke="#f09628" strokeWidth={px(2)} />
                {/* lo que ya hay en el plano, girado y ubicado como quedaría */}
                <g transform={`translate(${place.x} ${place.y}) rotate(${place.angle})`} pointerEvents="none">
                  {plan.rects.map((r, i) => (
                    <rect
                      key={i}
                      x={r.x0}
                      y={r.y0}
                      width={r.x1 - r.x0}
                      height={r.y1 - r.y0}
                      fill={r.base ? 'rgba(200,200,205,0.35)' : 'rgba(240,150,40,0.85)'}
                    />
                  ))}
                </g>
                <line x1={topMid.x} y1={topMid.y} x2={handle.x} y2={handle.y} stroke="#4fe0c0" strokeWidth={px(2)} />
                <circle cx={handle.x} cy={handle.y} r={px(hover === 'rotate' ? 8 : 6.5)} fill="#ffffff" stroke="#4fe0c0" strokeWidth={px(2.5)} />
                <circle cx={center.x} cy={center.y} r={px(3)} fill="#f09628" />
              </>
            )}
          </svg>
          <div className="map-zoom">
            <button className="icon-btn sm" title={t('map.fit')} onClick={() => setView({ k: fit, x: MAP_BOUNDS.x0, y: MAP_BOUNDS.y0 })}>
              <RotateCcw size={13} />
            </button>
            {center && (
              <button
                className="icon-btn sm"
                title={t('map.focus')}
                onClick={() => setView({ k: closeK, x: center.x - VIEW / 2 / closeK, y: center.y - VIEW / 2 / closeK })}
              >
                <Crosshair size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="map-side">
          <p className="muted small">{center ? t('map.dragHelp') : t('map.pickHelp')}</p>
          <h3>{t('map.angle')}</h3>
          <div className="flowline">
            <input type="range" min={-180} max={180} step={0.5} value={angle} onChange={(e) => setAngle(normAngle(Number(e.target.value)))} />
            <span>
              <input className="small-input" type="number" step={0.5} value={angle} onChange={(e) => setAngle(normAngle(Number(e.target.value)))} /> °
            </span>
          </div>
          <div className="map-angle-btns">
            {[-90, -15, -5, -1, 1, 5, 15, 90].map((d) => (
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
            <span className="axis-y">●</span> {t('map.handleLegend')}
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              {t('account.cancel')}
            </button>
            <button className="btn primary" disabled={!place} onClick={() => place && onApply({ x: Math.round(place.x * 10) / 10, y: Math.round(place.y * 10) / 10, angle })}>
              {t('map.apply')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

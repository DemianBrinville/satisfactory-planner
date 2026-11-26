import { fmtPct } from '../i18n/format'
import i18n from '../i18n'
import { locale } from '../i18n/format'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Group, Image as KImage, Layer, Line, Rect, Shape, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { buildingsById, itemName, recipesById, type Building } from '../data/gameData'
import { hasOfficialIcon, officialIconSrc } from './GameIcons'
import { MAX_SEGMENT, conveyorCost, endInfo, pathLength, route, usedPorts, type EndInfo } from '../editor/conveyors'
import { computeFlows, type EdgeFlow, type FlowResult } from '../editor/flow'
import {
  FOUNDATION,
  isVerticalConnector,
  normRect,
  portsOf,
  rectContainsPoint,
  rectsOverlap,
  rotate,
  snapAnchor,
  toWorld,
  worldRect,
  type Rect as WRect,
  type Rotation,
  type Vec,
} from '../editor/geometry'
import {
  BELT_POLES,
  PIPE_POLES,
  isPole,
  onFloor,
  portFloor,
  entityRect,
  moveStepFor,
  placeClipboard,
  snapClipboard,
  useEditor,
  type Conveyor,
  type End,
  type PlacedEntity,
} from '../editor/store'
import ContextMenu, { type MenuState } from './ContextMenu'
import { TriangleAlert, Zap, ZapOff } from 'lucide-react'
import { HOTKEYS } from '../editor/families'
import Hotbar from './Hotbar'
import Production, { ClockAdviceText, clockAdvice, type ClockAdvice } from './Production'
import { computeHeadLift, type HeadIssue } from '../editor/fluids'
import { curvedPath } from '../editor/dubins'
import {
  RAIL_MAX,
  RAIL_MIN,
  RAIL_RADIUS,
  VEHICLES,
  railCost,
  roundTrip,
  routeDistance,
  routeThroughput,
  type Route,
} from '../editor/transport'
import {
  computeGrids,
  connectionsOf,
  consumptionMW,
  hasPowerConnection,
  wireCost,
  wireLength,
  wireMax,
  wirePoint,
  type PowerResult,
} from '../editor/power'
import { NONE } from '../editor/store'
import { ItemIcon } from './GameIcons'

const COLORS: Record<string, string> = {
  machine: '#c9822b',
  miner: '#8d6e4c',
  extractor: '#3f7f9a',
  generator: '#6b5fa8',
  splitter: '#a0a0a0',
  pipeJunction: '#5b8fb0',
  pump: '#5b8fb0',
  valve: '#5b8fb0',
  foundation: '#3a3631',
  wall: '#6a6259',
  structure: '#7a7f86',
  lift: '#9a8f50',
}
const PORT_IN = '#f08a24'
const PORT_OUT = '#4fe0c0'

type Interaction =
  | { type: 'pan'; startX: number; startY: number; ox: number; oy: number }
  | { type: 'move'; start: Vec; step: number }
  | { type: 'box'; start: Vec }
  | { type: 'area'; start: Vec }
  | null

/** Extremo candidato para la herramienta de cintas. */
interface Target {
  end: End | null
  info: EndInfo
  dir: 'in' | 'out' | 'any'
}

interface Draft {
  from: Target
  /** si el trazado se empezó desde una entrada, se invierte al terminar */
  reversed: boolean
}

const ptSegDist = (p: Vec, a: Vec, b: Vec) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
const nearPath = (p: Vec, pts: Vec[], tol: number) => pts.some((q, i) => i > 0 && ptSegDist(p, pts[i - 1], q) <= tol)

export default function PlannerCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [mouse, setMouse] = useState<Vec>({ x: 0, y: 0 })
  const [screen, setScreen] = useState<Vec>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<Vec>({ x: 0, y: 0 })
  const [box, setBox] = useState<WRect | null>(null)
  /** relleno de cimientos en curso: anclaje inicial y actual */
  const [area, setArea] = useState<{ a: Vec; b: Vec } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const draftRef = useRef<Draft | null>(null)
  draftRef.current = draft
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [wireFrom, setWireFrom] = useState<string | null>(null)
  /** vía en curso: punto y rumbo de salida */
  const [railDraft, setRailDraft] = useState<{ pos: Vec; th: number | null } | null>(null)
  const inter = useRef<Interaction>(null)
  const spaceDown = useRef(false)
  const onUpRef = useRef<(e: { evt: { shiftKey: boolean } }) => void>(() => {})

  const s = useEditor()
  const { view, entities, conveyors, selection, floor, placingId, placingRot, tool, conveyorId, clipboard, pasteRot, snapStep } = s

  const routes = s.routes ?? NONE
  const entById = useMemo(() => new Map(entities.map((e) => [e.uid, e])), [entities])
  const rails = s.rails ?? NONE
  const flows: FlowResult = useMemo(
    () => computeFlows(entities, conveyors, routes, s.floorHeight),
    [entities, conveyors, routes, s.floorHeight],
  )
  const wires = s.wires ?? NONE
  const power: PowerResult = useMemo(() => computeGrids(entities, wires, flows, s.power), [entities, wires, flows, s.power])
  const headIssues = useMemo(() => computeHeadLift(entities, conveyors, s.floorHeight, flows), [entities, conveyors, s.floorHeight, flows])
  useEffect(() => {
    if (tool !== 'wire') setWireFrom(null)
    if (tool !== 'rail') setRailDraft(null)
  }, [tool])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // al cambiar de herramienta se descarta el trazado en curso
  // el trazado en curso se descarta al salir de la herramienta o cambiar de piso; cambiar de marca con E lo conserva
  useEffect(() => {
    if (tool !== 'conveyor') setDraft(null)
  }, [tool])
  useEffect(() => setDraft(null), [floor])

  // soltar el botón fuera del lienzo (sobre un panel o fuera de la ventana) también termina la acción
  useEffect(() => {
    const up = (e: MouseEvent) => {
      if (inter.current) onUpRef.current({ evt: { shiftKey: e.shiftKey } })
    }
    const blur = () => {
      spaceDown.current = false
      if (inter.current) onUpRef.current({ evt: { shiftKey: false } })
    }
    window.addEventListener('mouseup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('mouseup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // teclado
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      const st = useEditor.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (e.code === 'Space') spaceDown.current = true
      if (!ctrl && (e.key === 'r' || e.key === 'R')) {
        if (st.tool === 'place' || st.tool === 'paste') st.rotatePlacing(e.shiftKey ? -1 : 1)
        else if (st.tool === 'conveyor') st.toggleConveyorMode()
        else st.rotateSelection()
      }
      if (e.key === 'Escape') {
        setMenu(null)
        if (st.tool !== 'select') {
          // primer Esc corta el trazado en curso; el segundo sale de la herramienta
          if (draftRef.current) setDraft(null)
          else st.cancelTool()
        } else st.select([])
      }
      if (e.key === 'Delete' || e.key === 'Backspace') st.deleteSelection()
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) st.redo()
        else st.undo()
      }
      if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        st.redo()
      }
      if (ctrl && e.key.toLowerCase() === 'c') st.copySelection()
      if (ctrl && e.key.toLowerCase() === 'x') st.cutSelection()
      if (ctrl && e.key.toLowerCase() === 'v') st.startPaste()
      if (!ctrl && !e.altKey && (e.key === 'e' || e.key === 'E')) st.cycleVariant(e.shiftKey ? -1 : 1)
      if (!ctrl && !e.altKey) {
        const hk = HOTKEYS.find((h) => h.key === e.key)
        if (hk) st.selectFamily(hk.family)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const toWorldPt = (px: number, py: number): Vec => ({
    x: (px - view.offsetX) / view.scale,
    y: (py - view.offsetY) / view.scale,
  })

  const visible = useMemo(() => entities.filter((e) => onFloor(e, floor)), [entities, floor])
  const below = useMemo(() => entities.filter((e) => e.floor === floor - 1), [entities, floor])
  const visibleConv = useMemo(() => conveyors.filter((c) => c.floor === floor), [conveyors, floor])
  /** caja de cada cinta y de cada entidad, para dibujar solo lo que entra en pantalla y probar clics rápido */
  const convBox = useMemo(() => new Map(conveyors.map((c) => [c.uid, ptsBox(c.points)])), [conveyors])
  const entBox = useMemo(() => new Map(entities.map((e) => [e.uid, entityRect(e)])), [entities])
  // rectángulo visible del mundo, redondeado a 16 m para no recalcular la lista a cada pixel de paneo
  const vx0 = Math.floor(-view.offsetX / view.scale / 16) * 16 - 16
  const vy0 = Math.floor(-view.offsetY / view.scale / 16) * 16 - 16
  const vx1 = Math.ceil((size.w - view.offsetX) / view.scale / 16) * 16 + 16
  const vy1 = Math.ceil((size.h - view.offsetY) / view.scale / 16) * 16 + 16
  const inView = (r: { x0: number; y0: number; x1: number; y1: number } | null | undefined) =>
    !r || (r.x1 >= vx0 && r.x0 <= vx1 && r.y1 >= vy0 && r.y0 <= vy1)
  const shownConv = useMemo(
    () => visibleConv.filter((c) => inView(convBox.get(c.uid))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleConv, convBox, vx0, vy0, vx1, vy1],
  )
  const shownBelow = useMemo(
    () => below.filter((e) => inView(entBox.get(e.uid))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [below, entBox, vx0, vy0, vx1, vy1],
  )
  /** consejo de reloj por máquina (objetos estables mientras no cambie el plano) */
  const adviceOf = useMemo(() => {
    const m = new Map<string, ClockAdvice>()
    for (const e of entities) {
      const a = clockAdvice(flows.nodes.get(e.uid), e.clock ?? 1)
      if (a) m.set(e.uid, a)
    }
    return m
  }, [entities, flows])
  const hitOrder = useMemo(() => [...visible].sort((a, b) => layerRank(b) - layerRank(a)), [visible])
  const used = useMemo(() => usedPorts(conveyors), [conveyors])

  const hitEntity = (p: Vec): PlacedEntity | null => {
    return (
      hitOrder.find((e) => {
        const r = entBox.get(e.uid)
        return r ? rectContainsPoint(r, p) : false
      }) ?? null
    )
  }
  const powerTarget = (p: Vec): PlacedEntity | null => {
    const e = hitEntity(p)
    const b = e && buildingsById.get(e.buildingId)
    return e && b && hasPowerConnection(b) ? e : null
  }
  const freeConnections = (e: PlacedEntity) => connectionsOf(buildingsById.get(e.buildingId)!) - (power.used.get(e.uid) ?? 0)
  const visibleWires = wires.filter((w) => {
    const a = entById.get(w.from)
    const b = entById.get(w.to)
    return a && b && (onFloor(a, floor) || onFloor(b, floor))
  })
  const hitWire = (p: Vec) =>
    visibleWires.find((w) => {
      const a = entById.get(w.from)!
      const b = entById.get(w.to)!
      return nearPath(p, [wirePoint(a), wirePoint(b)], 0.6)
    }) ?? null

  /** Herramienta de líneas eléctricas: clic en una estructura y luego en otra; desde un poste se sigue tendiendo. */
  const wireClick = (p: Vec) => {
    const target = powerTarget(p)
    if (!target) return
    const st = useEditor.getState()
    if (!wireFrom) {
      if (freeConnections(target) > 0) setWireFrom(target.uid)
      return
    }
    const from = entById.get(wireFrom)
    if (!from || from.uid === target.uid) return
    const len = wireLength(from, target, st.floorHeight)
    if (len > wireMax(from, target) || freeConnections(from) <= 0 || freeConnections(target) <= 0) return
    st.addWire(from.uid, target.uid)
    const tb = buildingsById.get(target.buildingId)!
    setWireFrom(connectionsOf(tb) > 1 && freeConnections(target) > 1 ? target.uid : null)
  }

  // ---------- vías de tren ----------
  const visibleRails = rails.filter((r) => r.floor === floor)
  const hitRail = (p: Vec) => visibleRails.find((r) => nearPath(p, r.points, 2)) ?? null
  /** Puntos donde se puede enganchar una vía: extremos de otras vías y de las plataformas/estaciones. */
  const railSnap = (p: Vec): { pos: Vec; th: number } | null => {
    let best: { pos: Vec; th: number; d: number } | null = null
    const consider = (pos: Vec, th: number) => {
      const d = Math.hypot(pos.x - p.x, pos.y - p.y)
      if (d < 3 && (!best || d < best.d)) best = { pos, th, d }
    }
    for (const r of visibleRails) {
      const n = r.points.length
      if (n < 2) continue
      const a = r.points[0]
      const a2 = r.points[1]
      const z = r.points[n - 1]
      const z2 = r.points[n - 2]
      consider(a, Math.atan2(a.y - a2.y, a.x - a2.x))
      consider(z, Math.atan2(z.y - z2.y, z.x - z2.x))
    }
    for (const e of visible) {
      if (!/TrainStation|TrainDockingStation|TrainPlatform/.test(e.buildingId)) continue
      const b = buildingsById.get(e.buildingId)!
      const f = b.footprint!
      const cx = (f.minX + f.maxX) / 2
      const front = toWorld(b, e, e.rot, { x: cx, y: f.minY })
      const back = toWorld(b, e, e.rot, { x: cx, y: f.maxY })
      consider(front, Math.atan2(front.y - back.y, front.x - back.x))
      consider(back, Math.atan2(back.y - front.y, back.x - front.x))
    }
    return best ? { pos: (best as { pos: Vec }).pos, th: (best as { th: number }).th } : null
  }
  const railPreview = (() => {
    if (tool !== 'rail' || !railDraft) return null
    const snap = railSnap(mouse)
    const end = snap?.pos ?? { x: Math.round(mouse.x), y: Math.round(mouse.y) }
    // al llegar a un extremo existente se entra en sentido contrario a su salida
    const pts = curvedPath(railDraft.pos, railDraft.th, end, snap ? snap.th + Math.PI : null, RAIL_RADIUS)
    const len = pathLength(pts)
    return { pts, len, ok: len >= RAIL_MIN && len <= RAIL_MAX }
  })()
  const railClick = () => {
    const st = useEditor.getState()
    if (!railDraft) {
      const snap = railSnap(mouse)
      setRailDraft(snap ? { pos: snap.pos, th: snap.th } : { pos: { x: Math.round(mouse.x), y: Math.round(mouse.y) }, th: null })
      return
    }
    if (!railPreview?.ok) return
    st.addRail(railPreview.pts.map((q) => ({ x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 })))
    const n = railPreview.pts.length
    const z = railPreview.pts[n - 1]
    const z2 = railPreview.pts[n - 2]
    // como en el juego, se sigue tendiendo desde el final en la misma dirección
    setRailDraft({ pos: z, th: Math.atan2(z.y - z2.y, z.x - z2.x) })
  }

  // ---------- rutas de vehículos ----------
  const visibleRoutes = routes.filter((r) => {
    const a = entById.get(r.from)
    const b = entById.get(r.to)
    return a && b && (onFloor(a, floor) || onFloor(b, floor))
  })
  const hitRoute = (p: Vec) =>
    visibleRoutes.find((r) => {
      const a = entById.get(r.from)!
      const b = entById.get(r.to)!
      return nearPath(p, [wirePoint(a), wirePoint(b)], 1.2)
    }) ?? null
  const stationTarget = (p: Vec) => {
    const e = hitEntity(p)
    return e && VEHICLES[s.routeKind].stations.test(e.buildingId) ? e : null
  }
  const routeClick = (p: Vec) => {
    const st = useEditor.getState()
    const t = stationTarget(p)
    if (!t) return
    if (!st.routeFrom) return st.setRouteFrom(t.uid)
    if (t.uid === st.routeFrom) return
    st.addRoute(st.routeKind, st.routeFrom, t.uid)
  }

  const hitConveyor = (p: Vec): Conveyor | null =>
    [...visibleConv].reverse().find((c) => {
      const r = convBox.get(c.uid)!
      return p.x >= r.x0 - 1 && p.x <= r.x1 + 1 && p.y >= r.y0 - 1 && p.y <= r.y1 + 1 && nearPath(p, c.points, 0.9)
    }) ?? null

  // ---------- herramienta de cintas/tuberías ----------
  const convBuilding = conveyorId ? buildingsById.get(conveyorId) : null
  const convKind = convBuilding?.kind === 'pipe' ? 'pipe' : 'belt'
  const poleSet = convKind === 'pipe' ? PIPE_POLES : BELT_POLES
  const conveyorMode = s.conveyorMode

  /** Puerto libre más cercano (opcionalmente de un tipo) dentro de un radio. */
  const portAt = (p: Vec, kind?: 'belt' | 'pipe', radius = 1.1): { target: Target; kind: 'belt' | 'pipe' } | null => {
    let best: { target: Target; kind: 'belt' | 'pipe'; d: number } | null = null
    for (const e of visible) {
      const b = buildingsById.get(e.buildingId)
      if (!b) continue
      portsOf(b, e).forEach((port, i) => {
        if (portFloor(e, port.level) !== floor) return
        if ((kind && port.kind !== kind) || used.has(`${e.uid}:${i}`)) return
        // se acepta el clic en el borde o sobre el marcador (que asoma hacia afuera)
        const pos = toWorld(b, e, e.rot, port.pos)
        const mark = toWorld(b, e, e.rot, { x: port.pos.x + port.normal.x * 0.45, y: port.pos.y + port.normal.y * 0.45 })
        const d = Math.min(Math.hypot(pos.x - p.x, pos.y - p.y), Math.hypot(mark.x - p.x, mark.y - p.y))
        if (d < radius && (!best || d < best.d)) {
          const dir = b.kind === 'pipeJunction' || port.kind === 'pipe' ? 'any' : port.dir
          best = {
            d,
            kind: port.kind,
            target: { end: { uid: e.uid, port: i }, info: { pos, dir: rotate(port.normal, e.rot as Rotation), port }, dir },
          }
        }
      })
    }
    return best
  }

  const findTarget = (p: Vec): Target => {
    // 1) puerto libre del tipo correcto
    const port = portAt(p, convKind, 1.6)
    if (port) return port.target
    // 2) poste/soporte existente
    const pole = visible.find((e) => poleSet.has(e.buildingId) && Math.hypot(e.x - p.x, e.y - p.y) < 1.2)
    if (pole) {
      const end = { uid: pole.uid, port: -1 }
      return { end, info: endInfo(end, entities)!, dir: 'any' }
    }
    // 3) punto libre (se creará un poste), alineado al inicio si está cerca
    let q = { x: Math.round(p.x), y: Math.round(p.y) }
    if (draft) {
      const o = draft.from.info.pos
      if (Math.abs(p.x - o.x) < 0.8) q = { ...q, x: o.x }
      if (Math.abs(p.y - o.y) < 0.8) q = { ...q, y: o.y }
    }
    return { end: null, info: { pos: q, dir: null, port: null }, dir: 'any' }
  }

  const target = tool === 'conveyor' ? findTarget(mouse) : null

  /** cintas que tocan cada poste/soporte, para saber cuáles son extremos sueltos */
  const poleLinks = useMemo(() => {
    const m = new Map<string, Conveyor[]>()
    for (const c of conveyors)
      for (const u of [c.from.uid, c.to.uid]) {
        if (!m.has(u)) m.set(u, [])
        m.get(u)!.push(c)
      }
    return m
  }, [conveyors])
  /** Extremo suelto de una cinta o tubería (poste o soporte con un solo tramo) cerca del punto. */
  const freeEndAt = (p: Vec) => {
    for (const e of visible) {
      if (!BELT_POLES.has(e.buildingId) && !PIPE_POLES.has(e.buildingId)) continue
      if (Math.hypot(e.x - p.x, e.y - p.y) > 1.2) continue
      const links = poleLinks.get(e.uid) ?? []
      if (links.length !== 1) continue
      return { pole: e, conv: links[0], incoming: links[0].to.uid === e.uid }
    }
    return null
  }
  /** Sigue trazando desde el extremo suelto con la misma marca de cinta o tubería. */
  const continueFrom = (fe: NonNullable<ReturnType<typeof freeEndAt>>) => {
    const end = { uid: fe.pole.uid, port: -1 }
    const info = endInfo(end, entities)
    if (!info) return
    useEditor.getState().startConveyor(fe.conv.buildingId)
    setDraft({ from: { end, info, dir: 'any' }, reversed: !fe.incoming })
  }
  const endHover = tool === 'select' && !inter.current ? freeEndAt(mouse) : null

  /** Trazado candidato entre el inicio del borrador y el objetivo actual. */
  const preview = useMemo(() => {
    if (!draft || !target) return null
    const pts = route(draft.from.info, target.info, conveyorMode)
    const len = pathLength(pts)
    const sameEnd = draft.from.end && target.end && draft.from.end.uid === target.end.uid && draft.from.end.port === target.end.port
    const dirOk = draft.reversed ? target.dir !== 'in' : target.dir !== 'out'
    const ok = len > 0.4 && len <= MAX_SEGMENT && !sameEnd && dirOk
    return { pts, len, ok, reason: len > MAX_SEGMENT ? i18n.t('canvas.tooLong', { max: MAX_SEGMENT }) : !dirOk ? i18n.t('canvas.sameDirection') : '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, target?.info.pos.x, target?.info.pos.y, target?.end?.uid, target?.end?.port, conveyorMode])

  const conveyorClick = () => {
    if (!target || !conveyorId) return
    if (!draft) {
      setDraft({ from: target, reversed: target.dir === 'in' })
      return
    }
    if (!preview?.ok) return
    const st = useEditor.getState()
    const fromEnd: End | Vec = draft.from.end ?? draft.from.info.pos
    const toEnd: End | Vec = target.end ?? target.info.pos
    const pts = draft.reversed ? [...preview.pts].reverse() : preview.pts
    st.addConveyor({
      buildingId: conveyorId,
      points: pts,
      from: draft.reversed ? toEnd : fromEnd,
      to: draft.reversed ? fromEnd : toEnd,
      mode: conveyorMode,
    })
    // como en el juego: si terminó en un poste o punto libre, se sigue trazando desde ahí
    if (target.dir === 'any' && (!target.end || target.end.port < 0)) {
      const after = useEditor.getState()
      const last = after.conveyors[after.conveyors.length - 1]
      const endRef = draft.reversed ? last.from : last.to
      const info = endInfo(endRef, after.entities)
      if (info) setDraft({ from: { end: endRef, info, dir: 'any' }, reversed: draft.reversed })
      else setDraft(null)
    } else setDraft(null)
  }

  // ---------- eventos del lienzo ----------
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const st = useEditor.getState()
    if ((st.tool === 'place' || st.tool === 'paste') && e.evt.shiftKey) {
      st.rotatePlacing(e.evt.deltaY > 0 ? 1 : -1)
      return
    }
    const pos = e.target.getStage()!.getPointerPosition()!
    const factor = e.evt.deltaY > 0 ? 1 / 1.15 : 1.15
    const scale = Math.min(80, Math.max(1, view.scale * factor))
    const w = toWorldPt(pos.x, pos.y)
    st.setView({ scale, offsetX: pos.x - w.x * scale, offsetY: pos.y - w.y * scale })
  }

  const onDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()!.getPointerPosition()!
    const p = toWorldPt(pos.x, pos.y)
    const st = useEditor.getState()
    setMenu(null)
    if (e.evt.button === 1 || (e.evt.button === 0 && spaceDown.current)) {
      inter.current = { type: 'pan', startX: pos.x, startY: pos.y, ox: view.offsetX, oy: view.offsetY }
      return
    }
    if (e.evt.button === 2) {
      if (area) {
        // clic derecho durante el relleno: se cancela sin colocar
        inter.current = null
        setArea(null)
        return
      }
      if (st.tool !== 'select') {
        if (draft) setDraft(null)
        else if (wireFrom) setWireFrom(null)
        else if (railDraft) setRailDraft(null)
        else if (st.routeFrom) st.setRouteFrom(null)
        else st.cancelTool()
        return
      }
      // menú contextual sobre una estructura o cinta
      const hit = hitEntity(p)
      const hc = hit && buildingsById.get(hit.buildingId)?.kind !== 'foundation' ? null : hitConveyor(p)
      const target = hc ?? hit
      if (target) {
        if (!st.selection.includes(target.uid)) st.select([target.uid])
        setMenu({ x: pos.x, y: pos.y, uid: target.uid, isConveyor: !!hc })
      } else st.select([])
      return
    }
    if (e.evt.button !== 0) return
    if (st.tool === 'place' && st.placingId) {
      const b = buildingsById.get(st.placingId)!
      const anchor = snapAnchor(b, p, st.placingRot, st.snapStep)
      if (b.kind === 'foundation') {
        // cimientos: arrastrar rellena el rectángulo, un clic pone uno solo
        inter.current = { type: 'area', start: anchor }
        setArea({ a: anchor, b: anchor })
        return
      }
      st.place(anchor)
      return
    }
    if (st.tool === 'paste' && st.clipboard) {
      st.pasteAt(snapClipboard(st.clipboard, p, st.pasteRot, st.snapStep))
      return
    }
    if (st.tool === 'conveyor') {
      conveyorClick()
      return
    }
    if (st.tool === 'wire') {
      wireClick(p)
      return
    }
    if (st.tool === 'rail') {
      railClick()
      return
    }
    if (st.tool === 'route') {
      routeClick(p)
      return
    }
    // clic sobre el extremo suelto de una cinta/tubería: se sigue trazando desde ahí
    const fe = freeEndAt(p)
    if (fe) {
      continueFrom(fe)
      return
    }
    // clic sobre un puerto libre: empieza una cinta/tubería desde esa conexión
    const port = portAt(p)
    if (port) {
      st.selectFamily(port.kind === 'pipe' ? 'pipe' : 'belt')
      setDraft({ from: port.target, reversed: port.target.dir === 'in' })
      return
    }
    const hit = hitEntity(p)
    const isBase = hit && buildingsById.get(hit.buildingId)?.kind === 'foundation'
    const hc = !hit || isBase ? hitConveyor(p) : null
    if (hc) {
      st.select([hc.uid], e.evt.shiftKey)
      return
    }
    const hw = !hit || isBase ? hitWire(p) : null
    if (hw) {
      st.select([hw.uid], e.evt.shiftKey)
      return
    }
    const hr = !hit || isBase ? hitRoute(p) ?? hitRail(p) : null
    if (hr) {
      st.select([hr.uid], e.evt.shiftKey)
      return
    }
    if (hit) {
      const sel = st.selection.includes(hit.uid) ? st.selection : e.evt.shiftKey ? [...st.selection, hit.uid] : [hit.uid]
      if (!st.selection.includes(hit.uid)) st.select([hit.uid], e.evt.shiftKey)
      inter.current = { type: 'move', start: p, step: moveStepFor(sel) }
    } else {
      if (!e.evt.shiftKey) st.select([])
      inter.current = { type: 'box', start: p }
      setBox(normRect(p, p))
    }
  }

  const onMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()!.getPointerPosition()!
    const p = toWorldPt(pos.x, pos.y)
    setMouse(p)
    setScreen(pos)
    const it = inter.current
    if (!it) return
    // si se soltó el botón fuera del lienzo, no quedó registrado: se termina acá
    if (e.evt.buttons === 0) {
      onUp(e)
      return
    }
    if (it.type === 'pan') {
      useEditor.getState().setView({ offsetX: it.ox + pos.x - it.startX, offsetY: it.oy + pos.y - it.startY })
    } else if (it.type === 'move') {
      setDrag({
        x: Math.round((p.x - it.start.x) / it.step) * it.step,
        y: Math.round((p.y - it.start.y) / it.step) * it.step,
      })
    } else if (it.type === 'box') {
      setBox(normRect(it.start, p))
    } else if (it.type === 'area') {
      const st = useEditor.getState()
      const b = st.placingId ? buildingsById.get(st.placingId) : null
      if (b) setArea({ a: it.start, b: snapAnchor(b, p, st.placingRot, st.snapStep) })
    }
  }

  const onUp = (e: { evt: { shiftKey: boolean } }) => {
    const it = inter.current
    inter.current = null
    const st = useEditor.getState()
    if (it?.type === 'area') {
      if (area) st.placeMany(areaAnchors(area, st.placingId, st.placingRot))
      setArea(null)
    } else if (it?.type === 'move') {
      if (drag.x || drag.y) {
        const sel = st.selection
        const ok = sel.every((u) => {
          const en = entById.get(u)
          return !en || st.canPlace(en.buildingId, { x: en.x + drag.x, y: en.y + drag.y }, en.rot, sel)
        })
        if (ok) st.moveSelection(drag.x, drag.y)
      }
      setDrag({ x: 0, y: 0 })
    } else if (it?.type === 'box' && box) {
      const tiny = box.x1 - box.x0 < 0.3 && box.y1 - box.y0 < 0.3
      if (!tiny) {
        const hits = visible.filter((en) => {
          const r = entityRect(en)
          return r ? rectsOverlap(r, box, 0) : false
        })
        const hitConv = visibleConv.filter((c) => c.points.some((p) => rectContainsPoint(box, p)))
        st.select([...hits.map((h) => h.uid), ...hitConv.map((c) => c.uid)], e.evt.shiftKey)
      }
      setBox(null)
    }
  }

  onUpRef.current = onUp

  // ---------- fantasmas ----------
  const ghost = useMemo(() => {
    if (tool !== 'place' || !placingId || area) return null
    const b = buildingsById.get(placingId)
    if (!b) return null
    const anchor = snapAnchor(b, mouse, placingRot, snapStep)
    return { b, anchor, ok: s.canPlace(placingId, anchor, placingRot) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, placingId, placingRot, mouse, entities, floor, snapStep, area])
  const areaGhost = useMemo(() => {
    if (!area || !placingId) return null
    const anchors = areaAnchors(area, placingId, placingRot)
    return anchors.map((a) => ({ a, ok: s.canPlace(placingId, a, placingRot) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, placingId, placingRot, entities, floor])

  const pasteGhost = useMemo(() => {
    if (tool !== 'paste' || !clipboard) return null
    const anchor = snapClipboard(clipboard, mouse, pasteRot, snapStep)
    const doc = placeClipboard(clipboard, anchor, pasteRot, floor)
    const ok = doc.entities.every((e) => s.canPlace(e.buildingId, e, e.rot))
    return { doc, ok }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, clipboard, mouse, pasteRot, floor, entities, snapStep])

  const sorted = useMemo(
    () => [...visible].filter((e) => inView(entBox.get(e.uid))).sort((a, b) => layerRank(a) - layerRank(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, entBox, vx0, vy0, vx1, vy1],
  )
  const showLabels = view.scale >= 6
  const dragging = drag.x !== 0 || drag.y !== 0
  const selSet = new Set(selection)

  // ---------- información al pasar el mouse ----------
  const hover = useMemo(() => {
    if (tool !== 'select' || inter.current) return null
    const ent = hitEntity(mouse)
    const isBase = ent && buildingsById.get(ent.buildingId)?.kind === 'foundation'
    const conv = !ent || isBase ? hitConveyor(mouse) : null
    if (conv) return { conv, ent: null }
    const wire = !ent || isBase ? hitWire(mouse) : null
    if (wire) return { conv: null, ent: null, wire }
    const route = !ent || isBase ? hitRoute(mouse) : null
    if (route) return { conv: null, ent: null, route }
    const rail = !ent || isBase ? hitRail(mouse) : null
    if (rail) return { conv: null, ent: null, rail }
    if (ent && !isBase) return { conv: null, ent }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mouse, tool, visible, visibleConv])

  return (
    <div
      ref={wrapRef}
      className="canvas-wrap"
      onContextMenu={(e) => e.preventDefault()}
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
    >
      <Stage width={size.w} height={size.h} onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={(e) => onUp(e)}>
        <Layer x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale} listening={false}>
          <Grid view={view} w={size.w} h={size.h} />
          {shownBelow.map((e) => (
            <EntityShape key={e.uid} e={e} scale={view.scale} faded showLabels={false} />
          ))}
          {sorted
            .filter((e) => layerRank(e) === 0)
            .map((e) => (
              <EntityShape
                key={e.uid}
                e={selSet.has(e.uid) && dragging ? { ...e, x: e.x + drag.x, y: e.y + drag.y } : e}
                scale={view.scale}
                selected={selSet.has(e.uid)}
                showLabels={showLabels}
              />
            ))}
          {shownConv.map((c) => (
            <ConveyorShape
              key={c.uid}
              c={c}
              scale={view.scale}
              flow={flows.edges.get(c.uid)}
              headIssue={!!headIssues.get(c.uid)}
              selected={selSet.has(c.uid)}
              offset={dragging && selSet.has(c.from.uid) && selSet.has(c.to.uid) ? drag : null}
            />
          ))}
          {sorted
            .filter((e) => layerRank(e) === 1)
            .map((e) => (
              <EntityShape
                key={e.uid}
                e={selSet.has(e.uid) && dragging ? { ...e, x: e.x + drag.x, y: e.y + drag.y } : e}
                scale={view.scale}
                selected={selSet.has(e.uid)}
                showLabels={showLabels}
                usedPorts={used}
                floor={floor}
                node={flows.nodes.get(e.uid)?.effective}
                power={powerStatus(e, power)}
                advice={adviceOf.get(e.uid) ?? null}
              />
            ))}
          {visibleRails.map((r) => (
            <Group key={r.uid}>
              <Line
                points={r.points.flatMap((q) => [q.x, q.y])}
                stroke={selSet.has(r.uid) ? '#4fe0c0' : '#4a443d'}
                strokeWidth={4.2}
                lineJoin="round"
                lineCap="butt"
              />
              <Line points={r.points.flatMap((q) => [q.x, q.y])} stroke="#6b5a48" strokeWidth={3.4} dash={[0.35, 0.55]} lineJoin="round" />
              <Line points={r.points.flatMap((q) => [q.x, q.y])} stroke="#b9bec6" strokeWidth={0.18} lineJoin="round" />
            </Group>
          ))}
          {visibleRoutes.map((r) => {
            const a = entById.get(r.from)!
            const b = entById.get(r.to)!
            const p = wirePoint(a)
            const q = wirePoint(b)
            return (
              <Line
                key={r.uid}
                points={[p.x, p.y, q.x, q.y]}
                stroke={selSet.has(r.uid) ? '#4fe0c0' : ROUTE_COLOR[r.kind]}
                strokeWidth={(selSet.has(r.uid) ? 4 : 2.5) / view.scale}
                dash={[10 / view.scale, 6 / view.scale]}
                opacity={0.9}
              />
            )
          })}
          {visibleWires.map((w) => {
            const a = entById.get(w.from)!
            const b = entById.get(w.to)!
            const p = wirePoint(a)
            const q = wirePoint(b)
            const other = !onFloor(a, floor) || !onFloor(b, floor)
            return (
              <Line
                key={w.uid}
                points={[p.x, p.y, q.x, q.y]}
                stroke={selSet.has(w.uid) ? '#4fe0c0' : '#e8c547'}
                strokeWidth={(selSet.has(w.uid) ? 3 : 1.5) / view.scale}
                dash={other ? [6 / view.scale, 4 / view.scale] : undefined}
                opacity={0.85}
              />
            )
          })}
        </Layer>
        {/* capa aparte para lo que sigue al mouse: moverlo no redibuja la fábrica */}
        <Layer x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale} listening={false}>
          {ghost && (
            <EntityShape
              e={{ uid: 'ghost', buildingId: ghost.b.id, x: ghost.anchor.x, y: ghost.anchor.y, rot: placingRot, floor, angle: s.placingAngle }}
              scale={view.scale}
              ghost={ghost.ok ? 'ok' : 'bad'}
              showLabels={showLabels}
            />
          )}
          {areaGhost?.map(({ a, ok }, i) => (
            <EntityShape
              key={i}
              e={{ uid: 'area' + i, buildingId: placingId!, x: a.x, y: a.y, rot: placingRot, floor }}
              scale={view.scale}
              ghost={ok ? 'ok' : 'bad'}
              showLabels={false}
            />
          ))}
          {endHover && <Circle x={endHover.pole.x} y={endHover.pole.y} radius={1.1} stroke="#ffffff" strokeWidth={2 / view.scale} />}
          {pasteGhost && (
            <>
              {pasteGhost.doc.conveyors.map((c) => (
                <ConveyorShape key={c.uid} c={c} scale={view.scale} ghost />
              ))}
              {pasteGhost.doc.entities.map((e) => (
                <EntityShape key={e.uid} e={e} scale={view.scale} ghost={pasteGhost.ok ? 'ok' : 'bad'} showLabels={false} />
              ))}
            </>
          )}
          {railPreview && (
            <Line
              points={railPreview.pts.flatMap((q) => [q.x, q.y])}
              stroke={railPreview.ok ? 'rgba(200,190,170,0.75)' : 'rgba(230,80,70,0.85)'}
              strokeWidth={4}
              lineJoin="round"
            />
          )}
          {tool === 'route' && s.routeFrom && (() => {
            const a = entById.get(s.routeFrom)
            if (!a) return null
            const p = wirePoint(a)
            const t = stationTarget(mouse)
            const q = t ? wirePoint(t) : mouse
            return <Line points={[p.x, p.y, q.x, q.y]} stroke={ROUTE_COLOR[s.routeKind]} strokeWidth={2 / view.scale} dash={[6 / view.scale, 4 / view.scale]} />
          })()}
          {tool === 'wire' && wireFrom && (() => {
            const a = entById.get(wireFrom)
            if (!a) return null
            const p = wirePoint(a)
            const t = powerTarget(mouse)
            const q = t ? wirePoint(t) : mouse
            const len = t ? wireLength(a, t, s.floorHeight) : Math.hypot(q.x - p.x, q.y - p.y)
            const ok = len <= (t ? wireMax(a, t) : 100) && (!t || freeConnections(t) > 0)
            return <Line points={[p.x, p.y, q.x, q.y]} stroke={ok ? '#e8c547' : '#e05046'} strokeWidth={2 / view.scale} dash={[5 / view.scale, 3 / view.scale]} />
          })()}
          {tool === 'conveyor' && target && (
            <Circle
              x={target.info.pos.x}
              y={target.info.pos.y}
              radius={target.end ? 1.1 : 0.5}
              stroke={target.end ? '#ffffff' : '#888'}
              strokeWidth={2 / view.scale}
            />
          )}
          {preview && (
            <Line
              points={preview.pts.flatMap((p) => [p.x, p.y])}
              stroke={preview.ok ? (convKind === 'pipe' ? 'rgba(90,160,220,0.8)' : 'rgba(200,200,200,0.8)') : 'rgba(230,80,70,0.85)'}
              strokeWidth={convKind === 'pipe' ? 1 : 1.4}
              lineCap="round"
              lineJoin="round"
            />
          )}
          {box && (
            <Rect
              x={box.x0}
              y={box.y0}
              width={box.x1 - box.x0}
              height={box.y1 - box.y0}
              fill="rgba(79,224,192,0.08)"
              stroke="#4fe0c0"
              strokeWidth={1 / view.scale}
              dash={[4 / view.scale, 3 / view.scale]}
            />
          )}
        </Layer>
      </Stage>

      {preview && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{preview.len.toFixed(1)} m</b> / {MAX_SEGMENT} m
          {convBuilding && (
            <div className="muted">
              {conveyorCost({ buildingId: convBuilding.id, points: preview.pts })
                .map((c) => `${c.amount} ${itemName(c.item)}`)
                .join(', ')}
            </div>
          )}
          {preview.reason && <div className="bad">{preview.reason}</div>}
        </div>
      )}
      {areaGhost && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{i18n.t('canvas.foundations', { n: areaGhost.filter((g) => g.ok).length })}</b>
          {areaGhost.some((g) => !g.ok) && <div className="muted">{i18n.t('canvas.occupied', { n: areaGhost.filter((g) => !g.ok).length })}</div>}
        </div>
      )}
      {endHover && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{i18n.t(buildingsById.get(endHover.conv.buildingId)?.kind === 'pipe' ? 'canvas.continuePipe' : 'canvas.continueBelt')}</b>
        </div>
      )}
      {hover?.conv && <ConveyorTooltip c={hover.conv} flow={flows.edges.get(hover.conv.uid)} head={headIssues.get(hover.conv.uid)} at={screen} />}
      {hover?.ent && !endHover && <EntityTooltip e={hover.ent} flows={flows} power={power} at={screen} />}
      {hover?.route && <RouteTooltip r={hover.route} entities={entities} flows={flows} floorHeight={s.floorHeight} at={screen} />}
      {hover?.rail && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{i18n.t('canvas.rail')}</b>
          <div className="muted">
            {pathLength(hover.rail.points).toFixed(1)} m ·{' '}
            {railCost(pathLength(hover.rail.points))
              .map((c) => `${c.amount} ${itemName(c.item)}`)
              .join(', ')}
          </div>
        </div>
      )}
      {railPreview && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{railPreview.len.toFixed(1)} m</b> {i18n.t('canvas.railRange', { min: RAIL_MIN, max: RAIL_MAX })}
          <div className="muted">{railCost(railPreview.len).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}</div>
          {!railPreview.ok && <div className="bad">{i18n.t('canvas.railOutOfRange')}</div>}
        </div>
      )}
      {tool === 'route' && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          <b>{i18n.t(`route.title.${s.routeKind}`)}</b>
          <div className="muted">{s.routeFrom ? i18n.t('canvas.routeDest') : i18n.t('canvas.routeOrigin')}</div>
        </div>
      )}
      {hover?.wire && <WireTooltip w={hover.wire} entities={entities} floorHeight={s.floorHeight} at={screen} />}
      {tool === 'wire' && (
        <div className="tooltip" style={{ left: screen.x + 16, top: screen.y + 16 }}>
          {(() => {
            const t = powerTarget(mouse)
            const a = wireFrom ? entById.get(wireFrom) : null
            if (!t) return <span className="muted">{wireFrom ? i18n.t('canvas.wireNext') : i18n.t('canvas.wireStart')}</span>
            const b = buildingsById.get(t.buildingId)!
            const free = freeConnections(t)
            const len = a ? wireLength(a, t, s.floorHeight) : 0
            return (
              <>
                <b>{b.name}</b>
                <div className={free > 0 ? 'muted' : 'bad'}>
                  {i18n.t('canvas.freeConnections', { free, total: connectionsOf(b) })}
                </div>
                {a && a.uid !== t.uid && (
                  <div className={len > wireMax(a, t) ? 'bad' : 'muted'}>
                    {len.toFixed(1)} m / {wireMax(a, t)} m · {wireCost(len).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <Hotbar />

      <div className="coords">
        {i18n.t('canvas.coords', {
          x: mouse.x.toFixed(1),
          y: mouse.y.toFixed(1),
          fx: Math.floor(mouse.x / FOUNDATION),
          fy: Math.floor(mouse.y / FOUNDATION),
        })}
        {tool === 'conveyor' && i18n.t(conveyorMode === 'curve' ? 'canvas.hintConveyorCurve' : 'canvas.hintConveyorStraight')}
        {tool === 'paste' && i18n.t('canvas.hintPaste')}
        {tool === 'wire' && i18n.t('canvas.hintWire')}
        {tool === 'rail' && i18n.t('canvas.hintRail')}
        {tool === 'route' && i18n.t('canvas.hintRoute')}
      </div>
    </div>
  )
}

const layerRank = (e: PlacedEntity) => (buildingsById.get(e.buildingId)?.kind === 'foundation' ? 0 : 1)
const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 })

function Grid({ view, w, h }: { view: { scale: number; offsetX: number; offsetY: number }; w: number; h: number }) {
  return (
    <Shape
      sceneFunc={(ctx) => {
        const x0 = -view.offsetX / view.scale
        const y0 = -view.offsetY / view.scale
        const x1 = x0 + w / view.scale
        const y1 = y0 + h / view.scale
        const c = ctx._context
        c.fillStyle = '#17181a'
        c.fillRect(x0, y0, x1 - x0, y1 - y0)
        const lines = (step: number, color: string, width: number) => {
          c.beginPath()
          c.strokeStyle = color
          c.lineWidth = width / view.scale
          for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) {
            c.moveTo(x, y0)
            c.lineTo(x, y1)
          }
          for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) {
            c.moveTo(x0, y)
            c.lineTo(x1, y)
          }
          c.stroke()
        }
        if (view.scale >= 5) lines(1, '#222427', 1)
        lines(FOUNDATION, view.scale >= 3 ? '#34373c' : '#2a2c30', 1.5)
        c.beginPath()
        c.strokeStyle = '#5a3d1e'
        c.lineWidth = 2 / view.scale
        c.moveTo(0, y0)
        c.lineTo(0, y1)
        c.moveTo(x0, 0)
        c.lineTo(x1, 0)
        c.stroke()
      }}
    />
  )
}

/** Estado de una cinta: sobra (oferta > demanda), falta (demanda > oferta) o justo. */
export function edgeStatus(f: EdgeFlow | undefined): 'empty' | 'ok' | 'surplus' | 'deficit' {
  if (!f) return 'empty'
  const items = new Set([...f.offer.keys(), ...f.demand.keys()])
  if (!items.size) return 'empty'
  let status: 'ok' | 'surplus' | 'deficit' = 'ok'
  for (const i of items) {
    const o = f.offer.get(i) ?? 0
    const d = f.demand.get(i) ?? 0
    if (d - o > 0.05) return 'deficit'
    if (o - d > 0.05) status = 'surplus'
  }
  return status
}
const STATUS_COLOR = { empty: null, ok: '#4caf6a', surplus: '#e5b445', deficit: '#e05046' }

const ConveyorShape = memo(function ConveyorShape({
  c,
  scale,
  flow,
  selected,
  ghost,
  offset,
  headIssue,
}: {
  c: Conveyor
  scale: number
  flow?: EdgeFlow
  selected?: boolean
  ghost?: boolean
  offset?: Vec | null
  headIssue?: boolean
}) {
  const b = buildingsById.get(c.buildingId)
  const isPipe = b?.kind === 'pipe'
  const pts = offset ? c.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) : c.points
  const flat = pts.flatMap((p) => [p.x, p.y])
  const status = edgeStatus(flow)
  const tint = STATUS_COLOR[status]
  const len = pathLength(pts)
  const bad = len > MAX_SEGMENT || headIssue
  return (
    <Group opacity={ghost ? 0.5 : 1}>
      {(selected || tint || bad) && (
        <Line
          points={flat}
          stroke={bad ? '#e05046' : selected ? '#4fe0c0' : tint!}
          strokeWidth={(isPipe ? 1 : 1.4) + 6 / scale}
          lineCap="round"
          lineJoin="round"
          opacity={selected ? 1 : 0.55}
        />
      )}
      <Line
        points={flat}
        stroke={isPipe ? '#4d7fa6' : '#55585e'}
        strokeWidth={isPipe ? 1 : 1.4}
        lineCap={isPipe ? 'round' : 'butt'}
        lineJoin="round"
      />
      {!isPipe && scale >= 4 && (
        <Line
          points={flat}
          stroke="#2b2d31"
          strokeWidth={0.5}
          dash={[0.6, 0.9]}
          lineJoin="round"
        />
      )}
      {scale >= 3 && <FlowArrows pts={pts} color={isPipe ? '#a9d4f5' : '#d9d9d9'} />}
    </Group>
  )
})

/** Flechas a lo largo del trazado para indicar el sentido. */
function FlowArrows({ pts, color }: { pts: Vec[]; color: string }) {
  const arrows: number[][] = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < 1.5) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    for (let d = 2; d < len - 0.5; d += 4) {
      const cx = a.x + ux * d
      const cy = a.y + uy * d
      arrows.push([cx - ux * 0.35 - uy * 0.35, cy - uy * 0.35 + ux * 0.35, cx + ux * 0.35, cy + uy * 0.35, cx - ux * 0.35 + uy * 0.35, cy - uy * 0.35 - ux * 0.35])
    }
  }
  return (
    <>
      {arrows.map((p, i) => (
        <Line key={i} points={p} stroke={color} strokeWidth={0.18} lineCap="round" lineJoin="round" />
      ))}
    </>
  )
}

const EntityShape = memo(function EntityShape({
  e,
  scale,
  selected,
  faded,
  ghost,
  showLabels,
  usedPorts,
  node,
  floor,
  power,
  advice,
}: {
  e: PlacedEntity
  scale: number
  selected?: boolean
  faded?: boolean
  ghost?: 'ok' | 'bad'
  showLabels: boolean
  usedPorts?: Set<string>
  node?: number
  floor?: number
  power?: PowerStatus
  advice?: ClockAdvice
}) {
  const b = buildingsById.get(e.buildingId)
  if (!b) return null
  const r = worldRect(b, e, e.rot)
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const pole = isPole(e.buildingId)
  const base = COLORS[b.kind] ?? COLORS.structure
  const fill = ghost ? (ghost === 'ok' ? 'rgba(79,170,224,0.45)' : 'rgba(224,80,70,0.5)') : base
  const isFoundation = b.kind === 'foundation'
  if (pole) {
    // el poste se dibuja como una barra cruzada al eje de la cinta, girada según su ángulo
    return (
      <Rect
        x={e.x}
        y={e.y}
        width={0.7}
        height={2}
        offsetX={0.35}
        offsetY={1}
        rotation={e.angle ?? 0}
        cornerRadius={0.15}
        fill={ghost ? fill : PIPE_POLES.has(e.buildingId) ? '#4d7fa6' : '#8a8d93'}
        stroke={selected ? '#4fe0c0' : '#111'}
        strokeWidth={(selected ? 2.5 : 1) / scale}
        opacity={faded ? 0.18 : 1}
      />
    )
  }
  return (
    <Group opacity={faded ? 0.18 : 1}>
      <Rect
        x={r.x0}
        y={r.y0}
        width={w}
        height={h}
        fill={fill}
        opacity={isFoundation && !ghost ? 0.9 : 1}
        stroke={selected ? '#4fe0c0' : isFoundation ? '#4a453e' : '#111'}
        strokeWidth={(selected ? 2.5 : 1) / scale}
        cornerRadius={isFoundation ? 0 : 0.3}
      />
      {power && !ghost && (
        // estado eléctrico: sin conectar (gris), red sobrecargada (rojo), con energía (amarillo)
        <Line
          points={boltPoints(r.x0 + 0.35, r.y0 + 0.3, 1.1)}
          closed
          fill={power === 'none' ? '#8a8d93' : power === 'over' ? '#e05046' : '#e8c547'}
          stroke="#111"
          strokeWidth={0.6 / scale}
        />
      )}
      {advice && !ghost && (
        // aviso de reloj: flecha abajo = conviene bajarlo, arriba = hace falta subirlo, cruz = ni al 250 % alcanza
        <Group>
          <Circle
            x={r.x1 - 0.95}
            y={r.y0 + 0.95}
            radius={0.75}
            fill={advice.kind === 'under' ? '#2c6c99' : advice.kind === 'over' ? '#b5781f' : '#b23a33'}
            stroke="#111"
            strokeWidth={1 / scale}
          />
          <AdviceGlyph kind={advice.kind} cx={r.x1 - 0.95} cy={r.y0 + 0.95} scale={scale} />
        </Group>
      )}
      {node !== undefined && !ghost && (
        // barra de rendimiento: cuánto está produciendo respecto al 100 %
        <Rect
          x={r.x0 + 0.3}
          y={r.y1 - 0.7}
          width={Math.max(0, (w - 0.6) * Math.min(1, node))}
          height={0.35}
          fill={node >= 0.999 ? '#4caf6a' : node > 0 ? '#e5b445' : '#e05046'}
        />
      )}
      {/* de lejos los detalles chicos no se distinguen y hacen lento el dibujo */}
      {!isFoundation && scale >= 2.5 && <FrontMark b={b} e={e} scale={scale} />}
      {!isFoundation && (scale >= 2.5 || ghost) && <Ports b={b} e={e} scale={scale} used={usedPorts} floor={floor} />}
      {isVerticalConnector(b.id) && (
        <Text
          x={r.x0}
          y={r.y0 + h / 2 - 0.55}
          width={w}
          align="center"
          text={'P' + (e.topFloor ?? e.floor + 1)}
          fontSize={1.1}
          fill="#fff"
          fontStyle="bold"
        />
      )}
      {/* icono de lo que produce: producto de la receta o recurso del taladro/extractor */}
      {!ghost && !faded && scale >= 2 && <ProductIcon e={e} r={r} w={w} h={h} labeled={showLabels && w * scale > 40} />}
      {showLabels && !isFoundation && w * scale > 40 && (
        <Text
          x={r.x0}
          y={r.y0 + h / 2 - Math.min(1.1, w / 7) / 2 + (productOf(e) ? Math.min(w, h) * 0.22 : 0)}
          width={w}
          align="center"
          text={b.name}
          fontSize={Math.min(1.1, w / 7)}
          fill="#fff"
          fontStyle="bold"
          wrap="none"
          ellipsis
        />
      )}
    </Group>
  )
})

/** Línea en el borde frontal (lado de salida) para ver la orientación. */
function FrontMark({ b, e, scale }: { b: Building; e: PlacedEntity; scale: number }) {
  const f = b.footprint
  if (!f || b.kind === 'wall') return null
  const p = toWorld(b, e, e.rot as Rotation, { x: f.minX + 0.3, y: f.minY + 0.3 })
  const q = toWorld(b, e, e.rot as Rotation, { x: f.maxX - 0.3, y: f.minY + 0.3 })
  return <Line points={[p.x, p.y, q.x, q.y]} stroke="rgba(255,255,255,0.35)" strokeWidth={2 / scale} />
}

function Ports({ b, e, scale, used, floor }: { b: Building; e: PlacedEntity; scale: number; used?: Set<string>; floor?: number }) {
  const ports = portsOf(b, e)
  if (!ports.length) return null
  return (
    <>
      {ports.map((p, i) => {
        if (floor !== undefined && portFloor(e, p.level) !== floor) return null
        const at = toWorld(b, e, e.rot as Rotation, p.pos)
        const outer = toWorld(b, e, e.rot as Rotation, {
          x: p.pos.x + p.normal.x * 0.9,
          y: p.pos.y + p.normal.y * 0.9,
        })
        const connected = used?.has(`${e.uid}:${i}`)
        const color = p.dir === 'in' ? PORT_IN : PORT_OUT
        if (p.kind === 'pipe') {
          return (
            <Circle
              key={i}
              x={at.x}
              y={at.y}
              radius={0.7}
              fill={connected ? color : '#16202a'}
              stroke={color}
              strokeWidth={2 / scale}
            />
          )
        }
        const back = p.dir === 'out' ? at : outer
        const point = p.dir === 'out' ? outer : at
        const nx = -(outer.y - at.y) * 0.6
        const ny = (outer.x - at.x) * 0.6
        return (
          <Line
            key={i}
            points={[back.x + nx, back.y + ny, point.x, point.y, back.x - nx, back.y - ny]}
            closed
            fill={color}
            opacity={connected ? 0.45 : 1}
            stroke="#111"
            strokeWidth={0.5 / scale}
          />
        )
      })}
    </>
  )
}

// ---------- tooltips ----------

function ConveyorTooltip({ c, flow, head, at }: { c: Conveyor; flow?: EdgeFlow; head?: HeadIssue; at: Vec }) {
  const b = buildingsById.get(c.buildingId)
  const len = pathLength(c.points)
  const unit = b?.kind === 'pipe' ? 'm³/min' : '/min'
  const items = flow ? [...new Set([...flow.offer.keys(), ...flow.demand.keys()])] : []
  const totalFlow = flow ? [...flow.flow.values()].reduce((a, v) => a + v, 0) : 0
  return (
    <div className="tooltip" style={{ left: at.x + 16, top: at.y + 16 }}>
      <b>{b?.name}</b>
      <div className="muted">
        {i18n.t('canvas.convInfo', { len: len.toFixed(1), cap: fmt(flow?.capacity ?? 0), unit, use: flow?.capacity ? Math.round((totalFlow / flow.capacity) * 100) : 0 })}
      </div>
      {head && (
        <div className="bad">
          <TriangleAlert size={13} /> {i18n.t('canvas.headLift', { needed: fmt(head.needed), reach: fmt(head.reach) })}
        </div>
      )}
      {items.length === 0 && <div className="muted">{i18n.t('canvas.noMaterial')}</div>}
      {items.map((i) => {
        const o = flow!.offer.get(i) ?? 0
        const d = flow!.demand.get(i) ?? 0
        const f = flow!.flow.get(i) ?? 0
        const diff = o - d
        return (
          <div key={i} className="tt-item">
            <div>
              <ItemIcon item={i} size={14} /> <b>{itemName(i)}</b>: {fmt(f)} {unit}
            </div>
            <div className="muted">
              {i18n.t('canvas.arrivesIdeal', { o: fmt(o), d: fmt(d) })}
              {diff > 0.05 && <span className="warn">{i18n.t('canvas.surplus', { n: fmt(diff) })}</span>}
              {diff < -0.05 && <span className="bad">{i18n.t('canvas.shortage', { n: fmt(-diff) })}</span>}
            </div>
            {flow?.local && flow.local.has(i) && Math.abs((flow.local.get(i) ?? 0) - d) > 0.05 && (
              <div className="muted">
                {i18n.t('canvas.localAsks', { n: fmt(flow.local.get(i) ?? 0) })}
                {(flow.local.get(i) ?? 0) - o > 0.05 && <span className="warn">{i18n.t('canvas.localShort', { n: fmt((flow.local.get(i) ?? 0) - o) })}</span>}
                {o - (flow.local.get(i) ?? 0) > 0.05 && <span className="warn">{i18n.t('canvas.localSurplus', { n: fmt(o - (flow.local.get(i) ?? 0)) })}</span>}
              </div>
            )}
            {d > (flow?.capacity ?? Infinity) + 0.05 && (
              <div className="bad">{i18n.t(unit === '/min' ? 'canvas.idealOverBelt' : 'canvas.idealOverPipe', { cap: fmt(flow!.capacity) })}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const ROUTE_COLOR: Record<string, string> = {
  train: '#c77dff',
  truck: '#5fb3f0',
  tractor: '#7fd17f',
  explorer: '#f0a35f',
  drone: '#f06f8f',
}

function RouteTooltip({
  r,
  entities,
  flows,
  floorHeight,
  at,
}: {
  r: Route
  entities: PlacedEntity[]
  flows: FlowResult
  floorHeight?: number
  at: Vec
}) {
  const f = flows.edges.get(r.uid)
  const items = f ? [...f.offer.keys()] : []
  const dist = routeDistance(r, entities, floorHeight)
  const t = roundTrip(r, entities, floorHeight)
  return (
    <div className="tooltip" style={{ left: at.x + 16, top: at.y + 16 }}>
      <b>
        {i18n.t(`route.title.${r.kind}`)}
        {r.kind === 'train' && i18n.t('canvas.wagons', { n: r.count ?? 1 })}
      </b>
      <div className="muted">
        {i18n.t('canvas.routeInfo', { dist: fmt(dist), t: fmt(t) })}
      </div>
      {items.length === 0 && (
        <div className="muted">{i18n.t('canvas.routeGeneric', { n: fmt(routeThroughput(r, null, entities, floorHeight)) })}</div>
      )}
      {items.map((i) => (
        <div key={i}>
          <b>{itemName(i)}</b>: {i18n.t('canvas.routeItem', { f: fmt(f!.flow.get(i) ?? 0), cap: fmt(routeThroughput(r, i, entities, floorHeight)) })}
        </div>
      ))}
    </div>
  )
}

type PowerStatus = 'none' | 'over' | 'ok' | undefined

/** Rayo (icono propio dibujado en el lienzo). */
function boltPoints(x: number, y: number, s: number): number[] {
  const p = [
    [0.55, 0],
    [0.1, 0.55],
    [0.42, 0.55],
    [0.3, 1],
    [0.85, 0.38],
    [0.52, 0.38],
    [0.7, 0],
  ]
  return p.flatMap(([px, py]) => [x + px * s, y + py * s])
}

/** Insignia de reloj dibujada: flecha abajo, flecha arriba o cruz. */
function AdviceGlyph({ kind, cx, cy, scale }: { kind: 'under' | 'over' | 'impossible'; cx: number; cy: number; scale: number }) {
  const w = 2 / scale + 0.06
  if (kind === 'impossible')
    return (
      <>
        <Line points={[cx - 0.3, cy - 0.3, cx + 0.3, cy + 0.3]} stroke="#fff" strokeWidth={w} lineCap="round" />
        <Line points={[cx + 0.3, cy - 0.3, cx - 0.3, cy + 0.3]} stroke="#fff" strokeWidth={w} lineCap="round" />
      </>
    )
  const d = kind === 'under' ? 1 : -1
  return (
    <>
      <Line points={[cx, cy - 0.35 * d, cx, cy + 0.35 * d]} stroke="#fff" strokeWidth={w} lineCap="round" />
      <Line points={[cx - 0.28, cy + 0.08 * d, cx, cy + 0.36 * d, cx + 0.28, cy + 0.08 * d]} stroke="#fff" strokeWidth={w} lineCap="round" lineJoin="round" />
    </>
  )
}

function powerStatus(e: PlacedEntity, power: PowerResult): PowerStatus {
  const b = buildingsById.get(e.buildingId)
  if (!b || !(b.powerMW > 0) || power.infinite) return undefined
  const gid = power.gridOf.get(e.uid)
  if (!gid) return 'none'
  const g = power.grids.find((x) => x.id === gid)!
  return g.consumption > g.generation + 1e-6 ? 'over' : 'ok'
}

function WireTooltip({ w, entities, floorHeight, at }: { w: { from: string; to: string }; entities: PlacedEntity[]; floorHeight?: number; at: Vec }) {
  const a = entities.find((x) => x.uid === w.from)
  const b = entities.find((x) => x.uid === w.to)
  if (!a || !b) return null
  const len = wireLength(a, b, floorHeight)
  return (
    <div className="tooltip" style={{ left: at.x + 16, top: at.y + 16 }}>
      <b>{i18n.t('canvas.powerLine')}</b>
      <div className="muted">
        {buildingsById.get(a.buildingId)?.name} ↔ {buildingsById.get(b.buildingId)?.name}
      </div>
      <div className="muted">
        {len.toFixed(1)} m · {wireCost(len).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}
      </div>
    </div>
  )
}

/** Línea de estado eléctrico: red, consumo y generación. */
export function GridLine({ e, b, power }: { e: PlacedEntity; b: Building; power: PowerResult }) {
  if (!hasPowerConnection(b)) return null
  if (power.infinite)
    return b.powerMW > 0 ? (
      <div className="muted">
        <Zap size={13} /> {i18n.t('canvas.infinite', { mw: fmt(consumptionMW(e, b)) })}
      </div>
    ) : null
  const gid = power.gridOf.get(e.uid)
  if (!gid)
    return (
      <div className={b.powerMW > 0 ? 'bad' : 'muted'}>
        <ZapOff size={13} /> {i18n.t('canvas.unpowered')}
      </div>
    )
  const g = power.grids.find((x) => x.id === gid)!
  const over = g.consumption > g.generation + 1e-6
  return (
    <div className={over ? 'bad' : 'muted'}>
      <Zap size={13} /> {i18n.t('canvas.grid', { id: g.id, use: fmt(g.consumption), gen: fmt(g.generation) })}
      {over && i18n.t('canvas.overloaded')}
    </div>
  )
}

function EntityTooltip({ e, flows, power, at }: { e: PlacedEntity; flows: FlowResult; power: PowerResult; at: Vec }) {
  const b = buildingsById.get(e.buildingId)
  const n = flows.nodes.get(e.uid)
  if (!b) return null
  return (
    <div className="tooltip" style={{ left: at.x + 16, top: at.y + 16 }}>
      <b>{b.name}</b>
      {e.clock !== undefined && e.clock !== 1 && <span className="muted">{i18n.t('canvas.clock', { pct: fmtPct(e.clock, 1) })}</span>}
      <GridLine e={e} b={b} power={power} />
      {n ? (
        <>
          <Production n={n} compact />
          <ClockAdviceText a={clockAdvice(n, e.clock ?? 1)} />
        </>
      ) : (
        b.kind === 'machine' && <div className="muted">{e.recipeId ? i18n.t('canvas.noBelts') : i18n.t('canvas.pickRecipe')}</div>
      )}
    </div>
  )
}

/** Caja que encierra un trazado. */
function ptsBox(pts: Vec[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.y < y0) y0 = p.y
    if (p.x > x1) x1 = p.x
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1 }
}

/** Posiciones de un relleno de área: de un anclaje al otro en pasos del tamaño de la pieza (máx. 50 × 50). */
function areaAnchors(area: { a: Vec; b: Vec }, buildingId: string | null, rot: Rotation): Vec[] {
  const b = buildingId ? buildingsById.get(buildingId) : null
  if (!b) return []
  const r = worldRect(b, { x: 0, y: 0 }, rot)
  const sw = r.x1 - r.x0
  const sh = r.y1 - r.y0
  const nx = Math.min(50, Math.round(Math.abs(area.b.x - area.a.x) / sw) + 1)
  const ny = Math.min(50, Math.round(Math.abs(area.b.y - area.a.y) / sh) + 1)
  const dx = Math.sign(area.b.x - area.a.x) * sw
  const dy = Math.sign(area.b.y - area.a.y) * sh
  const out: Vec[] = []
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ x: area.a.x + dx * i, y: area.a.y + dy * j })
  return out
}

/** Lo que produce una entidad: el producto principal de su receta o el recurso que extrae. */
function productOf(e: PlacedEntity): string | null {
  const item = e.recipeId ? recipesById.get(e.recipeId)?.products[0]?.item : e.resource
  return item && hasOfficialIcon(item) ? item : null
}

/** Imágenes ya cargadas para el lienzo (se comparten entre todas las máquinas). */
const iconImages = new Map<string, HTMLImageElement>()
function useIconImage(src: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(() => (src ? iconImages.get(src) ?? null : null))
  useEffect(() => {
    if (!src) return setImg(null)
    const cached = iconImages.get(src)
    if (cached?.complete) return setImg(cached)
    const el = cached ?? new window.Image()
    iconImages.set(src, el)
    const done = () => setImg(el)
    el.addEventListener('load', done)
    if (!cached) el.src = src
    return () => el.removeEventListener('load', done)
  }, [src])
  return img
}

/** Icono del producto en el centro de la máquina (arriba del nombre cuando se muestra). */
function ProductIcon({ e, r, w, h, labeled }: { e: PlacedEntity; r: { x0: number; y0: number }; w: number; h: number; labeled: boolean }) {
  const item = productOf(e)
  const img = useIconImage(item ? officialIconSrc(item) : null)
  if (!item || !img) return null
  const size = Math.min(w, h) * (labeled ? 0.42 : 0.6)
  const cx = r.x0 + w / 2
  const cy = r.y0 + h / 2 - (labeled ? size * 0.35 : 0)
  return <KImage image={img} x={cx - size / 2} y={cy - size / 2} width={size} height={size} listening={false} />
}

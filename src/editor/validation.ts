import { buildingsById } from '../data/gameData'
import { maxSegmentOf, pathLength } from './conveyors'
import { footprintOf, isVerticalConnector, type Rect, type Vec } from './geometry'
import { connectionsOf, wireLength, wireMax, wirePoint } from './power'
import { BELT_POLES, entityRect, isPole, onFloor, type Conveyor, type PlacedEntity, type Rail, type Wire } from './store'
import type { Route } from './transport'
import { buildRailNet, isTimetable, legsOf, netOfStation } from './trains'

/**
 * Validación del plano: lo que en el juego no se podría construir así o no funcionaría.
 * Cada problema trae el piso, un punto para ubicarlo y las estructuras involucradas.
 */

export type ProblemKind = 'overlap' | 'through' | 'tooLong' | 'slope' | 'wireLong' | 'poleFull' | 'trainNoTrack' | 'trainsNoSignals' | 'signalOffRail'

export interface Problem {
  id: string
  kind: ProblemKind
  floor: number
  at: Vec
  /** estructuras, cintas o cables involucrados (para seleccionarlos) */
  uids: string[]
  /** datos para el mensaje: ids de edificio y números */
  a?: string
  b?: string
  n?: number
  max?: number
  /** estaciones de tren nombradas en el mensaje (uid) */
  sa?: string
  sb?: string
}

/** Pendiente máxima de una cinta transportadora (wiki: "The maximum slope is 35°"). */
export const MAX_BELT_SLOPE = 35
/** Altura a la que salen y entran las cintas de las máquinas: la del poste de cinta más bajo (mHeight = 100 cm). */
export const PORT_HEIGHT = 1

/**
 * Alturas posibles de un poste de cinta (m). Poste común: de 1 a 7 m de a 2 m (wiki).
 * Poste apilable: 2n + 1 m (el de abajo mide 3 m y cada uno que se apila suma 2 m, mStackHeight = 200 cm),
 * hasta lo que entra debajo del piso de arriba.
 */
export function poleHeights(buildingId: string, floorHeight: number): number[] | null {
  if (buildingId === 'Build_ConveyorPole_C') return [1, 3, 5, 7]
  if (buildingId === 'Build_ConveyorPoleStackable_C') {
    const out: number[] = []
    for (let h = 3; h <= Math.max(3, floorHeight - 1); h += 2) out.push(h)
    return out
  }
  return null
}

export const defaultPoleHeight = (buildingId: string) => (buildingId === 'Build_ConveyorPoleStackable_C' ? 3 : PORT_HEIGHT)

/** Altura de la cinta en uno de sus extremos. */
function endHeight(e: PlacedEntity | undefined, port: number): number {
  if (!e || port >= 0 || !BELT_POLES.has(e.buildingId)) return PORT_HEIGHT
  return e.height ?? defaultPoleHeight(e.buildingId)
}

/** ¿El segmento a→b entra en el rectángulo? (Liang–Barsky) Devuelve el punto medio del tramo adentro. */
function segmentInRect(a: Vec, b: Vec, r: Rect): Vec | null {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0
    const t = q / p
    if (p < 0) {
      if (t > t1) return false
      if (t > t0) t0 = t
    } else {
      if (t < t0) return false
      if (t < t1) t1 = t
    }
    return true
  }
  if (!clip(-dx, a.x - r.x0) || !clip(dx, r.x1 - a.x) || !clip(-dy, a.y - r.y0) || !clip(dy, r.y1 - a.y)) return null
  if (t1 - t0 < 1e-6) return null
  const t = (t0 + t1) / 2
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/** Estructuras que una cinta no puede atravesar: todo menos cimientos, paredes, arquitectura, postes y soportes. */
const isObstacle = (id: string) => {
  const b = buildingsById.get(id)
  if (!b || isPole(id) || /ConveyorMonitor/.test(id)) return false
  if (b.kind === 'foundation' || b.kind === 'wall') return false
  return !(b.kind === 'structure' && (b.category === 'arquitectura' || b.category === 'cimientos' || b.category === 'paredes'))
}
/** Capa para choques entre estructuras (igual que al colocar: los cimientos van debajo). */
const layerOf = (id: string) => (buildingsById.get(id)?.kind === 'foundation' && !isVerticalConnector(id) ? 'base' : 'top')

const center = (r: Rect): Vec => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 })
const CELL = 16
const cellsOf = (r: Rect) => {
  const out: string[] = []
  for (let gx = Math.floor(r.x0 / CELL); gx <= Math.floor(r.x1 / CELL); gx++)
    for (let gy = Math.floor(r.y0 / CELL); gy <= Math.floor(r.y1 / CELL); gy++) out.push(`${gx},${gy}`)
  return out
}
const floorsOf = (e: PlacedEntity) => {
  if (!isVerticalConnector(e.buildingId)) return [e.floor]
  const out: number[] = []
  for (let f = e.floor; f <= (e.topFloor ?? e.floor + 1); f++) if (onFloor(e, f)) out.push(f)
  return out
}

export function findProblems(
  entities: PlacedEntity[],
  conveyors: Conveyor[],
  wires: Wire[],
  floorHeight: number,
  rails: Rail[] = [],
  routes: Route[] = [],
): Problem[] {
  const problems: Problem[] = []
  const byUid = new Map(entities.map((e) => [e.uid, e]))
  const rects = new Map<string, Rect>()
  for (const e of entities) {
    const r = entityRect(e)
    if (r) rects.set(e.uid, r)
  }

  // índice por piso y celda de 16 m
  const grid = new Map<string, PlacedEntity[]>()
  for (const e of entities) {
    const r = rects.get(e.uid)
    if (!r) continue
    for (const f of floorsOf(e))
      for (const c of cellsOf(r)) {
        const k = `${f}:${c}`
        const list = grid.get(k)
        if (list) list.push(e)
        else grid.set(k, [e])
      }
  }
  const near = (floor: number, r: Rect) => {
    const seen = new Set<PlacedEntity>()
    for (const c of cellsOf(r)) for (const e of grid.get(`${floor}:${c}`) ?? []) seen.add(e)
    return seen
  }

  // ---------- estructuras superpuestas ----------
  const pairs = new Set<string>()
  for (const e of entities) {
    const r = rects.get(e.uid)
    if (!r) continue
    for (const f of floorsOf(e))
      for (const o of near(f, r)) {
        if (o.uid <= e.uid) continue
        const key = `${e.uid}|${o.uid}`
        if (pairs.has(key) || layerOf(o.buildingId) !== layerOf(e.buildingId)) continue
        const q = rects.get(o.uid)!
        // postes y soportes de cinta o tubería: su caja de colisión es generosa; cuentan solo si el poste
        // queda dentro de la otra estructura (o encima de otro poste)
        const pe = isPole(e.buildingId)
        const po = isPole(o.buildingId)
        if (pe || po) {
          const inside = (pole: PlacedEntity, r2: Rect) => pole.x > r2.x0 + 0.2 && pole.x < r2.x1 - 0.2 && pole.y > r2.y0 + 0.2 && pole.y < r2.y1 - 0.2
          const clash = pe && po ? Math.hypot(e.x - o.x, e.y - o.y) < 0.5 : pe ? inside(e, q) : inside(o, r)
          if (!clash) continue
        }
        const x0 = Math.max(r.x0, q.x0)
        const y0 = Math.max(r.y0, q.y0)
        const x1 = Math.min(r.x1, q.x1)
        const y1 = Math.min(r.y1, q.y1)
        if (x1 - x0 < 0.01 || y1 - y0 < 0.01) continue
        pairs.add(key)
        problems.push({ id: `overlap:${key}`, kind: 'overlap', floor: f, at: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, uids: [e.uid, o.uid], a: e.buildingId, b: o.buildingId })
      }
  }

  for (const c of conveyors) {
    const kind = buildingsById.get(c.buildingId)?.kind
    const len = pathLength(c.points)
    const mid = c.points[Math.floor(c.points.length / 2)] ?? { x: 0, y: 0 }

    // ---------- largo máximo del tramo ----------
    const maxLen = maxSegmentOf(c.buildingId)
    if (len > maxLen + 0.01)
      problems.push({ id: `tooLong:${c.uid}`, kind: 'tooLong', floor: c.floor, at: mid, uids: [c.uid], a: c.buildingId, n: len, max: maxLen })

    // ---------- pendiente de las cintas ----------
    const hA = endHeight(byUid.get(c.from.uid), c.from.port)
    const hB = endHeight(byUid.get(c.to.uid), c.to.port)
    if (kind === 'belt' && hA !== hB) {
      const deg = len > 0 ? (Math.atan2(Math.abs(hA - hB), len) * 180) / Math.PI : 90
      if (deg > MAX_BELT_SLOPE + 0.05)
        problems.push({ id: `slope:${c.uid}`, kind: 'slope', floor: c.floor, at: mid, uids: [c.uid], a: c.buildingId, n: deg, max: MAX_BELT_SLOPE })
    }

    // ---------- cintas y tuberías que atraviesan estructuras ----------
    // si la cinta va por arriba de la estructura en todo su recorrido (postes altos), pasa por encima
    const low = Math.min(hA, hB)
    const hit = new Set<string>()
    for (let i = 1; i < c.points.length; i++) {
      const a = c.points[i - 1]
      const b = c.points[i]
      const box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
      for (const o of near(c.floor, box)) {
        if (hit.has(o.uid) || o.uid === c.from.uid || o.uid === c.to.uid || !isObstacle(o.buildingId)) continue
        const ob = buildingsById.get(o.buildingId)!
        if (low >= footprintOf(ob).height) continue
        const r = rects.get(o.uid)!
        // margen de 0,2 m: rozar el borde (puertos, cintas pegadas) no cuenta
        const inner = { x0: r.x0 + 0.2, y0: r.y0 + 0.2, x1: r.x1 - 0.2, y1: r.y1 - 0.2 }
        if (inner.x1 <= inner.x0 || inner.y1 <= inner.y0) continue
        const p = segmentInRect(a, b, inner)
        if (!p) continue
        hit.add(o.uid)
        problems.push({ id: `through:${c.uid}:${o.uid}`, kind: 'through', floor: c.floor, at: p, uids: [c.uid, o.uid], a: c.buildingId, b: o.buildingId })
      }
    }
  }

  // ---------- energía: cables demasiado largos y postes con más cables de los que admiten ----------
  const used = new Map<string, number>()
  for (const w of wires) {
    const a = byUid.get(w.from)
    const b = byUid.get(w.to)
    if (!a || !b) continue
    used.set(a.uid, (used.get(a.uid) ?? 0) + 1)
    used.set(b.uid, (used.get(b.uid) ?? 0) + 1)
    const len = wireLength(a, b, floorHeight)
    const max = wireMax(a, b)
    if (len > max + 0.01) {
      const p = wirePoint(a)
      const q = wirePoint(b)
      problems.push({ id: `wireLong:${w.uid}`, kind: 'wireLong', floor: Math.min(a.floor, b.floor), at: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, uids: [w.uid], n: len, max })
    }
  }
  for (const [uid, n] of used) {
    const e = byUid.get(uid)!
    const b = buildingsById.get(e.buildingId)
    if (!b) continue
    const max = connectionsOf(b)
    if (n > max) problems.push({ id: `poleFull:${uid}`, kind: 'poleFull', floor: e.floor, at: center(rects.get(uid) ?? { x0: e.x, y0: e.y, x1: e.x, y1: e.y }), uids: [uid], a: e.buildingId, n, max })
  }

  // ---------- trenes: vías entre paradas, señales cuando comparten vías, señales fuera de la vía ----------
  const trains = routes.filter(isTimetable)
  const signals = entities.some((e) => /RailroadBlockSignal|RailroadPathSignal/.test(e.buildingId))
  if (trains.length || signals) {
    const net = buildRailNet(entities, rails)
    const users = new Map<number, { n: number; at: Vec; floor: number; uid: string }>()
    for (const r of trains) {
      for (const l of legsOf(r, net)) {
        if (l.dist !== null) continue
        const a = byUid.get(l.from)
        if (!a) continue
        problems.push({ id: `trainNoTrack:${r.uid}:${l.from}:${l.to}`, kind: 'trainNoTrack', floor: a.floor, at: center(rects.get(a.uid)!), uids: [r.uid, l.from, l.to], sa: l.from, sb: l.to })
      }
      // redes por las que el tren de verdad anda (una estación suelta, sin vías, no cuenta)
      const nets = new Set(
        legsOf(r, net)
          .filter((l) => l.dist !== null && l.dist > 0)
          .map((l) => netOfStation(net, l.from))
          .filter((x): x is number => x !== undefined),
      )
      for (const k of nets) {
        const st = byUid.get(r.stops![0])!
        const u = users.get(k) ?? { n: 0, at: center(rects.get(st.uid)!), floor: st.floor, uid: r.uid }
        u.n += Math.max(1, r.trains ?? 1)
        users.set(k, u)
      }
    }
    for (const [k, u] of users)
      if (u.n >= 2 && !(net.signalsIn.get(k) ?? 0))
        problems.push({ id: `trainsNoSignals:${k}`, kind: 'trainsNoSignals', floor: u.floor, at: u.at, uids: [u.uid], n: u.n })
    for (const s of net.loose) problems.push({ id: `signalOffRail:${s.uid}`, kind: 'signalOffRail', floor: s.floor, at: { x: s.x, y: s.y }, uids: [s.uid], a: s.buildingId })
  }

  return problems
}

let lastArgs: unknown[] = []
let lastResult: Problem[] = []
/** Igual que findProblems, pero reutiliza el resultado mientras el plano no cambie (lo usan el lienzo y el panel). */
export function problemsOf(
  entities: PlacedEntity[],
  conveyors: Conveyor[],
  wires: Wire[],
  floorHeight: number,
  rails: Rail[] = [],
  routes: Route[] = [],
): Problem[] {
  const args = [entities, conveyors, wires, floorHeight, rails, routes]
  if (args.every((a, i) => a === lastArgs[i])) return lastResult
  lastArgs = args
  lastResult = findProblems(entities, conveyors, wires, floorHeight, rails, routes)
  return lastResult
}

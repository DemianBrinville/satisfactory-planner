import { buildingsById, type ItemAmount } from '../data/gameData'
import { portsOf, rotate, toWorld, type PortDef, type Rotation, type Vec } from './geometry'
import { curvedPath } from './dubins'
import type { Conveyor, End, PlacedEntity } from './store'

export type RouteMode = 'curve' | 'straight'

/** Largo máximo de un tramo de cinta o tubería (7 cimientos). */
export const MAX_SEGMENT = 56
/** Largo máximo de un tramo de hipertubo antes de necesitar otro soporte (wiki). */
export const MAX_HYPER_SEGMENT = 100
/** Largo máximo del tramo según el tipo de trazado. */
export const maxSegmentOf = (buildingId: string | null | undefined) =>
  buildingId && buildingsById.get(buildingId)?.kind === 'hyper' ? MAX_HYPER_SEGMENT : MAX_SEGMENT
/** Tramo recto mínimo al salir/entrar de un puerto antes de girar. */
const STUB = 1

export interface EndInfo {
  pos: Vec
  /** dirección hacia afuera del nodo (por donde sale/entra la cinta); null en postes */
  dir: Vec | null
  port: PortDef | null
  /** postes: la dirección es un eje y la cinta puede atravesarlo en cualquiera de los dos sentidos */
  axis?: boolean
}

export function endInfo(end: End, entities: PlacedEntity[]): EndInfo | null {
  const e = entities.find((x) => x.uid === end.uid)
  if (!e) return null
  const b = buildingsById.get(e.buildingId)
  if (!b) return null
  if (end.port < 0) {
    if (e.angle === undefined) return { pos: { x: e.x, y: e.y }, dir: null, port: null }
    const a = (e.angle * Math.PI) / 180
    return { pos: { x: e.x, y: e.y }, dir: { x: Math.cos(a), y: Math.sin(a) }, port: null, axis: true }
  }
  const p = portsOf(b, e)[end.port]
  if (!p) return null
  return { pos: toWorld(b, e, e.rot, p.pos), dir: rotate(p.normal, e.rot as Rotation), port: p }
}

const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k })
const r3 = (v: number) => Math.round(v * 1000) / 1000

/**
 * Trazado "recto" como el modo Recto del juego: tramos rectos y giros de 90°,
 * saliendo y entrando de los puertos en su dirección.
 */
export function route(a: EndLike, b: EndLike, mode: RouteMode = 'curve'): Vec[] {
  if (mode === 'curve') return curveRoute(a, b)
  return straightRoute(snapAxis(a, b, true), snapAxis(b, a, false))
}

type EndLike = { pos: Vec; dir: Vec | null; axis?: boolean }

/** En un eje (poste) se elige el sentido que mira hacia el otro extremo. */
function snapAxis(e: EndLike, other: EndLike, isStart: boolean): EndLike {
  if (!e.axis || !e.dir) return e
  const toOther = { x: other.pos.x - e.pos.x, y: other.pos.y - e.pos.y }
  const dot = e.dir.x * toOther.x + e.dir.y * toOther.y
  // al inicio la cinta sale hacia el otro extremo; al final llega desde él (dir apunta hacia afuera)
  const flip = isStart ? dot < 0 : dot < 0
  return { ...e, dir: flip ? { x: -e.dir.x, y: -e.dir.y } : e.dir }
}

/** Modo por defecto del juego: recta lo más directa posible y curvas de 2 m en los extremos. */
function curveRoute(a: EndLike, b: EndLike): Vec[] {
  const heads = (e: EndLike, outward: boolean): (number | null)[] => {
    if (!e.dir) return [null]
    const th = Math.atan2(e.dir.y, e.dir.x)
    // en la llegada se viaja hacia adentro del nodo: rumbo opuesto a su dirección hacia afuera
    const main = outward ? th : th + Math.PI
    return e.axis ? [main, main + Math.PI] : [main]
  }
  let best: Vec[] | null = null
  let bestLen = Infinity
  for (const t0 of heads(a, true))
    for (const t1 of heads(b, false)) {
      const pts = curvedPath(a.pos, t0, b.pos, t1)
      const len = pathLength(pts)
      if (len < bestLen) {
        best = pts
        bestLen = len
      }
    }
  return (best ?? [a.pos, b.pos]).map((p) => ({ x: r3(p.x), y: r3(p.y) }))
}

/** Modo recto: tramos rectos y giros de 90°. */
function straightRoute(a: EndLike, b: EndLike): Vec[] {
  const s = a.dir ? add(a.pos, a.dir, STUB) : a.pos
  const t = b.dir ? add(b.pos, b.dir, STUB) : b.pos
  const pts: Vec[] = [a.pos, s]
  const horizFirst = a.dir ? a.dir.x !== 0 : Math.abs(t.x - s.x) >= Math.abs(t.y - s.y)
  const endHoriz = b.dir ? b.dir.x !== 0 : null
  if (endHoriz === null || endHoriz !== horizFirst) {
    pts.push(horizFirst ? { x: t.x, y: s.y } : { x: s.x, y: t.y })
  } else if (horizFirst) {
    const mx = (s.x + t.x) / 2
    pts.push({ x: mx, y: s.y }, { x: mx, y: t.y })
  } else {
    const my = (s.y + t.y) / 2
    pts.push({ x: s.x, y: my }, { x: t.x, y: my })
  }
  pts.push(t, b.pos)
  return simplify(pts.map((p) => ({ x: r3(p.x), y: r3(p.y) })))
}

function simplify(pts: Vec[]): Vec[] {
  const out: Vec[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue
    out.push(p)
    // quitar puntos intermedios colineales
    while (out.length >= 3) {
      const [p0, p1, p2] = out.slice(-3)
      const cross = (p1.x - p0.x) * (p2.y - p1.y) - (p1.y - p0.y) * (p2.x - p1.x)
      const dot = (p1.x - p0.x) * (p2.x - p1.x) + (p1.y - p0.y) * (p2.y - p1.y)
      if (Math.abs(cross) < 1e-6 && dot >= 0) out.splice(out.length - 2, 1)
      else break
    }
  }
  return out
}

export function pathLength(points: Vec[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return len
}

/**
 * Costo de un tramo, redondeado hacia arriba: cintas y tuberías cobran su material base cada 2 m (wiki);
 * los hipertubos, cada metro (su pieza mide 1 m en los datos del juego, mMeshLength = 100 cm).
 */
export function conveyorCost(c: Pick<Conveyor, 'buildingId' | 'points'>): ItemAmount[] {
  const b = buildingsById.get(c.buildingId)
  if (!b) return []
  const len = pathLength(c.points)
  const perMeter = b.kind === 'hyper' ? 1 : 0.5
  return b.cost.map((x) => ({ item: x.item, amount: Math.max(1, Math.ceil(x.amount * len * perMeter)) }))
}

/** Recalcula el recorrido de una cinta según la posición actual de sus extremos. */
export function reroute(c: Conveyor, entities: PlacedEntity[]): Conveyor | null {
  const a = endInfo(c.from, entities)
  const b = endInfo(c.to, entities)
  if (!a || !b) return null
  return { ...c, points: route(a, b, c.mode ?? 'curve') }
}

/** Puertos ya ocupados por alguna cinta/tubería: "uid:puerto". */
export function usedPorts(conveyors: Conveyor[]): Set<string> {
  const s = new Set<string>()
  for (const c of conveyors) {
    if (c.from.port >= 0) s.add(`${c.from.uid}:${c.from.port}`)
    if (c.to.port >= 0) s.add(`${c.to.uid}:${c.to.port}`)
  }
  return s
}

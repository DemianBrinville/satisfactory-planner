import { buildingsById } from '../data/gameData'
import { pathLength } from './conveyors'
import { toWorld, type Vec } from './geometry'
import type { PlacedEntity, Rail } from './store'
import type { Route } from './transport'

/**
 * Trenes: estaciones con andenes en fila, red de vías (grafo), señales que dividen la red en bloques
 * y horarios (lista de estaciones que el tren recorre en ciclo). Datos de la wiki:
 *  - estación y plataformas: 16 m a lo largo de la vía × 34 m de ancho; las plataformas se enganchan
 *    en fila a la estación y son posicionales: la primera atiende al primer vagón detrás de la locomotora;
 *  - locomotora y vagón: 16 m; vagón: 32 espacios o 2400 m³;
 *  - acople en cada parada: 27,08 s (todos los vagones a la vez); locomotora: 25 a 110 MW, hasta 120 km/h;
 *  - señales: hacen falta cuando dos o más trenes usan las mismas vías.
 */

export const TRAIN_STATION = 'Build_TrainStation_C'
export const isTrainStation = (id: string) => id === TRAIN_STATION
/** Plataformas que se enganchan a una estación: de carga (sólidos o fluidos) y vacías. */
export const isPlatform = (id: string) => /TrainDockingStation|TrainPlatformEmpty/.test(id)
export const isFreightPlatform = (id: string) => /TrainDockingStation/.test(id)
export const isSignal = (id: string) => /RailroadBlockSignal|RailroadPathSignal/.test(id)
export const isPathSignal = (id: string) => /RailroadPathSignal/.test(id)
/** Todo lo que lleva vía propia (la estación y sus plataformas). */
export const hasTrack = (id: string) => isTrainStation(id) || isPlatform(id)

export const CAR_LENGTH = 16
export const DOCK_TIME = 27.08
/** Tiempo extra por parada para frenar y arrancar (aproximado). */
export const STOP_EXTRA = 10
export const LOCO_MW_MIN = 25
export const LOCO_MW_MAX = 110

// ---------------- vía de estaciones y plataformas ----------------

/** Extremos de la vía de una estación o plataforma (la vía va a lo largo de los 16 m, el eje x local). */
export function trackEnds(e: PlacedEntity): [Vec, Vec] | null {
  const b = buildingsById.get(e.buildingId)
  const f = b?.footprint
  if (!b || !f) return null
  const cy = (f.minY + f.maxY) / 2
  return [toWorld(b, e, e.rot, { x: f.minX, y: cy }), toWorld(b, e, e.rot, { x: f.maxX, y: cy })]
}

const close = (a: Vec, b: Vec, tol = 0.6) => Math.hypot(a.x - b.x, a.y - b.y) < tol

export interface StationGroup {
  station: PlacedEntity
  /** plataformas en orden desde la estación: la 1 atiende al vagón 1 */
  platforms: PlacedEntity[]
}

/** Plataformas enganchadas en fila a la estación (del lado que más tenga). */
export function stationGroup(station: PlacedEntity, entities: PlacedEntity[]): StationGroup {
  const ends = trackEnds(station)
  if (!ends) return { station, platforms: [] }
  const cands = entities.filter((e) => e.floor === station.floor && isPlatform(e.buildingId))
  const walk = (start: Vec) => {
    const out: PlacedEntity[] = []
    let p = start
    for (;;) {
      const next = cands.find((c) => !out.includes(c) && trackEnds(c)?.some((q) => close(q, p)))
      if (!next) return out
      out.push(next)
      const [a, b] = trackEnds(next)!
      p = close(a, p) ? b : a
    }
  }
  const left = walk(ends[0])
  const right = walk(ends[1])
  return { station, platforms: right.length > left.length ? right : left }
}

/** Nombre de una estación: el que le puso el jugador o "Estación N" por orden de colocación. */
export function stationName(e: PlacedEntity, entities: PlacedEntity[], fallback: (n: number) => string): string {
  if (e.name) return e.name
  const i = entities.filter((x) => isTrainStation(x.buildingId)).indexOf(e)
  return fallback(i + 1)
}

// ---------------- red de vías ----------------

const keyOf = (floor: number, p: Vec) => `${floor}:${Math.round(p.x * 5)},${Math.round(p.y * 5)}`

interface Edge {
  to: string
  len: number
}

export interface RailNet {
  adj: Map<string, Edge[]>
  /** red (sin contar señales) a la que pertenece cada nodo */
  netOf: Map<string, number>
  /** cantidad de señales por red */
  signalsIn: Map<number, number>
  /** señales que no están sobre ninguna vía */
  loose: PlacedEntity[]
}

const stationKey = (uid: string) => `st:${uid}`

/** Distancia de un punto a una polilínea. */
function distToPath(p: Vec, pts: Vec[]) {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t))
  }
  return best
}

/** Grafo de la red: extremos de vías, estaciones y plataformas (con un nodo en el centro de cada estación). */
export function buildRailNet(entities: PlacedEntity[], rails: Rail[]): RailNet {
  const adj = new Map<string, Edge[]>()
  const link = (a: string, b: string, len: number) => {
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push({ to: b, len })
    adj.get(b)!.push({ to: a, len })
  }
  for (const r of rails) {
    if (r.points.length < 2) continue
    link(keyOf(r.floor, r.points[0]), keyOf(r.floor, r.points[r.points.length - 1]), pathLength(r.points))
  }
  for (const e of entities) {
    if (!hasTrack(e.buildingId)) continue
    const ends = trackEnds(e)
    if (!ends) continue
    const [a, b] = ends.map((p) => keyOf(e.floor, p))
    const half = Math.hypot(ends[1].x - ends[0].x, ends[1].y - ends[0].y) / 2
    link(a, stationKey(e.uid), half)
    link(stationKey(e.uid), b, half)
  }
  // redes conectadas
  const netOf = new Map<string, number>()
  let n = 0
  for (const k of adj.keys()) {
    if (netOf.has(k)) continue
    const stack = [k]
    netOf.set(k, n)
    while (stack.length) for (const ed of adj.get(stack.pop()!)!) if (!netOf.has(ed.to)) netOf.set(ed.to, n), stack.push(ed.to)
    n++
  }
  // señales: sobre qué vía están
  const signalsIn = new Map<number, number>()
  const loose: PlacedEntity[] = []
  for (const s of entities) {
    if (!isSignal(s.buildingId)) continue
    const r = rails.find((x) => x.floor === s.floor && distToPath(s, x.points) < 1.5)
    if (!r) {
      loose.push(s)
      continue
    }
    const net = netOf.get(keyOf(r.floor, r.points[0]))!
    signalsIn.set(net, (signalsIn.get(net) ?? 0) + 1)
  }
  return { adj, netOf, signalsIn, loose }
}

/** Distancia más corta por las vías entre dos estaciones (o plataformas); null si no están unidas. */
export function railDistance(net: RailNet, from: string, to: string): number | null {
  const a = stationKey(from)
  const b = stationKey(to)
  if (!net.adj.has(a) || !net.adj.has(b)) return null
  if (a === b) return 0
  const dist = new Map<string, number>([[a, 0]])
  const done = new Set<string>()
  // Dijkstra simple (las redes de un plano tienen pocos nodos)
  for (;;) {
    let cur: string | null = null
    let best = Infinity
    for (const [k, d] of dist) if (!done.has(k) && d < best) (best = d), (cur = k)
    if (cur === null) return null
    if (cur === b) return best
    done.add(cur)
    for (const ed of net.adj.get(cur)!) {
      const d = best + ed.len
      if (d < (dist.get(ed.to) ?? Infinity)) dist.set(ed.to, d)
    }
  }
}

export const netOfStation = (net: RailNet, uid: string) => net.netOf.get(stationKey(uid))

// ---------------- horarios ----------------

/** ¿Es un tren con horario (paradas en estaciones de tren)? */
export const isTimetable = (r: Route) => r.kind === 'train' && !!r.stops && r.stops.length >= 2

export interface Leg {
  from: string
  to: string
  /** metros por las vías; null si no hay vía que las una */
  dist: number | null
}

/** Tramos del horario (de cada parada a la siguiente, y de la última a la primera). */
export function legsOf(r: Route, net: RailNet): Leg[] {
  const stops = r.stops ?? []
  return stops.map((s, i) => {
    const t = stops[(i + 1) % stops.length]
    return { from: s, to: t, dist: railDistance(net, s, t) }
  })
}

/** Velocidad promedio por defecto de un tren (km/h): la máxima es 120, con frenadas y curvas. */
export const TRAIN_SPEED = 90

/** Duración de una vuelta completa del horario (s): recorrido por las vías y acople en cada parada. */
export function cycleTime(r: Route, net: RailNet, entities: PlacedEntity[]): number {
  const v = ((r.speed ?? TRAIN_SPEED) * 1000) / 3600
  let dist = 0
  for (const l of legsOf(r, net)) {
    if (l.dist !== null) dist += l.dist
    else {
      // sin vía: línea recta con un 20 % más, para no dejar el cálculo en cero (se avisa como problema)
      const a = entities.find((e) => e.uid === l.from)
      const b = entities.find((e) => e.uid === l.to)
      if (a && b) dist += Math.hypot(a.x - b.x, a.y - b.y) * 1.2
    }
  }
  return dist / v + (r.stops?.length ?? 0) * (DOCK_TIME + STOP_EXTRA)
}

/**
 * Aristas virtuales de un tren con horario, para el cálculo de flujos: cada vagón carga en las plataformas
 * en modo carga de su posición y descarga en las siguientes en modo descarga. Cada arista lleva un vagón
 * por tren y por vuelta (con los trenes que hacen el mismo horario).
 */
export function expandTimetable(r: Route, net: RailNet, entities: PlacedEntity[]): Route[] {
  const stops = r.stops ?? []
  const groups = stops.map((uid) => {
    const e = entities.find((x) => x.uid === uid)
    return e ? stationGroup(e, entities).platforms : []
  })
  const cycle = cycleTime(r, net, entities)
  const out: Route[] = []
  const wagons = Math.max(1, r.count ?? 1)
  for (let w = 0; w < wagons; w++) {
    for (let i = 0; i < stops.length; i++) {
      const p = groups[i][w]
      if (!p || !isFreightPlatform(p.buildingId) || (p.platformMode ?? 'load') !== 'load') continue
      // descarga en las paradas siguientes hasta volver a cargar en esta misma posición
      for (let k = 1; k < stops.length; k++) {
        const q = groups[(i + k) % stops.length][w]
        if (!q || !isFreightPlatform(q.buildingId)) continue
        if ((q.platformMode ?? 'load') === 'load') break
        out.push({ uid: `${r.uid}#${w}#${i}#${k}`, kind: 'train', from: p.uid, to: q.uid, count: Math.max(1, r.trains ?? 1), cycle })
      }
    }
  }
  return out
}

/** Reemplaza los trenes con horario por sus aristas por vagón (el resto de las rutas queda igual). */
export function flowRoutes(routes: Route[], entities: PlacedEntity[], rails: Rail[]): Route[] {
  if (!routes.some((r) => r.kind === 'train')) return routes
  const net = buildRailNet(entities, rails)
  return routes.flatMap((r) => {
    if (isTimetable(r)) return expandTimetable(r, net, entities)
    // tren entre dos plataformas (sin horario): si están unidas por vías, la distancia sale de ahí
    if (r.kind === 'train' && !r.distance && !r.waypoints?.length) {
      const d = railDistance(net, r.from, r.to)
      if (d) return [{ ...r, distance: d }]
    }
    return [r]
  })
}

/** Lo que mueve un tren con horario, sumando sus aristas por vagón: ítem → [flujo, capacidad] por minuto. */
export function timetableFlows(
  edges: Map<string, { flow: Map<string, number> }>,
  capOf: (virtual: Route, item: string) => number,
  virtual: Route[],
): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>()
  for (const v of virtual) {
    const e = edges.get(v.uid)
    if (!e) continue
    for (const [item, f] of e.flow) {
      if (item === '*') continue
      const cur = out.get(item) ?? [0, 0]
      out.set(item, [cur[0] + f, cur[1] + capOf(v, item)])
    }
  }
  return out
}

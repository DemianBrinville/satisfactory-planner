import { FOUNDATION, type Rect, type Vec } from './geometry'
import { entityRect, layerOf, type PlacedEntity } from './store'

/** Lado de la superficie: de a hasta b, con su largo y hacia dónde queda afuera (para poner la medida). */
export interface AreaEdge {
  a: Vec
  b: Vec
  len: number
  out: Vec
}

export interface FoundationArea {
  uids: string[]
  /** cantidad de piezas por tipo de cimiento */
  byType: Map<string, number>
  /** m² cubiertos */
  area: number
  bbox: Rect
  /** la superficie es un rectángulo lleno */
  rect: boolean
  edges: AreaEdge[]
}

const EPS = 0.01
const isBase = (e: PlacedEntity) => layerOf(e.buildingId) === 'base'

/** Dos rectángulos se tocan por un lado (no solo por una esquina) o se superponen. */
const touch = (a: Rect, b: Rect) => {
  const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return (ox > EPS && oy > -EPS) || (oy > EPS && ox > -EPS)
}

let lastKey = ''
let lastEntities: PlacedEntity[] | null = null
let lastResult: FoundationArea | null = null

/** Superficie de cimientos contiguos (de cualquier forma) a la que pertenece un cimiento, en su mismo piso. */
export function foundationArea(seed: PlacedEntity, entities: PlacedEntity[]): FoundationArea | null {
  if (!isBase(seed)) return null
  // si el cimiento ya estaba en la última superficie calculada, se reutiliza
  if (lastEntities === entities && lastResult?.uids.includes(seed.uid) && lastKey === String(seed.floor)) return lastResult

  const rects = new Map<string, Rect>()
  const grid = new Map<string, string[]>()
  for (const e of entities) {
    if (e.floor !== seed.floor || !isBase(e)) continue
    const r = entityRect(e)
    if (!r) continue
    rects.set(e.uid, r)
    for (let gx = Math.floor(r.x0 / 16); gx <= Math.floor(r.x1 / 16); gx++)
      for (let gy = Math.floor(r.y0 / 16); gy <= Math.floor(r.y1 / 16); gy++) {
        const k = `${gx},${gy}`
        const list = grid.get(k)
        if (list) list.push(e.uid)
        else grid.set(k, [e.uid])
      }
  }
  if (!rects.has(seed.uid)) return null

  // piezas que se tocan por un lado, a partir del cimiento de partida
  const seen = new Set([seed.uid])
  const queue = [seed.uid]
  while (queue.length) {
    const uid = queue.pop()!
    const r = rects.get(uid)!
    const near = new Set<string>()
    for (let gx = Math.floor(r.x0 / 16); gx <= Math.floor(r.x1 / 16); gx++)
      for (let gy = Math.floor(r.y0 / 16); gy <= Math.floor(r.y1 / 16); gy++) for (const u of grid.get(`${gx},${gy}`) ?? []) near.add(u)
    for (const u of near) {
      if (seen.has(u) || !touch(r, rects.get(u)!)) continue
      seen.add(u)
      queue.push(u)
    }
  }

  const uids = [...seen]
  const byId = new Map(entities.map((e) => [e.uid, e]))
  const byType = new Map<string, number>()
  for (const u of uids) {
    const id = byId.get(u)!.buildingId
    byType.set(id, (byType.get(id) ?? 0) + 1)
  }

  // cuadrícula comprimida con los bordes de todas las piezas: celdas cubiertas y contorno
  const rs = uids.map((u) => rects.get(u)!)
  const round = (v: number) => Math.round(v * 100) / 100
  const xs = [...new Set(rs.flatMap((r) => [round(r.x0), round(r.x1)]))].sort((a, b) => a - b)
  const ys = [...new Set(rs.flatMap((r) => [round(r.y0), round(r.y1)]))].sort((a, b) => a - b)
  const nx = xs.length - 1
  const ny = ys.length - 1
  const cov = new Uint8Array(nx * ny)
  const xi = new Map(xs.map((v, i) => [v, i]))
  const yi = new Map(ys.map((v, i) => [v, i]))
  for (const r of rs) {
    const i0 = xi.get(round(r.x0))!
    const i1 = xi.get(round(r.x1))!
    const j0 = yi.get(round(r.y0))!
    const j1 = yi.get(round(r.y1))!
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) cov[j * nx + i] = 1
  }
  const at = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && cov[j * nx + i] === 1
  let area = 0
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (at(i, j)) area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
  const bbox = { x0: xs[0], y0: ys[0], x1: xs[nx], y1: ys[ny] }
  const rect = Math.abs(area - (bbox.x1 - bbox.x0) * (bbox.y1 - bbox.y0)) < 0.5

  // lados: tramos de borde entre una celda cubierta y una vacía, unidos cuando siguen en línea
  const edges: AreaEdge[] = []
  const merge = (runs: Map<string, { line: number; from: number; to: number; out: number }[]>, horizontal: boolean) => {
    for (const list of runs.values()) {
      list.sort((a, b) => a.from - b.from)
      let cur: (typeof list)[number] | null = null
      const flush = () => {
        if (!cur) return
        const len = cur.to - cur.from
        edges.push(
          horizontal
            ? { a: { x: cur.from, y: cur.line }, b: { x: cur.to, y: cur.line }, len, out: { x: 0, y: cur.out } }
            : { a: { x: cur.line, y: cur.from }, b: { x: cur.line, y: cur.to }, len, out: { x: cur.out, y: 0 } },
        )
      }
      for (const s of list) {
        if (cur && Math.abs(cur.to - s.from) < EPS) cur.to = s.to
        else {
          flush()
          cur = { ...s }
        }
      }
      flush()
    }
  }
  const hRuns = new Map<string, { line: number; from: number; to: number; out: number }[]>()
  const vRuns = new Map<string, { line: number; from: number; to: number; out: number }[]>()
  const push = (m: typeof hRuns, key: string, v: { line: number; from: number; to: number; out: number }) => {
    const l = m.get(key)
    if (l) l.push(v)
    else m.set(key, [v])
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!at(i, j)) continue
      if (!at(i, j - 1)) push(hRuns, `${ys[j]}:-1`, { line: ys[j], from: xs[i], to: xs[i + 1], out: -1 })
      if (!at(i, j + 1)) push(hRuns, `${ys[j + 1]}:1`, { line: ys[j + 1], from: xs[i], to: xs[i + 1], out: 1 })
      if (!at(i - 1, j)) push(vRuns, `${xs[i]}:-1`, { line: xs[i], from: ys[j], to: ys[j + 1], out: -1 })
      if (!at(i + 1, j)) push(vRuns, `${xs[i + 1]}:1`, { line: xs[i + 1], from: ys[j], to: ys[j + 1], out: 1 })
    }
  merge(hRuns, true)
  merge(vRuns, false)

  lastEntities = entities
  lastKey = String(seed.floor)
  lastResult = { uids, byType, area, bbox, rect, edges }
  return lastResult
}

/** Medida en cimientos (8 m), con un decimal si no es entera. */
export const inFoundations = (m: number) => Math.round((m / FOUNDATION) * 10) / 10

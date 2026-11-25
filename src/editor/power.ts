import { buildingsById, type Building, type ItemAmount } from '../data/gameData'
import { PURITY_MULT, somersloopBoost, type FlowResult } from './flow'
import { worldRect } from './geometry'
import { DEFAULT_FLOOR_HEIGHT, type PlacedEntity, type Wire } from './store'

/**
 * Red eléctrica: líneas entre estructuras, límite de conexiones por poste, largo máximo de cada
 * línea y balance de consumo contra generación en cada red conectada.
 */

export const POWER_LINE = 'Build_PowerLine_C'
/** Largo máximo de una línea (m): 100, o 300 entre dos torres de energía. */
export const WIRE_MAX = 100
export const WIRE_MAX_TOWERS = 300
/** El cable cuesta 1 unidad base cada 25 m (mLengthPerCost del juego). */
const METERS_PER_COST = 25

const isTower = (id: string) => /PowerTower/.test(id)

export function hasPowerConnection(b: Building): boolean {
  return (
    b.powerMW > 0 ||
    b.powerGenMW > 0 ||
    b.kind === 'generator' ||
    /PowerPole|PowerTower|PowerSwitch|PowerStorage|AlienPower/.test(b.id)
  )
}

/** Cantidad de conexiones de energía que admite cada estructura. */
export function connectionsOf(b: Building): number {
  const mk = Number(b.id.match(/Mk(\d)/)?.[1] ?? 1)
  const perTier = [4, 7, 10][mk - 1] ?? 4
  if (/PowerPoleWallDouble/.test(b.id)) return perTier * 2
  if (/PowerPole/.test(b.id)) return perTier
  if (isTower(b.id)) return 3
  if (/PowerSwitch|PowerStorage/.test(b.id)) return 2
  return 1
}

/** Punto de anclaje de la línea: el centro de la estructura. */
export function wirePoint(e: PlacedEntity) {
  const b = buildingsById.get(e.buildingId)
  if (!b) return { x: e.x, y: e.y }
  const r = worldRect(b, e, e.rot)
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }
}

export function wireLength(a: PlacedEntity, b: PlacedEntity, floorHeight = DEFAULT_FLOOR_HEIGHT) {
  const p = wirePoint(a)
  const q = wirePoint(b)
  return Math.hypot(p.x - q.x, p.y - q.y, (a.floor - b.floor) * floorHeight)
}

export const wireMax = (a: PlacedEntity, b: PlacedEntity) => (isTower(a.buildingId) && isTower(b.buildingId) ? WIRE_MAX_TOWERS : WIRE_MAX)

export function wireCost(len: number): ItemAmount[] {
  const b = buildingsById.get(POWER_LINE)
  if (!b) return []
  const units = Math.max(1, Math.ceil(len / METERS_PER_COST))
  return b.cost.map((c) => ({ item: c.item, amount: c.amount * units }))
}

/** Consumo de una estructura al reloj elegido (exponente del juego ~1,32) y con somersloops. */
export function consumptionMW(e: PlacedEntity, b: Building): number {
  const clock = e.clock ?? 1
  const boost = somersloopBoost(e, b)
  return b.powerMW * Math.pow(clock, 1.321928) * Math.pow(1 + boost, 2)
}


/** Generación real: si tiene combustible modelado se usa lo que le llega; si no, la capacidad al reloj elegido. */
export function generationMW(e: PlacedEntity, b: Building, flows?: FlowResult): number {
  if (/GeoThermal/.test(b.id)) return 200 * PURITY_MULT[e.purity ?? 'normal'] // promedio de un géiser
  if (b.powerGenMW <= 0) return 0
  const node = flows?.nodes.get(e.uid)
  if (e.resource && node) return b.powerGenMW * node.effective
  return b.powerGenMW * (e.clock ?? 1)
}

export interface Grid {
  id: number
  members: string[]
  consumption: number
  generation: number
}

export interface PowerResult {
  gridOf: Map<string, number>
  grids: Grid[]
  /** conexiones usadas por estructura */
  used: Map<string, number>
}

export function computeGrids(entities: PlacedEntity[], wires: Wire[], flows?: FlowResult): PowerResult {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r)
    return r
  }
  const powered = entities.filter((e) => {
    const b = buildingsById.get(e.buildingId)
    return b && hasPowerConnection(b)
  })
  for (const e of powered) parent.set(e.uid, e.uid)
  const used = new Map<string, number>()
  for (const w of wires) {
    if (!parent.has(w.from) || !parent.has(w.to)) continue
    parent.set(find(w.from), find(w.to))
    used.set(w.from, (used.get(w.from) ?? 0) + 1)
    used.set(w.to, (used.get(w.to) ?? 0) + 1)
  }
  const byRoot = new Map<string, Grid>()
  const gridOf = new Map<string, number>()
  let next = 1
  for (const e of powered) {
    if (!used.has(e.uid)) continue // sin líneas: no pertenece a ninguna red
    const root = find(e.uid)
    if (!byRoot.has(root)) byRoot.set(root, { id: next++, members: [], consumption: 0, generation: 0 })
    const g = byRoot.get(root)!
    const b = buildingsById.get(e.buildingId)!
    g.members.push(e.uid)
    g.consumption += consumptionMW(e, b)
    g.generation += generationMW(e, b, flows)
    gridOf.set(e.uid, g.id)
  }
  return { gridOf, grids: [...byRoot.values()], used }
}

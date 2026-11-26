import { buildingsById, type ItemAmount } from '../data/gameData'
import { conveyorCost, pathLength } from './conveyors'
import { HYPER_PASSTHROUGH, isVerticalConnector } from './geometry'
import { POWER_LINE, consumptionMW, generationMW, wireCost, wireLength } from './power'
import { DEFAULT_FLOOR_HEIGHT, type Conveyor, type PlacedEntity, type Rail, type Wire } from './store'
import { RAIL, railCost } from './transport'

/** Metros que sube/baja un conector vertical. */
export const connectorHeight = (e: PlacedEntity, floorHeight = DEFAULT_FLOOR_HEIGHT) =>
  Math.abs((e.topFloor ?? e.floor + 1) - e.floor) * floorHeight

/** Costo de una estructura; las elevadoras cuestan su base por cada 2 m (altura redondeada a par, wiki). */
export function entityCost(e: PlacedEntity, floorHeight = DEFAULT_FLOOR_HEIGHT): ItemAmount[] {
  const b = buildingsById.get(e.buildingId)
  if (!b) return []
  if (b.kind === 'lift') {
    const h = connectorHeight(e, floorHeight)
    const units = Math.ceil(h / 2)
    return b.cost.map((c) => ({ item: c.item, amount: c.amount * units }))
  }
  if (isVerticalConnector(b.id)) {
    // pase por el suelo: el agujero en cada piso atravesado + el tramo vertical de tubería o hipertubo
    const floors = Math.abs((e.topFloor ?? e.floor + 1) - e.floor)
    const tube = e.buildingId === HYPER_PASSTHROUGH ? 'Build_PipeHyper_C' : 'Build_Pipeline_C'
    const pipe = conveyorCost({ buildingId: tube, points: [{ x: 0, y: 0 }, { x: 0, y: connectorHeight(e, floorHeight) }] })
    return [...b.cost.map((c) => ({ item: c.item, amount: c.amount * floors })), ...pipe]
  }
  return b.cost
}

export interface SelectionSummary {
  /** cantidad de cada edificio (cintas/tuberías: cantidad de tramos) */
  counts: { buildingId: string; count: number; meters?: number }[]
  /** materiales totales para construir */
  materials: ItemAmount[]
  powerMW: number
  powerGenMW: number
}

export function summarize(
  entities: PlacedEntity[],
  conveyors: Conveyor[] = [],
  floorHeight = DEFAULT_FLOOR_HEIGHT,
  wires: Wire[] = [],
  allEntities: PlacedEntity[] = entities,
  rails: Rail[] = [],
): SelectionSummary {
  const counts = new Map<string, { count: number; meters: number }>()
  const mats = new Map<string, number>()
  let powerMW = 0
  let powerGenMW = 0
  const bump = (id: string, meters = 0) => {
    const c = counts.get(id) ?? { count: 0, meters: 0 }
    counts.set(id, { count: c.count + 1, meters: c.meters + meters })
  }
  for (const e of entities) {
    const b = buildingsById.get(e.buildingId)
    if (!b) continue
    bump(b.id)
    for (const c of entityCost(e, floorHeight)) mats.set(c.item, (mats.get(c.item) ?? 0) + c.amount)
    // consumo con reloj: el juego usa exponente ~1,321928 (overclock cuesta más que lineal)
    powerMW += consumptionMW(e, b)
    // generación a su reloj (géiseres por pureza, amplificador alienígena 500 MW)
    powerGenMW += generationMW(e, b)
  }
  for (const c of conveyors) {
    bump(c.buildingId, pathLength(c.points))
    for (const x of conveyorCost(c)) mats.set(x.item, (mats.get(x.item) ?? 0) + x.amount)
  }
  for (const r of rails) {
    const len = pathLength(r.points)
    bump(RAIL, len)
    for (const x of railCost(len)) mats.set(x.item, (mats.get(x.item) ?? 0) + x.amount)
  }
  for (const w of wires) {
    const a = allEntities.find((e) => e.uid === w.from)
    const b = allEntities.find((e) => e.uid === w.to)
    if (!a || !b) continue
    const len = wireLength(a, b, floorHeight)
    bump(POWER_LINE, len)
    for (const x of wireCost(len)) mats.set(x.item, (mats.get(x.item) ?? 0) + x.amount)
  }
  return {
    counts: [...counts]
      .map(([buildingId, v]) => ({ buildingId, count: v.count, meters: v.meters || undefined }))
      .sort((a, b) => b.count - a.count),
    materials: [...mats].map(([item, amount]) => ({ item, amount })).sort((a, b) => b.amount - a.amount),
    powerMW,
    powerGenMW,
  }
}

import { buildingsById, type ItemAmount } from '../data/gameData'
import { conveyorCost, pathLength } from './conveyors'
import type { Conveyor, PlacedEntity } from './store'

export interface SelectionSummary {
  /** cantidad de cada edificio (cintas/tuberías: cantidad de tramos) */
  counts: { buildingId: string; count: number; meters?: number }[]
  /** materiales totales para construir */
  materials: ItemAmount[]
  powerMW: number
  powerGenMW: number
}

export function summarize(entities: PlacedEntity[], conveyors: Conveyor[] = []): SelectionSummary {
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
    for (const c of b.cost) mats.set(c.item, (mats.get(c.item) ?? 0) + c.amount)
    const clock = e.clock ?? 1
    // consumo con reloj: el juego usa exponente ~1,321928 (overclock cuesta más que lineal)
    powerMW += b.powerMW * Math.pow(clock, 1.321928)
    powerGenMW += b.powerGenMW * clock
  }
  for (const c of conveyors) {
    bump(c.buildingId, pathLength(c.points))
    for (const x of conveyorCost(c)) mats.set(x.item, (mats.get(x.item) ?? 0) + x.amount)
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

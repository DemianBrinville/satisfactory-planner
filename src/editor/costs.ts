import { buildingsById, type ItemAmount } from '../data/gameData'
import type { PlacedEntity } from './store'

export interface SelectionSummary {
  /** cantidad de cada edificio */
  counts: { buildingId: string; count: number }[]
  /** materiales totales para construir */
  materials: ItemAmount[]
  powerMW: number
  powerGenMW: number
}

export function summarize(entities: PlacedEntity[]): SelectionSummary {
  const counts = new Map<string, number>()
  const mats = new Map<string, number>()
  let powerMW = 0
  let powerGenMW = 0
  for (const e of entities) {
    const b = buildingsById.get(e.buildingId)
    if (!b) continue
    counts.set(b.id, (counts.get(b.id) ?? 0) + 1)
    for (const c of b.cost) mats.set(c.item, (mats.get(c.item) ?? 0) + c.amount)
    powerMW += b.powerMW
    powerGenMW += b.powerGenMW
  }
  return {
    counts: [...counts].map(([buildingId, count]) => ({ buildingId, count })).sort((a, b) => b.count - a.count),
    materials: [...mats].map(([item, amount]) => ({ item, amount })).sort((a, b) => b.amount - a.amount),
    powerMW,
    powerGenMW,
  }
}

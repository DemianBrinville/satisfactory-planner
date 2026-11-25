import { buildingsById, game } from '../data/gameData'
import type { FlowResult } from './flow'
import { DEFAULT_FLOOR_HEIGHT, type Conveyor, type PlacedEntity } from './store'

/**
 * Altura de bombeo (head lift): hasta qué altura puede subir un líquido por una tubería.
 * Solo importa la diferencia de altura (wiki). Los gases no la necesitan.
 *  - Extractores y máquinas que sacan líquido: 10 m.
 *  - Bomba Mk.1: 20 m (recomendado; el juego llega a 22). Bomba Mk.2: 50 m (55 real).
 */
const SOURCE_HEAD = 10
const PUMP_HEAD: Record<string, number> = { Build_PipelinePump_C: 20, Build_PipelinePumpMk2_C: 50 }

export interface HeadIssue {
  /** altura (m, sobre el piso 0) a la que tiene que llegar el líquido */
  needed: number
  /** altura máxima que alcanza con lo que tiene antes */
  reach: number
}

const isGasEdge = (flows: FlowResult | undefined, c: Conveyor) => {
  const f = flows?.edges.get(c.uid)
  const items = f ? [...f.offer.keys()] : []
  return items.length > 0 && items.every((i) => game.items[i]?.form === 'gas')
}

export function computeHeadLift(
  entities: PlacedEntity[],
  conveyors: Conveyor[],
  floorHeight = DEFAULT_FLOOR_HEIGHT,
  flows?: FlowResult,
): Map<string, HeadIssue> {
  const pipes = conveyors.filter((c) => buildingsById.get(c.buildingId)?.kind === 'pipe')
  const byUid = new Map(entities.map((e) => [e.uid, e]))
  const elev = (c: Conveyor) => c.floor * floorHeight
  /** altura máxima alcanzable por la salida de cada nodo */
  const reach = new Map<string, number>()
  const issues = new Map<string, HeadIssue>()

  // fuentes
  for (const e of entities) {
    const b = buildingsById.get(e.buildingId)
    if (!b) continue
    const base = e.floor * floorHeight
    if (PUMP_HEAD[b.id] !== undefined) reach.set(e.uid, base + PUMP_HEAD[b.id])
    else if (b.kind === 'extractor' || b.kind === 'machine' || /TrainDockingStationLiquid|FluidTruck/.test(b.id))
      reach.set(e.uid, base + SOURCE_HEAD)
  }

  const edgeReach = new Map<string, number>()
  for (let iter = 0; iter < 30; iter++) {
    let changed = false
    for (const c of pipes) {
      const r = reach.get(c.from.uid)
      if (r === undefined) continue
      if ((edgeReach.get(c.uid) ?? -Infinity) < r) {
        edgeReach.set(c.uid, r)
        changed = true
      }
      // nodos de paso (uniones, válvulas, pases de piso, depósitos) conservan la altura alcanzable
      const to = byUid.get(c.to.uid)
      const tb = to && buildingsById.get(to.buildingId)
      if (!to || !tb || PUMP_HEAD[tb.id] !== undefined) continue
      if (tb.kind === 'machine' || tb.kind === 'generator') continue
      if ((reach.get(to.uid) ?? -Infinity) < r) {
        reach.set(to.uid, r)
        changed = true
      }
    }
    if (!changed) break
  }

  for (const c of pipes) {
    const r = edgeReach.get(c.uid)
    if (r === undefined || isGasEdge(flows, c)) continue
    // el líquido tiene que llegar al nivel de la tubería (≈1,8 m sobre el piso, como los soportes)
    const needed = elev(c) + 1.8
    if (needed > r + 1e-6) issues.set(c.uid, { needed, reach: r })
  }
  return issues
}

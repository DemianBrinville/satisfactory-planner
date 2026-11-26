import { buildingsById, game } from '../data/gameData'
import i18n from '../i18n'
import { MINER_RESOURCES, PURITY_MULT } from './flow'
import type { Vec } from './geometry'
import { isBuildingIdAvailable } from './progress'
import { newUid, type PlacedEntity } from './store'
import { anchorOnSpot, spotKindFor, spotsInPlan, spotUnder, type MapPlacement, type PlanSpot } from './worldMap'

/** Extractores por recurso, del más barato al mejor. */
const TIERS: Record<string, string[]> = {
  Desc_LiquidOil_C: ['Build_OilPump_C'],
}
const MINER_TIERS = ['Build_MinerMk1_C', 'Build_MinerMk2_C', 'Build_MinerMk3_C']
const tiersFor = (item: string) => (TIERS[item] ?? (MINER_RESOURCES.includes(item) ? MINER_TIERS : [])).filter((id) => buildingsById.has(id))

export interface NodeMiners {
  entities: PlacedEntity[]
  /** materias primas que quedaron cubiertas (total o parcialmente) por taladros en yacimientos */
  handled: Set<string>
  notes: string[]
}

/**
 * Ubica los taladros y extractores de petróleo de la calculadora sobre yacimientos reales del mapa: para cada
 * materia prima, los yacimientos libres más cercanos al bloque. En cada uno, la marca más barata que cubre lo que
 * falta (con la pureza del yacimiento); si ninguna alcanza, la mejor al 100 % y se sigue con el siguiente.
 * El agua y los pozos quedan como siempre (no dependen de un yacimiento suelto).
 */
export function minersOnNodes(raw: Map<string, number>, map: MapPlacement, floor: number, near: Vec, existing: PlacedEntity[]): NodeMiners {
  const entities: PlacedEntity[] = []
  const handled = new Set<string>()
  const notes: string[] = []
  // yacimientos que ya tienen un extractor en el plano
  const taken = new Set<string>()
  for (const e of existing) {
    const b = buildingsById.get(e.buildingId)
    if (!b || !spotKindFor(b)) continue
    const s = spotUnder(e, b, map)
    if (s) taken.add(s.id)
  }
  const spots = spotsInPlan(map)
  const score = (s: PlanSpot) => Math.hypot(s.px - near.x, s.py - near.y) / Math.sqrt(PURITY_MULT[s.purity ?? 'normal'])
  for (const [item, rate] of raw) {
    const tiers = tiersFor(item).filter(isBuildingIdAvailable)
    if (!tiers.length || rate <= 1e-6) continue
    const cands = spots
      .filter((s) => s.kind === 'node' && s.resource === item && !taken.has(s.id))
      // cerca, pero valorando la pureza: un yacimiento puro "cuenta" como 1,4 veces más cerca y uno impuro, más lejos
      .sort((a, b) => score(a) - score(b))
    let left = rate
    const used: PlanSpot[] = []
    for (const s of cands) {
      if (left <= 1e-6) break
      const mult = PURITY_MULT[s.purity ?? 'normal']
      const cap = (id: string) => (buildingsById.get(id)!.extractPerMinute ?? 60) * mult
      const id = tiers.find((t) => cap(t) >= left - 1e-6) ?? tiers[tiers.length - 1]
      const give = Math.min(left, cap(id))
      const b = buildingsById.get(id)!
      const a = anchorOnSpot(b, { x: s.px, y: s.py }, 0)
      entities.push({
        uid: newUid(),
        buildingId: id,
        x: a.x,
        y: a.y,
        rot: 0,
        floor,
        resource: item,
        purity: s.purity ?? 'normal',
        clock: Math.round((give / cap(id)) * 10000) / 10000,
      })
      taken.add(s.id)
      used.push(s)
      left -= give
    }
    if (!used.length) continue
    handled.add(item)
    const far = Math.max(...used.map((s) => Math.hypot(s.px - near.x, s.py - near.y)))
    const mine = entities.slice(-used.length)
    const list = mine.map((e) => `${buildingsById.get(e.buildingId)?.name} (${i18n.t(`purity.${e.purity ?? 'normal'}` as 'purity.pure').toLowerCase()})`).join(', ')
    notes.push(i18n.t('build.onNodes', { count: used.length, item: game.items[item]?.name, m: Math.round(far), list }))
    if (left > 1e-3) notes.push(i18n.t('build.nodesShort', { item: game.items[item]?.name, rate: Math.round(left * 10) / 10 }))
  }
  return { entities, handled, notes }
}

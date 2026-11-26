import { basePowerMW, buildingsById, isVariablePower, recipePowerRange, recipesById, usesPower, type Building, type ItemAmount } from '../data/gameData'
import { PURITY_MULT, somersloopBoost, type FlowResult } from './flow'
import { worldRect } from './geometry'
import { DEFAULT_FLOOR_HEIGHT, type PlacedEntity, type PowerSettings, type Wire } from './store'

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

/**
 * Amplificador de energía alienígena (datos del juego): genera 500 MW y aumenta un 10 % la generación de toda
 * su red; con 5 matrices de energía alienígena por minuto (cada una dura 12 s) el aumento sube 20 % más.
 * Los aumentos de varios amplificadores se suman y se aplican sobre la generación base de la red (wiki).
 */
export const AUGMENTER = 'Build_AlienPowerBuilding_C'
export const AUGMENTER_FUEL = 'Desc_AlienPowerFuel_C'
export const AUGMENTER_MW = 500
export const AUGMENTER_BOOST = 0.1
export const AUGMENTER_FUEL_BOOST = 0.2
export const AUGMENTER_FUEL_RATE = 5
export const isAugmenter = (id: string) => id === AUGMENTER

/** Batería (datos del juego): guarda 100 MWh y se carga con lo que sobra en la red, hasta 100 MW cada una; descarga sin límite. */
export const BATTERY_MWH = 100
export const BATTERY_CHARGE_MW = 100
export const isBattery = (id: string) => /PowerStorage/.test(id)

/** Consumo en el pico del ciclo: las máquinas de potencia variable llegan a su máximo; el resto, igual que siempre. */
export function peakMW(e: PlacedEntity, b: Building): number {
  const range = recipePowerRange(e.recipeId ? recipesById.get(e.recipeId) : undefined)
  if (!isVariablePower(b) || !range) return consumptionMW(e, b)
  return consumptionMW(e, b) * (range[1] / ((range[0] + range[1]) / 2 || 1))
}

/** Parte del tiempo que el amplificador tiene matriz: por cinta, lo que le llega; sin cinta, lo que marcó el jugador. */
export function augmenterFuel(e: PlacedEntity, flows?: FlowResult): number {
  const n = flows?.nodes.get(e.uid)
  if (n?.inputs.length) return Math.min(1, n.inputs[0].got / AUGMENTER_FUEL_RATE)
  return e.fueled ? 1 : 0
}
/** Aumento que aporta un amplificador a su red (0,1 a 0,3). */
export const augmenterBoost = (e: PlacedEntity, flows?: FlowResult) => AUGMENTER_BOOST + AUGMENTER_FUEL_BOOST * augmenterFuel(e, flows)

/** Estructuras que se pueden enganchar a la red del mundo (postes, tomas y torres). */
export const canLinkWorld = (b: Building) => /PowerPole|PowerTower/.test(b.id)

export function hasPowerConnection(b: Building): boolean {
  return (
    usesPower(b) ||
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

/** Consumo de una estructura al reloj elegido (exponente del juego ~1,32) y con somersloops (promedio en las de potencia variable). */
export function consumptionMW(e: PlacedEntity, b: Building): number {
  const clock = e.clock ?? 1
  const boost = somersloopBoost(e, b)
  return basePowerMW(b, e.recipeId) * Math.pow(clock, 1.321928) * Math.pow(1 + boost, 2)
}


/** Generación real: si tiene combustible modelado se usa lo que le llega; si no, la capacidad al reloj elegido. */
export function generationMW(e: PlacedEntity, b: Building, flows?: FlowResult): number {
  if (isAugmenter(b.id)) return AUGMENTER_MW
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
  /** generación sin el aumento de los amplificadores alienígenas */
  base: number
  /** aumento de los amplificadores de la red (0,1 por cada uno; 0,3 con matrices) */
  boost: number
  /** consumo si todas las máquinas de potencia variable coinciden en su pico */
  peak: number
  /** baterías conectadas */
  batteries: number
  /** está conectada a la red del mundo */
  world?: boolean
}

export interface PowerResult {
  gridOf: Map<string, number>
  grids: Grid[]
  /** conexiones usadas por estructura */
  used: Map<string, number>
  /** modo energía infinita: todo se considera alimentado */
  infinite: boolean
  /** totales del plano completo */
  planUse: number
  planGen: number
  /** lo que le sobra a la red del mundo (generación − consumo, sin este plano) */
  worldSpare: number
  /** aumento total de los amplificadores alienígenas del plano */
  planBoost: number
}

export function computeGrids(entities: PlacedEntity[], wires: Wire[], flows?: FlowResult, settings?: PowerSettings): PowerResult {
  const worldSpare = settings ? Math.max(0, settings.worldGen - settings.worldUse) : 0
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
    if (!used.has(e.uid) && !e.worldLink) continue // sin líneas: no pertenece a ninguna red
    const root = find(e.uid)
    if (!byRoot.has(root)) byRoot.set(root, { id: next++, members: [], consumption: 0, generation: 0, base: 0, boost: 0, peak: 0, batteries: 0, world: false })
    const g = byRoot.get(root)!
    const b = buildingsById.get(e.buildingId)!
    g.members.push(e.uid)
    g.consumption += consumptionMW(e, b)
    g.peak += peakMW(e, b)
    if (isBattery(b.id)) g.batteries++
    g.base += generationMW(e, b, flows)
    if (isAugmenter(b.id)) g.boost += augmenterBoost(e, flows)
    gridOf.set(e.uid, g.id)
    if (e.worldLink) g.world = true
  }
  const worldGen = settings?.worldGen ?? 0
  for (const g of byRoot.values()) {
    g.generation = g.base * (1 + g.boost)
    // un poste enganchado a la red del mundo aporta lo que le sobra a esa red; los amplificadores también
    // aumentan la generación del mundo, porque pasa a ser una sola red
    if (g.world) g.generation += worldSpare + worldGen * g.boost
  }
  let planUse = 0
  let planBase = 0
  let planBoost = 0
  for (const e of powered) {
    const b = buildingsById.get(e.buildingId)!
    planUse += consumptionMW(e, b)
    planBase += generationMW(e, b, flows)
    if (isAugmenter(b.id)) planBoost += augmenterBoost(e, flows)
  }
  // totales del plano: con energía infinita se supone todo en una red (la del mundo incluida)
  const worldBoost = settings?.infinite ? planBoost : [...byRoot.values()].filter((g) => g.world).reduce((a, g) => a + g.boost, 0)
  const planGen = planBase * (1 + planBoost) + worldGen * worldBoost
  return { gridOf, grids: [...byRoot.values()], used, infinite: settings?.infinite ?? false, planUse, planGen, worldSpare, planBoost }
}

export interface BatteryState {
  /** MWh que guardan las baterías de la red */
  capacity: number
  /** sobra en la red: se carga a este ritmo (MW) */
  charge: number
  /** falta en la red: se descarga a este ritmo (MW) */
  drain: number
  /** horas hasta llenarse (cargando) o hasta vaciarse desde llenas (descargando) */
  hours: number | null
  /** las máquinas de potencia variable piden más que la generación en su pico (MW de diferencia) */
  peakGap: number
}

/** Estado de las baterías de una red: cuánto guardan, si se cargan o se descargan y en cuánto tiempo. */
export function batteryState(g: Grid): BatteryState {
  const capacity = g.batteries * BATTERY_MWH
  const spare = g.generation - g.consumption
  const charge = spare > 1e-6 ? Math.min(spare, g.batteries * BATTERY_CHARGE_MW) : 0
  const drain = spare < -1e-6 ? -spare : 0
  const hours = !capacity ? null : charge > 0 ? capacity / charge : drain > 0 ? capacity / drain : null
  return { capacity, charge, drain, hours, peakGap: Math.max(0, g.peak - g.generation) }
}

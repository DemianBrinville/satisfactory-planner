import { buildingsById, game, recipesById, type Building } from '../data/gameData'
import { portsOf } from './geometry'
import type { Conveyor, PlacedEntity, Purity } from './store'

/**
 * Motor de flujos.
 *  - OFERTA: lo que llega desde atrás (taladros → hornos → …), calculado hacia adelante.
 *  - DEMANDA: lo que piden las máquinas de destino, calculado hacia atrás desde el producto final
 *    (es el "ideal" de cada cinta).
 *  - FLUJO real de una cinta = min(oferta, demanda), limitado por la capacidad de la cinta.
 * Todo en unidades del juego por minuto (fluidos en m³/min).
 */

export type Rates = Map<string, number>

export interface EdgeFlow {
  offer: Rates
  demand: Rates
  flow: Rates
  capacity: number
}

export interface NodeFlow {
  /** fracción de producción que permiten las entradas (0..reloj) */
  inputLimited: number
  /** fracción de producción que aceptan las salidas (0..reloj) */
  outputLimited: number
  /** producción efectiva respecto al 100 % */
  effective: number
  /** por ítem: lo que necesita a su reloj y lo que efectivamente recibe */
  inputs: { item: string; need: number; got: number }[]
  /** por ítem: lo que podría producir y lo que se lleva la salida */
  outputs: { item: string; produce: number; taken: number }[]
}

export interface FlowResult {
  edges: Map<string, EdgeFlow>
  nodes: Map<string, NodeFlow>
}

export const PURITY_MULT: Record<Purity, number> = { impure: 0.5, normal: 1, pure: 2 }
export const PURITY_NAME: Record<Purity, string> = { impure: 'Impuro', normal: 'Normal', pure: 'Puro' }

const isFluid = (item: string) => {
  const f = game.items[item]?.form
  return f === 'liquid' || f === 'gas'
}

/** Recursos que puede extraer cada tipo de extractor. */
export const MINER_RESOURCES = [
  'Desc_OreIron_C',
  'Desc_OreCopper_C',
  'Desc_Stone_C',
  'Desc_Coal_C',
  'Desc_OreGold_C',
  'Desc_RawQuartz_C',
  'Desc_Sulfur_C',
  'Desc_OreBauxite_C',
  'Desc_OreUranium_C',
  'Desc_SAM_C',
].filter((id) => game.items[id])

export function extractorResources(b: Building): string[] {
  if (b.kind === 'miner') return MINER_RESOURCES
  if (/WaterPump/.test(b.id)) return ['Desc_Water_C']
  if (/OilPump/.test(b.id)) return ['Desc_LiquidOil_C']
  if (/Fracking/.test(b.id)) return ['Desc_Water_C', 'Desc_LiquidOil_C', 'Desc_NitrogenGas_C'].filter((i) => game.items[i])
  return []
}

/** Producción por minuto de un taladro/extractor según recurso, pureza y reloj. */
export function extractionRate(e: PlacedEntity, b: Building): number {
  const base = b.extractPerMinute ?? 0
  const purityApplies = !/WaterPump/.test(b.id)
  return base * (purityApplies ? PURITY_MULT[e.purity ?? 'normal'] : 1) * (e.clock ?? 1)
}

/** Recetas que puede usar una máquina. */
export function recipesFor(buildingId: string) {
  return game.recipes.filter((r) => r.producedIn.includes(buildingId))
}

const SINK_RE = /ResourceSink_|SpaceElevator|TradingPost|CentralStorage/
const UNLIMITED = 1e9

const addTo = (m: Rates, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
const sumRates = (m: Rates) => [...m.values()].reduce((a, b) => a + b, 0)
/** Demanda de un ítem; '*' = acepta cualquier ítem (sumideros). */
const demOf = (m: Rates | undefined, item: string) => m?.get(item) ?? m?.get('*') ?? 0

export function computeFlows(entities: PlacedEntity[], conveyors: Conveyor[]): FlowResult {
  const inEdges = new Map<string, Conveyor[]>()
  const outEdges = new Map<string, Conveyor[]>()
  for (const c of conveyors) {
    if (!inEdges.has(c.to.uid)) inEdges.set(c.to.uid, [])
    inEdges.get(c.to.uid)!.push(c)
    if (!outEdges.has(c.from.uid)) outEdges.set(c.from.uid, [])
    outEdges.get(c.from.uid)!.push(c)
  }
  const cap = new Map(
    conveyors.map((c) => {
      const b = buildingsById.get(c.buildingId)
      return [c.uid, b?.itemsPerMinute ?? b?.flowPerMinute ?? 0]
    }),
  )

  let offer = new Map<string, Rates>(conveyors.map((c) => [c.uid, new Map()]))
  let demand = new Map<string, Rates>(conveyors.map((c) => [c.uid, new Map()]))
  const nodes = new Map<string, NodeFlow>()

  const capRates = (r: Rates, c: number): Rates => {
    const total = sumRates(r)
    if (total <= c || total === 0) return r
    const k = c / total
    return new Map([...r].map(([i, v]) => [i, v * k]))
  }

  /** Reparte `amount` entre cintas según su demanda (llenado por niveles); el excedente se reparte en partes iguales. */
  const waterFill = (amount: number, edges: Conveyor[], item: string, dem: Map<string, Rates>): Map<string, number> => {
    const res = new Map<string, number>(edges.map((e) => [e.uid, 0]))
    let left = amount
    let open = edges.filter((e) => demOf(dem.get(e.uid), item) > 1e-9)
    while (left > 1e-9 && open.length) {
      const share = left / open.length
      const next: Conveyor[] = []
      for (const e of open) {
        const want = demOf(dem.get(e.uid), item) - res.get(e.uid)!
        const give = Math.min(share, want)
        res.set(e.uid, res.get(e.uid)! + give)
        left -= give
        if (want - give > 1e-9) next.push(e)
      }
      if (next.length === open.length && share * open.length <= left + 1e-9) break
      open = next
    }
    if (left > 1e-9 && edges.length) edges.forEach((e) => res.set(e.uid, res.get(e.uid)! + left / edges.length))
    return res
  }

  /** Reparte una demanda total entre las cintas de entrada según lo que ofrece cada una. */
  const splitDemand = (need: number, edges: Conveyor[], item: string, off: Map<string, Rates>): Map<string, number> => {
    const offers = edges.map((e) => off.get(e.uid)?.get(item) ?? 0)
    const total = offers.reduce((a, b) => a + b, 0)
    const res = new Map<string, number>()
    edges.forEach((e, i) => res.set(e.uid, total > 0 ? (need * offers[i]) / total : need / edges.length))
    return res
  }

  const portKindOf = (c: Conveyor) => (buildingsById.get(c.buildingId)?.kind === 'pipe' ? 'pipe' : 'belt')

  for (let iter = 0; iter < 40; iter++) {
    const nOffer = new Map<string, Rates>(conveyors.map((c) => [c.uid, new Map()]))
    const nDemand = new Map<string, Rates>(conveyors.map((c) => [c.uid, new Map()]))

    for (const e of entities) {
      const b = buildingsById.get(e.buildingId)
      if (!b) continue
      const ins = inEdges.get(e.uid) ?? []
      const outs = outEdges.get(e.uid) ?? []
      if (!ins.length && !outs.length) continue
      const clock = e.clock ?? 1

      // ofertas entrantes por ítem
      const inOffer: Rates = new Map()
      for (const c of ins) for (const [i, v] of offer.get(c.uid)!) addTo(inOffer, i, v)
      // demanda saliente por ítem (sin cintas conectadas = sin límite)
      const outDemand: Rates = new Map()
      for (const c of outs) for (const [i, v] of demand.get(c.uid)!) addTo(outDemand, i, v)

      const recipe = e.recipeId ? recipesById.get(e.recipeId) : undefined

      if (b.kind === 'miner' || b.kind === 'extractor') {
        const item = e.resource ?? extractorResources(b)[0]
        if (!item || !outs.length) continue
        const rate = extractionRate(e, b)
        const r = waterFill(rate, outs, item, demand)
        for (const c of outs) nOffer.get(c.uid)!.set(item, r.get(c.uid)!)
        const taken = Math.min(rate, demOf(outDemand, item))
        nodes.set(e.uid, {
          inputLimited: clock,
          outputLimited: rate > 0 ? (taken / rate) * clock : 0,
          effective: rate > 0 ? (taken / rate) * clock : 0,
          inputs: [],
          outputs: [{ item, produce: rate, taken }],
        })
        continue
      }

      if (recipe && (b.kind === 'machine')) {
        const perMin = 60 / recipe.duration
        // entradas limitan cuánto puede producir
        let inputLimited = clock
        for (const ing of recipe.ingredients) {
          const need = ing.amount * perMin
          inputLimited = Math.min(inputLimited, (inOffer.get(ing.item) ?? 0) / need)
        }
        // salidas: lo que acepta lo que está conectado; sin conexión de ese tipo = sin límite
        let outputLimited = clock
        for (const p of recipe.products) {
          const kind = isFluid(p.item) ? 'pipe' : 'belt'
          const connected = outs.filter((c) => portKindOf(c) === kind)
          if (!connected.length) continue
          outputLimited = Math.min(outputLimited, demOf(outDemand, p.item) / (p.amount * perMin))
        }
        for (const p of recipe.products) {
          const kind = isFluid(p.item) ? 'pipe' : 'belt'
          const connected = outs.filter((c) => portKindOf(c) === kind)
          const r = waterFill(p.amount * perMin * inputLimited, connected, p.item, demand)
          for (const c of connected) nOffer.get(c.uid)!.set(p.item, r.get(c.uid)!)
        }
        for (const ing of recipe.ingredients) {
          const kind = isFluid(ing.item) ? 'pipe' : 'belt'
          const connected = ins.filter((c) => portKindOf(c) === kind)
          const r = splitDemand(ing.amount * perMin * outputLimited, connected, ing.item, offer)
          for (const c of connected) nDemand.get(c.uid)!.set(ing.item, r.get(c.uid)!)
        }
        const effective = Math.min(inputLimited, outputLimited)
        nodes.set(e.uid, {
          inputLimited,
          outputLimited,
          effective,
          inputs: recipe.ingredients.map((ing) => ({
            item: ing.item,
            need: ing.amount * perMin * clock,
            got: Math.min(inOffer.get(ing.item) ?? 0, ing.amount * perMin * clock),
          })),
          outputs: recipe.products.map((p) => ({
            item: p.item,
            produce: p.amount * perMin * clock,
            taken: p.amount * perMin * effective,
          })),
        })
        continue
      }

      if (b.kind === 'generator' && e.resource) {
        const energy = game.items[e.resource]?.energyMJ ?? 0
        const need = energy > 0 ? ((b.powerGenMW * 60) / energy) * clock : 0
        const r = splitDemand(need, ins, e.resource, offer)
        for (const c of ins) nDemand.get(c.uid)!.set(e.resource, r.get(c.uid)!)
        const got = Math.min(inOffer.get(e.resource) ?? 0, need)
        nodes.set(e.uid, {
          inputLimited: need > 0 ? (got / need) * clock : 0,
          outputLimited: clock,
          effective: need > 0 ? (got / need) * clock : 0,
          inputs: [{ item: e.resource, need, got }],
          outputs: [],
        })
        continue
      }

      if (SINK_RE.test(b.id) || (/StorageContainer|PipeStorageTank|IndustrialTank/.test(b.id) && !outs.length)) {
        // sumideros: aceptan todo lo que llega (limitado por la cinta)
        for (const c of ins) nDemand.get(c.uid)!.set('*', UNLIMITED)
        continue
      }

      // nodos de paso: divisores, uniones, postes, soportes, bombas, válvulas, contenedores con salida
      if (ins.length || outs.length) {
        for (const [item, amount] of inOffer) {
          const r = waterFill(amount, outs, item, demand)
          for (const c of outs) nOffer.get(c.uid)!.set(item, r.get(c.uid)!)
        }
        const items = new Set([...outDemand.keys()])
        for (const item of items) {
          const r = splitDemand(outDemand.get(item)!, ins, item, offer)
          for (const c of ins) nDemand.get(c.uid)!.set(item, r.get(c.uid)!)
        }
      }
    }

    // capacidad de cada cinta
    for (const c of conveyors) {
      nOffer.set(c.uid, capRates(nOffer.get(c.uid)!, cap.get(c.uid)!))
      const d = nDemand.get(c.uid)!
      if (d.has('*')) d.set('*', cap.get(c.uid)!)
      else nDemand.set(c.uid, capRates(d, cap.get(c.uid)!))
    }
    offer = nOffer
    demand = nDemand
  }

  const edges = new Map<string, EdgeFlow>()
  for (const c of conveyors) {
    const o = offer.get(c.uid)!
    const d = demand.get(c.uid)!
    const flow: Rates = new Map()
    for (const [i, v] of o) flow.set(i, Math.min(v, demOf(d, i)))
    // un sumidero acepta lo que llegue: su demanda se muestra igual a lo ofrecido
    const dClean: Rates = d.has('*') ? new Map([...o]) : d
    edges.set(c.uid, { offer: o, demand: dClean, flow: capRates(flow, cap.get(c.uid)!), capacity: cap.get(c.uid)! })
  }
  return { edges, nodes }
}

/** Ítems por puerto de un edificio: útil para validar qué cinta va a qué puerto. */
export const portCount = (b: Building) => portsOf(b).length

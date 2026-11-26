import { buildingsById, game, recipesById, type Building } from '../data/gameData'
import { portsOf } from './geometry'
import { routeThroughput, type Route } from './transport'
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
  /** la cinta no tiene consumidor (termina suelta o en un sumidero): su ideal es la producción ideal de atrás */
  open?: boolean
  /** ideal del siguiente crafteo: lo que piden las máquinas de destino a su reloj */
  local?: Rates
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
  /** reloj que cubriría exactamente la demanda de adelante (1 = 100 %); null si la salida está abierta */
  required?: number | null
  /** ingrediente que más frena la producción (el que llega más lento respecto a lo que pide) */
  bottleneck?: string | null
  /** duración de un ciclo: la ideal al reloj elegido y la real con lo que llega (s) */
  cycle?: { ideal: number; actual: number }
}

export interface FlowResult {
  edges: Map<string, EdgeFlow>
  nodes: Map<string, NodeFlow>
}

const ROUTE_SOLID = '__route_solid'
const ROUTE_FLUID = '__route_fluid'

/** Filtros especiales de los divisores inteligentes/programables (como en el juego). */
export const FILTER_ANY = '*any'
export const FILTER_NONE = '*none'
export const FILTER_UNDEFINED = '*undefined'
export const FILTER_OVERFLOW = '*overflow'
export const FILTER_NAMES: Record<string, string> = {
  [FILTER_ANY]: 'Cualquiera',
  [FILTER_NONE]: 'Ninguno',
  [FILTER_UNDEFINED]: 'Cualquier no definido',
  [FILTER_OVERFLOW]: 'Excedente',
}

/** Aumento de producción por somersloops: 0 a 1 (= +100 % con todas las ranuras llenas). */
export function somersloopBoost(e: PlacedEntity, b: Building): number {
  const slots = b.somersloopSlots ?? 0
  if (!slots || !e.somersloops) return 0
  return Math.min(e.somersloops, slots) / slots
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

export function computeFlows(entities: PlacedEntity[], baseConveyors: Conveyor[], routes: Route[] = [], floorHeight = 8): FlowResult {
  const real = computeFlowsRaw(entities, baseConveyors, routes, floorHeight, 'real')
  // ideal del siguiente crafteo: lo que pide cada máquina de destino a su reloj, sin mirar más adelante
  const local = computeFlowsRaw(entities, baseConveyors, routes, floorHeight, 'local')
  for (const [uid, e] of real.edges) {
    const d = local.edges.get(uid)
    if (d && !d.open) e.local = new Map(d.demand)
  }
  // en las cintas abiertas (salida sin consumidor, sumideros) el ideal es lo que producirían las máquinas
  // de atrás al 100 % de su reloj: se calcula suponiendo que a todas les llega todo lo que piden
  if (![...real.edges.values()].some((e) => e.open)) return real
  const ideal = computeFlowsRaw(entities, baseConveyors, routes, floorHeight, 'supply')
  for (const [uid, e] of real.edges) {
    if (!e.open) continue
    const supply = ideal.edges.get(uid)?.offer
    if (supply) e.demand = new Map(supply)
  }
  return real
}

function computeFlowsRaw(
  entities: PlacedEntity[],
  baseConveyors: Conveyor[],
  routes: Route[],
  floorHeight: number,
  /**
   * real: cálculo normal · supply: supone que a cada máquina le llega todo lo que pide (ideal hacia adelante)
   * · local: cada máquina pide lo de su receta a su reloj sin importar lo que consume lo de adelante
   */
  mode: 'real' | 'supply' | 'local',
): FlowResult {
  // las rutas de vehículos (tren, camión, dron) son aristas virtuales entre estaciones
  const routeById = new Map(routes.map((r) => [r.uid, r]))
  const stationFluid = (uid: string) => /Liquid|FluidTruck/.test(entities.find((e) => e.uid === uid)?.buildingId ?? '')
  const conveyors: Conveyor[] = [
    ...baseConveyors,
    ...routes
      .filter((r) => entities.some((e) => e.uid === r.from) && entities.some((e) => e.uid === r.to))
      .map((r) => ({
        uid: r.uid,
        buildingId: stationFluid(r.from) ? ROUTE_FLUID : ROUTE_SOLID,
        floor: 0,
        points: [],
        from: { uid: r.from, port: -9 },
        to: { uid: r.to, port: -9 },
      })),
  ]
  /** capacidad de una arista; en las rutas depende del ítem (tamaño de pila o fluido) */
  const capOf = (uid: string, rates?: Rates) => {
    const r = routeById.get(uid)
    if (!r) return cap.get(uid)!
    const item = rates && rates.size ? [...rates].filter(([i]) => i !== '*').sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null
    return routeThroughput(r, item, entities, floorHeight)
  }
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

  /** Llena la demanda de cada cinta (por niveles) sin repartir excedente; devuelve lo que sobra. */
  const fillDemand = (amount: number, edges: Conveyor[], item: string, dem: Map<string, Rates>) => {
    const alloc = new Map<string, number>()
    let left = amount
    let open = edges.filter((e) => demOf(dem.get(e.uid), item) > 1e-9)
    while (left > 1e-9 && open.length) {
      const share = left / open.length
      const next: Conveyor[] = []
      for (const e of open) {
        const want = demOf(dem.get(e.uid), item) - (alloc.get(e.uid) ?? 0)
        const give = Math.min(share, want)
        alloc.set(e.uid, (alloc.get(e.uid) ?? 0) + give)
        left -= give
        if (want - give > 1e-9) next.push(e)
      }
      if (next.length === open.length) break
      open = next
    }
    return { alloc, left: Math.max(0, left) }
  }

  /** Lo que realmente pueden llevarse las cintas de salida: lo que piden, sin pasar su capacidad. */
  const accepts = (edges: Conveyor[], item: string) =>
    edges.reduce((a, c) => a + Math.min(demOf(demand.get(c.uid), item), capOf(c.uid, offer.get(c.uid))), 0)

  /** Reparte una demanda total entre las cintas de entrada según lo que ofrece cada una. */
  const splitDemand = (need: number, edges: Conveyor[], item: string, off: Map<string, Rates>): Map<string, number> => {
    const offers = edges.map((e) => off.get(e.uid)?.get(item) ?? 0)
    const total = offers.reduce((a, b) => a + b, 0)
    const res = new Map<string, number>()
    edges.forEach((e, i) => res.set(e.uid, total > 0 ? (need * offers[i]) / total : need / edges.length))
    return res
  }

  const portKindOf = (c: Conveyor) =>
    c.buildingId === ROUTE_FLUID || buildingsById.get(c.buildingId)?.kind === 'pipe' ? 'pipe' : 'belt'

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
        const taken = Math.min(rate, accepts(outs, item))
        const base = clock > 0 ? rate / clock : 0
        const open = outs.some((c) => demand.get(c.uid)?.has('*'))
        const required = open || base <= 0 ? null : demOf(outDemand, item) / base
        nodes.set(e.uid, {
          inputLimited: clock,
          outputLimited: rate > 0 ? (taken / rate) * clock : 0,
          effective: rate > 0 ? (taken / rate) * clock : 0,
          inputs: [],
          outputs: [{ item, produce: rate, taken }],
          required,
        })
        continue
      }

      if (recipe && (b.kind === 'machine')) {
        const perMin = 60 / recipe.duration
        // los somersloops multiplican solo los productos (las entradas no cambian)
        const amp = 1 + somersloopBoost(e, b)
        // entradas limitan cuánto puede producir
        // si un ingrediente llega más lento de lo que pide la receta, la máquina igual produce pero cada
        // ciclo espera a ese ingrediente: produce en proporción al que más falta (cuello de botella)
        let inputLimited = clock
        let bottleneck: string | null = null
        for (const ing of recipe.ingredients) {
          const need = ing.amount * perMin
          const ratio = (inOffer.get(ing.item) ?? 0) / need
          if (ratio < inputLimited) {
            inputLimited = ratio
            bottleneck = ing.item
          }
        }
        if (mode === 'supply') {
          inputLimited = clock
          bottleneck = null
        }
        // salidas: lo que acepta lo que está conectado; sin conexión de ese tipo = sin límite
        let outputLimited = clock
        for (const p of recipe.products) {
          const kind = isFluid(p.item) ? 'pipe' : 'belt'
          const connected = outs.filter((c) => portKindOf(c) === kind)
          if (!connected.length) continue
          outputLimited = Math.min(outputLimited, accepts(connected, p.item) / (p.amount * perMin * amp))
        }
        // reloj que haría falta para cubrir exactamente lo que piden las máquinas de adelante (sin tope)
        let required: number | null = null
        for (const p of recipe.products) {
          const kind = isFluid(p.item) ? 'pipe' : 'belt'
          const connected = outs.filter((c) => portKindOf(c) === kind)
          if (!connected.length || connected.some((c) => demand.get(c.uid)?.has('*'))) continue
          const r = demOf(outDemand, p.item) / (p.amount * perMin * amp)
          required = required === null ? r : Math.min(required, r)
        }
        if (mode === 'local') outputLimited = clock
        for (const p of recipe.products) {
          const kind = isFluid(p.item) ? 'pipe' : 'belt'
          const connected = outs.filter((c) => portKindOf(c) === kind)
          const r = waterFill(p.amount * perMin * amp * inputLimited, connected, p.item, demand)
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
          bottleneck: inputLimited < outputLimited ? bottleneck : null,
          required,
          cycle: { ideal: recipe.duration / clock, actual: effective > 0 ? recipe.duration / effective : Infinity },
          inputs: recipe.ingredients.map((ing) => ({
            item: ing.item,
            need: ing.amount * perMin * clock,
            got: Math.min(inOffer.get(ing.item) ?? 0, ing.amount * perMin * clock),
          })),
          outputs: recipe.products.map((p) => ({
            item: p.item,
            produce: p.amount * perMin * amp * clock,
            taken: p.amount * perMin * amp * effective,
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

      // divisor inteligente / programable: cada salida tiene filtros
      if (/SplitterSmart|SplitterProgrammable/.test(b.id)) {
        const filt = (c: Conveyor) => e.filters?.[c.from.port] ?? [FILTER_ANY]
        const explicitItems = new Set(outs.flatMap((c) => filt(c).filter((f) => !f.startsWith('*'))))
        const routes = (item: string) => {
          const cands = outs.filter((c) => {
            const f = filt(c)
            return f.includes(item) || f.includes(FILTER_ANY) || (f.includes(FILTER_UNDEFINED) && !explicitItems.has(item))
          })
          const overflow = outs.filter((c) => filt(c).includes(FILTER_OVERFLOW))
          return { cands, overflow }
        }
        for (const [item, amount] of inOffer) {
          const { cands, overflow } = routes(item)
          const first = fillDemand(amount, cands, item, demand)
          const second = fillDemand(first.left, overflow, item, demand)
          // lo que nadie pide se ofrece igual (se acumula y frena la entrada, como en el juego)
          const rest = cands.length ? cands : overflow
          for (const c of outs) {
            const extra = rest.includes(c) && rest.length ? second.left / rest.length : 0
            nOffer.get(c.uid)!.set(item, (first.alloc.get(c.uid) ?? 0) + (second.alloc.get(c.uid) ?? 0) + extra)
          }
        }
        // demanda hacia atrás: lo que piden las salidas por las que puede ir cada ítem
        const items = new Set([...outDemand.keys(), ...inOffer.keys()])
        for (const item of items) {
          if (item === '*') continue
          const { cands, overflow } = routes(item)
          const need = [...cands, ...overflow].reduce((a, c) => a + demOf(demand.get(c.uid), item), 0)
          const r = splitDemand(need, ins, item, offer)
          for (const c of ins) nDemand.get(c.uid)!.set(item, r.get(c.uid)!)
        }
        continue
      }

      // fusionador prioritario: la demanda se atiende primero por las entradas de mayor prioridad
      if (/MergerPriority/.test(b.id)) {
        for (const [item, amount] of inOffer) for (const c of outs) nOffer.get(c.uid)!.set(item, amount / outs.length)
        const prio = (c: Conveyor) => e.priorities?.[c.to.port] ?? 1
        const levels = [...new Set(ins.map(prio))].sort((a, b) => a - b)
        for (const item of new Set([...outDemand.keys()])) {
          let left = outDemand.get(item)!
          for (const lvl of levels) {
            const group = ins.filter((c) => prio(c) === lvl)
            const offered = group.reduce((a, c) => a + (item === '*' ? sumRates(offer.get(c.uid)!) : offer.get(c.uid)?.get(item) ?? 0), 0)
            const give = Math.min(left, offered)
            const r = splitDemand(give, group, item, offer)
            for (const c of group) nDemand.get(c.uid)!.set(item, r.get(c.uid)!)
            left -= give
          }
          // si todavía falta, se pide al grupo de menor prioridad (para que el ideal se propague)
          if (left > 1e-9 && levels.length) {
            const last = ins.filter((c) => prio(c) === levels[levels.length - 1])
            const r = splitDemand(left, last, item, offer)
            for (const c of last) nDemand.get(c.uid)!.set(item, (nDemand.get(c.uid)!.get(item) ?? 0) + r.get(c.uid)!)
          }
        }
        continue
      }

      // una cinta que termina en un poste o una unión sin nada después es una salida todavía no dibujada:
      // se considera abierta (acepta todo), igual que una máquina sin nada conectado
      if (ins.length && !outs.length) {
        for (const c of ins) nDemand.get(c.uid)!.set('*', UNLIMITED)
        continue
      }

      // nodos de paso: divisores, uniones, postes, soportes, bombas, válvulas, elevadoras, contenedores con salida
      if (ins.length || outs.length) {
        // las cintas elevadoras tienen su propia capacidad
        if (b.itemsPerMinute && (b.kind === 'lift')) {
          const total = sumRates(inOffer)
          if (total > b.itemsPerMinute) for (const [i, v] of inOffer) inOffer.set(i, (v * b.itemsPerMinute) / total)
        }
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
      const k = capOf(c.uid, nOffer.get(c.uid))
      nOffer.set(c.uid, capRates(nOffer.get(c.uid)!, k))
      // la demanda es el ideal de las recetas: no se recorta por la capacidad de la cinta
      // (el aviso de "la cinta no alcanza" se muestra aparte); solo los sumideros se limitan a la cinta
      const d = nDemand.get(c.uid)!
      if (d.has('*')) d.set('*', k)
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
    const open = d.has('*')
    const dClean: Rates = open ? new Map([...o]) : d
    const k = capOf(c.uid, o)
    edges.set(c.uid, { offer: o, demand: dClean, flow: capRates(flow, k), capacity: k, open })
  }
  return { edges, nodes }
}

/** Ítems por puerto de un edificio: útil para validar qué cinta va a qué puerto. */
export const portCount = (b: Building) => portsOf(b).length

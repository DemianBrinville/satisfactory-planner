import i18n from '../i18n'
import { buildingsById, game } from '../data/gameData'
import { machineSplit, RAW_ITEMS, type Step } from './calculator'
import { pathLength } from './conveyors'
import { MINER_RESOURCES } from './flow'
import { portsOf, rectsOverlap, toWorld, worldRect, type Rect, type Rotation, type Vec } from './geometry'
import { isBuildingIdAvailable } from './progress'
import { connectionsOf, wirePoint, WIRE_MAX } from './power'
import { BELT_POLE, PIPE_SUPPORT, newUid, type Conveyor, type End, type PlacedEntity, type Wire } from './store'

/**
 * Arma la fábrica que propone la calculadora como se construye en el juego, con "manifolds":
 *  - Filas: producto final arriba, materias primas abajo; cada máquina con la salida hacia arriba.
 *  - Encima de cada fila, una cadena de uniones (o uniones de tuberías) junta lo que produce.
 *  - Debajo de cada fila, una cadena de divisores (o uniones de tuberías) por ingrediente reparte
 *    a cada máquina.
 *  - Las troncales van por los costados para no cruzar las máquinas; los tramos largos llevan postes.
 */

type Kind = 'belt' | 'pipe'
const LANE = 5 // separación entre carriles (m)
const MAX_PIECE = 50 // largo máximo de cada tramo antes de poner un poste/soporte

const BELTS = [1, 2, 3, 4, 5, 6].map((n) => `Build_ConveyorBeltMk${n}_C`)
const PIPES = ['Build_Pipeline_C', 'Build_PipelineMK2_C']
const MERGER = 'Build_ConveyorAttachmentMerger_C'
const SPLITTER = 'Build_ConveyorAttachmentSplitter_C'
const JUNCTION = 'Build_PipelineJunction_Cross_C'

/** Extractores por materia prima, del mejor al peor (se usa el mejor desbloqueado). */
const MINERS = ['Build_MinerMk3_C', 'Build_MinerMk2_C', 'Build_MinerMk1_C']
const EXTRACTORS: Record<string, string[]> = {
  Desc_Water_C: ['Build_WaterPump_C'],
  Desc_LiquidOil_C: ['Build_OilPump_C'],
}
/**
 * Extractor que conviene para una materia prima (null si no se puede extraer directo, p. ej. nitrógeno).
 * Con la cantidad pedida: la marca desbloqueada que necesita menos máquinas y, entre las que empatan, la más
 * barata (36/min de carbón → un Mk.1, no un Mk.2 al 30 %). Sin cantidad: la mejor desbloqueada.
 */
export function extractorFor(item: string, rate?: number): string | null {
  const list = EXTRACTORS[item] ?? (MINER_RESOURCES.includes(item) ? MINERS : null)
  if (!list) return null
  const ok = list.filter((id) => buildingsById.has(id))
  const avail = ok.filter((id) => isBuildingIdAvailable(id))
  if (!avail.length) return ok[ok.length - 1] ?? null
  if (rate === undefined || avail.length === 1) return avail[0]
  const count = (id: string) => Math.ceil(rate / (buildingsById.get(id)!.extractPerMinute ?? 60) - 1e-6)
  // la lista va de la mejor a la peor: se recorre al revés para que en un empate gane la más barata
  return [...avail].reverse().reduce((best, id) => (count(id) < count(best) ? id : best))
}

const isFluid = (item: string) => ['liquid', 'gas'].includes(game.items[item]?.form ?? '')
const kindOf = (item: string): Kind => (isFluid(item) ? 'pipe' : 'belt')

/** Índices de puertos de uniones/divisores según su giro (ver portsOf). */
const COLLECTOR = {
  belt: { id: MERGER, rot: 90 as Rotation, out: 0, chainIn: 1, feedIn: 3 },
  pipe: { id: JUNCTION, rot: 90 as Rotation, out: 0, chainIn: 2, feedIn: 1 },
}
const DISTRIBUTOR = {
  // cadena de derecha a izquierda / de izquierda a derecha; "feed" es la salida que mira hacia arriba
  belt: {
    rtl: { id: SPLITTER, rot: 270 as Rotation, in: 0, out: 1, feed: 3 },
    ltr: { id: SPLITTER, rot: 90 as Rotation, in: 0, out: 1, feed: 2 },
  },
  pipe: {
    rtl: { id: JUNCTION, rot: 270 as Rotation, in: 2, out: 0, feed: 1 },
    ltr: { id: JUNCTION, rot: 90 as Rotation, in: 2, out: 0, feed: 3 },
  },
}

/** Marca de cinta/tubería más baja disponible que alcance el caudal. */
function markFor(kind: Kind, rate: number): { id: string; enough: boolean } {
  const list = kind === 'belt' ? BELTS : PIPES
  const avail = list.filter((id) => buildingsById.has(id) && isBuildingIdAvailable(id))
  const pool = avail.length ? avail : list.filter((id) => buildingsById.has(id))
  for (const id of pool) {
    const b = buildingsById.get(id)!
    if ((b.itemsPerMinute ?? b.flowPerMinute ?? 0) >= rate - 1e-6) return { id, enough: true }
  }
  return { id: pool[pool.length - 1], enough: false }
}

export interface ChainBuild {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  wires: Wire[]
  notes: string[]
  /** cruces de líneas en el mismo piso que quedaron (en el juego se salvan con una elevadora o por otro piso) */
  crossings: number
}

/** Qué hacer con los subproductos que nadie usa: AWESOME Sink, depósito o dejarlos sueltos. */
export type ByproductMode = 'sink' | 'storage' | 'loose'
export interface BuildOptions {
  byproducts?: ByproductMode
  /** colocar postes y cables de energía */
  power?: boolean
}

interface BusRequest {
  side: 'right' | 'left'
  lo: number
  hi: number
  /** x del borde del bloque a lo largo del tramo (la troncal va por afuera de este borde) */
  edge: number
  /** extremos: a qué altura y hasta qué x va el tramo horizontal que sale de la troncal */
  ends: Vec[]
}
type PlacedBus = { side: 'right' | 'left'; x: number; lo: number; hi: number; h: Vec[] }

const BUS_GAP = 3

/**
 * Ubica una troncal en el primer x libre por afuera del borde: sin pisar a otra troncal del mismo costado
 * que se superponga en altura. Las troncales quedan pegadas a las filas que acompañan, no al ancho de
 * la fila más ancha del bloque.
 */
function allocBus(placed: PlacedBus[], r: BusRequest): number {
  const dir = r.side === 'right' ? 1 : -1
  const ya = r.lo + 2.5
  const yb = r.hi - 2.5
  for (let i = 0; ; i++) {
    const x = r.edge + dir * BUS_GAP * i
    const busy = placed.some(
      (p) =>
        p.side === r.side &&
        // otra troncal pegada en el mismo tramo de altura
        ((Math.abs(p.x - x) < BUS_GAP - 0.01 && p.lo < r.hi && r.lo < p.hi) ||
          // o un tramo horizontal de otra troncal que esta cortaría (queda adentro de su recorrido)
          p.h.some((h) => h.y > ya + 0.5 && h.y < yb - 0.5 && x > Math.min(h.x, p.x) - 1 && x < Math.max(h.x, p.x) + 1)),
    )
    if (!busy) {
      placed.push({ side: r.side, x, lo: r.lo, hi: r.hi, h: r.ends })
      return x
    }
  }
}

const SINK = 'Build_ResourceSink_C'
const CONTAINERS = ['Build_StorageContainerMk2_C', 'Build_StorageContainerMk1_C']
const TANKS = ['Build_IndustrialTank_C', 'Build_PipeStorageTank_C']
const POLES = ['Build_PowerPoleMk3_C', 'Build_PowerPoleMk2_C', 'Build_PowerPoleMk1_C']
/** Capacidad de los tanques (m³, wiki). */
const TANK_M3: Record<string, number> = { Build_IndustrialTank_C: 2400, Build_PipeStorageTank_C: 400 }
const STACK: Record<string, number> = { ONE: 1, SMALL: 50, MEDIUM: 100, BIG: 200, HUGE: 500 }

/** El mejor edificio desbloqueado de una lista (o el primero que exista si no hay progreso cargado). */
function bestOf(list: string[]): string {
  const ok = list.filter((id) => buildingsById.has(id))
  return ok.find((id) => isBuildingIdAvailable(id)) ?? ok[ok.length - 1]
}

/**
 * Cruces entre tramos distintos: segmentos que se cortan en un punto interior de los dos
 * (los que solo se tocan en un extremo, como en uniones y divisores, no cuentan).
 */
export function countCrossings(conveyors: Conveyor[]): number {
  // cuadrícula de 16 m: solo se comparan los tramos que comparten celda, y cada cruce se cuenta en la
  // celda donde cae el punto de cruce (así no se cuenta dos veces)
  const CELL = 16
  const segs: { a: Vec; b: Vec; c: number }[] = []
  const grid = new Map<string, number[]>()
  conveyors.forEach((cv, c) => {
    for (let i = 1; i < cv.points.length; i++) {
      const a = cv.points[i - 1]
      const b = cv.points[i]
      if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
      const k = segs.push({ a, b, c }) - 1
      for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++)
        for (let gy = Math.floor(Math.min(a.y, b.y) / CELL); gy <= Math.floor(Math.max(a.y, b.y) / CELL); gy++) {
          const key = `${gx},${gy}`
          const list = grid.get(key)
          if (list) list.push(k)
          else grid.set(key, [k])
        }
    }
  })
  const cross = (o: Vec, p: Vec, q: Vec) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const E = 1e-6
  let n = 0
  for (const [key, list] of grid) {
    const [gx, gy] = key.split(',').map(Number)
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const s1 = segs[list[i]]
        const s2 = segs[list[j]]
        if (s1.c === s2.c) continue
        const d1 = cross(s2.a, s2.b, s1.a)
        const d2 = cross(s2.a, s2.b, s1.b)
        if (!((d1 > E && d2 < -E) || (d1 < -E && d2 > E))) continue
        const d3 = cross(s1.a, s1.b, s2.a)
        const d4 = cross(s1.a, s1.b, s2.b)
        if (!((d3 > E && d4 < -E) || (d3 < -E && d4 > E))) continue
        const t = d3 / (d3 - d4)
        const px = s2.a.x + (s2.b.x - s2.a.x) * t
        const py = s2.a.y + (s2.b.y - s2.a.y) * t
        if (Math.floor(px / CELL) === gx && Math.floor(py / CELL) === gy) n++
      }
  }
  return n
}

/**
 * Orden de las troncales: las de recorrido más corto, más cerca del bloque. Así una troncal larga
 * no queda "adentro" de una corta y sus tramos horizontales no la cruzan.
 */
function planLanes(requests: BusRequest[]): number[] {
  const plan: number[] = []
  const placed: PlacedBus[] = []
  const idx = requests.map((r, i) => ({ r, i }))
  idx.sort((a, b) => a.r.hi - a.r.lo - (b.r.hi - b.r.lo) || a.r.lo - b.r.lo)
  for (const { r, i } of idx) plan[i] = allocBus(placed, r)
  return plan
}

/**
 * Arma el bloque dos veces: en el orden natural y con las troncales ordenadas para cruzarse menos,
 * y se queda con el que tiene menos cruces.
 */
export function buildChain(
  steps: Step[],
  raw: Map<string, number>,
  floor: number,
  origin: Vec,
  split: 'even' | 'full',
  opts: BuildOptions = {},
): ChainBuild {
  const first = buildOnce(steps, raw, floor, origin, split, opts, null)
  const second = buildOnce(steps, raw, floor, origin, split, opts, planLanes(first.requests))
  const best = second.crossings <= first.crossings ? second : first
  if (best.crossings > 0) best.notes.push(i18n.t('build.crossings', { count: best.crossings }))
  return { entities: best.entities, conveyors: best.conveyors, wires: best.wires, notes: best.notes, crossings: best.crossings }
}

interface Machine {
  e: PlacedEntity
  step: Step
}

function buildOnce(
  steps: Step[],
  raw: Map<string, number>,
  floor: number,
  origin: Vec,
  split: 'even' | 'full',
  opts: BuildOptions,
  plan: number[] | null,
): ChainBuild & { requests: BusRequest[] } {
  const byMode: ByproductMode = opts.byproducts ?? 'sink'
  const entities: PlacedEntity[] = []
  const conveyors: Conveyor[] = []
  const wires: Wire[] = []
  const notes: string[] = []
  const requests: BusRequest[] = []
  /** filas de estructuras con consumo eléctrico, para tender los postes */
  const powerRows: PlacedEntity[][] = []
  const byUid = new Map<string, PlacedEntity>()
  const add = (e: PlacedEntity) => {
    entities.push(e)
    byUid.set(e.uid, e)
    return e
  }
  const portPos = (e: PlacedEntity, i: number) => {
    const b = buildingsById.get(e.buildingId)!
    return toWorld(b, e, e.rot, portsOf(b, e)[i].pos)
  }

  // ---------- filas de máquinas ----------
  const maxDepth = Math.max(0, ...steps.map((s) => s.depth))
  const rows: Step[][] = []
  for (let d = 0; d <= maxDepth; d++) rows.push(steps.filter((s) => s.depth === d))

  const consumedIn = (row: Step[]) => {
    const items: string[] = []
    for (const s of row) for (const ing of s.recipe.ingredients) if (!items.includes(ing.item)) items.push(ing.item)
    return items.sort((a, b) => Number(isFluid(a)) - Number(isFluid(b)))
  }

  /** carriles encima de cada fila: uno por producto de cada paso (principal y subproductos) */
  // (en el orden de sus puertos de salida: primero las cintas y después las tuberías, como en portsOf;
  // así la salida de más a la izquierda va al carril de más afuera y las bajadas no se cruzan)
  const slotsOf = (row: Step[]) =>
    row.flatMap((st) =>
      [...st.recipe.products]
        .sort((a, b) => Number(kindOf(a.item) === 'pipe') - Number(kindOf(b.item) === 'pipe'))
        .map((p) => ({ step: st, item: p.item })),
    )
  const machinesByStep = new Map<Step, Machine[]>()
  const rowTop: number[] = []
  const rowBottom: number[] = []
  let y = origin.y + 4 + LANE * Math.max(1, slotsOf(rows[0]).length)
  let minX = Infinity
  let maxX = -Infinity
  /** franja de cada fila (con sus carriles de arriba y de abajo) y hasta dónde llega a cada costado */
  const bands: { y0: number; y1: number; x0: number; x1: number }[] = []
  rows.forEach((row, r) => {
    rowTop[r] = y
    let x = origin.x
    let bottom = y
    let rx0 = Infinity
    let rx1 = -Infinity
    for (const s of row) {
      const b = buildingsById.get(s.building)!
      const r0 = worldRect(b, { x: 0, y: 0 }, 0)
      const { n, even, full, rest } = machineSplit(s.exact)
      const list: Machine[] = []
      for (let i = 0; i < n; i++) {
        const clock = split === 'even' ? even : i < full ? 1 : rest
        if (clock <= 1e-6) continue
        const e = add({
          uid: newUid(),
          buildingId: s.building,
          x: Math.round(x - r0.x0),
          y: Math.round(y - r0.y0),
          rot: 0,
          floor,
          recipeId: s.recipe.id,
          clock: Math.round(clock * 10000) / 10000,
        })
        const rr = worldRect(b, e, 0)
        minX = Math.min(minX, rr.x0)
        maxX = Math.max(maxX, rr.x1)
        rx0 = Math.min(rx0, rr.x0)
        rx1 = Math.max(rx1, rr.x1)
        bottom = Math.max(bottom, rr.y1)
        x = rr.x1 + 4
        list.push({ e, step: s })
      }
      machinesByStep.set(s, list)
      x += 2
    }
    powerRows.push(row.flatMap((s) => (machinesByStep.get(s) ?? []).map((m) => m.e)))
    rowBottom[r] = bottom
    const K = consumedIn(row).length
    const P = rows[r + 1] ? slotsOf(rows[r + 1]).length : 0
    if (isFinite(rx0)) bands.push({ y0: y - 4 - LANE * slotsOf(row).length, y1: bottom + 4 + LANE * K, x0: rx0, x1: rx1 })
    y = bottom + 8 + LANE * K + LANE * P
  })
  // ---------- extracción: una fila de taladros/extractores al pie del bloque ----------
  // (en el juego van sobre los yacimientos; acá quedan juntos para ver cantidad, reloj y conexiones)
  const rawGroups = [...raw]
    .filter(([item, rate]) => extractorFor(item, rate))
    .map(([item, rate]) => ({ item, rate, id: extractorFor(item, rate)! }))
  const rawLanes = rawGroups.length
  const rawTop = y + 6 + LANE * Math.max(0, rawLanes - 1)
  const rawUnits = new Map<string, { e: PlacedEntity; pi: number }[]>()
  let rawBottom = y
  {
    let x = origin.x
    rawGroups.forEach((g) => {
      const b = buildingsById.get(g.id)!
      const base = b.extractPerMinute ?? 60
      const { n, even, full, rest } = machineSplit(g.rate / base)
      const list: { e: PlacedEntity; pi: number }[] = []
      for (let i = 0; i < n; i++) {
        let clock = split === 'even' ? even : i < full ? 1 : rest
        if (clock <= 1e-6) continue
        // el último taladro, que va a menos del 100 %, puede ser de una marca más barata (10/min → Mk.1)
        let id = g.id
        if (clock < 1 && b.kind === 'miner') {
          const cheaper = extractorFor(g.item, clock * base)
          const cb = cheaper ? buildingsById.get(cheaper) : null
          if (cb && cheaper !== g.id && (cb.extractPerMinute ?? 60) < base) {
            id = cheaper!
            clock = (clock * base) / (cb.extractPerMinute ?? 60)
          }
        }
        const ub = buildingsById.get(id)!
        const ur0 = worldRect(ub, { x: 0, y: 0 }, 0)
        const e = add({
          uid: newUid(),
          buildingId: id,
          x: Math.round(x - ur0.x0),
          y: Math.round(rawTop - ur0.y0),
          rot: 0,
          floor,
          resource: g.item,
          ...(b.kind === 'miner' || /OilPump/.test(g.id) ? { purity: 'normal' as const } : {}),
          clock: Math.round(clock * 10000) / 10000,
        })
        const rr = worldRect(ub, e, 0)
        minX = Math.min(minX, rr.x0)
        maxX = Math.max(maxX, rr.x1)
        rawBottom = Math.max(rawBottom, rr.y1)
        x = rr.x1 + 2
        list.push({ e, pi: 0 })
      }
      x += 4
      rawUnits.set(g.item, list)
    })
    const rawEnts = [...rawUnits.values()].flat().map((u) => worldRect(buildingsById.get(u.e.buildingId)!, u.e, 0))
    if (rawEnts.length)
      bands.push({
        y0: rawTop - 4 - LANE * rawLanes,
        y1: rawBottom,
        x0: Math.min(...rawEnts.map((r) => r.x0)),
        x1: Math.max(...rawEnts.map((r) => r.x1)),
      })
    powerRows.push(rawGroups.flatMap((g) => (rawUnits.get(g.item) ?? []).map((u) => u.e)).filter((e) => (buildingsById.get(e.buildingId)?.powerMW ?? 0) > 0))
    if (rawGroups.length)
      notes.push(i18n.t('build.miners'))
  }
  const rawLaneY = (item: string) => rawTop - 4 - LANE * (rawLanes - 1 - rawGroups.findIndex((g) => g.item === item))
  const lowest = Math.max(y, rawBottom)

  // carril de cada producto encima de su fila: el de más a la derecha queda más cerca de la fila
  const producerLaneY = (s: Step, item: string = s.item) => {
    const slots = slotsOf(rows[s.depth])
    const i = slots.findIndex((x) => x.step === s && x.item === item)
    return rowTop[s.depth] - 4 - LANE * (slots.length - 1 - i)
  }
  // carril de cada ingrediente debajo de la fila que lo consume
  // (el orden de los carriles se decide más abajo, cuando se sabe por qué costado entra cada línea)
  const laneOrder = new Map<number, string[]>()
  const consumerLaneY = (r: number, item: string) => rowBottom[r] + 4 + LANE * (laneOrder.get(r) ?? consumedIn(rows[r])).indexOf(item)

  // ---------- troncales a los costados ----------
  // cada carril vertical se reutiliza cuando los tramos no se pisan, así las troncales quedan pegadas al bloque
  const placedBus: PlacedBus[] = []
  let busRight = maxX
  /** borde del bloque entre dos alturas: lo más afuera que llegan las filas que la troncal acompaña */
  const edgeAt = (side: 'right' | 'left', lo: number, hi: number, ends: number[]) => {
    const near = bands.filter((b) => b.y1 >= lo && b.y0 <= hi)
    const xs = [...(side === 'right' ? near.map((b) => b.x1) : near.map((b) => b.x0)), ...ends]
    if (!xs.length) return side === 'right' ? maxX + 4 : minX - 4
    return side === 'right' ? Math.max(...xs) + 4 : Math.min(...xs) - 4
  }
  const busLane = (side: 'right' | 'left', ya: number, yb: number, ends: Vec[] = []) => {
    const lo = Math.min(ya, yb) - 2.5
    const hi = Math.max(ya, yb) + 2.5
    const k = requests.length
    const req = { side, lo, hi, edge: edgeAt(side, lo, hi, ends.map((e) => e.x)), ends }
    requests.push(req)
    const x = plan?.[k] ?? allocBus(placedBus, req)
    if (side === 'right') busRight = Math.max(busRight, x)
    return x
  }

  /** Agrega un recorrido partiéndolo en tramos de hasta 50 m con postes/soportes. */
  const addPath = (points: Vec[], from: End | Vec, to: End | Vec, kind: Kind, mark: string) => {
    const clean = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6)
    if (clean.length < 2) {
      // los dos extremos quedaron en el mismo punto: se unen directo si son puertos, si no no hace falta tramo
      if ('uid' in from && 'uid' in to && clean.length) conveyors.push({ uid: newUid(), buildingId: mark, floor, points: [clean[0], clean[0]], mode: 'straight', from, to })
      return
    }
    const poleId = kind === 'pipe' ? PIPE_SUPPORT : BELT_POLE
    const resolve = (v: End | Vec, dir: Vec): End => {
      if ('uid' in v) return v
      const pole = add({ uid: newUid(), buildingId: poleId, x: v.x, y: v.y, rot: 0, floor, angle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI })
      return { uid: pole.uid, port: -1 }
    }
    // cortar en tramos
    const pieces: Vec[][] = [[clean[0]]]
    let acc = 0
    for (let i = 1; i < clean.length; i++) {
      let a = clean[i - 1]
      const b = clean[i]
      let seg = Math.hypot(b.x - a.x, b.y - a.y)
      while (acc + seg > MAX_PIECE) {
        const t = (MAX_PIECE - acc) / seg
        const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        pieces[pieces.length - 1].push(cut)
        pieces.push([cut])
        seg -= MAX_PIECE - acc
        a = cut
        acc = 0
      }
      pieces[pieces.length - 1].push(b)
      acc += seg
    }
    let start = resolve(from, { x: clean[1].x - clean[0].x, y: clean[1].y - clean[0].y })
    pieces.forEach((pts, i) => {
      const last = i === pieces.length - 1
      const n = pts.length
      const dir = { x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y }
      const end = last ? resolve(to, dir) : resolve(pts[n - 1], dir)
      conveyors.push({ uid: newUid(), buildingId: mark, floor, points: pts, mode: 'straight', from: start, to: end })
      start = end
    })
  }

  // ---------- puertos de máquinas ----------
  const outPortOf = (m: Machine, item: string) => {
    const b = buildingsById.get(m.e.buildingId)!
    const ports = portsOf(b, m.e)
    const kind = kindOf(item)
    const sameKindProducts = m.step.recipe.products.filter((p) => kindOf(p.item) === kind)
    const nth = sameKindProducts.findIndex((p) => p.item === item)
    const idx = ports.map((p, i) => ({ p, i })).filter(({ p }) => p.dir === 'out' && p.kind === kind)[nth]?.i
    return idx
  }
  const inPortOf = (m: Machine, item: string) => {
    const b = buildingsById.get(m.e.buildingId)!
    const ports = portsOf(b, m.e)
    const kind = kindOf(item)
    const sameKind = m.step.recipe.ingredients.filter((x) => kindOf(x.item) === kind)
    const nth = sameKind.findIndex((x) => x.item === item)
    return ports.map((p, i) => ({ p, i })).filter(({ p }) => p.dir === 'in' && p.kind === kind)[nth]?.i
  }

  // ---------- cadenas ----------
  /**
   * Junta la producción de un paso en una cadena de uniones y devuelve por dónde sale (a la derecha).
   * La primera máquina no necesita unión: su cinta entra por atrás a la unión de la segunda; con una sola
   * máquina sale directo de su puerto.
   */
  const collect = (s: Step, mark: string, item: string = s.item) =>
    collectAt(
      (machinesByStep.get(s) ?? [])
        .map((m) => ({ e: m.e, pi: outPortOf(m, item) }))
        .filter((x): x is { e: PlacedEntity; pi: number } => x.pi !== undefined),
      producerLaneY(s, item),
      kindOf(item),
      mark,
    )
  const collectAt = (units: { e: PlacedEntity; pi: number }[], laneY: number, kind: Kind, mark: string): { end: End; pos: Vec; via: Vec[] } | null => {
    const spec = COLLECTOR[kind]
    const ms = units.map((x) => ({ m: { e: x.e }, pi: x.pi, pp: portPos(x.e, x.pi) })).sort((a, b) => a.pp.x - b.pp.x)
    if (!ms.length) return null
    if (ms.length === 1) return { end: { uid: ms[0].m.e.uid, port: ms[0].pi }, pos: ms[0].pp, via: [{ x: ms[0].pp.x, y: laneY }] }
    let prev: PlacedEntity | null = null
    ms.forEach(({ m, pi, pp }, i) => {
      if (i === 0) return
      const c = add({ uid: newUid(), buildingId: spec.id, x: pp.x, y: laneY, rot: spec.rot, floor })
      addPath([pp, portPos(c, spec.feedIn)], { uid: m.e.uid, port: pi }, { uid: c.uid, port: spec.feedIn }, kind, mark)
      if (prev) addPath([portPos(prev, spec.out), portPos(c, spec.chainIn)], { uid: prev.uid, port: spec.out }, { uid: c.uid, port: spec.chainIn }, kind, mark)
      else {
        const f = ms[0]
        addPath([f.pp, { x: f.pp.x, y: laneY }, portPos(c, spec.chainIn)], { uid: f.m.e.uid, port: f.pi }, { uid: c.uid, port: spec.chainIn }, kind, mark)
      }
      prev = c
    })
    const last = prev as unknown as PlacedEntity
    return { end: { uid: last.uid, port: spec.out }, pos: portPos(last, spec.out), via: [] }
  }

  /**
   * Reparte un ítem a las máquinas de una fila; la cadena va de derecha a izquierda o al revés.
   * La última máquina recibe la cinta directo (sin divisor) salvo que la línea siga hacia otra fila.
   */
  const distribute = (r: number, item: string, rtl: boolean, mark: string, continues: boolean) => {
    const kind = kindOf(item)
    const spec = DISTRIBUTOR[kind][rtl ? 'rtl' : 'ltr']
    const laneY = consumerLaneY(r, item)
    const targets: { m: Machine; port: number; pos: Vec }[] = []
    for (const s of rows[r]) {
      if (!s.recipe.ingredients.some((x) => x.item === item)) continue
      for (const m of machinesByStep.get(s) ?? []) {
        const pi = inPortOf(m, item)
        if (pi !== undefined) targets.push({ m, port: pi, pos: portPos(m.e, pi) })
      }
    }
    if (!targets.length) return null
    targets.sort((a, b) => (rtl ? b.pos.x - a.pos.x : a.pos.x - b.pos.x))
    let entry: End | null = null
    let entryPos: Vec = { x: 0, y: 0 }
    let tail: Vec[] = []
    let prev: PlacedEntity | null = null
    targets.forEach((t, i) => {
      const machineEnd = { uid: t.m.e.uid, port: t.port }
      if (i < targets.length - 1 || continues) {
        const d = add({ uid: newUid(), buildingId: spec.id, x: t.pos.x, y: laneY, rot: spec.rot, floor })
        addPath([portPos(d, spec.feed), t.pos], { uid: d.uid, port: spec.feed }, machineEnd, kind, mark)
        if (prev) addPath([portPos(prev, spec.out), portPos(d, spec.in)], { uid: prev.uid, port: spec.out }, { uid: d.uid, port: spec.in }, kind, mark)
        else {
          entry = { uid: d.uid, port: spec.in }
          entryPos = portPos(d, spec.in)
        }
        prev = d
      } else if (prev) {
        addPath([portPos(prev, spec.out), { x: t.pos.x, y: laneY }, t.pos], { uid: prev.uid, port: spec.out }, machineEnd, kind, mark)
      } else {
        // una sola máquina: la línea llega directo a su puerto
        entry = machineEnd
        entryPos = { x: t.pos.x, y: laneY }
        tail = [t.pos]
      }
    })
    const last = prev as PlacedEntity | null
    return {
      entry: entry as unknown as End,
      entryPos,
      tail,
      exit: continues && last ? ({ uid: last.uid, port: spec.out } as End) : null,
      exitPos: continues && last ? portPos(last, spec.out) : null,
    }
  }

  // ---------- orden de los carriles de ingredientes debajo de cada fila ----------
  // Cada línea entra por una troncal lateral y recorre la fila hasta su primera máquina. La que más recorre
  // va más afuera: así pasa por debajo de las bajadas de las demás en vez de cruzarlas.
  const rowsConsuming = (item: string) =>
    rows
      .map((row, r) => ({ row, r }))
      .filter(({ row }) => row.some((s) => s.recipe.ingredients.some((x) => x.item === item)))
      .sort((a, b) => b.r - a.r)
      .map(({ r }) => r)
  rows.forEach((row, r) => {
    const travel = (item: string) => {
      const gi = rowsConsuming(item).indexOf(r)
      const rtl = gi % 2 === 0
      const xs: number[] = []
      for (const s of row) {
        if (!s.recipe.ingredients.some((x) => x.item === item)) continue
        for (const m of machinesByStep.get(s) ?? []) {
          const pi = inPortOf(m, item)
          if (pi !== undefined) xs.push(portPos(m.e, pi).x)
        }
      }
      if (!xs.length) return 0
      return rtl ? maxX - Math.max(...xs) : Math.min(...xs) - minX
    }
    const items = consumedIn(row)
    const t = new Map(items.map((i) => [i, travel(i)]))
    laneOrder.set(r, [...items].sort((a, b) => t.get(a)! - t.get(b)!))
  })

  // ---------- flujos: cada ítem va de quien lo produce a cada fila que lo consume ----------
  const flows: { item: string; rate: number; producer: Step | null; byproduct?: boolean }[] = [
    ...steps.map((s) => ({ item: s.item, rate: s.rate, producer: s as Step | null })),
    // subproductos: si nadie los saca, la máquina se frena; salen por su propia línea
    ...steps.flatMap((s) =>
      s.recipe.products
        .filter((p) => p.item !== s.item)
        .map((p) => ({ item: p.item, rate: ((p.amount * 60) / s.recipe.duration) * s.exact, producer: s as Step | null, byproduct: true })),
    ),
    ...[...raw].map(([item, rate]) => ({ item, rate, producer: null })),
  ]
  let skippedFluids = 0
  /** subproductos sin consumidor: se llevan al final, cuando ya se sabe hasta dónde llegan las troncales */
  const loose: { item: string; rate: number; kind: Kind; mark: string; cur: { end: End; pos: Vec; via: Vec[] } }[] = []
  for (const f of flows) {
    const kind = kindOf(f.item)
    const { id: mark, enough } = markFor(kind, f.rate)
    if (!enough)
      notes.push(i18n.t(kind === 'belt' ? 'build.beltShort' : 'build.pipeShort', { item: game.items[f.item]?.name, rate: Math.round(f.rate) }))
    const consumerRows = f.byproduct
      ? []
      : rows.map((row, r) => ({ row, r })).filter(({ row }) => row.some((s) => s.recipe.ingredients.some((x) => x.item === f.item)))
    // de la fila más cercana al productor hacia arriba
    consumerRows.sort((a, b) => b.r - a.r)

    // recorrido actual: extremo, posición y puntos intermedios hasta el carril horizontal
    let cur: { end: End; pos: Vec; via: Vec[] } | null = null
    if (f.producer) {
      const c = collect(f.producer, mark, f.item)
      if (!c) {
        if (kind === 'pipe') skippedFluids++
        continue
      }
      cur = c
    } else if (rawUnits.get(f.item)?.length) {
      cur = collectAt(rawUnits.get(f.item)!, rawLaneY(f.item), kind, mark)
    }

    if (!consumerRows.length) {
      if (f.byproduct && cur && byMode !== 'loose') {
        loose.push({ item: f.item, rate: f.rate, kind, mark, cur })
        continue
      }
      if (f.byproduct)
        notes.push(i18n.t('build.byproduct', { item: game.items[f.item]?.name, rate: Math.round(f.rate * 10) / 10 }))
      // producto final o subproducto: un tramo corto hacia la derecha hasta un poste/soporte (ahí sigue tu fábrica)
      if (cur) {
        const lastPt = [cur.pos, ...cur.via].pop()!
        addPath([cur.pos, ...cur.via, { x: lastPt.x + 4, y: lastPt.y }], cur.end, { x: lastPt.x + 4, y: lastPt.y }, kind, mark)
      }
      continue
    }
    consumerRows.forEach(({ r }, gi) => {
      const rtl = gi % 2 === 0
      const d = distribute(r, f.item, rtl, mark, gi < consumerRows.length - 1)
      if (!d) return
      const side = rtl ? 'right' : 'left'
      if (!cur) {
        // materia prima: entra desde un poste/soporte suelto debajo del bloque (ahí conectas los taladros)
        const busX = busLane(side, lowest + 6, d.entryPos.y, [d.entryPos])
        addPath([{ x: busX, y: lowest + 6 }, { x: busX, y: d.entryPos.y }, d.entryPos, ...d.tail], { x: busX, y: lowest + 6 }, d.entry, kind, mark)
        if (game.items[f.item]) notes.push(i18n.t(kind === 'pipe' ? 'build.loosePipe' : 'build.looseBelt', { item: game.items[f.item]?.name }))
      } else {
        const start = [cur.pos, ...cur.via]
        const hy = start[start.length - 1].y
        const busX = busLane(side, hy, d.entryPos.y, [start[start.length - 1], d.entryPos])
        addPath([...start, { x: busX, y: hy }, { x: busX, y: d.entryPos.y }, d.entryPos, ...d.tail], cur.end, d.entry, kind, mark)
      }
      cur = d.exit && d.exitPos ? { end: d.exit, pos: d.exitPos, via: [] } : null
    })
  }
  if (skippedFluids) notes.push(i18n.t('build.skippedFluids', { n: skippedFluids }))

  // ---------- subproductos: al AWESOME Sink o a un depósito, en una columna a la derecha ----------
  // Cada uno baja por su propia columna; el de más arriba va por la de más afuera y a su destino más alto,
  // así ninguna línea cruza a otra. Los destinos tienen la entrada mirando a la izquierda.
  const sinkUnits: PlacedEntity[] = []
  if (loose.length) {
    const xRight = Math.max(maxX + 4, busRight + BUS_GAP) + 4
    const lineY = (l: (typeof loose)[number]) => [l.cur.pos, ...l.cur.via].pop()!.y
    loose.sort((a, b) => lineY(a) - lineY(b))
    const n = loose.length
    const xDest = xRight + BUS_GAP * (n - 1) + 4
    let destTop = lineY(loose[0]) - 2
    loose.forEach((l, i) => {
      const fluid = l.kind === 'pipe'
      const id = fluid ? bestOf(TANKS) : byMode === 'sink' ? SINK : bestOf(CONTAINERS)
      const b = buildingsById.get(id)!
      const port = portsOf(b).findIndex((p) => p.dir === 'in' && p.kind === l.kind)
      const r0 = worldRect(b, { x: 0, y: 0 }, 90)
      const local = toWorld(b, { x: 0, y: 0 }, 90, portsOf(b)[port].pos)
      // entrada a la altura de la línea si cabe; si no, debajo del destino anterior
      const inY = Math.max(lineY(l), destTop + (local.y - r0.y0))
      const e = add({ uid: newUid(), buildingId: id, x: Math.round(xDest - local.x), y: Math.round(inY - local.y), rot: 90, floor })
      const inPos = portPos(e, port)
      destTop = worldRect(b, e, 90).y1 + 2
      const col = xRight + BUS_GAP * (n - 1 - i)
      const start = [l.cur.pos, ...l.cur.via]
      const hy = start[start.length - 1].y
      addPath([...start, { x: col, y: hy }, { x: col, y: inPos.y }, inPos], l.cur.end, { uid: e.uid, port }, l.kind, l.mark)
      maxX = Math.max(maxX, worldRect(b, e, 90).x1)
      const name = game.items[l.item]?.name
      const rate = Math.round(l.rate * 10) / 10
      if (id === SINK) {
        sinkUnits.push(e)
        notes.push(i18n.t('build.byproductSink', { item: name, rate }))
      } else {
        // un depósito se llena: se avisa cuánto tarda
        const cap = fluid
          ? TANK_M3[id] ?? 400
          : (b.inventorySlots ?? 24) * (STACK[game.items[l.item]?.stackSize ?? 'MEDIUM'] ?? 100)
        const minutes = cap / Math.max(l.rate, 1e-6)
        notes.push(
          i18n.t(fluid && byMode === 'sink' ? 'build.byproductFluidTank' : 'build.byproductStorage', {
            item: name,
            rate,
            place: b.name,
            time: minutes >= 120 ? i18n.t('build.hours', { n: Math.round(minutes / 6) / 10 }) : i18n.t('build.minutes', { n: Math.round(minutes) }),
          }),
        )
      }
    })
  }

  // ---------- energía: postes entre las máquinas de cada fila, encadenados ----------
  if (opts.power) {
    const poleId = bestOf(POLES)
    const pb = buildingsById.get(poleId)!
    // cada poste usa hasta 3 conexiones para encadenarse (anterior, siguiente y otra fila): el resto, para máquinas
    const perPole = Math.max(1, connectionsOf(pb) - 3)
    const rect = (e: PlacedEntity) => worldRect(buildingsById.get(e.buildingId)!, e, e.rot)
    const link = (a: PlacedEntity, b: PlacedEntity) => wires.push({ uid: newUid(), from: a.uid, to: b.uid })
    // lugar libre para un poste: sin pisar estructuras ni cintas (se prueba cerca de la posición pensada).
    // Índice por celdas de 8 m para no recorrer todo el armado en cada prueba.
    const C = 8
    const ents = new Map<string, Rect[]>()
    const segIdx = new Map<string, (readonly [Vec, Vec])[]>()
    const put = <T,>(m: Map<string, T[]>, r: Rect, v: T) => {
      for (let gx = Math.floor(r.x0 / C); gx <= Math.floor(r.x1 / C); gx++)
        for (let gy = Math.floor(r.y0 / C); gy <= Math.floor(r.y1 / C); gy++) {
          const k = `${gx},${gy}`
          const l = m.get(k)
          if (l) l.push(v)
          else m.set(k, [v])
        }
    }
    const around = <T,>(m: Map<string, T[]>, p: Vec) => {
      const out: T[] = []
      const gx = Math.floor(p.x / C)
      const gy = Math.floor(p.y / C)
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(m.get(`${gx + i},${gy + j}`) ?? []))
      return out
    }
    for (const e of entities) put(ents, rect(e), rect(e))
    for (const c of conveyors)
      for (let i = 1; i < c.points.length; i++) {
        const a = c.points[i - 1]
        const b = c.points[i]
        put(segIdx, { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }, [a, b] as const)
      }
    const pole = (x: number, y: number) => {
      const p = add({ uid: newUid(), buildingId: poleId, x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2, rot: 0, floor })
      put(ents, rect(p), rect(p))
      return p
    }
    const segDist = (p: Vec, a: Vec, b: Vec) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const L = dx * dx + dy * dy
      const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0
      return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
    }
    const isFree = (x: number, y: number) => {
      const q = { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 }
      const me = worldRect(pb, q, 0)
      if (around(ents, q).some((r) => rectsOverlap(me, r, -0.3))) return false
      return !around(segIdx, q).some(([a, b]) => segDist(q, a, b) < 1)
    }
    const OFFS = [0, -2, 2, -4, 4, -6, 6]
    const freePole = (cands: Vec[]) => {
      for (const c of cands) for (const dy of OFFS) if (isFree(c.x, c.y + dy)) return pole(c.x, c.y + dy)
      for (const c of cands) for (const dx of OFFS) for (const dy of OFFS) if (isFree(c.x + dx, c.y + dy)) return pole(c.x + dx, c.y + dy)
      return pole(cands[0].x, cands[0].y)
    }
    /** une dos postes; si quedan a más de 100 m, con postes intermedios en línea recta */
    const chain = (a: PlacedEntity, b: PlacedEntity) => {
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      // (con margen: los postes intermedios se corren hasta un lugar libre)
      const parts = Math.ceil(d / (WIRE_MAX - 20))
      let prev = a
      for (let k = 1; k < parts; k++) {
        const mid = freePole([{ x: a.x + ((b.x - a.x) * k) / parts, y: a.y + ((b.y - a.y) * k) / parts }])
        link(prev, mid)
        prev = mid
      }
      link(prev, b)
    }
    const rowHeads: PlacedEntity[] = []
    let lastPole: PlacedEntity | null = null
    let poles = 0
    const before = entities.length
    for (const row of [...powerRows, sinkUnits]) {
      const list = [...row].sort((a, b) => rect(a).x0 - rect(b).x0)
      if (!list.length) continue
      let prev: PlacedEntity | null = null
      for (let i = 0; i < list.length; i += perPole) {
        const group = list.slice(i, i + perPole)
        // el poste va en el hueco a la derecha de la máquina del medio del grupo (o debajo de los destinos)
        const mi = i + Math.floor((group.length - 1) / 2)
        const mid = list[mi]
        const r = rect(mid)
        const next = list[mi + 1]
        // (los destinos de subproductos reciben la cinta por la izquierda: su poste va a la derecha)
        const cy = (r.y0 + r.y1) / 2
        const p =
          row === sinkUnits
            ? freePole([{ x: r.x1 + 1.5, y: cy }])
            : freePole([
                { x: next ? (r.x1 + rect(next).x0) / 2 : r.x1 + 1.5, y: cy },
                { x: r.x0 - 1.5, y: cy },
                { x: r.x1 + 1.5, y: cy },
              ])
        for (const m of group) link(p, m)
        if (prev) chain(prev, p)
        else rowHeads.push(p)
        prev = p
        lastPole = p
      }
    }
    void lastPole
    for (let i = 1; i < rowHeads.length; i++) chain(rowHeads[i - 1], rowHeads[i])
    if (rowHeads[0]) rowHeads[0].worldLink = true
    poles = entities.length - before
    // las líneas no pueden pasar de 100 m: si alguna máquina queda lejos, se avisa
    const far = wires.some((w) => {
      const a = byUid.get(w.from)!
      const b = byUid.get(w.to)!
      const pa = wirePoint(a)
      const pb2 = wirePoint(b)
      return Math.hypot(pa.x - pb2.x, pa.y - pb2.y) > WIRE_MAX
    })
    if (poles) notes.push(i18n.t('build.power', { poles, wires: wires.length, pole: pb.name }))
    if (far) notes.push(i18n.t('build.powerFar'))
  }

  void RAW_ITEMS
  return { entities, conveyors, wires, notes, requests, crossings: countCrossings(conveyors) }
}

/** Largo total de cinta/tubería (para el resumen). */
export const totalLength = (cs: Conveyor[]) => cs.reduce((a, c) => a + pathLength(c.points), 0)

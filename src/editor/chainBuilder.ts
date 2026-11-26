import { buildingsById, game } from '../data/gameData'
import { machineSplit, RAW_ITEMS, type Step } from './calculator'
import { pathLength } from './conveyors'
import { portsOf, toWorld, worldRect, type Rotation, type Vec } from './geometry'
import { isBuildingIdAvailable } from './progress'
import { BELT_POLE, PIPE_SUPPORT, newUid, type Conveyor, type End, type PlacedEntity } from './store'

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
  notes: string[]
}

interface Machine {
  e: PlacedEntity
  step: Step
}

export function buildChain(
  steps: Step[],
  raw: Map<string, number>,
  floor: number,
  origin: Vec,
  split: 'even' | 'full',
): ChainBuild {
  const entities: PlacedEntity[] = []
  const conveyors: Conveyor[] = []
  const notes: string[] = []
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
  const slotsOf = (row: Step[]) => row.flatMap((st) => st.recipe.products.map((p) => ({ step: st, item: p.item })))
  const machinesByStep = new Map<Step, Machine[]>()
  const rowTop: number[] = []
  const rowBottom: number[] = []
  let y = origin.y + 4 + LANE * Math.max(1, slotsOf(rows[0]).length)
  let minX = Infinity
  let maxX = -Infinity
  rows.forEach((row, r) => {
    rowTop[r] = y
    let x = origin.x
    let bottom = y
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
        bottom = Math.max(bottom, rr.y1)
        x = rr.x1 + 4
        list.push({ e, step: s })
      }
      machinesByStep.set(s, list)
      x += 2
    }
    rowBottom[r] = bottom
    const K = consumedIn(row).length
    const P = rows[r + 1] ? slotsOf(rows[r + 1]).length : 0
    y = bottom + 8 + LANE * K + LANE * P
  })
  const lowest = y

  // carril de cada producto encima de su fila: el de más a la derecha queda más cerca de la fila
  const producerLaneY = (s: Step, item: string = s.item) => {
    const slots = slotsOf(rows[s.depth])
    const i = slots.findIndex((x) => x.step === s && x.item === item)
    return rowTop[s.depth] - 4 - LANE * (slots.length - 1 - i)
  }
  // carril de cada ingrediente debajo de la fila que lo consume
  const consumerLaneY = (r: number, item: string) => rowBottom[r] + 4 + LANE * consumedIn(rows[r]).indexOf(item)

  // ---------- tramos con postes ----------
  let busRight = 0
  let busLeft = 0
  const nextRight = () => maxX + 6 + 4 * busRight++
  const nextLeft = () => minX - 6 - 4 * busLeft++

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
  /** Junta la producción de un paso en una cadena de uniones; devuelve el extremo derecho. */
  const collect = (s: Step, mark: string, item: string = s.item): { end: End; pos: Vec } | null => {
    const kind = kindOf(item)
    const spec = COLLECTOR[kind]
    const laneY = producerLaneY(s, item)
    let prev: PlacedEntity | null = null
    for (const m of machinesByStep.get(s) ?? []) {
      const pi = outPortOf(m, item)
      if (pi === undefined) continue
      const pp = portPos(m.e, pi)
      const c = add({ uid: newUid(), buildingId: spec.id, x: pp.x, y: laneY, rot: spec.rot, floor })
      addPath([pp, portPos(c, spec.feedIn)], { uid: m.e.uid, port: pi }, { uid: c.uid, port: spec.feedIn }, kind, mark)
      if (prev) addPath([portPos(prev, spec.out), portPos(c, spec.chainIn)], { uid: prev.uid, port: spec.out }, { uid: c.uid, port: spec.chainIn }, kind, mark)
      prev = c
    }
    if (!prev) return null
    return { end: { uid: prev.uid, port: spec.out }, pos: portPos(prev, spec.out) }
  }

  /** Reparte un ítem a las máquinas de una fila; la cadena va de derecha a izquierda o al revés. */
  const distribute = (r: number, item: string, rtl: boolean, mark: string) => {
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
    targets.sort((a, b) => (rtl ? b.pos.x - a.pos.x : a.pos.x - b.pos.x))
    let first: PlacedEntity | null = null
    let prev: PlacedEntity | null = null
    for (const t of targets) {
      const d = add({ uid: newUid(), buildingId: spec.id, x: t.pos.x, y: laneY, rot: spec.rot, floor })
      addPath([portPos(d, spec.feed), t.pos], { uid: d.uid, port: spec.feed }, { uid: t.m.e.uid, port: t.port }, kind, mark)
      if (prev) addPath([portPos(prev, spec.out), portPos(d, spec.in)], { uid: prev.uid, port: spec.out }, { uid: d.uid, port: spec.in }, kind, mark)
      if (!first) first = d
      prev = d
    }
    if (!first || !prev) return null
    return {
      entry: { uid: first.uid, port: spec.in } as End,
      entryPos: portPos(first, spec.in),
      exit: { uid: prev.uid, port: spec.out } as End,
      exitPos: portPos(prev, spec.out),
    }
  }

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
  for (const f of flows) {
    const kind = kindOf(f.item)
    const { id: mark, enough } = markFor(kind, f.rate)
    if (!enough)
      notes.push(
        `${game.items[f.item]?.name}: ${Math.round(f.rate)}/min supera la ${kind === 'belt' ? 'cinta' : 'tubería'} más rápida disponible; conviene dividirlo en dos líneas.`,
      )
    const consumerRows = f.byproduct
      ? []
      : rows.map((row, r) => ({ row, r })).filter(({ row }) => row.some((s) => s.recipe.ingredients.some((x) => x.item === f.item)))
    // de la fila más cercana al productor hacia arriba
    consumerRows.sort((a, b) => b.r - a.r)

    let cur: { end: End | Vec; pos: Vec; side: 'right' | 'left' }
    if (f.producer) {
      const c = collect(f.producer, mark, f.item)
      if (!c) {
        if (kind === 'pipe') skippedFluids++
        continue
      }
      cur = { end: c.end, pos: c.pos, side: 'right' }
    } else {
      // materia prima: entra por abajo a la derecha desde un poste suelto (ahí conectas los taladros)
      const x = nextRight()
      cur = { end: { x, y: lowest + 6 }, pos: { x, y: lowest + 6 }, side: 'right' }
    }

    if (!consumerRows.length) {
      if (f.byproduct)
        notes.push(`Subproducto: ${game.items[f.item]?.name} (${Math.round(f.rate * 10) / 10}/min) sale por la derecha; hay que almacenarlo, usarlo o mandarlo al AWESOME Sink para que la máquina no se frene.`)
      // producto final o subproducto: sale por la derecha hasta un poste/soporte (ahí sigue tu fábrica)
      const x = nextRight()
      addPath([cur.pos, { x, y: cur.pos.y }], cur.end, { x, y: cur.pos.y }, kind, mark)
      continue
    }
    consumerRows.forEach(({ r }, gi) => {
      const rtl = gi % 2 === 0
      const d = distribute(r, f.item, rtl, mark)
      if (!d) return
      const busX = rtl ? nextRight() : nextLeft()
      const pts = 'uid' in cur.end || f.producer ? [cur.pos, { x: busX, y: cur.pos.y }, { x: busX, y: d.entryPos.y }, d.entryPos] : [cur.pos, { x: cur.pos.x, y: d.entryPos.y }, d.entryPos]
      addPath(pts, cur.end, d.entry, kind, mark)
      cur = { end: d.exit, pos: d.exitPos, side: rtl ? 'left' : 'right' }
    })
  }
  if (skippedFluids) notes.push(`${skippedFluids} salida(s) de fluido sin puerto para conectar.`)
  void RAW_ITEMS
  return { entities, conveyors, notes }
}

/** Largo total de cinta/tubería (para el resumen). */
export const totalLength = (cs: Conveyor[]) => cs.reduce((a, c) => a + pathLength(c.points), 0)

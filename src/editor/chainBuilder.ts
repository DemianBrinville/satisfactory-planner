import { buildingsById, game } from '../data/gameData'
import { machineSplit, RAW_ITEMS, type Step } from './calculator'
import { pathLength } from './conveyors'
import { MINER_RESOURCES } from './flow'
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

/** Extractores por materia prima, del mejor al peor (se usa el mejor desbloqueado). */
const MINERS = ['Build_MinerMk3_C', 'Build_MinerMk2_C', 'Build_MinerMk1_C']
const EXTRACTORS: Record<string, string[]> = {
  Desc_Water_C: ['Build_WaterPump_C'],
  Desc_LiquidOil_C: ['Build_OilPump_C'],
}
/** Extractor que conviene para una materia prima (null si no se puede extraer directo, p. ej. nitrógeno). */
export function extractorFor(item: string): string | null {
  const list = EXTRACTORS[item] ?? (MINER_RESOURCES.includes(item) ? MINERS : null)
  if (!list) return null
  const ok = list.filter((id) => buildingsById.has(id))
  return ok.find((id) => isBuildingIdAvailable(id)) ?? ok[ok.length - 1] ?? null
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
  // ---------- extracción: una fila de taladros/extractores al pie del bloque ----------
  // (en el juego van sobre los yacimientos; acá quedan juntos para ver cantidad, reloj y conexiones)
  const rawGroups = [...raw]
    .filter(([item]) => extractorFor(item))
    .map(([item, rate]) => ({ item, rate, id: extractorFor(item)! }))
  const rawLanes = rawGroups.length
  const rawTop = y + 6 + LANE * Math.max(0, rawLanes - 1)
  const rawUnits = new Map<string, { e: PlacedEntity; pi: number }[]>()
  let rawBottom = y
  {
    let x = origin.x
    rawGroups.forEach((g) => {
      const b = buildingsById.get(g.id)!
      const base = b.extractPerMinute ?? 60
      const r0 = worldRect(b, { x: 0, y: 0 }, 0)
      const { n, even, full, rest } = machineSplit(g.rate / base)
      const list: { e: PlacedEntity; pi: number }[] = []
      for (let i = 0; i < n; i++) {
        const clock = split === 'even' ? even : i < full ? 1 : rest
        if (clock <= 1e-6) continue
        const e = add({
          uid: newUid(),
          buildingId: g.id,
          x: Math.round(x - r0.x0),
          y: Math.round(rawTop - r0.y0),
          rot: 0,
          floor,
          resource: g.item,
          ...(b.kind === 'miner' || /OilPump/.test(g.id) ? { purity: 'normal' as const } : {}),
          clock: Math.round(clock * 10000) / 10000,
        })
        const rr = worldRect(b, e, 0)
        minX = Math.min(minX, rr.x0)
        maxX = Math.max(maxX, rr.x1)
        rawBottom = Math.max(rawBottom, rr.y1)
        x = rr.x1 + 2
        list.push({ e, pi: 0 })
      }
      x += 4
      rawUnits.set(g.item, list)
    })
    if (rawGroups.length)
      notes.push(
        'Taladros y extractores calculados para yacimientos normales al reloj justo; en el juego van sobre cada yacimiento: si el tuyo es puro o impuro, cambia la pureza en el taladro y la app recalcula.',
      )
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
  const consumerLaneY = (r: number, item: string) => rowBottom[r] + 4 + LANE * consumedIn(rows[r]).indexOf(item)

  // ---------- troncales a los costados ----------
  // cada carril vertical se reutiliza cuando los tramos no se pisan, así las troncales quedan pegadas al bloque
  const BUS_GAP = 3
  const lanes: Record<'right' | 'left', [number, number][][]> = { right: [], left: [] }
  const busLane = (side: 'right' | 'left', ya: number, yb: number) => {
    const lo = Math.min(ya, yb) - 2.5
    const hi = Math.max(ya, yb) + 2.5
    let i = 0
    while (lanes[side][i]?.some(([a, b]) => a < hi && lo < b)) i++
    ;(lanes[side][i] ??= []).push([lo, hi])
    return side === 'right' ? maxX + 4 + BUS_GAP * i : minX - 4 - BUS_GAP * i
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
      if (f.byproduct)
        notes.push(`Subproducto: ${game.items[f.item]?.name} (${Math.round(f.rate * 10) / 10}/min) sale por la derecha; hay que almacenarlo, usarlo o mandarlo al AWESOME Sink para que la máquina no se frene.`)
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
        const busX = busLane(side, lowest + 6, d.entryPos.y)
        addPath([{ x: busX, y: lowest + 6 }, { x: busX, y: d.entryPos.y }, d.entryPos, ...d.tail], { x: busX, y: lowest + 6 }, d.entry, kind, mark)
        if (game.items[f.item]) notes.push(`${game.items[f.item]?.name}: entra por un ${kind === 'pipe' ? 'soporte' : 'poste'} suelto abajo; ahí conectas lo que lo trae.`)
      } else {
        const start = [cur.pos, ...cur.via]
        const hy = start[start.length - 1].y
        const busX = busLane(side, hy, d.entryPos.y)
        addPath([...start, { x: busX, y: hy }, { x: busX, y: d.entryPos.y }, d.entryPos, ...d.tail], cur.end, d.entry, kind, mark)
      }
      cur = d.exit && d.exitPos ? { end: d.exit, pos: d.exitPos, via: [] } : null
    })
  }
  if (skippedFluids) notes.push(`${skippedFluids} salida(s) de fluido sin puerto para conectar.`)
  void RAW_ITEMS
  return { entities, conveyors, notes }
}

/** Largo total de cinta/tubería (para el resumen). */
export const totalLength = (cs: Conveyor[]) => cs.reduce((a, c) => a + pathLength(c.points), 0)

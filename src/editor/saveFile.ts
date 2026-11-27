import { buildingsById, isPathKind, recipesById, schematicsById, type Building, type CategoryId } from '../data/gameData'
import { anchorLocal, footprintOf, portsOf, rotate, toWorld, type PortDef, type Rotation, type Vec } from './geometry'
import { extractionPoint, nearestSpot, spotKindFor, spotPatch, toGame, toPlan, DEFAULT_MAP, type MapPlacement } from './worldMap'
import { BELT_POLE, BELT_POLES, HYPER_POLES, HYPER_SUPPORT, isPole, newUid, PIPE_POLES, PIPE_SUPPORT, type Conveyor, type End, type PlacedEntity, type Rail, type Wire } from './store'

/**
 * Importar una partida (.sav): el archivo se lee en un worker (saveFile.worker.ts) y aquí se agrupan
 * los edificios en fábricas y se convierten las elegidas a piezas del plano, en su lugar del mapa real.
 */

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Edificio de la partida, reducido a lo que usa el plano (posiciones en metros del juego). */
export interface SaveObj {
  /** nombre de la instancia en la partida */
  id: string
  /** clase (Build_…_C) */
  cls: string
  x: number
  y: number
  z: number
  /** giro en grados (horario visto desde arriba) */
  yaw: number
  recipe?: string
  clock?: number
  boost?: number
  fuel?: string
  /** cintas, tuberías, hipertubos y vías: recorrido muestreado, x,y,z seguidos (m) */
  spline?: number[]
  /** elevadoras: posición de la parte de arriba relativa a la base (m) */
  top?: Vec3
  /** conexiones: [componente propio, dueño del otro extremo, componente del otro extremo] */
  conns: [string, string, string][]
}

export interface SaveWorld {
  session: string
  buildVersion: number
  objects: SaveObj[]
  /** construibles livianos: cimientos, paredes, rampas… */
  light: { cls: string; x: number; y: number; z: number; yaw: number }[]
  /** cables entre dos edificios */
  powerLines: [string, string][]
  /** hitos, investigaciones, alternativas y compras desbloqueadas */
  schematics: string[]
  /** fase del proyecto en la partida (empieza en 0) */
  phase: number
}

/** Lee la partida en un worker para no congelar la página con partidas grandes. */
export function readSave(file: File): Promise<SaveWorld> {
  return file.arrayBuffer().then(
    (buffer) =>
      new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./saveFile.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent<{ ok: boolean; world?: SaveWorld; error?: string }>) => {
          worker.terminate()
          if (e.data.ok && e.data.world) resolve(e.data.world)
          else reject(new Error(e.data.error ?? 'parse'))
        }
        worker.onerror = (e) => {
          worker.terminate()
          reject(new Error(e.message))
        }
        worker.postMessage({ name: file.name.replace(/\.sav$/i, ''), buffer }, [buffer])
      }),
  )
}

// ---------------- agrupación en fábricas ----------------

/** Estructura colocable (no tramo): edificio con datos o construible liviano. */
interface Piece {
  /** índice en objects (>= 0) o en light (codificado como -1 - i) */
  ref: number
  cls: string
  b: Building
  x: number
  y: number
  z: number
  yaw: number
}

export interface Factory {
  id: number
  /** índices de piezas */
  pieces: number[]
  count: number
  /** límites en el juego (m) */
  x0: number
  y0: number
  x1: number
  y1: number
  /** edificios más numerosos, para reconocerla */
  top: { id: string; n: number }[]
}

export interface SaveIndex {
  world: SaveWorld
  pieces: Piece[]
  factories: Factory[]
  byId: Map<string, SaveObj>
}

const LINK = 32
const isSegment = (b: Building | undefined) => !!b && isPathKind(b.kind)
const isRail = (cls: string) => /^Build_RailroadTrack/.test(cls)

/** Separa la partida en fábricas: edificios de trabajo a menos de 32 m entre sí forman una sola. */
export function indexSave(world: SaveWorld): SaveIndex {
  const pieces: Piece[] = []
  world.objects.forEach((o, i) => {
    const b = buildingsById.get(o.cls)
    if (!b || isSegment(b)) return
    pieces.push({ ref: i, cls: o.cls, b, x: o.x, y: o.y, z: o.z, yaw: o.yaw })
  })
  world.light.forEach((o, i) => {
    const b = buildingsById.get(o.cls)
    if (b) pieces.push({ ref: -1 - i, cls: o.cls, b, x: o.x, y: o.y, z: o.z, yaw: o.yaw })
  })

  // Las fábricas se arman con lo que trabaja (máquinas, generadores, divisores, depósitos…): los postes,
  // cimientos y paredes forman caminos que unirían todo el mapa. Después se suman a la fábrica más cercana.
  const core = (p: Piece) => {
    const k = p.b.kind
    if (k === 'foundation' || k === 'wall' || isPole(p.cls) || /PowerPole|PowerTower|PowerSwitch/.test(p.cls)) return false
    if (k !== 'structure') return true
    return p.b.category === 'produccion' || p.b.category === 'organizacion' || p.b.category === 'especial' || p.b.category === 'transporte'
  }
  const parent = pieces.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const cells = new Map<string, number[]>()
  const key = (cx: number, cy: number) => cx + ',' + cy
  const near = (p: Piece, radius: number, fn: (j: number) => void) => {
    const cx = Math.floor(p.x / LINK)
    const cy = Math.floor(p.y / LINK)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(key(cx + dx, cy + dy)) ?? []) if (Math.hypot(p.x - pieces[j].x, p.y - pieces[j].y) <= radius) fn(j)
  }
  const isCore = pieces.map(core)
  pieces.forEach((p, i) => {
    if (!isCore[i]) return
    near(p, LINK, (j) => (parent[find(i)] = find(j)))
    const k = key(Math.floor(p.x / LINK), Math.floor(p.y / LINK))
    const list = cells.get(k)
    if (list) list.push(i)
    else cells.set(k, [i])
  })
  // el resto va con la pieza de trabajo más cercana (si hay una a menos de LINK metros)
  const member = pieces.map((_, i) => (isCore[i] ? find(i) : -1))
  pieces.forEach((p, i) => {
    if (isCore[i]) return
    let best = -1
    let bd = Infinity
    near(p, LINK, (j) => {
      const d = Math.hypot(p.x - pieces[j].x, p.y - pieces[j].y)
      if (d < bd) (bd = d), (best = j)
    })
    if (best >= 0) member[i] = find(best)
  })

  const groups = new Map<number, number[]>()
  member.forEach((r, i) => {
    if (r < 0) return
    const g = groups.get(r)
    if (g) g.push(i)
    else groups.set(r, [i])
  })
  const factories: Factory[] = [...groups.values()]
    // un contenedor perdido no cuenta como fábrica
    .filter((g) => g.length >= 3)
    .map((g) => {
      const counts = new Map<string, number>()
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      for (const i of g) {
        const p = pieces[i]
        x0 = Math.min(x0, p.x)
        y0 = Math.min(y0, p.y)
        x1 = Math.max(x1, p.x)
        y1 = Math.max(y1, p.y)
        const k = p.b.kind
        if (k === 'machine' || k === 'miner' || k === 'extractor' || k === 'generator') counts.set(p.cls, (counts.get(p.cls) ?? 0) + 1)
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, n }))
      return { id: 0, pieces: g, count: g.length, x0, y0, x1, y1, top }
    })
    .sort((a, b) => b.count - a.count)
  factories.forEach((f, i) => (f.id = i))
  return { world, pieces, factories, byId: new Map(world.objects.map((o) => [o.id, o])) }
}

// ---------------- conversión al plano ----------------

/** Qué grupos de piezas se traen. */
export interface ImportOptions {
  /** cimientos y rampas */
  foundations: boolean
  /** paredes y arquitectura (vigas, techos, pasarelas…) */
  architecture: boolean
}

export interface ImportResult {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  wires: Wire[]
  rails: Rail[]
  /** ubicación del plano en el mapa (si se define con la importación) */
  map: MapPlacement | null
  /** piso con más estructuras: el que se muestra al terminar */
  floor: number
  center: Vec
  stats: {
    structures: number
    segments: number
    wires: number
    /** postes agregados donde dos tramos se unían sin poste (en el juego: en paredes, techos o en el aire) */
    addedPoles: number
    /** piezas que no están en la cuadrícula del plano (giros que no son múltiplos de 90°) */
    offGrid: number
    /** piezas de la partida que el plano no tiene */
    skipped: number
  }
}

const ARCH: CategoryId[] = ['paredes', 'arquitectura']
const mod = (a: number, n: number) => ((a % n) + n) % n
const snap90 = (a: number) => (mod(Math.round(a / 90) * 90, 360) as Rotation)
const r2 = (v: number) => Math.round(v * 100) / 100
/** Quita el error de redondeo del giro: lo que cae a menos de 5 cm de la cuadrícula de medio metro (corrida en `o`), va a ella. */
const snapHalf = (v: number, o: number) => {
  const k = (v - o) * 2
  return Math.abs(k - Math.round(k)) < 0.1 ? r2(Math.round(k) / 2 + o) : r2(v)
}

/** Ángulo de la cuadrícula de cimientos (0–90°): el giro más repetido entre cimientos (o edificios). */
function gridAngle(pieces: Piece[]): number {
  const bins = new Map<number, number>()
  const found = pieces.filter((p) => p.b.kind === 'foundation')
  for (const p of found.length ? found : pieces) {
    const a = Math.round(mod(p.yaw, 90) * 2) / 2
    bins.set(a % 90, (bins.get(a % 90) ?? 0) + 1)
  }
  let best = 0
  let bn = -1
  for (const [a, n] of bins) if (n > bn) (best = a), (bn = n)
  return best
}

const portKind = (b: Building): PortDef['kind'] => (b.kind === 'pipe' ? 'pipe' : b.kind === 'hyper' ? 'hyper' : 'belt')

/** Sentido del puerto según el nombre del componente de la partida (null: no se sabe, como en tuberías). */
function compDir(comp: string, segComp: string, seg: Building): 'in' | 'out' | null {
  if (/Input/i.test(comp)) return 'in'
  if (/Output/i.test(comp)) return 'out'
  // cintas: el tramo arranca (…Any0) en una salida y termina (…Any1) en una entrada
  if (seg.kind === 'belt') return /0$/.test(segComp) ? 'out' : 'in'
  return null
}

export function buildImport(
  index: SaveIndex,
  factoryIds: number[],
  opts: ImportOptions,
  plan: { entities: PlacedEntity[]; map: MapPlacement | null | undefined; floorHeight: number },
): ImportResult {
  const { world, pieces, byId } = index
  const chosen = factoryIds.flatMap((id) => index.factories[id]?.pieces ?? []).map((i) => pieces[i])
  const selected = chosen.filter((p) => {
    if (p.b.kind === 'foundation') return opts.foundations
    if (ARCH.includes(p.b.category)) return opts.architecture
    return true
  })

  // --- ubicación en el mapa ---
  const keepMap = plan.entities.length > 0 && plan.map
  const angle = keepMap ? plan.map!.angle : gridAngle(selected)
  let placement: MapPlacement = keepMap ? plan.map! : { ...DEFAULT_MAP, x: 0, y: 0, angle }
  if (!keepMap) {
    // origen: que los cimientos caigan en la cuadrícula de 8 m del plano y la fábrica quede
    // a la derecha de lo que ya hay (o en el origen si el plano está vacío)
    const pts = selected.map((p) => toPlan(p, placement))
    const ref = selected.find((p) => p.b.kind === 'foundation' && footprintOf(p.b).maxX - footprintOf(p.b).minX >= 8)
    let ox = 0
    let oy = 0
    if (ref) {
      const c = toPlan(ref, placement)
      const f = footprintOf(ref.b)
      const corner = { x: c.x + f.minX, y: c.y + f.minY }
      ox = mod(corner.x, 8)
      oy = mod(corner.y, 8)
    }
    const minX = Math.min(...pts.map((p) => p.x)) - ox
    const minY = Math.min(...pts.map((p) => p.y)) - oy
    let tx = Math.floor(minX / 8) * 8 + ox
    let ty = Math.floor(minY / 8) * 8 + oy
    if (plan.entities.length) {
      const right = Math.max(...plan.entities.map((e) => e.x)) + 40
      const top = Math.min(...plan.entities.map((e) => e.y))
      tx -= Math.ceil(right / 8) * 8
      ty -= Math.floor(top / 8) * 8
    }
    const o = toGame({ x: tx, y: ty }, placement)
    placement = { ...placement, x: r2(o.x), y: r2(o.y) }
  }
  const P = (g: { x: number; y: number }) => toPlan(g, placement)
  // corrimiento de la cuadrícula de los cimientos respecto del medio metro del plano (0 si se alineó al importar)
  const gridRef = selected.find((p) => p.b.kind === 'foundation' && Math.abs(mod(p.yaw - angle + 45, 90) - 45) < 1)
  const sub = (() => {
    if (!gridRef) return { x: 0, y: 0 }
    const c = P(gridRef)
    const f = footprintOf(gridRef.b)
    const rot = snap90(gridRef.yaw - angle)
    const q = rotate({ x: (f.minX + f.maxX) / 2, y: (f.minY + f.maxY) / 2 }, rot)
    return { x: mod(c.x + q.x, 0.5), y: mod(c.y + q.y, 0.5) }
  })()

  // --- pisos: en cada fábrica, el nivel donde está la mayoría de los edificios es el piso 0 ---
  const H = plan.floorHeight
  const pad = 4
  const fx = factoryIds.map((id) => index.factories[id]).filter(Boolean)
  const bases = fx.map((f) => {
    const bins = new Map<number, number>()
    for (const i of f.pieces) {
      const p = pieces[i]
      if (p.b.kind === 'foundation' || p.b.kind === 'wall' || isPole(p.cls)) continue
      const z = Math.round(p.z)
      bins.set(z, (bins.get(z) ?? 0) + 1)
    }
    let base = f.pieces.length ? pieces[f.pieces[0]].z : 0
    let bn = 0
    for (const [z, n] of bins) if (n > bn) (bn = n), (base = z)
    return { f, base }
  })
  const baseAt = (x: number, y: number) => {
    let best = bases[0]?.base ?? 0
    let bd = Infinity
    for (const { f, base } of bases) {
      const d = Math.hypot(Math.max(f.x0 - x, 0, x - f.x1), Math.max(f.y0 - y, 0, y - f.y1))
      if (d < bd) (bd = d), (best = base)
    }
    return best
  }
  const floorOf = (z: number, x: number, y: number) => Math.round((z - baseAt(x, y)) / H)

  // --- tramos (cintas, tuberías, hipertubos) que tocan lo elegido ---
  const inside = (x: number, y: number) => fx.some((f) => x >= f.x0 - pad && x <= f.x1 + pad && y >= f.y0 - pad && y <= f.y1 + pad)
  const segs = world.objects.filter((o) => {
    const b = buildingsById.get(o.cls)
    if (!isSegment(b) || !o.spline || o.spline.length < 6) return false
    const s = o.spline
    return inside(s[0], s[1]) || inside(s[s.length - 3], s[s.length - 2])
  })
  const segEnd = (o: SaveObj, start: boolean): Vec3 => {
    const s = o.spline!
    const i = start ? 0 : s.length - 3
    return { x: s[i], y: s[i + 1], z: s[i + 2] }
  }
  /** extremos de tramos que llegan a cada edificio: id → [componente del edificio, punto, sentido] */
  const portHits = new Map<string, { comp: string; at: Vec; dir: 'in' | 'out' | null; kind: PortDef['kind'] }[]>()
  for (const s of segs) {
    const sb = buildingsById.get(s.cls)!
    for (const [own, target, tcomp] of s.conns) {
      const start = /0$/.test(own)
      const list = portHits.get(target) ?? []
      list.push({ comp: tcomp, at: P(segEnd(s, start)), dir: compDir(tcomp, own, sb), kind: portKind(sb) })
      portHits.set(target, list)
    }
  }

  // --- edificios ---
  const entities: PlacedEntity[] = []
  const uidOf = new Map<string, string>()
  /** puerto del plano asignado a cada componente: "id/componente" → índice */
  const portOf = new Map<string, number>()
  let offGrid = 0

  /** Anclaje para que el centro de la huella quede donde está en el juego. */
  const anchorFor = (b: Building, g: Piece, rot: Rotation): Vec => {
    const f = footprintOf(b)
    const c = { x: (f.minX + f.maxX) / 2, y: (f.minY + f.maxY) / 2 }
    const yawRel = ((g.yaw - angle) * Math.PI) / 180
    const center = P(g)
    // centro de la huella en el juego (local → mundo con el giro real)
    const cw = { x: center.x + c.x * Math.cos(yawRel) - c.y * Math.sin(yawRel), y: center.y + c.x * Math.sin(yawRel) + c.y * Math.cos(yawRel) }
    const a = anchorLocal(b)
    const off = rotate({ x: c.x - a.x, y: c.y - a.y }, rot)
    return { x: snapHalf(cw.x - off.x, sub.x), y: snapHalf(cw.y - off.y, sub.y) }
  }

  /** Asigna cada conexión de la partida al puerto más cercano del plano; devuelve el costo total. */
  const matchPorts = (b: Building, anchor: Vec, rot: Rotation, hits: NonNullable<ReturnType<typeof portHits.get>>, liftDir?: 'up' | 'down') => {
    const ports = portsOf(b, { liftDir })
    const used = new Set<number>()
    const assign = new Map<string, number>()
    let cost = 0
    for (const h of hits) {
      let best = -1
      let bd = Infinity
      ports.forEach((p, i) => {
        if (used.has(i) || p.kind !== h.kind) return
        if (h.dir && p.dir !== h.dir && b.kind !== 'pipeJunction' && p.kind !== 'hyper') return
        const w = toWorld(b, anchor, rot, p.pos)
        const d = Math.hypot(w.x - h.at.x, w.y - h.at.y)
        if (d < bd) (bd = d), (best = i)
      })
      if (best >= 0) {
        used.add(best)
        assign.set(h.comp, best)
        cost += bd
      } else cost += 50
    }
    return { cost, assign }
  }

  // giro preferido de cada clase según las piezas conectadas (para las que no tienen conexiones)
  const classTurn = new Map<string, Map<number, number>>()
  const decided: { g: Piece; rot: Rotation; anchor: Vec; assign: Map<string, number>; turn: number | null }[] = []
  for (const g of selected) {
    const b = g.b
    const yawRel = g.yaw - angle
    const base = snap90(yawRel)
    if (Math.abs(mod(yawRel - base + 180, 360) - 180) > 3 && !isPole(g.cls)) offGrid++
    const o = g.ref >= 0 ? world.objects[g.ref] : null
    const hits = (o && portHits.get(o.id)) || []
    if (isPole(g.cls) || !hits.length || b.kind === 'foundation' || b.kind === 'wall' || /ConveyorLift/.test(g.cls)) {
      decided.push({ g, rot: base, anchor: anchorFor(b, g, base), assign: new Map(), turn: hits.length ? null : null })
      continue
    }
    let best: (typeof decided)[number] | null = null
    let bestCost = Infinity
    for (const turn of [0, 90, 180, 270]) {
      const rot = mod(base + turn, 360) as Rotation
      const anchor = anchorFor(b, g, rot)
      const { cost, assign } = matchPorts(b, anchor, rot, hits)
      if (cost < bestCost - 0.01) (bestCost = cost), (best = { g, rot, anchor, assign, turn })
    }
    decided.push(best!)
    const m = classTurn.get(g.cls) ?? new Map()
    m.set(best!.turn!, (m.get(best!.turn!) ?? 0) + 1)
    classTurn.set(g.cls, m)
  }
  // las piezas sin conexiones giran como la mayoría de su clase
  for (const d of decided) {
    if (d.turn !== null || isPole(d.g.cls) || d.g.b.kind === 'foundation' || d.g.b.kind === 'wall') continue
    const m = classTurn.get(d.g.cls)
    if (!m) continue
    const turn = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (!turn) continue
    d.rot = mod(d.rot + turn, 360) as Rotation
    d.anchor = anchorFor(d.g.b, d.g, d.rot)
  }

  // cimientos apilados dentro de un mismo piso: en el plano solo cuenta el de arriba
  const topFoundation = new Map<string, number>()
  const stackKey = (d: (typeof decided)[number]) => `${d.g.cls}|${d.anchor.x}|${d.anchor.y}|${d.rot % 180}|${floorOf(d.g.z, d.g.x, d.g.y)}`
  for (const d of decided) {
    if (d.g.b.kind !== 'foundation') continue
    const k = stackKey(d)
    topFoundation.set(k, Math.max(topFoundation.get(k) ?? -Infinity, d.g.z))
  }
  const counts = new Map<number, number>()
  /** altura de la base de cada poste importado (para la altura de la cinta sobre él) */
  const poleZ = new Map<string, number>()
  for (const d of decided) {
    const { g, rot, anchor } = d
    const b = g.b
    if (b.kind === 'foundation' && g.z < topFoundation.get(stackKey(d))!) {
      continue
    }
    const o = g.ref >= 0 ? world.objects[g.ref] : null
    const uid = newUid()
    const e: PlacedEntity = { uid, buildingId: b.id, x: anchor.x, y: anchor.y, rot, floor: floorOf(g.z, g.x, g.y) }
    if (isPole(g.cls)) {
      poleZ.set(uid, g.z)
      e.rot = 0
      const p = P(g)
      e.x = r2(p.x)
      e.y = r2(p.y)
      e.angle = Math.round(mod(g.yaw - angle, 360) * 10) / 10
    }
    if (o) {
      uidOf.set(o.id, uid)
      for (const [comp, port] of d.assign) portOf.set(o.id + '/' + comp, port)
      if (o.recipe && recipesById.has(o.recipe)) e.recipeId = o.recipe
      if (o.clock !== undefined && Math.abs(o.clock - 1) > 1e-4) e.clock = Math.round(o.clock * 10000) / 10000
      if (o.boost && o.boost > 1 && b.somersloopSlots) e.somersloops = Math.round((o.boost - 1) * b.somersloopSlots)
      if (o.fuel && b.kind === 'generator') e.resource = o.fuel
      if (o.top && /ConveyorLift/.test(g.cls)) {
        e.topFloor = floorOf(g.z + o.top.z, g.x, g.y)
        // la entrada (Any0) abajo: sube
        const hits = portHits.get(o.id) ?? []
        const input = hits.find((h) => /0$/.test(h.comp))
        const inZ = input ? world.objects.find((s) => s.conns.some(([, t, c]) => t === o.id && c === input.comp)) : null
        const z0 = inZ ? segEnd(inZ, false).z : g.z
        e.liftDir = Math.abs(z0 - g.z) <= Math.abs(z0 - (g.z + o.top.z)) ? 'up' : 'down'
        const { assign } = matchPorts(b, anchor, rot, hits, e.liftDir)
        for (const [comp, port] of assign) portOf.set(o.id + '/' + comp, port)
      }
    }
    // extractores: recurso y pureza del yacimiento de abajo
    if (spotKindFor(b)) {
      const s = nearestSpot(b, extractionPoint(b, e, e.rot), placement, 6)
      if (s) Object.assign(e, spotPatch(s))
    }
    entities.push(e)
    counts.set(e.floor, (counts.get(e.floor) ?? 0) + 1)
  }

  // --- tramos ---
  const conveyors: Conveyor[] = []
  const poleAt = new Map<string, string>()
  let addedPoles = 0
  const poles = entities.filter((e) => isPole(e.buildingId))
  const polesForKind = (k: string) => (k === 'pipe' ? PIPE_POLES : k === 'hyper' ? HYPER_POLES : BELT_POLES)
  /** Poste existente en ese punto, o uno nuevo (compartido por los tramos que se unen ahí). */
  const poleEnd = (kind: string, at: Vec3, dir: Vec, jointKey: string): End => {
    const set = polesForKind(kind)
    const p = P(at)
    const fl = floorOf(at.z - 1, at.x, at.y)
    // el poste está justo debajo de la unión (la cinta pasa entre 1 y 7 m más arriba, a veces ya en el piso de arriba)
    let near: PlacedEntity | null = null
    let nd = 1
    for (const e of poles) {
      if (!set.has(e.buildingId) || Math.abs(e.floor - fl) > 1) continue
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d < nd) (nd = d), (near = e)
    }
    if (near) {
      const z = poleZ.get(near.uid)
      const h = z === undefined ? 0 : Math.round((at.z - z) * 10) / 10
      if (near.height === undefined && h > 0.5 && Math.abs(h - 1) > 0.05) near.height = h
      return { uid: near.uid, port: -1 }
    }
    const known = poleAt.get(jointKey)
    if (known) return { uid: known, port: -1 }
    const uid = newUid()
    const id = kind === 'pipe' ? PIPE_SUPPORT : kind === 'hyper' ? HYPER_SUPPORT : BELT_POLE
    const e: PlacedEntity = { uid, buildingId: id, x: r2(p.x), y: r2(p.y), rot: 0, floor: fl, angle: Math.round(mod((Math.atan2(dir.y, dir.x) * 180) / Math.PI, 360) * 10) / 10 }
    entities.push(e)
    poles.push(e)
    poleAt.set(jointKey, uid)
    addedPoles++
    return { uid, port: -1 }
  }

  for (const s of segs) {
    const sb = buildingsById.get(s.cls)!
    const kind = sb.kind
    const flat = s.spline!
    const pts3: Vec3[] = []
    for (let i = 0; i < flat.length; i += 3) pts3.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] })
    const pts = pts3.map(P)
    const ends: End[] = [true, false].map((start) => {
      const own = s.conns.find(([c]) => /0$/.test(c) === start)
      const at = start ? pts3[0] : pts3[pts3.length - 1]
      const a = start ? pts[0] : pts[pts.length - 1]
      const b = start ? pts[1] : pts[pts.length - 2]
      const dir = { x: a.x - b.x, y: a.y - b.y }
      if (own) {
        const [ownComp, target, tcomp] = own
        const uid = uidOf.get(target)
        if (uid) {
          const port = portOf.get(target + '/' + tcomp)
          const te = entities.find((e) => e.uid === uid)!
          if (port !== undefined) return { uid, port }
          if (isPole(te.buildingId)) return { uid, port: -1 }
        }
        // unión con otro tramo: un poste compartido
        if (byId.has(target) && isSegment(buildingsById.get(byId.get(target)!.cls))) {
          const key = [s.id + '/' + ownComp, target + '/' + tcomp].sort().join('|')
          return poleEnd(kind, at, dir, key)
        }
      }
      return poleEnd(kind, at, dir, s.id + (start ? '/a' : '/b'))
    })
    let [from, to] = ends
    let points = pts.map((p) => ({ x: r2(p.x), y: r2(p.y) }))
    // tuberías e hipertubos no tienen sentido fijo en la partida: se orientan de la salida a la entrada
    if (kind !== 'belt') {
      const portDir = (e: End) => {
        if (e.port < 0) return null
        const pe = entities.find((x) => x.uid === e.uid)!
        return portsOf(buildingsById.get(pe.buildingId)!, pe)[e.port]?.dir ?? null
      }
      if (portDir(from) === 'in' || portDir(to) === 'out') {
        ;[from, to] = [to, from]
        points = points.reverse()
      }
    }
    // quitar puntos repetidos
    points = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.05)
    if (points.length < 2) continue
    const z0 = Math.min(pts3[0].z, pts3[pts3.length - 1].z)
    conveyors.push({ uid: newUid(), buildingId: s.cls, floor: floorOf(z0 - 1, pts3[0].x, pts3[0].y), points, from, to })
  }

  // --- cables ---
  const wires: Wire[] = []
  for (const [a, b] of world.powerLines) {
    const ua = uidOf.get(a)
    const ub = uidOf.get(b)
    if (ua && ub && ua !== ub) wires.push({ uid: newUid(), from: ua, to: ub })
  }

  // --- vías ---
  const rails: Rail[] = world.objects
    .filter((o) => isRail(o.cls) && o.spline && o.spline.length >= 6 && (inside(o.spline[0], o.spline[1]) || inside(o.spline[o.spline.length - 3], o.spline[o.spline.length - 2])))
    .map((o) => {
      const s = o.spline!
      const points: Vec[] = []
      for (let i = 0; i < s.length; i += 3) {
        const p = P({ x: s[i], y: s[i + 1] })
        points.push({ x: r2(p.x), y: r2(p.y) })
      }
      return { uid: newUid(), floor: floorOf(s[2], s[0], s[1]), points }
    })

  const mainFloor = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const onMain = entities.filter((e) => e.floor === mainFloor)
  const center = onMain.length
    ? { x: onMain.reduce((a, e) => a + e.x, 0) / onMain.length, y: onMain.reduce((a, e) => a + e.y, 0) / onMain.length }
    : { x: 0, y: 0 }

  // indicadores de flujo (parte de la tubería) y piezas del HUB no son construcciones aparte
  const partOf = (cls: string) => /FlowIndicator|Integrated|HubTerminal|Potty|PowerLine/i.test(cls)
  const unknown = world.objects.filter((o) => !buildingsById.has(o.cls) && !isRail(o.cls) && !partOf(o.cls) && inside(o.x, o.y)).length

  return {
    entities,
    conveyors,
    wires,
    rails,
    map: keepMap ? null : placement,
    floor: mainFloor,
    center,
    stats: {
      structures: entities.length - addedPoles,
      segments: conveyors.length,
      wires: wires.length,
      addedPoles,
      offGrid,
      skipped: unknown,
    },
  }
}

/** Progreso de la partida: fase del Ascensor espacial y lo desbloqueado que el plano conoce. */
export function saveProgress(world: SaveWorld): { phase: number; unlocked: string[] } {
  // la partida cuenta las fases desde 0 (GP_Project_Assembly_Phase_0 = niveles 0 a 2)
  return { phase: Math.max(1, Math.min(5, (world.phase || 0) + 1)), unlocked: world.schematics.filter((s) => schematicsById.has(s)) }
}

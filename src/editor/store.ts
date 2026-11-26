import { create } from 'zustand'
import { buildingsById, type CategoryId } from '../data/gameData'
import { reroute } from './conveyors'
import type { Route, VehicleKind } from './transport'
import type { MapPlacement } from './worldMap'
import { FAMILIES, familyOf, nextVariant } from './families'
import { isBuildingIdAvailable } from './progress'
import { FOUNDATION, isVerticalConnector, rectsOverlap, rotate, snapAnchor, snapModeOf, worldRect, type Rect, type Rotation, type Vec } from './geometry'

export type Purity = 'impure' | 'normal' | 'pure'

export interface PlacedEntity {
  uid: string
  buildingId: string
  /** anclaje en el mundo (m) */
  x: number
  y: number
  rot: Rotation
  floor: number
  /** postes y soportes: ángulo libre en grados (giran de a 45°) */
  angle?: number
  /** receta elegida (máquinas) */
  recipeId?: string
  /** velocidad de reloj: 1 = 100 % */
  clock?: number
  /** taladros/extractores: recurso y pureza del yacimiento */
  resource?: string
  purity?: Purity
  /** divisores inteligentes/programables: filtros por número de puerto de salida */
  filters?: Record<number, string[]>
  /** fusionador prioritario: prioridad por número de puerto de entrada (1 = la más alta) */
  priorities?: Record<number, number>
  /** cintas elevadoras y pases de piso: piso superior que alcanza */
  topFloor?: number
  /** cintas elevadoras: sentido del transporte */
  liftDir?: 'up' | 'down'
  /** amplificadores (somersloops) colocados */
  somersloops?: number
  /** postes/torres: conectado a la red eléctrica del mundo */
  worldLink?: boolean
  /** postes de cinta: altura de la cinta sobre el piso (m) */
  height?: number
  /** estaciones de tren: nombre que le puso el jugador */
  name?: string
  /** plataformas de carga de tren: cargan o descargan los vagones */
  platformMode?: 'load' | 'unload'
  /** amplificador alienígena sin cinta: recibe sus 5 matrices por minuto por otro lado */
  fueled?: boolean
  /** interruptores de energía: encendido (por defecto) o apagado */
  switchOn?: boolean
  /** interruptor de prioridad: grupo de corte del 1 (último en cortarse) al 8; sin grupo, se corta primero */
  circuitPriority?: number
  /** válvula: caudal máximo que deja pasar (m³/min); sin valor, no limita */
  flowLimit?: number
}

/** Extremo de una cinta/tubería: un puerto de un edificio o un poste/soporte (port = -1). */
export interface End {
  uid: string
  port: number
}

export interface Conveyor {
  uid: string
  /** Build_ConveyorBeltMkN_C / Build_PipelineMKN_C */
  buildingId: string
  floor: number
  /** recorrido en el mundo, de la salida a la entrada */
  points: Vec[]
  /** modo de trazado: curvo (por defecto del juego) o recto con giros de 90° */
  mode?: 'curve' | 'straight'
  from: End
  to: End
}

/** Línea eléctrica entre dos estructuras con conexión de energía. */
export interface Wire {
  uid: string
  from: string
  to: string
}

/** Tramo de vía de tren (recorrido libre, sin puertos). */
export interface Rail {
  uid: string
  floor: number
  points: Vec[]
}

/** Ajustes de energía del plano. */
export interface PowerSettings {
  /** se supone una red capaz de sostener todo: no hace falta tender cables */
  infinite: boolean
  /** generación total de la red del mundo del jugador (MW) */
  worldGen: number
  /** consumo actual de esa red sin contar este plano (MW) */
  worldUse: number
}
export const DEFAULT_POWER: PowerSettings = { infinite: true, worldGen: 0, worldUse: 0 }

export interface PlanDoc {
  power?: PowerSettings
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  wires?: Wire[]
  rails?: Rail[]
  routes?: Route[]
  /** altura entre pisos en metros (para elevadoras, tuberías verticales y altura de bombeo) */
  floorHeight?: number
  /** ubicación del plano en el mapa real del juego (fondo y yacimientos) */
  map?: MapPlacement
}

export interface View {
  /** píxeles por metro */
  scale: number
  offsetX: number
  offsetY: number
}

export type Tool = 'select' | 'place' | 'paste' | 'conveyor' | 'wire' | 'rail' | 'route'

/** Grupo copiado: coordenadas relativas al anclaje de referencia. */
export interface Clipboard {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  /** edificio cuya regla de ajuste se usa para colocar el grupo */
  refBuildingId: string
  /** líneas eléctricas entre estructuras del grupo */
  wires?: Wire[]
  /** vías de tren seleccionadas junto con el grupo */
  rails?: Rail[]
  /** al cortar: cintas que iban hacia afuera del grupo, para reconectarlas al pegar */
  external?: Conveyor[]
}

/** Altura entre pisos por defecto (m): un muro de 4 m más el cimiento deja poco lugar; 8 m es lo habitual. */
export const DEFAULT_FLOOR_HEIGHT = 8

export const BELT_POLE = 'Build_ConveyorPole_C'
export const PIPE_SUPPORT = 'Build_PipelineSupport_C'
/** Postes de cinta y soportes de tubería: puntos de paso que giran de a 45°. */
export const BELT_POLES = new Set([BELT_POLE, 'Build_ConveyorPoleStackable_C', 'Build_ConveyorPoleWall_C', 'Build_ConveyorCeilingAttachment_C'])
export const PIPE_POLES = new Set([PIPE_SUPPORT, 'Build_PipeSupportStackable_C', 'Build_PipelineSupportWall_C'])
export const HYPER_SUPPORT = 'Build_PipeHyperSupport_C'
/** Soportes de hipertubo (y el agujero de pared, que también es un punto de paso del tubo). */
export const HYPER_POLES = new Set([HYPER_SUPPORT, 'Build_HyperPoleStackable_C', 'Build_HyperTubeWallSupport_C', 'Build_HyperTubeWallHole_C'])
export const isPole = (buildingId: string) => BELT_POLES.has(buildingId) || PIPE_POLES.has(buildingId) || HYPER_POLES.has(buildingId)
/** Poste o soporte que corresponde a cada tipo de trazado. */
export const polesFor = (kind: string | undefined) => (kind === 'pipe' ? PIPE_POLES : kind === 'hyper' ? HYPER_POLES : BELT_POLES)
const deg = (v: Vec) => Math.round(((Math.atan2(v.y, v.x) * 180) / Math.PI) * 100) / 100

interface EditorState extends PlanDoc {
  past: PlanDoc[]
  future: PlanDoc[]
  selection: string[]
  view: View
  tool: Tool
  placingId: string | null
  placingRot: Rotation
  /** ángulo del poste que se está colocando */
  placingAngle: number
  conveyorId: string | null
  /** modo de trazado de cintas: curvo (por defecto del juego) o recto */
  conveyorMode: 'curve' | 'straight'
  toggleConveyorMode: () => void
  /** última variante usada de cada familia (atajos numéricos) */
  lastByFamily: Record<string, string>
  selectFamily: (family: string) => void
  cycleVariant: (dir?: 1 | -1) => void
  clipboard: Clipboard | null
  /** pegar una sola vez (después de cortar = mover) */
  pasteOnce: boolean
  pasteRot: Rotation
  snapStep: number
  floor: number
  category: CategoryId

  setView: (v: Partial<View>) => void
  setCategory: (c: CategoryId) => void
  setFloor: (f: number) => void
  setSnapStep: (s: number) => void
  startPlacing: (buildingId: string) => void
  startConveyor: (buildingId: string) => void
  cancelTool: () => void
  rotatePlacing: (dir?: 1 | -1) => void
  place: (anchor: Vec, extra?: Partial<PlacedEntity>) => boolean
  /** coloca la pieza elegida en varias posiciones de una vez (relleno de área); devuelve cuántas entraron */
  placeMany: (anchors: Vec[]) => number
  canPlace: (buildingId: string, anchor: Vec, rot: Rotation, ignore?: string[]) => boolean
  addConveyor: (c: Omit<Conveyor, 'uid' | 'floor' | 'from' | 'to'> & { from: End | Vec; to: End | Vec }) => void
  select: (uids: string[], additive?: boolean) => void
  moveSelection: (dx: number, dy: number) => void
  rotateSelection: () => void
  deleteSelection: () => void
  copySelection: () => void
  cutSelection: () => void
  startPaste: () => void
  /** empieza a colocar un grupo guardado (bloque) como si se hubiera copiado */
  pasteGroup: (group: Clipboard) => void
  pasteAt: (anchor: Vec) => boolean
  updateEntity: (uid: string, patch: Partial<PlacedEntity>) => void
  undo: () => void
  redo: () => void
  load: (doc: PlanDoc) => void
  /** agrega un bloque completo (máquinas, cintas, tuberías) en un solo paso de deshacer */
  addDoc: (doc: { entities: PlacedEntity[]; conveyors: Conveyor[]; wires?: Wire[] }) => void
  /** agrega un grupo de máquinas ya configuradas (calculadora) y las deja seleccionadas */
  addLayout: (items: { buildingId: string; recipeId: string; clock: number; floor: number; rect: { x0: number; y0: number } }[]) => void
  startWire: () => void
  routeKind: VehicleKind
  startRail: () => void
  startRoute: (kind: VehicleKind, from?: string) => void
  /** estación de origen elegida para la ruta en curso */
  routeFrom: string | null
  setRouteFrom: (uid: string | null) => void
  addRail: (points: Vec[]) => void
  addRoute: (kind: VehicleKind, from: string, to: string, waypoints?: Vec[]) => void
  updateRoute: (uid: string, patch: Partial<Route>) => void
  addWire: (from: string, to: string) => void
  setFloorHeight: (h: number) => void
  /** ubica el plano en el mapa real (null lo quita); no entra en el historial de deshacer */
  setMap: (m: Partial<MapPlacement> | null) => void
  setPower: (p: Partial<PowerSettings>) => void
}

/** Copia del documento para el historial y el guardado. */
export const snapshot = (s: PlanDoc): PlanDoc => ({
  power: s.power,
  entities: s.entities,
  conveyors: s.conveyors,
  wires: s.wires,
  rails: s.rails,
  routes: s.routes,
})

const remember = (m: Record<string, string>, id: string) => {
  const f = familyOf(id)
  return f ? { ...m, [f]: id } : m
}

export const newUid = () => Math.random().toString(36).slice(2, 10)
const nextRot = (r: Rotation, dir: 1 | -1): Rotation => ((r + 90 * dir + 360) % 360) as Rotation

/** Los cimientos van en su propia capa: las máquinas se apoyan encima. */
export const layerOf = (buildingId: string) =>
  buildingsById.get(buildingId)?.kind === 'foundation' && !isVerticalConnector(buildingId) ? 'base' : 'top'

/** ¿La estructura ocupa este piso? Los conectores verticales ocupan todos los pisos que atraviesan. */
export const onFloor = (e: PlacedEntity, floor: number) =>
  e.floor === floor || (isVerticalConnector(e.buildingId) && floor > e.floor && floor <= (e.topFloor ?? e.floor + 1))

/** Piso en el que está un puerto (los conectores tienen un puerto abajo y otro arriba). */
export const portFloor = (e: PlacedEntity, level?: 'bottom' | 'top') => (level === 'top' ? e.topFloor ?? e.floor + 1 : e.floor)

/** Lista vacía estable (un `[]` nuevo en cada render rompe los useMemo). */
export const NONE: never[] = []

export function entityRect(e: PlacedEntity): Rect | null {
  const b = buildingsById.get(e.buildingId)
  return b ? worldRect(b, e, e.rot) : null
}

export const isEnd = (v: End | Vec): v is End => (v as End).uid !== undefined

/** Arma un grupo copiable (portapapeles o bloque guardado) con lo seleccionado, relativo a una estructura de referencia. */
export function groupOf(selection: string[], entities: PlacedEntity[], conveyors: Conveyor[], wires: Wire[], rails: Rail[]): Clipboard | null {
  const sel = new Set(selection)
  const ents = entities.filter((e) => sel.has(e.uid))
  if (!ents.length) return null
  // referencia: un cimiento si hay (mantiene la cuadrícula de 8 m), si no la primera estructura
  const ref = ents.find((e) => layerOf(e.buildingId) === 'base') ?? ents[0]
  const ids = new Set(ents.map((e) => e.uid))
  const rel = (p: Vec) => ({ x: p.x - ref.x, y: p.y - ref.y })
  const group: Clipboard = {
    refBuildingId: ref.buildingId,
    entities: ents.map((e) => ({ ...e, x: e.x - ref.x, y: e.y - ref.y })),
    conveyors: conveyors.filter((c) => ids.has(c.from.uid) && ids.has(c.to.uid)).map((c) => ({ ...c, points: c.points.map(rel) })),
  }
  const w = wires.filter((x) => ids.has(x.from) && ids.has(x.to))
  if (w.length) group.wires = w
  const r = rails.filter((x) => sel.has(x.uid)).map((x) => ({ ...x, points: x.points.map(rel) }))
  if (r.length) group.rails = r
  return group
}

/** Grupo del portapapeles transformado a una posición y rotación del mundo. */
export function placeClipboard(cb: Clipboard, anchor: Vec, rot: Rotation, floor: number): PlanDoc {
  return placeClipboardMapped(cb, anchor, rot, floor).doc
}

function placeClipboardMapped(cb: Clipboard, anchor: Vec, rot: Rotation, floor: number): { doc: PlanDoc; uidMap: Map<string, string> } {
  const map = new Map<string, string>()
  const at = (p: Vec) => {
    const o = rotate(p, rot)
    return { x: anchor.x + o.x, y: anchor.y + o.y }
  }
  const entities = cb.entities.map((e) => {
    const off = rotate({ x: e.x, y: e.y }, rot)
    const uid = newUid()
    map.set(e.uid, uid)
    const placed: PlacedEntity = { ...e, uid, x: anchor.x + off.x, y: anchor.y + off.y, rot: ((e.rot + rot) % 360) as Rotation, floor }
    // elevadoras y pases de piso: el piso superior se guarda relativo al de la pieza
    if (e.topFloor !== undefined) placed.topFloor = floor + (e.topFloor - e.floor)
    // postes con ángulo libre: giran junto con el grupo
    if (rot && (e.angle !== undefined || isPole(e.buildingId))) placed.angle = ((e.angle ?? 0) + rot) % 360
    return placed
  })
  const conveyors = cb.conveyors.map((c) => ({
    ...c,
    uid: newUid(),
    floor,
    points: c.points.map((p) => {
      const o = rotate(p, rot)
      return { x: anchor.x + o.x, y: anchor.y + o.y }
    }),
    from: { ...c.from, uid: map.get(c.from.uid)! },
    to: { ...c.to, uid: map.get(c.to.uid)! },
  }))
  const wires = (cb.wires ?? [])
    .filter((w) => map.has(w.from) && map.has(w.to))
    .map((w) => ({ uid: newUid(), from: map.get(w.from)!, to: map.get(w.to)! }))
  const rails = (cb.rails ?? []).map((r) => ({ uid: newUid(), floor, points: r.points.map(at) }))
  return { doc: { entities, conveyors, wires, rails }, uidMap: map }
}

export const useEditor = create<EditorState>((set, get) => {
  /** Aplica un cambio al documento guardando historial para deshacer. */
  const commit = (doc: Partial<PlanDoc>) =>
    set((s) => ({
      ...doc,
      past: [...s.past.slice(-99), snapshot(s)],
      future: [],
    }))

  /** Borra entidades y las cintas que quedan sueltas. */
  const removeEntities = (uids: string[]) => {
    const { entities, conveyors } = get()
    const gone = new Set(uids)
    return {
      entities: entities.filter((e) => !gone.has(e.uid)),
      wires: (get().wires ?? []).filter((w) => !gone.has(w.uid) && !gone.has(w.from) && !gone.has(w.to)),
      rails: (get().rails ?? []).filter((r) => !gone.has(r.uid)),
      // trenes con horario: se quitan las paradas borradas (con menos de dos, el tren deja de existir)
      routes: (get().routes ?? [])
        .map((r) => {
          if (!r.stops) return r
          const stops = r.stops.filter((u) => !gone.has(u))
          return stops.length === r.stops.length ? r : { ...r, stops, from: stops[0] ?? r.from, to: stops[1] ?? r.to }
        })
        .filter((r) => !gone.has(r.uid) && (r.stops ? r.stops.length >= 2 : !gone.has(r.from) && !gone.has(r.to))),
      conveyors: conveyors.filter((c) => !gone.has(c.uid) && !gone.has(c.from.uid) && !gone.has(c.to.uid)),
    }
  }

  const toClipboard = (): Clipboard | null => {
    const s = get()
    return groupOf(s.selection, s.entities, s.conveyors, s.wires ?? [], s.rails ?? [])
  }

  return {
    entities: [],
    conveyors: [],
    wires: [],
    power: DEFAULT_POWER,
    rails: [],
    routes: [],
    routeKind: 'truck',
    floorHeight: DEFAULT_FLOOR_HEIGHT,
    past: [],
    future: [],
    selection: [],
    view: { scale: 10, offsetX: 400, offsetY: 300 },
    tool: 'select',
    placingId: null,
    placingRot: 0,
    placingAngle: 0,
    conveyorId: null,
    conveyorMode: 'curve',
    toggleConveyorMode: () => set((s) => ({ conveyorMode: s.conveyorMode === 'curve' ? 'straight' : 'curve' })),
    lastByFamily: {},
    selectFamily: (family) => {
      const f = FAMILIES[family]
      if (!f?.ids.length) return
      // repetir el atajo de la familia que ya está activa sale del modo colocación
      const cur = get()
      const active = cur.tool === 'conveyor' ? cur.conveyorId : cur.tool === 'place' ? cur.placingId : null
      if (active && familyOf(active) === family) return get().cancelTool()
      const last = get().lastByFamily[family]
      const id = last && isBuildingIdAvailable(last) ? last : f.ids.find(isBuildingIdAvailable)
      if (!id) return
      const kind = buildingsById.get(id)?.kind
      if (kind === 'belt' || kind === 'pipe' || kind === 'hyper') get().startConveyor(id)
      else get().startPlacing(id)
    },
    cycleVariant: (dir = 1) => {
      const s = get()
      if (s.tool === 'conveyor' && s.conveyorId) return s.startConveyor(nextVariant(s.conveyorId, isBuildingIdAvailable, dir))
      if (s.tool === 'place' && s.placingId) return s.startPlacing(nextVariant(s.placingId, isBuildingIdAvailable, dir))
      if (s.tool !== 'select' || !s.selection.length) return
      // con una selección: cambia la marca de lo seleccionado, como apuntar con otra marca en el juego
      const sel = new Set(s.selection)
      const conveyors = s.conveyors.map((c) =>
        sel.has(c.uid) ? { ...c, buildingId: nextVariant(c.buildingId, isBuildingIdAvailable, dir) } : c,
      )
      const entities = s.entities.map((e) => {
        if (!sel.has(e.uid)) return e
        const id = nextVariant(e.buildingId, isBuildingIdAvailable, dir)
        return id !== e.buildingId && s.canPlace(id, e, e.rot, s.selection) ? { ...e, buildingId: id } : e
      })
      commit({ entities, conveyors })
    },
    clipboard: null,
    pasteOnce: false,
    pasteRot: 0,
    snapStep: 1,
    floor: 0,
    category: 'produccion',

    setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
    setCategory: (category) => set({ category }),
    setFloor: (floor) => set({ floor, selection: [] }),
    setSnapStep: (snapStep) => set({ snapStep }),
    startPlacing: (placingId) =>
      set((s) => ({ placingId, conveyorId: null, tool: 'place', selection: [], lastByFamily: remember(s.lastByFamily, placingId) })),
    startConveyor: (conveyorId) =>
      set((s) => ({ conveyorId, placingId: null, tool: 'conveyor', selection: [], lastByFamily: remember(s.lastByFamily, conveyorId) })),
    cancelTool: () => set({ placingId: null, conveyorId: null, tool: 'select' }),
    rotatePlacing: (dir = 1) =>
      set((s) => {
        if (s.tool === 'paste') return { pasteRot: nextRot(s.pasteRot, dir) }
        if (s.placingId && isPole(s.placingId)) return { placingAngle: (s.placingAngle + 45 * dir + 360) % 360 }
        return { placingRot: nextRot(s.placingRot, dir) }
      }),

    canPlace: (buildingId, anchor, rot, ignore = []) => {
      const b = buildingsById.get(buildingId)
      if (!b) return false
      const r = worldRect(b, anchor, rot)
      const layer = layerOf(buildingId)
      const { entities, floor } = get()
      return !entities.some((e) => {
        if (!onFloor(e, floor) || ignore.includes(e.uid) || layerOf(e.buildingId) !== layer) return false
        const er = entityRect(e)
        return er ? rectsOverlap(r, er) : false
      })
    },

    place: (anchor, extra) => {
      const { placingId, placingRot, placingAngle, floor, entities, canPlace } = get()
      if (!placingId || !canPlace(placingId, anchor, placingRot)) return false
      const pole = isPole(placingId)
      const vertical = isVerticalConnector(placingId) ? { topFloor: floor + 1, liftDir: 'up' as const } : {}
      commit({
        entities: [
          ...entities,
          {
            uid: newUid(),
            buildingId: placingId,
            x: anchor.x,
            y: anchor.y,
            rot: pole ? 0 : placingRot,
            floor,
            ...(pole ? { angle: placingAngle } : {}),
            ...vertical,
            ...extra,
          },
        ],
      })
      return true
    },

    placeMany: (anchors) => {
      const { placingId, placingRot, floor, entities, canPlace } = get()
      if (!placingId) return 0
      const added: PlacedEntity[] = []
      for (const a of anchors) {
        if (!canPlace(placingId, a, placingRot)) continue
        added.push({ uid: newUid(), buildingId: placingId, x: a.x, y: a.y, rot: placingRot, floor })
      }
      if (added.length) commit({ entities: [...entities, ...added] })
      return added.length
    },

    addConveyor: ({ buildingId, points, from, to, mode }) => {
      const { entities, conveyors, floor } = get()
      const kind = buildingsById.get(buildingId)?.kind
      const poleId = kind === 'pipe' ? PIPE_SUPPORT : kind === 'hyper' ? HYPER_SUPPORT : BELT_POLE
      const newEnts: PlacedEntity[] = []
      // un extremo libre crea un poste (cintas) o soporte (tuberías) alineado con la cinta, como en el juego
      const n = points.length
      const resolve = (e: End | Vec, atStart: boolean): End => {
        if (isEnd(e)) return e
        const dir = atStart
          ? { x: points[1].x - points[0].x, y: points[1].y - points[0].y }
          : { x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y }
        const pole: PlacedEntity = { uid: newUid(), buildingId: poleId, x: e.x, y: e.y, rot: 0, floor, angle: deg(dir) }
        newEnts.push(pole)
        return { uid: pole.uid, port: -1 }
      }
      const c: Conveyor = { uid: newUid(), buildingId, floor, points, mode, from: resolve(from, true), to: resolve(to, false) }
      commit({ entities: [...entities, ...newEnts], conveyors: [...conveyors, c] })
    },

    select: (uids, additive = false) => set((s) => ({ selection: additive ? [...new Set([...s.selection, ...uids])] : uids })),

    moveSelection: (dx, dy) => {
      const { selection, entities, conveyors } = get()
      if (!selection.length || (dx === 0 && dy === 0)) return
      const sel = new Set(selection)
      const nextEntities = entities.map((e) => (sel.has(e.uid) ? { ...e, x: e.x + dx, y: e.y + dy } : e))
      commit({
        entities: nextEntities,
        // entre dos estructuras movidas: se traslada entera; con un solo extremo movido: se vuelve a trazar
        conveyors: conveyors.flatMap((c) => {
          const a = sel.has(c.from.uid)
          const b = sel.has(c.to.uid)
          if (a && b) return [{ ...c, points: c.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }]
          if (a || b) return reroute(c, nextEntities) ?? []
          return [c]
        }),
        // rutas con las dos estaciones movidas (o la ruta seleccionada): los puntos de paso acompañan
        routes: (get().routes ?? []).map((r) =>
          r.waypoints && ((sel.has(r.from) && sel.has(r.to)) || sel.has(r.uid))
            ? { ...r, waypoints: r.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
            : r,
        ),
      })
    },

    rotateSelection: () => {
      const { selection, entities, conveyors, canPlace } = get()
      if (!selection.length) return
      const sel = new Set(selection)
      const next = entities.map((e) => {
        if (!sel.has(e.uid)) return e
        if (isPole(e.buildingId)) return { ...e, angle: ((e.angle ?? 0) + 45) % 360 }
        const rot = nextRot(e.rot, 1)
        return canPlace(e.buildingId, e, rot, selection) ? { ...e, rot } : e
      })
      commit({
        entities: next,
        conveyors: conveyors.flatMap((c) => (sel.has(c.from.uid) || sel.has(c.to.uid) ? reroute(c, next) ?? [] : [c])),
      })
    },

    deleteSelection: () => {
      const { selection } = get()
      // removeEntities también borra líneas seleccionadas (por uid)
      if (!selection.length) return
      commit(removeEntities(selection))
      set({ selection: [] })
    },

    copySelection: () => {
      const cb = toClipboard()
      if (cb) set({ clipboard: cb, pasteOnce: false })
    },
    cutSelection: () => {
      const cb = toClipboard()
      if (!cb) return
      const sel = new Set(get().selection)
      cb.external = get().conveyors.filter((c) => sel.has(c.from.uid) !== sel.has(c.to.uid))
      commit(removeEntities(get().selection))
      set({ clipboard: cb, pasteOnce: true, selection: [], tool: 'paste', pasteRot: 0, placingId: null, conveyorId: null })
    },
    startPaste: () => {
      const cb = get().clipboard
      if (cb) set({ tool: 'paste', pasteOnce: false, clipboard: { ...cb, external: undefined }, pasteRot: 0, placingId: null, conveyorId: null, selection: [] })
    },
    pasteGroup: (group) =>
      set({ clipboard: { ...group, external: undefined }, tool: 'paste', pasteOnce: false, pasteRot: 0, placingId: null, conveyorId: null, selection: [] }),
    pasteAt: (anchor) => {
      const { clipboard, pasteRot, pasteOnce, floor, entities, conveyors, canPlace } = get()
      if (!clipboard) return false
      const { doc, uidMap } = placeClipboardMapped(clipboard, anchor, pasteRot, floor)
      if (!doc.entities.every((e) => canPlace(e.buildingId, e, e.rot))) return false
      const allEntities = [...entities, ...doc.entities]
      // al mover (cortar + pegar) se reconectan las cintas que salían del grupo
      const reconnected = (pasteOnce ? clipboard.external ?? [] : []).flatMap((c) => {
        const moved = { ...c, from: { ...c.from, uid: uidMap.get(c.from.uid) ?? c.from.uid }, to: { ...c.to, uid: uidMap.get(c.to.uid) ?? c.to.uid } }
        return reroute(moved, allEntities) ?? []
      })
      commit({
        entities: allEntities,
        conveyors: [...conveyors, ...doc.conveyors, ...reconnected],
        ...(doc.wires?.length ? { wires: [...(get().wires ?? []), ...doc.wires] } : {}),
        ...(doc.rails?.length ? { rails: [...(get().rails ?? []), ...doc.rails] } : {}),
      })
      set({ selection: doc.entities.map((e) => e.uid) })
      if (pasteOnce) set({ tool: 'select', clipboard: { ...clipboard, external: undefined }, pasteOnce: false })
      return true
    },

    updateEntity: (uid, patch) => {
      const { entities } = get()
      commit({ entities: entities.map((e) => (e.uid === uid ? { ...e, ...patch } : e)) })
    },

    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1]
        if (!prev) return s
        return { ...prev, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], selection: [] }
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0]
        if (!next) return s
        return { ...next, past: [...s.past, snapshot(s)], future: s.future.slice(1), selection: [] }
      }),

    load: (doc) =>
      set({ entities: doc.entities ?? [], conveyors: doc.conveyors ?? [], wires: doc.wires ?? [], rails: doc.rails ?? [], routes: doc.routes ?? [], power: { ...DEFAULT_POWER, ...doc.power }, floorHeight: doc.floorHeight ?? DEFAULT_FLOOR_HEIGHT, map: doc.map, past: [], future: [], selection: [] }),
    addDoc: (doc) => {
      commit({
        entities: [...get().entities, ...doc.entities],
        conveyors: [...get().conveyors, ...doc.conveyors],
        ...(doc.wires?.length ? { wires: [...(get().wires ?? []), ...doc.wires] } : {}),
      })
      set({ selection: [...doc.entities.map((e) => e.uid), ...doc.conveyors.map((c) => c.uid)] })
    },
    addLayout: (items) => {
      const added: PlacedEntity[] = []
      for (const it of items) {
        const b = buildingsById.get(it.buildingId)
        if (!b) continue
        const r0 = worldRect(b, { x: 0, y: 0 }, 90)
        added.push({
          uid: newUid(),
          buildingId: it.buildingId,
          x: Math.round(it.rect.x0 - r0.x0),
          y: Math.round(it.rect.y0 - r0.y0),
          rot: 90,
          floor: it.floor,
          recipeId: it.recipeId,
          clock: it.clock,
        })
      }
      commit({ entities: [...get().entities, ...added] })
      set({ selection: added.map((e) => e.uid), floor: items[0]?.floor ?? get().floor })
    },
    startWire: () => set({ tool: 'wire', placingId: null, conveyorId: null, selection: [] }),
    startRail: () => set({ tool: 'rail', placingId: null, conveyorId: null, selection: [] }),
    startRoute: (routeKind, from) => set({ tool: 'route', routeKind, routeFrom: from ?? null, placingId: null, conveyorId: null, selection: [] }),
    routeFrom: null,
    setRouteFrom: (routeFrom) => set({ routeFrom }),
    addRail: (points) => commit({ rails: [...(get().rails ?? []), { uid: newUid(), floor: get().floor, points }] }),
    addRoute: (kind, from, to, waypoints) => {
      const uid = newUid()
      // entre dos estaciones de tren se arma un tren con horario (se le pueden agregar más paradas)
      const ents = get().entities
      const isStation = (u: string) => ents.find((e) => e.uid === u)?.buildingId === 'Build_TrainStation_C'
      const timetable = kind === 'train' && isStation(from) && isStation(to)
      const route: Route = timetable
        ? { uid, kind, from, to, count: 1, stops: [from, to], trains: 1, locos: 1 }
        : { uid, kind, from, to, count: 1, ...(waypoints?.length ? { waypoints } : {}) }
      commit({ routes: [...(get().routes ?? []), route] })
      set({ selection: [uid], tool: 'select' })
    },
    updateRoute: (uid, patch) => commit({ routes: (get().routes ?? []).map((r) => (r.uid === uid ? { ...r, ...patch } : r)) }),
    addWire: (from, to) => {
      const wires = get().wires ?? []
      if (from === to || wires.some((w) => (w.from === from && w.to === to) || (w.from === to && w.to === from))) return
      commit({ wires: [...wires, { uid: newUid(), from, to }] })
    },
    setPower: (p) => set((s) => ({ power: { ...DEFAULT_POWER, ...s.power, ...p } })),
    setFloorHeight: (h) => set({ floorHeight: Math.max(4, Math.min(48, Math.round(h))) }),
    setMap: (m) =>
      set((s) => {
        if (!m) return { map: undefined }
        const cur = s.map
        if (!cur && (m.x === undefined || m.y === undefined)) return {}
        return { map: { angle: 0, show: true, nodes: true, opacity: 0.55, ...cur, ...m } as MapPlacement }
      }),
  }
})

/** Paso de ajuste para mover un grupo: 8 m si incluye cimientos, si no el paso elegido. */
export function moveStepFor(uids: string[]): number {
  const { entities, snapStep } = useEditor.getState()
  const hasBase = entities.some((e) => uids.includes(e.uid) && layerOf(e.buildingId) === 'base')
  return hasBase ? FOUNDATION : snapStep
}

/** Anclaje ajustado para el grupo del portapapeles. */
export function snapClipboard(cb: Clipboard, mouse: Vec, rot: Rotation, step: number): Vec {
  const b = buildingsById.get(cb.refBuildingId)!
  return snapAnchor(b, mouse, rot, snapModeOf(b) === 'foundationAnchor' ? step : 1)
}

// Autoguardado local mientras no esté conectado Supabase.
const STORAGE_KEY = 'satisfactory-planner:draft'
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved)
    useEditor.getState().load(Array.isArray(parsed) ? { entities: parsed, conveyors: [] } : parsed)
  }
} catch {
  /* borrador corrupto: se ignora */
}
let localTimer: ReturnType<typeof setTimeout> | undefined
useEditor.subscribe((s, prev) => {
  if (
    s.entities !== prev.entities ||
    s.conveyors !== prev.conveyors ||
    s.wires !== prev.wires ||
    s.rails !== prev.rails ||
    s.routes !== prev.routes ||
    s.power !== prev.power ||
    s.floorHeight !== prev.floorHeight ||
    s.map !== prev.map
  ) {
    // se guarda un momento después del último cambio: con planos grandes serializar en cada acción traba
    clearTimeout(localTimer)
    localTimer = setTimeout(() => {
      const st = useEditor.getState()
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot(st), floorHeight: st.floorHeight, map: st.map }))
      } catch {
        /* sin espacio en el navegador: queda el guardado en la nube */
      }
    }, 500)
  }
})

// Acceso desde la consola en desarrollo (pruebas manuales).
if (import.meta.env.DEV) (window as unknown as { __editor: typeof useEditor }).__editor = useEditor

import { create } from 'zustand'
import { buildingsById, type CategoryId } from '../data/gameData'
import { reroute } from './conveyors'
import type { Route, VehicleKind } from './transport'
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

export interface PlanDoc {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  wires?: Wire[]
  rails?: Rail[]
  routes?: Route[]
  /** altura entre pisos en metros (para elevadoras, tuberías verticales y altura de bombeo) */
  floorHeight?: number
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
export const isPole = (buildingId: string) => BELT_POLES.has(buildingId) || PIPE_POLES.has(buildingId)
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
  place: (anchor: Vec) => boolean
  canPlace: (buildingId: string, anchor: Vec, rot: Rotation, ignore?: string[]) => boolean
  addConveyor: (c: Omit<Conveyor, 'uid' | 'floor' | 'from' | 'to'> & { from: End | Vec; to: End | Vec }) => void
  select: (uids: string[], additive?: boolean) => void
  moveSelection: (dx: number, dy: number) => void
  rotateSelection: () => void
  deleteSelection: () => void
  copySelection: () => void
  cutSelection: () => void
  startPaste: () => void
  pasteAt: (anchor: Vec) => boolean
  updateEntity: (uid: string, patch: Partial<PlacedEntity>) => void
  undo: () => void
  redo: () => void
  load: (doc: PlanDoc) => void
  startWire: () => void
  routeKind: VehicleKind
  startRail: () => void
  startRoute: (kind: VehicleKind, from?: string) => void
  /** estación de origen elegida para la ruta en curso */
  routeFrom: string | null
  setRouteFrom: (uid: string | null) => void
  addRail: (points: Vec[]) => void
  addRoute: (kind: VehicleKind, from: string, to: string) => void
  updateRoute: (uid: string, patch: Partial<Route>) => void
  addWire: (from: string, to: string) => void
  setFloorHeight: (h: number) => void
}

/** Copia del documento para el historial y el guardado. */
export const snapshot = (s: PlanDoc): PlanDoc => ({
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
const layerOf = (buildingId: string) =>
  buildingsById.get(buildingId)?.kind === 'foundation' && !isVerticalConnector(buildingId) ? 'base' : 'top'

/** ¿La estructura ocupa este piso? Los conectores verticales ocupan todos los pisos que atraviesan. */
export const onFloor = (e: PlacedEntity, floor: number) =>
  e.floor === floor || (isVerticalConnector(e.buildingId) && floor > e.floor && floor <= (e.topFloor ?? e.floor + 1))

/** Piso en el que está un puerto (los conectores tienen un puerto abajo y otro arriba). */
export const portFloor = (e: PlacedEntity, level?: 'bottom' | 'top') => (level === 'top' ? e.topFloor ?? e.floor + 1 : e.floor)

export function entityRect(e: PlacedEntity): Rect | null {
  const b = buildingsById.get(e.buildingId)
  return b ? worldRect(b, e, e.rot) : null
}

export const isEnd = (v: End | Vec): v is End => (v as End).uid !== undefined

/** Grupo del portapapeles transformado a una posición y rotación del mundo. */
export function placeClipboard(cb: Clipboard, anchor: Vec, rot: Rotation, floor: number): PlanDoc {
  return placeClipboardMapped(cb, anchor, rot, floor).doc
}

function placeClipboardMapped(cb: Clipboard, anchor: Vec, rot: Rotation, floor: number): { doc: PlanDoc; uidMap: Map<string, string> } {
  const map = new Map<string, string>()
  const entities = cb.entities.map((e) => {
    const off = rotate({ x: e.x, y: e.y }, rot)
    const uid = newUid()
    map.set(e.uid, uid)
    return { ...e, uid, x: anchor.x + off.x, y: anchor.y + off.y, rot: ((e.rot + rot) % 360) as Rotation, floor }
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
  return { doc: { entities, conveyors }, uidMap: map }
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
      routes: (get().routes ?? []).filter((r) => !gone.has(r.uid) && !gone.has(r.from) && !gone.has(r.to)),
      conveyors: conveyors.filter((c) => !gone.has(c.uid) && !gone.has(c.from.uid) && !gone.has(c.to.uid)),
    }
  }

  const toClipboard = (): Clipboard | null => {
    const { selection, entities, conveyors } = get()
    const sel = new Set(selection)
    const ents = entities.filter((e) => sel.has(e.uid))
    if (!ents.length) return null
    // referencia: un cimiento si hay (mantiene la cuadrícula de 8 m), si no la primera estructura
    const ref = ents.find((e) => layerOf(e.buildingId) === 'base') ?? ents[0]
    const ids = new Set(ents.map((e) => e.uid))
    return {
      refBuildingId: ref.buildingId,
      entities: ents.map((e) => ({ ...e, x: e.x - ref.x, y: e.y - ref.y })),
      conveyors: conveyors
        .filter((c) => ids.has(c.from.uid) && ids.has(c.to.uid))
        .map((c) => ({ ...c, points: c.points.map((p) => ({ x: p.x - ref.x, y: p.y - ref.y })) })),
    }
  }

  return {
    entities: [],
    conveyors: [],
    wires: [],
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
      if (kind === 'belt' || kind === 'pipe') get().startConveyor(id)
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

    place: (anchor) => {
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
          },
        ],
      })
      return true
    },

    addConveyor: ({ buildingId, points, from, to, mode }) => {
      const { entities, conveyors, floor } = get()
      const isPipe = buildingsById.get(buildingId)?.kind === 'pipe'
      const newEnts: PlacedEntity[] = []
      // un extremo libre crea un poste (cintas) o soporte (tuberías) alineado con la cinta, como en el juego
      const n = points.length
      const resolve = (e: End | Vec, atStart: boolean): End => {
        if (isEnd(e)) return e
        const dir = atStart
          ? { x: points[1].x - points[0].x, y: points[1].y - points[0].y }
          : { x: points[n - 1].x - points[n - 2].x, y: points[n - 1].y - points[n - 2].y }
        const pole: PlacedEntity = { uid: newUid(), buildingId: isPipe ? PIPE_SUPPORT : BELT_POLE, x: e.x, y: e.y, rot: 0, floor, angle: deg(dir) }
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
      commit({ entities: allEntities, conveyors: [...conveyors, ...doc.conveyors, ...reconnected] })
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
      set({ entities: doc.entities ?? [], conveyors: doc.conveyors ?? [], wires: doc.wires ?? [], rails: doc.rails ?? [], routes: doc.routes ?? [], floorHeight: doc.floorHeight ?? DEFAULT_FLOOR_HEIGHT, past: [], future: [], selection: [] }),
    startWire: () => set({ tool: 'wire', placingId: null, conveyorId: null, selection: [] }),
    startRail: () => set({ tool: 'rail', placingId: null, conveyorId: null, selection: [] }),
    startRoute: (routeKind, from) => set({ tool: 'route', routeKind, routeFrom: from ?? null, placingId: null, conveyorId: null, selection: [] }),
    routeFrom: null,
    setRouteFrom: (routeFrom) => set({ routeFrom }),
    addRail: (points) => commit({ rails: [...(get().rails ?? []), { uid: newUid(), floor: get().floor, points }] }),
    addRoute: (kind, from, to) => {
      const uid = newUid()
      commit({ routes: [...(get().routes ?? []), { uid, kind, from, to, count: 1 }] })
      set({ selection: [uid], tool: 'select' })
    },
    updateRoute: (uid, patch) => commit({ routes: (get().routes ?? []).map((r) => (r.uid === uid ? { ...r, ...patch } : r)) }),
    addWire: (from, to) => {
      const wires = get().wires ?? []
      if (from === to || wires.some((w) => (w.from === from && w.to === to) || (w.from === to && w.to === from))) return
      commit({ wires: [...wires, { uid: newUid(), from, to }] })
    },
    setFloorHeight: (h) => set({ floorHeight: Math.max(4, Math.min(48, Math.round(h))) }),
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
useEditor.subscribe((s, prev) => {
  if (
    s.entities !== prev.entities ||
    s.conveyors !== prev.conveyors ||
    s.wires !== prev.wires ||
    s.rails !== prev.rails ||
    s.routes !== prev.routes ||
    s.floorHeight !== prev.floorHeight
  ) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot(s), floorHeight: s.floorHeight }))
  }
})

// Acceso desde la consola en desarrollo (pruebas manuales).
if (import.meta.env.DEV) (window as unknown as { __editor: typeof useEditor }).__editor = useEditor

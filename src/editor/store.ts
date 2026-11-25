import { create } from 'zustand'
import { buildingsById, type CategoryId } from '../data/gameData'
import { reroute } from './conveyors'
import { FOUNDATION, rectsOverlap, rotate, snapAnchor, snapModeOf, worldRect, type Rect, type Rotation, type Vec } from './geometry'

export type Purity = 'impure' | 'normal' | 'pure'

export interface PlacedEntity {
  uid: string
  buildingId: string
  /** anclaje en el mundo (m) */
  x: number
  y: number
  rot: Rotation
  floor: number
  /** receta elegida (máquinas) */
  recipeId?: string
  /** velocidad de reloj: 1 = 100 % */
  clock?: number
  /** taladros/extractores: recurso y pureza del yacimiento */
  resource?: string
  purity?: Purity
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
  from: End
  to: End
}

export interface PlanDoc {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
}

export interface View {
  /** píxeles por metro */
  scale: number
  offsetX: number
  offsetY: number
}

export type Tool = 'select' | 'place' | 'paste' | 'conveyor'

/** Grupo copiado: coordenadas relativas al anclaje de referencia. */
export interface Clipboard {
  entities: PlacedEntity[]
  conveyors: Conveyor[]
  /** edificio cuya regla de ajuste se usa para colocar el grupo */
  refBuildingId: string
  /** al cortar: cintas que iban hacia afuera del grupo, para reconectarlas al pegar */
  external?: Conveyor[]
}

export const BELT_POLE = 'Build_ConveyorPole_C'
export const PIPE_SUPPORT = 'Build_PipelineSupport_C'

interface EditorState extends PlanDoc {
  past: PlanDoc[]
  future: PlanDoc[]
  selection: string[]
  view: View
  tool: Tool
  placingId: string | null
  placingRot: Rotation
  conveyorId: string | null
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
}

export const newUid = () => Math.random().toString(36).slice(2, 10)
const nextRot = (r: Rotation, dir: 1 | -1): Rotation => ((r + 90 * dir + 360) % 360) as Rotation

/** Los cimientos van en su propia capa: las máquinas se apoyan encima. */
const layerOf = (buildingId: string) => (buildingsById.get(buildingId)?.kind === 'foundation' ? 'base' : 'top')

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
      past: [...s.past.slice(-99), { entities: s.entities, conveyors: s.conveyors }],
      future: [],
    }))

  /** Borra entidades y las cintas que quedan sueltas. */
  const removeEntities = (uids: string[]) => {
    const { entities, conveyors } = get()
    const gone = new Set(uids)
    return {
      entities: entities.filter((e) => !gone.has(e.uid)),
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
    past: [],
    future: [],
    selection: [],
    view: { scale: 10, offsetX: 400, offsetY: 300 },
    tool: 'select',
    placingId: null,
    placingRot: 0,
    conveyorId: null,
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
    startPlacing: (placingId) => set({ placingId, conveyorId: null, tool: 'place', selection: [] }),
    startConveyor: (conveyorId) => set({ conveyorId, placingId: null, tool: 'conveyor', selection: [] }),
    cancelTool: () => set({ placingId: null, conveyorId: null, tool: 'select' }),
    rotatePlacing: (dir = 1) =>
      set((s) => (s.tool === 'paste' ? { pasteRot: nextRot(s.pasteRot, dir) } : { placingRot: nextRot(s.placingRot, dir) })),

    canPlace: (buildingId, anchor, rot, ignore = []) => {
      const b = buildingsById.get(buildingId)
      if (!b) return false
      const r = worldRect(b, anchor, rot)
      const layer = layerOf(buildingId)
      const { entities, floor } = get()
      return !entities.some((e) => {
        if (e.floor !== floor || ignore.includes(e.uid) || layerOf(e.buildingId) !== layer) return false
        const er = entityRect(e)
        return er ? rectsOverlap(r, er) : false
      })
    },

    place: (anchor) => {
      const { placingId, placingRot, floor, entities, canPlace } = get()
      if (!placingId || !canPlace(placingId, anchor, placingRot)) return false
      commit({ entities: [...entities, { uid: newUid(), buildingId: placingId, x: anchor.x, y: anchor.y, rot: placingRot, floor }] })
      return true
    },

    addConveyor: ({ buildingId, points, from, to }) => {
      const { entities, conveyors, floor } = get()
      const isPipe = buildingsById.get(buildingId)?.kind === 'pipe'
      const newEnts: PlacedEntity[] = []
      // un extremo libre crea un poste (cintas) o soporte (tuberías), como en el juego
      const resolve = (e: End | Vec): End => {
        if (isEnd(e)) return e
        const pole: PlacedEntity = { uid: newUid(), buildingId: isPipe ? PIPE_SUPPORT : BELT_POLE, x: e.x, y: e.y, rot: 0, floor }
        newEnts.push(pole)
        return { uid: pole.uid, port: -1 }
      }
      const c: Conveyor = { uid: newUid(), buildingId, floor, points, from: resolve(from), to: resolve(to) }
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
        return { ...prev, past: s.past.slice(0, -1), future: [{ entities: s.entities, conveyors: s.conveyors }, ...s.future], selection: [] }
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0]
        if (!next) return s
        return { ...next, past: [...s.past, { entities: s.entities, conveyors: s.conveyors }], future: s.future.slice(1), selection: [] }
      }),

    load: (doc) => set({ entities: doc.entities ?? [], conveyors: doc.conveyors ?? [], past: [], future: [], selection: [] }),
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
  if (s.entities !== prev.entities || s.conveyors !== prev.conveyors) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entities: s.entities, conveyors: s.conveyors }))
  }
})

// Acceso desde la consola en desarrollo (pruebas manuales).
if (import.meta.env.DEV) (window as unknown as { __editor: typeof useEditor }).__editor = useEditor

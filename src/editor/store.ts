import { create } from 'zustand'
import { buildingsById, type CategoryId } from '../data/gameData'
import { rectsOverlap, worldRect, type Rect, type Rotation, type Vec } from './geometry'

export interface PlacedEntity {
  uid: string
  buildingId: string
  /** anclaje en el mundo (m) */
  x: number
  y: number
  rot: Rotation
  floor: number
}

export interface View {
  /** píxeles por metro */
  scale: number
  /** desplazamiento del origen del mundo en pantalla (px) */
  offsetX: number
  offsetY: number
}

export type Tool = 'select' | 'place'

interface EditorState {
  entities: PlacedEntity[]
  past: PlacedEntity[][]
  future: PlacedEntity[][]
  selection: string[]
  view: View
  tool: Tool
  placingId: string | null
  placingRot: Rotation
  floor: number
  category: CategoryId

  setView: (v: Partial<View>) => void
  setCategory: (c: CategoryId) => void
  setFloor: (f: number) => void
  startPlacing: (buildingId: string) => void
  cancelPlacing: () => void
  rotatePlacing: (dir?: 1 | -1) => void
  place: (anchor: Vec) => boolean
  select: (uids: string[], additive?: boolean) => void
  moveSelection: (dx: number, dy: number) => void
  rotateSelection: () => void
  deleteSelection: () => void
  undo: () => void
  redo: () => void
  canPlace: (buildingId: string, anchor: Vec, rot: Rotation, ignore?: string[]) => boolean
  load: (entities: PlacedEntity[]) => void
}

const uid = () => Math.random().toString(36).slice(2, 10)
const nextRot = (r: Rotation, dir: 1 | -1): Rotation => (((r + 90 * dir + 360) % 360) as Rotation)

/** Los cimientos van en su propia capa: las máquinas se apoyan encima. */
const layerOf = (buildingId: string) => {
  const k = buildingsById.get(buildingId)?.kind
  return k === 'foundation' ? 'base' : 'top'
}

export function entityRect(e: PlacedEntity): Rect | null {
  const b = buildingsById.get(e.buildingId)
  return b ? worldRect(b, e, e.rot) : null
}

export const useEditor = create<EditorState>((set, get) => {
  /** Aplica un cambio a las entidades guardando historial para deshacer. */
  const commit = (entities: PlacedEntity[]) =>
    set((s) => ({ entities, past: [...s.past.slice(-99), s.entities], future: [] }))

  return {
    entities: [],
    past: [],
    future: [],
    selection: [],
    view: { scale: 10, offsetX: 400, offsetY: 300 },
    tool: 'select',
    placingId: null,
    placingRot: 0,
    floor: 0,
    category: 'produccion',

    setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
    setCategory: (category) => set({ category }),
    setFloor: (floor) => set({ floor, selection: [] }),
    startPlacing: (placingId) => set({ placingId, tool: 'place', selection: [] }),
    cancelPlacing: () => set({ placingId: null, tool: 'select' }),
    rotatePlacing: (dir = 1) => set((s) => ({ placingRot: nextRot(s.placingRot, dir) })),

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
      commit([...entities, { uid: uid(), buildingId: placingId, x: anchor.x, y: anchor.y, rot: placingRot, floor }])
      return true
    },

    select: (uids, additive = false) =>
      set((s) => ({ selection: additive ? [...new Set([...s.selection, ...uids])] : uids })),

    moveSelection: (dx, dy) => {
      const { selection, entities } = get()
      if (!selection.length || (dx === 0 && dy === 0)) return
      commit(entities.map((e) => (selection.includes(e.uid) ? { ...e, x: e.x + dx, y: e.y + dy } : e)))
    },

    rotateSelection: () => {
      const { selection, entities, canPlace } = get()
      if (!selection.length) return
      const next = entities.map((e) => {
        if (!selection.includes(e.uid)) return e
        const rot = nextRot(e.rot, 1)
        return canPlace(e.buildingId, e, rot, selection) ? { ...e, rot } : e
      })
      commit(next)
    },

    deleteSelection: () => {
      const { selection, entities } = get()
      if (!selection.length) return
      commit(entities.filter((e) => !selection.includes(e.uid)))
      set({ selection: [] })
    },

    undo: () =>
      set((s) => {
        const prev = s.past[s.past.length - 1]
        if (!prev) return s
        return { entities: prev, past: s.past.slice(0, -1), future: [s.entities, ...s.future], selection: [] }
      }),
    redo: () =>
      set((s) => {
        const next = s.future[0]
        if (!next) return s
        return { entities: next, past: [...s.past, s.entities], future: s.future.slice(1), selection: [] }
      }),

    load: (entities) => set({ entities, past: [], future: [], selection: [] }),
  }
})

// Autoguardado local mientras no esté conectado Supabase.
const STORAGE_KEY = 'satisfactory-planner:draft'
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) useEditor.getState().load(JSON.parse(saved))
} catch {
  /* borrador corrupto: se ignora */
}
useEditor.subscribe((s, prev) => {
  if (s.entities !== prev.entities) localStorage.setItem(STORAGE_KEY, JSON.stringify(s.entities))
})

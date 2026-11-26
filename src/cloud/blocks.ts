import { create } from 'zustand'
import { buildingsById } from '../data/gameData'
import { entityRect, type Clipboard } from '../editor/store'
import { supabase } from './supabase'

/** Bloque guardado: un grupo de estructuras para colocar en cualquier plano (como los planos del juego). */
export interface Block {
  id: string
  name: string
  description?: string
  updated: string
  data: Clipboard
}

/** Formato del archivo exportado. */
interface BlockFile {
  app: 'satisfactory-planner'
  kind: 'block'
  version: 1
  name: string
  description?: string
  data: Clipboard
}

const LOCAL_KEY = 'satisfactory-planner:blocks'
/** Lado de la zona de construcción de cada Diseñador de planos (m): 4, 5 y 6 cimientos. */
export const DESIGNER_SIZES = [32, 40, 48] as const

export interface BlockSize {
  w: number
  h: number
  /** Diseñador más chico donde entra (1–3), o null si no entra en ninguno */
  designer: number | null
}

/** Tamaño del bloque en planta y en qué Diseñador de planos entraría. */
export function blockSize(data: Clipboard): BlockSize {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const e of data.entities) {
    const r = entityRect(e)
    if (r) {
      add(r.x0, r.y0)
      add(r.x1, r.y1)
    } else add(e.x, e.y)
  }
  for (const c of data.conveyors) for (const p of c.points) add(p.x, p.y)
  for (const r of data.rails ?? []) for (const p of r.points) add(p.x, p.y)
  if (!isFinite(x0)) return { w: 0, h: 0, designer: 1 }
  const w = Math.round((x1 - x0) * 10) / 10
  const h = Math.round((y1 - y0) * 10) / 10
  // se puede girar dentro del diseñador: alcanza con que el lado mayor entre
  const side = Math.max(w, h)
  const i = DESIGNER_SIZES.findIndex((s) => side <= s + 0.01)
  return { w, h, designer: i >= 0 ? i + 1 : null }
}

/** Datos mínimos válidos y sin estructuras desconocidas (archivos de otra versión). */
function clean(data: unknown): Clipboard | null {
  const d = data as Clipboard
  if (!d || !Array.isArray(d.entities) || !Array.isArray(d.conveyors) || typeof d.refBuildingId !== 'string') return null
  const entities = d.entities.filter((e) => e && typeof e.uid === 'string' && buildingsById.has(e.buildingId) && isFinite(e.x) && isFinite(e.y))
  if (!entities.length) return null
  const ids = new Set(entities.map((e) => e.uid))
  const conveyors = d.conveyors.filter((c) => c && buildingsById.has(c.buildingId) && ids.has(c.from?.uid) && ids.has(c.to?.uid) && Array.isArray(c.points))
  const out: Clipboard = {
    refBuildingId: buildingsById.has(d.refBuildingId) ? d.refBuildingId : entities[0].buildingId,
    entities,
    conveyors,
  }
  const wires = (d.wires ?? []).filter((w) => w && ids.has(w.from) && ids.has(w.to))
  if (wires.length) out.wires = wires
  const rails = (d.rails ?? []).filter((r) => r && Array.isArray(r.points) && r.points.length >= 2)
  if (rails.length) out.rails = rails
  return out
}

const readLocal = (): Block[] => {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Block[]
    return Array.isArray(list) ? list.filter((b) => b && b.id && clean(b.data)) : []
  } catch {
    return []
  }
}
const writeLocal = (list: Block[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list))
  } catch {
    /* sin espacio: queda en memoria */
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36))
const sortList = (list: Block[]) => [...list].sort((a, b) => b.updated.localeCompare(a.updated))

interface BlocksState {
  blocks: Block[]
  /** usuario con el que se sincronizan (null: solo en este navegador) */
  userId: string | null
  /** la tabla en la nube respondió (si falla, todo sigue funcionando en local) */
  cloud: boolean
  /** grupo a punto de guardarse (abre la ventana para ponerle nombre) */
  saving: Clipboard | null
  setSaving: (g: Clipboard | null) => void
  save: (name: string, description: string, data: Clipboard) => Promise<Block>
  update: (id: string, patch: { name?: string; description?: string }) => Promise<void>
  remove: (id: string) => Promise<void>
  /** sesión iniciada o cerrada: trae los de la cuenta y sube los que solo estaban en el navegador */
  sync: (userId: string | null) => Promise<void>
  exportFile: (b: Block) => void
  importFile: (file: File) => Promise<Block | null>
}

const toRow = (b: Block, userId: string) => ({ id: b.id, user_id: userId, name: b.name, description: b.description ?? null, data: b.data, updated_at: b.updated })

export const useBlocks = create<BlocksState>((set, get) => {
  const setList = (list: Block[]) => {
    const blocks = sortList(list)
    set({ blocks })
    writeLocal(blocks)
  }
  const upload = async (b: Block) => {
    const { userId, cloud } = get()
    if (!userId || !cloud) return
    const { error } = await supabase.from('blocks').upsert(toRow(b, userId))
    if (error) set({ cloud: false })
  }

  return {
    blocks: sortList(readLocal()),
    userId: null,
    cloud: false,
    saving: null,
    setSaving: (saving) => set({ saving }),

    save: async (name, description, data) => {
      const b: Block = { id: newId(), name: name.trim() || 'Bloque', description: description.trim() || undefined, updated: new Date().toISOString(), data }
      setList([b, ...get().blocks])
      await upload(b)
      return b
    },

    update: async (id, patch) => {
      const cur = get().blocks.find((b) => b.id === id)
      if (!cur) return
      const b: Block = {
        ...cur,
        ...(patch.name !== undefined ? { name: patch.name.trim() || cur.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description.trim() || undefined } : {}),
        updated: new Date().toISOString(),
      }
      setList(get().blocks.map((x) => (x.id === id ? b : x)))
      await upload(b)
    },

    remove: async (id) => {
      setList(get().blocks.filter((b) => b.id !== id))
      const { userId, cloud } = get()
      if (userId && cloud) await supabase.from('blocks').delete().eq('id', id)
    },

    sync: async (userId) => {
      if (!userId) {
        set({ userId: null, cloud: false })
        return
      }
      set({ userId })
      const { data, error } = await supabase.from('blocks').select('id,name,description,data,updated_at').eq('user_id', userId)
      if (error || !data) {
        // tabla no disponible: se siguen usando los del navegador
        set({ cloud: false })
        return
      }
      set({ cloud: true })
      const remote: Block[] = data.flatMap((r) => {
        const d = clean(r.data)
        return d ? [{ id: r.id, name: r.name, description: r.description ?? undefined, updated: r.updated_at, data: d }] : []
      })
      const byId = new Map(remote.map((b) => [b.id, b]))
      // los del navegador que no están en la cuenta (o son más nuevos) se suben
      const pending = get().blocks.filter((b) => !byId.has(b.id) || byId.get(b.id)!.updated < b.updated)
      for (const b of pending) byId.set(b.id, b)
      setList([...byId.values()])
      if (pending.length) {
        const { error: upErr } = await supabase.from('blocks').upsert(pending.map((b) => toRow(b, userId)))
        if (upErr) set({ cloud: false })
      }
    },

    exportFile: (b) => {
      const file: BlockFile = { app: 'satisfactory-planner', kind: 'block', version: 1, name: b.name, description: b.description, data: b.data }
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = (b.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'bloque') + '.block.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    },

    importFile: async (file) => {
      try {
        const parsed = JSON.parse(await file.text()) as Partial<BlockFile>
        if (parsed.app !== 'satisfactory-planner' || parsed.kind !== 'block') return null
        const data = clean(parsed.data)
        if (!data) return null
        return get().save(String(parsed.name ?? file.name.replace(/\.block\.json$|\.json$/i, '')), String(parsed.description ?? ''), data)
      } catch {
        return null
      }
    },
  }
})

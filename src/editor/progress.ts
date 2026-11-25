import { create } from 'zustand'
import { game, schematicsById, type Building, type Recipe, type Schematic } from '../data/gameData'

/**
 * Progreso del jugador: qué hitos del HUB, investigaciones del M.A.M., recetas alternativas
 * (discos duros) y compras de la Tienda FLIPANTE tiene desbloqueadas.
 * Con el filtro activo, la paleta y el menú de recetas muestran solo lo disponible.
 */

export interface Progress {
  enabled: boolean
  /** fase del Ascensor espacial en la que está el jugador (1–5) */
  phase: number
  unlocked: string[]
}

interface ProgressState extends Progress {
  setEnabled: (v: boolean) => void
  setPhase: (p: number) => void
  toggle: (id: string, on?: boolean) => void
  setMany: (ids: string[], on: boolean) => void
  load: (p: Partial<Progress>) => void
}

const STORAGE_KEY = 'satisfactory-planner:progress'

export const useProgress = create<ProgressState>((set) => ({
  enabled: false,
  phase: 1,
  unlocked: [],
  setEnabled: (enabled) => set({ enabled }),
  setPhase: (phase) => set({ phase }),
  toggle: (id, on) =>
    set((s) => {
      const has = s.unlocked.includes(id)
      const want = on ?? !has
      if (want === has) return s
      return { unlocked: want ? [...s.unlocked, id] : s.unlocked.filter((x) => x !== id) }
    }),
  setMany: (ids, on) =>
    set((s) => {
      const cur = new Set(s.unlocked)
      ids.forEach((id) => (on ? cur.add(id) : cur.delete(id)))
      return { unlocked: [...cur] }
    }),
  load: (p) => set({ enabled: p.enabled ?? false, phase: p.phase ?? 1, unlocked: p.unlocked ?? [] }),
}))

try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) useProgress.getState().load(JSON.parse(saved))
} catch {
  /* se ignora */
}
useProgress.subscribe((s) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: s.enabled, phase: s.phase, unlocked: s.unlocked })),
)

/** Niveles del HUB que habilita cada fase del Ascensor espacial. */
export const PHASE_TIERS: Record<number, number[]> = { 1: [0, 1, 2], 2: [3, 4], 3: [5, 6], 4: [7, 8], 5: [9] }
export const maxTierForPhase = (phase: number) => Math.max(...Object.entries(PHASE_TIERS).filter(([p]) => Number(p) <= phase).flatMap(([, t]) => t))

const recipeIds = new Set([...game.recipes.map((r) => r.id), ...game.buildings.map((b) => b.buildRecipe)])
const usefulSchematic = (s: Schematic) => s.recipes.some((r) => recipeIds.has(r))

export const HUB_SCHEMATICS = game.schematics.filter((s) => s.type === 'milestone' || s.type === 'tutorial')
export const MAM_SCHEMATICS = game.schematics.filter((s) => s.type === 'mam')
export const ALT_SCHEMATICS = game.schematics.filter((s) => s.type === 'alternate' && usefulSchematic(s))
export const SHOP_SCHEMATICS = game.schematics.filter((s) => s.type === 'resourcesink' && usefulSchematic(s))

/** ¿Está disponible algo desbloqueado por estos schematics? */
function available(unlockedBy: string[], unlocked: Set<string>): boolean {
  const known = unlockedBy.filter((id) => schematicsById.has(id))
  // sin schematic conocido (piezas de personalización, etc.): siempre disponible, salvo eventos
  if (!known.length) return !unlockedBy.some((id) => /XMas/i.test(id))
  return known.some((id) => unlocked.has(id))
}

export function useAvailability() {
  const { enabled, unlocked } = useProgress()
  const set = new Set(unlocked)
  return {
    enabled,
    building: (b: Building) => !enabled || available(b.unlockedBy, set),
    recipe: (r: Recipe) => !enabled || available(r.unlockedBy, set),
  }
}

/** Disponibilidad por id fuera de React (atajos y tecla E). */
export function isBuildingIdAvailable(id: string): boolean {
  const { enabled, unlocked } = useProgress.getState()
  const b = game.buildings.find((x) => x.id === id)
  if (!b) return false
  return !enabled || available(b.unlockedBy, new Set(unlocked))
}

import raw from './game-data.json'
import namesEn from './game-names-en.json'

export type CategoryId =
  | 'especial'
  | 'produccion'
  | 'electricidad'
  | 'logistica'
  | 'organizacion'
  | 'transporte'
  | 'cimientos'
  | 'paredes'
  | 'arquitectura'

export type BuildingKind =
  | 'machine'
  | 'miner'
  | 'extractor'
  | 'generator'
  | 'belt'
  | 'lift'
  | 'pipe'
  | 'splitter'
  | 'pipeJunction'
  | 'pump'
  | 'valve'
  | 'foundation'
  | 'wall'
  | 'structure'

export interface ItemAmount {
  item: string
  amount: number
}

export interface Footprint {
  minX: number
  maxX: number
  minY: number
  maxY: number
  height: number
}

export interface Building {
  id: string
  name: string
  description: string
  category: CategoryId
  subcategory: string
  priority: number
  kind: BuildingKind
  footprint: Footprint | null
  ports: { beltIn: number; beltOut: number; pipeIn: number; pipeOut: number }
  powerMW: number
  powerGenMW: number
  cost: ItemAmount[]
  buildRecipe: string
  unlockedBy: string[]
  itemsPerMinute?: number
  flowPerMinute?: number
  extractPerMinute?: number
  /** ranuras para somersloops (amplificación de producción) */
  somersloopSlots?: number
  /** espacios de inventario (contenedores) */
  inventorySlots?: number
}

export interface Recipe {
  id: string
  name: string
  alternate: boolean
  duration: number
  ingredients: ItemAmount[]
  products: ItemAmount[]
  producedIn: string[]
  unlockedBy: string[]
}

export interface Item {
  name: string
  form: 'solid' | 'liquid' | 'gas' | 'invalid'
  /** tamaño de pila: ONE, SMALL (50), MEDIUM (100), BIG (200), HUGE (500), FLUID */
  stackSize: string | null
  sinkPoints: number | null
  energyMJ: number | null
}

export interface Schematic {
  id: string
  name: string
  type: 'milestone' | 'mam' | 'alternate' | 'resourcesink' | 'tutorial'
  tier: number
  cost: ItemAmount[]
  recipes: string[]
  dependencies: string[]
  mamTree: string | null
}

interface GameData {
  phases: { phase: number; tiers: number[] }[]
  buildings: Building[]
  recipes: Recipe[]
  items: Record<string, Item>
  schematics: Schematic[]
}

export const game = raw as unknown as GameData

export const buildingsById = new Map(game.buildings.map((b) => [b.id, b]))
export const recipesById = new Map(game.recipes.map((r) => [r.id, r]))
export const schematicsById = new Map(game.schematics.map((s) => [s.id, s]))
export const itemName = (id: string) => game.items[id]?.name ?? id

// ---------- nombres del juego según idioma ----------
// Los datos se generan en español (es-ES.json del juego); los nombres en inglés salen de en-US.json
// (scripts/extract-names.mjs). Al cambiar de idioma se reemplazan en el lugar y la app se vuelve a
// dibujar entera (ver main.tsx), así todo lo que lee `.name` queda en el idioma elegido.
const NAMES_ES = {
  items: Object.fromEntries(Object.entries(game.items).map(([id, i]) => [id, i.name])),
  buildings: Object.fromEntries(game.buildings.map((b) => [b.id, { name: b.name, description: b.description }])),
  recipes: Object.fromEntries(game.recipes.map((r) => [r.id, r.name])),
  schematics: Object.fromEntries(game.schematics.map((s) => [s.id, s.name])),
}
const NAMES: Record<'es' | 'en', typeof NAMES_ES> = { es: NAMES_ES, en: namesEn as typeof NAMES_ES }
let gameLanguage: 'es' | 'en' = 'es'
export const getGameLanguage = () => gameLanguage

export function setGameLanguage(lang: 'es' | 'en') {
  gameLanguage = lang
  const n = NAMES[lang]
  for (const [id, it] of Object.entries(game.items)) it.name = n.items[id] ?? NAMES_ES.items[id]
  for (const b of game.buildings) {
    const x = n.buildings[b.id] ?? NAMES_ES.buildings[b.id]
    b.name = x.name
    b.description = x.description
  }
  for (const r of game.recipes) r.name = n.recipes[r.id] ?? NAMES_ES.recipes[r.id]
  for (const s of game.schematics) s.name = n.schematics[s.id] ?? NAMES_ES.schematics[s.id]
}

export const CATEGORIES: { id: CategoryId; name: string }[] = [
  { id: 'especial', name: 'Especial' },
  { id: 'produccion', name: 'Producción' },
  { id: 'electricidad', name: 'Electricidad' },
  { id: 'logistica', name: 'Logística' },
  { id: 'organizacion', name: 'Organización' },
  { id: 'transporte', name: 'Transporte' },
  { id: 'cimientos', name: 'Cimientos' },
  { id: 'paredes', name: 'Paredes' },
  { id: 'arquitectura', name: 'Arquitectura' },
]

/** Edificios que se dibujan como trazado (no como rectángulo colocable). */
export const isPathKind = (k: BuildingKind) => k === 'belt' || k === 'pipe'

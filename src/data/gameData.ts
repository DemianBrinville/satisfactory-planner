import raw from './game-data.json'

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

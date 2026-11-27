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
  | 'hyper'
  | 'splitter'
  | 'pipeJunction'
  | 'pump'
  | 'valve'
  | 'foundation'
  | 'wall'
  | 'designer'
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
  /** id de la subcategoría del juego (SC_…), para traducirla */
  subcategoryId?: string
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
  /** diseñador de planos: lado (y alto) de la zona de construcción en metros */
  designerArea?: number
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
  /** máquinas de potencia variable: el consumo va de variablePower a variablePower + variablePowerRange MW en cada ciclo */
  variablePower?: number | null
  variablePowerRange?: number | null
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

/** Edificios cuyo consumo depende de la receta (acelerador de partículas, convertidor, codificador cuántico). */
// (solo los que no tienen consumo fijo: algunas recetas del ensamblador o la licuadora traen datos de potencia
// variable que el juego ignora en esas máquinas)
const VARIABLE_POWER = new Set(
  game.recipes
    .filter((r) => r.variablePowerRange != null)
    .flatMap((r) => r.producedIn)
    .filter((id) => !(buildingsById.get(id)?.powerMW ?? 0)),
)
export const isVariablePower = (b: Building) => VARIABLE_POWER.has(b.id)
/** Usa energía (consumo fijo o variable según la receta). */
export const usesPower = (b: Building) => b.powerMW > 0 || isVariablePower(b)

/** Consumo mínimo y máximo de una receta de potencia variable a lo largo de su ciclo (MW, al 100 %). */
export function recipePowerRange(r: Recipe | undefined): [number, number] | null {
  if (!r || r.variablePowerRange == null) return null
  const min = r.variablePower ?? 0
  return [min, min + r.variablePowerRange]
}

/**
 * Consumo base al 100 % de un edificio con su receta. En las de potencia variable el juego sube y baja el
 * consumo a lo largo del ciclo; en promedio es el punto medio entre el mínimo y el máximo (wiki).
 */
export function basePowerMW(b: Building, recipeId?: string): number {
  if (!isVariablePower(b)) return b.powerMW
  const range = recipePowerRange(recipeId ? recipesById.get(recipeId) : undefined)
  return range ? (range[0] + range[1]) / 2 : 0
}

/** Rango de consumo de un edificio de potencia variable entre todas sus recetas (para la paleta). */
export function buildingPowerRange(b: Building): [number, number] | null {
  if (!isVariablePower(b)) return null
  const rs = game.recipes.filter((r) => r.producedIn.includes(b.id)).map(recipePowerRange).filter((x): x is [number, number] => !!x)
  return rs.length ? [Math.min(...rs.map((x) => x[0])), Math.max(...rs.map((x) => x[1]))] : null
}
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
type Names = typeof NAMES_ES
/** nombres de cada idioma, cargados cuando se eligen (data/names/<idioma>.json, sacados del juego) */
const NAME_FILES = import.meta.glob<{ default: Names }>('./names/*.json')
const NAMES: Record<string, Names> = { es: NAMES_ES }
let gameLanguage = 'es'
export const getGameLanguage = () => gameLanguage

/** Trae los nombres del juego de un idioma (si no están cargados). */
export async function loadGameNames(lang: string) {
  if (NAMES[lang]) return
  const file = NAME_FILES[`./names/${lang}.json`]
  if (file) NAMES[lang] = (await file()).default
}

export function setGameLanguage(lang: string) {
  const n = NAMES[lang] ?? NAMES_ES
  gameLanguage = NAMES[lang] ? lang : 'es'
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
export const isPathKind = (k: BuildingKind) => k === 'belt' || k === 'pipe' || k === 'hyper'

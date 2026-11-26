import i18n from '../i18n'
import { buildingsById, game, type Recipe } from '../data/gameData'
import { MINER_RESOURCES } from './flow'

/**
 * Calculadora de objetivo: a partir de "quiero X/min de tal producto" arma la cadena de
 * producción hacia atrás hasta las materias primas.
 */

/** Recursos que se extraen (no se fabrican). */
export const RAW_ITEMS = new Set([
  ...MINER_RESOURCES,
  'Desc_Water_C',
  'Desc_LiquidOil_C',
  'Desc_NitrogenGas_C',
])

export interface Step {
  item: string
  /** unidades por minuto que hay que producir */
  rate: number
  recipe: Recipe
  building: string
  /** máquinas exactas (puede ser fraccionario) */
  exact: number
  /** profundidad: 0 = producto final */
  depth: number
  /** consumo eléctrico total al reloj sugerido (MW) */
  power: number
}

export interface ChainResult {
  steps: Step[]
  raw: Map<string, number>
  byproducts: Map<string, number>
  /** ítems que no se pudieron resolver (sin receta disponible) */
  missing: Set<string>
}

const perMin = (r: Recipe, item: string, side: 'products' | 'ingredients') =>
  ((r[side].find((x) => x.item === item)?.amount ?? 0) * 60) / r.duration

/** Recetas de máquinas (no del banco de trabajo) que producen un ítem. */
export function recipesProducing(item: string, available: (r: Recipe) => boolean = () => true): Recipe[] {
  return game.recipes
    .filter((r) => r.products.some((p) => p.item === item) && r.producedIn.some((b) => buildingsById.get(b)?.kind === 'machine'))
    .filter(available)
    .sort((a, b) => score(a, item) - score(b, item))
}

/** Preferencia de receta por defecto: la que se llama como el producto, luego estándar, luego el resto. */
function score(r: Recipe, item: string): number {
  let s = 0
  if (r.alternate) s += 10
  if (r.name !== game.items[item]?.name) s += 3
  if (r.products[0]?.item !== item) s += 2
  return s
}

/** Ítems que se pueden pedir como objetivo (productos de alguna receta de máquina). */
export function producibleItems(): string[] {
  const s = new Set<string>()
  for (const r of game.recipes) {
    if (!r.producedIn.some((b) => buildingsById.get(b)?.kind === 'machine')) continue
    for (const p of r.products) if (!RAW_ITEMS.has(p.item)) s.add(p.item)
  }
  return [...s].sort((a, b) => (game.items[a]?.name ?? a).localeCompare(game.items[b]?.name ?? b))
}

/**
 * Resuelve la cadena. `choice` fija la receta de un ítem; si no, se usa la estándar disponible.
 * Los ítems de `treatAsInput` se consideran provistos desde afuera (no se fabrican).
 */
export function solveChain(
  target: string,
  rate: number,
  choice: Record<string, string>,
  available: (r: Recipe) => boolean,
  treatAsInput: Set<string> = new Set(),
): ChainResult {
  // acumula la demanda total por ítem respetando el orden (un ítem se expande después de todo lo que lo pide)
  const demand = new Map<string, number>()
  const depth = new Map<string, number>()
  const recipeOf = new Map<string, Recipe>()
  const raw = new Map<string, number>()
  const byproducts = new Map<string, number>()
  const missing = new Set<string>()

  const pick = (item: string): Recipe | null => {
    const opts = recipesProducing(item, available)
    const chosen = choice[item] ? opts.find((r) => r.id === choice[item]) ?? game.recipes.find((r) => r.id === choice[item]) : undefined
    return chosen ?? opts[0] ?? null
  }

  // orden topológico por profundidad máxima (hasta 25 niveles para cortar ciclos de alternativas)
  const visit = (item: string, d: number, path: Set<string>) => {
    if (d > 25 || path.has(item)) return
    depth.set(item, Math.max(depth.get(item) ?? 0, d))
    if (RAW_ITEMS.has(item) || treatAsInput.has(item)) return
    const r = pick(item)
    if (!r) return
    recipeOf.set(item, r)
    const next = new Set(path).add(item)
    for (const ing of r.ingredients) visit(ing.item, d + 1, next)
  }
  visit(target, 0, new Set())

  demand.set(target, rate)
  const order = [...depth.keys()].sort((a, b) => depth.get(a)! - depth.get(b)!)
  const steps: Step[] = []
  for (const item of order) {
    const need = demand.get(item) ?? 0
    if (need <= 1e-9) continue
    if (RAW_ITEMS.has(item) || treatAsInput.has(item)) {
      raw.set(item, (raw.get(item) ?? 0) + need)
      continue
    }
    const r = recipeOf.get(item)
    if (!r) {
      missing.add(item)
      raw.set(item, (raw.get(item) ?? 0) + need)
      continue
    }
    const out = perMin(r, item, 'products')
    const exact = need / out
    const building = r.producedIn.find((b) => buildingsById.get(b)?.kind === 'machine') ?? r.producedIn[0]
    const b = buildingsById.get(building)
    const machines = Math.ceil(exact - 1e-9)
    const clock = machines > 0 ? exact / machines : 0
    steps.push({
      item,
      rate: need,
      recipe: r,
      building,
      exact,
      depth: depth.get(item)!,
      power: (b?.powerMW ?? 0) * machines * Math.pow(clock, 1.321928),
    })
    for (const ing of r.ingredients) demand.set(ing.item, (demand.get(ing.item) ?? 0) + perMin(r, ing.item, 'ingredients') * exact)
    for (const p of r.products) if (p.item !== item) byproducts.set(p.item, (byproducts.get(p.item) ?? 0) + perMin(r, p.item, 'products') * exact)
  }
  return { steps, raw, byproducts, missing }
}

/** Reparto en máquinas: todas iguales (n al mismo reloj) o n−1 al 100 % y una con el resto. */
export function machineSplit(exact: number) {
  const n = Math.max(1, Math.ceil(exact - 1e-9))
  const even = exact / n
  const full = Math.floor(exact + 1e-9)
  const rest = exact - full
  return { n, even, full, rest }
}

/** Taladros necesarios para una materia prima en yacimientos normales. */
export function minersFor(item: string, rate: number) {
  if (item === 'Desc_Water_C') return { label: i18n.t('calc.minersWater'), base: 120, count: rate / 120 }
  if (item === 'Desc_LiquidOil_C') return { label: i18n.t('calc.minersOil'), base: 120, count: rate / 120 }
  if (item === 'Desc_NitrogenGas_C') return { label: i18n.t('calc.minersWell'), base: 60, count: rate / 60 }
  return { label: i18n.t('calc.minersOre'), base: 60, count: rate / 60 }
}

/**
 * Distribuye las máquinas de la cadena en columnas (de las materias primas a la izquierda al
 * producto final a la derecha), con la salida mirando hacia la derecha y la receta y el reloj ya
 * configurados. Se ubica a la derecha de lo que ya hay en el piso.
 */
export function layoutChain(
  steps: Step[],
  floor: number,
  existing: { x0: number; x1: number; y0: number }[],
  split: 'even' | 'full',
): PlacedLayout[] {
  const out: PlacedLayout[] = []
  const maxDepth = Math.max(0, ...steps.map((s) => s.depth))
  let colX = existing.length ? Math.ceil(Math.max(...existing.map((r) => r.x1)) / 8) * 8 + 16 : 0
  const top = existing.length ? Math.floor(Math.min(...existing.map((r) => r.y0)) / 8) * 8 : 0
  for (let d = maxDepth; d >= 0; d--) {
    const col = steps.filter((s) => s.depth === d)
    if (!col.length) continue
    let y = top
    let colW = 0
    for (const s of col) {
      const b = buildingsById.get(s.building)
      if (!b?.footprint) continue
      // con rotación 90° el frente (salida) mira a la derecha: largo en x, ancho en y
      const len = b.footprint.maxY - b.footprint.minY
      const wid = b.footprint.maxX - b.footprint.minX
      const { n, even, full, rest } = machineSplit(s.exact)
      for (let i = 0; i < n; i++) {
        const clock = split === 'even' ? even : i < full ? 1 : rest
        if (clock <= 1e-6) continue
        out.push({ buildingId: s.building, recipeId: s.recipe.id, clock: Math.round(clock * 10000) / 10000, floor, rect: { x0: colX, y0: y, w: len, h: wid } })
        y += Math.ceil(wid) + 2
      }
      y += 4
      colW = Math.max(colW, len)
    }
    colX += Math.ceil(colW) + 12
  }
  return out
}

export interface PlacedLayout {
  buildingId: string
  recipeId: string
  clock: number
  floor: number
  /** rectángulo deseado en el mundo (m) */
  rect: { x0: number; y0: number; w: number; h: number }
}

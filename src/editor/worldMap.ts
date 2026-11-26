import raw from '../data/map-nodes.json'
import type { Building } from '../data/gameData'
import { toWorld, type Rotation, type Vec } from './geometry'
import type { PlacedEntity, Purity } from './store'

/**
 * Mapa real del juego: yacimientos extraídos del juego instalado (scripts/map-extract) y la imagen
 * del mapa (public/map/map.jpg). Las coordenadas del juego están en metros: x hacia el este, y hacia el sur.
 */
export interface MapPlacement {
  /** punto del juego (m) que corresponde al origen (0, 0) del plano */
  x: number
  y: number
  /** giro de la cuadrícula del plano respecto del norte del juego, en grados (horario) */
  angle: number
  /** se ve la imagen del mapa de fondo */
  show: boolean
  /** se ven los yacimientos */
  nodes: boolean
  /** opacidad de la imagen (0–1) */
  opacity: number
}

export const DEFAULT_MAP: Omit<MapPlacement, 'x' | 'y'> = { angle: 0, show: true, nodes: true, opacity: 0.55 }
export const MAP_IMAGE = '/map/map.jpg'

/** Cuadrado del mundo que cubre la imagen del mapa (m), sacado del actor de captura del minimapa. */
export const MAP_BOUNDS: { x0: number; y0: number; size: number } = raw.bounds

export type SpotKind = 'node' | 'satellite' | 'core' | 'geyser'
export interface Spot {
  id: string
  kind: SpotKind
  /** recurso (Desc_…); en los núcleos de pozo, el del pozo */
  resource: string
  purity: Purity | null
  x: number
  y: number
  z: number
}

const PUR: Purity[] = ['impure', 'normal', 'pure']
const GEYSER = 'Desc_Geyser_C'

export const SPOTS: Spot[] = [
  ...(raw.nodes as [string, number, number, number, number][]).map(([resource, p, x, y, z], i) => ({ id: 'n' + i, kind: 'node' as const, resource, purity: PUR[p], x, y, z })),
  ...(raw.geysers as number[][]).map(([p, x, y, z], i) => ({ id: 'g' + i, kind: 'geyser' as const, resource: GEYSER, purity: PUR[p], x, y, z })),
  ...raw.wells.flatMap((w, i) => [
    { id: 'w' + i, kind: 'core' as const, resource: w.resource, purity: null, x: w.x, y: w.y, z: w.z },
    ...(w.sats as number[][]).map(([p, x, y, z], j) => ({ id: `w${i}s${j}`, kind: 'satellite' as const, resource: w.resource, purity: PUR[p], x, y, z })),
  ]),
]

/** Qué yacimientos usa cada extractor (null: no necesita uno, como la bomba de agua). */
export function spotKindFor(b: Building): { kind: SpotKind; resources?: (r: string) => boolean } | null {
  if (b.kind === 'miner') return { kind: 'node', resources: (r) => r !== 'Desc_LiquidOil_C' }
  if (/OilPump/.test(b.id)) return { kind: 'node', resources: (r) => r === 'Desc_LiquidOil_C' }
  if (/FrackingExtractor/.test(b.id)) return { kind: 'satellite' }
  if (/FrackingSmasher/.test(b.id)) return { kind: 'core' }
  if (/GeoThermal/i.test(b.id)) return { kind: 'geyser' }
  return null
}

const rad = (deg: number) => (deg * Math.PI) / 180

/** Punto del juego (m) → punto del plano. */
export function toPlan(g: Vec, m: MapPlacement): Vec {
  const dx = g.x - m.x
  const dy = g.y - m.y
  const c = Math.cos(rad(-m.angle))
  const s = Math.sin(rad(-m.angle))
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

/** Punto del plano → punto del juego (m). */
export function toGame(p: Vec, m: MapPlacement): Vec {
  const c = Math.cos(rad(m.angle))
  const s = Math.sin(rad(m.angle))
  return { x: m.x + p.x * c - p.y * s, y: m.y + p.x * s + p.y * c }
}

export interface PlanSpot extends Spot {
  px: number
  py: number
}

let cacheKey = ''
let cache: PlanSpot[] = []
/** Yacimientos en coordenadas del plano. */
export function spotsInPlan(m: MapPlacement): PlanSpot[] {
  const key = `${m.x},${m.y},${m.angle}`
  if (key !== cacheKey) {
    cacheKey = key
    cache = SPOTS.map((s) => {
      const p = toPlan(s, m)
      return { ...s, px: p.x, py: p.y }
    })
  }
  return cache
}

/** Punto de extracción del edificio (centro del taladro, de la cabeza del extractor…) en el plano. */
export const extractionPoint = (b: Building, anchor: Vec, rot: Rotation): Vec => toWorld(b, anchor, rot, { x: 0, y: 0 })

/** Anclaje para que el punto de extracción quede justo sobre el yacimiento. */
export function anchorOnSpot(b: Building, spot: Vec, rot: Rotation): Vec {
  const e = extractionPoint(b, { x: 0, y: 0 }, rot)
  return { x: Math.round((spot.x - e.x) * 100) / 100, y: Math.round((spot.y - e.y) * 100) / 100 }
}

const fits = (b: Building, s: Spot) => {
  const k = spotKindFor(b)
  return !!k && s.kind === k.kind && (!k.resources || k.resources(s.resource))
}

/** Yacimiento compatible más cercano al punto del plano, dentro de un radio (m). */
export function nearestSpot(b: Building, p: Vec, m: MapPlacement, radius: number): PlanSpot | null {
  let best: PlanSpot | null = null
  let bd = radius
  for (const s of spotsInPlan(m)) {
    if (!fits(b, s)) continue
    const d = Math.hypot(s.px - p.x, s.py - p.y)
    if (d <= bd) {
      bd = d
      best = s
    }
  }
  return best
}

/** Yacimiento sobre el que está un extractor ya colocado (null si no está sobre uno compatible). */
export function spotUnder(e: PlacedEntity, b: Building, m: MapPlacement): PlanSpot | null {
  return nearestSpot(b, extractionPoint(b, e, e.rot), m, 1)
}

/** Lo que el extractor toma del yacimiento: recurso y pureza (los núcleos de pozo no tienen pureza). */
export function spotPatch(s: Spot): Partial<PlacedEntity> {
  if (s.kind === 'core') return { resource: s.resource }
  if (s.kind === 'geyser') return { purity: s.purity ?? 'normal' }
  return { resource: s.resource, purity: s.purity ?? 'normal' }
}

/** Colores de los yacimientos por recurso (para el plano y el selector del mapa). */
export const SPOT_COLOR: Record<string, string> = {
  Desc_OreIron_C: '#c9624f',
  Desc_OreCopper_C: '#e0883c',
  Desc_Stone_C: '#d9d3c4',
  Desc_Coal_C: '#3a3a3a',
  Desc_OreGold_C: '#e8c547',
  Desc_RawQuartz_C: '#e58fd0',
  Desc_Sulfur_C: '#d8e24a',
  Desc_OreBauxite_C: '#b5643c',
  Desc_OreUranium_C: '#5fd35a',
  Desc_SAM_C: '#9a5ee0',
  Desc_LiquidOil_C: '#5b3a8a',
  Desc_Water_C: '#4aa3df',
  Desc_NitrogenGas_C: '#9fb6c8',
  Desc_Geyser_C: '#6fd6c9',
}
export const spotColor = (r: string) => SPOT_COLOR[r] ?? '#cccccc'

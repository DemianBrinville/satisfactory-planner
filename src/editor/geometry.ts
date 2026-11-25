import type { Building, Footprint } from '../data/gameData'

/** Rotación en pasos de 90° en sentido horario (vista desde arriba, y hacia abajo). */
export type Rotation = 0 | 90 | 180 | 270

export interface Vec {
  x: number
  y: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Lado del cimiento (m). */
export const FOUNDATION = 8

/**
 * Convención de coordenadas locales de un edificio (en metros):
 *  - x: a lo ancho; y: a lo largo.
 *  - El FRENTE (lado de salida) es el borde y = minY. Con rotación 0 mira hacia arriba.
 */

/** Huella con alternativa para objetos sin cajas de colisión en los datos del juego. */
export function footprintOf(b: Building): Footprint {
  const f = b.footprint
  if (f && f.maxX - f.minX > 0.1 && f.maxY - f.minY > 0.1) return f
  switch (b.kind) {
    case 'lift':
      return { minX: -1, maxX: 1, minY: -1, maxY: 1, height: 1 }
    default:
      return { minX: -1, maxX: 1, minY: -0.5, maxY: 0.5, height: 1 }
  }
}

export type SnapMode = 'foundationAnchor' | 'foundationCorner' | 'meter'

export function snapModeOf(b: Building): SnapMode {
  switch (b.kind) {
    case 'machine':
    case 'miner':
    case 'extractor':
    case 'generator':
      return 'foundationAnchor'
    case 'foundation':
    case 'wall':
      return 'foundationCorner'
    default:
      return 'meter'
  }
}

/**
 * Punto de anclaje en coordenadas locales.
 * Máquinas: centrado a lo ancho y 4 m detrás del frente (lado de salida), como en el juego:
 * el frente queda al ras del cimiento y lo que sobra asoma por detrás.
 * Resto: centro de la huella.
 */
export function anchorLocal(b: Building): Vec {
  const f = footprintOf(b)
  const cx = (f.minX + f.maxX) / 2
  if (snapModeOf(b) === 'foundationAnchor') return { x: cx, y: f.minY + FOUNDATION / 2 }
  return { x: cx, y: (f.minY + f.maxY) / 2 }
}

export function rotate(v: Vec, rot: Rotation): Vec {
  switch (rot) {
    case 0:
      return v
    case 90:
      return { x: -v.y, y: v.x }
    case 180:
      return { x: -v.x, y: -v.y }
    case 270:
      return { x: v.y, y: -v.x }
  }
}

/** Local → mundo, dado el anclaje en el mundo. */
export function toWorld(b: Building, anchor: Vec, rot: Rotation, local: Vec): Vec {
  const a = anchorLocal(b)
  const r = rotate({ x: local.x - a.x, y: local.y - a.y }, rot)
  return { x: anchor.x + r.x, y: anchor.y + r.y }
}

/** Rectángulo ocupado en el mundo (siempre alineado a los ejes por girar de a 90°). */
export function worldRect(b: Building, anchor: Vec, rot: Rotation): Rect {
  const f = footprintOf(b)
  const p = toWorld(b, anchor, rot, { x: f.minX, y: f.minY })
  const q = toWorld(b, anchor, rot, { x: f.maxX, y: f.maxY })
  return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) }
}

/** Ajusta la posición del mouse (mundo) a la posición válida más cercana para el anclaje. */
export function snapAnchor(b: Building, mouse: Vec, rot: Rotation): Vec {
  const mode = snapModeOf(b)
  if (mode === 'foundationAnchor') {
    // El anclaje cae en el centro de un cimiento.
    const s = (v: number) => Math.floor(v / FOUNDATION) * FOUNDATION + FOUNDATION / 2
    return { x: s(mouse.x), y: s(mouse.y) }
  }
  if (mode === 'foundationCorner') {
    // La esquina de la pieza cae en la cuadrícula de cimientos (o de 1 m si es más chica).
    const f = footprintOf(b)
    const rotated = rot === 90 || rot === 270
    const w = rotated ? f.maxY - f.minY : f.maxX - f.minX
    const h = rotated ? f.maxX - f.minX : f.maxY - f.minY
    const stepX = w >= FOUNDATION ? FOUNDATION : 1
    const stepY = h >= FOUNDATION ? FOUNDATION : 1
    const x0 = Math.round((mouse.x - w / 2) / stepX) * stepX
    const y0 = Math.round((mouse.y - h / 2) / stepY) * stepY
    return { x: x0 + w / 2, y: y0 + h / 2 }
  }
  // Libre en pasos de 1 m: se alinea el borde para que objetos de medida entera calcen en la cuadrícula.
  const r = worldRect(b, { x: 0, y: 0 }, rot)
  const w = r.x1 - r.x0
  const h = r.y1 - r.y0
  const x0 = Math.round(mouse.x - w / 2)
  const y0 = Math.round(mouse.y - h / 2)
  return { x: x0 - r.x0, y: y0 - r.y0 }
}

export const rectsOverlap = (a: Rect, b: Rect, eps = 0.01) =>
  a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps

export const rectContainsPoint = (r: Rect, p: Vec) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1

export const normRect = (a: Vec, b: Vec): Rect => ({
  x0: Math.min(a.x, b.x),
  y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x),
  y1: Math.max(a.y, b.y),
})

// ---------------- puertos ----------------

export type PortKind = 'belt' | 'pipe'
export type PortDir = 'in' | 'out'

export interface PortDef {
  kind: PortKind
  dir: PortDir
  /** posición local (en el borde de la huella) */
  pos: Vec
  /** dirección local hacia afuera del edificio */
  normal: Vec
}

/**
 * Aproximación de la posición de los puertos (los datos del juego no la incluyen):
 * salidas repartidas a lo ancho del frente, entradas repartidas en la parte trasera.
 * Divisores y uniones: 1 entrada atrás y 3 salidas (o al revés) en los otros lados.
 */
export function portsOf(b: Building): PortDef[] {
  const f = footprintOf(b)
  const ports: PortDef[] = []
  const front = { x: 0, y: -1 }
  const back = { x: 0, y: 1 }
  const left = { x: -1, y: 0 }
  const right = { x: 1, y: 0 }
  const cx = (f.minX + f.maxX) / 2
  const cy = (f.minY + f.maxY) / 2

  if (b.kind === 'splitter') {
    const merger = /Merger/.test(b.id)
    const one: PortDir = merger ? 'out' : 'in'
    const three: PortDir = merger ? 'in' : 'out'
    ports.push({ kind: 'belt', dir: one, pos: { x: cx, y: merger ? f.minY : f.maxY }, normal: merger ? front : back })
    ports.push({ kind: 'belt', dir: three, pos: { x: cx, y: merger ? f.maxY : f.minY }, normal: merger ? back : front })
    ports.push({ kind: 'belt', dir: three, pos: { x: f.minX, y: cy }, normal: left })
    ports.push({ kind: 'belt', dir: three, pos: { x: f.maxX, y: cy }, normal: right })
    return ports
  }
  if (b.kind === 'pipeJunction') {
    const n = /Cross/.test(b.id) ? 4 : 3
    const sides = [
      { pos: { x: cx, y: f.minY }, normal: front },
      { pos: { x: f.maxX, y: cy }, normal: right },
      { pos: { x: cx, y: f.maxY }, normal: back },
      { pos: { x: f.minX, y: cy }, normal: left },
    ].slice(0, n)
    // las uniones de tubería son bidireccionales: se marcan como salida y se tratan como neutras
    sides.forEach((s) => ports.push({ kind: 'pipe', dir: 'out', ...s }))
    return ports
  }
  if (b.kind === 'pump' || b.kind === 'valve') {
    ports.push({ kind: 'pipe', dir: 'out', pos: { x: cx, y: f.minY }, normal: front })
    ports.push({ kind: 'pipe', dir: 'in', pos: { x: cx, y: f.maxY }, normal: back })
    return ports
  }

  const { beltIn, beltOut, pipeIn, pipeOut } = b.ports
  const spread = (n: number, i: number) => f.minX + ((f.maxX - f.minX) * (i + 0.5)) / n
  const outs: PortKind[] = [...Array(beltOut).fill('belt'), ...Array(pipeOut).fill('pipe')]
  const ins: PortKind[] = [...Array(beltIn).fill('belt'), ...Array(pipeIn).fill('pipe')]
  outs.forEach((kind, i) => ports.push({ kind, dir: 'out', pos: { x: spread(outs.length, i), y: f.minY }, normal: front }))
  ins.forEach((kind, i) => ports.push({ kind, dir: 'in', pos: { x: spread(ins.length, i), y: f.maxY }, normal: back }))
  return ports
}

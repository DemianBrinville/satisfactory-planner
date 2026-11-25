import type { Vec } from './geometry'

/**
 * Trazado "por defecto" del juego: una recta lo más directa posible con curvas de radio mínimo
 * en los extremos para alinearse con los puertos/postes (curvas de Dubins).
 * Ángulos en radianes con la convención de atan2 sobre las coordenadas del plano.
 */

export const TURN_RADIUS = 2
const TAU = Math.PI * 2
const mod = (a: number) => ((a % TAU) + TAU) % TAU

interface Pose {
  x: number
  y: number
  th: number
}

type Seg = { type: 'L' | 'R' | 'S'; len: number }

/** Recorre una secuencia de tramos y devuelve puntos muestreados. */
function sample(start: Pose, segs: Seg[], r: number): Vec[] {
  const pts: Vec[] = [{ x: start.x, y: start.y }]
  let { x, y, th } = start
  for (const s of segs) {
    if (s.type === 'S') {
      x += Math.cos(th) * s.len
      y += Math.sin(th) * s.len
      pts.push({ x, y })
      continue
    }
    const sign = s.type === 'L' ? 1 : -1
    const cx = x - sign * r * Math.sin(th)
    const cy = y + sign * r * Math.cos(th)
    const total = s.len / r
    const steps = Math.max(2, Math.ceil(total / 0.2))
    for (let i = 1; i <= steps; i++) {
      const a = th + (sign * total * i) / steps
      pts.push({ x: cx + sign * r * Math.sin(a), y: cy - sign * r * Math.cos(a) })
    }
    th += sign * total
    x = pts[pts.length - 1].x
    y = pts[pts.length - 1].y
  }
  return pts
}

/** Curva-Recta-Curva más corta entre dos poses (LSL, RSR, LSR, RSL). */
function dubins(p0: Pose, p1: Pose, r: number): { segs: Seg[]; len: number } | null {
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const d = Math.hypot(dx, dy) / r
  const theta = Math.atan2(dy, dx)
  const a = mod(p0.th - theta)
  const b = mod(p1.th - theta)
  const sa = Math.sin(a)
  const sb = Math.sin(b)
  const ca = Math.cos(a)
  const cb = Math.cos(b)
  const cab = Math.cos(a - b)
  const opts: { segs: Seg[]; len: number }[] = []
  const push = (types: ['L' | 'R', 'L' | 'R'], t: number, p: number, q: number) =>
    opts.push({
      segs: [
        { type: types[0], len: t * r },
        { type: 'S', len: p * r },
        { type: types[1], len: q * r },
      ],
      len: (t + p + q) * r,
    })
  // LSL
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sa - sb)
    if (p2 >= 0) {
      const tmp = Math.atan2(cb - ca, d + sa - sb)
      push(['L', 'L'], mod(-a + tmp), Math.sqrt(p2), mod(b - tmp))
    }
  }
  // RSR
  {
    const p2 = 2 + d * d - 2 * cab + 2 * d * (sb - sa)
    if (p2 >= 0) {
      const tmp = Math.atan2(ca - cb, d - sa + sb)
      push(['R', 'R'], mod(a - tmp), Math.sqrt(p2), mod(-b + tmp))
    }
  }
  // LSR
  {
    const p2 = -2 + d * d + 2 * cab + 2 * d * (sa + sb)
    if (p2 >= 0) {
      const p = Math.sqrt(p2)
      const tmp = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p)
      push(['L', 'R'], mod(-a + tmp), p, mod(-mod(b) + tmp))
    }
  }
  // RSL
  {
    const p2 = d * d - 2 + 2 * cab - 2 * d * (sa + sb)
    if (p2 >= 0) {
      const p = Math.sqrt(p2)
      const tmp = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p)
      push(['R', 'L'], mod(a - tmp), p, mod(b - tmp))
    }
  }
  if (!opts.length) return null
  return opts.reduce((m, o) => (o.len < m.len ? o : m))
}

/** Curva y luego recta hacia un punto (solo el inicio tiene dirección). */
function curveThenStraight(p0: Pose, target: Vec, r: number): { segs: Seg[]; len: number } | null {
  let best: { segs: Seg[]; len: number } | null = null
  for (const side of ['L', 'R'] as const) {
    const sign = side === 'L' ? 1 : -1
    const cx = p0.x - sign * r * Math.sin(p0.th)
    const cy = p0.y + sign * r * Math.cos(p0.th)
    const dx = target.x - cx
    const dy = target.y - cy
    const d = Math.hypot(dx, dy)
    if (d < r) continue
    const beta = Math.atan2(dy, dx)
    const phi = beta + sign * Math.asin(r / d)
    const arc = mod(sign * (phi - p0.th))
    const straight = Math.sqrt(d * d - r * r)
    const cand = { segs: [{ type: side, len: arc * r }, { type: 'S' as const, len: straight }], len: arc * r + straight }
    if (!best || cand.len < best.len) best = cand
  }
  return best
}

/**
 * @param start  posición y rumbo de salida (rumbo null = libre)
 * @param end    posición y rumbo de llegada (rumbo null = libre)
 */
export function curvedPath(start: Vec, startTh: number | null, end: Vec, endTh: number | null, r = TURN_RADIUS): Vec[] {
  if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) return [start, end]
  if (startTh !== null && endTh !== null) {
    const p0 = { ...start, th: startTh }
    const res = dubins(p0, { ...end, th: endTh }, r)
    if (res) return snapEnd(sample(p0, res.segs, r), end)
  }
  if (startTh !== null) {
    const p0 = { ...start, th: startTh }
    const res = curveThenStraight(p0, end, r)
    if (res) return snapEnd(sample(p0, res.segs, r), end)
  }
  if (endTh !== null) {
    // se calcula desde el final yendo hacia atrás y se invierte
    const p0 = { ...end, th: endTh + Math.PI }
    const res = curveThenStraight(p0, start, r)
    if (res) return snapEnd(sample(p0, res.segs, r), start).reverse()
  }
  return [start, end]
}

/** Corrige el error numérico para que el último punto caiga exactamente en el destino. */
function snapEnd(pts: Vec[], end: Vec): Vec[] {
  pts[pts.length - 1] = { ...end }
  return pts
}

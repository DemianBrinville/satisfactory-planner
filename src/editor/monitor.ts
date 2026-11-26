import { buildingsById } from '../data/gameData'
import type { Vec } from './geometry'
import type { Conveyor, PlacedEntity } from './store'

/** Monitor de rendimiento de la cinta: se acopla a una cinta y mide cuántas piezas pasan por minuto. */
export const isBeltMonitor = (id: string) => id === 'Build_ConveyorMonitor_C'

/** Punto más cercano de un recorrido, con la dirección del tramo y la distancia. */
export function closestOnPath(p: Vec, pts: Vec[]): { pos: Vec; deg: number; d: number } | null {
  let best: { pos: Vec; deg: number; d: number } | null = null
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const L = dx * dx + dy * dy
    if (!L) continue
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L))
    const q = { x: a.x + dx * t, y: a.y + dy * t }
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (!best || d < best.d) best = { pos: q, deg: (Math.atan2(dy, dx) * 180) / Math.PI, d }
  }
  return best
}

const isBelt = (c: Conveyor) => buildingsById.get(c.buildingId)?.kind === 'belt'

/** Cinta más cercana a un punto de un piso (dentro de `radius` m), con el punto y la dirección. */
export function nearestBelt(p: Vec, floor: number, conveyors: Conveyor[], radius: number) {
  let best: { c: Conveyor; pos: Vec; deg: number; d: number } | null = null
  for (const c of conveyors) {
    if (c.floor !== floor || !isBelt(c)) continue
    const q = closestOnPath(p, c.points)
    if (q && q.d <= radius && (!best || q.d < best.d)) best = { c, ...q }
  }
  return best
}

/** Cinta que mide un monitor ya colocado (la que pasa por su centro). */
export const monitoredBelt = (e: PlacedEntity, conveyors: Conveyor[]) => nearestBelt(e, e.floor, conveyors, 1.5)?.c ?? null

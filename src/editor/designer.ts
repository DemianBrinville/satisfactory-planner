import { buildingsById } from '../data/gameData'
import { rectsOverlap, type Rect } from './geometry'
import { entityRect, onFloor, type PlacedEntity } from './store'

/**
 * Diseñador de planos: una plataforma con una zona de construcción cuadrada en el centro (32, 40 o 48 m de lado
 * y de alto, según la marca). En el juego solo se puede construir adentro de esa zona.
 */
export const isDesigner = (id: string) => buildingsById.get(id)?.kind === 'designer'

/** Zona de construcción en planta (centrada en la plataforma) y su alto en metros. */
export function designerZone(e: PlacedEntity): { rect: Rect; height: number } | null {
  const b = buildingsById.get(e.buildingId)
  const r = entityRect(e)
  if (!b?.designerArea || !r) return null
  const cx = (r.x0 + r.x1) / 2
  const cy = (r.y0 + r.y1) / 2
  const h = b.designerArea / 2
  return { rect: { x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h }, height: b.designerArea }
}

const E = 0.01
const inside = (a: Rect, z: Rect) => a.x0 >= z.x0 - E && a.y0 >= z.y0 - E && a.x1 <= z.x1 + E && a.y1 <= z.y1 + E

/**
 * Lo que está construido sobre el diseñador: adentro de la zona (entra en el plano) y lo que la pisa pero
 * se sale (en el juego no se podría construir así). Cuenta los pisos que entran en el alto de la zona.
 */
export function designerContents(d: PlacedEntity, entities: PlacedEntity[], floorHeight: number) {
  const zone = designerZone(d)
  const plat = entityRect(d)
  if (!zone || !plat) return { inside: [] as PlacedEntity[], outside: [] as PlacedEntity[] }
  const floors = Math.max(1, Math.floor(zone.height / Math.max(1, floorHeight)))
  const inn: PlacedEntity[] = []
  const out: PlacedEntity[] = []
  for (const e of entities) {
    if (e.uid === d.uid || isDesigner(e.buildingId)) continue
    if (![...Array(floors).keys()].some((k) => onFloor(e, d.floor + k))) continue
    const r = entityRect(e)
    if (!r || !rectsOverlap(r, plat)) continue
    // conectores verticales que suben más alto que la zona también se salen
    const top = e.topFloor !== undefined ? e.topFloor : e.floor
    if (inside(r, zone.rect) && top < d.floor + floors) inn.push(e)
    else out.push(e)
  }
  return { inside: inn, outside: out }
}

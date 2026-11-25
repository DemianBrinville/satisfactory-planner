import { buildingsById, game, type ItemAmount } from '../data/gameData'
import type { PlacedEntity } from './store'

/**
 * Transporte de larga distancia: vías de tren y rutas entre estaciones (tren, camión, tractor,
 * explorador y dron). La capacidad de una ruta sale de lo que lleva cada viaje y de cuánto tarda
 * ida y vuelta. Las velocidades promedio son aproximadas (aceleración, curvas, terreno) y se
 * pueden ajustar en cada ruta.
 */

export const RAIL = 'Build_RailroadTrack_C'
/** Radio mínimo de curva de una vía (m) y largo de cada tramo (wiki). */
export const RAIL_RADIUS = 17
export const RAIL_MAX = 100
export const RAIL_MIN = 12

/** Costo de un tramo de vía: 1 tubo + 1 viga los primeros 18 m y 1 más cada 12 m. */
export function railCost(len: number): ItemAmount[] {
  const b = buildingsById.get(RAIL)
  if (!b) return []
  const units = 1 + Math.max(0, Math.ceil((len - 18) / 12))
  return b.cost.map((c) => ({ item: c.item, amount: c.amount * units }))
}

export type VehicleKind = 'train' | 'truck' | 'tractor' | 'explorer' | 'drone'

export interface VehicleSpec {
  name: string
  /** espacios de carga por vagón/vehículo */
  slots: number
  /** capacidad de fluidos por vagón/vehículo (m³) */
  fluid: number
  /** velocidad promedio por defecto (km/h) */
  speed: number
  /** tiempo total de carga + descarga por viaje (s) */
  dock: number
  /** estaciones compatibles */
  stations: RegExp
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  // plataforma de carga: 27,08 s por carga y por descarga; vagón 32 espacios o 1600 m³
  train: { name: 'Tren', slots: 32, fluid: 1600, speed: 100, dock: 2 * 27.08 + 10, stations: /TrainDockingStation/ },
  truck: { name: 'Camión', slots: 48, fluid: 2400, speed: 60, dock: 2 * 20, stations: /TruckStation/ },
  tractor: { name: 'Tractor', slots: 25, fluid: 1250, speed: 45, dock: 2 * 15, stations: /TruckStation/ },
  explorer: { name: 'Explorador', slots: 12, fluid: 0, speed: 80, dock: 2 * 12, stations: /TruckStation/ },
  // dron con baterías: ~70 m/s; despegue + aterrizaje en cada punta
  drone: { name: 'Dron', slots: 9, fluid: 0, speed: 252, dock: 2 * 25, stations: /DroneStation/ },
}

export interface Route {
  uid: string
  kind: VehicleKind
  from: string
  to: string
  /** vagones de carga (trenes) o vehículos en la ruta */
  count?: number
  /** distancia real de un trayecto (m); si no se indica, la distancia en línea recta × 1,2 */
  distance?: number
  /** velocidad promedio (km/h) */
  speed?: number
}

export function vehicleForStation(buildingId: string): VehicleKind | null {
  if (/TrainDockingStation/.test(buildingId)) return 'train'
  if (/TruckStation/.test(buildingId)) return 'truck'
  if (/DroneStation/.test(buildingId)) return 'drone'
  return null
}

export function routeDistance(r: Route, entities: PlacedEntity[], floorHeight = 8): number {
  if (r.distance && r.distance > 0) return r.distance
  const a = entities.find((e) => e.uid === r.from)
  const b = entities.find((e) => e.uid === r.to)
  if (!a || !b) return 0
  // en línea recta más un 20 % por curvas y desvíos (los drones vuelan en línea recta)
  const straight = Math.hypot(a.x - b.x, a.y - b.y, (a.floor - b.floor) * floorHeight)
  return r.kind === 'drone' ? straight : straight * 1.2
}

/** Tiempo de ida y vuelta en segundos. */
export function roundTrip(r: Route, entities: PlacedEntity[], floorHeight?: number): number {
  const spec = VEHICLES[r.kind]
  const v = ((r.speed ?? spec.speed) * 1000) / 3600
  return (2 * routeDistance(r, entities, floorHeight)) / v + spec.dock
}

const STACK: Record<string, number> = { ONE: 1, SMALL: 50, MEDIUM: 100, BIG: 200, HUGE: 500 }

/** Unidades por minuto que mueve la ruta para un ítem (o m³/min si es fluido). */
export function routeThroughput(r: Route, item: string | null, entities: PlacedEntity[], floorHeight?: number): number {
  const spec = VEHICLES[r.kind]
  const info = item ? game.items[item] : null
  const fluid = info && (info.form === 'liquid' || info.form === 'gas')
  const perTrip = fluid ? spec.fluid : spec.slots * (STACK[info?.stackSize ?? 'MEDIUM'] ?? 100)
  const count = Math.max(1, r.count ?? 1)
  const t = roundTrip(r, entities, floorHeight)
  return t > 0 ? (perTrip * count * 60) / t : 0
}

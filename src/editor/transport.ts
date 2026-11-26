import { buildingsById, game, type ItemAmount } from '../data/gameData'
import { worldRect, type Vec } from './geometry'
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
  /** consumo de combustible mientras anda (MW); los trenes son eléctricos */
  fuelMW?: number
}

export const VEHICLES: Record<VehicleKind, VehicleSpec> = {
  // plataforma de carga: 27,08 s por carga y por descarga; vagón 32 espacios o 2400 m³ (wiki)
  train: { name: 'Tren', slots: 32, fluid: 2400, speed: 90, dock: 2 * 27.08 + 10, stations: /TrainDockingStation|TrainStation/ },
  // estación de camiones: 8 s de acople en cada punta; consumo del juego (mManualFuelConsumption)
  truck: { name: 'Camión', slots: 48, fluid: 2400, speed: 60, dock: 2 * 8, stations: /TruckStation/, fuelMW: 75 },
  tractor: { name: 'Tractor', slots: 25, fluid: 1250, speed: 45, dock: 2 * 8, stations: /TruckStation/, fuelMW: 55 },
  explorer: { name: 'Explorador', slots: 12, fluid: 0, speed: 80, dock: 2 * 8, stations: /TruckStation/, fuelMW: 90 },
  // dron: 51 s de despegue y 51 s de aterrizaje en cada punta (wiki); la velocidad depende del combustible
  drone: { name: 'Dron', slots: 9, fluid: 0, speed: 270, dock: 4 * 51, stations: /DroneStation/ },
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
  /** puntos de paso del recorrido entre las dos estaciones (los drones vuelan en línea recta) */
  waypoints?: Vec[]
  /** combustible que usan los vehículos de la ruta */
  fuel?: string
  /** trenes con horario: estaciones de tren en el orden en que se visitan (se repite en ciclo) */
  stops?: string[]
  /** trenes con horario: cuántos trenes hacen este mismo horario */
  trains?: number
  /** trenes con horario: locomotoras por tren */
  locos?: number
  /** duración fija de la vuelta (s): la usan las aristas por vagón de los trenes con horario */
  cycle?: number
}

/** Combustibles que aceptan los drones y su velocidad de vuelo (m/s, wiki). */
export const DRONE_FUELS: Record<string, number> = {
  Desc_Battery_C: 75,
  Desc_Fuel_C: 50,
  Desc_TurboFuel_C: 60,
  Desc_PackagedRocketFuel_C: 75,
  Desc_PackagedIonizedFuel_C: 100,
  Desc_NuclearFuelRod_C: 90,
  Desc_PlutoniumFuelRod_C: 100,
}
/** Consumo del dron por viaje de ida y vuelta: base fija más un tanto por metro (mTripPowerCost, mTripPowerPerMeterCost). */
const DRONE_TRIP_MJ = 24000
const DRONE_MJ_PER_M = 6

/** Combustibles sólidos que puede cargar un vehículo terrestre (todo lo que tiene energía y va en el inventario). */
export const groundFuels = () =>
  Object.entries(game.items)
    .filter(([, i]) => (i.energyMJ ?? 0) > 0 && i.form === 'solid')
    .sort((a, b) => (a[1].energyMJ ?? 0) - (b[1].energyMJ ?? 0))
    .map(([id]) => id)

export const defaultFuel = (kind: VehicleKind): string | null =>
  kind === 'train' ? null : kind === 'drone' ? 'Desc_Battery_C' : 'Desc_Fuel_C'
export const fuelOf = (r: Route) => r.fuel ?? defaultFuel(r.kind)

/** Velocidad por defecto de la ruta (km/h): la del vehículo, o la que da el combustible en los drones. */
export function defaultSpeed(r: Route): number {
  if (r.kind === 'drone') return (DRONE_FUELS[fuelOf(r) ?? ''] ?? 70) * 3.6
  return VEHICLES[r.kind].speed
}

/** Centro de una estación, donde empieza y termina el recorrido. */
export function stationPoint(e: PlacedEntity): Vec {
  const b = buildingsById.get(e.buildingId)
  if (!b) return { x: e.x, y: e.y }
  const r = worldRect(b, e, e.rot)
  return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }
}

/** Recorrido dibujado: de la estación de origen, por los puntos de paso, a la de destino. */
export function routePath(r: Route, entities: PlacedEntity[]): Vec[] {
  const a = entities.find((e) => e.uid === r.from)
  const b = entities.find((e) => e.uid === r.to)
  if (!a || !b) return []
  if (r.stops && r.stops.length >= 2) {
    // tren con horario: de parada en parada y de vuelta a la primera
    const pts = r.stops.map((uid) => entities.find((e) => e.uid === uid)).filter((e): e is PlacedEntity => !!e).map(stationPoint)
    return pts.length ? [...pts, pts[0]] : []
  }
  const mid = r.kind === 'drone' ? [] : r.waypoints ?? []
  return [stationPoint(a), ...mid, stationPoint(b)]
}

/** De dónde sale la distancia de un trayecto. */
export function distanceSource(r: Route): 'manual' | 'drawn' | 'straight' {
  if (r.distance && r.distance > 0) return 'manual'
  return r.kind !== 'drone' && r.waypoints?.length ? 'drawn' : 'straight'
}

export function vehicleForStation(buildingId: string): VehicleKind | null {
  // los trenes se arman desde la estación (con horario); las plataformas se configuran aparte
  if (/TrainStation/.test(buildingId)) return 'train'
  if (/TruckStation/.test(buildingId)) return 'truck'
  if (/DroneStation/.test(buildingId)) return 'drone'
  return null
}

export function routeDistance(r: Route, entities: PlacedEntity[], floorHeight = 8): number {
  if (r.distance && r.distance > 0) return r.distance
  const a = entities.find((e) => e.uid === r.from)
  const b = entities.find((e) => e.uid === r.to)
  if (!a || !b) return 0
  const rise = (a.floor - b.floor) * floorHeight
  const pts = routePath(r, entities)
  let flat = 0
  for (let i = 1; i < pts.length; i++) flat += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const len = Math.hypot(flat, rise)
  // sin recorrido dibujado: en línea recta más un 20 % por curvas y desvíos (los drones vuelan en línea recta)
  return distanceSource(r) === 'drawn' || r.kind === 'drone' ? len : len * 1.2
}

/** Segundos en movimiento de un viaje de ida y vuelta (sin acoples). */
export function travelTime(r: Route, entities: PlacedEntity[], floorHeight?: number): number {
  const v = ((r.speed ?? defaultSpeed(r)) * 1000) / 3600
  return (2 * routeDistance(r, entities, floorHeight)) / v
}

/**
 * Combustible por viaje de ida y vuelta de un vehículo (unidades del combustible elegido).
 * Terrestres: consumo en MW por el tiempo en movimiento. Drones: base fija + un tanto por metro.
 * Trenes: eléctricos, null.
 */
export function fuelPerTrip(r: Route, entities: PlacedEntity[], floorHeight?: number): number | null {
  const fuel = fuelOf(r)
  const mj = fuel ? game.items[fuel]?.energyMJ ?? 0 : 0
  if (!fuel || mj <= 0) return null
  if (r.kind === 'drone') return (DRONE_TRIP_MJ + DRONE_MJ_PER_M * routeDistance(r, entities, floorHeight)) / mj
  const mw = VEHICLES[r.kind].fuelMW
  return mw ? (mw * travelTime(r, entities, floorHeight)) / mj : null
}

/** Combustible por minuto de toda la ruta (todos sus vehículos). */
export function fuelPerMinute(r: Route, entities: PlacedEntity[], floorHeight?: number): number | null {
  const f = fuelPerTrip(r, entities, floorHeight)
  const t = roundTrip(r, entities, floorHeight)
  return f === null || t <= 0 ? null : (f * Math.max(1, r.count ?? 1) * 60) / t
}

/** Tiempo de ida y vuelta en segundos. */
export function roundTrip(r: Route, entities: PlacedEntity[], floorHeight?: number): number {
  if (r.cycle) return r.cycle
  return travelTime(r, entities, floorHeight) + VEHICLES[r.kind].dock
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

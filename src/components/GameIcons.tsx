import type { ReactNode } from 'react'
import { Armchair, BrickWall, Car, Lightbulb, Plane, Route, Signpost, TrainFront, Truck, Warehouse } from 'lucide-react'
import { buildingsById, game } from '../data/gameData'
import iconManifest from '../data/icon-manifest.json'

/**
 * Iconos propios de la app (no son los del juego): los ítems se dibujan con una forma según el tipo de
 * pieza (mineral, lingote, placa, cable, fluido, envase, electrónica…) y el color de su material; los
 * edificios, con un glifo blanco sobre una ficha del color de su tipo, el mismo que usa el plano.
 */

/** Ids con icono oficial (bajados de la wiki a public/icons por scripts/fetch-wiki-icons.mjs). */
const OFFICIAL = new Set<string>(iconManifest as string[])
export const hasOfficialIcon = (id: string) => OFFICIAL.has(id)
const officialSrc = (id: string) => `${import.meta.env.BASE_URL}icons/${id}.png`

// ---------------------------------------------------------------- colores de material
const MATERIAL: [RegExp, string][] = [
  [/DarkMatter|DarkEnergy|Singularity/, '#8a5cf0'],
  [/TimeCrystal|QuantumEnergy|QuantumOscillator|TemporalProcessor/, '#7fe3f0'],
  [/Ficsonium/, '#f06a9a'],
  [/Ficsite/, '#e8a33a'],
  [/SAM/, '#b46be8'],
  [/Plutonium/, '#3fd0e0'],
  [/Uranium/, '#7ee04a'],
  [/Diamond/, '#bdf0ff'],
  [/CrystalShard|^Crystal/, '#c78af0'],
  [/Rocket/, '#ef6f3a'],
  [/Ionized/, '#f0d060'],
  [/Turbo/, '#e05a46'],
  [/Cooling/, '#6fb6e8'],
  [/MotorLightweight/, '#e05a46'],
  [/^Motor$|SpaceElevatorPart_4/, '#d98a3a'],
  [/Stator/, '#d9824b'],
  [/Biofuel|Biomass|Leaves|Wood|Mycelia|Berry|Nut|Shroom|Fabric/, '#6bb04a'],
  [/Fuel/, '#e8a03a'],
  [/HeavyOil|OilResidue/, '#7a5a3a'],
  [/Oil/, '#6b4fa0'],
  [/NitricAcid/, '#d8e04a'],
  [/SulfuricAcid/, '#f0e070'],
  [/Nitrogen|PressureConversion/, '#a9c3dc'],
  [/Water/, '#4aa3e8'],
  [/Alumina/, '#d8dfe8'],
  [/Bauxite/, '#c0704f'],
  [/Aluminum|Alclad/, '#cfd6de'],
  [/Quartz|Silica|CrystalOscillator/, '#e9a9cc'],
  [/HighSpeed|Gold|Caterium/, '#e3b94a'],
  [/Copper/, '#d9824b'],
  [/Steel/, '#7d8792'],
  [/Iron|Screw|Rotor|ModularFrame$|Rebar/, '#9aa7b5'],
  [/Stone|Cement/, '#b8b0a2'],
  [/Coal|Coke/, '#5a5d64'],
  [/Sulfur|Gunpowder|Explosive|Nobelisk/, '#e2d54a'],
  [/Rubber/, '#4f525a'],
  [/Plastic/, '#5aa6e8'],
  [/Polymer/, '#7a6ad8'],
  [/Circuit|Computer|Connector|AI|SpaceElevatorPart_12/, '#4caf6a'],
  [/Battery/, '#e8c547'],
  [/Xmas|Gift|Candy|Snow|Fireworks/, '#e05050'],
]
const itemColor = (id: string) => MATERIAL.find(([re]) => re.test(id))?.[1] ?? '#a3a9b1'

/** Color de un ítem (para usarlo fuera de los iconos, por ejemplo en el plano). */
export const colorOfItem = (id: string) => itemColor(id.replace(/^Desc_|^BP_|_C$/g, ''))

// ---------------------------------------------------------------- formas de ítems
type Shape =
  | 'ore'
  | 'ingot'
  | 'plate'
  | 'beam'
  | 'rod'
  | 'pipe'
  | 'coil'
  | 'screw'
  | 'frame'
  | 'motor'
  | 'rotor'
  | 'stator'
  | 'chip'
  | 'gem'
  | 'pile'
  | 'drop'
  | 'gas'
  | 'can'
  | 'cell'
  | 'leaf'
  | 'ammo'
  | 'battery'
  | 'part'
  | 'slab'
  | 'filter'
  | 'star'
  | 'nut'

const SHAPES: [RegExp, Shape][] = [
  [/^Packaged|^Fuel$|^TurboFuel$|GasTank|FluidCanister/, 'can'],
  [/FuelRod|ControlRod|Cell$|UraniumCell|PlutoniumCell/, 'cell'],
  [/SpaceElevatorPart/, 'part'],
  [/Xmas|Gift|Candy|Snow|Fireworks/, 'star'],
  [/^Ore|^Stone$|RawQuartz|^SAM$|^Sulfur$|^Coal$|AluminumScrap/, 'ore'],
  [/Ingot/, 'ingot'],
  [/Screw/, 'screw'],
  [/Wire|Cable/, 'coil'],
  [/Nobelisk|Cartridge|Rebar_|SpikedRebar/, 'ammo'],
  [/IronRod/, 'rod'],
  [/SteelPipe/, 'pipe'],
  [/SteelPlate/, 'beam'],
  [/Plate|Sheet|Casing/, 'plate'],
  [/Frame/, 'frame'],
  [/Rotor/, 'rotor'],
  [/Stator/, 'stator'],
  [/Motor|Cooling|Fan/, 'motor'],
  [/Circuit|Computer|Connector|Oscillator|Processor|SpaceElevatorPart_12|PressureConversion/, 'chip'],
  [/Crystal|Quartz|Diamond|Shard|Mesh|DarkMatter|Fluctuator/, 'gem'],
  [/Cement|Silica|Dust|Coke|Powder|Gunpowder|Compacted|Biofuel|Pellet|Waste|Ficsonium/, 'pile'],
  [/Leaves|Wood|Biomass|Mycelia|Fabric|Berry|Nut|Shroom|Protein|Parts|DNA/, 'leaf'],
  [/Battery/, 'battery'],
  [/Rubber|Plastic|Polymer/, 'slab'],
  [/Filter/, 'filter'],
]

const shapeOf = (key: string, form?: string): Shape => {
  const hit = SHAPES.find(([re]) => re.test(key))?.[1]
  if (hit === 'can') return 'can'
  if (form === 'liquid') return 'drop'
  if (form === 'gas') return 'gas'
  return hit ?? 'nut'
}

/** Contenido de un envase: el fluido que lleva adentro (para colorear la etiqueta). */
const contentOf = (key: string) => {
  const m: Record<string, string> = { Fuel: 'Fuel', TurboFuel: 'Turbo' }
  if (m[key]) return m[key]
  return key.replace(/^Packaged/, '')
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)))
  const r = f(n >> 16)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function itemShape(shape: Shape, c: string, inner?: string): ReactNode {
  const dk = shade(c, -0.45)
  const lt = shade(c, 0.35)
  const s = { stroke: '#101114', strokeWidth: 1, strokeLinejoin: 'round' as const }
  switch (shape) {
    case 'ore':
      return (
        <>
          <path d="M4 15 L7 7 L13 4 L19 8 L20 15 L14 20 L7 19 Z" fill={c} {...s} />
          <path d="M7 7 L12 11 L13 4 M12 11 L20 15 M12 11 L7 19" fill="none" stroke={dk} strokeWidth={0.9} />
          <path d="M8 9 L11 11 L12 6 Z" fill={lt} opacity={0.7} />
        </>
      )
    case 'ingot':
      return (
        <>
          <path d="M3 15 L7 9 L21 9 L17 15 Z" fill={lt} {...s} />
          <path d="M3 15 L17 15 L17 19 L3 19 Z" fill={c} {...s} />
          <path d="M17 15 L21 9 L21 13 L17 19 Z" fill={dk} {...s} />
        </>
      )
    case 'plate':
      return (
        <>
          <path d="M2 12 L12 6 L22 12 L12 18 Z" fill={c} {...s} />
          <path d="M2 12 L2 14 L12 20 L22 14 L22 12 L12 18 Z" fill={dk} {...s} />
          <path d="M7 12 L12 9 L17 12" fill="none" stroke={lt} strokeWidth={1} />
        </>
      )
    case 'beam':
      return (
        <>
          <path d="M5 5 H19 V8 H14 V16 H19 V19 H5 V16 H10 V8 H5 Z" fill={c} {...s} />
          <path d="M6 6.5 H18" stroke={lt} strokeWidth={1} />
        </>
      )
    case 'rod':
      return (
        <>
          <path d="M4 18 L17 5 L20 8 L7 21 Z" fill={c} {...s} />
          <path d="M5.5 18.5 L18 6" stroke={lt} strokeWidth={1} />
        </>
      )
    case 'pipe':
      return (
        <>
          <path d="M5 8 H18 V16 H5 Z" fill={c} {...s} />
          <ellipse cx="18" cy="12" rx="2.5" ry="4" fill={dk} {...s} />
          <ellipse cx="5" cy="12" rx="2.5" ry="4" fill={c} {...s} />
          <ellipse cx="5" cy="12" rx="1.1" ry="2" fill="#101114" />
        </>
      )
    case 'coil':
      return (
        <>
          <circle cx="12" cy="12" r="8" fill={dk} {...s} />
          <circle cx="12" cy="12" r="6" fill="none" stroke={c} strokeWidth={2} />
          <circle cx="12" cy="12" r="2.6" fill="#101114" stroke={c} strokeWidth={1.2} />
          <path d="M18 14 L22 19" stroke={c} strokeWidth={1.6} strokeLinecap="round" />
        </>
      )
    case 'screw':
      return (
        <>
          <path d="M6 5 H18 V8 H6 Z" fill={lt} {...s} />
          <path d="M9.5 8 H14.5 V17 L12 21 L9.5 17 Z" fill={c} {...s} />
          <path d="M9.5 10 L14.5 11.5 M9.5 13 L14.5 14.5 M9.5 16 L14.5 17" stroke={dk} strokeWidth={1} />
        </>
      )
    case 'frame':
      return (
        <>
          <path d="M4 4 H20 V20 H4 Z M7 7 V17 H17 V7 Z" fill={c} fillRule="evenodd" {...s} />
          <path d="M7 7 L17 17 M17 7 L7 17" stroke={dk} strokeWidth={1.6} />
        </>
      )
    case 'motor':
      return (
        <>
          <path
            d="M12 2.5 L14 5 L17.3 4.2 L17.8 7.6 L21 9 L19.5 12 L21 15 L17.8 16.4 L17.3 19.8 L14 19 L12 21.5 L10 19 L6.7 19.8 L6.2 16.4 L3 15 L4.5 12 L3 9 L6.2 7.6 L6.7 4.2 L10 5 Z"
            fill={c}
            {...s}
          />
          <circle cx="12" cy="12" r="4" fill={dk} {...s} />
          <circle cx="12" cy="12" r="1.5" fill={lt} />
        </>
      )
    case 'rotor':
      return (
        <>
          <rect x="2.5" y="10.8" width="19" height="2.4" rx="1" fill={dk} {...s} />
          <rect x="6" y="5" width="3" height="14" rx="1" fill={c} {...s} />
          <rect x="10.5" y="5" width="3" height="14" rx="1" fill={c} {...s} />
          <rect x="15" y="5" width="3" height="14" rx="1" fill={c} {...s} />
        </>
      )
    case 'stator':
      return (
        <>
          <circle cx="12" cy="12" r="9" fill="#7d8792" {...s} />
          <circle cx="12" cy="12" r="6.2" fill={c} stroke="#101114" strokeWidth={0.8} />
          <path d="M12 6 V9 M12 15 V18 M6 12 H9 M15 12 H18 M7.8 7.8 L9.9 9.9 M14.1 14.1 L16.2 16.2 M16.2 7.8 L14.1 9.9 M9.9 14.1 L7.8 16.2" stroke={dk} strokeWidth={1.2} />
          <circle cx="12" cy="12" r="2.6" fill="#101114" />
        </>
      )
    case 'chip':
      return (
        <>
          <path d="M8 3 V6 M12 3 V6 M16 3 V6 M8 18 V21 M12 18 V21 M16 18 V21 M3 8 H6 M3 12 H6 M3 16 H6 M18 8 H21 M18 12 H21 M18 16 H21" stroke={lt} strokeWidth={1.4} />
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill={c} {...s} />
          <rect x="9" y="9" width="6" height="6" rx="0.8" fill={dk} />
        </>
      )
    case 'gem':
      return (
        <>
          <path d="M5 9 L9 4 H15 L19 9 L12 21 Z" fill={c} {...s} />
          <path d="M5 9 H19 M9 4 L10 9 L12 21 L14 9 L15 4" fill="none" stroke={dk} strokeWidth={0.9} />
          <path d="M9.5 5 L10.3 8.5 L7 8.5 Z" fill={lt} />
        </>
      )
    case 'pile':
      return (
        <>
          <path d="M2.5 19 C5 11 9 7 12 7 C15 7 19 11 21.5 19 Z" fill={c} {...s} />
          <circle cx="9" cy="13" r="1" fill={lt} />
          <circle cx="14" cy="11" r="0.9" fill={lt} />
          <circle cx="15.5" cy="15.5" r="1" fill={dk} />
          <circle cx="7" cy="17" r="0.9" fill={dk} />
        </>
      )
    case 'drop':
      return (
        <>
          <path d="M12 2.5 C15 7.5 19 11 19 15 A7 7 0 0 1 5 15 C5 11 9 7.5 12 2.5 Z" fill={c} {...s} />
          <path d="M8.5 15 A3.5 3.5 0 0 0 11 18.4" fill="none" stroke={lt} strokeWidth={1.4} strokeLinecap="round" />
        </>
      )
    case 'gas':
      return (
        <>
          <circle cx="8" cy="14" r="5" fill={c} {...s} opacity={0.9} />
          <circle cx="15" cy="10" r="5.5" fill={c} {...s} opacity={0.9} />
          <circle cx="16" cy="17.5" r="3.5" fill={c} {...s} opacity={0.9} />
          <circle cx="13.5" cy="8.5" r="1.4" fill={lt} />
        </>
      )
    case 'can':
      return (
        <>
          <rect x="9" y="2.5" width="6" height="3" rx="0.8" fill="#8a8f97" {...s} />
          <rect x="5.5" y="5" width="13" height="16.5" rx="2" fill="#8a8f97" {...s} />
          <rect x="7.5" y="9" width="9" height="8" rx="1" fill={inner ?? '#5f646c'} stroke="#101114" strokeWidth={0.8} />
        </>
      )
    case 'cell':
      return (
        <>
          <rect x="8" y="2.5" width="8" height="19" rx="3" fill={c} {...s} />
          <path d="M8 7 H16 M8 12 H16 M8 17 H16" stroke={dk} strokeWidth={1.6} />
          <path d="M10 4 V20" stroke={lt} strokeWidth={1} />
        </>
      )
    case 'leaf':
      return (
        <>
          <path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z" fill={c} {...s} />
          <path d="M5 19 L16 8" stroke={dk} strokeWidth={1.2} />
        </>
      )
    case 'ammo':
      return (
        <>
          <path d="M9 9 C9 5 12 2.5 12 2.5 C12 2.5 15 5 15 9 Z" fill={lt} {...s} />
          <rect x="9" y="9" width="6" height="12" rx="0.8" fill={c} {...s} />
          <path d="M9 18 H15" stroke={dk} strokeWidth={1.2} />
        </>
      )
    case 'battery':
      return (
        <>
          <rect x="5" y="6" width="14" height="15" rx="1.5" fill={c} {...s} />
          <rect x="9" y="3" width="6" height="3" fill={dk} {...s} />
          <path d="M13 9 L10 14 H14 L11 18.5" fill="none" stroke="#101114" strokeWidth={1.4} strokeLinejoin="round" />
        </>
      )
    case 'part':
      return (
        <>
          <path d="M12 2.5 L20.5 7.25 V16.75 L12 21.5 L3.5 16.75 V7.25 Z" fill="#e8a33a" {...s} />
          <path d="M12 7 L13.5 10.5 L17 11 L14.3 13.3 L15 17 L12 15 L9 17 L9.7 13.3 L7 11 L10.5 10.5 Z" fill="#101114" />
        </>
      )
    case 'slab':
      return (
        <>
          <rect x="3.5" y="7" width="17" height="11" rx="3" fill={c} {...s} />
          <path d="M6.5 10 H14" stroke={lt} strokeWidth={1.4} strokeLinecap="round" />
        </>
      )
    case 'filter':
      return (
        <>
          <circle cx="12" cy="12" r="8.5" fill="#8a8f97" {...s} />
          <circle cx="12" cy="12" r="5.5" fill={c} stroke="#101114" strokeWidth={0.8} />
          <path d="M8 12 H16 M12 8 V16 M9.2 9.2 L14.8 14.8 M14.8 9.2 L9.2 14.8" stroke={dk} strokeWidth={0.8} />
        </>
      )
    case 'star':
      return <path d="M12 2.5 L14.6 9 L21.5 9.3 L16 13.7 L18 20.5 L12 16.6 L6 20.5 L8 13.7 L2.5 9.3 L9.4 9 Z" fill={c} {...s} />
    default:
      return (
        <>
          <path d="M12 3 L19.8 7.5 V16.5 L12 21 L4.2 16.5 V7.5 Z" fill={c} {...s} />
          <circle cx="12" cy="12" r="3.5" fill="#101114" />
        </>
      )
  }
}

/** Icono de un ítem del juego (id tal como viene en los datos, p. ej. Desc_IronPlate_C). */
export function ItemIcon({ item, size = 18, title }: { item: string; size?: number; title?: string }) {
  if (OFFICIAL.has(item))
    return <img className="game-icon official" src={officialSrc(item)} width={size} height={size} alt={title ?? ''} title={title} loading="lazy" draggable={false} />
  const key = item.replace(/^Desc_|^BP_|_C$/g, '')
  const form = game.items[item]?.form
  const shape = shapeOf(key, form)
  const color = itemColor(shape === 'can' ? '' : key)
  const inner = shape === 'can' ? (/GasTank|FluidCanister/.test(key) ? undefined : itemColor(contentOf(key))) : undefined
  return (
    <svg className="game-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {itemShape(shape, color, inner)}
    </svg>
  )
}

/** Icono + nombre de un ítem, en línea. */
export function ItemLabel({ item, name, size = 16 }: { item: string; name: string; size?: number }) {
  return (
    <span className="item-label">
      <ItemIcon item={item} size={size} />
      {name}
    </span>
  )
}

// ---------------------------------------------------------------- edificios
const TILE: Record<string, string> = {
  machine: '#c97f2c',
  miner: '#8a6a3a',
  extractor: '#3d6f96',
  generator: '#b59a2a',
  belt: '#5b5f66',
  splitter: '#6d7178',
  lift: '#5b5f66',
  pipe: '#3d6f96',
  pipeJunction: '#3d6f96',
  pump: '#3d6f96',
  valve: '#3d6f96',
  foundation: '#6b6359',
  wall: '#6b6359',
  structure: '#55595f',
}

const W = { fill: 'none', stroke: '#fff', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** Glifo blanco de cada edificio (dibujado en 24 × 24). */
function glyph(id: string, kind: string): ReactNode {
  const k = id.replace(/^Build_|_C$/g, '')
  if (/^ConstructorMk/.test(k)) return <path d="M5 9 H14 V5 H19 V9 M14 9 V13 H19 M9.5 13 V20 M6.5 20 H12.5" {...W} />
  if (/^AssemblerMk/.test(k)) return <path d="M3 7 L9 12 L3 17 M9 12 H15 M13 7 H21 V17 H13 Z" {...W} />
  if (/^ManufacturerMk/.test(k)) return <path d="M3 20 V10 L8 13 V10 L13 13 V10 L18 13 V5 H21 V20 Z M7 17 H9 M12 17 H14" {...W} />
  if (/^SmelterMk/.test(k)) return <path d="M12 3 C15 7 17 9 17 13 A5 5 0 0 1 7 13 C7 10 9 9 9.5 6.5 C11 8 11 9.5 12 10 C13 8 12.5 5 12 3 Z M5 21 H19" {...W} />
  if (/^FoundryMk/.test(k)) return <path d="M9 3 C11 6 13 7.5 13 10.5 A4 4 0 0 1 5 10.5 C5 8 7 7 7.5 5 M14 10 C16 12 17 13 17 15 A3 3 0 0 1 11 15 M4 19 H20 L18 21.5 H6 Z" {...W} />
  if (/OilRefinery/.test(k)) return <path d="M9 3 H15 M10 3 V9 L4.5 18.5 A1.5 1.5 0 0 0 5.8 21 H18.2 A1.5 1.5 0 0 0 19.5 18.5 L14 9 V3 M7 15 H17" {...W} />
  if (/Blender/.test(k)) return <path d="M4 9 H20 L18 20 H6 Z M8.5 14 C10 12 11 16 12.5 14 C14 12 15 16 16 14 M12 9 V3" {...W} />
  if (/Packager/.test(k)) return <path d="M4 8 L12 4 L20 8 V17 L12 21 L4 17 Z M4 8 L12 12 L20 8 M12 12 V21" {...W} />
  if (/HadronCollider/.test(k)) return <><ellipse cx="12" cy="12" rx="9" ry="5" {...W} /><circle cx="12" cy="12" r="1.8" fill="#fff" /><circle cx="19" cy="9.5" r="1.3" fill="#fff" /></>
  if (/Converter/.test(k)) return <path d="M4 12 A8 8 0 0 1 18 6.5 M18 3 V6.8 H14.2 M20 12 A8 8 0 0 1 6 17.5 M6 21 V17.2 H9.8" {...W} />
  if (/QuantumEncoder/.test(k)) return <><ellipse cx="12" cy="12" rx="9" ry="3.5" {...W} /><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)" {...W} /><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(120 12 12)" {...W} /></>
  if (/^MinerMk/.test(k)) return <path d="M7 3 H17 V8 H7 Z M8.5 8 L12 21 L15.5 8 M9.5 12 H14.5 M10.5 16 H13.5" {...W} />
  if (/WaterPump/.test(k)) return <path d="M12 3 C14.5 7 17 9.5 17 12.5 A5 5 0 0 1 7 12.5 C7 9.5 9.5 7 12 3 Z M3 20 C5 18.5 7 21.5 9 20 C11 18.5 13 21.5 15 20 C17 18.5 19 21.5 21 20" {...W} />
  if (/OilPump/.test(k)) return <path d="M4 21 H20 M8 21 L12 9 L16 21 M3 7 L20 4 M20 4 V9 M12 9 V5.5" {...W} />
  if (/Fracking/.test(k)) return <path d="M12 3 V15 M8 7 H16 M9 11 H15 M5 21 L12 15 L19 21 Z" {...W} />
  if (/GeneratorNuclear/.test(k))
    return (
      <>
        <circle cx="12" cy="12" r="2" fill="#fff" />
        <path d="M12 9.5 L9 4.3 A8 8 0 0 1 15 4.3 Z M14.2 13.2 L20.2 13.2 A8 8 0 0 1 17.2 18.4 Z M9.8 13.2 L6.8 18.4 A8 8 0 0 1 3.8 13.2 Z" fill="#fff" />
      </>
    )
  if (/GeneratorGeoThermal/.test(k)) return <path d="M13 2.5 L7 12 H11.5 L10 19 L16.5 9.5 H12 Z M3 21 C5 19.5 7 22.5 9 21 M15 21 C17 19.5 19 22.5 21 21" {...W} />
  if (kind === 'generator') return <path d="M13 2.5 L6 13 H11 L10 21.5 L18 10.5 H13 Z" {...W} />
  if (/AlienPower/.test(k)) return <path d="M13 2.5 L6 13 H11 L10 21.5 L18 10.5 H13 Z M4 4 L6 6 M20 4 L18 6" {...W} />
  if (/Merger/.test(k)) return <path d="M3 5 L10 12 L3 19 M3 12 H21 M17 8 L21 12 L17 16" {...W} />
  if (/Splitter/.test(k)) return <path d="M3 12 H12 M12 12 L20 5 M12 12 H21 M12 12 L20 19 M17 5 H20 V8 M18 9 L21 12 L18 15 M17 19 H20 V16" {...W} />
  if (kind === 'belt') return <path d="M4 6 L10 12 L4 18 M11 6 L17 12 L11 18" {...W} />
  if (kind === 'lift') return <path d="M12 3 V21 M7 8 L12 3 L17 8 M7 14 L12 9 L17 14" {...W} />
  if (kind === 'pipeJunction') return <path d="M9 3 H15 V9 H21 V15 H15 V21 H9 V15 H3 V9 H9 Z" {...W} />
  if (kind === 'pump') return <><circle cx="12" cy="12" r="7.5" {...W} /><path d="M8.5 12 H15.5 M12.5 9 L15.5 12 L12.5 15" {...W} /></>
  if (kind === 'valve') return <path d="M4 7 L12 12 L4 17 Z M20 7 L12 12 L20 17 Z M12 12 V4 M9 4 H15" {...W} />
  if (kind === 'pipe') return <path d="M3 9 H21 M3 15 H21 M6 7 V17 M18 7 V17" {...W} />
  if (kind === 'foundation') return <path d="M3 3 H21 V21 H3 Z M3 12 H21 M12 3 V21" {...W} />
  if (/Pole|PipelineSupport|PipeSupport|ConveyorCeiling/.test(k)) return <path d="M12 21 V5 M7 5 H17 M9 21 H15" {...W} />
  if (/PowerLine/.test(k)) return <path d="M3 18 C8 8 16 8 21 18 M3 18 V21 M21 18 V21" {...W} />
  if (/PowerSwitch/.test(k)) return <path d="M4 16 H8 L16 9 M16 16 H20 M8 16 V18 M16 16 V18" {...W} />
  if (/PowerStorage/.test(k)) return <path d="M6 5 H18 V21 H6 Z M10 3 H14 M13 8 L10 13 H14 L11 18" {...W} />
  if (/Storage|Container|Tank|Shelf/.test(k)) return <path d="M3 7 H21 V20 H3 Z M3 7 L6 3 H18 L21 7 M10 11 H14" {...W} />
  if (/ResourceSink/.test(k)) return <path d="M4 5 H20 L15 12 V19 L9 21 V12 Z" {...W} />
  if (/SpaceElevator/.test(k)) return <path d="M12 2.5 L15 9 V21 H9 V9 Z M9 15 L5 19 V21 H9 M15 15 L19 19 V21 H15" {...W} />
  if (/Mam|WorkBench|Workshop|TradingPost|BlueprintDesigner/.test(k)) return <path d="M4 20 H20 M6 20 V11 H18 V20 M9 11 V6 H15 V11 M10 15 H14" {...W} />
  return null
}

/** Glifo de lucide para lo que no tiene uno propio (arquitectura, transporte, decoración…). */
function lucideFor(id: string, kind: string, category: string): ReactNode {
  const p = { size: 14, color: '#fff', strokeWidth: 2 }
  if (/Train|Railroad/.test(id)) return <TrainFront {...p} />
  if (/Truck|Tractor|Explorer|FactoryCart|VehiclePath/.test(id)) return /VehiclePath/.test(id) ? <Route {...p} /> : <Truck {...p} />
  if (/Drone|Portal|Hyper|JumpPad|LandingPad/.test(id)) return <Plane {...p} />
  if (/Light|Flood/.test(id)) return <Lightbulb {...p} />
  if (/Sign/.test(id)) return <Signpost {...p} />
  if (/Car/.test(id)) return <Car {...p} />
  if (kind === 'wall' || category === 'paredes') return <BrickWall {...p} />
  if (category === 'organizacion') return <Warehouse {...p} />
  return <Armchair {...p} />
}

/** Icono de un edificio: glifo sobre una ficha del color de su tipo. */
export function BuildingIcon({ id, size = 22 }: { id: string; size?: number }) {
  if (OFFICIAL.has(id))
    return (
      <span className="building-icon official" style={{ width: size, height: size }} aria-hidden>
        <img src={officialSrc(id)} width={size} height={size} alt="" loading="lazy" draggable={false} />
      </span>
    )
  const b = buildingsById.get(id)
  const kind = b?.kind ?? 'structure'
  const g = glyph(id, kind)
  const bg = TILE[kind] ?? TILE.structure
  return (
    <span className="building-icon" style={{ width: size, height: size, background: bg }} aria-hidden>
      {g ? (
        <svg width={size * 0.78} height={size * 0.78} viewBox="0 0 24 24">
          {g}
        </svg>
      ) : (
        lucideFor(id, kind, b?.category ?? '')
      )}
    </span>
  )
}

// ---------------------------------------------------------------- logo
/** Logo de la app: un cimiento visto desde arriba con una cinta que entra a una máquina y sale. */
export function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="7" fill="#f08a24" />
      <path d="M1 16 H31 M16 1 V31" stroke="#c96f14" strokeWidth="1" />
      <rect x="10" y="9" width="12" height="14" rx="2" fill="#1b1c1f" />
      <path d="M3.5 16 H10" stroke="#1b1c1f" strokeWidth="3.2" />
      <path d="M22 16 H28.5" stroke="#1b1c1f" strokeWidth="3.2" />
      <path d="M5 14.6 L6.4 16 L5 17.4 M24 14.6 L25.4 16 L24 17.4" fill="none" stroke="#f08a24" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 19 L16 13 L19 19" fill="none" stroke="#4fe0c0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

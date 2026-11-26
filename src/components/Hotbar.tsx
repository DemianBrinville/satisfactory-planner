import { buildingsById } from '../data/gameData'
import { FAMILIES, HOTKEYS } from '../editor/families'
import { isBuildingIdAvailable, useProgress } from '../editor/progress'
import { useEditor } from '../editor/store'
import { BuildingIcon } from './GameIcons'

/** Barra rápida como la del juego: número → familia; E cambia la variante. */
export default function Hotbar() {
  const { lastByFamily, selectFamily, conveyorId, placingId } = useEditor()
  useProgress() // re-render cuando cambia el progreso
  const active = conveyorId ?? placingId
  return (
    <div className="hotbar">
      {HOTKEYS.map(({ key, family }) => {
        const f = FAMILIES[family]
        const last = lastByFamily[family]
        const id = last && isBuildingIdAvailable(last) ? last : f.ids.find(isBuildingIdAvailable)
        const b = id ? buildingsById.get(id) : null
        return (
          <button
            key={key}
            className={'slot' + (id && id === active ? ' active' : '')}
            disabled={!b}
            onClick={() => selectFamily(family)}
            title={b ? `${b.name} · E: siguiente variante` : `${f.name}: no disponible con tu progreso`}
          >
            <kbd>{key}</kbd>
            {b && <BuildingIcon id={b.id} size={20} />}
            <span>{b ? short(b.name) : f.name}</span>
          </button>
        )
      })}
      <span className="hint">
        <kbd>E</kbd> variante
      </span>
    </div>
  )
}

const short = (n: string) =>
  n
    .replace('Cinta transportadora', 'Cinta')
    .replace('Divisor de cinta transportadora', 'Divisor')
    .replace('Unión de cintas transportadoras', 'Unión')
    .replace('Poste de cinta transportadoras', 'Poste')
    .replace('Poste de cinta transportadora apilable', 'Poste apilable')
    .replace('Soporte de tubería', 'Soporte')
    .replace('Bomba de tubería', 'Bomba')
    .replace('Cinta elevadora', 'Elevadora')

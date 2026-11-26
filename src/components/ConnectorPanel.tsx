import { ArrowDown, ArrowUp } from 'lucide-react'
import { itemName, type Building } from '../data/gameData'
import { connectorHeight, entityCost } from '../editor/costs'
import { useEditor, type PlacedEntity } from '../editor/store'

/** Cintas elevadoras y pases de tubería: piso destino, sentido, altura y costo. */
export default function ConnectorPanel({ e, b }: { e: PlacedEntity; b: Building }) {
  const { updateEntity, floorHeight } = useEditor()
  const top = e.topFloor ?? e.floor + 1
  const h = connectorHeight(e, floorHeight)
  const isLift = b.kind === 'lift'
  const tooTall = isLift && h > 48
  return (
    <section className="machine">
      <h2>{b.name}</h2>
      <div className="flowline">
        <span>Desde el piso</span>
        <b>{e.floor}</b>
      </div>
      <div className="flowline">
        <span>Hasta el piso</span>
        <input
          type="number"
          className="small-input"
          value={top}
          min={e.floor + 1}
          onChange={(ev) => updateEntity(e.uid, { topFloor: Math.max(e.floor + 1, Number(ev.target.value)) })}
        />
      </div>
      {isLift && (
        <div className="segmented">
          {(['up', 'down'] as const).map((d) => (
            <button key={d} className={(e.liftDir ?? 'up') === d ? 'active' : ''} onClick={() => updateEntity(e.uid, { liftDir: d })}>
              {d === 'up' ? <ArrowUp size={14} /> : <ArrowDown size={14} />} {d === 'up' ? 'Sube' : 'Baja'}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        Altura {h} m ({floorHeight} m por piso){isLift && ` · capacidad ${b.itemsPerMinute}/min`}
      </p>
      {tooTall && <p className="warn">Una elevadora llega hasta 48 m: en el juego necesitas encadenar dos o usar agujeros de suelo.</p>}
      <p className="muted">
        Costo: {entityCost(e, floorHeight).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ')}
      </p>
      <p className="muted">El puerto de abajo se ve en el piso {e.floor} y el de arriba en el piso {top}.</p>
    </section>
  )
}

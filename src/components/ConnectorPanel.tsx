import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { itemName, type Building } from '../data/gameData'
import { connectorHeight, entityCost } from '../editor/costs'
import { useEditor, type PlacedEntity } from '../editor/store'

/** Cintas elevadoras y pases de tubería: piso destino, sentido, altura y costo. */
export default function ConnectorPanel({ e, b }: { e: PlacedEntity; b: Building }) {
  const { t } = useTranslation()
  const { updateEntity, floorHeight } = useEditor()
  const top = e.topFloor ?? e.floor + 1
  const h = connectorHeight(e, floorHeight)
  const isLift = b.kind === 'lift'
  const tooTall = isLift && h > 48
  return (
    <section className="machine">
      <h2>{b.name}</h2>
      <div className="flowline">
        <span>{t('connector.fromFloor')}</span>
        <b>{e.floor}</b>
      </div>
      <div className="flowline">
        <span>{t('connector.toFloor')}</span>
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
              {d === 'up' ? <ArrowUp size={14} /> : <ArrowDown size={14} />} {d === 'up' ? t('connector.up') : t('connector.down')}
            </button>
          ))}
        </div>
      )}
      <p className="muted">
        {t('connector.height', { h, per: floorHeight })}
        {isLift && t('connector.capacity', { n: b.itemsPerMinute })}
      </p>
      {tooTall && <p className="warn">{t('connector.tooTall')}</p>}
      <p className="muted">
        {t('connector.cost', { list: entityCost(e, floorHeight).map((c) => `${c.amount} ${itemName(c.item)}`).join(', ') })}
      </p>
      <p className="muted">{t('connector.ports', { bottom: e.floor, top })}</p>
    </section>
  )
}

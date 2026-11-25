import { useMemo } from 'react'
import { buildingsById, itemName } from '../data/gameData'
import { summarize } from '../editor/costs'
import { useEditor } from '../editor/store'

const fmt = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 1 })

export default function SidePanel() {
  const { entities, selection, placingId, placingRot } = useEditor()
  const selected = useMemo(() => entities.filter((e) => selection.includes(e.uid)), [entities, selection])
  const summary = useMemo(() => summarize(selected.length ? selected : []), [selected])
  const total = useMemo(() => summarize(entities), [entities])
  const placing = placingId ? buildingsById.get(placingId) : null

  return (
    <aside className="side">
      {placing && (
        <section>
          <h2>Construyendo: {placing.name}</h2>
          <p className="muted">
            Rotación {placingRot}° · <kbd>R</kbd> girar · <kbd>Shift</kbd>+rueda girar · clic derecho o <kbd>Esc</kbd> para salir
          </p>
          {placing.description && <p className="desc">{placing.description}</p>}
          <Cost items={placing.cost} />
        </section>
      )}

      {selected.length > 0 ? (
        <section>
          <h2>Selección ({selected.length})</h2>
          <ul className="counts">
            {summary.counts.map((c) => (
              <li key={c.buildingId}>
                <span>{buildingsById.get(c.buildingId)?.name}</span>
                <b>×{c.count}</b>
              </li>
            ))}
          </ul>
          <h3>Materiales</h3>
          <Cost items={summary.materials} />
          {(summary.powerMW > 0 || summary.powerGenMW > 0) && (
            <p className="muted">
              Consumo {fmt(summary.powerMW)} MW
              {summary.powerGenMW > 0 && ` · Genera ${fmt(summary.powerGenMW)} MW`}
            </p>
          )}
          <p className="muted">
            <kbd>R</kbd> girar · <kbd>Supr</kbd> borrar · arrastra para mover
          </p>
        </section>
      ) : (
        !placing && (
          <section>
            <h2>Plano completo</h2>
            <p className="muted">{entities.length} estructuras. Arrastra sobre el plano para seleccionar un área y ver sus materiales.</p>
            <Cost items={total.materials} />
          </section>
        )
      )}

      <section className="help">
        <h3>Controles</h3>
        <p>
          Rueda: zoom · Botón central o <kbd>Espacio</kbd>+arrastrar: mover vista · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd>:
          deshacer/rehacer · <kbd>Shift</kbd>+clic: sumar a la selección
        </p>
      </section>
    </aside>
  )
}

function Cost({ items }: { items: { item: string; amount: number }[] }) {
  if (!items.length) return <p className="muted">Sin materiales.</p>
  return (
    <ul className="cost">
      {items.map((c) => (
        <li key={c.item}>
          <span>{itemName(c.item)}</span>
          <b>{fmt(c.amount)}</b>
        </li>
      ))}
    </ul>
  )
}

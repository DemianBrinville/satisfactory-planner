import { useMemo, useState } from 'react'
import { computeFlows } from '../editor/flow'
import { computeGrids } from '../editor/power'
import { DEFAULT_POWER, useEditor } from '../editor/store'

const fmt = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 1 })

/** Botón y panel de energía: energía infinita y datos de la red del mundo del jugador. */
export default function PowerSettingsButton() {
  const [open, setOpen] = useState(false)
  const { entities, conveyors, routes, wires, floorHeight, setPower } = useEditor()
  const settings = useEditor((s) => s.power) ?? DEFAULT_POWER
  const power = useMemo(() => {
    const flows = computeFlows(entities, conveyors, routes ?? [], floorHeight)
    return computeGrids(entities, wires ?? [], flows, settings)
  }, [entities, conveyors, routes, wires, floorHeight, settings])

  const spare = settings.worldGen - settings.worldUse
  const hasWorld = settings.worldGen > 0
  const balance = spare + power.planGen - power.planUse
  const status = !hasWorld ? 'muted' : balance >= 0 ? 'ok' : 'bad'

  return (
    <div className="power-settings">
      <button onClick={() => setOpen(!open)} title="Energía del plano">
        ⚡ {fmt(power.planUse)} MW{settings.infinite && ' · infinita'}
      </button>
      {open && (
        <div className="popover left">
          <label className="switch">
            <input type="checkbox" checked={settings.infinite} onChange={(e) => setPower({ infinite: e.target.checked })} />
            <b>Energía infinita</b>
          </label>
          <p className="muted small">
            {settings.infinite
              ? 'Se da por hecho que hay una red capaz de sostener todo el plano: no hace falta tender cables. Los cables que dibujes se toman como conectados a esa red.'
              : 'Cada máquina necesita estar conectada con cables a una red con generadores, o a un poste enganchado a la red de tu mundo.'}
          </p>
          <h3>Red de tu mundo</h3>
          <div className="flowline">
            <span>Generación total</span>
            <span>
              <input
                className="small-input wide"
                type="number"
                min={0}
                value={settings.worldGen || ''}
                placeholder="0"
                onChange={(e) => setPower({ worldGen: Math.max(0, Number(e.target.value)) })}
              />{' '}
              MW
            </span>
          </div>
          <div className="flowline">
            <span>Consumo actual</span>
            <span>
              <input
                className="small-input wide"
                type="number"
                min={0}
                value={settings.worldUse || ''}
                placeholder="0"
                onChange={(e) => setPower({ worldUse: Math.max(0, Number(e.target.value)) })}
              />{' '}
              MW
            </span>
          </div>
          <p className="muted small">Los ves en el juego en cualquier poste o en el panel de energía. No incluyas lo de este plano.</p>
          <h3>Balance</h3>
          <div className="flowline">
            <span>Consumo del plano</span>
            <b>{fmt(power.planUse)} MW</b>
          </div>
          {power.planGen > 0 && (
            <div className="flowline">
              <span>Generación del plano</span>
              <b>{fmt(power.planGen)} MW</b>
            </div>
          )}
          {hasWorld && (
            <div className="flowline">
              <span>Le sobra a tu mundo</span>
              <b>{fmt(spare)} MW</b>
            </div>
          )}
          <p className={status}>
            {hasWorld
              ? balance >= 0
                ? `Alcanza: con el plano construido te quedan ${fmt(balance)} MW libres.`
                : `No alcanza: faltan ${fmt(-balance)} MW. Necesitas más generadores antes de construir esto.`
              : 'Carga la generación y el consumo de tu mundo para saber si te alcanza.'}
          </p>
        </div>
      )}
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { locale } from '../i18n/format'
import { Zap } from 'lucide-react'
import { useMemo, useState } from 'react'
import { computeFlows } from '../editor/flow'
import { computeGrids } from '../editor/power'
import { DEFAULT_POWER, useEditor } from '../editor/store'
import { NONE } from '../editor/store'

const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 1 })

/** Botón y panel de energía: energía infinita y datos de la red del mundo del jugador. */
export default function PowerSettingsButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { entities, conveyors, routes, wires, rails, floorHeight, setPower } = useEditor()
  const settings = useEditor((s) => s.power) ?? DEFAULT_POWER
  const power = useMemo(() => {
    const flows = computeFlows(entities, conveyors, routes ?? NONE, floorHeight, rails ?? NONE)
    return computeGrids(entities, wires ?? NONE, flows, settings, routes ?? NONE)
  }, [entities, conveyors, routes, wires, rails, floorHeight, settings])

  const spare = settings.worldGen - settings.worldUse
  const hasWorld = settings.worldGen > 0
  const balance = spare + power.planGen - power.planUse
  const status = !hasWorld ? 'muted' : balance >= 0 ? 'ok' : 'bad'

  return (
    <div className="power-settings">
      <button className="tb-btn" onClick={() => setOpen(!open)} title={t('power.title')}>
        <Zap size={16} />
        <span>
          {fmt(power.planUse)} MW{settings.infinite && <span className="tb-extra">{t('power.infiniteSuffix')}</span>}
        </span>
      </button>
      {open && (
        <div className="popover left">
          <label className="switch">
            <input type="checkbox" checked={settings.infinite} onChange={(e) => setPower({ infinite: e.target.checked })} />
            <b>{t('power.infinite')}</b>
          </label>
          <p className="muted small">
            {settings.infinite ? t('power.infiniteOn') : t('power.infiniteOff')}
          </p>
          <h3>{t('power.worldGrid')}</h3>
          <div className="flowline">
            <span>{t('power.totalGen')}</span>
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
            <span>{t('power.currentUse')}</span>
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
          <p className="muted small">{t('power.worldHint')}</p>
          <h3>{t('power.balance')}</h3>
          <div className="flowline">
            <span>{t('power.planUse')}</span>
            <b>{fmt(power.planUse)} MW</b>
          </div>
          {power.planGen > 0 && (
            <div className="flowline">
              <span>{t('power.planGen')}</span>
              <b>{fmt(power.planGen)} MW</b>
            </div>
          )}
          {power.trainsMW > 0 && <p className="muted small">{t('power.trainsNote', { mw: fmt(power.trainsMW) })}</p>}
          {power.planBoost > 0 && <p className="muted small">{t('power.boostNote', { pct: fmt(power.planBoost * 100) })}</p>}
          {hasWorld && (
            <div className="flowline">
              <span>{t('power.worldSpare')}</span>
              <b>{fmt(spare)} MW</b>
            </div>
          )}
          <p className={status}>
            {hasWorld
              ? balance >= 0
                ? t('power.enough', { mw: fmt(balance) })
                : t('power.notEnough', { mw: fmt(-balance) })
              : t('power.fillWorld')}
          </p>
        </div>
      )}
    </div>
  )
}

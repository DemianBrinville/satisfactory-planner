import { fmtPct } from '../i18n/format'
import i18n from '../i18n'
import { Trans, useTranslation } from 'react-i18next'
import { locale } from '../i18n/format'
import { ArrowRight, CircleArrowDown, CircleArrowUp, CircleX } from 'lucide-react'
import { itemName } from '../data/gameData'
import type { NodeFlow } from '../editor/flow'
import { ItemLabel } from './GameIcons'

const fmt = (n: number) => n.toLocaleString(locale(), { maximumFractionDigits: 2 })
const pct = (v: number) => fmtPct(v, 1)

/**
 * Resumen de producción de una máquina: si le llega menos material del ideal igual produce,
 * pero cada ciclo espera al ingrediente que más falta (cuello de botella).
 */
export default function Production({ n, compact }: { n: NodeFlow; compact?: boolean }) {
  const { t } = useTranslation()
  const missing = n.inputs.filter((x) => x.got <= 1e-9)
  const stopped = n.effective <= 1e-9
  const ideal = n.outputs.length ? n.outputs[0].produce : 0
  return (
    <div className={compact ? 'production compact' : 'production'}>
      {stopped && missing.length > 0 && (
        <div className="bad">{t('production.stopped', { items: missing.map((x) => itemName(x.item)).join(', ') })}</div>
      )}
      {!stopped && n.bottleneck && n.cycle && (
        <div className="warn">
          <Trans
            i18nKey="production.bottleneck"
            values={{ pct: pct(n.effective), actual: fmt(n.cycle.actual), ideal: fmt(n.cycle.ideal), item: itemName(n.bottleneck) }}
            components={{ b: <b /> }}
          />
        </div>
      )}
      {!stopped && !n.bottleneck && n.outputLimited < n.inputLimited - 1e-6 && (
        <div className="warn">
          {t('production.outputLimited')}
        </div>
      )}
      {!stopped && !n.bottleneck && n.outputLimited >= n.inputLimited - 1e-6 && ideal > 0 && (
        <div className="ok">{t('production.working', { pct: pct(n.effective) })}</div>
      )}
      {n.inputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.got + 0.01 < x.need ? (x.item === n.bottleneck ? ' bad' : ' warn') : '')}>
          <span className="io">
            <ArrowRight size={13} className="in" /> <ItemLabel item={x.item} name={itemName(x.item)} size={14} />
          </span>
          <span>
            {t('production.gets', { got: fmt(x.got), need: fmt(x.need) })}
          </span>
        </div>
      ))}
      {n.outputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.taken + 0.01 < x.produce ? ' warn' : '')}>
          <span className="io">
            <ArrowRight size={13} className="out" /> <ItemLabel item={x.item} name={itemName(x.item)} size={14} />
          </span>
          <span>
            {t('production.takes', { taken: fmt(x.taken), produce: fmt(x.produce) })}
          </span>
        </div>
      ))}
    </div>
  )
}

export type ClockAdvice =
  | { kind: 'under'; target: number }
  | { kind: 'over'; target: number }
  | { kind: 'impossible'; required: number; machines: number }
  | null

/**
 * Sugerencia de reloj según lo que pide lo de adelante:
 *  - under: le sobra capacidad → bajar el reloj ahorra energía sin perder nada.
 *  - over: no alcanza al reloj actual → subirlo (hasta 250 %) cubriría la demanda.
 *  - impossible: ni al 250 % alcanza → hacen falta más máquinas.
 */
export function clockAdvice(n: NodeFlow | undefined, clock: number): ClockAdvice {
  if (!n || n.required === null || n.required === undefined) return null
  const req = n.required
  if (req > 2.5 + 1e-6) return { kind: 'impossible', required: req, machines: Math.ceil(req - 1e-9) }
  if (req > clock + 0.005) return { kind: 'over', target: req }
  if (req < clock - 0.005 && req > 0.0001) return { kind: 'under', target: req }
  return null
}

export function ClockAdviceText({ a, onApply }: { a: ClockAdvice; onApply?: (v: number) => void }) {
  if (!a) return null
  if (a.kind === 'under')
    return (
      <div className="advice under">
        <CircleArrowDown size={15} className="advice-icon" /> <Trans i18nKey="production.adviceUnder" values={{ pct: pct(a.target) }} components={{ b: <b /> }} />
        {onApply && <button onClick={() => onApply(a.target)}>{i18n.t('common.apply', { pct: pct(a.target) })}</button>}
      </div>
    )
  if (a.kind === 'over')
    return (
      <div className="advice over">
        <CircleArrowUp size={15} className="advice-icon" />{' '}
        <Trans
          i18nKey={a.target > 1 ? 'production.adviceOverClock' : 'production.adviceOver'}
          values={{ pct: pct(a.target), shards: Math.ceil((a.target - 1) / 0.5) }}
          components={{ b: <b /> }}
        />
        {onApply && <button onClick={() => onApply(a.target)}>{i18n.t('common.apply', { pct: pct(a.target) })}</button>}
      </div>
    )
  return (
    <div className="advice impossible">
      <CircleX size={15} className="advice-icon" />{' '}
      <Trans
        i18nKey="production.adviceImpossible"
        values={{ pct: pct(a.required), machines: a.machines, max: Math.ceil(a.required / 2.5 - 1e-9) }}
        components={{ b: <b /> }}
      />
    </div>
  )
}

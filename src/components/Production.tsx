import { ArrowRight, CircleArrowDown, CircleArrowUp, CircleX } from 'lucide-react'
import { itemName } from '../data/gameData'
import type { NodeFlow } from '../editor/flow'

const fmt = (n: number) => n.toLocaleString('es', { maximumFractionDigits: 2 })
const pct = (v: number) => `${Math.round(v * 1000) / 10} %`

/**
 * Resumen de producción de una máquina: si le llega menos material del ideal igual produce,
 * pero cada ciclo espera al ingrediente que más falta (cuello de botella).
 */
export default function Production({ n, compact }: { n: NodeFlow; compact?: boolean }) {
  const missing = n.inputs.filter((x) => x.got <= 1e-9)
  const stopped = n.effective <= 1e-9
  const ideal = n.outputs.length ? n.outputs[0].produce : 0
  return (
    <div className={compact ? 'production compact' : 'production'}>
      {stopped && missing.length > 0 && (
        <div className="bad">No produce: no le llega {missing.map((x) => itemName(x.item)).join(', ')}.</div>
      )}
      {!stopped && n.bottleneck && n.cycle && (
        <div className="warn">
          Produce al {pct(n.effective)} del ideal: cada ciclo tarda {fmt(n.cycle.actual)} s en vez de {fmt(n.cycle.ideal)} s esperando{' '}
          <b>{itemName(n.bottleneck)}</b>.
        </div>
      )}
      {!stopped && !n.bottleneck && n.outputLimited < n.inputLimited - 1e-6 && (
        <div className="warn">
          La salida no se lleva todo lo que puede producir: la cinta llegó a su capacidad o lo que sigue consume menos. El resto se acumula en la
          máquina.
        </div>
      )}
      {!stopped && !n.bottleneck && n.outputLimited >= n.inputLimited - 1e-6 && ideal > 0 && (
        <div className="ok">Trabaja al {pct(n.effective)}.</div>
      )}
      {n.inputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.got + 0.01 < x.need ? (x.item === n.bottleneck ? ' bad' : ' warn') : '')}>
          <span className="io">
            <ArrowRight size={13} className="in" /> {itemName(x.item)}
          </span>
          <span>
            llega {fmt(x.got)} de {fmt(x.need)}/min
          </span>
        </div>
      ))}
      {n.outputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.taken + 0.01 < x.produce ? ' warn' : '')}>
          <span className="io">
            <ArrowRight size={13} className="out" /> {itemName(x.item)}
          </span>
          <span>
            {fmt(x.taken)} de {fmt(x.produce)}/min
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
        <CircleArrowDown size={15} className="advice-icon" /> Lo de adelante pide menos: con el reloj al <b>{pct(a.target)}</b> produce justo lo necesario y consume menos energía.
        {onApply && <button onClick={() => onApply(a.target)}>Aplicar {pct(a.target)}</button>}
      </div>
    )
  if (a.kind === 'over')
    return (
      <div className="advice over">
        <CircleArrowUp size={15} className="advice-icon" /> No alcanza para lo que pide lo de adelante: necesita el reloj al <b>{pct(a.target)}</b>
        {a.target > 1 ? ` (overclock: ${Math.ceil((a.target - 1) / 0.5)} fragmento/s de energía) o una máquina más.` : '.'}
        {onApply && <button onClick={() => onApply(a.target)}>Aplicar {pct(a.target)}</button>}
      </div>
    )
  return (
    <div className="advice impossible">
      <CircleX size={15} className="advice-icon" /> Ni al 250 % alcanza: lo de adelante pide el equivalente a {pct(a.required)}. Hacen falta <b>{a.machines}</b> máquinas al 100 % (o{' '}
      {Math.ceil(a.required / 2.5 - 1e-9)} al 250 %).
    </div>
  )
}

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
        <div className="warn">Lo que está conectado a la salida acepta menos de lo que puede producir.</div>
      )}
      {!stopped && !n.bottleneck && n.outputLimited >= n.inputLimited - 1e-6 && ideal > 0 && (
        <div className="ok">Trabaja al {pct(n.effective)}.</div>
      )}
      {n.inputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.got + 0.01 < x.need ? (x.item === n.bottleneck ? ' bad' : ' warn') : '')}>
          <span>← {itemName(x.item)}</span>
          <span>
            llega {fmt(x.got)} de {fmt(x.need)}/min
          </span>
        </div>
      ))}
      {n.outputs.map((x) => (
        <div key={x.item} className={'flowline' + (x.taken + 0.01 < x.produce ? ' warn' : '')}>
          <span>→ {itemName(x.item)}</span>
          <span>
            {fmt(x.taken)} de {fmt(x.produce)}/min
          </span>
        </div>
      ))}
    </div>
  )
}

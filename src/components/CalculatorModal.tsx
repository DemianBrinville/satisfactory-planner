import { LayoutGrid, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, type Recipe } from '../data/gameData'
import { layoutChain, machineSplit, minersFor, producibleItems, recipesProducing, solveChain } from '../editor/calculator'
import { buildChain, extractorFor, totalLength } from '../editor/chainBuilder'
import { entityRect, useEditor } from '../editor/store'
import { useAvailability } from '../editor/progress'
import Modal from './Modal'
import { ItemLabel } from './GameIcons'

const fmt = (n: number, d = 2) => n.toLocaleString('es', { maximumFractionDigits: d })
const pct = (v: number) => `${fmt(v * 100)} %`
const ALL_ITEMS = producibleItems()

/** Calculadora de objetivo: "quiero X/min de tal producto" → cadena completa de producción. */
export default function CalculatorModal({ onClose }: { onClose: () => void }) {
  const avail = useAvailability()
  const [respectProgress, setRespectProgress] = useState(avail.enabled)
  const [query, setQuery] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  const [rate, setRate] = useState(10)
  const [choice, setChoice] = useState<Record<string, string>>({})
  const [inputs, setInputs] = useState<Set<string>>(new Set())
  const [split, setSplit] = useState<'even' | 'full'>('even')

  const isAvailable = (r: Recipe) => !respectProgress || avail.recipe(r)
  const result = useMemo(
    () => (target && rate > 0 ? solveChain(target, rate, choice, isAvailable, inputs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, rate, choice, inputs, respectProgress, avail.enabled],
  )

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return ALL_ITEMS.filter((i) => itemName(i).toLowerCase().includes(q)).slice(0, 12)
  }, [query])

  const totals = useMemo(() => {
    if (!result) return null
    let machines = 0
    let power = 0
    const cost = new Map<string, number>()
    for (const s of result.steps) {
      const n = machineSplit(s.exact).n
      machines += n
      power += s.power
      for (const c of buildingsById.get(s.building)?.cost ?? []) cost.set(c.item, (cost.get(c.item) ?? 0) + c.amount * n)
    }
    return { machines, power, cost: [...cost].sort((a, b) => b[1] - a[1]) }
  }, [result])

  const [wire, setWire] = useState(true)
  /** Origen del bloque: a la derecha de lo que ya hay en el piso. */
  const origin = () => {
    const st = useEditor.getState()
    const rects = st.entities.filter((e) => e.floor === st.floor).map((e) => entityRect(e)).filter(Boolean)
    if (!rects.length) return { x: 0, y: 0, existing: [] as { x0: number; x1: number; y0: number }[] }
    const x = Math.ceil(Math.max(...rects.map((r) => r!.x1)) / 8) * 8 + 24
    const y = Math.floor(Math.min(...rects.map((r) => r!.y0)) / 8) * 8
    return { x, y, existing: rects.map((r) => ({ x0: r!.x0, x1: r!.x1, y0: r!.y0 })) }
  }
  // vista previa del armado (para avisar antes de colocar)
  const build = useMemo(() => {
    if (!result || !wire || !result.steps.length) return null
    const o = origin()
    return buildChain(result.steps, result.raw, useEditor.getState().floor, { x: o.x, y: o.y }, split)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, wire, split])

  const place = () => {
    if (!result) return
    const st = useEditor.getState()
    if (wire && build) st.addDoc(build)
    else st.addLayout(layoutChain(result.steps, st.floor, origin().existing, split))
    onClose()
  }

  return (
    <Modal title="Calculadora de producción" onClose={onClose} width={900}>
      <div className="calc-head">
        <div className="calc-target">
          <div className="input-icon">
            <Search size={16} className="lead" />
            <input
              placeholder={target ? itemName(target) : 'Qué quieres producir… (ej: Armazón modular)'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {matches.length > 0 && (
            <ul className="suggest">
              {matches.map((i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setTarget(i)
                      setQuery('')
                      setChoice({})
                      setInputs(new Set())
                    }}
                  >
                    <ItemLabel item={i} name={itemName(i)} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="calc-rate">
          <input type="number" min={0.1} step={0.1} value={rate} onChange={(e) => setRate(Math.max(0, Number(e.target.value)))} />
          <span>/min</span>
        </label>
      </div>
      <div className="calc-options">
        <label className="switch">
          <input type="checkbox" checked={respectProgress} onChange={(e) => setRespectProgress(e.target.checked)} />
          Solo recetas desbloqueadas en mi progreso
        </label>
        <div className="segmented small">
          <button className={split === 'even' ? 'active' : ''} onClick={() => setSplit('even')}>
            Todas al mismo reloj
          </button>
          <button className={split === 'full' ? 'active' : ''} onClick={() => setSplit('full')}>
            Al 100 % y una con el resto
          </button>
        </div>
      </div>

      {!target && <p className="muted">Busca un producto, indica cuánto quieres por minuto y te armo la cadena completa hasta las materias primas.</p>}

      {result && target && (
        <>
          <h3>
            {fmt(rate)} {itemName(target)} por minuto
          </h3>
          <table className="calc-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Por minuto</th>
                <th>Receta</th>
                <th>Máquinas</th>
                <th title="No fabricarlo aquí: lo traes de otro lado">Traer</th>
              </tr>
            </thead>
            <tbody>
              {result.steps.map((s) => {
                const opts = recipesProducing(s.item, isAvailable)
                const sp = machineSplit(s.exact)
                const machine = buildingsById.get(s.building)?.name ?? s.building
                return (
                  <tr key={s.item}>
                    <td style={{ paddingLeft: 8 + s.depth * 12 }}>
                      <ItemLabel item={s.item} name={itemName(s.item)} />
                    </td>
                    <td className="num">{fmt(s.rate)}</td>
                    <td>
                      {opts.length > 1 ? (
                        <select value={s.recipe.id} onChange={(e) => setChoice({ ...choice, [s.item]: e.target.value })}>
                          {opts.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                              {r.alternate ? ' (alternativa)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        s.recipe.name
                      )}
                    </td>
                    <td>
                      {split === 'even' || sp.rest < 1e-6 ? (
                        <>
                          <b>{sp.n}</b> × {machine} al {pct(sp.even)}
                        </>
                      ) : (
                        <>
                          <b>{sp.full}</b> × {machine} al 100 % + 1 al {pct(sp.rest)}
                        </>
                      )}
                    </td>
                    <td className="center">
                      <input
                        type="checkbox"
                        checked={inputs.has(s.item)}
                        disabled={s.item === target}
                        onChange={() => {
                          const n = new Set(inputs)
                          if (n.has(s.item)) n.delete(s.item)
                          else n.add(s.item)
                          setInputs(n)
                        }}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="calc-cols">
            <section>
              <h3>Materias primas y entradas</h3>
              {[...result.raw].map(([i, v]) => {
                const exId = extractorFor(i)
                const ex = exId ? buildingsById.get(exId) : null
                const m = ex ? { count: v / (ex.extractPerMinute ?? 60), label: `${ex.name}${ex.kind === 'miner' || /OilPump/.test(ex.id) ? ' (normal)' : ''}` } : minersFor(i, v)
                const traido = inputs.has(i) || result.missing.has(i)
                return (
                  <div key={i} className="flowline">
                    <span>
                      <ItemLabel item={i} name={itemName(i)} />
                      {!traido && game.items[i] && <small className="muted"> · {fmt(m.count)} {m.label}</small>}
                      {result.missing.has(i) && <small className="warn"> · sin receta disponible</small>}
                    </span>
                    <b>{fmt(v)}/min</b>
                  </div>
                )
              })}
              {result.byproducts.size > 0 && (
                <>
                  <h3>Subproductos</h3>
                  <p className="muted small">Hay que sacarlos (almacenar, usar o mandar al AWESOME Sink) o la máquina se frena.</p>
                  {[...result.byproducts].map(([i, v]) => (
                    <div key={i} className="flowline warn">
                      <ItemLabel item={i} name={itemName(i)} />
                      <b>{fmt(v)}/min</b>
                    </div>
                  ))}
                </>
              )}
            </section>
            <section>
              <h3>Total</h3>
              <div className="flowline">
                <span>Máquinas</span>
                <b>{totals?.machines}</b>
              </div>
              <div className="flowline">
                <span>Consumo eléctrico</span>
                <b>{fmt(totals?.power ?? 0, 1)} MW</b>
              </div>
              <h3>Para construir las máquinas</h3>
              {totals?.cost.map(([i, v]) => (
                <div key={i} className="flowline">
                  <ItemLabel item={i} name={itemName(i)} />
                  <b>{fmt(v, 0)}</b>
                </div>
              ))}
            </section>
          </div>
          {build && (
            <div className="calc-wire">
              <p className="muted small">
                Con conexiones: {build.conveyors.length} tramos ({Math.round(totalLength(build.conveyors))} m) con uniones, divisores y uniones de
                tuberías en manifold. Abajo van los taladros y extractores, con la mejor marca que tengas desbloqueada y el reloj justo, y el producto final sale por la derecha. Si dos líneas se cruzan, en el juego una pasa por encima con un poste más alto.
              </p>
              {build.notes.map((n) => (
                <p key={n} className="warn small">
                  {n}
                </p>
              ))}
            </div>
          )}
          <div className="modal-actions">
            <label className="switch">
              <input type="checkbox" checked={wire} onChange={(e) => setWire(e.target.checked)} />
              Conectar con cintas y tuberías
            </label>
            <span className="muted small">Se coloca a la derecha de lo que ya tienes, con recetas y relojes configurados.</span>
            <button className="btn primary" onClick={place} disabled={!result.steps.length}>
              <LayoutGrid size={16} /> Colocar en el plano
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

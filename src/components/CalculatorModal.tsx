import { Trans, useTranslation } from 'react-i18next'
import { locale } from '../i18n/format'
import { LayoutGrid, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, type Recipe } from '../data/gameData'
import { layoutChain, machineSplit, minersFor, producibleItems, recipesProducing, solveChain } from '../editor/calculator'
import { buildChain, extractorFor, totalLength, type ByproductMode } from '../editor/chainBuilder'
import { entityRect, useEditor } from '../editor/store'
import { useAvailability } from '../editor/progress'
import Modal from './Modal'
import { ItemLabel } from './GameIcons'

const fmt = (n: number, d = 2) => n.toLocaleString(locale(), { maximumFractionDigits: d })
const pct = (v: number) => `${fmt(v * 100)} %`
const ALL_ITEMS = producibleItems()

/** Calculadora de objetivo: "quiero X/min de tal producto" → cadena completa de producción. */
export default function CalculatorModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
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
  const [withPower, setWithPower] = useState(true)
  const [byMode, setByMode] = useState<ByproductMode>('sink')
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
    return buildChain(result.steps, result.raw, useEditor.getState().floor, { x: o.x, y: o.y }, split, { power: withPower, byproducts: byMode })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, wire, split, withPower, byMode])

  const place = () => {
    if (!result) return
    const st = useEditor.getState()
    if (wire && build) st.addDoc(build)
    else st.addLayout(layoutChain(result.steps, st.floor, origin().existing, split))
    onClose()
  }

  return (
    <Modal title={t('calc.title')} onClose={onClose} width={900}>
      <div className="calc-head">
        <div className="calc-target">
          <div className="input-icon">
            <Search size={16} className="lead" />
            <input
              placeholder={target ? itemName(target) : t('calc.searchPlaceholder')}
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
          {t('calc.onlyUnlocked')}
        </label>
        <div className="segmented small">
          <button className={split === 'even' ? 'active' : ''} onClick={() => setSplit('even')}>
            {t('calc.splitEven')}
          </button>
          <button className={split === 'full' ? 'active' : ''} onClick={() => setSplit('full')}>
            {t('calc.splitFull')}
          </button>
        </div>
      </div>

      {!target && <p className="muted">{t('calc.intro')}</p>}

      {result && target && (
        <>
          <h3>
            {t('calc.heading', { rate: fmt(rate), item: itemName(target) })}
          </h3>
          <table className="calc-table">
            <thead>
              <tr>
                <th>{t('calc.colProduct')}</th>
                <th>{t('calc.colPerMin')}</th>
                <th>{t('calc.colRecipe')}</th>
                <th>{t('calc.colMachines')}</th>
                <th title={t('calc.colImportTitle')}>{t('calc.colImport')}</th>
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
                              {r.alternate ? t('calc.alternateSuffix') : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        s.recipe.name
                      )}
                    </td>
                    <td>
                      {split === 'even' || sp.rest < 1e-6 ? (
                        <Trans i18nKey="calc.machinesEven" values={{ n: sp.n, machine, pct: pct(sp.even) }} components={{ b: <b /> }} />
                      ) : (
                        <Trans i18nKey="calc.machinesFull" values={{ n: sp.full, machine, pct: pct(sp.rest) }} components={{ b: <b /> }} />
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
              <h3>{t('calc.raw')}</h3>
              {[...result.raw].map(([i, v]) => {
                const exId = extractorFor(i, v)
                const ex = exId ? buildingsById.get(exId) : null
                const m = ex ? { count: v / (ex.extractPerMinute ?? 60), label: `${ex.name}${ex.kind === 'miner' || /OilPump/.test(ex.id) ? t('calc.normalSuffix') : ''}` } : minersFor(i, v)
                const traido = inputs.has(i) || result.missing.has(i)
                return (
                  <div key={i} className="flowline">
                    <span>
                      <ItemLabel item={i} name={itemName(i)} />
                      {!traido && game.items[i] && <small className="muted"> · {fmt(m.count)} {m.label}</small>}
                      {result.missing.has(i) && <small className="warn">{t('calc.noRecipe')}</small>}
                    </span>
                    <b>{fmt(v)}/min</b>
                  </div>
                )
              })}
              {result.byproducts.size > 0 && (
                <>
                  <h3>{t('calc.byproducts')}</h3>
                  <p className="muted small">{t('calc.byproductsHelp')}</p>
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
              <h3>{t('calc.total')}</h3>
              <div className="flowline">
                <span>{t('calc.machines')}</span>
                <b>{totals?.machines}</b>
              </div>
              <div className="flowline">
                <span>{t('calc.power')}</span>
                <b>{fmt(totals?.power ?? 0, 1)} MW</b>
              </div>
              <h3>{t('calc.buildCost')}</h3>
              {totals?.cost.map(([i, v]) => (
                <div key={i} className="flowline">
                  <ItemLabel item={i} name={itemName(i)} />
                  <b>{fmt(v, 0)}</b>
                </div>
              ))}
            </section>
          </div>
          {wire && (
            <div className="calc-options">
              <label className="switch">
                <input type="checkbox" checked={withPower} onChange={(e) => setWithPower(e.target.checked)} />
                {t('calc.powerPoles')}
              </label>
              {result.byproducts.size > 0 && (
                <span className="muted small">{t('calc.byproductsMode')}</span>
              )}
              {result.byproducts.size > 0 && (
                <div className="segmented small">
                  {(['sink', 'storage', 'loose'] as const).map((m) => (
                    <button key={m} className={byMode === m ? 'active' : ''} onClick={() => setByMode(m)}>
                      {t(m === 'sink' ? 'calc.byproductsSink' : m === 'storage' ? 'calc.byproductsStorage' : 'calc.byproductsLoose')}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {build && (
            <div className="calc-wire">
              <p className="muted small">
                {t('calc.wireSummary', { segments: build.conveyors.length, meters: Math.round(totalLength(build.conveyors)) })}
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
              {t('calc.wire')}
            </label>
            <span className="muted small">{t('calc.placeHint')}</span>
            <button className="btn primary" onClick={place} disabled={!result.steps.length}>
              <LayoutGrid size={16} /> {t('calc.place')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

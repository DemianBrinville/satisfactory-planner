import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { buildingsById, game, itemName, recipesById, type Schematic } from '../data/gameData'
import { ALT_SCHEMATICS, HUB_SCHEMATICS, MAM_SCHEMATICS, PHASE_TIERS, SHOP_SCHEMATICS, maxTierForPhase, useProgress } from '../editor/progress'

type Tab = 'hub' | 'mam' | 'alt' | 'shop'

/** Árboles del M.A.M.: el dato viene en español (extractor), la clave de traducción es el id del juego. */
const MAM_KEY: Record<string, string> = {
  Cuarzo: 'Quartz',
  Caterio: 'Caterium',
  'Babosas de energía': 'PowerSlugs',
  'Organismos alienígenas': 'AlienOrganisms',
  Azufre: 'Sulfur',
  Micelios: 'Mycelia',
  Nutrientes: 'Nutrients',
  'Tecnología alienígena': 'AlienTech',
}

const buildingByRecipe = new Map(game.buildings.map((b) => [b.buildRecipe, b]))

/** Qué desbloquea un schematic, en texto corto. */
function unlocksText(s: Schematic) {
  const names = s.recipes
    .map((r) => buildingByRecipe.get(r)?.name ?? recipesById.get(r)?.name)
    .filter(Boolean) as string[]
  return [...new Set(names)].join(', ')
}

export default function ProgressModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const p = useProgress()
  const [tab, setTab] = useState<Tab>('hub')
  const unlocked = new Set(p.unlocked)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{t('progress.title')}</h2>
          <label className="switch">
            <input type="checkbox" checked={p.enabled} onChange={(e) => p.setEnabled(e.target.checked)} />
            {t('progress.filter')}
          </label>
          <button onClick={onClose}>{t('common.close')}</button>
        </header>
        <nav className="tabs">
          {(['hub', 'mam', 'alt', 'shop'] as Tab[]).map((id) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {t(`progress.tabs.${id}`)}
            </button>
          ))}
        </nav>
        <div className="modal-body">
          {tab === 'hub' && <HubTab unlocked={unlocked} />}
          {tab === 'mam' && <MamTab unlocked={unlocked} />}
          {tab === 'alt' && <ListTab list={ALT_SCHEMATICS} unlocked={unlocked} kind="alt" />}
          {tab === 'shop' && <ListTab list={SHOP_SCHEMATICS} unlocked={unlocked} kind="shop" />}
        </div>
      </div>
    </div>
  )
}

function Check({ s, unlocked, disabled }: { s: Schematic; unlocked: Set<string>; disabled?: boolean }) {
  const toggle = useProgress((x) => x.toggle)
  const text = unlocksText(s)
  return (
    <label className={'check' + (disabled ? ' disabled' : '')} title={text}>
      <input type="checkbox" checked={unlocked.has(s.id)} disabled={disabled} onChange={() => toggle(s.id)} />
      <span>
        {s.name}
        {text && <small>{text}</small>}
      </span>
    </label>
  )
}

function HubTab({ unlocked }: { unlocked: Set<string> }) {
  const { t } = useTranslation()
  const { phase, setPhase, setMany } = useProgress()
  const maxTier = maxTierForPhase(phase)
  const allowedUpTo = HUB_SCHEMATICS.filter((s) => s.tier <= maxTier).map((s) => s.id)
  return (
    <>
      <div className="phase-row">
        <span>{t('progress.phaseQuestion')}</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={phase === n ? 'active' : ''} onClick={() => setPhase(n)}>
            {t('progress.phase', { n })}
          </button>
        ))}
        <button onClick={() => setMany(allowedUpTo, true)}>{t('progress.markAvailable')}</button>
      </div>
      {[1, 2, 3, 4, 5].map((ph) => (
        <section key={ph} className={ph > phase ? 'locked' : ''}>
          <h3>
            {t('progress.phase', { n: ph })}
            {ph > phase && t('progress.locked')}
          </h3>
          {PHASE_TIERS[ph].map((tier) => {
            const list = HUB_SCHEMATICS.filter((s) => s.tier === tier)
            if (!list.length) return null
            const all = list.every((s) => unlocked.has(s.id))
            return (
              <div key={tier} className="tier">
                <div className="tier-head">
                  <b>{tier === 0 ? t('progress.tier0') : t('progress.tier', { n: tier })}</b>
                  <button disabled={ph > phase} onClick={() => setMany(list.map((s) => s.id), !all)}>
                    {all ? t('progress.unmarkTier') : t('progress.markTier')}
                  </button>
                </div>
                <div className="checks">
                  {list.map((s) => (
                    <Check key={s.id} s={s} unlocked={unlocked} disabled={ph > phase} />
                  ))}
                </div>
              </div>
            )
          })}
        </section>
      ))}
    </>
  )
}

function MamTab({ unlocked }: { unlocked: Set<string> }) {
  const { t } = useTranslation()
  const setMany = useProgress((x) => x.setMany)
  const trees = useMemo(() => {
    const m = new Map<string, Schematic[]>()
    for (const s of MAM_SCHEMATICS) {
      const k = s.mamTree ?? ''
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return [...m]
  }, [])
  return (
    <>
      {trees.map(([tree, list]) => {
        const all = list.every((s) => unlocked.has(s.id))
        return (
          <section key={tree} className="tier">
            <div className="tier-head">
              <b>{tree ? t(`mamTrees.${MAM_KEY[tree] ?? 'Quartz'}` as 'mamTrees.Quartz', { defaultValue: tree }) : t('progress.other')}</b>
              <button onClick={() => setMany(list.map((s) => s.id), !all)}>{all ? t('progress.unmarkTree') : t('progress.markTree')}</button>
            </div>
            <div className="checks">
              {list.map((s) => (
                <Check key={s.id} s={s} unlocked={unlocked} />
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function ListTab({ list, unlocked, kind }: { list: Schematic[]; unlocked: Set<string>; kind: 'alt' | 'shop' }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const setMany = useProgress((x) => x.setMany)
  const filtered = useMemo(() => {
    const f = q.trim().toLowerCase()
    return list
      .filter((s) => !f || s.name.toLowerCase().includes(f) || unlocksText(s).toLowerCase().includes(f))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [list, q])
  const count = list.filter((s) => unlocked.has(s.id)).length
  return (
    <>
      <div className="phase-row">
        <input className="search" placeholder={t('progress.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">
          {t('progress.marked', { n: count, total: list.length })}
        </span>
        <button onClick={() => setMany(filtered.map((s) => s.id), true)}>{t('progress.markVisible')}</button>
        <button onClick={() => setMany(filtered.map((s) => s.id), false)}>{t('progress.unmarkVisible')}</button>
      </div>
      {kind === 'alt' && (
        <p className="muted">{t('progress.altHelp')}</p>
      )}
      <div className="checks wide">
        {filtered.map((s) => (
          <AltCheck key={s.id} s={s} unlocked={unlocked} />
        ))}
      </div>
    </>
  )
}

/** Alternativa con un resumen de su receta (entradas → salidas). */
function AltCheck({ s, unlocked }: { s: Schematic; unlocked: Set<string> }) {
  const toggle = useProgress((x) => x.toggle)
  const r = s.recipes.map((id) => recipesById.get(id)).find(Boolean)
  const b = s.recipes.map((id) => buildingByRecipe.get(id)).find(Boolean)
  return (
    <label className="check">
      <input type="checkbox" checked={unlocked.has(s.id)} onChange={() => toggle(s.id)} />
      <span>
        {s.name}
        {r && (
          <small>
            {r.ingredients.map((i) => itemName(i.item)).join(' + ')} → {r.products.map((i) => itemName(i.item)).join(' + ')}
            {r.producedIn[0] && ` · ${buildingsById.get(r.producedIn[0])?.name}`}
          </small>
        )}
        {!r && b && <small>{b.name}</small>}
      </span>
    </label>
  )
}

import {
  Calculator,
  Cloud,
  CloudOff,
  Copy,
  Globe,
  Languages,
  Layers,
  ListChecks,
  Loader2,
  Minus,
  Plus,
  Redo2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useCloud } from '../cloud/cloud'
import { useEditor } from '../editor/store'
import { Trans, useTranslation } from 'react-i18next'
import { SUPPORTED } from '../i18n'
import AccountMenu from './AccountMenu'
import PowerSettingsButton from './PowerSettings'
import ProblemsButton from './Problems'
import { AppLogo } from './GameIcons'

interface Props {
  onCalculator: () => void
  onProgress: () => void
  onCommunity: () => void
}

/** Barra superior: plano actual, pisos, historial, herramientas y cuenta. */
export default function Topbar({ onCalculator, onProgress, onCommunity }: Props) {
  const { t } = useTranslation()
  const { floor, setFloor, undo, redo, past, future, floorHeight, setFloorHeight } = useEditor()
  const cloud = useCloud()

  return (
    <header className="topbar">
      <div className="tb-group">
        <div className="brand">
          <span className="brand-logo app-logo">
            <AppLogo size={28} />
          </span>
          <span className="brand-name">{t('app.name')}</span>
        </div>
      </div>

      <div className="tb-group plan">
        {cloud.viewing ? <ViewingBadge /> : <PlanTitle />}
      </div>

      <div className="tb-group tools">
        <div className="segment" title={t('topbar.floorTitle')}>
          <Layers size={16} className="seg-icon" />
          <button className="icon-btn sm" onClick={() => setFloor(floor - 1)} title={t('topbar.floorDown')}>
            <Minus size={14} />
          </button>
          <span className="seg-value">{t('topbar.floor', { n: floor })}</span>
          <button className="icon-btn sm" onClick={() => setFloor(floor + 1)} title={t('topbar.floorUp')}>
            <Plus size={14} />
          </button>
          <span className="seg-sep" />
          <label className="seg-field" title={t('topbar.floorHeight')}>
            <input type="number" min={4} max={48} step={1} value={floorHeight} onChange={(e) => setFloorHeight(Number(e.target.value))} />
            <span>m</span>
          </label>
        </div>
        <div className="segment">
          <button className="icon-btn" onClick={undo} disabled={!past.length} title={t('topbar.undo')}>
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!future.length} title={t('topbar.redo')}>
            <Redo2 size={16} />
          </button>
        </div>
        <button className="tb-btn" onClick={onCalculator} title={t('topbar.calculatorTitle')}>
          <Calculator size={16} />
          <span>{t('topbar.calculator')}</span>
        </button>
        <button className="tb-btn" onClick={onProgress} title={t('topbar.progressTitle')}>
          <ListChecks size={16} />
          <span>{t('topbar.progress')}</span>
        </button>
        <PowerSettingsButton />
        <ProblemsButton />
        <button className="tb-btn" onClick={onCommunity} title={t('topbar.communityTitle')}>
          <Globe size={16} />
          <span>{t('topbar.community')}</span>
        </button>
      </div>

      <div className="tb-group end">
        <LanguageSelect />
        <AccountMenu />
      </div>
    </header>
  )
}

/** Nombre del plano (editable) y estado de guardado. */
function PlanTitle() {
  const { t } = useTranslation()
  const c = useCloud()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const state = c.saveState
  return (
    <>
      {c.currentId && editing ? (
        <input
          className="plan-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim()) c.renameCurrent(name.trim())
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button
          className="plan-title"
          title={c.currentId ? t('topbar.rename') : t('topbar.signInToSave')}
          onClick={() => {
            if (!c.currentId) return
            setName(c.currentName)
            setEditing(true)
          }}
        >
          {c.currentName || t('cloud.localDraft')}
        </button>
      )}
      <span className={'save-state ' + state} title={c.error ?? undefined}>
        {state === 'saving' && <Loader2 size={14} className="spin" />}
        {state === 'saved' && <Cloud size={14} />}
        {state === 'local' && <CloudOff size={14} />}
        {state === 'error' && <TriangleAlert size={14} />}
        {t(`topbar.save.${state}`)}
      </span>
    </>
  )
}

/** Aviso de modo vista de un plano de la comunidad. */
function ViewingBadge() {
  const { t } = useTranslation()
  const { viewing, copyViewing, exitView, user } = useCloud()
  if (!viewing) return null
  return (
    <div className="viewing">
      <span>
        <Trans i18nKey="topbar.viewing" values={{ name: viewing.name, author: viewing.author }} components={{ b: <b /> }} />
      </span>
      <button className="tb-btn primary" onClick={copyViewing} title={user ? t('topbar.saveCopyTitleUser') : t('topbar.saveCopyTitleGuest')}>
        <Copy size={14} />
        <span>{t('topbar.saveCopy')}</span>
      </button>
      <button className="icon-btn" onClick={exitView} title={t('topbar.closeView')}>
        <X size={16} />
      </button>
    </div>
  )
}

/** Selector de idioma de la interfaz y de los nombres del juego. */
function LanguageSelect() {
  const { t, i18n } = useTranslation()
  return (
    <label className="lang-select" title={t('language.label')}>
      <Languages size={15} />
      <select value={i18n.resolvedLanguage} onChange={(e) => i18n.changeLanguage(e.target.value)} aria-label={t('language.label')}>
        {SUPPORTED.map((l) => (
          <option key={l} value={l}>
            {t(`language.${l}`)}
          </option>
        ))}
      </select>
    </label>
  )
}

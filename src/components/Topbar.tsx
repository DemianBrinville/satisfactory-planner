import {
  Calculator,
  Cloud,
  CloudOff,
  Copy,
  Globe,
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
import AccountMenu from './AccountMenu'
import PowerSettingsButton from './PowerSettings'
import { AppLogo } from './GameIcons'

interface Props {
  onCalculator: () => void
  onProgress: () => void
  onCommunity: () => void
}

/** Barra superior: plano actual, pisos, historial, herramientas y cuenta. */
export default function Topbar({ onCalculator, onProgress, onCommunity }: Props) {
  const { floor, setFloor, undo, redo, past, future, floorHeight, setFloorHeight } = useEditor()
  const cloud = useCloud()

  return (
    <header className="topbar">
      <div className="tb-group">
        <div className="brand">
          <span className="brand-logo app-logo">
            <AppLogo size={28} />
          </span>
          <span className="brand-name">Satisfactory Planner</span>
        </div>
      </div>

      <div className="tb-group plan">
        {cloud.viewing ? <ViewingBadge /> : <PlanTitle />}
      </div>

      <div className="tb-group tools">
        <div className="segment" title="Piso que estás viendo">
          <Layers size={16} className="seg-icon" />
          <button className="icon-btn sm" onClick={() => setFloor(floor - 1)} title="Bajar un piso">
            <Minus size={14} />
          </button>
          <span className="seg-value">Piso {floor}</span>
          <button className="icon-btn sm" onClick={() => setFloor(floor + 1)} title="Subir un piso">
            <Plus size={14} />
          </button>
          <span className="seg-sep" />
          <label className="seg-field" title="Altura entre pisos: se usa para elevadoras, tuberías verticales y altura de bombeo">
            <input type="number" min={4} max={48} step={1} value={floorHeight} onChange={(e) => setFloorHeight(Number(e.target.value))} />
            <span>m</span>
          </label>
        </div>
        <div className="segment">
          <button className="icon-btn" onClick={undo} disabled={!past.length} title="Deshacer (Ctrl+Z)">
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!future.length} title="Rehacer (Ctrl+Y)">
            <Redo2 size={16} />
          </button>
        </div>
        <button className="tb-btn" onClick={onCalculator} title="Calcular la cadena para producir X por minuto">
          <Calculator size={16} />
          <span>Calculadora</span>
        </button>
        <button className="tb-btn" onClick={onProgress} title="Lo que tienes desbloqueado en tu partida">
          <ListChecks size={16} />
          <span>Progreso</span>
        </button>
        <PowerSettingsButton />
        <button className="tb-btn" onClick={onCommunity} title="Planos compartidos por otros jugadores">
          <Globe size={16} />
          <span>Comunidad</span>
        </button>
      </div>

      <div className="tb-group end">
        <AccountMenu />
      </div>
    </header>
  )
}

/** Nombre del plano (editable) y estado de guardado. */
function PlanTitle() {
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
          title={c.currentId ? 'Clic para renombrar' : 'Inicia sesión para guardar el plano en tu cuenta'}
          onClick={() => {
            if (!c.currentId) return
            setName(c.currentName)
            setEditing(true)
          }}
        >
          {c.currentName}
        </button>
      )}
      <span className={'save-state ' + state} title={c.error ?? undefined}>
        {state === 'saving' && <Loader2 size={14} className="spin" />}
        {state === 'saved' && <Cloud size={14} />}
        {state === 'local' && <CloudOff size={14} />}
        {state === 'error' && <TriangleAlert size={14} />}
        {state === 'saving' ? 'Guardando' : state === 'saved' ? 'Guardado' : state === 'local' ? 'Solo en este navegador' : 'Error al guardar'}
      </span>
    </>
  )
}

/** Aviso de modo vista de un plano de la comunidad. */
function ViewingBadge() {
  const { viewing, copyViewing, exitView, user } = useCloud()
  if (!viewing) return null
  return (
    <div className="viewing">
      <span>
        Viendo <b>{viewing.name}</b> de {viewing.author}
      </span>
      <button className="tb-btn primary" onClick={copyViewing} title={user ? 'Guardar una copia en tus planos' : 'Quedarte con una copia local'}>
        <Copy size={14} />
        <span>Guardar copia</span>
      </button>
      <button className="icon-btn" onClick={exitView} title="Cerrar la vista">
        <X size={16} />
      </button>
    </div>
  )
}

import { useState } from 'react'
import AccountBar from './components/AccountBar'
import PowerSettingsButton from './components/PowerSettings'
import Palette from './components/Palette'
import ProgressModal from './components/ProgressModal'
import PlannerCanvas from './components/PlannerCanvas'
import SidePanel from './components/SidePanel'
import { useEditor } from './editor/store'

function App() {
  const { floor, setFloor, undo, redo, past, future, floorHeight, setFloorHeight } = useEditor()
  const [progressOpen, setProgressOpen] = useState(false)
  return (
    <div className="app">
      <header className="topbar">
        <h1>Satisfactory Planner</h1>
        <div className="floors">
          <span>Piso</span>
          <button onClick={() => setFloor(floor - 1)} title="Bajar un piso">−</button>
          <b>{floor}</b>
          <button onClick={() => setFloor(floor + 1)} title="Subir un piso">+</button>
          <span className="muted" title="Altura entre pisos: se usa para elevadoras, tuberías verticales y altura de bombeo">
            cada
          </span>
          <input
            className="small-input"
            type="number"
            min={4}
            max={48}
            step={1}
            value={floorHeight}
            onChange={(e) => setFloorHeight(Number(e.target.value))}
          />
          <span className="muted">m</span>
        </div>
        <button onClick={() => setProgressOpen(true)}>Mi progreso</button>
        <PowerSettingsButton />
        <div className="history">
          <button onClick={undo} disabled={!past.length}>Deshacer</button>
          <button onClick={redo} disabled={!future.length}>Rehacer</button>
        </div>
        <AccountBar />
      </header>
      <Palette />
      <PlannerCanvas />
      <SidePanel />
      {progressOpen && <ProgressModal onClose={() => setProgressOpen(false)} />}
    </div>
  )
}

export default App

import Palette from './components/Palette'
import PlannerCanvas from './components/PlannerCanvas'
import SidePanel from './components/SidePanel'
import { useEditor } from './editor/store'

function App() {
  const { floor, setFloor, undo, redo, past, future } = useEditor()
  return (
    <div className="app">
      <header className="topbar">
        <h1>Satisfactory Planner</h1>
        <div className="floors">
          <span>Piso</span>
          <button onClick={() => setFloor(floor - 1)} title="Bajar un piso">−</button>
          <b>{floor}</b>
          <button onClick={() => setFloor(floor + 1)} title="Subir un piso">+</button>
        </div>
        <div className="history">
          <button onClick={undo} disabled={!past.length}>Deshacer</button>
          <button onClick={redo} disabled={!future.length}>Rehacer</button>
        </div>
      </header>
      <Palette />
      <PlannerCanvas />
      <SidePanel />
    </div>
  )
}

export default App

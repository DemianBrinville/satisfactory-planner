import { useEffect, useState } from 'react'
import AuthModal, { RecoveryModal } from './components/AuthModal'
import CommunityModal from './components/CommunityModal'
import Palette from './components/Palette'
import PlannerCanvas from './components/PlannerCanvas'
import ProgressModal from './components/ProgressModal'
import SidePanel from './components/SidePanel'
import Topbar from './components/Topbar'

const LAYOUT_KEY = 'satisfactory-planner:layout'

function App() {
  const [progressOpen, setProgressOpen] = useState(false)
  const [communityOpen, setCommunityOpen] = useState(false)
  // paneles laterales plegables, cada uno por separado (se recuerda entre visitas)
  const [panels, setPanels] = useState<{ left: boolean; right: boolean }>(() => {
    try {
      return { left: true, right: true, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') }
    } catch {
      return { left: true, right: true }
    }
  })
  useEffect(() => localStorage.setItem(LAYOUT_KEY, JSON.stringify(panels)), [panels])

  return (
    <div className={'app' + (panels.left ? '' : ' no-left') + (panels.right ? '' : ' no-right')}>
      <Topbar
        leftOpen={panels.left}
        rightOpen={panels.right}
        onToggleLeft={() => setPanels((p) => ({ ...p, left: !p.left }))}
        onToggleRight={() => setPanels((p) => ({ ...p, right: !p.right }))}
        onProgress={() => setProgressOpen(true)}
        onCommunity={() => setCommunityOpen(true)}
      />
      {panels.left && <Palette />}
      <PlannerCanvas />
      {panels.right && <SidePanel />}
      {progressOpen && <ProgressModal onClose={() => setProgressOpen(false)} />}
      {communityOpen && <CommunityModal onClose={() => setCommunityOpen(false)} />}
      <AuthModal />
      <RecoveryModal />
    </div>
  )
}

export default App

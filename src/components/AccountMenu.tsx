import { ChevronDown, FilePlus2, FolderOpen, Globe, Lock, LogIn, LogOut, Pencil, Trash2, User, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useCloud, type PlanMeta } from '../cloud/cloud'
import Modal from './Modal'

/** Menú de cuenta: entrar/registrarse, o perfil, planos y salir. */
export default function AccountMenu() {
  const c = useCloud()
  const [open, setOpen] = useState(false)
  const [modal, setModal] = useState<'plans' | 'profile' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [])

  if (!c.ready) return null
  if (!c.user)
    return (
      <div className="tb-group">
        <button className="tb-btn" onClick={() => c.openAuth('login')}>
          <LogIn size={16} />
          <span>Iniciar sesión</span>
        </button>
        <button className="tb-btn primary" onClick={() => c.openAuth('signup')}>
          <UserPlus size={16} />
          <span>Crear cuenta</span>
        </button>
      </div>
    )

  const name = c.profile?.display_name || c.profile?.username || c.user.email || 'Mi cuenta'
  return (
    <div className="account-menu" ref={ref}>
      <button className="tb-btn" onClick={() => setOpen(!open)}>
        <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
        <span className="account-name">{name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-head">
            <b>{name}</b>
            {c.profile?.username && <small>@{c.profile.username}</small>}
          </div>
          <button onClick={() => (setModal('plans'), setOpen(false))}>
            <FolderOpen size={16} /> Mis planos
          </button>
          <button onClick={() => (setModal('profile'), setOpen(false))}>
            <User size={16} /> Mi perfil
          </button>
          <button className="danger" onClick={() => (c.signOut(), setOpen(false))}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      )}
      {modal === 'plans' && <PlansModal onClose={() => setModal(null)} />}
      {modal === 'profile' && <ProfileModal onClose={() => setModal(null)} />}
    </div>
  )
}

function PlansModal({ onClose }: { onClose: () => void }) {
  const c = useCloud()
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [sharing, setSharing] = useState<PlanMeta | null>(null)

  return (
    <Modal title="Mis planos" onClose={onClose} width={620}>
      <form
        className="row-form"
        onSubmit={async (e) => {
          e.preventDefault()
          await c.newPlan(newName.trim() || 'Plano sin nombre')
          setNewName('')
          onClose()
        }}
      >
        <input placeholder="Nombre del plano nuevo" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit" className="btn primary">
          <FilePlus2 size={16} /> Crear
        </button>
      </form>
      <ul className="plan-list">
        {c.plans.map((p) => (
          <li key={p.id} className={p.id === c.currentId ? 'active' : ''}>
            <button
              className="plan-open"
              onClick={async () => {
                await c.openPlan(p.id)
                onClose()
              }}
            >
              <b>{p.name}</b>
              <small>
                {new Date(p.updated_at).toLocaleString('es')}
                {p.is_public && ' · compartido con la comunidad'}
              </small>
            </button>
            <button
              className={'icon-btn' + (p.is_public ? ' on' : '')}
              title={p.is_public ? 'Compartido: clic para dejarlo privado' : 'Privado: clic para compartirlo con la comunidad'}
              onClick={() => (p.is_public ? c.setPlanPublic(p.id, false) : setSharing(p))}
            >
              {p.is_public ? <Globe size={16} /> : <Lock size={16} />}
            </button>
            {confirmDelete === p.id ? (
              <>
                <button className="btn danger sm" onClick={() => c.deletePlan(p.id)}>
                  Borrar
                </button>
                <button className="btn sm" onClick={() => setConfirmDelete(null)}>
                  No
                </button>
              </>
            ) : (
              <button className="icon-btn" onClick={() => setConfirmDelete(p.id)} title="Eliminar plano">
                <Trash2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {c.error && <p className="bad">{c.error}</p>}
      {sharing && <ShareModal plan={sharing} onClose={() => setSharing(null)} />}
    </Modal>
  )
}

function ShareModal({ plan, onClose }: { plan: PlanMeta; onClose: () => void }) {
  const c = useCloud()
  const [desc, setDesc] = useState(plan.description ?? '')
  return (
    <Modal title={`Compartir "${plan.name}"`} onClose={onClose} width={460}>
      <p className="muted">
        Cualquiera podrá ver el plano en Comunidad y guardarse una copia. Tus cambios posteriores también se verán. Puedes volver a dejarlo privado
        cuando quieras.
      </p>
      <label className="field">
        <span>Descripción (opcional)</span>
        <textarea maxLength={500} rows={4} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Qué produce, cuántas máquinas, qué hace falta desbloquear…" />
      </label>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn primary"
          onClick={async () => {
            await c.setPlanPublic(plan.id, true, desc.trim())
            onClose()
          }}
        >
          <Globe size={16} /> Compartir
        </button>
      </div>
    </Modal>
  )
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const c = useCloud()
  const [username, setUsername] = useState(c.profile?.username ?? '')
  const [displayName, setDisplayName] = useState(c.profile?.display_name ?? '')
  const [bio, setBio] = useState(c.profile?.bio ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <Modal title="Mi perfil" onClose={onClose} width={460}>
      <p className="muted">Así te ven los demás jugadores en los planos que compartes.</p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          setSaved(await c.updateProfile({ username: username.trim(), display_name: displayName.trim() || null, bio: bio.trim() || null }))
        }}
      >
        <label className="field">
          <span>Nombre de usuario</span>
          <div className="input-icon">
            <span className="prefix">@</span>
            <input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_.\-]+" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
        </label>
        <label className="field">
          <span>Nombre visible</span>
          <input maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field">
          <span>Sobre ti</span>
          <textarea maxLength={280} rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
        </label>
        <p className="muted small">Email: {c.user?.email}</p>
        {c.error && <p className="bad">{c.error}</p>}
        {saved && !c.error && <p className="ok">Perfil guardado.</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn primary">
            <Pencil size={16} /> Guardar
          </button>
        </div>
      </form>
    </Modal>
  )
}

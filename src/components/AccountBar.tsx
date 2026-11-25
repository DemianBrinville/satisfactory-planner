import { useState } from 'react'
import { useCloud } from '../cloud/cloud'

const SAVE_LABEL = { local: 'Solo en este navegador', saving: 'Guardando…', saved: 'Guardado', error: 'Error al guardar' }

/** Nombre del plano, estado de guardado, lista de planos y sesión. */
export default function AccountBar() {
  const c = useCloud()
  const [open, setOpen] = useState<'plans' | 'login' | null>(null)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')

  return (
    <div className="account">
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
          title={c.currentId ? 'Clic para renombrar' : undefined}
          onClick={() => {
            if (!c.currentId) return
            setName(c.currentName)
            setEditing(true)
          }}
        >
          {c.currentName}
        </button>
      )}
      <span className={'save-state ' + c.saveState}>{SAVE_LABEL[c.saveState]}</span>
      {c.user ? (
        <>
          <button onClick={() => setOpen(open === 'plans' ? null : 'plans')}>Mis planos</button>
          <button onClick={() => c.signOut()} title={c.user.email}>
            Salir
          </button>
        </>
      ) : (
        c.ready && <button onClick={() => setOpen(open === 'login' ? null : 'login')}>Iniciar sesión</button>
      )}
      {open === 'plans' && <PlansPopover onClose={() => setOpen(null)} />}
      {open === 'login' && <LoginPopover onClose={() => setOpen(null)} />}
    </div>
  )
}

function LoginPopover({ onClose }: { onClose: () => void }) {
  const { signIn, error } = useCloud()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <div className="popover">
      {sent ? (
        <p>
          Te enviamos un enlace a <b>{email}</b>. Ábrelo en este navegador para entrar. Tus planos y tu progreso se guardarán en tu cuenta.
        </p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (await signIn(email.trim())) setSent(true)
          }}
        >
          <p>Entra con tu email: te llega un enlace, sin contraseña.</p>
          <input type="email" required placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <button type="submit">Enviar enlace</button>
          {error && <p className="bad">{error}</p>}
        </form>
      )}
      <button className="link" onClick={onClose}>
        Cerrar
      </button>
    </div>
  )
}

function PlansPopover({ onClose }: { onClose: () => void }) {
  const c = useCloud()
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  return (
    <div className="popover plans">
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await c.newPlan(newName.trim() || 'Plano sin nombre')
          setNewName('')
          onClose()
        }}
      >
        <input placeholder="Nombre del plano nuevo" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button type="submit">Crear</button>
      </form>
      <ul>
        {c.plans.map((p) => (
          <li key={p.id} className={p.id === c.currentId ? 'active' : ''}>
            <button
              className="open"
              onClick={async () => {
                await c.openPlan(p.id)
                onClose()
              }}
            >
              <b>{p.name}</b>
              <small>{new Date(p.updated_at).toLocaleString('es')}</small>
            </button>
            {confirmDelete === p.id ? (
              <>
                <button className="danger" onClick={() => c.deletePlan(p.id)}>
                  Borrar
                </button>
                <button onClick={() => setConfirmDelete(null)}>No</button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(p.id)} title="Eliminar plano">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
      {c.error && <p className="bad">{c.error}</p>}
    </div>
  )
}

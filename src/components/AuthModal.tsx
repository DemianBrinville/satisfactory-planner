import { Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useCloud } from '../cloud/cloud'
import Modal from './Modal'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoComplete: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="input-icon">
      <Lock size={16} className="lead" />
      <input
        type={show ? 'text' : 'password'}
        required
        minLength={6}
        placeholder={placeholder}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="trail" onClick={() => setShow(!show)} title={show ? 'Ocultar' : 'Mostrar'} tabIndex={-1}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

/** Inicio de sesión, registro y recuperación de contraseña. */
export default function AuthModal() {
  const c = useCloud()
  const mode = c.authOpen
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!mode) return null

  const switchTo = (m: typeof mode) => {
    setMessage(null)
    setLocalError(null)
    c.openAuth(m)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setLocalError(null)
    if (mode === 'signup' && password !== confirm) return setLocalError('Las contraseñas no coinciden.')
    setBusy(true)
    if (mode === 'login') await c.signIn(email.trim(), password)
    else if (mode === 'signup') {
      const r = await c.signUp(email.trim(), password)
      if (r === 'confirm') setMessage(`Te enviamos un correo a ${email.trim()} para confirmar la cuenta. Ábrelo y después inicia sesión aquí.`)
    } else if (await c.resetPassword(email.trim())) {
      setMessage('Te enviamos un enlace para elegir una contraseña nueva. Ábrelo en este navegador.')
    }
    setBusy(false)
  }

  const title = mode === 'login' ? 'Iniciar sesión' : mode === 'signup' ? 'Crear cuenta' : 'Recuperar contraseña'
  return (
    <Modal title={title} onClose={() => c.openAuth(null)} width={400}>
      {mode !== 'reset' && (
        <>
          <button className="btn google" onClick={() => c.signInWithGoogle()}>
            <GoogleIcon /> Continuar con Google
          </button>
          <div className="divider">
            <span>o con tu email</span>
          </div>
        </>
      )}
      <form className="stack" onSubmit={submit}>
        <div className="input-icon">
          <Mail size={16} className="lead" />
          <input type="email" required placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </div>
        {mode !== 'reset' && (
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder={mode === 'signup' ? 'Contraseña (mínimo 6 caracteres)' : 'Contraseña'}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        )}
        {mode === 'signup' && <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repite la contraseña" autoComplete="new-password" />}
        {mode === 'login' && (
          <button type="button" className="link right" onClick={() => switchTo('reset')}>
            ¿Olvidaste tu contraseña?
          </button>
        )}
        {(localError || c.error) && <p className="bad">{localError || c.error}</p>}
        {message && <p className="ok">{message}</p>}
        <button type="submit" className="btn primary block" disabled={busy}>
          {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
      </form>
      <p className="muted small center">
        {mode === 'login' && (
          <>
            ¿No tienes cuenta?{' '}
            <button className="link" onClick={() => switchTo('signup')}>
              Crear una
            </button>
          </>
        )}
        {mode === 'signup' && (
          <>
            ¿Ya tienes cuenta?{' '}
            <button className="link" onClick={() => switchTo('login')}>
              Inicia sesión
            </button>
          </>
        )}
        {mode === 'reset' && (
          <button className="link" onClick={() => switchTo('login')}>
            Volver a iniciar sesión
          </button>
        )}
      </p>
      <p className="muted small center">Lo que tengas dibujado se guarda en tu cuenta al entrar.</p>
    </Modal>
  )
}

/** Al volver del enlace de recuperación: elegir la contraseña nueva. */
export function RecoveryModal() {
  const c = useCloud()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  if (!c.recovering) return null
  return (
    <Modal title="Elige tu contraseña nueva" width={400}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          if (password !== confirm) return setErr('Las contraseñas no coinciden.')
          setErr(null)
          await c.updatePassword(password)
        }}
      >
        <PasswordInput value={password} onChange={setPassword} placeholder="Contraseña nueva" autoComplete="new-password" />
        <PasswordInput value={confirm} onChange={setConfirm} placeholder="Repite la contraseña" autoComplete="new-password" />
        {(err || c.error) && <p className="bad">{err || c.error}</p>}
        <button type="submit" className="btn primary block">
          <KeyRound size={16} /> Guardar contraseña
        </button>
      </form>
    </Modal>
  )
}

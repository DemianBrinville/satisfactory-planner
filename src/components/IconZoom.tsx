import { useEffect, useRef, useState } from 'react'

/**
 * Vista ampliada de los iconos: al dejar el mouse un momento sobre cualquier imagen con
 * `data-zoom` (los iconos oficiales) aparece una versión grande junto al cursor, con su nombre.
 * Un solo componente para toda la app: escucha el documento en vez de cada icono.
 */
export default function IconZoom() {
  const [shown, setShown] = useState<{ src: string; label: string; x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const current = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-zoom]') as HTMLElement | null
      if (el === current.current) return
      current.current = el
      clearTimeout(timer.current)
      setShown(null)
      if (!el) return
      timer.current = setTimeout(() => {
        const r = el.getBoundingClientRect()
        setShown({ src: el.dataset.zoom!, label: el.dataset.zoomLabel ?? '', x: r.right + 10, y: r.top + r.height / 2 })
      }, 350)
    }
    const hide = () => {
      clearTimeout(timer.current)
      current.current = null
      setShown(null)
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  if (!shown) return null
  // que no se salga de la ventana
  const W = 152
  const x = Math.min(shown.x, window.innerWidth - W - 8)
  const y = Math.min(Math.max(8, shown.y - 80), window.innerHeight - 180)
  return (
    <div className="icon-zoom" style={{ left: x, top: y }} aria-hidden>
      <img src={shown.src} width={128} height={128} alt="" />
      {shown.label && <span>{shown.label}</span>}
    </div>
  )
}

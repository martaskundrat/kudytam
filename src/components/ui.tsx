import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type TouchEvent } from 'react'
import { fmtTime } from '../lib/time'
import type { Departure, VehicleType } from '../types'

/* ---------- ikony (inline SVG, bez závislostí) ---------- */
type IconProps = { className?: string }
const svg = (d: ReactNode) =>
  function Icon({ className = 'size-5' }: IconProps) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
        {d}
      </svg>
    )
  }

export const IconMenu = svg(<path d="M4 6h16M4 12h16M4 18h16" />)
export const IconClose = svg(<path d="M18 6 6 18M6 6l12 12" />)
export const IconRefresh = svg(<><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>)
export const IconPin = svg(<><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></>)
export const IconHome = svg(<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h5v-6h4v6h5V10" /></>)
export const IconFlag = svg(<><path d="M4 22V4" /><path d="M4 4h13l-2 4 2 4H4" /></>)
export const IconWalk = svg(<><circle cx="13" cy="4" r="2" /><path d="m9 20 3-6 3 3v4M7 12l3-4 4 1 3 4" /></>)
export const IconWallet = svg(<><rect x="3" y="6" width="18" height="14" rx="3" /><path d="M3 10h18M16 15h2" /></>)
export const IconTicket = svg(<><path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3Z" /><path d="M13 6v12" strokeDasharray="2 2" /></>)
export const IconClock = svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const IconSparkle = svg(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />)
export const IconSwap = svg(<path d="M7 4v16M7 4 3 8M7 4l4 4M17 20V4M17 20l-4-4M17 20l4-4" />)
export const IconPlus = svg(<path d="M12 5v14M5 12h14" />)
export const IconTrash = svg(<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />)
export const IconCheck = svg(<path d="m5 12 5 5L20 7" />)
export const IconAccessible = svg(<><circle cx="12" cy="4" r="2" /><path d="M12 7v7h5l2 5M8 10a6 6 0 1 0 7 8" /></>)
export const IconSnow = svg(<path d="M12 2v20M4 6l16 12M20 6 4 18" />)
export const IconBike = svg(<><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16 10 8h5l3 8M10 8 8.5 5H7M12 16l3-8" /></>)
export const IconCar = svg(<><path d="M5 17H3v-5l2-5h14l2 5v5h-2" /><path d="M3 12h18" /><circle cx="7.5" cy="17" r="2" /><circle cx="16.5" cy="17" r="2" /><path d="M9.5 17h5" /></>)
export const IconBus =svg(<><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 11h14M8 21v-3M16 21v-3" /><circle cx="8.5" cy="14.5" r=".8" /><circle cx="15.5" cy="14.5" r=".8" /></>)

/* ---------- linka ---------- */
const VEHICLE_COLOR: Record<VehicleType, string> = {
  tram: 'bg-tram',
  metro: 'bg-metro-a',
  train: 'bg-train',
  bus: 'bg-bus',
  trolleybus: 'bg-bus',
  ferry: 'bg-sky-700',
  funicular: 'bg-amber-700',
  other: 'bg-zinc-600',
}
export const VEHICLE_LABEL: Record<VehicleType, string> = {
  tram: 'Tramvaj',
  metro: 'Metro',
  train: 'Vlak',
  bus: 'Autobus',
  trolleybus: 'Trolejbus',
  ferry: 'Přívoz',
  funicular: 'Lanovka',
  other: 'Spoj',
}

export function LineBadge({ dep, size = 'md' }: { dep: Pick<Departure, 'line' | 'vehicle' | 'isNight'>; size?: 'sm' | 'md' | 'lg' }) {
  let color = VEHICLE_COLOR[dep.vehicle]
  if (dep.vehicle === 'metro') color = dep.line === 'B' ? 'bg-metro-b text-black' : dep.line === 'C' ? 'bg-metro-c' : 'bg-metro-a'
  if (dep.isNight) color = 'bg-zinc-800 ring-1 ring-zinc-500'
  const dim = size === 'lg' ? 'min-w-14 h-12 text-xl rounded-xl' : size === 'sm' ? 'min-w-8 h-7 text-sm rounded-md' : 'min-w-11 h-9 text-base rounded-lg'
  return (
    <span className={`${color} ${dim} inline-flex shrink-0 items-center justify-center px-2 font-extrabold tracking-tight`}>
      {dep.line}
    </span>
  )
}

/* ---------- bottom sheet ---------- */
/**
 * Spodní panel. Zavře se: křížkem, klepnutím mimo, stažením dolů za horní lištu,
 * klávesou Esc i systémovým tlačítkem/gestem Zpět (přes History API).
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [dragY, setDragY] = useState(0)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const id = Math.random().toString(36).slice(2)
    history.pushState({ ...(history.state ?? {}), sheet: id }, '')
    const onPop = () => closeRef.current()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('popstate', onPop)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // zavřeno jinak než tlačítkem Zpět – záznam v historii zneutralizujeme
      if (history.state?.sheet === id) history.replaceState({ ...history.state, sheet: undefined }, '')
    }
  }, [open])

  if (!open) return null
  const dragHandlers = {
    onTouchStart: (e: TouchEvent) => (startY.current = e.touches[0].clientY),
    onTouchMove: (e: TouchEvent) => startY.current !== null && setDragY(Math.max(0, e.touches[0].clientY - startY.current)),
    onTouchEnd: () => {
      if (dragY > 90) onClose()
      setDragY(0)
      startY.current = null
    },
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="animate-fade-in absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        className="animate-slide-up pb-safe relative flex max-h-[88dvh] w-full max-w-lg flex-col rounded-t-3xl bg-elevated"
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragY ? 'none' : 'transform .2s' }}
      >
        <div className="flex shrink-0 touch-none items-center gap-2 px-5 pt-3 pb-2" {...dragHandlers}>
          <div className="flex-1">
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-zinc-600" />
            {title && <h2 className="text-xl font-bold">{title}</h2>}
          </div>
          <button onClick={onClose} className="-mr-2 self-start rounded-full bg-highlight p-2 text-muted hover:text-white" aria-label="Zavřít">
            <IconClose />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5">{children}</div>
      </div>
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const v =
    variant === 'primary'
      ? 'bg-brand text-black hover:bg-brand-hover hover:scale-[1.02]'
      : variant === 'secondary'
        ? 'bg-transparent text-white ring-1 ring-zinc-500 hover:ring-white'
        : 'bg-highlight text-white hover:bg-zinc-700'
  return (
    <button
      className={`${v} inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-bold transition active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-zinc-600'}`}
    >
      <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  )
}

/* ---------- čas ---------- */
export function useNow(intervalMs = 10000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export { fmtTime }
export const fmtKc = (n: number) => `${n.toLocaleString('cs-CZ')} Kč`

export function minutesLabel(ms: number, now: number) {
  const m = Math.floor((ms - now) / 60000)
  if (m <= 0) return 'teď'
  if (m < 60) return `${m} min`
  return fmtTime(ms)
}

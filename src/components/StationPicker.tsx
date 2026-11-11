import { useEffect, useState, type ReactNode } from 'react'
import { searchAddresses } from '../lib/geocode'
import { loadStations, searchStations } from '../lib/stations'
import type { LatLon, Place } from '../types'
import { IconClose, IconPin } from './ui'

const TYPE_ICON: Record<string, string> = { metro: 'Ⓜ️', tram: '🚋', bus: '🚌', train: '🚆', trolleybus: '🚎', ferry: '⛴️', funicular: '🚠' }

interface Props {
  label: string
  icon: ReactNode
  value: Place | null
  placeholder: string
  emptyLabel: string
  /** nabídnout „Moje poloha“ (null) jako volbu */
  allowCurrent?: boolean
  /** hledat i adresy a místa (nejen stanice PID) */
  addresses?: boolean
  near?: LatLon | null
  onChange: (p: Place | null) => void
}

export function StationPicker({ label, icon, value, placeholder, emptyLabel, allowCurrent, addresses, near, onChange }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <span className="text-brand">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-wider text-subtle uppercase">{label}</span>
          <span className={`block truncate font-semibold ${value ? '' : 'text-muted'}`}>{value?.name ?? emptyLabel}</span>
          {value?.detail && addresses && <span className="block truncate text-xs text-subtle">{value.detail}</span>}
        </span>
        {value && (
          <span
            role="button"
            aria-label="Zrušit"
            onClick={(e) => {
              e.stopPropagation()
              onChange(null)
            }}
            className="rounded-full p-1.5 text-muted hover:bg-zinc-600 hover:text-white"
          >
            <IconClose className="size-4" />
          </span>
        )}
      </button>
      {open && (
        <SearchOverlay
          placeholder={placeholder}
          emptyLabel={allowCurrent ? emptyLabel : null}
          addresses={!!addresses}
          near={near}
          onClose={() => setOpen(false)}
          onPick={(p) => {
            onChange(p)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function SearchOverlay({
  placeholder,
  emptyLabel,
  addresses,
  near,
  onClose,
  onPick,
}: {
  placeholder: string
  emptyLabel: string | null
  addresses: boolean
  near?: LatLon | null
  onClose: () => void
  onPick: (p: Place | null) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [addr, setAddr] = useState<Place[]>([])
  const [addrLoading, setAddrLoading] = useState(false)

  // adresy: s prodlevou, ať se neptáme při každém písmenu
  useEffect(() => {
    if (!addresses || q.trim().length < 3) return setAddr([])
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setAddrLoading(true)
      searchAddresses(q, near, ctrl.signal)
        .then(setAddr)
        .catch(() => !ctrl.signal.aborted && setAddr([]))
        .finally(() => !ctrl.signal.aborted && setAddrLoading(false))
    }, 350)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q, near, addresses])

  useEffect(() => {
    loadStations()
      .then(() => setReady(true))
      .catch((e) => setError((e as Error).message))
  }, [])

  useEffect(() => {
    let alive = true
    searchStations(q, near)
      .then((r) => alive && setResults(r))
      .catch((e) => alive && setError((e as Error).message))
    return () => {
      alive = false
    }
  }, [q, near, ready])

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="animate-fade-in pt-safe fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="mx-auto flex w-full max-w-lg items-center gap-2 px-4 pb-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && results[0] && onPick(results[0])}
          placeholder={placeholder}
          enterKeyHint="search"
          className="min-w-0 flex-1 rounded-full bg-highlight px-5 py-3 text-lg outline-none ring-brand placeholder:text-subtle focus:ring-2"
        />
        <button onClick={onClose} className="px-2 font-semibold text-muted hover:text-white">
          Zrušit
        </button>
      </div>
      <ul className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-2 pb-8">
        {emptyLabel && (
          <li>
            <button onClick={() => onPick(null)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-highlight">
              <span className="flex size-10 items-center justify-center rounded-full bg-brand/15 text-brand">
                <IconPin className="size-5" />
              </span>
              <span className="font-semibold">{emptyLabel}</span>
            </button>
          </li>
        )}
        {error && <li className="px-4 py-3 text-sm text-red-400">{error}</li>}
        {!ready && !error && q.length >= 2 && <li className="px-4 py-3 text-sm text-subtle">Načítám stanice…</li>}
        {ready && q.trim().length >= 2 && results.length === 0 && (!addresses || (!addrLoading && addr.length === 0)) && (
          <li className="px-4 py-3 text-sm text-subtle">{addresses ? 'Nic nenalezeno.' : 'Žádná stanice PID nenalezena.'}</li>
        )}
        {q.trim().length < 2 && (
          <li className="px-4 py-3 text-sm text-subtle">{addresses ? 'Napiš adresu (ulice a číslo) nebo název stanice.' : 'Napiš aspoň 2 písmena názvu stanice.'}</li>
        )}
        {addresses && results.length > 0 && <li className="px-4 pt-2 pb-1 text-[11px] font-bold tracking-wider text-subtle uppercase">Stanice</li>}
        {results.map((r) => (
          <li key={r.name}>
            <button onClick={() => onPick(r)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-highlight">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-highlight text-lg">
                {TYPE_ICON[r.types?.find((t) => t === 'metro' || t === 'train') ?? r.types?.[0] ?? 'bus'] ?? '🚏'}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.name}</span>
                {r.detail && <span className="block truncate text-xs text-subtle">{r.detail}</span>}
              </span>
            </button>
          </li>
        ))}
        {addresses && (addr.length > 0 || addrLoading) && (
          <li className="px-4 pt-3 pb-1 text-[11px] font-bold tracking-wider text-subtle uppercase">Adresy {addrLoading && '· hledám…'}</li>
        )}
        {addr.map((r) => (
          <li key={`a-${r.lat}-${r.lon}`}>
            <button onClick={() => onPick(r)} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-highlight">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-highlight text-lg">🏠</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.name}</span>
                {r.detail && <span className="block truncate text-xs text-subtle">{r.detail}</span>}
              </span>
            </button>
          </li>
        ))}
        {addresses && addr.length > 0 && <li className="px-4 pt-2 text-[10px] text-subtle">Adresy © OpenStreetMap contributors</li>}
      </ul>
    </div>
  )
}

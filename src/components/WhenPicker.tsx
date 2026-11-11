import type { When } from '../lib/journeys'
import { IconClock } from './ui'

/** datetime-local pracuje v místním čase bez zóny: "YYYY-MM-DDTHH:mm" */
const toLocalInput = (t: number) => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Popis zvoleného času, např. „odjezd zítra 7:30“ */
export function whenLabel(w: When): string {
  const d = new Date(w.at)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const day =
    d.toDateString() === today.toDateString()
      ? 'dnes'
      : d.toDateString() === tomorrow.toDateString()
        ? 'zítra'
        : d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' })
  return `${w.arriveBy ? 'příjezd do' : 'odjezd'} ${day} ${d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`
}

type Mode = 'now' | 'depart' | 'arrive'

/** Teď / Odjezd v / Příjezd do + datum a čas (jako v IDOSu). */
export function WhenPicker({ value, onChange }: { value: When | null; onChange: (w: When | null) => void }) {
  const mode: Mode = !value ? 'now' : value.arriveBy ? 'arrive' : 'depart'
  // při přepnutí z „Teď“ nabídni nejbližší čtvrthodinu
  const defaultAt = () => Math.ceil(Date.now() / (15 * 60000)) * 15 * 60000
  const set = (m: Mode) => onChange(m === 'now' ? null : { at: value?.at ?? defaultAt(), arriveBy: m === 'arrive' })
  const btn = (m: Mode, label: string) => (
    <button
      onClick={() => set(m)}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${mode === m ? 'bg-white text-black' : 'text-muted hover:text-white'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <IconClock className="size-4 shrink-0 text-muted" />
      <div className="flex rounded-full bg-highlight p-0.5">
        {btn('now', 'Teď')}
        {btn('depart', 'Odjezd')}
        {btn('arrive', 'Příjezd')}
      </div>
      {value && (
        <input
          type="datetime-local"
          value={toLocalInput(value.at)}
          min={toLocalInput(Date.now())}
          onChange={(e) => {
            const t = new Date(e.target.value).getTime()
            if (!Number.isNaN(t)) onChange({ ...value, at: t })
          }}
          className="min-w-0 flex-1 rounded-full bg-highlight px-3 py-1.5 text-sm text-white [color-scheme:dark]"
          aria-label={value.arriveBy ? 'Příjezd do' : 'Odjezd v'}
        />
      )}
    </div>
  )
}

import type { When } from '../lib/journeys'
import { fmtWhen, fromWallInput, isForeignTz, toWallInput, tzLabel } from '../lib/time'
import { IconClock } from './ui'

/**
 * Popis zvoleného času, např. „odjezd zítra 07:30“; v cizím pásmu místní čas
 * a v závorce čas telefonu: „odjezd čt 12. 11. 08:00 (čt 12. 11. 00:00)“.
 */
export function whenLabel(w: When, tz?: string): string {
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const d = new Date(w.at)
  let text = fmtWhen(w.at, tz)
  // „zítra“ jen pro čas bez cizího pásma (u dvou pásem by „zítra“ nemuselo platit pro obě)
  if (!isForeignTz(tz, w.at) && d.toDateString() === tomorrow.toDateString()) text = `zítra ${text.replace(/^\S+ \S+ \S+ /, '')}`
  return `${w.arriveBy ? 'příjezd do' : 'odjezd'} ${text}`
}

type Mode = 'now' | 'depart' | 'arrive'

/**
 * Teď / Odjezd v / Příjezd do + datum a čas (jako v IDOSu). Čas se zadává v místním čase:
 * odjezd v pásmu místa odjezdu, příjezd v pásmu cíle (`tz`, bez něj pásmo telefonu).
 */
export function WhenPicker({ value, onChange, tz }: { value: When | null; onChange: (w: When | null) => void; tz?: string }) {
  const mode: Mode = !value ? 'now' : value.arriveBy ? 'arrive' : 'depart'
  // při přepnutí z „Teď“ nabídni nejbližší čtvrthodinu
  const defaultAt = () => Math.ceil(Date.now() / (15 * 60000)) * 15 * 60000
  const set = (m: Mode) => onChange(m === 'now' ? null : { at: value?.at ?? defaultAt(), arriveBy: m === 'arrive' })
  const foreign = !!value && isForeignTz(tz, value.at)
  const btn = (m: Mode, label: string) => (
    <button
      onClick={() => set(m)}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${mode === m ? 'bg-white text-black' : 'text-muted hover:text-white'}`}
    >
      {label}
    </button>
  )
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <IconClock className="size-4 shrink-0 text-muted" />
        <div className="flex rounded-full bg-highlight p-0.5">
          {btn('now', 'Teď')}
          {btn('depart', 'Odjezd')}
          {btn('arrive', 'Příjezd')}
        </div>
        {value && (
          <input
            type="datetime-local"
            value={toWallInput(value.at, tz)}
            min={toWallInput(Date.now(), tz)}
            onChange={(e) => {
              const t = fromWallInput(e.target.value, tz)
              if (!Number.isNaN(t)) onChange({ ...value, at: t })
            }}
            className="min-w-0 flex-1 rounded-full bg-highlight px-3 py-1.5 text-sm text-white [color-scheme:dark]"
            aria-label={value.arriveBy ? 'Příjezd do' : 'Odjezd v'}
          />
        )}
      </div>
      {foreign && tz && (
        <p className="mt-1 pl-6 text-xs text-subtle">
          Místní čas {value!.arriveBy ? 'v cíli' : 'v místě odjezdu'} ({tzLabel(tz, value!.at)}) · podle telefonu {fmtWhen(value!.at)}
        </p>
      )}
    </div>
  )
}

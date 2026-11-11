import { useState, type ReactNode } from 'react'
import { settingsStore, speedKmh, TRAVEL_MODES, uid, useStore } from '../lib/store'
import { ALL_ZONES, CATEGORY_LABELS, isCouponActive, PRAGUE_ZONES } from '../lib/tickets'
import type { Coupon, PassengerCategory } from '../types'
import { StationPicker } from './StationPicker'
import { Button, IconClose, IconHome, IconPlus, IconTrash } from './ui'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-white/5 py-5">
      <h3 className="mb-3 text-sm font-bold tracking-wider text-white uppercase">{title}</h3>
      {children}
    </section>
  )
}

export function Menu({ open, onClose, liveData }: { open: boolean; onClose: () => void; liveData: boolean }) {
  const s = useStore(settingsStore)
  const set = settingsStore.set
  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex">
      <aside className="animate-slide-in pt-safe pb-safe relative z-10 h-full w-[88%] max-w-sm overflow-y-auto bg-surface px-5">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="size-8" />
            <span className="text-xl font-extrabold">Kudytam</span>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-highlight hover:text-white" aria-label="Zavřít menu">
            <IconClose />
          </button>
        </div>

        <Section title="Domov">
          <div className="rounded-xl bg-highlight">
            <StationPicker
              label="Domov"
              icon={<IconHome />}
              value={s.home}
              emptyLabel="Nastav adresu nebo stanici"
              placeholder="Adresa domova nebo stanice"
              addresses
              onChange={(home) => set({ home })}
            />
          </div>
          <p className="mt-2 text-xs text-subtle">Tlačítko „Domů“ na hlavní obrazovce pak najde nejlepší spojení domů z místa, kde právě jsi.</p>
        </Section>

        <Section title="Rychlost přesunu na zastávku">
          <div className="grid grid-cols-3 gap-2">
            {TRAVEL_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => set({ travelModeId: m.id })}
                className={`rounded-xl px-2 py-3 text-center transition ${
                  s.travelModeId === m.id ? 'bg-brand text-black' : 'bg-highlight text-white hover:bg-zinc-700'
                }`}
              >
                <div className="text-xl">{m.icon}</div>
                <div className="text-xs font-semibold">{m.label}</div>
                {m.id !== 'custom' && <div className="text-[10px] opacity-70">{m.kmh} km/h</div>}
              </button>
            ))}
          </div>
          {s.travelModeId === 'custom' && (
            <label className="mt-4 block">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted">Vlastní rychlost</span>
                <span className="font-bold text-brand">{s.customKmh.toFixed(1)} km/h</span>
              </div>
              <input type="range" min={2} max={25} step={0.5} value={s.customKmh} onChange={(e) => set({ customKmh: Number(e.target.value) })} className="w-full" />
            </label>
          )}
          <p className="mt-3 text-xs text-subtle">
            Aktuálně {speedKmh(s)} km/h · 500 m ≈ {Math.round((500 * 1.3) / ((speedKmh(s) * 1000) / 60))} min (počítáme s klikatostí ulic).
          </p>
        </Section>

        <Section title="Hledání spojů">
          <Range label="Nejbližší okolí" value={s.nearRadius} min={150} max={800} step={50} unit="m" onChange={(nearRadius) => set({ nearRadius })} />
          <Range
            label="Širší okolí"
            value={s.wideRadius}
            min={Math.max(500, s.nearRadius + 100)}
            max={2500}
            step={100}
            unit="m"
            onChange={(wideRadius) => set({ wideRadius })}
          />
          <Range label="Hledat lepší spoj, když nic nejede do" value={s.thresholdMin} min={3} max={30} step={1} unit="min" onChange={(thresholdMin) => set({ thresholdMin })} />
        </Section>

        <Section title="Cestující a slevy">
          <select
            value={s.category}
            onChange={(e) => set({ category: e.target.value as PassengerCategory })}
            className="w-full rounded-xl bg-highlight px-4 py-3 font-semibold outline-none focus:ring-2 focus:ring-brand"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-subtle">Nárok na slevu je nutné při kontrole doložit (průkaz ISIC, In Karta, doklad totožnosti).</p>
        </Section>

        <Section title="Moje kupóny">
          <Coupons coupons={s.coupons} onChange={(coupons) => set({ coupons })} />
        </Section>

        <Section title="Zdroj dat">
          <p className={`text-sm ${liveData ? "text-brand" : "text-amber-300"}`}>{liveData ? "Živá data PID (Golemio)" : "Demo data – na serveru chybí Golemio API klíč"}</p>
        </Section>

        <p className="py-6 text-center text-xs text-subtle">Data: Golemio / PID · data.pid.cz</p>
      </aside>
      <div className="animate-fade-in absolute inset-0 bg-black/70" onClick={onClose} />
    </div>
  )
}

function Range(p: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="mb-4 block last:mb-0">
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="text-muted">{p.label}</span>
        <span className="shrink-0 font-bold text-brand">
          {p.value} {p.unit}
        </span>
      </div>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} className="w-full" />
    </label>
  )
}

function Coupons({ coupons, onChange }: { coupons: Coupon[]; onChange: (c: Coupon[]) => void }) {
  const [adding, setAdding] = useState(false)
  const [type, setType] = useState<Coupon['type']>('litacka-praha')
  const [zones, setZones] = useState<string[]>(['1', '2'])
  const inMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const [validUntil, setValidUntil] = useState(inMonth)

  const add = () => {
    const z = type === 'litacka-praha' ? PRAGUE_ZONES : zones
    if (!z.length) return
    onChange([
      ...coupons,
      { id: uid(), type, zones: z, validUntil, label: type === 'litacka-praha' ? 'Lítačka Praha' : `Lítačka pásma ${z.join(', ')}` },
    ])
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      {coupons.length === 0 && !adding && <p className="text-sm text-subtle">Nemáš uložený žádný předplatní kupón.</p>}
      {coupons.map((c) => {
        const active = isCouponActive(c)
        return (
          <div key={c.id} className="flex items-center gap-3 rounded-xl bg-highlight px-4 py-3">
            <div className={`size-2.5 rounded-full ${active ? 'bg-brand' : 'bg-red-500'}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{c.label}</div>
              <div className="text-xs text-subtle">
                {active ? 'platí' : 'vypršel'} do {new Date(c.validUntil).toLocaleDateString('cs-CZ')} · pásma {c.zones.join(', ')}
              </div>
            </div>
            <button onClick={() => onChange(coupons.filter((x) => x.id !== c.id))} className="p-1 text-muted hover:text-red-400" aria-label="Odebrat">
              <IconTrash className="size-4" />
            </button>
          </div>
        )
      })}

      {adding ? (
        <div className="space-y-3 rounded-xl bg-highlight p-4">
          <div className="grid grid-cols-2 gap-2">
            {(['litacka-praha', 'litacka-zones'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${type === t ? 'bg-brand text-black' : 'bg-zinc-700'}`}
              >
                {t === 'litacka-praha' ? 'Praha (P,0,B)' : 'Vybraná pásma'}
              </button>
            ))}
          </div>
          {type === 'litacka-zones' && (
            <div className="flex flex-wrap gap-1.5">
              {ALL_ZONES.map((z) => (
                <button
                  key={z}
                  onClick={() => setZones((zs) => (zs.includes(z) ? zs.filter((x) => x !== z) : [...zs, z]))}
                  className={`size-9 rounded-lg text-sm font-bold ${zones.includes(z) ? 'bg-brand text-black' : 'bg-zinc-700'}`}
                >
                  {z}
                </button>
              ))}
            </div>
          )}
          <label className="block text-sm text-muted">
            Platí do
            <input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="mt-1 w-full rounded-lg bg-zinc-800 px-3 py-2 text-white [color-scheme:dark]"
            />
          </label>
          <div className="flex gap-2">
            <Button onClick={add} className="flex-1 py-2">
              Uložit
            </Button>
            <Button variant="ghost" onClick={() => setAdding(false)} className="py-2">
              Zrušit
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)} className="w-full py-2.5">
          <IconPlus className="size-4" /> Přidat kupón
        </Button>
      )}
    </div>
  )
}

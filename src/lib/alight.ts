/**
 * Upozornění na výstup (notifikace přes service worker).
 *
 * Kdy upozornit: autobus, tramvaj, metro… 30 s před příjezdem do výstupní zastávky, vlak 5 min předem.
 * Když je jízda z předchozí zastávky kratší, upozorní hned po odjezdu z ní
 * (čas = max(příjezd − předstih, odjezd z předchozí zastávky)).
 *
 * - Zpoždění: časy se obnovují z Transitous /trip (real-time průjezdy zastávkami).
 * - Poloha: když je k dispozici přesná a čerstvá poloha, upřesní odhad – spoj ještě stojí
 *   v předchozí zastávce (nebo je před ní) → počká; je už za ní → odhad zbývajícího času
 *   podle rychlosti / podílu ujeté vzdálenosti. V metru (bez GPS) platí jen čas.
 */
import type { LatLon, VehicleType } from '../types'
import { distanceM } from './geo'
import { fetchTrip, type TransitLeg } from './journeys'
import { createStore } from './store'
import { fmtTime } from './time'

export interface AlightAlert {
  id: string
  line: string
  vehicle: VehicleType
  tripId?: string
  fromName: string
  toName: string
  to: LatLon
  track?: string
  tz?: string
  /** odjezd z nástupní zastávky (ms, se zpožděním) */
  dep: number
  /** příjezd do výstupní zastávky (ms, se zpožděním) */
  arr: number
  /** odjezd z poslední zastávky před výstupem */
  prevDep?: number
  prev?: LatLon
  /** kdy upozornit podle času (bez korekce polohou) */
  fireAt: number
  fired: boolean
  /** kdy se naposledy obnovily časy spoje */
  refreshedAt?: number
}

const store = createStore<{ alerts: AlightAlert[] }>('kudytam.alight', { alerts: [] })
export const alightStore = store

export const alertId = (l: TransitLeg) => `${l.tripId ?? l.line}@${l.from.scheduled}>${l.to.name}`

/** předstih upozornění: vlak 5 min, ostatní 30 s */
export const leadMs = (v: VehicleType) => (v === 'train' ? 5 * 60000 : 30000)

const computeFireAt = (a: Pick<AlightAlert, 'arr' | 'dep' | 'prevDep' | 'vehicle'>) =>
  Math.max(a.arr - leadMs(a.vehicle), a.prevDep ?? a.dep)

const update = (id: string, patch: Partial<AlightAlert>) =>
  store.set((s) => ({ alerts: s.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))

/** Zapne upozornění pro úsek. Vrací chybu (text), pokud notifikace nejdou. */
export async function enableAlert(l: TransitLeg): Promise<string | null> {
  if (!('Notification' in window)) {
    return 'Tento prohlížeč upozornění neumí. Na iPhonu přidej Kudytam na plochu (Sdílet → Přidat na plochu) a otevři ho odtud.'
  }
  const perm = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (perm !== 'granted') return 'Upozornění jsou zakázaná. Povol je v nastavení prohlížeče pro tento web.'
  // poloha upřesní odhad – zeptej se teď (zamítnutí nevadí, pak platí jen čas)
  navigator.geolocation?.getCurrentPosition(
    () => {},
    () => {},
    { enableHighAccuracy: true, timeout: 10000 },
  )
  const base = {
    id: alertId(l),
    line: l.line,
    vehicle: l.vehicle,
    tripId: l.tripId,
    fromName: l.from.name,
    toName: l.to.name,
    to: { lat: l.to.lat, lon: l.to.lon },
    track: l.to.track,
    tz: l.to.tz,
    dep: l.from.time,
    arr: l.to.time,
    // bez trasy spoje: při jediné zastávce je předchozí zastávka ta nástupní
    ...(l.stops <= 1 ? { prevDep: l.from.time, prev: { lat: l.from.lat, lon: l.from.lon } } : {}),
    fired: false,
  }
  const alert: AlightAlert = { ...base, fireAt: computeFireAt(base) }
  store.set((s) => ({ alerts: [...s.alerts.filter((a) => a.id !== alert.id), alert] }))
  startAlightWatcher()
  void refresh(alert)
  return null
}

export function disableAlert(id: string) {
  store.set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }))
}

/** Aktuální časy spoje (zpoždění) a poslední zastávka před výstupem. */
async function refresh(a: AlightAlert) {
  if (!a.tripId) return
  try {
    const { stops } = await fetchTrip(a.tripId)
    const iFrom = stops.findIndex((s) => s.name === a.fromName)
    const iTo = stops.findIndex((s, i) => i > iFrom && s.name === a.toName)
    if (iFrom < 0 || iTo < 0) return update(a.id, { refreshedAt: Date.now() })
    const to = stops[iTo]
    // poslední obsluhovaná zastávka před výstupem
    let ip = iTo - 1
    while (ip > iFrom && stops[ip].cancelled) ip--
    const p = stops[ip]
    const arr = to.arr ?? to.schedArr ?? a.arr
    const dep = stops[iFrom].dep ?? stops[iFrom].schedDep ?? a.dep
    const prevDep = p.dep ?? p.schedDep ?? p.arr
    const patch = {
      arr,
      dep,
      prevDep,
      prev: p.lat !== undefined && p.lon !== undefined ? { lat: p.lat, lon: p.lon } : a.prev,
      to: to.lat !== undefined && to.lon !== undefined ? { lat: to.lat, lon: to.lon } : a.to,
      track: to.track ?? a.track,
      refreshedAt: Date.now(),
    }
    const cur = store.get().alerts.find((x) => x.id === a.id)
    if (cur) update(a.id, { ...patch, fireAt: computeFireAt({ ...cur, ...patch }) })
  } catch {
    update(a.id, { refreshedAt: Date.now() })
  }
}

/* ---------- poloha ---------- */

interface Fix extends LatLon {
  at: number
  accuracy: number
  /** m/s */
  speed: number | null
}
let fix: Fix | null = null
let watchId: number | null = null

function setWatch(on: boolean) {
  if (!('geolocation' in navigator)) return
  if (on && watchId === null) {
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        fix = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now(), accuracy: p.coords.accuracy, speed: p.coords.speed }
        tick()
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
  } else if (!on && watchId !== null) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
    fix = null
  }
}

/**
 * Odhad podle polohy: hold = spoj ještě nevyjel z předchozí zastávky (počkej),
 * eta = zbývající čas do příjezdu (ms). null = poloha nepoužitelná.
 */
function gpsEstimate(a: AlightAlert, now: number): { hold: true } | { hold: false; eta: number; departed: boolean } | null {
  if (!fix || now - fix.at > 45000 || fix.accuracy > 150) return null
  const dT = distanceM(fix, a.to)
  const speedEta = fix.speed !== null && fix.speed > 2 ? ((dT * 1.2) / fix.speed) * 1000 : null
  if (!a.prev) return speedEta === null ? null : { hold: false, eta: speedEta, departed: false }
  const segM = Math.max(distanceM(a.prev, a.to), 1)
  const dP = distanceM(fix, a.prev)
  // poloha mimo úsek (např. telefon jinde než ve spoji) – nepoužívat
  if (dP + dT > segM * 2 + 1500) return null
  // ještě před předchozí zastávkou nebo v ní
  if (dT > segM + 200 || dP < 120) return { hold: true }
  const segMs = Math.max((a.arr - (a.prevDep ?? a.dep)) || 0, 30000)
  const eta = speedEta ?? (dT / segM) * segMs
  return { hold: false, eta, departed: true }
}

/* ---------- notifikace ---------- */

async function notify(a: AlightAlert) {
  const title = 'Na další zastávce vystupte'
  const where = a.track ? ` · ${a.vehicle === 'train' ? 'kolej' : 'nást.'} ${a.track}` : ''
  const opts = {
    body: `${a.toName}${where} · ${a.line} · příjezd ${fmtTime(a.arr, a.tz)}`,
    tag: `alight-${a.id}`,
    icon: '/icon.svg',
    badge: '/icon.svg',
    requireInteraction: true,
    renotify: true,
    vibrate: [400, 150, 400, 150, 400],
    data: { url: '/' },
  } as NotificationOptions
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) return await reg.showNotification(title, opts)
  } catch {
    /* zkusíme přímo */
  }
  try {
    new Notification(title, opts)
  } catch {
    /* Android Chrome bez service workeru notifikaci z okna nedovolí */
  }
  navigator.vibrate?.([400, 150, 400, 150, 400])
}

/* ---------- hlídání ---------- */

let timer: ReturnType<typeof setInterval> | null = null
const refreshing = new Set<string>()

function tick() {
  const now = Date.now()
  const alerts = store.get().alerts
  // staré pryč
  const live = alerts.filter((a) => now < a.arr + 30 * 60000)
  if (live.length !== alerts.length) store.set({ alerts: live })

  let needGps = false
  for (const a of live) {
    if (a.fired) continue
    const lead = leadMs(a.vehicle)

    // obnova zpoždění: blízko upozornění každých 30 s, jinak po 2 min
    const every = a.fireAt - now < 15 * 60000 ? 30000 : 120000
    if (a.tripId && !refreshing.has(a.id) && now - (a.refreshedAt ?? 0) > every) {
      refreshing.add(a.id)
      void refresh(a).finally(() => refreshing.delete(a.id))
    }

    // příjezd dávno minul (aplikace byla uspaná) – pozdní upozornění nemá smysl
    if (now > Math.max(a.arr, a.fireAt + 10 * 60000) + 60000) {
      update(a.id, { fired: true })
      continue
    }

    const onBoard = now >= a.dep - 60000
    const near = Math.abs(now - a.fireAt) < 15 * 60000
    if (onBoard && near) needGps = true

    let due = now >= a.fireAt
    const g = onBoard && near ? gpsEstimate(a, now) : null
    if (g) {
      // poloha může upozornění oddálit nejvýš o 10 min oproti času
      const capped = now >= a.fireAt + 10 * 60000
      if (g.hold) due = capped
      else {
        const shortHop = g.departed && a.arr - (a.prevDep ?? a.dep) <= lead
        due = capped || shortHop || g.eta <= lead + 10000 || (due && g.eta <= lead * 2)
      }
    }
    if (due) {
      update(a.id, { fired: true })
      void notify(a)
    }
  }
  setWatch(needGps)
  if (!live.some((a) => !a.fired) && timer) {
    clearInterval(timer)
    timer = null
    setWatch(false)
  }
}

/** Spustí hlídání (při startu aplikace a po zapnutí upozornění). */
export function startAlightWatcher() {
  if (timer || !store.get().alerts.some((a) => !a.fired)) return
  timer = setInterval(tick, 5000)
  tick()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      startAlightWatcher()
      if (timer) tick()
    }
  })
}

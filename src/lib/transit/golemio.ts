/**
 * Klient pro Golemio API (otevřená data Prahy a PID – Pražská integrovaná doprava).
 * Dokumentace: https://api.golemio.cz/docs/openapi/
 * Volá se přes vlastní proxy /api/golemio (Netlify edge funkce / Vite dev proxy),
 * která přidává API klíč – ten tak nikdy není v prohlížeči.
 */
import type { Departure, LatLon, Stop, TripTarget } from '../../types'
import { nearbyPlatforms } from '../stations'
import { normalize } from '../text'
import { gtfsTimeToSec, parseZones, vehicleFromRouteType, type TransitProvider } from './types'

const BASE = '/api/golemio'

/* eslint-disable @typescript-eslint/no-explicit-any */
export class GolemioProvider implements TransitProvider {
  readonly name = 'Golemio · PID'
  readonly isDemo = false
  private tripCache = new Map<string, Promise<any>>()
  private stopZones = new Map<string, string[]>()

  private async get(path: string, params: Record<string, string | number | string[]>) {
    const url = new URL(BASE + path, location.origin)
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
      else url.searchParams.set(k, String(v))
    }
    let res = await fetch(url, { headers: { Accept: 'application/json' } })
    // Golemio omezuje počet dotazů – chvíli počkej a zkus to znovu
    for (let attempt = 1; res.status === 429 && attempt <= 2; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * attempt))
      res = await fetch(url, { headers: { Accept: 'application/json' } })
    }
    if (res.status === 401 || res.status === 403) throw new Error('Server má neplatný Golemio API klíč.')
    if (res.status === 429) throw new Error('Příliš mnoho dotazů na Golemio API, zkus to za chvíli.')
    if (!res.ok) throw new Error(`Golemio API odpovědělo chybou ${res.status}.`)
    return res.json()
  }

  /** Golemio /v2/gtfs/stops?latlng= aktuálně vrací 500 – nástupiště hledáme v lokálních datech PID. */
  async nearbyStops(center: LatLon, radius: number): Promise<Stop[]> {
    const stops = await nearbyPlatforms(center, radius)
    stops.forEach((st) => this.stopZones.set(st.id, st.zones))
    return stops
  }

  async departures(stops: Stop[], minutesAfter: number): Promise<Departure[]> {
    if (!stops.length) return []
    const byId = new Map(stops.map((s) => [s.id, s]))
    const chunks: Stop[][] = []
    for (let i = 0; i < stops.length; i += 40) chunks.push(stops.slice(i, i + 40))

    const results = await Promise.all(
      chunks.map((chunk) =>
        this.get('/v2/pid/departureboards', {
          'ids[]': chunk.map((s) => s.id),
          minutesBefore: 0,
          minutesAfter,
          limit: 200,
          mode: 'departures',
          order: 'real',
          skip: 'canceled',
        }),
      ),
    )

    const out: Departure[] = []
    for (const data of results) {
      for (const d of data?.departures ?? []) {
        const stop = byId.get(d.stop?.id)
        if (!stop) continue
        const scheduled = Date.parse(d.departure_timestamp?.scheduled)
        const predicted = Date.parse(d.departure_timestamp?.predicted ?? d.departure_timestamp?.scheduled)
        if (Number.isNaN(predicted)) continue
        out.push({
          id: `${d.trip?.id}@${stop.id}`,
          tripId: d.trip?.id,
          line: d.route?.short_name ?? '?',
          vehicle: vehicleFromRouteType(d.route?.type),
          headsign: d.trip?.headsign ?? d.last_stop?.name ?? '',
          stop,
          scheduled,
          predicted,
          delayMin: d.delay?.is_available ? Math.round((d.delay.seconds ?? d.delay.minutes * 60) / 60) : null,
          isNight: !!d.route?.is_night,
          wheelchair: !!d.trip?.is_wheelchair_accessible,
          airConditioned: !!d.trip?.is_air_conditioned,
          canceled: !!d.trip?.is_canceled,
        })
      }
    }
    // stejný spoj se může objevit vícekrát (víc nástupišť jedné stanice)
    const seen = new Set<string>()
    return out
      .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)))
      .sort((a, b) => a.predicted - b.predicted)
  }

  private trip(tripId: string) {
    let p = this.tripCache.get(tripId)
    if (!p) {
      p = this.get(`/v2/gtfs/trips/${encodeURIComponent(tripId)}`, {
        includeStopTimes: 'true',
        includeStops: 'true',
      }).catch((e) => {
        this.tripCache.delete(tripId)
        throw e
      })
      this.tripCache.set(tripId, p)
    }
    return p
  }

  async tripTarget(dep: Departure, targets: Map<string, string>): Promise<TripTarget | null> {
    if (!dep.tripId) return null
    const trip = await this.trip(dep.tripId)
    const times: any[] = trip?.stop_times ?? []
    const nameOf = (st: any): string =>
      st.stop?.properties?.stop_name ?? st.stop?.stop_name ?? st.stop_name ?? ''
    const zonesOf = (st: any): string[] => {
      const z = parseZones(st.stop?.properties?.zone_id ?? st.stop?.zone_id)
      return z.length ? z : (this.stopZones.get(st.stop_id) ?? [])
    }

    const from = times.findIndex((st) => st.stop_id === dep.stop.id || nameOf(st) === dep.stop.name)
    if (from < 0) return null
    const to = times.findIndex((st, i) => i > from && targets.has(normalize(nameOf(st))))
    if (to < 0) return null

    const offsetSec = gtfsTimeToSec(times[to].arrival_time) - gtfsTimeToSec(times[from].departure_time)
    const zones = new Set<string>()
    for (let i = from; i <= to; i++) zonesOf(times[i]).forEach((z) => zones.add(z))
    return { stopName: nameOf(times[to]), arrival: dep.predicted + offsetSec * 1000, zones: [...zones] }
  }
}

export { normalize }

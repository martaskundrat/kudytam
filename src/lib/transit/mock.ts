/**
 * Demo poskytovatel – generuje realistická (ale smyšlená) data kolem libovolné polohy.
 * Používá se, dokud uživatel nezadá Golemio API klíč, nebo mimo oblast PID.
 * Data jsou deterministická: stejné místo a čas => stejné odjezdy.
 */
import type { Departure, LatLon, Stop, TripTarget, VehicleType } from '../../types'
import { distanceM } from '../geo'
import type { TransitProvider } from './types'

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NAMES = [
  'U Školy', 'Sídliště Jih', 'Náměstí Republiky', 'Poliklinika', 'Tržnice', 'Divadlo', 'Na Výsluní',
  'Hlavní nádraží', 'Park Stromovka', 'Radnice', 'Kulturní dům', 'Pod Kopcem', 'Nová Ves', 'Lékárna',
]
const HEADSIGNS = ['Sídliště Sever', 'Nádraží', 'Letiště', 'Zličín', 'Černý Most', 'Depo Hostivař', 'Kobylisy', 'Smíchov']

interface StopPlan {
  dist: [number, number]
  vehicle: VehicleType
  lines: { line: string; headway: number }[]
}

// blízké zastávky mají řídký autobusový provoz, vzdálenější tramvaj/metro – ideální pro ukázku doporučení
const PLAN: StopPlan[] = [
  { dist: [110, 220], vehicle: 'bus', lines: [{ line: '136', headway: 20 }] },
  { dist: [230, 380], vehicle: 'bus', lines: [{ line: '207', headway: 30 }, { line: '913', headway: 60 }] },
  { dist: [550, 750], vehicle: 'tram', lines: [{ line: '9', headway: 8 }, { line: '22', headway: 10 }] },
  { dist: [800, 1000], vehicle: 'tram', lines: [{ line: '17', headway: 7 }] },
  { dist: [950, 1150], vehicle: 'metro', lines: [{ line: 'B', headway: 4 }] },
]

export class MockProvider implements TransitProvider {
  readonly name = 'Demo data'
  readonly isDemo = true
  private plans = new Map<string, StopPlan>()

  async nearbyStops(center: LatLon, radius: number): Promise<Stop[]> {
    // zaokrouhlení ~100 m, aby se zastávky při drobném pohybu „nehýbaly“
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}`
    const r = rng(hash(key))
    const anchor = { lat: Number(center.lat.toFixed(3)), lon: Number(center.lon.toFixed(3)) }
    const names = [...NAMES].sort(() => r() - 0.5)
    const stops: Stop[] = []
    PLAN.forEach((plan, i) => {
      const d = plan.dist[0] + r() * (plan.dist[1] - plan.dist[0])
      const angle = r() * Math.PI * 2
      const lat = anchor.lat + (d * Math.cos(angle)) / 111320
      const lon = anchor.lon + (d * Math.sin(angle)) / (111320 * Math.cos((anchor.lat * Math.PI) / 180))
      // dvě nástupiště (oba směry)
      for (const platform of ['A', 'B']) {
        const id = `demo-${key}-${i}-${platform}`
        this.plans.set(id, plan)
        stops.push({ id, name: names[i], platform, zones: ['P'], lat, lon, distance: distanceM(center, { lat, lon }) })
      }
    })
    return stops.filter((s) => s.distance <= radius).sort((a, b) => a.distance - b.distance)
  }

  async departures(stops: Stop[], minutesAfter: number): Promise<Departure[]> {
    const now = Date.now()
    const nowMin = Math.floor(now / 60000)
    const out: Departure[] = []
    for (const stop of stops) {
      const plan = this.plans.get(stop.id)
      if (!plan) continue
      for (const { line, headway } of plan.lines) {
        const seed = hash(stop.id + line)
        const phase = seed % headway
        const headsign = HEADSIGNS[(seed >> 3) % HEADSIGNS.length]
        let t = phase + Math.ceil((nowMin - 1 - phase) / headway) * headway
        for (; t <= nowMin + minutesAfter; t += headway) {
          const tripSeed = hash(`${line}-${t}-${stop.platform}`)
          const delay = tripSeed % 5 === 0 ? (tripSeed % 4) + 1 : 0
          const scheduled = t * 60000
          if (scheduled + delay * 60000 < now) continue
          out.push({
            id: `${line}-${t}@${stop.id}`,
            tripId: `${line}-${t}-${stop.platform}`,
            line,
            vehicle: plan.vehicle,
            headsign,
            stop,
            scheduled,
            predicted: scheduled + delay * 60000,
            delayMin: plan.vehicle === 'metro' ? null : delay,
            isNight: false,
            wheelchair: tripSeed % 3 !== 0,
            airConditioned: tripSeed % 2 === 0,
            canceled: false,
          })
        }
      }
    }
    return out.sort((a, b) => a.predicted - b.predicted)
  }

  async tripTarget(dep: Departure, targets: Map<string, string>): Promise<TripTarget | null> {
    const target = [...targets.values()][0]
    if (!target) return null
    const h = hash(dep.line + dep.stop.platform + target)
    const chance = dep.vehicle === 'bus' ? 0.4 : 0.75
    if ((h % 100) / 100 > chance) return null
    const ride = dep.vehicle === 'metro' ? 6 + (h % 10) : 10 + (h % 22)
    return { stopName: target, arrival: dep.predicted + ride * 60000, zones: ['P'] }
  }
}

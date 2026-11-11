import type { LatLon } from '../types'

/** Vzdálenost dvou bodů v metrech (haversine) */
export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Skutečná cesta po ulicích je delší než vzdušná čára.
 * Pro městskou zástavbu se běžně používá koeficient ~1.3.
 */
export const DETOUR_FACTOR = 1.3

/** Odhad času přesunu v minutách pro danou rychlost (km/h) */
export function travelMinutes(airMeters: number, kmh: number): number {
  const meters = airMeters * DETOUR_FACTOR
  return meters / ((kmh * 1000) / 60)
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
}

export function getPosition(): Promise<LatLon> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Prohlížeč nepodporuje zjištění polohy.'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      (e) =>
        reject(
          new Error(
            e.code === e.PERMISSION_DENIED
              ? 'Přístup k poloze byl zamítnut. Povol ho v prohlížeči, nebo nastav výchozí místo v menu.'
              : 'Polohu se nepodařilo zjistit.',
          ),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    )
  })
}

/**
 * Zjednodušený obrys hranic ČR [lon, lat] (přesnost zhruba ±5 km) – stačí na rozlišení
 * „v ČR / v zahraničí“ (IDOS, odhad ceny ČD, Liftago, navigace).
 */
const CZ_BORDER: [number, number][] = [
  [12.09, 50.25], [12.32, 50.18], [12.51, 50.39], [12.97, 50.46], [13.35, 50.62], [13.85, 50.73], [14.25, 50.88],
  [14.39, 51.04], [14.62, 50.92], [14.82, 50.87], [15.01, 51.02], [15.27, 50.98], [15.38, 50.78], [15.8, 50.74],
  [16.08, 50.65], [16.33, 50.66], [16.44, 50.56], [16.2, 50.43], [16.42, 50.31], [16.65, 50.1], [16.87, 50.2],
  [16.99, 50.31], [17.26, 50.33], [17.73, 50.2], [17.6, 50.15], [18.03, 50.05], [18.3, 49.92], [18.55, 49.92],
  [18.85, 49.52], [18.55, 49.48], [18.39, 49.33], [18.07, 49.04], [17.86, 48.92], [17.63, 48.85], [17.18, 48.87],
  [16.95, 48.62], [16.67, 48.78], [16.4, 48.74], [15.85, 48.85], [15.25, 48.99], [14.99, 49.01], [14.69, 48.59],
  [14.33, 48.56], [14.01, 48.78], [13.83, 48.77], [13.51, 48.97], [13.17, 49.13], [12.86, 49.34], [12.64, 49.43],
  [12.4, 49.76], [12.48, 49.97], [12.2, 50.11],
]

/** Leží bod v ČR? (bod v mnohoúhelníku, ray casting) */
export function inCzechia(p: LatLon): boolean {
  if (p.lat < 48.5 || p.lat > 51.1 || p.lon < 12 || p.lon > 18.9) return false
  let inside = false
  for (let i = 0, j = CZ_BORDER.length - 1; i < CZ_BORDER.length; j = i++) {
    const [xi, yi] = CZ_BORDER[i]
    const [xj, yj] = CZ_BORDER[j]
    if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

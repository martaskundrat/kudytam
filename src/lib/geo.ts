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

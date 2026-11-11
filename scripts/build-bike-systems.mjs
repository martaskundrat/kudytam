/**
 * Seznam systémů sdílených kol nextbike v ČR s oblastí, kde mají stanice.
 * Zdroj: https://maps2.nextbike.net/maps/nextbike-live.json?countries=CZ (~3 MB) + GBFS jednotlivých systémů.
 * Výstup: src/lib/bike-systems.ts (aplikace podle oblasti načte jen GBFS systému v okolí).
 *
 * Spuštění: npm run bikes   (stačí občas, když nextbike přidá nové město)
 */
import { writeFile } from 'node:fs/promises'

const live = await (await fetch('https://maps2.nextbike.net/maps/nextbike-live.json?countries=CZ')).json()
const out = []
for (const c of live.countries) {
  const pts = c.cities.flatMap((ci) => ci.places ?? []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
  if (!pts.length) continue // systém bez stanic
  const id = `nextbike_${c.domain}`
  const gbfs = await fetch(`https://gbfs.nextbike.net/maps/gbfs/v2/${id}/gbfs.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
  const langs = Object.keys(gbfs?.data ?? {})
  if (!langs.length) {
    console.warn(`bez GBFS: ${id} (${c.name})`)
    continue
  }
  const lang = langs.includes('cs') ? 'cs' : langs[0]
  const r4 = (n) => Math.round(n * 1e4) / 1e4
  out.push({
    id,
    name: c.name.replace(/^nextbike\s*/i, ''),
    gbfs: `https://gbfs.nextbike.net/maps/gbfs/v2/${id}/${lang}`,
    bbox: [r4(Math.min(...pts.map((p) => p.lat))), r4(Math.min(...pts.map((p) => p.lng))), r4(Math.max(...pts.map((p) => p.lat))), r4(Math.max(...pts.map((p) => p.lng)))],
  })
}
out.sort((a, b) => a.id.localeCompare(b.id))

const ts = `/* Vygenerováno: npm run bikes (scripts/build-bike-systems.mjs) – ${new Date().toISOString().slice(0, 10)}. Needitovat ručně. */
export interface BikeSystemArea {
  id: string
  name: string
  gbfs: string
  /** [minLat, minLon, maxLat, maxLon] stanic systému */
  bbox: [number, number, number, number]
}

export const NEXTBIKE_CZ: BikeSystemArea[] = ${JSON.stringify(out, null, 2)}
`
await writeFile(new URL('../src/lib/bike-systems.ts', import.meta.url), ts)
console.log(`${out.length} systémů nextbike → src/lib/bike-systems.ts`)

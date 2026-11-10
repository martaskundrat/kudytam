/**
 * Stáhne seznam zastávek PID (https://data.pid.cz/stops/json/stops.json, ~19 MB)
 * a uloží kompaktní verzi pro vyhledávání stanic do public/stops.json.
 *
 * Spuštění: npm run stops   (stačí občas, data se mění s jízdními řády)
 *
 * Formát řádku: [uniqueName, name, municipality, lat, lon, "P,0", "metro,tram", nástupiště, "B,9,12"]
 * poslední položka = linky, které stanicí projíždějí (předfiltr, ať se zbytečně neptáme Golemia na trasy)
 * nástupiště: [[gtfsId, lat, lon, označení, pásma], ...] – pro hledání zastávek v okolí
 * (geo hledání v Golemio /v2/gtfs/stops vrací 500, proto lokálně)
 */
import { writeFile } from 'node:fs/promises'

const SRC = 'https://data.pid.cz/stops/json/stops.json'
const res = await fetch(SRC)
if (!res.ok) throw new Error(`Stažení selhalo: ${res.status}`)
const data = await res.json()

const rows = []
for (const g of data.stopGroups ?? []) {
  if (typeof g.avgLat !== 'number' || typeof g.avgLon !== 'number') continue
  const zones = new Set()
  const types = new Set()
  const platforms = []
  const lines = new Set()
  for (const s of g.stops ?? []) {
    String(s.zone ?? '')
      .split(/[,;]/)
      .map((z) => z.trim())
      .filter((z) => z && z !== '-')
      .forEach((z) => zones.add(z))
    for (const l of s.lines ?? []) {
      if (l.type) types.add(l.type)
      if (l.name) lines.add(String(l.name))
    }
    if (!s.lines?.length) continue
    for (const id of s.gtfsIds ?? [])
      platforms.push([
        id,
        Math.round(s.lat * 1e5) / 1e5,
        Math.round(s.lon * 1e5) / 1e5,
        s.platform ?? '',
        String(s.zone ?? '').replace(/[;\s]/g, ',').replace(/^-$/, ''),
      ])
  }
  if (!types.size) continue // zastávka bez linek
  rows.push([
    g.uniqueName ?? g.name,
    g.name,
    g.municipality ?? '',
    Math.round(g.avgLat * 1e5) / 1e5,
    Math.round(g.avgLon * 1e5) / 1e5,
    [...zones].join(','),
    [...types].join(','),
    platforms,
    [...lines].join(','),
  ])
}

await writeFile(new URL('../public/stops.json', import.meta.url), JSON.stringify({ generatedAt: data.generatedAt, stops: rows }))
console.log(`Uloženo ${rows.length} stanic (data z ${data.generatedAt}).`)

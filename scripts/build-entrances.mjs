/**
 * Vstupy / výstupy pražského metra z OpenStreetMap (railway=subway_entrance) přes Overpass API.
 * Výstup: src/lib/metro-entrances.ts – [lat, lon, označení („E2“), bezbariérový 0/1].
 * Označení: tag name („E2“), jinak ref, jinak konec ref:PID („U400S1E1“ → „E1“).
 *
 * Spuštění: npm run entrances   (stačí občas)
 * Data © OpenStreetMap contributors (ODbL).
 */
import { writeFile } from 'node:fs/promises'

const QUERY = '[out:json][timeout:90];node["railway"="subway_entrance"](49.94,14.22,50.18,14.71);out body;'
// veřejné Overpass servery bývají přetížené – zkus víc serverů a víc pokusů
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
let elements
for (let attempt = 0; attempt < 6 && !elements; attempt++) {
  const url = SERVERS[attempt % SERVERS.length]
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Kudytam/1.0 (+https://github.com/martaskundrat/kudytam)' },
    body: new URLSearchParams({ data: QUERY }),
  }).catch(() => null)
  if (res?.ok) elements = (await res.json()).elements
  else {
    console.warn(`${url}: ${res?.status ?? 'chyba sítě'}, zkouším znovu…`)
    await new Promise((r) => setTimeout(r, 3000))
  }
}
if (!elements) throw new Error('Overpass nedostupný')

const CODE = /^E\d{1,2}$/
const rows = []
for (const e of elements) {
  const t = e.tags ?? {}
  const code = [t.name, t.ref].find((v) => v && CODE.test(v)) ?? (t['ref:PID'] ?? '').match(/E(\d{1,2})$/)?.[0]
  if (!code) continue
  rows.push([Math.round(e.lat * 1e6) / 1e6, Math.round(e.lon * 1e6) / 1e6, code, t.wheelchair === 'yes' ? 1 : 0])
}
rows.sort((a, b) => a[0] - b[0] || a[1] - b[1])

const ts = `/* Vygenerováno: npm run entrances (scripts/build-entrances.mjs) – ${new Date().toISOString().slice(0, 10)}. Needitovat ručně.
 * Vstupy pražského metra, © OpenStreetMap contributors (ODbL). [lat, lon, označení, bezbariérový] */
export const METRO_ENTRANCES: [number, number, string, 0 | 1][] = ${JSON.stringify(rows)}
`
await writeFile(new URL('../src/lib/metro-entrances.ts', import.meta.url), ts)
console.log(`${rows.length} vstupů metra → src/lib/metro-entrances.ts`)

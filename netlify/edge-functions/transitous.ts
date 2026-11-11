/**
 * Proxy pro vyhledávač spojení Transitous (MOTIS 2) – https://transitous.org/api/
 * Podmínky Transitous vyžadují User-Agent s názvem aplikace a kontaktem,
 * který prohlížeč sám nastavit neumí, proto jde dotaz přes server.
 *
 *   GET /api/transitous/plan?... -> https://api.transitous.org/api/v1/plan?...   (vyhledání spojení)
 *   GET /api/transitous/trip?... -> https://api.transitous.org/api/v1/trip?...   (všechny zastávky spoje)
 */
const USER_AGENT = 'Kudytam/1.0 (+https://kudytam-app.netlify.app; https://github.com/martaskundrat/kudytam)'

export default async (req: Request) => {
  const url = new URL(req.url)
  const endpoint = url.pathname.replace(/^\/api\/transitous\//, '')
  if (req.method !== 'GET' || !['plan', 'trip'].includes(endpoint)) return new Response('Not found', { status: 404 })

  const upstream = await fetch(`https://api.transitous.org/api/v1/${endpoint}${url.search}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  })
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'public, max-age=20',
    },
  })
}

export const config = { path: '/api/transitous/*' }

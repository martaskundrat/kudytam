/**
 * Cloudflare Pages Function: /api/golemio/* → Golemio API s klíčem z tajné proměnné GOLEMIO_API_KEY.
 * Logika je ve sdíleném server/golemio.ts.
 */
import { golemio } from '../../../server/golemio'

export const onRequest = ({ request, env }: { request: Request; env: { GOLEMIO_API_KEY?: string } }) => golemio(request, env.GOLEMIO_API_KEY)

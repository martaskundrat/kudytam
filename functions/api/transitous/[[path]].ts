/**
 * Cloudflare Pages Function: /api/transitous/* → Transitous (User-Agent s kontaktem).
 * Logika je ve sdíleném server/transitous.ts.
 */
import { transitous } from '../../../server/transitous'

export const onRequest = ({ request }: { request: Request }) => transitous(request)

/**
 * Časy v časovém pásmu místa (Transitous posílá u zastávek a míst IANA pásmo, např. „Asia/Tokyo“).
 * Odjezd se ukazuje v pásmu místa odjezdu, příjezd v pásmu cíle. Bez pásma = pásmo telefonu.
 */

export const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone

const opt = (tz?: string): Intl.DateTimeFormatOptions => (tz ? { timeZone: tz } : {})

const hm = (ms: number, tz?: string) => new Date(ms).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', ...opt(tz) })

/**
 * Čas v pásmu místa; když se liší od pásma telefonu, v závorce i čas podle telefonu:
 * „16:39 (08:39)“. Bez pásma nebo ve stejném pásmu jen „07:30“.
 */
export const fmtTime = (ms: number, tz?: string) => (isForeignTz(tz, ms) ? `${hm(ms, tz)} (${hm(ms)})` : hm(ms))

/** kalendářní den v pásmu (pro porovnání „dnes“) */
const dayKey = (ms: number, tz?: string) => new Date(ms).toLocaleDateString('sv-SE', opt(tz))

/** čas, u jiného dne (v pásmu místa) i s datem: „st 12. 11. 07:30“ */
export function fmtWhen(ms: number, tz?: string): string {
  const day = (z?: string) =>
    dayKey(ms, z) === dayKey(Date.now(), z) ? '' : `${new Date(ms).toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', ...opt(z) })} `
  if (!isForeignTz(tz, ms)) return `${day()}${hm(ms)}`
  return `${day(tz)}${hm(ms, tz)} (${day()}${hm(ms)})`
}

/** posun pásma proti UTC v minutách v daném okamžiku */
export function tzOffsetMin(ms: number, tz?: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...opt(tz) })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  )
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000)
}

/** liší se pásmo místa od pásma telefonu? */
export const isForeignTz = (tz: string | undefined, ms = Date.now()) => !!tz && tzOffsetMin(ms, tz) !== tzOffsetMin(ms)

/** „Tokio, GMT+9“ – popisek místního času */
export function tzLabel(tz: string, ms = Date.now()): string {
  const city = tz.split('/').pop()!.replace(/_/g, ' ')
  const off = new Intl.DateTimeFormat('cs-CZ', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date(ms)).find((x) => x.type === 'timeZoneName')?.value
  return off ? `${city}, ${off}` : city
}

/** „YYYY-MM-DDTHH:mm“ (pro <input type="datetime-local">) v pásmu místa */
export function toWallInput(ms: number, tz?: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...opt(tz) })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** „YYYY-MM-DDTHH:mm“ zadané v pásmu místa → okamžik (ms). Dvakrát kvůli přechodu letního času. */
export function fromWallInput(value: string, tz?: string): number {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!m) return NaN
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  let t = wall - tzOffsetMin(wall, tz) * 60000
  t = wall - tzOffsetMin(t, tz) * 60000
  return t
}

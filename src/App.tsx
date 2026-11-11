import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { RecommendationCard, StopCard } from './components/Departures'
import { JourneyCard, JourneySheet, recommend, WalkCard } from './components/Journeys'
import { Menu } from './components/Menu'
import { BikeCard, bikeTimes, TaxiCard, useBikeOptions } from './components/Mobility'
import { RideSheet } from './components/RideSheet'
import { StationPicker } from './components/StationPicker'
import { whenLabel, WhenPicker } from './components/WhenPicker'
import { Button, IconBike, IconBus, IconCar, IconFlag, IconHome, IconMenu, IconPin, IconRefresh, IconSwap, useNow } from './components/ui'
import { distanceM, getPosition, travelMinutes } from './lib/geo'
import { leaveAt, MAX_WALK_MIN, mergeJourneys, morePage, planJourneys, transitLegs, type Journey, type JourneyPage, type When } from './lib/journeys'
import { bestOf, type RankItem } from './lib/rank'
import { plan, type PlanResult } from './lib/planner'
import { settingsStore, speedKmh, useStore } from './lib/store'
import { getProvider, type TransitProvider } from './lib/transit'
import type { LatLon, Option, Place } from './types'

/** Odjezdy (Golemio) obnovujeme často, vyhledávání spojení (Transitous) šetrněji – sdílená služba */
const REFRESH_DEPARTURES_MS = 30000
const REFRESH_JOURNEYS_MS = 90000
const PRAGUE_CENTER: Place = { lat: 50.0815, lon: 14.428, name: 'Václavské náměstí', stopName: 'Václavské náměstí', zones: ['P'] }

/** stejné místo = stejný název i poloha (GPS body můžou sdílet název nejbližší adresy) */
const samePlace = (a: Place | null, b: Place | null) =>
  a === b || (!!a && !!b && a.name === b.name && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5)

export default function App() {
  const settings = useStore(settingsStore)
  const now = useNow(10000)
  const [menuOpen, setMenuOpen] = useState(false)
  const [provider, setProvider] = useState<TransitProvider | null>(null)
  const [position, setPosition] = useState<LatLon | null>(null)
  const [result, setResult] = useState<PlanResult | null>(null)
  const [page, setPage] = useState<JourneyPage | null>(null)
  const journeys = page?.journeys ?? null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Option | null>(null)
  // vybrané spojení podle stabilního ID; poslední verze jako záloha, kdyby po obnovení z dat zmizelo
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const lastSelected = useRef<Journey | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const originRef = useRef<(LatLon & { name?: string }) | null>(null)
  const [routeOrigin, setRouteOrigin] = useState<LatLon | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const reqId = useRef(0)

  // rozpracovaná trasa – vyhledá se až po stisknutí „Vyhledat spoje“
  const [draftOrigin, setDraftOrigin] = useState<Place | null>(settings.origin)
  const [draftDest, setDraftDest] = useState<Place | null>(settings.destination)
  // kdy jet – null = teď; vyhledá se až po stisknutí „Vyhledat spoje“
  const [draftWhen, setDraftWhen] = useState<When | null>(null)
  const [when, setWhen] = useState<When | null>(null)
  const sameWhen = (a: When | null, b: When | null) => a === b || (!!a && !!b && a.at === b.at && a.arriveBy === b.arriveBy)
  const dirty = !samePlace(draftOrigin, settings.origin) || !samePlace(draftDest, settings.destination) || !sameWhen(draftWhen, when)

  const kmh = speedKmh(settings)
  const dest = settings.destination

  useEffect(() => {
    getProvider().then(setProvider)
  }, [])

  const load = useCallback(async () => {
    if (!dest && !provider) return
    const id = ++reqId.current
    setLoading(true)
    setError(null)
    try {
      let origin: LatLon & { name?: string }
      if (settings.origin) origin = settings.origin
      else {
        origin = { ...(await getPosition()), name: 'Moje poloha' }
        setPosition(origin)
      }
      if (dest) {
        originRef.current = origin
        setRouteOrigin(origin)
        const fresh = await planJourneys(origin, dest, settings, kmh, when)
        if (id === reqId.current) setPage((old) => refreshPage(old, fresh))
      } else {
        const r = await plan(provider!, origin, null, settings, kmh)
        if (id === reqId.current) setResult(r)
      }
      if (id === reqId.current) setUpdatedAt(Date.now())
    } catch (e) {
      if (id === reqId.current) setError((e as Error).message)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, kmh, settings.origin, dest, settings.nearRadius, settings.wideRadius, settings.thresholdMin, settings.extendedSearch, when])

  useEffect(() => {
    load()
    const id = setInterval(() => document.visibilityState === 'visible' && load(), dest ? REFRESH_JOURNEYS_MS : REFRESH_DEPARTURES_MS)
    const onVis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [load, dest])

  const search = () => {
    setResult(null)
    setPage(null)
    // zvolený čas, který mezitím uplynul, už neplatí – hledej od teď
    const w = draftWhen && draftWhen.at < Date.now() - 60000 ? null : draftWhen
    if (!sameWhen(w, draftWhen)) setDraftWhen(w)
    const placesChanged = !samePlace(draftOrigin, settings.origin) || !samePlace(draftDest, settings.destination)
    if (!sameWhen(w, when)) setWhen(w)
    if (placesChanged) settingsStore.set({ origin: draftOrigin, destination: draftDest })
    else if (sameWhen(w, when)) load()
  }

  /** Nejlepší spojení domů z aktuální polohy. Bez nastaveného domova otevře menu. */
  const goHome = () => {
    const home = settings.home
    if (!home) return setMenuOpen(true)
    setDraftOrigin(null)
    setDraftDest(home)
    setDraftWhen(null)
    setWhen(null)
    // změna času sama spustí nové hledání (load závisí na `when`)
    if (!settings.origin && samePlace(settings.destination, home)) return when ? undefined : load()
    setPage(null)
    setResult(null)
    settingsStore.set({ origin: null, destination: home })
  }

  const clearDestination = () => {
    setDraftDest(null)
    setPage(null)
    settingsStore.set({ destination: null, origin: draftOrigin })
  }

  const soonest = result?.groups.flatMap((g) => g.options).find((o) => o.departure.predicted > now)
  const selectedJourney = selectedId ? (journeys?.find((j) => j.id === selectedId) ?? lastSelected.current) : null
  if (selectedJourney) lastSelected.current = selectedJourney
  const selIdx = selectedJourney && journeys ? journeys.findIndex((j) => j.id === selectedJourney.id) : -1

  /** Dřívější / pozdější spojení v detailu; na okraji načteného seznamu dotáhne další stránku. */
  const navigate = async (dir: 'prev' | 'next') => {
    if (!page || !selectedJourney || !dest || !originRef.current) return
    let list = page.journeys
    let i = list.findIndex((j) => j.id === selectedJourney.id)
    let target = list[dir === 'prev' ? i - 1 : i + 1]
    if (!target && page[dir]) {
      setLoadingMore(true)
      try {
        const more = await morePage(page, dir, originRef.current, dest)
        setPage(more)
        list = more.journeys
        i = list.findIndex((j) => j.id === selectedJourney.id)
        target = list[dir === 'prev' ? i - 1 : i + 1]
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoadingMore(false)
      }
    }
    if (target) setSelectedId(target.id)
  }

  // Cesta pěšky se nabídne, když je cíl v „širším okolí“, nebo když chůze (do 45 min)
  // není o víc než WALK_SLACK_MIN pomalejší než nejrychlejší MHD – typicky cesta domů kousek od centra.
  const WALK_SLACK_MIN = 10
  const airToDest = dest && routeOrigin ? distanceM(routeOrigin, dest) : null
  const walkCandidate =
    airToDest === null
      ? null
      : (page?.walk ?? { durationMin: Math.max(1, Math.round(travelMinutes(airToDest, kmh))), meters: Math.round(airToDest * 1.3), estimated: true })
  const fastestTransitEnd = journeys?.filter((j) => j.start >= now - 30000).reduce((m, j) => Math.min(m, j.end), Infinity) ?? Infinity
  const walkCompetitive =
    !!walkCandidate &&
    walkCandidate.durationMin <= MAX_WALK_MIN &&
    now + walkCandidate.durationMin * 60000 <= fastestTransitEnd + WALK_SLACK_MIN * 60000
  const walkOption = dest && routeOrigin && walkCandidate && ((airToDest ?? Infinity) <= settings.wideRadius || walkCompetitive) ? walkCandidate : null

  const arriveBy = !!when?.arriveBy
  const bikeOpts = useBikeOptions(settings.extendedSearch !== false && dest && routeOrigin ? routeOrigin : null, dest, Math.min(kmh, 6.5), settings, now)

  // Nejlepší varianta ze všech je vždy první: v cíli nejdřív, při shodě nejzažší odjezd
  // (při hledání podle příjezdu nejzažší odjezd, se kterým to stihneš) – viz lib/rank.ts. Taxi se nepočítá.
  const walkStart = walkOption ? leaveAt(when, now, walkOption.durationMin) : 0
  const rankItems: RankItem[] = [
    ...(journeys ?? [])
      .filter((j) => j.start >= now - 30000 && !transitLegs(j).some((l) => l.cancelled))
      .map((j) => ({ key: `j:${j.id}`, start: j.start, end: j.end, transfers: j.transfers })),
    ...(walkOption ? [{ key: 'walk', start: walkStart, end: walkStart + walkOption.durationMin * 60000, transfers: 0 }] : []),
    ...bikeOpts.map((o) => {
      const t = bikeTimes(o, now, when)
      return { key: `bike:${o.systemId}`, start: t.leave, end: t.arrival, transfers: 0 }
    }),
  ]
  const bestKey = bestOf(rankItems, arriveBy, arriveBy ? when!.at : undefined)?.key ?? null
  const bestJourney = bestKey?.startsWith('j:') ? (journeys?.find((j) => `j:${j.id}` === bestKey) ?? null) : null
  const bestBike = bestKey?.startsWith('bike:') ? (bikeOpts.find((o) => `bike:${o.systemId}` === bestKey) ?? null) : null
  // doporučení u karty spojení jen tehdy, když je nejlepší variantou spojení (s údajem o vzdálenější zastávce)
  const rec = journeys ? recommend(journeys, settings.nearRadius, now, arriveBy) : null
  const pick = bestJourney ? (rec?.journey.id === bestJourney.id ? rec : { journey: bestJourney, farStop: false, savedMin: null, latest: arriveBy }) : null

  /** Dřívější / pozdější spojení v seznamu (další stránka výsledků Transitous). */
  const loadMore = async (dir: 'prev' | 'next') => {
    if (!page || !dest || !originRef.current || loadingMore) return
    setLoadingMore(true)
    try {
      setPage(await morePage(page, dir, originRef.current, dest))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }
  const extended = settings.extendedSearch !== false
  const showDepartures = !dest && result
  const showJourneys = dest && journeys
  const hasResults = showDepartures || showJourneys

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      {/* --- hlavička + trasa --- */}
      <header className="pt-safe sticky top-0 z-30 bg-bg/90 px-4 pb-3 backdrop-blur-lg">
        <div className="mb-3 flex items-center gap-3">
          <button onClick={() => setMenuOpen(true)} className="rounded-full bg-highlight p-2.5 hover:bg-zinc-700" aria-label="Menu">
            <IconMenu />
          </button>
          <div className="flex flex-1 items-center gap-2">
            <img src="/icon.svg" alt="" className="size-7" />
            <span className="text-xl font-extrabold">Kudytam</span>
          </div>
          {provider?.isDemo && (
            <button onClick={() => setMenuOpen(true)} className="rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-bold text-amber-300 uppercase">
              Demo data
            </button>
          )}
          <button onClick={load} className="rounded-full p-2 text-muted hover:bg-highlight hover:text-white" aria-label="Obnovit">
            <IconRefresh className={`size-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="relative rounded-2xl bg-highlight">
          <StationPicker
            label="Odkud"
            icon={<IconPin />}
            value={draftOrigin}
            emptyLabel="Moje poloha"
            placeholder="Odkud – zastávka, adresa, GPS"
            allowCurrent
            addresses
            near={position}
            onChange={setDraftOrigin}
          />
          <div className="mx-4 border-t border-white/5" />
          <StationPicker
            label="Kam"
            icon={<IconFlag />}
            value={draftDest}
            emptyLabel="Cíl – zastávka v ČR, adresa nebo GPS (nepovinné)"
            placeholder="Kam – stanice, adresa, GPS"
            addresses
            near={draftOrigin ?? position}
            onChange={setDraftDest}
          />
          <button
            onClick={() => {
              setDraftOrigin(draftDest)
              setDraftDest(draftOrigin)
            }}
            disabled={!draftOrigin && !draftDest}
            className="absolute top-1/2 right-12 -translate-y-1/2 rounded-full bg-zinc-700 p-2 text-muted hover:text-white disabled:opacity-0"
            aria-label="Prohodit odkud a kam"
          >
            <IconSwap className="size-4" />
          </button>
        </div>

        {draftDest && (
          <WhenPicker value={draftWhen} onChange={setDraftWhen} tz={draftWhen?.arriveBy ? draftDest.tz : draftOrigin?.tz} />
        )}

        <div className="mt-3 flex gap-2">
  <Button onClick={search} disabled={loading && !dirty} className="flex-1 py-3">
          {loading && !dirty ? 'Hledám…' : draftDest ? 'Vyhledat spoje' : dirty ? 'Zobrazit odjezdy' : 'Aktualizovat odjezdy'}
        </Button>
          <Button
            variant="ghost"
            onClick={goHome}
            className="px-4 py-3"
            title={settings.home ? `Domů: ${settings.home.name}` : 'Nastav si domov v menu'}
            aria-label="Navigovat domů"
          >
            <IconHome className="size-5" /> Domů
          </Button>
        </div>
      </header>

      {/* --- výsledky --- */}
      <main className="flex-1 space-y-3 px-4 pb-10">
        {error && (
          <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200">
            <p>{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" className="px-4 py-2 text-sm" onClick={load}>
                Zkusit znovu
              </Button>
              {!settings.origin && (
                <Button
                  variant="ghost"
                  className="px-4 py-2 text-sm"
                  onClick={() => {
                    setDraftOrigin(PRAGUE_CENTER)
                    settingsStore.set({ origin: PRAGUE_CENTER, destination: draftDest })
                  }}
                >
                  Použít centrum Prahy
                </Button>
              )}
            </div>
          </div>
        )}


        {dirty && hasResults && <p className="rounded-xl bg-highlight px-4 py-2.5 text-sm text-muted">Trasa změněna – stiskni „Vyhledat spoje“.</p>}

        {!hasResults && loading && <Skeleton />}

        {/* --- spojení do cíle (s přestupy) --- */}
        {showJourneys && (
          <>
            <div className="flex items-center justify-between gap-2 pt-1">
              <h1 className="min-w-0 truncate text-xl font-extrabold">
                Spojení do: {dest.name}
                {when && <span className="block text-sm font-semibold text-brand">{whenLabel(when, when.arriveBy ? dest.tz : settings.origin?.tz)}</span>}
              </h1>
              <button onClick={clearDestination} className="shrink-0 text-sm font-semibold text-muted hover:text-white">
                Odjezdy v okolí
              </button>
            </div>

            {/* rozšířené vyhledávání: sdílená kola a taxi */}
            <div className="flex items-center justify-between gap-2 rounded-xl bg-highlight px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-1.5 text-muted">
                <IconBike className="size-4 shrink-0" />
                <IconCar className="size-4 shrink-0" />
                <span className="truncate">{extended ? 'Včetně sdílených kol a taxi' : 'Jen MHD a pěšky'}</span>
              </span>
              <button
                onClick={() => settingsStore.set({ extendedSearch: !extended })}
                className="shrink-0 rounded-full px-3 py-1 font-semibold text-brand ring-1 ring-brand/50 hover:bg-brand/10"
              >
                {extended ? 'Vypnout rozšířené vyhledávání' : 'Zapnout rozšířené vyhledávání'}
              </button>
            </div>

            {journeys.length === 0 && !walkOption && (
              <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                V příští hodině jsme nenašli žádné spojení. Zkus zvětšit „Širší okolí“ v menu nebo jiný čas.
              </p>
            )}

            {/* nejlepší varianta vždy první (taxi nikdy) */}
            {bestKey === 'walk' && walkOption && routeOrigin && (
              <WalkCard walk={walkOption} from={routeOrigin} to={dest} now={now} journeys={journeys} mode={settings.travelModeId} when={when} best />
            )}
            {bestBike && <BikeCard o={bestBike} to={dest} now={now} journeys={journeys} when={when} best />}
            {bestJourney && <JourneyCard j={bestJourney} now={now} pick={pick} onSelect={(j) => setSelectedId(j.id)} />}

            {bestKey !== 'walk' && walkOption && routeOrigin && (
              <WalkCard walk={walkOption} from={routeOrigin} to={dest} now={now} journeys={journeys} mode={settings.travelModeId} when={when} />
            )}

            {/* při hledání podle příjezdu nahoře nejpozdější odjezd (s ním to ještě stihneš), jinak podle odjezdu */}
            {(when?.arriveBy ? (['next', 'prev'] as const) : (['prev', 'next'] as const)).map((dir, i) => {
              const button = page?.[dir] && journeys.length > 0 && (
                <button
                  key={dir}
                  onClick={() => loadMore(dir)}
                  disabled={loadingMore}
                  className="w-full rounded-xl bg-highlight py-2.5 text-sm font-semibold text-muted hover:text-white disabled:opacity-50"
                >
                  {loadingMore ? 'Načítám…' : dir === 'prev' ? 'Dřívější spojení' : 'Pozdější spojení'}
                </button>
              )
              const list = journeys.filter((j) => j.start >= now - 30000 && j.id !== bestJourney?.id)
              if (when?.arriveBy) list.reverse()
              return i === 0 ? (
                <Fragment key="list">
                  {button}
                  {list.map((j) => (
                    <JourneyCard key={j.id} j={j} now={now} pick={pick} onSelect={(j) => setSelectedId(j.id)} />
                  ))}
                </Fragment>
              ) : (
                button
              )
            })}

            {when && !when.arriveBy && (
              <p className="text-center text-xs text-subtle">
                Potřebuješ být v cíli do určitého času (třeba na letišti)? Přepni nahoře na <b>Příjezd</b> – najdou se i noční spoje den předem.
              </p>
            )}

            {extended && routeOrigin && (
              <>
                {bikeOpts
                  .filter((o) => o !== bestBike)
                  .map((o) => (
                    <BikeCard key={o.systemId} o={o} to={dest} now={now} journeys={journeys} when={when} />
                  ))}
                {page?.car && <TaxiCard car={page.car} from={originRef.current ?? routeOrigin} to={dest} now={now} journeys={journeys} when={when} />}
              </>
            )}

            <p className="pt-2 text-center text-xs leading-relaxed text-subtle">
              Spojení:{' '}
              <a href="https://transitous.org/sources/" target="_blank" rel="noreferrer" className="underline">
                Transitous
              </a>{' '}
              (data PID, ČD aj.) · ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
                OpenStreetMap
              </a>
              {updatedAt && ` · aktualizováno ${new Date(updatedAt).toLocaleTimeString('cs-CZ')}`}
            </p>
          </>
        )}

        {/* --- odjezdy v okolí --- */}
        {showDepartures && (
          <>
            <h1 className="pt-1 text-xl font-extrabold">Odjezdy v okolí</h1>

            {result.recommendation && <RecommendationCard rec={result.recommendation} now={now} onSelect={setSelected} />}

            {result.wideSearched && !result.recommendation && (
              <p className="rounded-xl bg-highlight px-4 py-3 text-sm text-muted">
                Do {settings.thresholdMin} min nic nejede ani v okruhu {settings.wideRadius} m – nejlepší je počkat
                {soonest ? ` na linku ${soonest.departure.line}.` : '.'}
              </p>
            )}

            {result.groups.map((g) => (
              <StopCard key={g.name} g={g} now={now} onSelect={setSelected} />
            ))}

            {result.groups.length === 0 && (
              <div className="py-12 text-center text-muted">
                <IconBus className="mx-auto mb-3 size-12 text-subtle" />V okolí nejsou žádné zastávky PID.
                <p className="mt-2 text-sm text-subtle">
                  Odjezdy v okolí zatím umíme jen pro PID (Praha a Středočeský kraj). Zadej cíl – spojení hledáme v celé ČR.
                </p>
              </div>
            )}

            {result.wideGroups.length > 0 && (
              <>
                <h2 className="pt-4 text-sm font-bold tracking-wider text-muted uppercase">Širší okolí</h2>
                {result.wideGroups.slice(0, 4).map((g) => (
                  <StopCard key={g.name} g={g} now={now} onSelect={setSelected} />
                ))}
              </>
            )}

            <p className="pt-2 text-center text-xs text-subtle">
              {provider?.name} · aktualizováno {new Date(result.fetchedAt).toLocaleTimeString('cs-CZ')}
            </p>
          </>
        )}

        <p className="pt-4 pb-2 text-center text-[11px] text-subtle">
          Kudytam je open-source ·{' '}
          <a href="https://github.com/martaskundrat/kudytam" target="_blank" rel="noreferrer" className="underline">
            GitHub a kontakt
          </a>
        </p>
      </main>

      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} liveData={!!provider && !provider.isDemo} />
      <RideSheet option={selected} destination={null} origin={result?.origin} onClose={() => setSelected(null)} />
      <JourneySheet
        journey={selectedJourney}
        onClose={() => setSelectedId(null)}
        nav={{
          canPrev: selIdx > 0 || !!page?.prev,
          canNext: (journeys != null && selIdx >= 0 && selIdx < journeys.length - 1) || !!page?.next,
          loading: loadingMore,
          go: navigate,
          position: selectedJourney ? `odjezd ${new Date(selectedJourney.start).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}` : undefined,
        }}
      />
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-3">
      {[0, 1].map((i) => (
        <div key={i} className="animate-pulse space-y-3 rounded-2xl bg-surface p-4">
          <div className="h-5 w-40 rounded bg-highlight" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="flex items-center gap-3">
              <div className="h-9 w-11 rounded-lg bg-highlight" />
              <div className="h-4 flex-1 rounded bg-highlight" />
              <div className="h-5 w-12 rounded bg-highlight" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Obnovení dat: čerstvá spojení nahradí stará (aktuální zpoždění), ale dřívější/pozdější
 * spojení, která si uživatel už donačetl, zůstanou i s kurzory.
 */
function refreshPage(old: JourneyPage | null, fresh: JourneyPage): JourneyPage {
  if (!old || old.query !== fresh.query || !fresh.journeys.length) return fresh
  const first = fresh.journeys[0].start
  const last = fresh.journeys[fresh.journeys.length - 1].start
  const before = old.journeys.filter((j) => j.start < first)
  const after = old.journeys.filter((j) => j.start > last)
  return {
    query: fresh.query,
    walk: fresh.walk,
    car: fresh.car,
    journeys: mergeJourneys(before, after, fresh.journeys),
    prev: before.length ? old.prev : fresh.prev,
    next: after.length ? old.next : fresh.next,
  }
}

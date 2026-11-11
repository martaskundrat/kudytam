# Kudytam – chytrý jízdní řád (PWA)

React + Vite + Tailwind CSS v4, dark mode, Spotify zelená (`#1DB954`). Instalovatelná PWA s offline cache.

**Pokrytí:** spojení s přestupy, jízdné u dopravců a sdílená kola fungují **v celé ČR** (všechny zastávky z celostátních
jízdních řádů přes Transitous). Odjezdové tabule v okolí bez zadaného cíle jsou zatím jen pro **PID** (Praha a Středočeský kraj),
protože real-time odjezdy jiných regionů nemají jednotné otevřené API.

## Spuštění

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # produkční build do dist/ (včetně service workeru)
npm run preview
```

Geolokace v prohlížeči funguje jen přes **HTTPS nebo localhost**. Pro test na telefonu použij `npm run dev -- --host` + tunel (např. `cloudflared`, `ngrok`).

## Hosting: Cloudflare Pages (zdarma, bez vodoznaku)

Statické soubory z `dist/` + serverové funkce v `functions/` (Cloudflare Pages Functions, free plán: neomezený přenos,
100 000 volání funkcí denně). Logika funkcí je ve sdíleném `server/`:

| Cesta | Funkce | Proč přes server |
|---|---|---|
| `/api/transitous/*` | `server/transitous.ts` | Transitous vyžaduje `User-Agent` s kontaktem |
| `/api/golemio/*` | `server/golemio.ts` | API klíč Golemio nesmí do prohlížeče |
| `/api/fares/*` | `server/fares.ts` | RegioJet odmítá dotazy z cizích webů |

```bash
npx wrangler login                                            # jednou, otevře prohlížeč
npx wrangler pages project create kudytam --production-branch main   # jednou
npx wrangler pages secret put GOLEMIO_API_KEY --project-name kudytam # jednou
npm run deploy                                                # build + nasazení
npx wrangler pages dev dist                                   # lokálně i s funkcemi (klíč z .env)
```
`public/_headers` vypíná cache service workeru, aby se nová verze aplikace vždy načetla.

## Zdroje dat

| Účel | API | Klíč |
|---|---|---|
| Zastávky, odjezdy (real-time), trasy spojů | [Golemio API](https://api.golemio.cz/docs/openapi/) – PID (Praha a Středočeský kraj) | zdarma: <https://api.golemio.cz/api-keys> |
| Spojení s přestupy (odkud → kam) | [Transitous](https://transitous.org) (MOTIS 2) – PID, ČD a další dopravci, i se zpožděním | ne |
| Vyhledávání stanic PID (odkud/kam) | [data.pid.cz](https://data.pid.cz/stops/json/stops.json) → `public/stops.json` (`npm run stops`) | ne |
| Zastávky v celé ČR, adresy, GPS (odkud/kam) | Transitous /geocode (české jízdní řády + OpenStreetMap) | ne |

Transitous se volá přes serverovou funkci `server/transitous.ts`, protože jeho [podmínky](https://transitous.org/api/) vyžadují `User-Agent` s názvem aplikace a kontaktem. Ten prohlížeč sám nastavit neumí.
Podmínky Transitous: projekt musí být open-source a nekomerční, s viditelným odkazem na [zdroje dat](https://transitous.org/sources/). Spojení se obnovují nejvýš jednou za 90 s, aby se sdílená služba šetřila.

Golemio klíč je jen na serveru. Prohlížeč volá `/api/golemio/*`, a to je serverová funkce `server/golemio.ts`, která klíč přidá.
- **Produkce:** `npx wrangler pages secret put GOLEMIO_API_KEY --project-name kudytam` a znovu nasadit.
- **Lokálně:** do `.env` dej `GOLEMIO_API_KEY=<klíč>` (bez prefixu `VITE_`, takže se nedostane do bundlu).

Bez klíče aplikace běží na **demo datech** (smyšlené odjezdy).

> Odjezdové tabule jiných regionů ČR (IDS JMK, ODIS…) nemají jednotné otevřené real-time API. Stačí ale napsat nového
> poskytovatele podle rozhraní `TransitProvider` v `src/lib/transit/types.ts`. Spojení do cíle fungují v celé ČR už teď.

## Spojení do cíle (s přestupy)

`src/lib/journeys.ts` + `src/components/Journeys.tsx`
- Rychlost chůze z menu se posílá jako `pedestrianSpeed`. První úsek pěšky smí vést až do „širšího okolí“,
  takže vyhledávač sám zváží, jestli se vyplatí dojít na vzdálenější zastávku.
- Doporučené spojení je to s nejdřívějším příjezdem. Pokud vede přes vzdálenější zastávku, ukáže, kolik minut ušetří
  oproti nejlepšímu spojení z nejbližšího okolí.
- Jízdenka na celé spojení: pásma se skládají z nástupišť PID (podle GTFS ID, u vlaků z celostátních dat podle polohy)
  a vnější pásma se doplňují v celém rozsahu, protože i rychlík, který nezastavuje, pásmy projíždí.

## Odjezdy v okolí (bez cíle)

`src/lib/planner.ts`
1. Načte nástupiště v *širším okolí* (výchozí 1 200 m), z nich vybere *nejbližší* (400 m).
   Hledá se lokálně v `public/stops.json`, protože geo dotaz Golemio `/v2/gtfs/stops?latlng=` vrací chybu 500.
   Golemio se používá jen na odjezdové tabule a trasy spojů.
2. U každého odjezdu spočítá čas přesunu na zastávku: vzdušná vzdálenost × 1,3 (klikatost ulic) / zvolená rychlost.
   Spoj je *stihnutelný*, když „vyraž za“ ≥ 0.
3. Pokud z nejbližších zastávek do 10 min (nastavitelné) nic stihnutelného nejede, prohledá širší okolí a doporučí spoj,
   který odjede aspoň o 2 min dřív. Ukáže i čas chůze a kdy vyrazit.

## Jízdenky, slevy, kupóny

`src/lib/tickets.ts` – ceník **Tarifu PID od 1. 1. 2026** (ceny v aplikaci Lítačka):
- Praha (P, 0, B): 30 min 36 Kč, 90 min 46 Kč, 24 h 140 Kč; zlevněné (60–65 let) 18 / 23 / 70 Kč;
  zdarma děti do 15 let, senioři 65+, ZTP. Studenti mají v Praze slevu jen na předplatné, jednotlivé jízdné je plné.
- Region: podle počtu pásem (2 pásma / 15 min = 24 Kč … ), zlevněné pro děti, juniory, studenty 18–26 a seniory 65+.
- Kupóny (Lítačka Praha, vlastní pásma): pokrytá pásma se odečtou. Když kupón pokryje celou trasu, nic se nekupuje.
- Délka cesty = do příjezdu do cíle + 5 min rezerva. Bez cíle počítáme s cestou do 30 min.

⚠️ Přepočet pásma P u regionálních jízd je zjednodušený (`PRAGUE_P_WEIGHT`). Před ostrým nasazením ho ověř v Tarifu PID.

## Porovnání jízdného

`src/lib/fares.ts` + `src/components/FareComparison.tsx`. Nejlevnější varianta je nahoře, ostatní jsou v „Další možnosti jízdného“.
- PID v aplikaci Lítačka / papírová / SMS (Tarif PID 2026).
- Vlaky na jízdenku ČD + MHD s PID. Cena ČD je **orientační odhad** interpolací z cen, které ČD zveřejnily
  k jízdnímu řádu 2026 (25 km 68 Kč, 100 km 221 Kč, 250 km 527 Kč), se státní slevou 50 %
  (děti, studenti 18–26, senioři 65+). Přesnou cenu ukáže [e-shop ČD](https://www.cd.cz/eshop/).
- Tlačítko Lítačky na Androidu otevře nainstalovanou aplikaci (intent `cz.dpp.praguepublictransport`,
  jinak Google Play). Na iOS Lítačka nemá veřejný odkaz do aplikace, takže se otevře App Store s tlačítkem „Otevřít“.
  Konkrétní jízdenku v Lítačce předvybrat nejde (aplikace to zvenčí neumožňuje), proto aplikace ukáže, kterou vybrat.
- Vlak ČD: tlačítko „Vyhledat v IDOS“ otevře IDOS s předvyplněnou trasou a časem (`f`, `t`, `date`, `time` v URL).
  IDOS používá vlastní názvy míst, proto `idosPlace` v `fares.ts` (ověřeno proti idos.cz):
  - název bez diakritiky – IDOS z URL zahodí znaky jako Ř, č, ě („Říčany“ → „R?cany“), hledá ale i bez nich,
  - okres za středníkem („Ricany; Praha-vychod“, „Andel; Praha“) – rozliší stejně pojmenovaná místa
    (okres se v detailu spojení dohledá přes Transitous /reverse-geocode),
  - zahraniční názvy z dat FlixBusu („Prague (Main Railway Station)“) se nahradí českým názvem nejbližší zastávky,
  - zkratka „nám.“ se rozvine na „náměstí“; bez parametru `fc`/`tc` (s ním IDOS hlásí „Takové místo neznáme“).
  Autobusové zastávky s čárkou („Praha,ÚAN Florenc“) si IDOS sám převede na svůj tvar s dvěma čárkami.
  E-shop ČD předvyplnění neumí (formulář jejich hlavní stránky odmítá data zvenčí), takže tlačítko „E-shop ČD“ zkopíruje stanice do schránky.

### Dopravci po celé ČR

`src/lib/carriers.ts`. Úseky mimo PID a ČD se rozpoznají podle dopravce (Transitous `agencyName`, `agencyId`, ID zastávky):
- **FlixBus** – živá cena konkrétního spoje (veřejné vyhledávání FlixBusu podle ID stanic, která posílá Transitous),
  včetně poplatku za rezervaci, pro dospělého. **Koupit u FlixBus** otevře e-shop s předvyplněnými stanicemi a datem.
- **RegioJet** (vlaky i autobusy, v datech i jako STUDENT AGENCY) – veřejné API RegioJetu, cena „od“ (nejlevnější třída)
  podle tarifu z menu: student 18–26, mladistvý, dítě, senior 65+ a ZTP mají státní slevu 50 %.
  Stanice se párují podle čísla SR70 (vlaky) nebo polohy do 500 m (autobusy). **Koupit u RegioJet** otevře regiojet.cz s trasou a datem.
- **Ostatní** (Leo Express, Arriva, ZSSK, krajští dopravci, MHD mimo PID – např. IDS JMK v Brně): web dopravce a IDOS
  s předvyplněnou trasou a časem. Cenu ukáže dopravce.

RegioJet odmítá dotazy z prohlížeče cizích webů, proto ceny jdou přes serverovou funkci `server/fares.ts`
(`/api/fares/*`, jen povolené cesty, cache 5 min, seznam stanic 24 h).
Dálkové spoje, které jen projíždějí pásmy PID (rychlík do Brna), a komerční dopravci (FlixBus, RegioJet, Leo Express)
se nepočítají jako PID – jízdenka PID na ně neplatí.

## Kdy jet: teď, odjezd v / příjezd do

Pod kolonkami Odkud/Kam (když je zadaný cíl) jde přepnout **Teď / Odjezd / Příjezd** a vybrat datum a čas.
Posílá se Transitous jako `time` (+ `arriveBy=true`) a platí pro spojení MHD, spojení s kolem i dřívější/pozdější stránky.
Cesta pěšky, sdíleným kolem a taxi se počítá od zvoleného odjezdu, nebo tak, abys byl v cíli do zvoleného příjezdu
(`leaveAt` v `journeys.ts`). Volná kola u cesty víc než 20 min dopředu jsou jen ověřená teď – aplikace na to upozorní.
Uplynulý čas se při hledání vrátí na „Teď“. Odjezdy v okolí (bez cíle) jsou vždy aktuální.

## Odkud a kam: zastávka v ČR, adresa nebo GPS

V kolonkách **Odkud** i **Kam** (a u domova) jde zadat stanici PID, zastávku nebo nádraží kdekoli v ČR (Transitous /geocode,
jen české jízdní řády), adresu (OpenStreetMap) nebo GPS souřadnice:
desetinné stupně (i s čárkou), stupně/minuty/vteřiny, světové strany (N/E i s. š./v. d.) a vložený odkaz z Google Map nebo Mapy.cz.
K GPS bodu se dohledá nejbližší adresa (/reverse-geocode).

## Cesta pěšky

Když je cíl vzdušnou čarou do „širšího okolí“ (menu), nebo když chůze (do 45 min) není o víc než 10 min pomalejší než nejrychlejší MHD, nabídne se i cesta pěšky (Transitous `direct`, se zvolenou rychlostí)
se srovnáním příjezdu s nejrychlejší MHD a tlačítkem **Navigovat**. Otevře [Mapy.com URL](https://developer.mapy.com/further-uses-of-mapycz/mapy-cz-url/)
(`/fnc/v1/route`, `routeType=foot_fast` / `bike_road`, `navigate=true`). V telefonu se spustí aplikace Mapy.com, pokud je nainstalovaná, jinak web.

## Rozšířené vyhledávání: sdílená kola a taxi

`src/lib/mobility.ts` + `src/components/Mobility.tsx`. U nalezených spojení se navíc nabídne sdílené kolo a taxi.
Tlačítkem **Vypnout rozšířené vyhledávání** nad výsledky se tyhle karty skryjí a Transitous se přestane ptát na trasu autem.
Volba se pamatuje.

- **Sdílené kolo – nextbike, celá ČR** (40 systémů: Praha a Říčany, Brno, Ostrava, Hradec Králové, Olomoucko, Zlín…):
  živý [GBFS feed nextbike](https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_tg/gbfs.json) (CC0). Seznam systémů s oblastí stanic
  je v `src/lib/bike-systems.ts` (`npm run bikes` ho obnoví); načte se jen GBFS systému, v jehož oblasti je start i cíl.
  Hledá stanici s volným kolem v „širším okolí“ startu a stanici s volným stojanem u cíle a vybere nejrychlejší kombinaci.
  Kolo se nabídne, jen když je na stojanu opravdu: počet ve `station_status` musí potvrdit i seznam kol ve `free_bike_status`
  (bez rezervovaných a vyřazených), feed nesmí být starší než 10 min a stanice se musela ozvat v posledních 2 h.
  Cena se počítá z ceníku GBFS (`system_pricing_plans`) podle regionu stanice (Praha 39 Kč / 30 min, Říčany 35 Kč / 30 min,
  Brno 35 Kč / 30 min, Ostrava 25 Kč…). Města, která mají minuty zdarma přímo v ceníku GBFS, se počítají sama.
  Minuty zdarma navíc (`FREE_RIDES`, podle `region_id` stanice):
  - Praha: prvních 15 min 2× denně pro předplatitele kupónu PID na Prahu v Lítačce ([PID](https://pid.cz/cykliste-v-pid/sdilena-kola/)).
    Počítá se jen tehdy, když máš v menu aplikace zadaný aktivní kupón na Prahu.
  - Říčany: prvních 15 min zdarma pro všechny (podle stanice, kde si kolo půjčíš), cena se ukáže jako 0 Kč.
  Zbytek jízdy se platí podle ceníku poskytovatele.
  Tlačítko otevře aplikaci nextbike přímo na stanici (`rental_uris`), navigace na kole vede přes Mapy.com.
  Rekola a Bolt veřejný feed nemají.
- **Sdílené kolo na začátek i konec cesty** (např. z Říčan kolem na nádraží, vlakem do Brna a z nádraží kolem do cíle):
  když je do 400 m stojan s kolem, nebo cíl leží v oblasti systému nextbike, pošle aplikace jeden dotaz navíc
  (`preTransitModes` / `postTransitModes` = `WALK,BIKE`) a Transitous sám zvolí, kde se kolo vyplatí.
  Každý úsek na kole se ověří proti živým datům a čas se přepočítá na skutečné stojany (pěšky na stojan, kolo, pěšky dál,
  minuta na půjčení a vrácení, minuta rezerva před odjezdem):
  - začátek: kolo na stojanu u startu, místo k vrácení do 350 m od nástupní zastávky,
  - konec: kolo na stojanu do 350 m od výstupní zastávky, místo k vrácení u cíle. Kolo potřebuješ až po příjezdu,
    takže počet kol je jen ověřený teď – aplikace na to upozorní (víc než 20 min dopředu).
  Když je na začátku nebo na konci rychlejší jít rovnou pěšky (zajížďka ke stojanům zabere víc), ukáže se ten úsek pěšky.
  Spojení, kde ověření kola selže, se zahodí; spojení s kolem zůstane jen tam, kde žádné běžné spojení nevyráží stejně
  pozdě a nedorazí stejně brzy. Stojany bez uvedené kapacity (parkovací místa bez zámků, např. v Brně) berou kolo vždy.
  Cena kola se přičte k jízdnému.
- **Taxi – Uber, Bolt, Liftago**: čas a vzdálenost jízdy autem počítá Transitous (`directModes=WALK,CAR`,
  `fastestDirectFactor=100`, jinak by zahodil spojení MHD pomalejší než auto). Počítá se s ~6 min na přistavení vozu.
  Cena je **orientační rozpětí**, protože aplikace ceník nezveřejňují. Horní mez = maximální cena taxi v Praze
  (cenový výměr hl. m. Prahy č. 3/2026: 70 Kč + 42 Kč/km), dolní mez 65 % z ní.
  Uber se otevře s předvyplněným nástupem i cílem ([Uber deep links](https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction)).
  Bolt a Liftago veřejný odkaz s trasou nemají: otevře se aplikace (Android intent / App Store) a cíl se zkopíruje do schránky.

## Domov

V menu si nastavíš domov – konkrétní adresu (vyhledávání Transitous /geocode nad OpenStreetMap) nebo stanici. Tlačítko **Domů** pak vyhledá nejlepší spojení domů z aktuální polohy.

## Trasa spoje

Klepnutí na úsek v detailu spojení načte přes Transitous `/trip` všechny zastávky spoje s aktuálními časy.
Poloha vozidla se odvozuje z časů průjezdů a obnovuje se každých 30 s.

## Jízdenky se v aplikaci nekupují

Aplikace jen ukáže, jaký typ jízdenky potřebuješ a kolik stojí v aplikaci PID Lítačka, papírově a přes SMS.
Odkáže tě, kde si ji koupit.

## Licence

Kód je pod licencí [MIT](LICENSE).
Data: jízdní řády a zastávky © ROPID / PID ([data.pid.cz](https://data.pid.cz)) přes Golemio,
spojení [Transitous](https://transitous.org/sources/), mapová data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

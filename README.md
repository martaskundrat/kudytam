# Kudytam – chytrý jízdní řád (PWA)

React + Vite + Tailwind CSS v4, dark mode, Spotify zelená (`#1DB954`). Instalovatelná PWA s offline cache.

## Spuštění

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # produkční build do dist/ (včetně service workeru)
npm run preview
```

Geolokace v prohlížeči funguje jen přes **HTTPS nebo localhost**. Pro test na telefonu použij `npm run dev -- --host` + tunel (např. `cloudflared`, `ngrok`).

## Zdroje dat

| Účel | API | Klíč |
|---|---|---|
| Zastávky, odjezdy (real-time), trasy spojů | [Golemio API](https://api.golemio.cz/docs/openapi/) – PID (Praha a Středočeský kraj) | zdarma: <https://api.golemio.cz/api-keys> |
| Spojení s přestupy (odkud → kam) | [Transitous](https://transitous.org) (MOTIS 2) – PID, ČD a další dopravci, i se zpožděním | ne |
| Vyhledávání stanic (odkud/kam) | [data.pid.cz](https://data.pid.cz/stops/json/stops.json) → `public/stops.json` (`npm run stops`) | ne |

Transitous se volá přes edge funkci `netlify/edge-functions/transitous.ts`, protože jeho [podmínky](https://transitous.org/api/) vyžadují `User-Agent` s názvem aplikace a kontaktem. Ten prohlížeč sám nastavit neumí.
Podmínky Transitous: projekt musí být open-source a nekomerční, s viditelným odkazem na [zdroje dat](https://transitous.org/sources/). Spojení se obnovují nejvýš jednou za 90 s, aby se sdílená služba šetřila.

Golemio klíč je jen na serveru. Prohlížeč volá `/api/golemio/*`, a to je Netlify edge funkce `netlify/edge-functions/golemio.ts`, která klíč přidá.
- **Produkce:** `netlify env:set GOLEMIO_API_KEY <klíč>` a znovu nasadit.
- **Lokálně:** do `.env` dej `GOLEMIO_API_KEY=<klíč>` (bez prefixu `VITE_`, takže se nedostane do bundlu).

Bez klíče aplikace běží na **demo datech** (smyšlené odjezdy).

> Jiné regiony ČR (IDS JMK, ODIS…) nemají jednotné otevřené real-time API. Stačí ale napsat nového poskytovatele
> podle rozhraní `TransitProvider` v `src/lib/transit/types.ts`.

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
  E-shop ČD předvyplnění neumí (formulář jejich hlavní stránky odmítá data zvenčí), takže tlačítko „E-shop ČD“ zkopíruje stanice do schránky.

## Cíl: stanice, adresa nebo GPS

V kolonce **Kam** (a u domova) jde zadat stanici PID, adresu (Transitous /geocode nad OpenStreetMap) nebo GPS souřadnice:
desetinné stupně (i s čárkou), stupně/minuty/vteřiny, světové strany (N/E i s. š./v. d.) a vložený odkaz z Google Map nebo Mapy.cz.
K GPS bodu se dohledá nejbližší adresa (/reverse-geocode).

## Cesta pěšky

Když je cíl vzdušnou čarou do „širšího okolí“ (menu), nebo když chůze (do 45 min) není o víc než 10 min pomalejší než nejrychlejší MHD, nabídne se i cesta pěšky (Transitous `direct`, se zvolenou rychlostí)
se srovnáním příjezdu s nejrychlejší MHD a tlačítkem pro navigaci v mapách.

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

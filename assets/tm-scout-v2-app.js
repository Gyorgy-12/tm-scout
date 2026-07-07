/*
 * fast-i18n-v18-20260707
 * export-table-typography-polish-20260706
 * Based on full-i18n-export-popup; keeps old export design, removes List column, improves table typography and export line breaks.
 * TM Scout V2 GitHub Pages build
 * Source: Tampermonkey userscript converted to static frontend.
 * Network: GM_xmlhttpRequest shim -> hardcoded Cloudflare Worker proxy endpoint.
 */
(function installGithubPageShims(){
  'use strict';
  // fast-i18n-v18-20260707

  const TM_SCOUT_PROXY_ENDPOINT = 'https://tm-scout-v2-proxy.wc26-guesses.workers.dev';

  function proxyEndpoint(){
    return TM_SCOUT_PROXY_ENDPOINT.trim().replace(/\/$/, '');
  }

  function isTransfermarktLike(url){
    try {
      const host = new URL(url, window.location.href).hostname;
      return /(^|\.)transfermarkt\.(com|de|us|co\.uk|at|world)$/i.test(host) || host === 'tmapi.transfermarkt.technology';
    } catch (_error) {
      return false;
    }
  }

  window.GM_registerMenuCommand = window.GM_registerMenuCommand || function noopMenuCommand(){ return null; };

  window.GM_getValue = window.GM_getValue || function gmGetValue(key, fallback){
    try {
      const raw = window.localStorage.getItem(String(key));
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_error) {
      return fallback;
    }
  };

  window.GM_setValue = window.GM_setValue || function gmSetValue(key, value){
    try { window.localStorage.setItem(String(key), JSON.stringify(value)); } catch (_error) {}
  };

  window.GM_deleteValue = window.GM_deleteValue || function gmDeleteValue(key){
    try { window.localStorage.removeItem(String(key)); } catch (_error) {}
  };

  window.GM_listValues = window.GM_listValues || function gmListValues(){
    const keys = [];
    try {
      for (let i = 0; i < window.localStorage.length; i += 1) keys.push(window.localStorage.key(i));
    } catch (_error) {}
    return keys;
  };

  window.GM_xmlhttpRequest = window.GM_xmlhttpRequest || function gmXmlHttpRequestShim(options){
    const opts = options || {};
    const targetUrl = String(opts.url || '');
    const endpoint = proxyEndpoint();

    if (!targetUrl) {
      if (opts.onerror) opts.onerror({ error: 'Missing URL' });
      return;
    }

    if (isTransfermarktLike(targetUrl) && !endpoint) {
      const message = 'A Cloudflare Worker proxy nincs beállítva a kódban. Ellenőrizd a TM_SCOUT_PROXY_ENDPOINT értékét az assets/tm-scout-v2-app.js fájl elején.';
      if (opts.onerror) opts.onerror({ error: message });
      return;
    }

    const fetchUrl = endpoint && isTransfermarktLike(targetUrl)
      ? endpoint + '?url=' + encodeURIComponent(targetUrl)
      : targetUrl;

    const controller = new AbortController();
    const timeout = Number(opts.timeout || 30000);
    const timer = window.setTimeout(function abortRequest(){ controller.abort(); }, timeout);

    fetch(fetchUrl, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      signal: controller.signal,
      credentials: 'omit',
      mode: 'cors'
    }).then(async function onResponse(response){
      window.clearTimeout(timer);
      const responseText = await response.text();
      let parsed = null;
      if (opts.responseType === 'json') {
        try { parsed = responseText ? JSON.parse(responseText) : null; } catch (_error) { parsed = null; }
      }
      if (opts.onload) {
        opts.onload({
          status: response.status,
          statusText: response.statusText,
          responseText: responseText,
          response: opts.responseType === 'json' ? parsed : responseText,
          finalUrl: response.url,
          readyState: 4
        });
      }
    }).catch(function onFetchError(error){
      window.clearTimeout(timer);
      if (error && error.name === 'AbortError') {
        if (opts.ontimeout) opts.ontimeout(error);
        return;
      }
      if (opts.onerror) opts.onerror(error);
    });
  };
})();

(function tmScoutV2CleanScope() {
  'use strict';
  // u21-own-team-filter-20260706: own-team exclusion visible and active in U21 mode too.
  // fast-i18n-v18-20260707: source plans are narrowed before fetching; U21 uses nationality/global MV sources, contract mode uses a focused source budget.

  const APP = Object.freeze({
    name: 'TM Scout V2',
    logPrefix: '[TM Scout V2]',
    cachePrefix: 'tmScoutV2InteractiveHtmlExportV18:',
    ttlMs: 14 * 24 * 60 * 60 * 1000,
    launcherId: 'tm-scout-v2ihe-launcher',
    panelId: 'tm-scout-v2ihe-panel',
    styleId: 'tm-scout-v2ihe-style',
    menuOpen: 'Open TM Scout V2',
    menuClear: 'Clear TM Scout V2 cache'
  });


  // fast-i18n-v18-20260707:
  // A GitHub Pages frontend eddig minden TM oldalt külön Worker requestként vitt át.
  // A batch proxy most nagyobb, Worker-kímélő csomagokban dolgozik.
  // Fontos: a böngészőoldali concurrency is ehhez igazodik, különben a 24/48-as batch sosem telne meg.
  // Így ugyanannyi Transfermarkt oldalhoz jóval kevesebb Cloudflare Worker request kell.
  const TM_SCOUT_BATCH_PROXY_ENDPOINT = 'https://tm-scout-v2-proxy.wc26-guesses.workers.dev';
  const TM_SCOUT_BATCH_SIZE = 40;
  const TM_SCOUT_BATCH_DELAY_MS = 120;
  const TM_SCOUT_BATCH_MEMORY_CACHE_TTL_MS = 45 * 60 * 1000;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEMS = 1400;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_CHARS = 48 * 1024 * 1024;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEM_CHARS = 950000;
  let tmScoutBatchQueue = [];
  let tmScoutBatchTimer = null;
  let tmScoutBatchMemoryCacheChars = 0;
  const tmScoutBatchMemoryCache = new Map();
  const tmScoutBatchPendingByKey = new Map();
  const TM_SCOUT_BATCH_POST_DISABLE_MS = 10 * 60 * 1000;
  let tmScoutBatchPostDisabledUntil = 0;
  let tmScoutBatchFallbackWarningShown = false;

  function isTmScoutBatchPostTemporarilyDisabled() {
    return tmScoutBatchPostDisabledUntil && Date.now() < tmScoutBatchPostDisabledUntil;
  }

  function disableTmScoutBatchPostTemporarily(reason) {
    tmScoutBatchPostDisabledUntil = Date.now() + TM_SCOUT_BATCH_POST_DISABLE_MS;
    if (!tmScoutBatchFallbackWarningShown) {
      tmScoutBatchFallbackWarningShown = true;
      pushError('batch POST disabled temporarily', reason || 'Worker rejected batch POST');
    }
  }

  function tmScoutBatchEndpoint(){
    return String(TM_SCOUT_BATCH_PROXY_ENDPOINT || '').trim().replace(/\/$/, '');
  }

  function isBatchableTransfermarktUrl(url){
    try {
      const host = new URL(String(url), window.location.href).hostname;
      return /(^|\.)transfermarkt\.(com|de|us|co\.uk|at|world)$/i.test(host) || host === 'tmapi.transfermarkt.technology';
    } catch (_error) {
      return false;
    }
  }

  function canonicalizeScoutUrl(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.href);
      parsed.hash = '';

      // Same URL, different query-order = same Worker/cache job. TM doesn't care about query order.
      const removable = /^(utm_|fbclid$|gclid$|ref$|from$)/i;
      const entries = [];
      parsed.searchParams.forEach(function collect(value, key) {
        if (removable.test(String(key || ''))) return;
        entries.push([String(key), String(value)]);
      });
      entries.sort(function sortQuery(a, b) {
        return a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]);
      });
      parsed.search = '';
      entries.forEach(function addQuery(entry) { parsed.searchParams.append(entry[0], entry[1]); });
      return parsed.toString();
    } catch (_error) {
      return String(url || '');
    }
  }

  function tmScoutBatchCacheKey(url, responseKind) {
    const normalized = canonicalizeScoutUrl(url);
    return `${responseKind === 'json' ? 'json' : 'text'}::${normalized}`;
  }

  function tmScoutApproxChars(value) {
    if (typeof value === 'string') return value.length;
    try { return JSON.stringify(value).length; } catch (_error) { return 0; }
  }

  function tmScoutBatchMemoryDelete(key) {
    const item = tmScoutBatchMemoryCache.get(key);
    if (item) tmScoutBatchMemoryCacheChars = Math.max(0, tmScoutBatchMemoryCacheChars - Number(item.chars || 0));
    tmScoutBatchMemoryCache.delete(key);
  }

  function tmScoutBatchMemoryGet(key) {
    const item = tmScoutBatchMemoryCache.get(key);
    if (!item) return { hit: false, value: null };
    if (Date.now() - Number(item.savedAt || 0) > TM_SCOUT_BATCH_MEMORY_CACHE_TTL_MS) {
      tmScoutBatchMemoryDelete(key);
      return { hit: false, value: null };
    }
    tmScoutBatchMemoryCache.delete(key);
    tmScoutBatchMemoryCache.set(key, item);
    return { hit: true, value: item.value };
  }

  function tmScoutBatchMemorySet(key, value) {
    const chars = tmScoutApproxChars(value);
    if (!chars || chars > TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEM_CHARS) return;
    tmScoutBatchMemoryDelete(key);
    tmScoutBatchMemoryCache.set(key, { savedAt: Date.now(), chars: chars, value: value });
    tmScoutBatchMemoryCacheChars += chars;
    while (tmScoutBatchMemoryCache.size > TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEMS || tmScoutBatchMemoryCacheChars > TM_SCOUT_BATCH_MEMORY_CACHE_MAX_CHARS) {
      const oldest = tmScoutBatchMemoryCache.keys().next().value;
      if (!oldest) break;
      tmScoutBatchMemoryDelete(oldest);
    }
  }



  const LANGUAGE_STORAGE_KEY = 'tmScoutV2UiLanguage';
  const I18N = Object.freeze({
  "hu": {
    "Transfermarkt Scout": "Transfermarkt Scout",
    "Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.": "Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.",
    "Nyelv": "Nyelv",
    "Felület nyelve": "Felület nyelve",
    "Magyar": "Magyar",
    "Angol": "Angol",
    "Román": "Román",
    "Scout mód": "Scout mód",
    "Mód": "Mód",
    "Lejáró szerződés / free agent": "Lejáró szerződés / szabadon igazolható",
    "U21 prospect": "U21 tehetség",
    "Alapszűrők": "Alapszűrők",
    "Min MV": "Min MV",
    "Max MV": "Max MV",
    "Min age": "Min kor",
    "Max age": "Max kor",
    "MV reference date": "MV referencia dátum",
    "Max MV drop %": "Max MV-esés %",
    "Contract year": "Szerződés éve",
    "Szerződés lejárati éve": "Szerződés lejárati éve",
    "Játékidő + szezonok": "Játékidő + szezonok",
    "Min minutes / season": "Min perc / szezon",
    "Min apps / season": "Min meccs / szezon",
    "Vizsgált szezonok": "Vizsgált szezonok",
    "Auto": "Automatikus",
    "1 szezon": "1 szezon",
    "2 szezon": "2 szezon",
    "3 szezon": "3 szezon",
    "Szezon szabály": "Szezon szabály",
    "Apps vagy perc": "Meccs vagy perc",
    "Apps és perc": "Meccs és perc",
    "Minden kiválasztott szezon menjen át": "Minden kiválasztott szezon menjen át",
    "Max oldalak": "Max oldalak",
    "Max játékosjelöltek": "Max játékosjelöltek",
    "Poszt-szűrés módja": "Poszt-szűrés módja",
    "Posztszűrés": "Posztszűrés",
    "Tág posztcsoportok": "Tág posztcsoportok",
    "Precíz posztok": "Precíz posztok",
    "Posztcsoportok": "Posztcsoportok",
    "Részletes posztok": "Részletes posztok",
    "Other/unknown": "Egyéb/ismeretlen",
    "U21 prospect szűrők": "U21 prospect szűrők",
    "U21 min age": "U21 min kor",
    "U21 max age": "U21 max kor",
    "U21 min MV": "U21 min MV",
    "U21 max MV": "U21 max MV",
    "Min játszott meccsarány %": "Min játszott meccsarány %",
    "Nemzetiségek, opcionális multiple choice": "Nemzetiségek, opcionális multiple choice",
    "U21 oldalak": "U21 oldalak",
    "U21 max játékosjelöltek": "U21 max játékosjelöltek",
    "Források": "Források",
    "Első osztályú európai ligák": "Első osztályú európai ligák",
    "Jobb ligák 2–3. osztályai is": "Jobb ligák 2–3. osztályai is",
    "Alsóbb osztály mélység": "Alsóbb osztály mélység",
    "Csak 2. osztály": "Csak 2. osztály",
    "2–3. osztály": "2–3. osztály",
    "Aktuális free agentek is (alapból ON)": "Aktuális free agentek is (alapból ON)",
    "Jövőbeli igazolással rendelkezők kizárása": "Jövőbeli igazolással rendelkezők kizárása",
    "Saját csapat kizárása": "Saját csapat kizárása",
    "Saját csapat név vagy TM club ID": "Saját csapat név vagy TM club ID",
    "Saját csapat időablak": "Saját csapat időablak",
    "Utolsó szezon": "Utolsó szezon",
    "Kiválasztott szezonok": "Kiválasztott szezonok",
    "Keresés": "Keresés",
    "HTML letöltés": "HTML letöltés",
    "HTML nézet megnyitása": "HTML nézet megnyitása",
    "Megnyitás": "Megnyitás",
    "Oké": "Oké",
    "Hoppá": "Hoppá",
    "HTML nézet": "HTML nézet",
    "Nincs exportálható találat. Előbb futtasd a keresést.": "Nincs exportálható találat. Előbb futtasd a keresést.",
    "CSV export": "CSV export",
    "JSON export": "JSON export",
    "Cache törlés": "Cache törlés",
    "Készen áll.": "Készen áll.",
    "Találatok": "Találatok",
    "Vizsgált játékosok": "Vizsgált játékosok",
    "Ellenőrizve": "Ellenőrizve",
    "Játékos": "Játékos",
    "Poszt": "Poszt",
    "Kor": "Kor",
    "Nemzetiség": "Nemzetiség",
    "Elérhetőség": "Elérhetőség",
    "Klub / utolsó klub": "Klub / utolsó klub",
    "MV most": "MV most",
    "MV változás": "MV változás",
    "Játékidő": "Játékidő",
    "Utolsó szezonok": "Utolsó szezonok",
    "Forrás": "Forrás",
    "TM profil": "TM profil",
    "Profil": "Profil",
    "U21 score": "U21 pontszám",
    "Klubkörnyezet": "Klubkörnyezet",
    "Játszott meccsarány": "Játszott meccsarány",
    "Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.": "Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.",
    "Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.": "Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.",
    "Összecsukás": "Összecsukás",
    "Kinyitás": "Kinyitás",
    "Bezárás": "Bezárás",
    "Cache törölve": "Cache törölve",
    "Forrásoldalak előkészítése...": "Forrásoldalak előkészítése...",
    "U21 forrásoldalak előkészítése...": "U21 forrásoldalak előkészítése...",
    "Forrásoldalak letöltése": "Forrásoldalak letöltése",
    "Source táblázatok parse-olása...": "Forrástáblák feldolgozása...",
    "Profil enrich indul": "Profil enrich indul",
    "Kész": "Kész",
    "Hiba": "Hiba",
    "A Cloudflare Worker proxy nincs beállítva a kódban. Ellenőrizd a TM_SCOUT_PROXY_ENDPOINT értékét az assets/tm-scout-v2-app.js fájl elején.": "A Cloudflare Worker proxy nincs beállítva a kódban. Ellenőrizd a TM_SCOUT_PROXY_ENDPOINT értékét az assets/tm-scout-v2-app.js fájl elején.",
    "Argentina": "Argentína",
    "Austria": "Ausztria",
    "Belgium": "Belgium",
    "Brazil": "Brazília",
    "Croatia": "Horvátország",
    "Czech Republic": "Csehország",
    "Denmark": "Dánia",
    "England": "Anglia",
    "France": "Franciaország",
    "Germany": "Németország",
    "Ghana": "Ghána",
    "Hungary": "Magyarország",
    "Italy": "Olaszország",
    "Netherlands": "Hollandia",
    "Norway": "Norvégia",
    "Poland": "Lengyelország",
    "Portugal": "Portugália",
    "Romania": "Románia",
    "Scotland": "Skócia",
    "Serbia": "Szerbia",
    "Slovakia": "Szlovákia",
    "Slovenia": "Szlovénia",
    "Spain": "Spanyolország",
    "Sweden": "Svédország",
    "Switzerland": "Svájc",
    "Turkey": "Törökország",
    "Ukraine": "Ukrajna",
    "Uruguay": "Uruguay",
    "United States": "Egyesült Államok",
    "TM Scout V2 panel": "TM Scout V2 panel",
    "Contract nemzetiségek / source szűkítés": "Contract nemzetiségek / forrásszűkítés",
    "Contract nemzetiségek": "Contract nemzetiségek",
    "Source szűkítés": "Forrásszűkítés",
    "Lista": "Lista",
    "Left Winger": "Bal szélső",
    "Right Winger": "Jobb szélső",
    "Winger": "Szélső",
    "CF/ST": "CF/ST",
    "DEF": "DEF",
    "MID": "MID",
    "FWD": "FWD",
    "GK": "GK",
    "CB": "CB",
    "LB": "LB",
    "RB": "RB",
    "DM": "DM",
    "CM": "CM",
    "AM": "AM",
    "LM": "LM",
    "RM": "RM",
    "SS": "SS",
    "Klub / csapat": "Klub / csapat",
    "Contract mód: csak lejáró/free agent menü; U21 prospect szűrők elrejtve.": "Contract mód: csak lejáró/szabadon igazolható menü; U21 tehetségszűrők elrejtve.",
    "U21 mód: életkor + MV + játszott meccsarány + MV-változás. Nem kell lejáró szerződés.": "U21 mód: életkor + MV + játszott meccsarány + MV-változás. Nem kell lejáró szerződés.",
    "Játékoslisták feldolgozása...": "Játékoslisták feldolgozása...",
    "Nincs találat az alap szűrők után. Emeld a max oldalszámot vagy lazíts a szűrőkön.": "Nincs találat az alap szűrők után. Emeld a max oldalszámot vagy lazíts a szűrőkön.",
    "Részletes adatok lekérése": "Részletes adatok lekérése",
    "találat": "találat",
    "vizsgált játékos": "vizsgált játékos",
    "játékos": "játékos",
    "oldal": "oldal",
    "elem": "elem",
    "Forrásoldal": "Forrásoldal",
    "Nincs source URL. Legalább egy Transfermarkt forrás kell.": "Nincs forrás URL. Legalább egy Transfermarkt forrás kell.",
    "A TM Scout V2 betölt...": "A TM Scout V2 betölt...",
    "Ehhez az apphoz JavaScript kell.": "Ehhez az apphoz JavaScript kell.",
    "Lejáró szerződéses játékosok és U21 prospectek keresése.": "Lejáró szerződéses játékosok és U21 prospectek keresése.",
    "pl. DAC 1904, APOEL vagy 829": "pl. DAC 1904, APOEL vagy 829",
    "English": "Angol",
    "Română": "Román",
    "TM Scout V2": "TM Scout V2",
    "Letöltés": "Letöltés",
    "Megnyitás új ablakban": "Megnyitás új ablakban",
    "Másolás": "Másolás",
    "Másolva": "Másolva",
    "Mégse": "Mégse",
    "Igen": "Igen",
    "Nem": "Nem",
    "Ismeretlen": "Ismeretlen",
    "ismeretlen": "ismeretlen",
    "Nincs MV history": "Nincs MV history",
    "MV history hiányzik": "MV history hiányzik",
    "Aktuális MV": "Aktuális MV",
    "Free agent": "Szabadon igazolható",
    "Nem free agent": "Nem szabadon igazolható",
    "Aktív klub": "Aktív klub",
    "Nincs adat": "Nincs adat",
    "Nincs": "Nincs",
    "összes": "összes",
    "perc": "perc",
    "meccs": "meccs"
  },
  "en": {
    "Transfermarkt Scout": "Transfermarkt Scout",
    "Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.": "Find contract-expiring players and U21 prospects in one place.",
    "Nyelv": "Language",
    "Felület nyelve": "Interface language",
    "Magyar": "Hungarian",
    "Angol": "English",
    "Román": "Romanian",
    "Scout mód": "Scout mode",
    "Mód": "Mode",
    "Lejáró szerződés / free agent": "Contract expiring / free agent",
    "U21 prospect": "U21 prospect",
    "Alapszűrők": "Basic filters",
    "Min MV": "Min MV",
    "Max MV": "Max MV",
    "Min age": "Min age",
    "Max age": "Max age",
    "MV reference date": "MV reference date",
    "Max MV drop %": "Max MV drop %",
    "Contract year": "Contract year",
    "Szerződés lejárati éve": "Contract expiry year",
    "Játékidő + szezonok": "Playing time + seasons",
    "Min minutes / season": "Min minutes / season",
    "Min apps / season": "Min apps / season",
    "Vizsgált szezonok": "Seasons checked",
    "Auto": "Auto",
    "1 szezon": "1 season",
    "2 szezon": "2 seasons",
    "3 szezon": "3 seasons",
    "Szezon szabály": "Season rule",
    "Apps vagy perc": "Apps or minutes",
    "Apps és perc": "Apps and minutes",
    "Minden kiválasztott szezon menjen át": "Every selected season must pass",
    "Max oldalak": "Max pages",
    "Max játékosjelöltek": "Max candidates",
    "Poszt-szűrés módja": "Position filter mode",
    "Posztszűrés": "Position filter",
    "Tág posztcsoportok": "Broad position groups",
    "Precíz posztok": "Exact positions",
    "Posztcsoportok": "Position groups",
    "Részletes posztok": "Detailed positions",
    "Other/unknown": "Other/unknown",
    "U21 prospect szűrők": "U21 prospect filters",
    "U21 min age": "U21 min age",
    "U21 max age": "U21 max age",
    "U21 min MV": "U21 min MV",
    "U21 max MV": "U21 max MV",
    "Min játszott meccsarány %": "Min played-match ratio %",
    "Nemzetiségek, opcionális multiple choice": "Nationalities, optional multiple choice",
    "U21 oldalak": "U21 pages",
    "U21 max játékosjelöltek": "U21 max candidates",
    "Források": "Sources",
    "Első osztályú európai ligák": "European first divisions",
    "Jobb ligák 2–3. osztályai is": "Strong 2nd–3rd divisions too",
    "Alsóbb osztály mélység": "Lower-division depth",
    "Csak 2. osztály": "Only 2nd tier",
    "2–3. osztály": "2nd–3rd tier",
    "Aktuális free agentek is (alapból ON)": "Include current free agents (default ON)",
    "Jövőbeli igazolással rendelkezők kizárása": "Exclude players with future transfers",
    "Saját csapat kizárása": "Exclude own team",
    "Saját csapat név vagy TM club ID": "Own team name or TM club ID",
    "Saját csapat időablak": "Own-team lookback",
    "Utolsó szezon": "Latest season",
    "Kiválasztott szezonok": "Selected seasons",
    "Keresés": "Search",
    "HTML letöltés": "Download HTML",
    "HTML nézet megnyitása": "Open HTML view",
    "Megnyitás": "Open",
    "Oké": "OK",
    "Hoppá": "Oops",
    "HTML nézet": "HTML view",
    "Nincs exportálható találat. Előbb futtasd a keresést.": "No exportable results. Run the search first.",
    "CSV export": "CSV export",
    "JSON export": "JSON export",
    "Cache törlés": "Clear cache",
    "Készen áll.": "Ready.",
    "Találatok": "Results",
    "Vizsgált játékosok": "Players checked",
    "Ellenőrizve": "Enriched",
    "Játékos": "Player",
    "Poszt": "Position",
    "Kor": "Age",
    "Nemzetiség": "Nationality",
    "Elérhetőség": "Availability",
    "Klub / utolsó klub": "Club / last club",
    "MV most": "Current MV",
    "MV változás": "MV change",
    "Játékidő": "Playing time",
    "Utolsó szezonok": "Recent seasons",
    "Forrás": "Source",
    "TM profil": "TM profile",
    "Profil": "Profile",
    "U21 score": "U21 score",
    "Klubkörnyezet": "Club environment",
    "Játszott meccsarány": "Played-match ratio",
    "Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.": "No results yet. Either the filters are too strict or Transfermarkt is acting up.",
    "Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.": "No U21 results yet. Loosen the match-ratio / MV / age / position / nationality filters, or raise Max pages.",
    "Összecsukás": "Collapse",
    "Kinyitás": "Expand",
    "Bezárás": "Close",
    "Cache törölve": "Cache cleared",
    "Forrásoldalak előkészítése...": "Preparing source pages...",
    "U21 forrásoldalak előkészítése...": "Preparing U21 source pages...",
    "Forrásoldalak letöltése": "Downloading source pages",
    "Source táblázatok parse-olása...": "Parsing source tables...",
    "Profil enrich indul": "Profile enrichment starting",
    "Kész": "Done",
    "Hiba": "Error",
    "A Cloudflare Worker proxy nincs beállítva a kódban. Ellenőrizd a TM_SCOUT_PROXY_ENDPOINT értékét az assets/tm-scout-v2-app.js fájl elején.": "No Cloudflare Worker proxy URL is set. Add the proxy URL above, otherwise the GitHub Pages frontend cannot read Transfermarkt HTML because of CORS.",
    "Argentina": "Argentina",
    "Austria": "Austria",
    "Belgium": "Belgium",
    "Brazil": "Brazil",
    "Croatia": "Croatia",
    "Czech Republic": "Czech Republic",
    "Denmark": "Denmark",
    "England": "England",
    "France": "France",
    "Germany": "Germany",
    "Ghana": "Ghana",
    "Hungary": "Hungary",
    "Italy": "Italy",
    "Netherlands": "Netherlands",
    "Norway": "Norway",
    "Poland": "Poland",
    "Portugal": "Portugal",
    "Romania": "Romania",
    "Scotland": "Scotland",
    "Serbia": "Serbia",
    "Slovakia": "Slovakia",
    "Slovenia": "Slovenia",
    "Spain": "Spain",
    "Sweden": "Sweden",
    "Switzerland": "Switzerland",
    "Turkey": "Turkey",
    "Ukraine": "Ukraine",
    "Uruguay": "Uruguay",
    "United States": "United States",
    "TM Scout V2 panel": "TM Scout V2 panel",
    "Contract nemzetiségek / source szűkítés": "Contract nationalities / source narrowing",
    "Contract nemzetiségek": "Contract nationalities",
    "Source szűkítés": "Source narrowing",
    "Lista": "List",
    "Left Winger": "Left winger",
    "Right Winger": "Right winger",
    "Winger": "Winger",
    "CF/ST": "CF/ST",
    "DEF": "DEF",
    "MID": "MID",
    "FWD": "FWD",
    "GK": "GK",
    "CB": "CB",
    "LB": "LB",
    "RB": "RB",
    "DM": "DM",
    "CM": "CM",
    "AM": "AM",
    "LM": "LM",
    "RM": "RM",
    "SS": "SS",
    "Klub / csapat": "Club / team",
    "Contract mód: csak lejáró/free agent menü; U21 prospect szűrők elrejtve.": "Contract mode: only contract/free-agent settings are shown; U21 prospect filters are hidden.",
    "U21 mód: életkor + MV + játszott meccsarány + MV-változás. Nem kell lejáró szerződés.": "U21 mode: age + MV + played-match ratio + MV change. Contract expiry is not required.",
    "Játékoslisták feldolgozása...": "Processing player lists...",
    "Nincs találat az alap szűrők után. Emeld a max oldalszámot vagy lazíts a szűrőkön.": "No results after the basic filters. Raise the max page count or loosen the filters.",
    "Részletes adatok lekérése": "Fetching detailed data",
    "találat": "results",
    "vizsgált játékos": "players checked",
    "játékos": "players",
    "oldal": "pages",
    "elem": "items",
    "Forrásoldal": "Source page",
    "Nincs source URL. Legalább egy Transfermarkt forrás kell.": "No source URL. At least one Transfermarkt source is required.",
    "A TM Scout V2 betölt...": "TM Scout V2 is loading...",
    "Ehhez az apphoz JavaScript kell.": "This app requires JavaScript.",
    "Lejáró szerződéses játékosok és U21 prospectek keresése.": "Find contract-expiring players and U21 prospects.",
    "pl. DAC 1904, APOEL vagy 829": "e.g. DAC 1904, APOEL or 829",
    "English": "English",
    "Română": "Romanian",
    "TM Scout V2": "TM Scout V2",
    "Letöltés": "Download",
    "Megnyitás új ablakban": "Open in new window",
    "Másolás": "Copy",
    "Másolva": "Copied",
    "Mégse": "Cancel",
    "Igen": "Yes",
    "Nem": "No",
    "Ismeretlen": "Unknown",
    "ismeretlen": "unknown",
    "Nincs MV history": "No MV history",
    "MV history hiányzik": "MV history missing",
    "Aktuális MV": "Current MV",
    "Free agent": "Free agent",
    "Nem free agent": "Non-free agent",
    "Aktív klub": "Active club",
    "Nincs adat": "No data",
    "Nincs": "None",
    "összes": "all",
    "perc": "minutes",
    "meccs": "apps"
  },
  "ro": {
    "Transfermarkt Scout": "Transfermarkt Scout",
    "Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.": "Caută jucători cu contracte aproape de final și prospecte U21 într-un singur loc.",
    "Nyelv": "Limbă",
    "Felület nyelve": "Limba interfeței",
    "Magyar": "Maghiară",
    "Angol": "Engleză",
    "Román": "Română",
    "Scout mód": "Mod scout",
    "Mód": "Mod",
    "Lejáró szerződés / free agent": "Contract pe final / jucător liber",
    "U21 prospect": "Prospect U21",
    "Alapszűrők": "Filtre de bază",
    "Min MV": "Valoare minimă",
    "Max MV": "Valoare maximă",
    "Min age": "Vârstă minimă",
    "Max age": "Vârstă maximă",
    "MV reference date": "Data de referință MV",
    "Max MV drop %": "Scădere MV maximă %",
    "Contract year": "An contract",
    "Szerződés lejárati éve": "Anul expirării contractului",
    "Játékidő + szezonok": "Minute + sezoane",
    "Min minutes / season": "Minute minime / sezon",
    "Min apps / season": "Apariții minime / sezon",
    "Vizsgált szezonok": "Sezoane analizate",
    "Auto": "Auto",
    "1 szezon": "1 sezon",
    "2 szezon": "2 sezoane",
    "3 szezon": "3 sezoane",
    "Szezon szabály": "Regulă sezon",
    "Apps vagy perc": "Apariții sau minute",
    "Apps és perc": "Apariții și minute",
    "Minden kiválasztott szezon menjen át": "Fiecare sezon selectat trebuie să treacă",
    "Max oldalak": "Pagini maxime",
    "Max játékosjelöltek": "Candidați maximi",
    "Poszt-szűrés módja": "Mod filtrare posturi",
    "Posztszűrés": "Filtru post",
    "Tág posztcsoportok": "Grupe largi de posturi",
    "Precíz posztok": "Posturi exacte",
    "Posztcsoportok": "Grupe de posturi",
    "Részletes posztok": "Posturi detaliate",
    "Other/unknown": "Altul/necunoscut",
    "U21 prospect szűrők": "Filtre prospect U21",
    "U21 min age": "Vârstă minimă U21",
    "U21 max age": "Vârstă maximă U21",
    "U21 min MV": "MV minim U21",
    "U21 max MV": "MV maxim U21",
    "Min játszott meccsarány %": "Procent minim meciuri jucate %",
    "Nemzetiségek, opcionális multiple choice": "Naționalități, selecție multiplă opțională",
    "U21 oldalak": "Pagini U21",
    "U21 max játékosjelöltek": "Candidați U21 maximi",
    "Források": "Surse",
    "Első osztályú európai ligák": "Prime ligi europene",
    "Jobb ligák 2–3. osztályai is": "Și ligi puternice de nivel 2–3",
    "Alsóbb osztály mélység": "Adâncime ligi inferioare",
    "Csak 2. osztály": "Doar liga a 2-a",
    "2–3. osztály": "Liga a 2-a–a 3-a",
    "Aktuális free agentek is (alapból ON)": "Include jucători liberi actuali (implicit ON)",
    "Jövőbeli igazolással rendelkezők kizárása": "Exclude jucătorii cu transfer viitor",
    "Saját csapat kizárása": "Exclude propria echipă",
    "Saját csapat név vagy TM club ID": "Numele echipei proprii sau ID club TM",
    "Saját csapat időablak": "Interval pentru propria echipă",
    "Utolsó szezon": "Ultimul sezon",
    "Kiválasztott szezonok": "Sezoanele selectate",
    "Keresés": "Căutare",
    "HTML letöltés": "Descarcă HTML",
    "HTML nézet megnyitása": "Deschide vizualizarea HTML",
    "Megnyitás": "Deschide",
    "Oké": "OK",
    "Hoppá": "Ups",
    "HTML nézet": "Vizualizare HTML",
    "Nincs exportálható találat. Előbb futtasd a keresést.": "Nu există rezultate exportabile. Rulează mai întâi căutarea.",
    "CSV export": "Export CSV",
    "JSON export": "Export JSON",
    "Cache törlés": "Șterge cache",
    "Készen áll.": "Gata.",
    "Találatok": "Rezultate",
    "Vizsgált játékosok": "Jucători analizați",
    "Ellenőrizve": "Verificați",
    "Játékos": "Jucător",
    "Poszt": "Post",
    "Kor": "Vârstă",
    "Nemzetiség": "Naționalitate",
    "Elérhetőség": "Disponibilitate",
    "Klub / utolsó klub": "Club / ultimul club",
    "MV most": "MV actual",
    "MV változás": "Schimbare MV",
    "Játékidő": "Minute jucate",
    "Utolsó szezonok": "Sezoane recente",
    "Forrás": "Sursă",
    "TM profil": "Profil TM",
    "Profil": "Profil",
    "U21 score": "Scor U21",
    "Klubkörnyezet": "Mediu de club",
    "Játszott meccsarány": "Procent meciuri jucate",
    "Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.": "Nu există rezultate încă. Fie filtrele sunt prea stricte, fie Transfermarkt face figuri.",
    "Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.": "Nu există rezultate U21 încă. Relaxează procentul de meciuri / filtrul MV / vârsta / postul / naționalitatea sau crește numărul maxim de pagini.",
    "Összecsukás": "Restrânge",
    "Kinyitás": "Extinde",
    "Bezárás": "Închide",
    "Cache törölve": "Cache șters",
    "Forrásoldalak előkészítése...": "Pregătesc paginile sursă...",
    "U21 forrásoldalak előkészítése...": "Pregătesc paginile sursă U21...",
    "Forrásoldalak letöltése": "Descarc paginile sursă",
    "Source táblázatok parse-olása...": "Analizez tabelele sursă...",
    "Profil enrich indul": "Începe completarea profilurilor",
    "Kész": "Gata",
    "Hiba": "Eroare",
    "A Cloudflare Worker proxy nincs beállítva a kódban. Ellenőrizd a TM_SCOUT_PROXY_ENDPOINT értékét az assets/tm-scout-v2-app.js fájl elején.": "Nu este setat URL-ul proxy Cloudflare Worker. Adaugă URL-ul proxy sus, altfel frontendul GitHub Pages nu poate citi HTML-ul Transfermarkt din cauza CORS.",
    "Argentina": "Argentina",
    "Austria": "Austria",
    "Belgium": "Belgia",
    "Brazil": "Brazilia",
    "Croatia": "Croația",
    "Czech Republic": "Cehia",
    "Denmark": "Danemarca",
    "England": "Anglia",
    "France": "Franța",
    "Germany": "Germania",
    "Ghana": "Ghana",
    "Hungary": "Ungaria",
    "Italy": "Italia",
    "Netherlands": "Țările de Jos",
    "Norway": "Norvegia",
    "Poland": "Polonia",
    "Portugal": "Portugalia",
    "Romania": "România",
    "Scotland": "Scoția",
    "Serbia": "Serbia",
    "Slovakia": "Slovacia",
    "Slovenia": "Slovenia",
    "Spain": "Spania",
    "Sweden": "Suedia",
    "Switzerland": "Elveția",
    "Turkey": "Turcia",
    "Ukraine": "Ucraina",
    "Uruguay": "Uruguay",
    "United States": "Statele Unite",
    "TM Scout V2 panel": "Panou TM Scout V2",
    "Contract nemzetiségek / source szűkítés": "Naționalități contract / restrângere surse",
    "Contract nemzetiségek": "Naționalități contract",
    "Source szűkítés": "Restrângere surse",
    "Lista": "Listă",
    "Left Winger": "Extremă stângă",
    "Right Winger": "Extremă dreaptă",
    "Winger": "Extremă",
    "CF/ST": "CF/ST",
    "DEF": "DEF",
    "MID": "MID",
    "FWD": "FWD",
    "GK": "GK",
    "CB": "CB",
    "LB": "LB",
    "RB": "RB",
    "DM": "DM",
    "CM": "CM",
    "AM": "AM",
    "LM": "LM",
    "RM": "RM",
    "SS": "SS",
    "Klub / csapat": "Club / echipă",
    "Contract mód: csak lejáró/free agent menü; U21 prospect szűrők elrejtve.": "Mod contract: sunt afișate doar setările contract/jucător liber; filtrele U21 sunt ascunse.",
    "U21 mód: életkor + MV + játszott meccsarány + MV-változás. Nem kell lejáró szerződés.": "Mod U21: vârstă + MV + procent meciuri jucate + schimbare MV. Nu este necesară expirarea contractului.",
    "Játékoslisták feldolgozása...": "Procesez listele de jucători...",
    "Nincs találat az alap szűrők után. Emeld a max oldalszámot vagy lazíts a szűrőkön.": "Nu există rezultate după filtrele de bază. Mărește numărul maxim de pagini sau relaxează filtrele.",
    "Részletes adatok lekérése": "Preiau date detaliate",
    "találat": "rezultate",
    "vizsgált játékos": "jucători analizați",
    "játékos": "jucători",
    "oldal": "pagini",
    "elem": "elemente",
    "Forrásoldal": "Pagină sursă",
    "Nincs source URL. Legalább egy Transfermarkt forrás kell.": "Nu există URL sursă. Este necesară cel puțin o sursă Transfermarkt.",
    "A TM Scout V2 betölt...": "TM Scout V2 se încarcă...",
    "Ehhez az apphoz JavaScript kell.": "Această aplicație necesită JavaScript.",
    "Lejáró szerződéses játékosok és U21 prospectek keresése.": "Caută jucători cu contracte aproape de final și prospecte U21.",
    "pl. DAC 1904, APOEL vagy 829": "ex. DAC 1904, APOEL sau 829",
    "English": "Engleză",
    "Română": "Română",
    "TM Scout V2": "TM Scout V2",
    "Letöltés": "Descarcă",
    "Megnyitás új ablakban": "Deschide în fereastră nouă",
    "Másolás": "Copiază",
    "Másolva": "Copiat",
    "Mégse": "Anulează",
    "Igen": "Da",
    "Nem": "Nu",
    "Ismeretlen": "Necunoscut",
    "ismeretlen": "necunoscut",
    "Nincs MV history": "Fără istoric MV",
    "MV history hiányzik": "Istoricul MV lipsește",
    "Aktuális MV": "MV actual",
    "Free agent": "Jucător liber",
    "Nem free agent": "Nu este jucător liber",
    "Aktív klub": "Club activ",
    "Nincs adat": "Nu există date",
    "Nincs": "Niciunul",
    "összes": "toate",
    "perc": "minute",
    "meccs": "meciuri"
  }
});

  function normalizeUiLanguage(value) {
    const lang = String(value || '').toLowerCase();
    return lang === 'en' || lang === 'ro' ? lang : 'hu';
  }

  function currentUiLanguage() {
    return normalizeUiLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'hu');
  }


  // fast-i18n-v18: build the expensive translation lookup tables once.
  // Previous builds rebuilt the reverse dictionary for almost every text node,
  // which made language switching feel sticky on mobile once the country list and
  // result/export texts grew large.
  const i18nFastCache = {
    canonicalMap: null,
    reverseEntries: null,
    entriesByLang: Object.create(null)
  };

  function getCanonicalI18nMap() {
    if (i18nFastCache.canonicalMap) return i18nFastCache.canonicalMap;
    const map = new Map();
    Object.values(I18N || {}).forEach(function collectDict(dict) {
      Object.entries(dict || {}).forEach(function collectEntry(entry) {
        const key = String(entry[0] || '').trim();
        const value = String(entry[1] || '').trim();
        if (key) map.set(key, key);
        if (value) map.set(value, key);
      });
    });
    i18nFastCache.canonicalMap = map;
    return map;
  }

  function getReverseI18nEntries() {
    if (i18nFastCache.reverseEntries) return i18nFastCache.reverseEntries;
    const seen = new Set();
    const entries = [];
    Object.values(I18N || {}).forEach(function collectReverse(dict) {
      Object.entries(dict || {}).forEach(function pushEntry(entry) {
        const key = String(entry[0] || '');
        const value = String(entry[1] || '');
        const id = value + ' ' + key;
        if (!key || !value || key === value || value.length < 3 || seen.has(id)) return;
        seen.add(id);
        entries.push([value, key]);
      });
    });
    entries.sort(function byLength(a, b) { return b[0].length - a[0].length; });
    i18nFastCache.reverseEntries = entries;
    return entries;
  }

  function getI18nEntriesForLanguage(lang) {
    const normalized = normalizeUiLanguage(lang);
    if (i18nFastCache.entriesByLang[normalized]) return i18nFastCache.entriesByLang[normalized];
    const dict = I18N[normalized] || I18N.hu || {};
    const entries = Object.entries(dict).sort(function byLength(a, b) { return b[0].length - a[0].length; });
    i18nFastCache.entriesByLang[normalized] = entries;
    return entries;
  }

  function canonicalI18nKey(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    return getCanonicalI18nMap().get(raw) || raw;
  }

  function tx(text) {
    const key = canonicalI18nKey(text);
    const lang = currentUiLanguage();
    const dict = I18N[lang] || I18N.hu || {};
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  }

  function normalizeRuntimeTextToCanonical(text) {
    let out = String(text || '');
    getReverseI18nEntries().forEach(function replaceTranslated(entry) {
      out = out.split(entry[0]).join(entry[1]);
    });
    return out;
  }

  function translateRuntimeText(text) {
    const lang = currentUiLanguage();
    const dict = I18N[lang] || I18N.hu || {};
    let out = normalizeRuntimeTextToCanonical(text);
    const exactKey = canonicalI18nKey(out);
    if (Object.prototype.hasOwnProperty.call(dict, exactKey)) return dict[exactKey];

    const entries = getI18nEntriesForLanguage(lang);
    for (const [hu, translated] of entries) {
      if (!hu || translated == null || hu.length < 3) continue;
      out = out.split(hu).join(String(translated));
    }
    return out;
  }

  function translateTextNodeValue(value) {
    const raw = String(value || '');
    const match = raw.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2]) return raw;
    const translated = translateRuntimeText(match[2]);
    return match[1] + translated + match[3];
  }

  function localizeRoot(root) {
    const scope = root || document;
    const lang = currentUiLanguage();
    try { document.documentElement.lang = lang; } catch (_error) {}
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (/^(SCRIPT|STYLE|TEXTAREA)$/i.test(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.closest && parent.closest('[data-role="results"], [data-nationality-picker], .tm-scout-v2-nationality-picker, select.tm-scout-v2-multi-select')) return NodeFilter.FILTER_REJECT;
        if (!String(node.nodeValue || '').trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function translateNode(node) {
      const next = translateTextNodeValue(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
    ['placeholder', 'aria-label', 'title', 'alt'].forEach(function translateAttribute(attr) {
      Array.from(scope.querySelectorAll ? scope.querySelectorAll('[' + attr + ']') : []).forEach(function translateAttr(el) {
        const raw = el.getAttribute(attr);
        if (!raw) return;
        const next = translateRuntimeText(raw);
        if (next) el.setAttribute(attr, next);
      });
    });
    Array.from(scope.querySelectorAll ? scope.querySelectorAll('select[name="uiLanguage"], #tmLangSelect') : []).forEach(function syncSelect(sel) {
      sel.value = lang;
    });
  }

  function setUiLanguage(lang) {
    const normalized = normalizeUiLanguage(lang);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    try { document.documentElement.lang = normalized; } catch (_error) {}

    const panel = document.getElementById(APP.panelId);
    if (panel) {
      setScoutModeUi(panel, state.settings.scoutMode || DEFAULTS.scoutMode);
      setPositionModeUi(panel, state.settings.positionFilterMode || DEFAULTS.positionFilterMode);

      // fast-i18n-v18: avoid walking the whole document and avoid rebuilding every
      // result row. Translate the static panel, update nationality labels, headers,
      // stats and language-sensitive result cells in-place.
      localizeRoot(panel);
      updateNationalitySelectLabels(panel);
      renderStats(panel);
      refreshRenderedResultsLanguage(panel, state.results || []);
      setLastKnownStatusLanguage(panel);
    }

    try { window.dispatchEvent(new CustomEvent('tmScoutV2LanguageApplied', { detail: { language: normalized } })); } catch (_error) {}
  }

  window.tmScoutSetLanguage = setUiLanguage;
  window.addEventListener('tmScoutV2LanguageChange', function onExternalLanguageChange(event) {
    setUiLanguage(event && event.detail ? event.detail.language : currentUiLanguage());
  });


  const COUNTRY_CATALOG = Object.freeze([{"key":"Afghanistan","alpha2":"AF","en":"Afghanistan","hu":"Afganisztán","ro":"Afganistan","aliases":["Islamic Republic of Afghanistan"],"europe":false},{"key":"Albania","alpha2":"AL","en":"Albania","hu":"Albánia","ro":"Albania","aliases":["Republic of Albania"],"europe":true},{"key":"Algeria","alpha2":"DZ","en":"Algeria","hu":"Algéria","ro":"Algeria","aliases":["People's Democratic Republic of Algeria"],"europe":false},{"key":"American Samoa","alpha2":"AS","en":"American Samoa","hu":"Amerikai Szamoa","ro":"Samoa Americană","aliases":[],"europe":false},{"key":"Andorra","alpha2":"AD","en":"Andorra","hu":"Andorra","ro":"Andorra","aliases":["Principality of Andorra"],"europe":true},{"key":"Angola","alpha2":"AO","en":"Angola","hu":"Angola","ro":"Angola","aliases":["Republic of Angola"],"europe":false},{"key":"Anguilla","alpha2":"AI","en":"Anguilla","hu":"Anguilla","ro":"Anguilla","aliases":[],"europe":false},{"key":"Antarctica","alpha2":"AQ","en":"Antarctica","hu":"Antarktisz","ro":"Antarctica","aliases":[],"europe":false},{"key":"Antigua & Barbuda","alpha2":"AG","en":"Antigua & Barbuda","hu":"Antigua és Barbuda","ro":"Antigua și Barbuda","aliases":["Antigua and Barbuda"],"europe":false},{"key":"Argentina","alpha2":"AR","en":"Argentina","hu":"Argentína","ro":"Argentina","aliases":["Argentine Republic"],"europe":false},{"key":"Armenia","alpha2":"AM","en":"Armenia","hu":"Örményország","ro":"Armenia","aliases":["Republic of Armenia"],"europe":true},{"key":"Aruba","alpha2":"AW","en":"Aruba","hu":"Aruba","ro":"Aruba","aliases":[],"europe":false},{"key":"Australia","alpha2":"AU","en":"Australia","hu":"Ausztrália","ro":"Australia","aliases":[],"europe":false},{"key":"Austria","alpha2":"AT","en":"Austria","hu":"Ausztria","ro":"Austria","aliases":["Republic of Austria"],"europe":true},{"key":"Azerbaijan","alpha2":"AZ","en":"Azerbaijan","hu":"Azerbajdzsán","ro":"Azerbaidjan","aliases":["Republic of Azerbaijan"],"europe":true},{"key":"Bahamas","alpha2":"BS","en":"Bahamas","hu":"Bahama-szigetek","ro":"Bahamas","aliases":["Commonwealth of the Bahamas"],"europe":false},{"key":"Bahrain","alpha2":"BH","en":"Bahrain","hu":"Bahrein","ro":"Bahrain","aliases":["Kingdom of Bahrain"],"europe":false},{"key":"Bangladesh","alpha2":"BD","en":"Bangladesh","hu":"Banglades","ro":"Bangladesh","aliases":["People's Republic of Bangladesh"],"europe":false},{"key":"Barbados","alpha2":"BB","en":"Barbados","hu":"Barbados","ro":"Barbados","aliases":[],"europe":false},{"key":"Belarus","alpha2":"BY","en":"Belarus","hu":"Belarusz","ro":"Belarus","aliases":["Republic of Belarus"],"europe":true},{"key":"Belgium","alpha2":"BE","en":"Belgium","hu":"Belgium","ro":"Belgia","aliases":["Kingdom of Belgium"],"europe":true},{"key":"Belize","alpha2":"BZ","en":"Belize","hu":"Belize","ro":"Belize","aliases":[],"europe":false},{"key":"Benin","alpha2":"BJ","en":"Benin","hu":"Benin","ro":"Benin","aliases":["Republic of Benin"],"europe":false},{"key":"Bermuda","alpha2":"BM","en":"Bermuda","hu":"Bermuda","ro":"Bermuda","aliases":[],"europe":false},{"key":"Bhutan","alpha2":"BT","en":"Bhutan","hu":"Bhután","ro":"Bhutan","aliases":["Kingdom of Bhutan"],"europe":false},{"key":"Bolivia","alpha2":"BO","en":"Bolivia","hu":"Bolívia","ro":"Bolivia","aliases":["Bolivia","Bolivia, Plurinational State of","Plurinational State of Bolivia"],"europe":false},{"key":"Bosnia & Herzegovina","alpha2":"BA","en":"Bosnia & Herzegovina","hu":"Bosznia-Hercegovina","ro":"Bosnia și Herțegovina","aliases":["Bosnia and Herzegovina","Republic of Bosnia and Herzegovina"],"europe":true},{"key":"Botswana","alpha2":"BW","en":"Botswana","hu":"Botswana","ro":"Botswana","aliases":["Republic of Botswana"],"europe":false},{"key":"Bouvet Island","alpha2":"BV","en":"Bouvet Island","hu":"Bouvet-sziget","ro":"Insula Bouvet","aliases":[],"europe":false},{"key":"Brazil","alpha2":"BR","en":"Brazil","hu":"Brazília","ro":"Brazilia","aliases":["Federative Republic of Brazil"],"europe":false},{"key":"British Indian Ocean Territory","alpha2":"IO","en":"British Indian Ocean Territory","hu":"Brit Indiai-óceáni Terület","ro":"Teritoriul Britanic din Oceanul Indian","aliases":[],"europe":false},{"key":"British Virgin Islands","alpha2":"VG","en":"British Virgin Islands","hu":"Brit Virgin-szigetek","ro":"Insulele Virgine Britanice","aliases":["Virgin Islands, British"],"europe":false},{"key":"Brunei","alpha2":"BN","en":"Brunei","hu":"Brunei","ro":"Brunei","aliases":["Brunei Darussalam"],"europe":false},{"key":"Bulgaria","alpha2":"BG","en":"Bulgaria","hu":"Bulgária","ro":"Bulgaria","aliases":["Republic of Bulgaria"],"europe":true},{"key":"Burkina Faso","alpha2":"BF","en":"Burkina Faso","hu":"Burkina Faso","ro":"Burkina Faso","aliases":[],"europe":false},{"key":"Burundi","alpha2":"BI","en":"Burundi","hu":"Burundi","ro":"Burundi","aliases":["Republic of Burundi"],"europe":false},{"key":"Cambodia","alpha2":"KH","en":"Cambodia","hu":"Kambodzsa","ro":"Cambodgia","aliases":["Kingdom of Cambodia"],"europe":false},{"key":"Cameroon","alpha2":"CM","en":"Cameroon","hu":"Kamerun","ro":"Camerun","aliases":["Republic of Cameroon"],"europe":false},{"key":"Canada","alpha2":"CA","en":"Canada","hu":"Kanada","ro":"Canada","aliases":[],"europe":false},{"key":"Cape Verde","alpha2":"CV","en":"Cape Verde","hu":"Zöld-foki Köztársaság","ro":"Capul Verde","aliases":["Cabo Verde","Cape Verde","Republic of Cabo Verde"],"europe":false},{"key":"Caribbean Netherlands","alpha2":"BQ","en":"Caribbean Netherlands","hu":"Holland Karib-térség","ro":"Insulele Caraibe Olandeze","aliases":["Bonaire, Sint Eustatius and Saba"],"europe":false},{"key":"Cayman Islands","alpha2":"KY","en":"Cayman Islands","hu":"Kajmán-szigetek","ro":"Insulele Cayman","aliases":[],"europe":false},{"key":"Central African Republic","alpha2":"CF","en":"Central African Republic","hu":"Közép-afrikai Köztársaság","ro":"Republica Centrafricană","aliases":[],"europe":false},{"key":"Chad","alpha2":"TD","en":"Chad","hu":"Csád","ro":"Ciad","aliases":["Republic of Chad"],"europe":false},{"key":"Chile","alpha2":"CL","en":"Chile","hu":"Chile","ro":"Chile","aliases":["Republic of Chile"],"europe":false},{"key":"China","alpha2":"CN","en":"China","hu":"Kína","ro":"China","aliases":["People's Republic of China"],"europe":false},{"key":"Chinese Taipei","alpha2":"TW-FA","en":"Chinese Taipei","hu":"Kínai Tajpej","ro":"Taipeiul Chinezesc","aliases":["Taiwan"],"europe":false},{"key":"Christmas Island","alpha2":"CX","en":"Christmas Island","hu":"Karácsony-sziget","ro":"Insula Christmas","aliases":[],"europe":false},{"key":"Cocos (Keeling) Islands","alpha2":"CC","en":"Cocos (Keeling) Islands","hu":"Kókusz (Keeling)-szigetek","ro":"Insulele Cocos (Keeling)","aliases":[],"europe":false},{"key":"Colombia","alpha2":"CO","en":"Colombia","hu":"Kolumbia","ro":"Columbia","aliases":["Republic of Colombia"],"europe":false},{"key":"Comoros","alpha2":"KM","en":"Comoros","hu":"Comore-szigetek","ro":"Comore","aliases":["Union of the Comoros"],"europe":false},{"key":"Congo - Brazzaville","alpha2":"CG","en":"Congo - Brazzaville","hu":"Kongó – Brazzaville","ro":"Congo - Brazzaville","aliases":["Congo","Republic of the Congo"],"europe":false},{"key":"Congo - Kinshasa","alpha2":"CD","en":"Congo - Kinshasa","hu":"Kongó – Kinshasa","ro":"Congo - Kinshasa","aliases":["Congo, The Democratic Republic of the","DR Congo","Democratic Republic of the Congo"],"europe":false},{"key":"Cook Islands","alpha2":"CK","en":"Cook Islands","hu":"Cook-szigetek","ro":"Insulele Cook","aliases":[],"europe":false},{"key":"Costa Rica","alpha2":"CR","en":"Costa Rica","hu":"Costa Rica","ro":"Costa Rica","aliases":["Republic of Costa Rica"],"europe":false},{"key":"Croatia","alpha2":"HR","en":"Croatia","hu":"Horvátország","ro":"Croația","aliases":["Republic of Croatia"],"europe":true},{"key":"Cuba","alpha2":"CU","en":"Cuba","hu":"Kuba","ro":"Cuba","aliases":["Republic of Cuba"],"europe":false},{"key":"Curaçao","alpha2":"CW","en":"Curaçao","hu":"Curaçao","ro":"Curaçao","aliases":[],"europe":false},{"key":"Cyprus","alpha2":"CY","en":"Cyprus","hu":"Ciprus","ro":"Cipru","aliases":["Republic of Cyprus"],"europe":true},{"key":"Czech Republic","alpha2":"CZ","en":"Czech Republic","hu":"Csehország","ro":"Cehia","aliases":["Czech Republic","Czechia"],"europe":true},{"key":"Côte d’Ivoire","alpha2":"CI","en":"Côte d’Ivoire","hu":"Elefántcsontpart","ro":"Côte d’Ivoire","aliases":["Cote d'Ivoire","Côte d'Ivoire","Ivory Coast","Republic of Côte d'Ivoire"],"europe":false},{"key":"Denmark","alpha2":"DK","en":"Denmark","hu":"Dánia","ro":"Danemarca","aliases":["Kingdom of Denmark"],"europe":true},{"key":"Djibouti","alpha2":"DJ","en":"Djibouti","hu":"Dzsibuti","ro":"Djibouti","aliases":["Republic of Djibouti"],"europe":false},{"key":"Dominica","alpha2":"DM","en":"Dominica","hu":"Dominika","ro":"Dominica","aliases":["Commonwealth of Dominica"],"europe":false},{"key":"Dominican Republic","alpha2":"DO","en":"Dominican Republic","hu":"Dominikai Köztársaság","ro":"Republica Dominicană","aliases":[],"europe":false},{"key":"Ecuador","alpha2":"EC","en":"Ecuador","hu":"Ecuador","ro":"Ecuador","aliases":["Republic of Ecuador"],"europe":false},{"key":"Egypt","alpha2":"EG","en":"Egypt","hu":"Egyiptom","ro":"Egipt","aliases":["Arab Republic of Egypt"],"europe":false},{"key":"El Salvador","alpha2":"SV","en":"El Salvador","hu":"Salvador","ro":"El Salvador","aliases":["Republic of El Salvador"],"europe":false},{"key":"England","alpha2":"GB-ENG","en":"England","hu":"Anglia","ro":"Anglia","aliases":["ENG"],"europe":true},{"key":"Equatorial Guinea","alpha2":"GQ","en":"Equatorial Guinea","hu":"Egyenlítői-Guinea","ro":"Guineea Ecuatorială","aliases":["Republic of Equatorial Guinea"],"europe":false},{"key":"Eritrea","alpha2":"ER","en":"Eritrea","hu":"Eritrea","ro":"Eritreea","aliases":["the State of Eritrea"],"europe":false},{"key":"Estonia","alpha2":"EE","en":"Estonia","hu":"Észtország","ro":"Estonia","aliases":["Republic of Estonia"],"europe":true},{"key":"Eswatini","alpha2":"SZ","en":"Eswatini","hu":"Szváziföld","ro":"Eswatini","aliases":["Kingdom of Eswatini","Swaziland"],"europe":false},{"key":"Ethiopia","alpha2":"ET","en":"Ethiopia","hu":"Etiópia","ro":"Etiopia","aliases":["Federal Democratic Republic of Ethiopia"],"europe":false},{"key":"Falkland Islands","alpha2":"FK","en":"Falkland Islands","hu":"Falkland-szigetek","ro":"Insulele Falkland","aliases":["Falkland Islands (Malvinas)"],"europe":false},{"key":"Faroe Islands","alpha2":"FO","en":"Faroe Islands","hu":"Feröer szigetek","ro":"Insulele Feroe","aliases":[],"europe":false},{"key":"Fiji","alpha2":"FJ","en":"Fiji","hu":"Fidzsi","ro":"Fiji","aliases":["Republic of Fiji"],"europe":false},{"key":"Finland","alpha2":"FI","en":"Finland","hu":"Finnország","ro":"Finlanda","aliases":["Republic of Finland"],"europe":true},{"key":"France","alpha2":"FR","en":"France","hu":"Franciaország","ro":"Franța","aliases":["French Republic"],"europe":true},{"key":"French Guiana","alpha2":"GF","en":"French Guiana","hu":"Francia Guyana","ro":"Guyana Franceză","aliases":[],"europe":false},{"key":"French Polynesia","alpha2":"PF","en":"French Polynesia","hu":"Francia Polinézia","ro":"Polinezia Franceză","aliases":[],"europe":false},{"key":"French Southern Territories","alpha2":"TF","en":"French Southern Territories","hu":"Francia Déli Területek","ro":"Teritoriile Australe și Antarctice Franceze","aliases":[],"europe":false},{"key":"Gabon","alpha2":"GA","en":"Gabon","hu":"Gabon","ro":"Gabon","aliases":["Gabonese Republic"],"europe":false},{"key":"Gambia","alpha2":"GM","en":"Gambia","hu":"Gambia","ro":"Gambia","aliases":["Republic of the Gambia"],"europe":false},{"key":"Georgia","alpha2":"GE","en":"Georgia","hu":"Grúzia","ro":"Georgia","aliases":[],"europe":true},{"key":"Germany","alpha2":"DE","en":"Germany","hu":"Németország","ro":"Germania","aliases":["Federal Republic of Germany"],"europe":true},{"key":"Ghana","alpha2":"GH","en":"Ghana","hu":"Ghána","ro":"Ghana","aliases":["Republic of Ghana"],"europe":false},{"key":"Gibraltar","alpha2":"GI","en":"Gibraltar","hu":"Gibraltár","ro":"Gibraltar","aliases":[],"europe":false},{"key":"Greece","alpha2":"GR","en":"Greece","hu":"Görögország","ro":"Grecia","aliases":["Hellenic Republic"],"europe":true},{"key":"Greenland","alpha2":"GL","en":"Greenland","hu":"Grönland","ro":"Groenlanda","aliases":[],"europe":false},{"key":"Grenada","alpha2":"GD","en":"Grenada","hu":"Grenada","ro":"Grenada","aliases":[],"europe":false},{"key":"Guadeloupe","alpha2":"GP","en":"Guadeloupe","hu":"Guadeloupe","ro":"Guadelupa","aliases":[],"europe":false},{"key":"Guam","alpha2":"GU","en":"Guam","hu":"Guam","ro":"Guam","aliases":[],"europe":false},{"key":"Guatemala","alpha2":"GT","en":"Guatemala","hu":"Guatemala","ro":"Guatemala","aliases":["Republic of Guatemala"],"europe":false},{"key":"Guernsey","alpha2":"GG","en":"Guernsey","hu":"Guernsey","ro":"Guernsey","aliases":[],"europe":false},{"key":"Guinea","alpha2":"GN","en":"Guinea","hu":"Guinea","ro":"Guineea","aliases":["Republic of Guinea"],"europe":false},{"key":"Guinea-Bissau","alpha2":"GW","en":"Guinea-Bissau","hu":"Bissau-Guinea","ro":"Guineea-Bissau","aliases":["Republic of Guinea-Bissau"],"europe":false},{"key":"Guyana","alpha2":"GY","en":"Guyana","hu":"Guyana","ro":"Guyana","aliases":["Republic of Guyana"],"europe":false},{"key":"Haiti","alpha2":"HT","en":"Haiti","hu":"Haiti","ro":"Haiti","aliases":["Republic of Haiti"],"europe":false},{"key":"Heard & McDonald Islands","alpha2":"HM","en":"Heard & McDonald Islands","hu":"Heard-sziget és McDonald-szigetek","ro":"Insula Heard și Insulele McDonald","aliases":["Heard Island and McDonald Islands"],"europe":false},{"key":"Honduras","alpha2":"HN","en":"Honduras","hu":"Honduras","ro":"Honduras","aliases":["Republic of Honduras"],"europe":false},{"key":"Hong Kong SAR China","alpha2":"HK","en":"Hong Kong SAR China","hu":"Hongkong KKT","ro":"R.A.S. Hong Kong, China","aliases":["Hong Kong","Hong Kong Special Administrative Region of China"],"europe":false},{"key":"Hungary","alpha2":"HU","en":"Hungary","hu":"Magyarország","ro":"Ungaria","aliases":[],"europe":true},{"key":"Iceland","alpha2":"IS","en":"Iceland","hu":"Izland","ro":"Islanda","aliases":["Republic of Iceland"],"europe":true},{"key":"India","alpha2":"IN","en":"India","hu":"India","ro":"India","aliases":["Republic of India"],"europe":false},{"key":"Indonesia","alpha2":"ID","en":"Indonesia","hu":"Indonézia","ro":"Indonezia","aliases":["Republic of Indonesia"],"europe":false},{"key":"Iran","alpha2":"IR","en":"Iran","hu":"Irán","ro":"Iran","aliases":["Iran","Iran, Islamic Republic of","Islamic Republic of Iran"],"europe":false},{"key":"Iraq","alpha2":"IQ","en":"Iraq","hu":"Irak","ro":"Irak","aliases":["Republic of Iraq"],"europe":false},{"key":"Ireland","alpha2":"IE","en":"Ireland","hu":"Írország","ro":"Irlanda","aliases":[],"europe":true},{"key":"Isle of Man","alpha2":"IM","en":"Isle of Man","hu":"Man-sziget","ro":"Insula Man","aliases":[],"europe":false},{"key":"Israel","alpha2":"IL","en":"Israel","hu":"Izrael","ro":"Israel","aliases":["State of Israel"],"europe":false},{"key":"Italy","alpha2":"IT","en":"Italy","hu":"Olaszország","ro":"Italia","aliases":["Italian Republic"],"europe":true},{"key":"Jamaica","alpha2":"JM","en":"Jamaica","hu":"Jamaica","ro":"Jamaica","aliases":[],"europe":false},{"key":"Japan","alpha2":"JP","en":"Japan","hu":"Japán","ro":"Japonia","aliases":[],"europe":false},{"key":"Jersey","alpha2":"JE","en":"Jersey","hu":"Jersey","ro":"Jersey","aliases":[],"europe":false},{"key":"Jordan","alpha2":"JO","en":"Jordan","hu":"Jordánia","ro":"Iordania","aliases":["Hashemite Kingdom of Jordan"],"europe":false},{"key":"Kazakhstan","alpha2":"KZ","en":"Kazakhstan","hu":"Kazahsztán","ro":"Kazahstan","aliases":["Republic of Kazakhstan"],"europe":false},{"key":"Kenya","alpha2":"KE","en":"Kenya","hu":"Kenya","ro":"Kenya","aliases":["Republic of Kenya"],"europe":false},{"key":"Kiribati","alpha2":"KI","en":"Kiribati","hu":"Kiribati","ro":"Kiribati","aliases":["Republic of Kiribati"],"europe":false},{"key":"Kosovo","alpha2":"XK","en":"Kosovo","hu":"Koszovó","ro":"Kosovo","aliases":["Kosova"],"europe":true},{"key":"Kuwait","alpha2":"KW","en":"Kuwait","hu":"Kuvait","ro":"Kuweit","aliases":["State of Kuwait"],"europe":false},{"key":"Kyrgyzstan","alpha2":"KG","en":"Kyrgyzstan","hu":"Kirgizisztán","ro":"Kârgâzstan","aliases":["Kyrgyz Republic"],"europe":false},{"key":"Laos","alpha2":"LA","en":"Laos","hu":"Laosz","ro":"Laos","aliases":["Lao People's Democratic Republic","Laos"],"europe":false},{"key":"Latvia","alpha2":"LV","en":"Latvia","hu":"Lettország","ro":"Letonia","aliases":["Republic of Latvia"],"europe":true},{"key":"Lebanon","alpha2":"LB","en":"Lebanon","hu":"Libanon","ro":"Liban","aliases":["Lebanese Republic"],"europe":false},{"key":"Lesotho","alpha2":"LS","en":"Lesotho","hu":"Lesotho","ro":"Lesotho","aliases":["Kingdom of Lesotho"],"europe":false},{"key":"Liberia","alpha2":"LR","en":"Liberia","hu":"Libéria","ro":"Liberia","aliases":["Republic of Liberia"],"europe":false},{"key":"Libya","alpha2":"LY","en":"Libya","hu":"Líbia","ro":"Libia","aliases":[],"europe":false},{"key":"Liechtenstein","alpha2":"LI","en":"Liechtenstein","hu":"Liechtenstein","ro":"Liechtenstein","aliases":["Principality of Liechtenstein"],"europe":true},{"key":"Lithuania","alpha2":"LT","en":"Lithuania","hu":"Litvánia","ro":"Lituania","aliases":["Republic of Lithuania"],"europe":true},{"key":"Luxembourg","alpha2":"LU","en":"Luxembourg","hu":"Luxemburg","ro":"Luxemburg","aliases":["Grand Duchy of Luxembourg"],"europe":true},{"key":"Macao SAR China","alpha2":"MO","en":"Macao SAR China","hu":"Makaó KKT","ro":"R.A.S. Macao, China","aliases":["Macao","Macao Special Administrative Region of China"],"europe":false},{"key":"Madagascar","alpha2":"MG","en":"Madagascar","hu":"Madagaszkár","ro":"Madagascar","aliases":["Republic of Madagascar"],"europe":false},{"key":"Malawi","alpha2":"MW","en":"Malawi","hu":"Malawi","ro":"Malawi","aliases":["Republic of Malawi"],"europe":false},{"key":"Malaysia","alpha2":"MY","en":"Malaysia","hu":"Malajzia","ro":"Malaysia","aliases":[],"europe":false},{"key":"Maldives","alpha2":"MV","en":"Maldives","hu":"Maldív-szigetek","ro":"Maldive","aliases":["Republic of Maldives"],"europe":false},{"key":"Mali","alpha2":"ML","en":"Mali","hu":"Mali","ro":"Mali","aliases":["Republic of Mali"],"europe":false},{"key":"Malta","alpha2":"MT","en":"Malta","hu":"Málta","ro":"Malta","aliases":["Republic of Malta"],"europe":true},{"key":"Marshall Islands","alpha2":"MH","en":"Marshall Islands","hu":"Marshall-szigetek","ro":"Insulele Marshall","aliases":["Republic of the Marshall Islands"],"europe":false},{"key":"Martinique","alpha2":"MQ","en":"Martinique","hu":"Martinique","ro":"Martinica","aliases":[],"europe":false},{"key":"Mauritania","alpha2":"MR","en":"Mauritania","hu":"Mauritánia","ro":"Mauritania","aliases":["Islamic Republic of Mauritania"],"europe":false},{"key":"Mauritius","alpha2":"MU","en":"Mauritius","hu":"Mauritius","ro":"Mauritius","aliases":["Republic of Mauritius"],"europe":false},{"key":"Mayotte","alpha2":"YT","en":"Mayotte","hu":"Mayotte","ro":"Mayotte","aliases":[],"europe":false},{"key":"Mexico","alpha2":"MX","en":"Mexico","hu":"Mexikó","ro":"Mexic","aliases":["United Mexican States"],"europe":false},{"key":"Micronesia","alpha2":"FM","en":"Micronesia","hu":"Mikronézia","ro":"Micronezia","aliases":["Federated States of Micronesia","Micronesia, Federated States of"],"europe":false},{"key":"Moldova","alpha2":"MD","en":"Moldova","hu":"Moldova","ro":"Republica Moldova","aliases":["Moldova","Moldova, Republic of","Republic of Moldova"],"europe":true},{"key":"Monaco","alpha2":"MC","en":"Monaco","hu":"Monaco","ro":"Monaco","aliases":["Principality of Monaco"],"europe":true},{"key":"Mongolia","alpha2":"MN","en":"Mongolia","hu":"Mongólia","ro":"Mongolia","aliases":[],"europe":false},{"key":"Montenegro","alpha2":"ME","en":"Montenegro","hu":"Montenegró","ro":"Muntenegru","aliases":[],"europe":true},{"key":"Montserrat","alpha2":"MS","en":"Montserrat","hu":"Montserrat","ro":"Montserrat","aliases":[],"europe":false},{"key":"Morocco","alpha2":"MA","en":"Morocco","hu":"Marokkó","ro":"Maroc","aliases":["Kingdom of Morocco"],"europe":false},{"key":"Mozambique","alpha2":"MZ","en":"Mozambique","hu":"Mozambik","ro":"Mozambic","aliases":["Republic of Mozambique"],"europe":false},{"key":"Myanmar (Burma)","alpha2":"MM","en":"Myanmar (Burma)","hu":"Mianmar","ro":"Myanmar (Birmania)","aliases":["Myanmar","Republic of Myanmar"],"europe":false},{"key":"Namibia","alpha2":"NA","en":"Namibia","hu":"Namíbia","ro":"Namibia","aliases":["Republic of Namibia"],"europe":false},{"key":"Nauru","alpha2":"NR","en":"Nauru","hu":"Nauru","ro":"Nauru","aliases":["Republic of Nauru"],"europe":false},{"key":"Nepal","alpha2":"NP","en":"Nepal","hu":"Nepál","ro":"Nepal","aliases":["Federal Democratic Republic of Nepal"],"europe":false},{"key":"Netherlands","alpha2":"NL","en":"Netherlands","hu":"Hollandia","ro":"Țările de Jos","aliases":["Kingdom of the Netherlands"],"europe":true},{"key":"New Caledonia","alpha2":"NC","en":"New Caledonia","hu":"Új-Kaledónia","ro":"Noua Caledonie","aliases":[],"europe":false},{"key":"New Zealand","alpha2":"NZ","en":"New Zealand","hu":"Új-Zéland","ro":"Noua Zeelandă","aliases":[],"europe":false},{"key":"Nicaragua","alpha2":"NI","en":"Nicaragua","hu":"Nicaragua","ro":"Nicaragua","aliases":["Republic of Nicaragua"],"europe":false},{"key":"Niger","alpha2":"NE","en":"Niger","hu":"Niger","ro":"Niger","aliases":["Republic of the Niger"],"europe":false},{"key":"Nigeria","alpha2":"NG","en":"Nigeria","hu":"Nigéria","ro":"Nigeria","aliases":["Federal Republic of Nigeria"],"europe":false},{"key":"Niue","alpha2":"NU","en":"Niue","hu":"Niue","ro":"Niue","aliases":[],"europe":false},{"key":"Norfolk Island","alpha2":"NF","en":"Norfolk Island","hu":"Norfolk-sziget","ro":"Insula Norfolk","aliases":[],"europe":false},{"key":"North Korea","alpha2":"KP","en":"North Korea","hu":"Észak-Korea","ro":"Coreea de Nord","aliases":["DPR Korea","Democratic People's Republic of Korea","Korea, Democratic People's Republic of","North Korea"],"europe":false},{"key":"North Macedonia","alpha2":"MK","en":"North Macedonia","hu":"Észak-Macedónia","ro":"Macedonia de Nord","aliases":["Macedonia","North Macedonia","Republic of North Macedonia"],"europe":true},{"key":"Northern Ireland","alpha2":"GB-NIR","en":"Northern Ireland","hu":"Észak-Írország","ro":"Irlanda de Nord","aliases":["NIR"],"europe":true},{"key":"Northern Mariana Islands","alpha2":"MP","en":"Northern Mariana Islands","hu":"Északi Mariana-szigetek","ro":"Insulele Mariane de Nord","aliases":["Commonwealth of the Northern Mariana Islands"],"europe":false},{"key":"Norway","alpha2":"NO","en":"Norway","hu":"Norvégia","ro":"Norvegia","aliases":["Kingdom of Norway"],"europe":true},{"key":"Oman","alpha2":"OM","en":"Oman","hu":"Omán","ro":"Oman","aliases":["Sultanate of Oman"],"europe":false},{"key":"Pakistan","alpha2":"PK","en":"Pakistan","hu":"Pakisztán","ro":"Pakistan","aliases":["Islamic Republic of Pakistan"],"europe":false},{"key":"Palau","alpha2":"PW","en":"Palau","hu":"Palau","ro":"Palau","aliases":["Republic of Palau"],"europe":false},{"key":"Palestinian Territories","alpha2":"PS","en":"Palestinian Territories","hu":"Palesztin Autonómia","ro":"Teritoriile Palestiniene","aliases":["Palestine","Palestine, State of","the State of Palestine"],"europe":false},{"key":"Panama","alpha2":"PA","en":"Panama","hu":"Panama","ro":"Panama","aliases":["Republic of Panama"],"europe":false},{"key":"Papua New Guinea","alpha2":"PG","en":"Papua New Guinea","hu":"Pápua Új-Guinea","ro":"Papua-Noua Guinee","aliases":["Independent State of Papua New Guinea"],"europe":false},{"key":"Paraguay","alpha2":"PY","en":"Paraguay","hu":"Paraguay","ro":"Paraguay","aliases":["Republic of Paraguay"],"europe":false},{"key":"Peru","alpha2":"PE","en":"Peru","hu":"Peru","ro":"Peru","aliases":["Republic of Peru"],"europe":false},{"key":"Philippines","alpha2":"PH","en":"Philippines","hu":"Fülöp-szigetek","ro":"Filipine","aliases":["Republic of the Philippines"],"europe":false},{"key":"Pitcairn Islands","alpha2":"PN","en":"Pitcairn Islands","hu":"Pitcairn-szigetek","ro":"Insulele Pitcairn","aliases":["Pitcairn"],"europe":false},{"key":"Poland","alpha2":"PL","en":"Poland","hu":"Lengyelország","ro":"Polonia","aliases":["Republic of Poland"],"europe":true},{"key":"Portugal","alpha2":"PT","en":"Portugal","hu":"Portugália","ro":"Portugalia","aliases":["Portuguese Republic"],"europe":true},{"key":"Puerto Rico","alpha2":"PR","en":"Puerto Rico","hu":"Puerto Rico","ro":"Puerto Rico","aliases":[],"europe":false},{"key":"Qatar","alpha2":"QA","en":"Qatar","hu":"Katar","ro":"Qatar","aliases":["State of Qatar"],"europe":false},{"key":"Romania","alpha2":"RO","en":"Romania","hu":"Románia","ro":"România","aliases":[],"europe":true},{"key":"Russia","alpha2":"RU","en":"Russia","hu":"Oroszország","ro":"Rusia","aliases":["Russia","Russian Federation"],"europe":true},{"key":"Rwanda","alpha2":"RW","en":"Rwanda","hu":"Ruanda","ro":"Rwanda","aliases":["Rwandese Republic"],"europe":false},{"key":"Réunion","alpha2":"RE","en":"Réunion","hu":"Réunion","ro":"Réunion","aliases":[],"europe":false},{"key":"Samoa","alpha2":"WS","en":"Samoa","hu":"Szamoa","ro":"Samoa","aliases":["Independent State of Samoa"],"europe":false},{"key":"San Marino","alpha2":"SM","en":"San Marino","hu":"San Marino","ro":"San Marino","aliases":["Republic of San Marino"],"europe":true},{"key":"Saudi Arabia","alpha2":"SA","en":"Saudi Arabia","hu":"Szaúd-Arábia","ro":"Arabia Saudită","aliases":["Kingdom of Saudi Arabia"],"europe":false},{"key":"Scotland","alpha2":"GB-SCT","en":"Scotland","hu":"Skócia","ro":"Scoția","aliases":["SCO"],"europe":true},{"key":"Senegal","alpha2":"SN","en":"Senegal","hu":"Szenegál","ro":"Senegal","aliases":["Republic of Senegal"],"europe":false},{"key":"Serbia","alpha2":"RS","en":"Serbia","hu":"Szerbia","ro":"Serbia","aliases":["Republic of Serbia"],"europe":true},{"key":"Seychelles","alpha2":"SC","en":"Seychelles","hu":"Seychelle-szigetek","ro":"Seychelles","aliases":["Republic of Seychelles"],"europe":false},{"key":"Sierra Leone","alpha2":"SL","en":"Sierra Leone","hu":"Sierra Leone","ro":"Sierra Leone","aliases":["Republic of Sierra Leone"],"europe":false},{"key":"Singapore","alpha2":"SG","en":"Singapore","hu":"Szingapúr","ro":"Singapore","aliases":["Republic of Singapore"],"europe":false},{"key":"Sint Maarten","alpha2":"SX","en":"Sint Maarten","hu":"Sint Maarten","ro":"Sint-Maarten","aliases":["Sint Maarten (Dutch part)"],"europe":false},{"key":"Slovakia","alpha2":"SK","en":"Slovakia","hu":"Szlovákia","ro":"Slovacia","aliases":["Slovak Republic"],"europe":true},{"key":"Slovenia","alpha2":"SI","en":"Slovenia","hu":"Szlovénia","ro":"Slovenia","aliases":["Republic of Slovenia"],"europe":true},{"key":"Solomon Islands","alpha2":"SB","en":"Solomon Islands","hu":"Salamon-szigetek","ro":"Insulele Solomon","aliases":[],"europe":false},{"key":"Somalia","alpha2":"SO","en":"Somalia","hu":"Szomália","ro":"Somalia","aliases":["Federal Republic of Somalia"],"europe":false},{"key":"South Africa","alpha2":"ZA","en":"South Africa","hu":"Dél-afrikai Köztársaság","ro":"Africa de Sud","aliases":["Republic of South Africa"],"europe":false},{"key":"South Georgia & South Sandwich Islands","alpha2":"GS","en":"South Georgia & South Sandwich Islands","hu":"Déli-Georgia és Déli-Sandwich-szigetek","ro":"Georgia de Sud și Insulele Sandwich de Sud","aliases":["South Georgia and the South Sandwich Islands"],"europe":false},{"key":"South Korea","alpha2":"KR","en":"South Korea","hu":"Dél-Korea","ro":"Coreea de Sud","aliases":["Korea Republic","Korea, Republic of","Republic of Korea","South Korea"],"europe":false},{"key":"South Sudan","alpha2":"SS","en":"South Sudan","hu":"Dél-Szudán","ro":"Sudanul de Sud","aliases":["Republic of South Sudan"],"europe":false},{"key":"Spain","alpha2":"ES","en":"Spain","hu":"Spanyolország","ro":"Spania","aliases":["Kingdom of Spain"],"europe":true},{"key":"Sri Lanka","alpha2":"LK","en":"Sri Lanka","hu":"Srí Lanka","ro":"Sri Lanka","aliases":["Democratic Socialist Republic of Sri Lanka"],"europe":false},{"key":"St. Barthélemy","alpha2":"BL","en":"St. Barthélemy","hu":"Saint-Barthélemy","ro":"Saint-Barthélemy","aliases":["Saint Barthélemy"],"europe":false},{"key":"St. Helena","alpha2":"SH","en":"St. Helena","hu":"Szent Ilona","ro":"Sfânta Elena","aliases":["Saint Helena, Ascension and Tristan da Cunha"],"europe":false},{"key":"St. Kitts & Nevis","alpha2":"KN","en":"St. Kitts & Nevis","hu":"Saint Kitts és Nevis","ro":"Saint Kitts și Nevis","aliases":["Saint Kitts and Nevis"],"europe":false},{"key":"St. Lucia","alpha2":"LC","en":"St. Lucia","hu":"Saint Lucia","ro":"Sfânta Lucia","aliases":["Saint Lucia"],"europe":false},{"key":"St. Martin","alpha2":"MF","en":"St. Martin","hu":"Saint Martin","ro":"Sfântul Martin","aliases":["Saint Martin (French part)"],"europe":false},{"key":"St. Pierre & Miquelon","alpha2":"PM","en":"St. Pierre & Miquelon","hu":"Saint-Pierre és Miquelon","ro":"Saint-Pierre și Miquelon","aliases":["Saint Pierre and Miquelon"],"europe":false},{"key":"St. Vincent & Grenadines","alpha2":"VC","en":"St. Vincent & Grenadines","hu":"Saint Vincent és a Grenadine-szigetek","ro":"Saint Vincent și Grenadinele","aliases":["Saint Vincent and the Grenadines"],"europe":false},{"key":"Sudan","alpha2":"SD","en":"Sudan","hu":"Szudán","ro":"Sudan","aliases":["Republic of the Sudan"],"europe":false},{"key":"Suriname","alpha2":"SR","en":"Suriname","hu":"Suriname","ro":"Suriname","aliases":["Republic of Suriname"],"europe":false},{"key":"Svalbard & Jan Mayen","alpha2":"SJ","en":"Svalbard & Jan Mayen","hu":"Svalbard és Jan Mayen","ro":"Svalbard și Jan Mayen","aliases":["Svalbard and Jan Mayen"],"europe":false},{"key":"Sweden","alpha2":"SE","en":"Sweden","hu":"Svédország","ro":"Suedia","aliases":["Kingdom of Sweden"],"europe":true},{"key":"Switzerland","alpha2":"CH","en":"Switzerland","hu":"Svájc","ro":"Elveția","aliases":["Swiss Confederation"],"europe":true},{"key":"Syria","alpha2":"SY","en":"Syria","hu":"Szíria","ro":"Siria","aliases":["Syria","Syrian Arab Republic"],"europe":false},{"key":"São Tomé & Príncipe","alpha2":"ST","en":"São Tomé & Príncipe","hu":"São Tomé és Príncipe","ro":"São Tomé și Príncipe","aliases":["Democratic Republic of Sao Tome and Principe","Sao Tome and Principe"],"europe":false},{"key":"Taiwan","alpha2":"TW","en":"Taiwan","hu":"Tajvan","ro":"Taiwan","aliases":["Taiwan, Province of China"],"europe":false},{"key":"Tajikistan","alpha2":"TJ","en":"Tajikistan","hu":"Tádzsikisztán","ro":"Tadjikistan","aliases":["Republic of Tajikistan"],"europe":false},{"key":"Tanzania","alpha2":"TZ","en":"Tanzania","hu":"Tanzánia","ro":"Tanzania","aliases":["Tanzania","Tanzania, United Republic of","United Republic of Tanzania"],"europe":false},{"key":"Thailand","alpha2":"TH","en":"Thailand","hu":"Thaiföld","ro":"Thailanda","aliases":["Kingdom of Thailand"],"europe":false},{"key":"Timor-Leste","alpha2":"TL","en":"Timor-Leste","hu":"Kelet-Timor","ro":"Timor-Leste","aliases":["Democratic Republic of Timor-Leste"],"europe":false},{"key":"Togo","alpha2":"TG","en":"Togo","hu":"Togo","ro":"Togo","aliases":["Togolese Republic"],"europe":false},{"key":"Tokelau","alpha2":"TK","en":"Tokelau","hu":"Tokelau","ro":"Tokelau","aliases":[],"europe":false},{"key":"Tonga","alpha2":"TO","en":"Tonga","hu":"Tonga","ro":"Tonga","aliases":["Kingdom of Tonga"],"europe":false},{"key":"Trinidad & Tobago","alpha2":"TT","en":"Trinidad & Tobago","hu":"Trinidad és Tobago","ro":"Trinidad și Tobago","aliases":["Republic of Trinidad and Tobago","Trinidad and Tobago"],"europe":false},{"key":"Tunisia","alpha2":"TN","en":"Tunisia","hu":"Tunézia","ro":"Tunisia","aliases":["Republic of Tunisia"],"europe":false},{"key":"Turkey","alpha2":"TR","en":"Turkey","hu":"Törökország","ro":"Turcia","aliases":["Republic of Türkiye","Turkiye","Türkiye"],"europe":true},{"key":"Turkmenistan","alpha2":"TM","en":"Turkmenistan","hu":"Türkmenisztán","ro":"Turkmenistan","aliases":[],"europe":false},{"key":"Turks & Caicos Islands","alpha2":"TC","en":"Turks & Caicos Islands","hu":"Turks- és Caicos-szigetek","ro":"Insulele Turks și Caicos","aliases":["Turks and Caicos Islands"],"europe":false},{"key":"Tuvalu","alpha2":"TV","en":"Tuvalu","hu":"Tuvalu","ro":"Tuvalu","aliases":[],"europe":false},{"key":"U.S. Outlying Islands","alpha2":"UM","en":"U.S. Outlying Islands","hu":"Az USA lakatlan külbirtokai","ro":"Insulele Îndepărtate ale S.U.A.","aliases":["United States Minor Outlying Islands"],"europe":false},{"key":"U.S. Virgin Islands","alpha2":"VI","en":"U.S. Virgin Islands","hu":"Amerikai Virgin-szigetek","ro":"Insulele Virgine Americane","aliases":["Virgin Islands of the United States","Virgin Islands, U.S."],"europe":false},{"key":"Uganda","alpha2":"UG","en":"Uganda","hu":"Uganda","ro":"Uganda","aliases":["Republic of Uganda"],"europe":false},{"key":"Ukraine","alpha2":"UA","en":"Ukraine","hu":"Ukrajna","ro":"Ucraina","aliases":[],"europe":true},{"key":"United Arab Emirates","alpha2":"AE","en":"United Arab Emirates","hu":"Egyesült Arab Emírségek","ro":"Emiratele Arabe Unite","aliases":[],"europe":false},{"key":"United Kingdom","alpha2":"GB","en":"United Kingdom","hu":"Egyesült Királyság","ro":"Regatul Unit","aliases":["Britain","Great Britain","UK","United Kingdom of Great Britain and Northern Ireland"],"europe":true},{"key":"United States","alpha2":"US","en":"United States","hu":"Egyesült Államok","ro":"Statele Unite ale Americii","aliases":["America","US","USA","United States of America"],"europe":false},{"key":"Uruguay","alpha2":"UY","en":"Uruguay","hu":"Uruguay","ro":"Uruguay","aliases":["Eastern Republic of Uruguay"],"europe":false},{"key":"Uzbekistan","alpha2":"UZ","en":"Uzbekistan","hu":"Üzbegisztán","ro":"Uzbekistan","aliases":["Republic of Uzbekistan"],"europe":false},{"key":"Vanuatu","alpha2":"VU","en":"Vanuatu","hu":"Vanuatu","ro":"Vanuatu","aliases":["Republic of Vanuatu"],"europe":false},{"key":"Vatican City","alpha2":"VA","en":"Vatican City","hu":"Vatikán","ro":"Statul Cetății Vaticanului","aliases":["Holy See (Vatican City State)"],"europe":true},{"key":"Venezuela","alpha2":"VE","en":"Venezuela","hu":"Venezuela","ro":"Venezuela","aliases":["Bolivarian Republic of Venezuela","Venezuela","Venezuela, Bolivarian Republic of"],"europe":false},{"key":"Vietnam","alpha2":"VN","en":"Vietnam","hu":"Vietnám","ro":"Vietnam","aliases":["Socialist Republic of Viet Nam","Viet Nam","Vietnam"],"europe":false},{"key":"Wales","alpha2":"GB-WLS","en":"Wales","hu":"Wales","ro":"Țara Galilor","aliases":["Cymru"],"europe":true},{"key":"Wallis & Futuna","alpha2":"WF","en":"Wallis & Futuna","hu":"Wallis és Futuna","ro":"Wallis și Futuna","aliases":["Wallis and Futuna"],"europe":false},{"key":"Western Sahara","alpha2":"EH","en":"Western Sahara","hu":"Nyugat-Szahara","ro":"Sahara Occidentală","aliases":[],"europe":false},{"key":"Yemen","alpha2":"YE","en":"Yemen","hu":"Jemen","ro":"Yemen","aliases":["Republic of Yemen"],"europe":false},{"key":"Zambia","alpha2":"ZM","en":"Zambia","hu":"Zambia","ro":"Zambia","aliases":["Republic of Zambia"],"europe":false},{"key":"Zimbabwe","alpha2":"ZW","en":"Zimbabwe","hu":"Zimbabwe","ro":"Zimbabwe","aliases":["Republic of Zimbabwe"],"europe":false},{"key":"Åland Islands","alpha2":"AX","en":"Åland Islands","hu":"Åland-szigetek","ro":"Insulele Åland","aliases":[],"europe":false}]);

  const TM_NATIONALITY_LAND_IDS = Object.freeze({
    // Confirmed from the previous TM Scout V2 workflow. Other countries still work via
    // global source pages + local nationality filtering, without risking wrong TM land_id values.
    "Romania": "140",
    "Hungary": "178"
  });

  const EUROPE_COMPETITION_CODE_SET = new Set([
    'GB1','GB2','GB3','SC1','SC2','SC3','ES1','ES2','IT1','IT2','IT3A','IT3B','IT3C',
    'L1','L2','L3','E3G1','E3G2','FR1','FR2','FR3','NL1','NL2','PO1','PO2','TR1','TR2',
    'BE1','BE2','GR1','GR2','UKR1','UKR2','RU1','RU2','DK1','DK2','SE1','SE2','NO1','NO2',
    'PL1','PL2','PL3','A1','A2','C1','C2','C3','RO1','RO2','SER1','SER2','KRO1','KRO2',
    'UNG1','UNG2','SLO1','SLO2','TS1','TS2','BUL1','BUL2','ZYP1','ZYP2','ISR1','ISR2','FIN1','FIN2','IR1','IR2',
    'CL','EL','UCOL','FAC','UKRP','RUP','DKP','NLP','POCP','CIT'
  ]);

  const GLOBAL_EXTRA_FIRST_DIVISION_CODES = Object.freeze([
    'MLS1','USL','BRA1','BRA2','AR1N','AR2','MEXA','MEX2','JAP1','JAP2','CSL','KOR1','AUS1',
    'SA1','UAE1','QSL','TRM1','CLPD','CL2','COLP','COL2','PER1','EC1','URU1','PAR1','BOL1','VEN1',
    'CAN1','ZA1','EGY1','MAR1','TUN1','ALG1'
  ]);

  const COMPETITION_LABELS = Object.freeze({
    GB1:'Premier League', GB2:'Championship', GB3:'League One', SC1:'Scottish Premiership', SC2:'Scottish Championship', SC3:'Scottish League One',
    ES1:'LaLiga', ES2:'LaLiga 2', IT1:'Serie A', IT2:'Serie B', IT3A:'Serie C', IT3B:'Serie C', IT3C:'Serie C',
    L1:'Bundesliga', L2:'2. Bundesliga', L3:'3. Liga', FR1:'Ligue 1', FR2:'Ligue 2', FR3:'National',
    NL1:'Eredivisie', NL2:'Eerste Divisie', PO1:'Liga Portugal', PO2:'Liga Portugal 2', TR1:'Süper Lig', TR2:'1. Lig',
    BE1:'Jupiler Pro League', BE2:'Challenger Pro League', GR1:'Super League Greece', GR2:'Super League 2',
    UKR1:'Ukrainian Premier League', UKR2:'Persha Liga', RU1:'Russian Premier Liga', RU2:'First League',
    DK1:'Superligaen', DK2:'1st Division', SE1:'Allsvenskan', SE2:'Superettan', NO1:'Eliteserien', NO2:'OBOS-ligaen',
    PL1:'Ekstraklasa', PL2:'I liga', PL3:'II liga', A1:'Austrian Bundesliga', A2:'2. Liga', C1:'Swiss Super League', C2:'Challenge League', C3:'Promotion League',
    RO1:'SuperLiga', RO2:'Liga 2', SER1:'Serbian SuperLiga', SER2:'Prva Liga', KRO1:'HNL', KRO2:'Prva NL',
    UNG1:'NB I', UNG2:'NB II', SLO1:'PrvaLiga', SLO2:'2. SNL', TS1:'Czech First League', TS2:'Czech National League',
    BUL1:'First League Bulgaria', BUL2:'Second League Bulgaria', ZYP1:'Cypriot First Division', ZYP2:'Cypriot Second Division',
    ISR1:'Israeli Premier League', ISR2:'Liga Leumit', FIN1:'Veikkausliiga', FIN2:'Ykkösliiga', IR1:'League of Ireland Premier Division', IR2:'League of Ireland First Division',
    MLS1:'Major League Soccer', USL:'USL Championship', BRA1:'Brasileirão Série A', BRA2:'Brasileirão Série B', AR1N:'Liga Profesional Argentina', AR2:'Primera Nacional Argentina',
    MEXA:'Liga MX', MEX2:'Liga de Expansión MX', JAP1:'J1 League', JAP2:'J2 League', CSL:'Chinese Super League', KOR1:'K League 1', AUS1:'A-League Men',
    SA1:'Saudi Pro League', UAE1:'UAE Pro League', QSL:'Qatar Stars League', CLPD:'Chilean Primera División', COLP:'Categoría Primera A', PER1:'Liga 1 Peru', EC1:'LigaPro Ecuador', URU1:'Uruguayan Primera División', PAR1:'Paraguayan Primera División', BOL1:'Bolivian Primera División', VEN1:'Venezuelan Primera División', CAN1:'Canadian Premier League', ZA1:'South African Premier Division', EGY1:'Egyptian Premier League', MAR1:'Botola Pro', TUN1:'Tunisian Ligue Professionnelle 1', ALG1:'Algerian Ligue 1'
  });

  (function patchWorldNationalityI18n() {
    const extra = {
      hu: {
        "Keresés nemzetiségre": "Keresés nemzetiségre",
        "Csak európai klub/liga források": "Csak európai klub/liga források",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.",
        "Utolsó liga": "Utolsó liga",
        "Utolsó klub": "Utolsó klub",
        "Jelenlegi klub": "Jelenlegi klub",
        "Klub / utolsó klub + liga": "Klub / utolsó klub + liga",
        "Nemzetiségek": "Nemzetiségek",
        "Contract nemzetiségek": "Contract nemzetiségek",
        "Minden nemzetiség": "Minden nemzetiség",
        "Nincs egyező nemzetiség": "Nincs egyező nemzetiség",
        "Keresési mélység": "Keresési mélység",
        "Gyors": "Gyors",
        "Kiegyensúlyozott": "Kiegyensúlyozott",
        "Alapos recovery": "Alapos recovery",
        "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.": "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.",
        "Keresési mód": "Keresési mód"
      },
      en: {
        "Keresés nemzetiségre": "Search nationality",
        "Csak európai klub/liga források": "Only European club/league sources",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Turn this off to include relevant leagues from around the world.",
        "Utolsó liga": "Last league",
        "Utolsó klub": "Last club",
        "Jelenlegi klub": "Current club",
        "Klub / utolsó klub + liga": "Club / last club + league",
        "Nemzetiségek": "Nationalities",
        "Contract nemzetiségek": "Contract nationalities",
        "Minden nemzetiség": "All nationalities",
        "Nincs egyező nemzetiség": "No matching nationality",
        "Keresési mélység": "Search depth",
        "Gyors": "Fast",
        "Kiegyensúlyozott": "Balanced",
        "Alapos recovery": "Deep recovery",
        "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.": "More precise source plan: targeted fallbacks, fewer lost candidates.",
        "Keresési mód": "Search mode"
      },
      ro: {
        "Keresés nemzetiségre": "Caută naționalitate",
        "Csak európai klub/liga források": "Doar surse din cluburi/ligi europene",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Dacă dezactivezi opțiunea, pot apărea și jucători din ligi relevante din toată lumea.",
        "Utolsó liga": "Ultima ligă",
        "Utolsó klub": "Ultimul club",
        "Jelenlegi klub": "Club actual",
        "Klub / utolsó klub + liga": "Club / ultimul club + ligă",
        "Nemzetiségek": "Naționalități",
        "Contract nemzetiségek": "Naționalități contract",
        "Minden nemzetiség": "Toate naționalitățile",
        "Nincs egyező nemzetiség": "Nicio naționalitate potrivită"
      }
    };
    Object.keys(extra).forEach(function addLang(lang) {
      if (!I18N[lang]) return;
      Object.assign(I18N[lang], extra[lang]);
    });
  })();

  (function addLanguageRefreshAndColumnText() {
    const extra = {
      hu: {
        "Contract nemzetiségek / forrásszűkítés": "Contract nemzetiségek / forrásszűkítés",
        "Contract nemzetiségek / source szűkítés": "Contract nemzetiségek / forrásszűkítés",
        "U21 nemzetiségek / szűrés": "U21 nemzetiségek / szűrés",
        "Keresés nemzetiségre": "Keresés nemzetiségre",
        "Nincs egyező nemzetiség": "Nincs egyező nemzetiség",
        "Keresési mélység": "Keresési mélység",
        "Gyors": "Gyors",
        "Kiegyensúlyozott": "Kiegyensúlyozott",
        "Alapos recovery": "Alapos recovery",
        "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.": "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.",
        "Keresési mód": "Keresési mód",
        "Csak európai klub/liga források": "Csak európai klub/liga források",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.",
        "Kész": "Kész",
        "találat": "találat",
        "találatok": "találatok",
        "vizsgált játékos": "vizsgált játékos",
        "vizsgált játékosok": "vizsgált játékosok",
        "ellenőrizve": "ellenőrizve",
        "Forrásoldal": "Forrásoldal",
        "Forrásoldalak letöltése": "Forrásoldalak letöltése",
        "oldal": "oldal",
        "oldal...": "oldal...",
        "játékos": "játékos",
        "játékosok": "játékosok",
        "mód": "mód",
        "Contract": "Contract",
        "U21": "U21",
        "Név A–Z": "Név A–Z",
        "Fiatalabb előre": "Fiatalabb előre",
        "Második állampolgárság": "Második állampolgárság",
        "Forrásszűkítés": "Forrásszűkítés",
        "Source narrowing": "Forrásszűkítés",
        "Contract nationalities / source narrowing": "Contract nemzetiségek / forrásszűkítés",
        "Naționalități contract / restrângere surse": "Contract nemzetiségek / forrásszűkítés"
      },
      en: {
        "Contract nemzetiségek / forrásszűkítés": "Contract nationalities / source narrowing",
        "Contract nemzetiségek / source szűkítés": "Contract nationalities / source narrowing",
        "U21 nemzetiségek / szűrés": "U21 nationalities / filter",
        "Keresés nemzetiségre": "Search nationality",
        "Nincs egyező nemzetiség": "No matching nationality",
        "Keresési mélység": "Search depth",
        "Gyors": "Fast",
        "Kiegyensúlyozott": "Balanced",
        "Alapos recovery": "Deep recovery",
        "Pontosabb source-terv: több célzott fallback, kevesebb elveszett jelölt.": "More precise source plan: targeted fallbacks, fewer lost candidates.",
        "Keresési mód": "Search mode",
        "Csak európai klub/liga források": "European club/league sources only",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Turn this off to also include players from relevant leagues worldwide.",
        "Kész": "Done",
        "találat": "result",
        "találatok": "results",
        "vizsgált játékos": "player checked",
        "vizsgált játékosok": "players checked",
        "ellenőrizve": "enriched",
        "Forrásoldal": "Source page",
        "Forrásoldalak letöltése": "Downloading source pages",
        "oldal": "page",
        "oldal...": "pages...",
        "játékos": "player",
        "játékosok": "players",
        "mód": "mode",
        "Contract": "Contract",
        "U21": "U21",
        "Név A–Z": "Name A–Z",
        "Fiatalabb előre": "Younger first",
        "Második állampolgárság": "Second citizenship",
        "Forrásszűkítés": "Source narrowing",
        "Source narrowing": "Source narrowing",
        "Contract nationalities / source narrowing": "Contract nationalities / source narrowing",
        "Naționalități contract / restrângere surse": "Contract nationalities / source narrowing"
      },
      ro: {
        "Contract nemzetiségek / forrásszűkítés": "Naționalități contract / restrângere surse",
        "Contract nemzetiségek / source szűkítés": "Naționalități contract / restrângere surse",
        "U21 nemzetiségek / szűrés": "Naționalități U21 / filtru",
        "Keresés nemzetiségre": "Caută naționalitate",
        "Nincs egyező nemzetiség": "Nicio naționalitate potrivită",
        "Csak európai klub/liga források": "Doar surse cluburi/ligi europene",
        "Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.": "Dacă dezactivezi opțiunea, pot apărea și jucători din ligi relevante din toată lumea.",
        "Kész": "Gata",
        "találat": "rezultat",
        "találatok": "rezultate",
        "vizsgált játékos": "jucător analizat",
        "vizsgált játékosok": "jucători analizați",
        "ellenőrizve": "verificați",
        "Forrásoldal": "Pagină sursă",
        "Forrásoldalak letöltése": "Descarc paginile sursă",
        "oldal": "pagină",
        "oldal...": "pagini...",
        "játékos": "jucător",
        "játékosok": "jucători",
        "mód": "mod",
        "Contract": "Contract",
        "U21": "U21",
        "Név A–Z": "Nume A–Z",
        "Fiatalabb előre": "Mai tineri primii",
        "Második állampolgárság": "A doua cetățenie",
        "Forrásszűkítés": "Restrângere surse",
        "Source narrowing": "Restrângere surse",
        "Contract nationalities / source narrowing": "Naționalități contract / restrângere surse",
        "Naționalități contract / restrângere surse": "Naționalități contract / restrângere surse"
      }
    };
    Object.keys(extra).forEach(function mergeLanguageRefresh(lang) {
      if (!I18N[lang]) return;
      Object.assign(I18N[lang], extra[lang]);
    });
  })();



  const DEFAULTS = Object.freeze({
    minMv: 200000,
    maxMv: 800000,
    minAge: 22,
    maxAge: 30,
    growthSince: defaultSeasonStart(),
    maxMvDropPct: 15,
    contractYear: String(new Date().getFullYear()),
    contractNationalities: [],
    minMinutes: 900,
    minApps: 12,
    performanceWindow: 'auto',
    requireEverySeason: true,
    seasonPassRule: 'or',
    positionFilterMode: 'broad',
    detailGK: true,
    detailCB: true,
    detailLB: true,
    detailRB: true,
    detailDM: true,
    detailCM: true,
    detailAM: true,
    detailLM: true,
    detailRM: true,
    detailLW: true,
    detailRW: true,
    detailWING: true,
    detailCF: true,
    detailSS: true,
    detailOther: true,
    maxSourcePages: 45,
    maxCandidates: 160,
    u21MaxSourcePages: 16,
    u21MaxCandidates: 220,
    europeLeaguePages: true,
    lowerLeaguePages: true,
    lowerLeagueDepth: '2-3',
    europeanClubSourcesOnly: true,
    includeFreeAgents: true,
    futureExclude: true,
    excludeOwnTeam: false,
    ownTeamFilter: '',
    ownTeamLookback: 'latestSeason',
    posGK: true,
    posDEF: true,
    posMID: true,
    posFWD: true,
    extraSourceUrls: '',
    concurrency: 12,

    // U21 prospect mode: broad youth search. MV is useful, but missing MV is not an exclusion reason.
    scoutMode: 'contract',
    searchDepth: 'deep',
    u21MinAge: 16,
    u21MaxAge: 21,
    u21MinMv: 0,
    u21MaxMv: 5000000,
    u21MinMatchRatio: 65,
    u21Nationalities: []
  });

  const state = {
    mounted: false,
    panelReady: false,
    panelCollapsed: false,
    running: false,
    results: [],
    rawCandidates: [],
    enrichedCount: 0,
    debug: makeDebug(),
    settings: Object.assign({}, DEFAULTS)
  };

  const DETAIL_POSITION_KEYS = Object.freeze([
    'detailGK', 'detailCB', 'detailLB', 'detailRB', 'detailDM', 'detailCM', 'detailAM',
    'detailLM', 'detailRM', 'detailLW', 'detailRW', 'detailWING', 'detailCF', 'detailSS', 'detailOther'
  ]);


  console.info(`${APP.logPrefix} script start`);

  safeRegisterMenuCommands();
  if (isGithubPageApp()) {
    openPanelOnGithubPage();
  } else {
    emergencyMountLauncher();
    mountLauncherWithRetry();
  }

  function isGithubPageApp() {
    return Boolean(document.getElementById('tmScoutMount'));
  }

  function removeLauncherButtons() {
    ['tm-scout-v2ihe-launcher', 'tm-scout-v2rescue-launcher'].forEach(function removeById(id) {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function openPanelOnGithubPage() {
    function runOpen() {
      openPanel();
      removeLauncherButtons();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onGithubReady() { window.setTimeout(runOpen, 0); }, { once: true });
    } else {
      window.setTimeout(runOpen, 0);
    }
  }

  function emergencyMountLauncher() {
    const emergencyId = 'tm-scout-v2rescue-launcher';
    let attempts = 0;
    function draw(reason) {
      try {
        const target = document.body || document.documentElement;
        if (!target) return;
        let button = document.getElementById(emergencyId);
        if (!button) {
          button = document.createElement('button');
          button.id = emergencyId;
          button.type = 'button';
          button.textContent = 'TM Scout V2';
          button.setAttribute('data-tm-scout-rescue', reason || 'boot');
          button.addEventListener('click', function onEmergencyLauncherClick(event) {
            event.preventDefault();
            event.stopPropagation();
            openPanel();
          }, true);
          target.appendChild(button);
          console.info(`${APP.logPrefix} emergency launcher mounted`, reason || 'boot');
        }
        button.style.cssText = [
          'position:fixed!important',
          'left:14px!important',
          'bottom:14px!important',
          'z-index:2147483647!important',
          'display:inline-flex!important',
          'visibility:visible!important',
          'opacity:1!important',
          'pointer-events:auto!important',
          'align-items:center!important',
          'justify-content:center!important',
          'padding:10px 14px!important',
          'border-radius:999px!important',
          'border:2px solid #56f097!important',
          'background:#071018!important',
          'color:#ffffff!important',
          'font:900 13px/1.1 Arial,sans-serif!important',
          'box-shadow:0 10px 40px rgba(0,0,0,.55)!important',
          'cursor:pointer!important'
        ].join(';');
        button.hidden = false;
        button.removeAttribute('hidden');
        state.mounted = true;
      } catch (error) {
        console.error(`${APP.logPrefix} emergency launcher error:`, error);
      }
    }
    draw('immediate');
    const rescueTimer = window.setInterval(function rescueRetry() {
      attempts += 1;
      draw('rescue-interval-' + attempts);
      if (attempts >= 80) window.clearInterval(rescueTimer);
    }, 250);
    document.addEventListener('DOMContentLoaded', function rescueDomReady() { draw('DOMContentLoaded'); }, { once: true });
    window.addEventListener('load', function rescueLoad() { draw('load'); }, { once: true });
  }

  function defaultSeasonStart() {
    // Contract-expiring scouting is normally about the season before the contract year.
    // Example: contractYear 2026 -> check MV trend since 2025-07-01.
    const contractYear = new Date().getFullYear();
    return `${contractYear - 1}-07-01`;
  }

  function makeDebug() {
    return {
      startedAt: new Date().toISOString(),
      finishedAt: null,
      settings: null,
      sourceUrls: [],
      sourceFilterCombos: [],
      adaptivePageLimits: [],
      sourcePagesFetched: 0,
      sourcePagesSkipped: [],
      sourceCandidatesBeforePrefilter: 0,
      prefilteredOut: 0,
      prefilterRejected: [],
      rawCandidates: 0,
      candidateIds: [],
      enriched: 0,
      passed: 0,
      rejected: [],
      networkRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: []
    };
  }

  function safeRegisterMenuCommands() {
    try {
      GM_registerMenuCommand(APP.menuOpen, openPanel);
      GM_registerMenuCommand(APP.menuClear, async function clearFromMenu() {
        const count = await clearOwnCache();
        showUiModal(`${APP.name}: ${tx('Cache törölve')} (${count} elem).`, { title: APP.name, variant: 'success' });
      });
    } catch (error) {
      logError('menu command registration failed', error);
    }
  }

  function mountLauncherWithRetry() {
    // Hardened launcher mount: do not depend on document-idle only, and do not
    // trust an already existing/hidden node from an older duplicate install.
    tryMountLauncher('immediate');

    document.addEventListener('readystatechange', function onReadyStateChange() {
      tryMountLauncher('readystatechange:' + document.readyState);
    });

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function onDomReady() {
        tryMountLauncher('DOMContentLoaded');
      }, { once: true });
    } else {
      queueMicrotaskSafe(function onMicrotask() {
        tryMountLauncher('microtask');
      });
    }

    window.addEventListener('load', function onWindowLoad() {
      tryMountLauncher('window.load');
    }, { once: true });

    let attempts = 0;
    const timer = window.setInterval(function retryLauncher() {
      attempts += 1;
      tryMountLauncher('interval:' + attempts);
      if (state.mounted && attempts >= 6) {
        window.clearInterval(timer);
      }
      if (attempts >= 60) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  function getMountTarget() {
    return document.body || document.documentElement;
  }

  function tryMountLauncher(reason) {
    try {
      const target = getMountTarget();
      if (!target) return;

      ensureStyles();

      let button = document.getElementById(APP.launcherId);
      if (!button) {
        button = document.createElement('button');
        button.id = APP.launcherId;
        button.className = 'tm-scout-v2-launcher';
        button.type = 'button';
        button.textContent = 'TM Scout V2';
        button.addEventListener('click', openPanel);
        target.appendChild(button);
        console.info(`${APP.logPrefix} launcher mounted`, reason || 'unknown');
      } else if (button.parentNode !== target && document.body) {
        document.body.appendChild(button);
      }

      button.hidden = false;
      button.removeAttribute('hidden');
      button.style.setProperty('display', 'inline-flex', 'important');
      button.style.setProperty('visibility', 'visible', 'important');
      button.style.setProperty('opacity', '1', 'important');
      button.style.setProperty('pointer-events', 'auto', 'important');
      button.style.setProperty('z-index', '2147483647', 'important');
      state.mounted = true;
    } catch (error) {
      logError('launcher mount failed', error);
    }
  }

  function openPanel() {
    try {
      ensureStyles();
      let panel = document.getElementById(APP.panelId);
      if (!panel) {
        panel = buildPanel();
        const mount = document.getElementById('tmScoutMount');
        if (mount) {
          mount.innerHTML = '';
          mount.appendChild(panel);
        } else {
          document.body.appendChild(panel);
        }
        state.panelReady = true;
      }
      removeLauncherButtons();
      panel.hidden = false;
      panel.classList.remove('tm-scout-v2-hidden');
      state.panelCollapsed = false;
      panel.classList.remove('tm-scout-v2-collapsed');
      console.info(`${APP.logPrefix} panel opened`);
    } catch (error) {
      logError('panel open failed', error);
      showUiModal(stringifyError(error), { title: APP.name, variant: 'error' });
    }
  }


  function buildContractYearOptionsHtml() {
    const currentYear = new Date().getFullYear();
    const start = Math.min(2026, currentYear);
    const end = Math.max(currentYear + 4, 2030);
    const years = [];
    for (let year = start; year <= end; year += 1) years.push(year);
    return years.map(function option(year) {
      return `<option value="${year}">${year}</option>`;
    }).join('');
  }



  function normalizeCountrySearch(value) {
    return normalizeText(value).replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function getCountryRecord(value) {
    const needle = normalizeCountrySearch(value);
    if (!needle) return null;
    return COUNTRY_CATALOG.find(function findCountry(country) {
      const candidates = [country.key, country.en, country.hu, country.ro, country.alpha2].concat(country.aliases || []);
      return candidates.some(function sameCountry(candidate) {
        const normalized = normalizeCountrySearch(candidate);
        return normalized === needle || normalized.replace(/\s+/g, '') === needle.replace(/\s+/g, '');
      });
    }) || null;
  }

  function getCountryCanonicalKey(value) {
    const record = getCountryRecord(value);
    return record ? record.key : cleanText(value);
  }

  function countryLabel(value, lang) {
    const record = getCountryRecord(value);
    const language = normalizeUiLanguage(lang || currentUiLanguage());
    if (!record) return cleanText(value);
    return record[language] || record.en || record.key;
  }

  function countrySearchBlob(value) {
    const record = getCountryRecord(value);
    if (!record) return normalizeCountrySearch(value);
    return [record.key, record.en, record.hu, record.ro, record.alpha2].concat(record.aliases || [])
      .map(normalizeCountrySearch)
      .filter(Boolean)
      .join(' | ');
  }

  function buildNationalityOptionsHtml() {
    const lang = currentUiLanguage();
    return COUNTRY_CATALOG.map(function option(country) {
      const label = countryLabel(country.key, lang);
      const search = countrySearchBlob(country.key);
      return `<option value="${escapeAttr(country.key)}" data-alpha2="${escapeAttr(country.alpha2 || '')}" data-europe="${country.europe ? '1' : '0'}" data-search="${escapeAttr(search)}">${escapeHtml(label)}</option>`;
    }).join('');
  }

  function updateNationalitySelectLabels(root) {
    const scope = root || document;
    Array.from(scope.querySelectorAll ? scope.querySelectorAll('select.tm-scout-v2-multi-select') : []).forEach(function updateSelect(select) {
      Array.from(select.options || []).forEach(function updateOption(option) {
        const key = option.value || option.textContent;
        option.textContent = countryLabel(key);
        option.setAttribute('data-search', countrySearchBlob(key));
      });
      updateNationalityPickerLabels(select);
    });
  }

  function updateNationalityPickerLabels(select) {
    if (!select || !select.dataset || !select.dataset.pickerId) return;
    const picker = document.getElementById(select.dataset.pickerId);
    if (!picker) return;
    const input = picker.parentElement ? picker.parentElement.querySelector('[data-nationality-search]') : null;
    if (input) {
      input.placeholder = tx('Keresés nemzetiségre');
      input.setAttribute('aria-label', tx('Keresés nemzetiségre'));
    }
    const empty = picker.parentElement ? picker.parentElement.querySelector('[data-nationality-empty]') : null;
    if (empty) empty.textContent = tx('Nincs egyező nemzetiség');
    Array.from(picker.querySelectorAll('[data-nationality-value]')).forEach(function updateItem(item) {
      const value = item.getAttribute('data-nationality-value');
      const label = item.querySelector('.tm-scout-v2-nationality-name');
      if (label) label.textContent = countryLabel(value);
      item.setAttribute('data-search', countrySearchBlob(value));
    });
  }

  function filterNationalityPicker(picker, query) {
    if (!picker) return;
    const q = normalizeCountrySearch(query || '');
    let visible = 0;
    Array.from(picker.querySelectorAll('[data-nationality-value]')).forEach(function filterItem(item) {
      const blob = item.getAttribute('data-search') || countrySearchBlob(item.getAttribute('data-nationality-value'));
      const ok = !q || normalizeCountrySearch(blob).includes(q);
      item.hidden = !ok;
      if (ok) visible += 1;
    });
    const empty = picker.parentElement ? picker.parentElement.querySelector('[data-nationality-empty]') : null;
    if (empty) empty.hidden = visible !== 0;
  }

  function buildPanel() {
    const panel = document.createElement('section');
    panel.id = APP.panelId;
    panel.className = 'tm-scout-v2-panel';
    panel.setAttribute('aria-label', 'TM Scout V2 panel');

    panel.innerHTML = [
      '<div class="tm-scout-v2-shell">',
      '  <header class="tm-scout-v2-head">',
      '    <div>',
      '      <h2>TM Scout V2</h2>',
      '      <p>Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.</p>',
      '    </div>',
      '    <div class="tm-scout-v2-head-actions">',
      '      <label class="tm-scout-v2-head-lang">Felület nyelve <select name="uiLanguage" aria-label="Felület nyelve"><option value="hu">Magyar</option><option value="en">English</option><option value="ro">Română</option></select></label>',
      '    </div>',
      '  </header>',
      '  <div class="tm-scout-v2-body">',
      '    <form class="tm-scout-v2-controls" data-role="controls">',
      '      <fieldset class="tm-scout-v2-wide">',
      '        <legend>Scout mód</legend>',
      '        <label class="tm-scout-v2-wide">Mód <select name="scoutMode"><option value="contract">Lejáró szerződés / free agent</option><option value="u21">U21 prospect</option></select></label>',
      '        ',
      '      </fieldset>',
      '      <fieldset data-contract-settings="true">',
      '        <legend>Alapszűrők</legend>',
      '        <label>Min MV <input name="minMv" type="number" min="0" step="50000"></label>',
      '        <label>Max MV <input name="maxMv" type="number" min="0" step="50000"></label>',
      '        <label>Min age <input name="minAge" type="number" min="15" max="60"></label>',
      '        <label>Max age <input name="maxAge" type="number" min="15" max="60"></label>',
      '        <label>MV reference date <input name="growthSince" type="date"></label>',
      '        <label>Max MV drop % <input name="maxMvDropPct" type="number" min="0" max="90" step="1"></label>',
      '        <label>Szerződés lejárati éve <select name="contractYear">' + buildContractYearOptionsHtml() + '</select></label>',
      '        <label class="tm-scout-v2-wide">Contract nemzetiségek / source szűkítés',
      '          <select class="tm-scout-v2-multi-select" name="contractNationalities" multiple size="10">',
      buildNationalityOptionsHtml(),
      '          </select>',
      '        </label>',
      '      </fieldset>',
      '      <fieldset data-contract-settings="true">',
      '        <legend>Játékidő + szezonok</legend>',
      '        <label>Min minutes / season <input name="minMinutes" type="number" min="0" step="90"></label>',
      '        <label>Min apps / season <input name="minApps" type="number" min="0" step="1"></label>',
      '        <label class="tm-scout-v2-wide">Vizsgált szezonok <select name="performanceWindow"><option value="auto">Auto</option><option value="1">1 szezon</option><option value="2">2 szezon</option><option value="3">3 szezon</option></select></label>',
      '        <label class="tm-scout-v2-wide">Szezon szabály <select name="seasonPassRule"><option value="or">Apps vagy perc</option><option value="and">Apps és perc</option></select></label>',
      '        <label class="tm-scout-v2-checkline"><input name="requireEverySeason" type="checkbox"> Minden kiválasztott szezon menjen át</label>',
      '        <label>Max oldalak <input name="maxSourcePages" type="number" min="1" max="200"></label>',
      '        <label>Max játékosjelöltek <input name="maxCandidates" type="number" min="1" max="2000"></label>',
      '      </fieldset>',
      '      <fieldset class="tm-scout-v2-wide">',
      '        <legend>Poszt-szűrés módja</legend>',
      '        <label class="tm-scout-v2-wide">Posztszűrés <select name="positionFilterMode"><option value="broad">Tág posztcsoportok</option><option value="detail">Precíz posztok</option></select></label>',
      '        ',
      '      </fieldset>',
      '      <fieldset class="tm-scout-v2-checks tm-scout-v2-broad-options" data-position-mode-block="broad">',
      '        <legend>Posztcsoportok</legend>',
      '        <label><input name="posGK" type="checkbox"> GK</label>',
      '        <label><input name="posDEF" type="checkbox"> DEF</label>',
      '        <label><input name="posMID" type="checkbox"> MID</label>',
      '        <label><input name="posFWD" type="checkbox"> FWD</label>',
      '      </fieldset>',
      '      <fieldset class="tm-scout-v2-checks tm-scout-v2-detail-options tm-scout-v2-wide" data-position-mode-block="detail">',
      '        <legend>Részletes posztok</legend>',
      '        <label><input name="detailGK" type="checkbox"> GK</label>',
      '        <label><input name="detailCB" type="checkbox"> CB</label>',
      '        <label><input name="detailLB" type="checkbox"> LB</label>',
      '        <label><input name="detailRB" type="checkbox"> RB</label>',
      '        <label><input name="detailDM" type="checkbox"> DM</label>',
      '        <label><input name="detailCM" type="checkbox"> CM</label>',
      '        <label><input name="detailAM" type="checkbox"> AM</label>',
      '        <label><input name="detailLM" type="checkbox"> LM</label>',
      '        <label><input name="detailRM" type="checkbox"> RM</label>',
      '        <label><input name="detailLW" type="checkbox"> Left Winger</label>',
      '        <label><input name="detailRW" type="checkbox"> Right Winger</label>',
      '        <label><input name="detailWING" type="checkbox"> Winger</label>',
      '        <label><input name="detailCF" type="checkbox"> CF/ST</label>',
      '        <label><input name="detailSS" type="checkbox"> SS</label>',
      '        <label><input name="detailOther" type="checkbox"> Other/unknown</label>',
      '      </fieldset>',
      '      <fieldset class="tm-scout-v2-wide" data-u21-settings="true">',
      '        <legend>U21 prospect szűrők</legend>',
      '        <label>U21 min age <input name="u21MinAge" type="number" min="14" max="23"></label>',
      '        <label>U21 max age <input name="u21MaxAge" type="number" min="14" max="23"></label>',
      '        <label>U21 min MV <input name="u21MinMv" type="number" min="0" step="50000"></label>',
      '        <label>U21 max MV <input name="u21MaxMv" type="number" min="0" step="50000"></label>',
      '        <label>Min játszott meccsarány % <input name="u21MinMatchRatio" type="number" min="0" max="100" step="1"></label>',
      '        <label class="tm-scout-v2-wide">Nemzetiségek, opcionális multiple choice',
      '          <select class="tm-scout-v2-multi-select" name="u21Nationalities" multiple size="10">',
      buildNationalityOptionsHtml(),
      '          </select>',
      '        </label>',
      '        <label>U21 oldalak <input name="u21MaxSourcePages" type="number" min="1" max="200"></label>',
      '        <label>U21 max játékosjelöltek <input name="u21MaxCandidates" type="number" min="1" max="2000"></label>',
      '        ',
      '      </fieldset>',
      '      <fieldset class="tm-scout-v2-checks tm-scout-v2-source-options">',
      '        <legend>Források</legend>',
      '        <label><input name="europeLeaguePages" type="checkbox"> Első osztályú európai ligák</label>',
      '        <label><input name="lowerLeaguePages" type="checkbox"> Jobb ligák 2–3. osztályai is</label>',
      '        <label class="tm-scout-v2-wide">Alsóbb osztály mélység <select name="lowerLeagueDepth"><option value="2">Csak 2. osztály</option><option value="2-3">2–3. osztály</option></select></label>',
      '        <label><input name="europeanClubSourcesOnly" type="checkbox"> Csak európai klub/liga források</label>',
      '        <p class="tm-scout-v2-field-note">Ha kikapcsolod, a világ releváns ligáiból is jöhetnek játékosok.</p>',
      '        <label data-contract-settings="true"><input name="includeFreeAgents" type="checkbox"> Aktuális free agentek is (alapból ON)</label>',
      '        <label data-contract-settings="true"><input name="futureExclude" type="checkbox"> Jövőbeli igazolással rendelkezők kizárása</label>',
      '        <label><input name="excludeOwnTeam" type="checkbox"> Saját csapat kizárása</label>',
      '        <label class="tm-scout-v2-wide">Saját csapat név vagy TM club ID <input name="ownTeamFilter" type="text" placeholder="pl. DAC 1904, APOEL vagy 829"></label>',
      '        <label class="tm-scout-v2-wide">Saját csapat időablak <select name="ownTeamLookback"><option value="latestSeason">Utolsó szezon</option><option value="selectedSeasons">Kiválasztott szezonok</option></select></label>',
      '        ',
      '      </fieldset>',
      '      <div class="tm-scout-v2-actions">',
      '        <button type="button" data-action="search" class="tm-scout-v2-primary">Keresés</button>',
      '        <button type="button" data-action="download-html">HTML letöltés</button>',
      '        <button type="button" data-action="open-html-view">Megnyitás</button>',
      '        <button type="button" data-action="download-csv">CSV export</button>',
      '        <button type="button" data-action="download-json">JSON export</button>',
      '        <button type="button" data-action="clear-cache">Cache törlés</button>',
      '      </div>',
      '    </form>',
      '    <section class="tm-scout-v2-output">',
      '      <div class="tm-scout-v2-statusbar">',
      '        <div class="tm-scout-v2-status" data-role="status">Készen áll.</div>',
      '        <div class="tm-scout-v2-progress"><span data-role="progress"></span></div>',
      '      </div>',
      '      ',
      '      <div class="tm-scout-v2-stats" data-role="stats"></div>',
      '      <div class="tm-scout-v2-table-wrap">',
      '        <table class="tm-scout-v2-table">',
      '          <thead>',
      '            <tr>',
      '              <th>Játékos</th>',
      '              <th>Poszt</th>',
      '              <th>Kor</th>',
      '              <th>Nemzetiség</th>',
      '              <th>Elérhetőség</th>',
      '              <th>Klub / utolsó klub</th>',
      '              <th>MV most</th>',
      '              <th>MV változás</th>',
      '              <th>Játékidő</th>',
      '              <th>Utolsó szezonok</th>',
      '              <th>TM profil</th>',
      '            </tr>',
      '          </thead>',
      '          <tbody data-role="results"></tbody>',
      '        </table>',
      '      </div>',
      '    </section>',
      '  </div>',
      '</div>'
    ].join('');

    hydrateSettings(panel);
    bindPanelEvents(panel);
    renderStats(panel);
    localizeRoot(panel);
    return panel;
  }

  function hydrateSettings(panel) {
    const form = panel.querySelector('[data-role="controls"]');
    const savedCurrent = safeJsonParse(window.localStorage.getItem('tmScoutV2SelectReadableFixUiSettings'), null);
    const savedFormLayout = safeJsonParse(window.localStorage.getItem('tmScoutV2FormLayoutFixUiSettings'), null);
    const savedLegacy = savedCurrent ? null : (
      safeJsonParse(window.localStorage.getItem('tmScoutV2FreeAgentsIncludedUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2ButtonsVisibleUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2SourceFilterFastUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2LowerLeaguesUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2ReadableUiAppsFixUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2OwnTeamExcludeFastUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2PositionModeFastUiSettings'), null)
      || safeJsonParse(window.localStorage.getItem('tmScoutV2MultiSeasonPositionUiSettings'), null)
    );
    const saved = savedCurrent || savedLegacy;
    state.settings = Object.assign({}, DEFAULTS, saved || {});
    // This build is explicitly requested to include current free agents by default.
    // Old saved settings often had this unchecked, so only the new build's own
    // settings key is allowed to persist a deliberate false value.
    if (!savedCurrent) state.settings.includeFreeAgents = true;
    state.settings.positionFilterMode = normalizePositionFilterMode(state.settings.positionFilterMode);
    state.settings.lowerLeagueDepth = normalizeLowerLeagueDepth(state.settings.lowerLeagueDepth);
    // v10: no UI search-depth selector. Always use the deepest planner; old saved fast/balanced values are ignored.
    state.settings.searchDepth = 'deep';
    if (normalizeScoutMode(state.settings.scoutMode) === 'u21' && Number(state.settings.u21MinMatchRatio) === 35) {
      state.settings.u21MinMatchRatio = 65;
    }
    if (state.settings.detailWING && !savedHasOwn(saved, 'detailLW') && !savedHasOwn(saved, 'detailRW')) {
      state.settings.detailLW = true;
      state.settings.detailRW = true;
    }

    // Do not restore nationality multi-select from localStorage.
    // It was confusing: the first click could suddenly re-apply old saved countries
    // and jump the native select scroll position. Nationalities are now session/manual only.
    state.settings.u21Nationalities = [];
    state.settings.contractNationalities = [];

    Object.keys(DEFAULTS).forEach(function setInput(name) {
      const input = form.elements[name];
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(state.settings[name]);
      else if (input.tagName !== 'SELECT' || !input.multiple) input.value = state.settings[name];
    });
    setMultiSelectValue(form.elements.u21Nationalities, state.settings.u21Nationalities);
    setMultiSelectValue(form.elements.contractNationalities, state.settings.contractNationalities);
    if (form.elements.uiLanguage) form.elements.uiLanguage.value = currentUiLanguage();
    state.settings.scoutMode = normalizeScoutMode(state.settings.scoutMode);
    state.settings.searchDepth = normalizeSearchDepth(state.settings.searchDepth);
    setScoutModeUi(panel, state.settings.scoutMode);
    setPositionModeUi(panel, state.settings.positionFilterMode);
    localizeRoot(panel);
    updateNationalitySelectLabels(panel);
  }

  function bindPanelEvents(panel) {
    bindToggleableMultiSelect(panel);

    panel.addEventListener('change', function handlePanelChange(event) {
      const target = event.target;
      if (target && target.name === 'uiLanguage') {
        setUiLanguage(target.value);
        return;
      }
      if (target && target.name === 'positionFilterMode') {
        setPositionModeUi(panel, normalizePositionFilterMode(target.value));
        localizeRoot(panel);
        updateNationalitySelectLabels(panel);
      }
      if (target && target.name === 'scoutMode') {
        setScoutModeUi(panel, normalizeScoutMode(target.value));
        renderResults(panel, state.results || []);
        renderStats(panel);
        localizeRoot(panel);
        updateNationalitySelectLabels(panel);
      }
    });

    panel.addEventListener('click', async function handlePanelClick(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.getAttribute('data-action');

      try {
        if (action === 'search') {
          await runScout(panel);
          return;
        }
        if (action === 'download-html') {
          ensureHasResults();
          downloadText(`tm-scout-v2-${dateStamp()}.html`, 'text/html;charset=utf-8', buildHtmlExport());
          return;
        }
        if (action === 'open-html-view') {
          ensureHasResults();
          openHtmlView();
          return;
        }
        if (action === 'download-csv') {
          ensureHasResults();
          downloadText(`tm-scout-v2-${dateStamp()}.csv`, 'text/csv;charset=utf-8', buildCsvExport(state.results));
          return;
        }
        if (action === 'download-json') {
          downloadText(`tm-scout-v2-export-${dateStamp()}.json`, 'application/json;charset=utf-8', JSON.stringify({ createdAt: new Date().toISOString(), mode: state.settings.scoutMode || 'contract', results: state.results }, null, 2));
          return;
        }
        if (action === 'clear-cache') {
          const count = await clearOwnCache();
          setStatus(panel, `${tx('Cache törölve')} (${count} elem).`, 0);
          showUiModal(`${APP.name}: ${tx('Cache törölve')} (${count} elem).`, { title: APP.name, variant: 'success' });
        }
      } catch (error) {
        logError(`panel action failed: ${action}`, error);
        setStatus(panel, `Hiba: ${stringifyError(error)}`, null);
        showUiModal(stringifyError(error), { title: APP.name, variant: 'error' });
      }
    });
  }

  function getWorkerBatchConcurrency(settings, extraSlots) {
    const saved = Math.max(1, Number(settings && settings.concurrency || DEFAULTS.concurrency || 8));
    if (!tmScoutBatchEndpoint()) return saved;

    const batchSize = Math.max(8, Number(TM_SCOUT_BATCH_SIZE || 24));
    const targetCandidates = Math.max(1, Number(isU21Mode(settings) ? settings.u21MaxCandidates : settings.maxCandidates) || (isU21Mode(settings) ? DEFAULTS.u21MaxCandidates : DEFAULTS.maxCandidates));
    let scaled = Math.ceil(batchSize * 0.55);
    if (targetCandidates >= 120) scaled = Math.ceil(batchSize * 0.70);
    if (targetCandidates >= 220) scaled = Math.ceil(batchSize * 0.85);
    if (targetCandidates >= 360) scaled = batchSize;

    return Math.max(saved, Math.min(batchSize, scaled + Math.max(0, Number(extraSlots || 0))));
  }

  function parsedSourceCacheKey(source) {
    return `${APP.cachePrefix}parsedSource:${hashString(canonicalizeScoutUrl(source && source.url || ''))}`;
  }

  async function getCachedParsedSource(source) {
    try {
      const cached = await gmGet(parsedSourceCacheKey(source), null);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < Math.min(APP.ttlMs, 36 * 60 * 60 * 1000) && Array.isArray(cached.rows)) {
        state.debug.cacheHits += 1;
        return cached.rows.map(function cloneCandidate(row) { return Object.assign({}, row); });
      }
    } catch (error) {
      pushError('parsed source cache read skipped', stringifyError(error));
    }
    return null;
  }

  async function setCachedParsedSource(source, rows) {
    try {
      if (!Array.isArray(rows) || !rows.length) return;
      const compact = rows.slice(0, 80).map(function compactCandidate(row) {
        return {
          playerId: row.playerId,
          slug: row.slug,
          name: row.name,
          profileUrl: row.profileUrl,
          age: row.age,
          nationality: row.nationality,
          position: row.position,
          positionGroup: row.positionGroup,
          club: row.club,
          clubIds: row.clubIds,
          contractUntil: row.contractUntil,
          marketValue: row.marketValue,
          currentMarketValue: row.currentMarketValue,
          sourceTypes: row.sourceTypes,
          sourceLabels: row.sourceLabels,
          sourceUrls: row.sourceUrls,
          competitionCodes: row.competitionCodes
        };
      });
      const payload = { savedAt: Date.now(), rows: compact };
      const serialized = JSON.stringify(payload);
      if (serialized.length <= 220000) await gmSet(parsedSourceCacheKey(source), payload);
    } catch (error) {
      pushError('parsed source cache write skipped', stringifyError(error));
    }
  }

  async function runScout(panel) {
    if (state.running) return;
    state.running = true;
    panel.classList.add('tm-scout-v2-running');
    state.debug = makeDebug();
    state.results = [];
    state.rawCandidates = [];
    state.enrichedCount = 0;
    renderResults(panel, []);
    renderStats(panel);

    const searchButton = panel.querySelector('button[data-action="search"]');
    if (searchButton) searchButton.disabled = true;

    try {
      const settings = readSettings(panel);
      state.settings = settings;
      state.debug.settings = settings;
      saveUiSettings(settings);

      setStatus(panel, isU21Mode(settings) ? 'U21 forrásoldalak előkészítése...' : 'Forrásoldalak előkészítése...', 2);
      const sources = buildSourcePlan(settings);
      state.debug.sourceUrls = sources.map(function sourceToUrl(source) { return source.url; });
      if (!sources.length) throw new Error('Nincs source URL. Legalább egy Transfermarkt forrás kell.');

      setStatus(panel, `Forrásoldalak letöltése: ${sources.length} oldal...`, 5);
      const sourceDocs = await mapLimit(sources, getWorkerBatchConcurrency(settings, 2), async function loadSource(source, index) {
        setStatus(panel, `Forrásoldal ${index + 1}/${sources.length}`, progressRatio(5, 25, index, sources.length));
        try {
          const cachedRows = await getCachedParsedSource(source);
          if (cachedRows) return { source: source, parsedCandidates: cachedRows, fromParsedCache: true };
          const html = await httpGetCached(source.url, 'text');
          state.debug.sourcePagesFetched += 1;
          return { source: source, html: html };
        } catch (error) {
          const errText = stringifyError(error);
          if (source.sourceGroup === 'strong-lower-league-contracts' && /HTTP\s+(404|403)/i.test(errText)) {
            state.debug.sourcePagesSkipped.push({ url: source.url, reason: errText, group: source.sourceGroup });
          } else {
            pushError('source page failed', { url: source.url, error: errText });
          }
          return null;
        }
      });

      setStatus(panel, 'Játékoslisták feldolgozása...', 28);
      const candidateMap = new Map();
      sourceDocs.filter(Boolean).forEach(function parseSourceDoc(item) {
        const parsed = Array.isArray(item.parsedCandidates) ? item.parsedCandidates : parseSourcePage(item.html, item.source);
        if (!item.fromParsedCache) setCachedParsedSource(item.source, parsed);
        parsed.forEach(function mergeCandidate(candidate) {
          const key = String(candidate.playerId || '');
          if (!key) return;
          if (!candidateMap.has(key)) {
            candidateMap.set(key, candidate);
          } else {
            candidateMap.set(key, mergeCandidates(candidateMap.get(key), candidate));
          }
        });
      });

      const allSourceCandidates = Array.from(candidateMap.values());
      state.debug.sourceCandidatesBeforePrefilter = allSourceCandidates.length;
      state.debug.sourceTypeCounts = countSourceTypes(allSourceCandidates);

      const rejectedByPrefilter = [];
      let rawCandidates = allSourceCandidates.filter(function candidateBasicPreFilter(candidate) {
        const verdict = passesObviousSourceFilters(candidate, settings);
        if (!verdict.ok && rejectedByPrefilter.length < 80) {
          rejectedByPrefilter.push({
            playerId: candidate.playerId,
            name: candidate.name,
            age: candidate.age,
            marketValue: candidate.marketValue,
            position: candidate.position,
            positionGroup: candidate.positionGroup || positionGroup(candidate.position),
            positionDetail: positionDetail(candidate.position),
            sourceTypes: candidate.sourceTypes || [],
            reasons: verdict.reasons
          });
        }
        return verdict.ok;
      });
      state.debug.prefilteredOut = allSourceCandidates.length - rawCandidates.length;
      state.debug.prefilterRejected = rejectedByPrefilter;
      rawCandidates.sort(isU21Mode(settings) ? sortU21CandidatesForEnrich : sortCandidatesForEnrich);
      rawCandidates = limitCandidatesForEnrich(rawCandidates, settings);

      state.rawCandidates = rawCandidates;
      state.debug.rawCandidates = rawCandidates.length;
      state.debug.candidateIds = rawCandidates.map(function idOf(candidate) { return candidate.playerId; });
      renderStats(panel);

      if (!rawCandidates.length) {
        setStatus(panel, 'Nincs találat az alap szűrők után. Emeld a max oldalszámot vagy lazíts a szűrőkön.', 100);
        return;
      }

      setStatus(panel, `Részletes adatok lekérése: ${rawCandidates.length} játékos...`, 32);
      const results = [];

      await mapLimit(rawCandidates, Math.min(rawCandidates.length, getWorkerBatchConcurrency(settings, 0)), async function enrichOne(candidate, index) {
        setStatus(panel, `Játékos ${index + 1}/${rawCandidates.length}: ${candidate.name || candidate.playerId}`, progressRatio(32, 94, index, rawCandidates.length));
        try {
          const enriched = await enrichCandidate(candidate, settings);
          state.enrichedCount += 1;
          state.debug.enriched = state.enrichedCount;
          const verdict = evaluatePlayer(enriched, settings);
          if (verdict.ok) {
            results.push(enriched);
            state.debug.passed = results.length;
            results.sort(sortFinalResults);
            state.results = results.slice();
            renderResults(panel, state.results);
            renderStats(panel);
          } else {
            state.debug.rejected.push({
              playerId: candidate.playerId,
              name: enriched.name || candidate.name,
              reasons: verdict.reasons,
              mvNow: enriched.currentMarketValue,
              age: enriched.age,
              position: enriched.position,
              positionGroup: enriched.positionGroup,
              positionDetail: enriched.positionDetail,
              mv: enriched.mv ? {
                ok: enriched.mv.ok,
                grew: enriched.mv.grew,
                passedTrend: enriched.mv.passedTrend,
                maxMvDropPct: enriched.mv.maxMvDropPct,
                minAllowedValue: enriched.mv.minAllowedValue,
                latestValue: enriched.mv.latestValue,
                baselineValue: enriched.mv.baselineValue,
                absGrowth: enriched.mv.absGrowth,
                pctGrowth: enriched.mv.pctGrowth
              } : null,
              ownTeamExclusion: enriched.ownTeamExclusion || null,
              playingTime: enriched.playingTime ? {
                source: enriched.playingTime.source,
                apps: enriched.playingTime.apps,
                minutes: enriched.playingTime.minutes,
                rawRows: enriched.playingTime.rawRows,
                countedRows: enriched.playingTime.countedRows,
                dedupedRows: enriched.playingTime.dedupedRows || 0,
                bySeason: enriched.playingTime.bySeason || [],
                sourcesTried: enriched.playingTime.sourcesTried || []
              } : null
            });
          }
        } catch (error) {
          pushError('candidate enrich failed', {
            playerId: candidate.playerId,
            name: candidate.name,
            error: stringifyError(error)
          });
        }
      });

      state.results = results.sort(sortFinalResults);
      state.debug.finishedAt = new Date().toISOString();
      renderResults(panel, state.results);
      renderStats(panel);
      setStatus(panel, `Kész: ${state.results.length} találat / ${state.rawCandidates.length} vizsgált játékos.`, 100);
    } catch (error) {
      pushError('run failed', stringifyError(error));
      logError('run failed', error);
      setStatus(panel, `Hiba: ${stringifyError(error)}`, null);
      showUiModal(stringifyError(error), { title: APP.name, variant: 'error' });
    } finally {
      state.running = false;
      panel.classList.remove('tm-scout-v2-running');
      if (searchButton) searchButton.disabled = false;
      renderStats(panel);
    }
  }

  function readSettings(panel) {
    const form = panel.querySelector('[data-role="controls"]');
    const settings = {
      minMv: readNumber(form.elements.minMv, DEFAULTS.minMv),
      maxMv: readNumber(form.elements.maxMv, DEFAULTS.maxMv),
      minAge: readNumber(form.elements.minAge, DEFAULTS.minAge),
      maxAge: readNumber(form.elements.maxAge, DEFAULTS.maxAge),
      growthSince: String(form.elements.growthSince.value || DEFAULTS.growthSince),
      maxMvDropPct: clampNumber(readNumber(form.elements.maxMvDropPct, DEFAULTS.maxMvDropPct), 0, 90),
      contractYear: String(form.elements.contractYear.value || DEFAULTS.contractYear),
      contractNationalities: readMultiSelectValues(form.elements.contractNationalities),
      scoutMode: normalizeScoutMode(form.elements.scoutMode ? form.elements.scoutMode.value : DEFAULTS.scoutMode),
      // v10: always deep/recovery; budget is controlled by the user candidate caps, not a separate dropdown.
      searchDepth: 'deep',
      u21MinAge: readNumber(form.elements.u21MinAge, DEFAULTS.u21MinAge),
      u21MaxAge: readNumber(form.elements.u21MaxAge, DEFAULTS.u21MaxAge),
      u21MinMv: readNumber(form.elements.u21MinMv, DEFAULTS.u21MinMv),
      u21MaxMv: readNumber(form.elements.u21MaxMv, DEFAULTS.u21MaxMv),
        u21MinMatchRatio: clampNumber(readNumber(form.elements.u21MinMatchRatio, DEFAULTS.u21MinMatchRatio), 0, 100),
        u21MaxSourcePages: readNumber(form.elements.u21MaxSourcePages, DEFAULTS.u21MaxSourcePages),
      u21MaxCandidates: readNumber(form.elements.u21MaxCandidates, DEFAULTS.u21MaxCandidates),
      u21Nationalities: readMultiSelectValues(form.elements.u21Nationalities),
      minMinutes: readNumber(form.elements.minMinutes, DEFAULTS.minMinutes),
      minApps: readNumber(form.elements.minApps, DEFAULTS.minApps),
      performanceWindow: normalizePerformanceWindow(form.elements.performanceWindow ? form.elements.performanceWindow.value : DEFAULTS.performanceWindow),
      requireEverySeason: Boolean(form.elements.requireEverySeason && form.elements.requireEverySeason.checked),
      seasonPassRule: normalizeSeasonPassRule(form.elements.seasonPassRule ? form.elements.seasonPassRule.value : DEFAULTS.seasonPassRule),
      positionFilterMode: normalizePositionFilterMode(form.elements.positionFilterMode ? form.elements.positionFilterMode.value : DEFAULTS.positionFilterMode),
      detailGK: Boolean(form.elements.detailGK && form.elements.detailGK.checked),
      detailCB: Boolean(form.elements.detailCB && form.elements.detailCB.checked),
      detailLB: Boolean(form.elements.detailLB && form.elements.detailLB.checked),
      detailRB: Boolean(form.elements.detailRB && form.elements.detailRB.checked),
      detailDM: Boolean(form.elements.detailDM && form.elements.detailDM.checked),
      detailCM: Boolean(form.elements.detailCM && form.elements.detailCM.checked),
      detailAM: Boolean(form.elements.detailAM && form.elements.detailAM.checked),
      detailLM: Boolean(form.elements.detailLM && form.elements.detailLM.checked),
      detailRM: Boolean(form.elements.detailRM && form.elements.detailRM.checked),
      detailLW: Boolean(form.elements.detailLW && form.elements.detailLW.checked),
      detailRW: Boolean(form.elements.detailRW && form.elements.detailRW.checked),
      detailWING: Boolean(form.elements.detailWING && form.elements.detailWING.checked),
      detailCF: Boolean(form.elements.detailCF && form.elements.detailCF.checked),
      detailSS: Boolean(form.elements.detailSS && form.elements.detailSS.checked),
      detailOther: Boolean(form.elements.detailOther && form.elements.detailOther.checked),
      maxSourcePages: readNumber(form.elements.maxSourcePages, DEFAULTS.maxSourcePages),
      maxCandidates: readNumber(form.elements.maxCandidates, DEFAULTS.maxCandidates),
      europeLeaguePages: Boolean(form.elements.europeLeaguePages && form.elements.europeLeaguePages.checked),
      lowerLeaguePages: Boolean(form.elements.lowerLeaguePages && form.elements.lowerLeaguePages.checked),
      lowerLeagueDepth: normalizeLowerLeagueDepth(form.elements.lowerLeagueDepth ? form.elements.lowerLeagueDepth.value : DEFAULTS.lowerLeagueDepth),
      europeanClubSourcesOnly: Boolean(form.elements.europeanClubSourcesOnly ? form.elements.europeanClubSourcesOnly.checked : DEFAULTS.europeanClubSourcesOnly),
      includeFreeAgents: Boolean(form.elements.includeFreeAgents && form.elements.includeFreeAgents.checked),
      futureExclude: Boolean(form.elements.futureExclude.checked),
      excludeOwnTeam: Boolean(form.elements.excludeOwnTeam && form.elements.excludeOwnTeam.checked),
      ownTeamFilter: String((form.elements.ownTeamFilter && form.elements.ownTeamFilter.value) || '').trim(),
      ownTeamLookback: normalizeOwnTeamLookback(form.elements.ownTeamLookback ? form.elements.ownTeamLookback.value : DEFAULTS.ownTeamLookback),
      posGK: Boolean(form.elements.posGK.checked),
      posDEF: Boolean(form.elements.posDEF.checked),
      posMID: Boolean(form.elements.posMID.checked),
      posFWD: Boolean(form.elements.posFWD.checked),
      extraSourceUrls: String((form.elements.extraSourceUrls && form.elements.extraSourceUrls.value) || ''),
      concurrency: DEFAULTS.concurrency
    };

    if (settings.maxMv < settings.minMv) {
      const temp = settings.minMv;
      settings.minMv = settings.maxMv;
      settings.maxMv = temp;
    }
    if (settings.maxAge < settings.minAge) {
      const temp = settings.minAge;
      settings.minAge = settings.maxAge;
      settings.maxAge = temp;
    }
    if (settings.u21MaxAge < settings.u21MinAge) {
      const temp = settings.u21MinAge;
      settings.u21MinAge = settings.u21MaxAge;
      settings.u21MaxAge = temp;
    }
    if (settings.u21MaxMv < settings.u21MinMv) {
      const temp = settings.u21MinMv;
      settings.u21MinMv = settings.u21MaxMv;
      settings.u21MaxMv = temp;
    }
    settings.u21MaxSourcePages = Math.max(1, Number(settings.u21MaxSourcePages || DEFAULTS.u21MaxSourcePages));
    settings.u21MaxCandidates = Math.max(1, Number(settings.u21MaxCandidates || DEFAULTS.u21MaxCandidates));
    if (settings.positionFilterMode === 'broad' && !settings.posGK && !settings.posDEF && !settings.posMID && !settings.posFWD) {
      settings.posGK = true;
      settings.posDEF = true;
      settings.posMID = true;
      settings.posFWD = true;
    }
    if (settings.positionFilterMode === 'detail' && !anyDetailedPositionEnabled(settings)) {
      DETAIL_POSITION_KEYS.forEach(function enableDetail(key) { settings[key] = true; });
    }
    return settings;
  }

  function saveUiSettings(settings) {
    try {
      const stored = Object.assign({}, settings || {});
      // Keep the nationality multi-choice manual for each run.
      // This avoids old localStorage selections popping back in on click/refresh.
      stored.u21Nationalities = [];
      stored.contractNationalities = [];
      window.localStorage.setItem('tmScoutV2SelectReadableFixUiSettings', JSON.stringify(stored));
    } catch (error) {
      pushError('ui settings save failed', stringifyError(error));
    }
  }

  function buildContractEndingQueryUrl(year, filter, landId) {
    const f = normalizeSourceFilter(filter);
    // Path-style filters are used here because TM exposes the contract table filters
    // as jahr/ausrichtung/spielerposition_id/altersklasse/plus/1 routes on league pages.
    return `https://www.transfermarkt.com/transfers/endendevertraege/statistik/jahr/${encodeURIComponent(normalizeYear(year))}/land_id/${encodeURIComponent(String(landId || '0'))}/ausrichtung/${encodeURIComponent(f.alignment)}/spielerposition_id/${encodeURIComponent(f.detailId)}/altersklasse/${encodeURIComponent(f.ageClass)}/plus/1`;
  }

  function buildCompetitionContractEndingQueryUrl(code, year, filter, landId) {
    const cleanCode = String(code || '').trim().toUpperCase();
    const f = normalizeSourceFilter(filter);
    return `https://www.transfermarkt.com/-/endendevertraege/wettbewerb/${encodeURIComponent(cleanCode)}/jahr/${encodeURIComponent(normalizeYear(year))}/land_id/${encodeURIComponent(String(landId || '0'))}/ausrichtung/${encodeURIComponent(f.alignment)}/spielerposition_id/${encodeURIComponent(f.detailId)}/altersklasse/${encodeURIComponent(f.ageClass)}/plus/1`;
  }

  function buildFreeAgentQueryUrl(filter, landId) {
    const f = normalizeSourceFilter(filter);
    const url = new URL('https://www.transfermarkt.com/statistik/vertragslosespieler');
    url.searchParams.set('plus', '1');
    url.searchParams.set('ausrichtung', f.alignment);
    url.searchParams.set('spielerposition_id', f.detailId);
    url.searchParams.set('altersklasse', f.ageClass);
    url.searchParams.set('land_id', String(landId || '0'));
    url.searchParams.set('yt0', 'Show');
    return url.toString();
  }

  function buildFreeAgentRecoveryFilters(sourceFilters, settings) {
    /*
     * Free-agent tables are the easiest place to lose players: TM can be picky with
     * combined age + exact position params, and the rows are sorted by market value.
     * So we keep the precise sources, then add a few wider recovery sources and let
     * the local prefilter do the exact age/MV/position cut.
     */
    const filters = Array.isArray(sourceFilters) && sourceFilters.length ? sourceFilters : [{ ageClass: 'alle', alignment: 'alle', detailId: 'alle', label: 'all', weight: 0 }];
    const out = [];
    const seen = new Set();
    const depth = normalizeSearchDepth(settings && settings.searchDepth);
    const deep = depth === 'deep';
    const fast = depth === 'fast';

    function add(filter, labelSuffix, weightBoost) {
      const base = normalizeSourceFilter(filter);
      const item = {
        ageClass: base.ageClass || 'alle',
        alignment: base.alignment || 'alle',
        detailId: base.detailId || 'alle',
        label: [base.label || 'all', labelSuffix].filter(Boolean).join(' · '),
        weight: Math.max(0, Number(base.weight || 0) + Number(weightBoost || 0))
      };
      const key = `${item.ageClass}|${item.alignment}|${item.detailId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    }

    filters.forEach(function addWiderFreeAgentFilter(filter) {
      const f = normalizeSourceFilter(filter);
      add({ ageClass: f.ageClass, alignment: f.alignment, detailId: f.detailId, label: f.label, weight: f.weight }, 'exact recovery', 0);
      if (f.detailId !== 'alle') add({ ageClass: f.ageClass, alignment: f.alignment, detailId: 'alle', label: 'age + broad position', weight: Math.max(1, f.weight - 1) }, 'broad-pos fallback', 0);
      if (!fast && (f.alignment !== 'alle' || f.detailId !== 'alle')) add({ ageClass: f.ageClass, alignment: 'alle', detailId: 'alle', label: 'age-only', weight: Math.max(0, f.weight - 1) }, 'age fallback', 1);
      if (!fast && f.ageClass !== 'alle' && (f.alignment !== 'alle' || f.detailId !== 'alle')) add({ ageClass: 'alle', alignment: f.alignment, detailId: f.detailId, label: 'position-only', weight: Math.max(0, f.weight - 1) }, 'position fallback', 1);
      if (deep && f.detailId !== 'alle') add({ ageClass: 'alle', alignment: f.alignment, detailId: 'alle', label: 'broad position all ages', weight: Math.max(0, f.weight - 2) }, 'deep broad-position fallback', 2);
    });

    if (!fast) add({ ageClass: 'alle', alignment: 'alle', detailId: 'alle', label: 'all free agents', weight: 0 }, deep ? 'deep fallback' : 'balanced fallback', deep ? 2 : 3);
    return out;
  }

  function normalizeSourceFilter(filter) {
    const f = filter || {};
    return {
      ageClass: f.ageClass || 'alle',
      alignment: f.alignment || 'alle',
      detailId: f.detailId || 'alle',
      label: f.label || 'all',
      weight: Number(f.weight || 0)
    };
  }

  function buildSourceFilterCombos(settings) {
    const ageClasses = getTransfermarktAgeClasses(settings);
    const positionFilters = getTransfermarktPositionFilters(settings);
    const combos = [];
    const seen = new Set();
    ageClasses.forEach(function eachAge(age) {
      positionFilters.forEach(function eachPosition(position) {
        const combo = {
          ageClass: age.code,
          alignment: position.alignment,
          detailId: position.detailId,
          label: [age.label, position.label].filter(Boolean).join(' · '),
          weight: (age.code === 'alle' ? 0 : 1) + (position.alignment === 'alle' && position.detailId === 'alle' ? 0 : 1)
        };
        const key = `${combo.ageClass}|${combo.alignment}|${combo.detailId}`;
        if (seen.has(key)) return;
        seen.add(key);
        combos.push(combo);
      });
    });
    return combos.length ? combos : [{ ageClass: 'alle', alignment: 'alle', detailId: 'alle', label: 'all', weight: 0 }];
  }

  function getTransfermarktAgeClasses(settings) {
    const minAge = Number(settings.minAge || 0);
    const maxAge = Number(settings.maxAge || 120);

    // If the user basically asks for every sane age, don't split URLs.
    if (minAge <= 17 && maxAge >= 36) return [{ code: 'alle', label: 'all ages' }];

    const classes = [];
    function add(code, label) {
      if (!classes.some(function has(item) { return item.code === code; })) classes.push({ code: code, label: label });
    }

    // TM age classes are buckets, not exact min/max. We use the narrowest bucket(s)
    // that can contain the requested range, then the normal source prefilter removes
    // the remaining edge cases precisely.
    if (maxAge <= 16) add('u17', 'age u17');
    else if (maxAge <= 17) add('u18', 'age u18');
    else if (maxAge <= 18) add('u19', 'age u19');
    else if (maxAge <= 19) add('u20', 'age u20');
    else if (maxAge <= 20) add('u21', 'age u21');
    else if (maxAge <= 22) add('u23', 'age u23');
    else {
      if (minAge <= 22) add('u23', 'age u23');
      if (maxAge >= 23 && minAge <= 30) add('23-30', 'age 23-30');
      if (maxAge >= 31) add('o30', 'age o30');
    }

    return classes.length ? classes : [{ code: 'alle', label: 'all ages' }];
  }

  function getTransfermarktPositionFilters(settings) {
    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    if (mode === 'detail') return getTransfermarktDetailPositionFilters(settings);
    return getTransfermarktBroadPositionFilters(settings);
  }

  function getTransfermarktBroadPositionFilters(settings) {
    const selected = [];
    if (settings.posGK) selected.push({ alignment: 'Torwart', detailId: 'alle', label: 'GK' });
    if (settings.posDEF) selected.push({ alignment: 'Abwehr', detailId: 'alle', label: 'DEF' });
    if (settings.posMID) selected.push({ alignment: 'Mittelfeld', detailId: 'alle', label: 'MID' });
    if (settings.posFWD) selected.push({ alignment: 'Sturm', detailId: 'alle', label: 'FWD' });
    if (selected.length === 0 || selected.length === 4) return [{ alignment: 'alle', detailId: 'alle', label: 'all positions' }];
    return selected;
  }

  function getTransfermarktDetailPositionFilters(settings) {
    const detailMap = [
      ['detailGK', 'Torwart', '1', 'GK'],
      ['detailCB', 'Abwehr', '3', 'CB'],
      ['detailLB', 'Abwehr', '4', 'LB'],
      ['detailRB', 'Abwehr', '5', 'RB'],
      ['detailDM', 'Mittelfeld', '6', 'DM'],
      ['detailCM', 'Mittelfeld', '7', 'CM'],
      ['detailRM', 'Mittelfeld', '8', 'RM'],
      ['detailLM', 'Mittelfeld', '9', 'LM'],
      ['detailAM', 'Mittelfeld', '10', 'AM'],
      ['detailLW', 'Sturm', '11', 'LW'],
      ['detailRW', 'Sturm', '12', 'RW'],
      ['detailSS', 'Sturm', '13', 'SS'],
      ['detailCF', 'Sturm', '14', 'CF']
    ];
    const selected = detailMap
      .filter(function detailEnabled(item) { return Boolean(settings[item[0]]); })
      .map(function toSourceFilter(item) { return { alignment: item[1], detailId: item[2], label: item[3] }; });

    // TM has no exact "unknown winger" detail source. Use the striker group as a
    // coarse source, then the local precise position prefilter keeps only WING.
    if (settings.detailWING) selected.push({ alignment: 'Sturm', detailId: 'alle', label: 'WING fallback' });

    const allKnownDetailsEnabled = detailMap.every(function detailEnabled(item) { return Boolean(settings[item[0]]); });
    if ((selected.length === 0 || allKnownDetailsEnabled) && !settings.detailWING && !settings.detailOther) {
      return [{ alignment: 'alle', detailId: 'alle', label: 'all positions' }];
    }
    if (allKnownDetailsEnabled && settings.detailWING && settings.detailOther) {
      return [{ alignment: 'alle', detailId: 'alle', label: 'all positions' }];
    }

    return uniquePositionSourceFilters(selected);
  }

  function uniquePositionSourceFilters(filters) {
    const seen = new Set();
    return filters.filter(function keep(filter) {
      const key = `${filter.alignment}|${filter.detailId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function buildSourcePlan(settings) {
    if (isU21Mode(settings)) return buildU21SourcePlan(settings);
    return buildContractSourcePlan(settings);
  }

  function buildContractSourcePlan(settings) {
    const year = normalizeYear(settings.contractYear);
    const sourceFilters = buildSourceFilterCombos(settings);
    const selectedContractCountries = getContractSelectedCountryKeys(settings);
    const contractLandIds = getSelectedContractNationalityLandIds(settings);
    const sourceLandIds = contractLandIds.length ? contractLandIds.slice() : ['0'];
    if (selectedContractCountries.length > contractLandIds.length && !sourceLandIds.includes('0')) sourceLandIds.push('0');
    state.debug.contractNationalityLandIds = sourceLandIds.slice();
    state.debug.sourceFilterCombos = sourceFilters.map(function debugCombo(combo) {
      return {
        ageClass: combo.ageClass,
        alignment: combo.alignment,
        detailId: combo.detailId,
        label: combo.label,
        weight: combo.weight
      };
    });

    const coreSources = [];
    sourceLandIds.forEach(function addContractNationalitySource(landId) {
      sourceFilters.forEach(function addCoreSource(filter) {
        const natLabel = landId && landId !== '0' ? ` · nat ${landId}` : '';
        coreSources.push({
          url: buildContractEndingQueryUrl(year, filter, landId),
          type: 'contract-expiring',
          label: `Contracts ending ${year}${natLabel}${filter.label ? ` · ${filter.label}` : ''}`,
          sourceGroup: 'core-contracts-year',
          pageLimitMode: 'deep',
          sourceNationalityLandId: landId,
          sourceFilterWeight: filter.weight || 0
        });
      });
    });

    if (settings.includeFreeAgents) {
      sourceLandIds.forEach(function addFreeNationalitySource(landId) {
        const natLabel = landId && landId !== '0' ? ` · nat ${landId}` : '';
        sourceFilters.forEach(function addFreeAgentSource(filter) {
          coreSources.push({
            url: buildFreeAgentQueryUrl(filter, landId),
            type: 'free-agent',
            label: `Current free agents${natLabel}${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'current-free-agents',
            pageLimitMode: 'free-agent',
            sourceNationalityLandId: landId,
            sourceFilterWeight: filter.weight || 0
          });
        });

        buildFreeAgentRecoveryFilters(sourceFilters, settings).forEach(function addFreeAgentRecoverySource(filter) {
          coreSources.push({
            url: buildFreeAgentQueryUrl(filter, landId),
            type: 'free-agent',
            label: `Free-agent recovery${natLabel}${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'current-free-agents-recovery',
            pageLimitMode: 'free-agent-recovery',
            sourceNationalityLandId: landId,
            sourceFilterWeight: filter.weight || 0
          });
        });
      });
    }

    const leagueSources = [];
    if (settings.europeLeaguePages) {
      getPrimaryCompetitionCodes(settings).forEach(function addLeague(code) {
        sourceLandIds.forEach(function addLeagueNationality(landId) {
          sourceFilters.forEach(function addLeagueFilter(filter) {
            const natLabel = landId && landId !== '0' ? ` · nat ${landId}` : '';
            leagueSources.push({
              url: buildCompetitionContractEndingQueryUrl(code, year, filter, landId),
              type: 'contract-expiring',
              label: `League ${code} contracts ending${natLabel}${filter.label ? ` · ${filter.label}` : ''}`,
              sourceGroup: 'europe-league-contracts',
              pageLimitMode: 'league',
              sourceNationalityLandId: landId,
              sourceFilterWeight: filter.weight || 0,
              competitionCode: code
            });
          });
        });
      });
    }

    const lowerLeagueSources = [];
    if (settings.lowerLeaguePages) {
      getLowerCompetitionCodes(settings).forEach(function addLowerLeague(code) {
        sourceLandIds.forEach(function addLowerNationality(landId) {
          sourceFilters.forEach(function addLowerFilter(filter) {
            const natLabel = landId && landId !== '0' ? ` · nat ${landId}` : '';
            lowerLeagueSources.push({
              url: buildCompetitionContractEndingQueryUrl(code, year, filter, landId),
              type: 'contract-expiring',
              label: `Lower league ${code} contracts ending${natLabel}${filter.label ? ` · ${filter.label}` : ''}`,
              sourceGroup: 'strong-lower-league-contracts',
              pageLimitMode: 'lower-league',
              sourceNationalityLandId: landId,
              sourceFilterWeight: filter.weight || 0,
              competitionCode: code
            });
          });
        });
      });
    }

    const extraSources = parseExtraUrls(settings.extraSourceUrls).map(function addExtra(url) {
      return {
        url: normalizeTransfermarktUrl(url),
        type: detectSourceTypeFromUrl(url),
        label: 'Extra source',
        sourceGroup: 'extra',
        sourceFilterWeight: 0,
        pageLimitMode: 'extra'
      };
    }).filter(function validSource(source) { return source.url && isAllowedTransfermarktSource(source.url); });

    const cleanSources = [];
    function collectSources(list) {
      (list || []).forEach(function collect(source) {
        const cleanUrl = normalizeTransfermarktUrl(source.url);
        if (!cleanUrl || !isAllowedTransfermarktSource(cleanUrl)) return;
        cleanSources.push(Object.assign({}, source, { url: cleanUrl }));
      });
    }

    collectSources(coreSources);
    collectSources(leagueSources);
    collectSources(lowerLeagueSources);
    extraSources.forEach(function addExtraSource(source) { cleanSources.push(source); });

    const maxCorePages = Math.max(1, Number(settings.maxSourcePages || DEFAULTS.maxSourcePages || 20));
    const maxTotalSources = getContractSourceBudget(settings, sourceFilters.length);
    const seen = new Set();
    const plan = [];

    function adaptivePageLimit(source) {
      const weight = Number(source.sourceFilterWeight || 0);
      let limit = Math.min(maxCorePages, 2);
      if (source.pageLimitMode === 'extra') limit = Math.min(maxCorePages, 8);
      else if (source.pageLimitMode === 'deep') limit = weight >= 2 ? Math.min(maxCorePages, 6) : weight === 1 ? Math.min(maxCorePages, 10) : Math.min(maxCorePages, 18);
      else if (source.pageLimitMode === 'league') limit = weight >= 1 ? 1 : Math.min(maxCorePages, 2);
      else if (source.pageLimitMode === 'lower-league') limit = 1;
      else if (source.pageLimitMode === 'free-agent') limit = weight >= 1 ? Math.min(maxCorePages, 6) : Math.min(maxCorePages, 8);
      else if (source.pageLimitMode === 'free-agent-recovery') limit = weight >= 2 ? Math.min(maxCorePages, 10) : Math.min(maxCorePages, 14);
      return applyContractMvPageLimit(settings, source, limit, maxCorePages);
    }

    function sourcePriority(source) {
      const group = String(source.sourceGroup || '');
      const codeScore = source.competitionCode ? getU21CompetitionPriority(source.competitionCode, settings) : 0;
      const weightPenalty = Number(source.sourceFilterWeight || 0) * 2;
      if (group === 'extra') return 120 - weightPenalty;
      if (group === 'core-contracts-year') return 110 - weightPenalty;
      if (group === 'current-free-agents') return 105 - weightPenalty;
      if (group === 'current-free-agents-recovery') return 101 - weightPenalty;
      if (group === 'europe-league-contracts') return 74 + (codeScore / 10) - weightPenalty;
      if (group === 'strong-lower-league-contracts') return 64 + (codeScore / 12) - weightPenalty;
      return 50 - weightPenalty;
    }

    const targets = cleanSources.map(function toTarget(source) {
      const pageLimit = adaptivePageLimit(source);
      state.debug.adaptivePageLimits.push({
        group: source.sourceGroup,
        label: source.label,
        filterWeight: source.sourceFilterWeight || 0,
        pageLimit: pageLimit,
        sourceBudget: maxTotalSources,
        note: 'contract focused source budget'
      });
      return { source: source, pageLimit: pageLimit, priority: sourcePriority(source) };
    }).sort(function byPriority(a, b) {
      return (b.priority - a.priority)
        || ((a.source.sourceFilterWeight || 0) - (b.source.sourceFilterWeight || 0))
        || String(a.source.label || '').localeCompare(String(b.source.label || ''));
    });

    function addPlannedSource(source, page, pageLimit) {
      const pagedUrl = addTransfermarktPage(source.url, page);
      const key = pagedUrl.replace(/\/$/, '');
      if (seen.has(key)) return;
      seen.add(key);
      plan.push(Object.assign({}, source, {
        url: pagedUrl,
        page: page,
        plannedPageLimit: pageLimit,
        label: page > 1 ? `${source.label || source.type} p.${page}` : source.label
      }));
    }

    for (let page = 1; page <= maxCorePages && plan.length < maxTotalSources; page += 1) {
      for (const target of targets) {
        if (plan.length >= maxTotalSources) break;
        if (page > target.pageLimit) continue;
        addPlannedSource(target.source, page, target.pageLimit);
      }
    }

    return plan;
  }


  function applyContractMvPageLimit(settings, source, baseLimit, maxCorePages) {
    const limit = Math.max(1, Number(baseLimit || 1));
    const maxPages = Math.max(1, Number(maxCorePages || limit));
    const minMv = Number(settings && settings.minMv || 0);
    const maxMv = Number(settings && settings.maxMv || 0);
    const mode = String(source && source.pageLimitMode || '');

    // TM contract/free-agent tables are market-value sorted but do not expose a reliable
    // min/max MV URL parameter. So MV still cuts candidates before profile enrich,
    // while this cap prevents obviously pointless deep pages for high-MV searches and
    // gives lower-MV searches enough depth to reach the requested band.
    const isFreeAgentSource = mode === 'free-agent' || mode === 'free-agent-recovery';
    const depth = normalizeSearchDepth(settings && settings.searchDepth);
    const depthBoost = depth === 'deep' ? 1.45 : depth === 'fast' ? 0.72 : 1;
    function depthLimit(value) { return Math.max(1, Math.min(maxPages, Math.ceil(Number(value || 1) * depthBoost))); }

    if (minMv >= 10000000) return depth === 'deep' ? Math.min(maxPages, 3) : Math.min(limit, 2);
    if (minMv >= 5000000) return Math.min(limit, mode === 'deep' ? 4 : isFreeAgentSource ? 2 : 1);
    if (minMv >= 1000000) return Math.min(limit, mode === 'deep' ? 8 : isFreeAgentSource ? 5 : 2);

    if (isFreeAgentSource) {
      if (maxMv > 0 && maxMv <= 250000) return depthLimit(Math.max(limit, 32));
      if (maxMv > 0 && maxMv <= 500000) return depthLimit(Math.max(limit, 28));
      if (maxMv > 0 && maxMv <= 650000) return depthLimit(Math.max(limit, 24));
      if (maxMv > 0 && maxMv <= 800000) return depthLimit(Math.max(limit, 20));
      if (maxMv > 0 && maxMv <= 1200000) return depthLimit(Math.max(limit, 14));
    }

    if (maxMv > 0 && maxMv <= 250000 && mode === 'deep') return depthLimit(Math.max(limit, 24));
    if (maxMv > 0 && maxMv <= 500000 && mode === 'deep') return Math.min(maxPages, Math.max(limit, 22));
    if (maxMv > 0 && maxMv <= 800000 && mode === 'deep') return depthLimit(Math.max(limit, 20));
    return limit;
  }

  function candidateTargetBudgetMultiplier(settings, u21Mode) {
    const fallback = u21Mode ? DEFAULTS.u21MaxCandidates : DEFAULTS.maxCandidates;
    const target = Math.max(1, Number(u21Mode ? settings.u21MaxCandidates : settings.maxCandidates) || fallback);
    const baseline = Math.max(1, Number(fallback || 1));
    // Keep the default deep behavior, then widen the source plan when the user explicitly asks for more candidates.
    // This avoids another UI toggle while still making "Max candidates" the real search-depth dial.
    if (target <= baseline) return 1;
    return Math.min(2.6, 1 + ((target - baseline) / baseline) * 0.65);
  }

  function getContractSourceBudget(settings, sourceFilterCount) {
    const requested = Math.max(1, Number(settings.maxSourcePages || DEFAULTS.maxSourcePages || 20));
    const filterCount = Math.max(1, Number(sourceFilterCount || 1));
    let multiplier = 1;
    if (settings.europeLeaguePages) multiplier += 1.25;
    if (settings.lowerLeaguePages) multiplier += 0.75;
    if (settings.includeFreeAgents) multiplier += 1.05;
    if (settings.includeFreeAgents && Number(settings.maxMv || 0) > 0 && Number(settings.maxMv || 0) <= 800000) multiplier += 0.55;
    const nationalityCount = Math.max(1, getSelectedContractNationalityLandIds(settings).length || 1);
    if (nationalityCount > 1) multiplier += Math.min(1.2, nationalityCount * 0.22);
    if (filterCount > 1) multiplier += Math.min(1.5, filterCount * 0.18);
    multiplier *= searchDepthBudgetMultiplier(settings);
    multiplier *= candidateTargetBudgetMultiplier(settings, false);
    // This is a total source-page budget, not leagues × filters × pages.
    return Math.max(8, Math.min(760, Math.round(requested * multiplier)));
  }



  function getSelectedCountryKeys(values) {
    return (values || []).map(function normalizeCountry(value) {
      return getCountryCanonicalKey(value);
    }).filter(Boolean);
  }

  function getU21SelectedCountryKeys(settings) {
    return getSelectedCountryKeys(settings.u21Nationalities || []);
  }

  function getContractSelectedCountryKeys(settings) {
    return getSelectedCountryKeys(settings.contractNationalities || []);
  }

  function getTransfermarktNationalityLandId(countryKey) {
    const record = getCountryRecord(countryKey);
    const key = record ? record.key : cleanText(countryKey);
    return TM_NATIONALITY_LAND_IDS[key] || '';
  }

  function getSelectedU21NationalityLandIds(settings) {
    return unique(getU21SelectedCountryKeys(settings).map(getTransfermarktNationalityLandId).filter(Boolean));
  }

  function getSelectedContractNationalityLandIds(settings) {
    return unique(getContractSelectedCountryKeys(settings).map(getTransfermarktNationalityLandId).filter(Boolean));
  }

  function getU21DomesticCompetitionBoost(code, settings) {
    const c = String(code || '').toUpperCase();
    const countryKeys = getU21SelectedCountryKeys(settings);
    if (!countryKeys.length) return 0;
    const domesticCodes = {
      'romania': ['RO1', 'RO2'],
      'hungary': ['UNG1', 'UNG2']
    };
    for (const country of countryKeys) {
      const key = normalizeText(country);
      if ((domesticCodes[key] || []).includes(c)) return 18;
    }
    return 0;
  }

  function getU21NationalTeamSourceUrls(settings) {
    const selected = getU21SelectedCountryKeys(settings);

    if (!selected.length) return [];

    const nationalSources = {
      'romania': [
        ['Romania U21', 'https://www.transfermarkt.com/romania-u21/startseite/verein/16864/sort/marketValueRaw'],
        ['Romania U21', 'https://www.transfermarkt.com/romania-u21/startseite/verein/16864/sort/name'],
        ['Romania U19', 'https://www.transfermarkt.com/romania-u19/startseite/verein/21428/sort/marketValueRaw'],
        ['Romania U19', 'https://www.transfermarkt.com/romania-u19/startseite/verein/21428/sort/name'],
        ['Romania U19', 'https://www.transfermarkt.com/romania-u19/startseite/verein/21428/sort/dateOfBirthTimestamp']
      ],
      'hungary': [
        ['Hungary U21', 'https://www.transfermarkt.com/hungary-u21/startseite/verein/22514/sort/marketValueRaw'],
        ['Hungary U21', 'https://www.transfermarkt.com/hungary-u21/startseite/verein/22514/sort/name'],
        ['Hungary U19', 'https://www.transfermarkt.com/ungarn-u19/startseite/verein/22513/sort/marketValueRaw'],
        ['Hungary U19', 'https://www.transfermarkt.com/ungarn-u19/startseite/verein/22513/sort/name']
      ],
      'serbia': [
        ['Serbia U21', 'https://www.transfermarkt.com/serbia-u21/startseite/verein/9566/sort/marketValueRaw'],
        ['Serbia U21', 'https://www.transfermarkt.com/serbia-u21/startseite/verein/9566/sort/name'],
        ['Serbia U19', 'https://www.transfermarkt.com/serbia-u19/startseite/verein/17383/sort/marketValueRaw'],
        ['Serbia U19', 'https://www.transfermarkt.com/serbia-u19/startseite/verein/17383/sort/name'],
        ['Serbia U19', 'https://www.transfermarkt.com/serbien-u19/startseite/verein/17383/sort/marketValueRaw']
      ],
      'croatia': [
        ['Croatia U21', 'https://www.transfermarkt.com/croatia-u21/startseite/verein/11943/sort/marketValueRaw'],
        ['Croatia U21', 'https://www.transfermarkt.com/croatia-u21/startseite/verein/11943/sort/name'],
        ['Croatia U19', 'https://www.transfermarkt.com/kroatien-u19/startseite/verein/17379/sort/marketValueRaw'],
        ['Croatia U19', 'https://www.transfermarkt.com/kroatien-u19/startseite/verein/17379/sort/name']
      ],
      'ukraine': [
        ['Ukraine U21', 'https://www.transfermarkt.com/ukraine-u21/startseite/verein/16274/sort/marketValueRaw'],
        ['Ukraine U21', 'https://www.transfermarkt.com/ukraine-u21/startseite/verein/16274/sort/name']
      ]
    };

    const out = [];
    selected.forEach(function addSelected(countryKey) {
      const key = normalizeText(countryKey);
      (nationalSources[key] || []).forEach(function addEntry(entry) {
        out.push({ label: entry[0], url: entry[1] });
      });
    });

    return unique(out.map(function toKeyed(item) { return item.label + '|' + item.url; })).map(function fromKey(key) {
      const parts = key.split('|');
      return {
        url: parts.slice(1).join('|'),
        type: 'u21-prospect',
        label: parts[0] + ' squad seed',
        sourceGroup: 'u21-national-squad-seed',
        page: 1,
        plannedPageLimit: 1,
        sourceFilterWeight: 0
      };
    });
  }

  function buildU21SourcePlan(settings) {
    const sourceFilters = buildU21CompactSourceFilters(settings);
    state.debug.sourceFilterCombos = sourceFilters.map(function debugCombo(combo) {
      return {
        ageClass: combo.ageClass,
        alignment: combo.alignment,
        detailId: combo.detailId,
        label: combo.label,
        weight: combo.weight
      };
    });

    const requestedPages = Math.max(1, Number(settings.u21MaxSourcePages || DEFAULTS.u21MaxSourcePages || 16));
    const maxTotalSources = getU21TotalSourceBudget(settings, sourceFilters.length);
    const nationalityLandIds = getSelectedU21NationalityLandIds(settings);
    const knownNationalityMode = nationalityLandIds.length > 0;
    const seen = new Set();
    const plan = [];

    // U21/U19 national-team seeds are kept because they catch no-MV academy players too.
    for (const seed of getU21NationalTeamSourceUrls(settings)) {
      if (plan.length >= maxTotalSources) break;
      const key = seed.url.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      plan.push(seed);
      state.debug.adaptivePageLimits.push({
        group: seed.sourceGroup,
        label: seed.label,
        filterWeight: 0,
        pageLimit: 1,
        sourceBudget: maxTotalSources,
        note: 'selected-nationality youth squad seed; keeps no-MV prospects alive'
      });
    }

    const targets = [];

    if (knownNationalityMode) {
      // This is the important optimization: when Romania/Hungary/etc. is selected and we know TM land_id,
      // do not scan every league page first. Use global nationality-filtered U21 market-value pages.
      // It still finds players anywhere in the world, but the source pages are already nationality-narrowed.
      nationalityLandIds.forEach(function addNationality(landId) {
        sourceFilters.forEach(function addFilter(filter) {
          const pageLimit = getU21NationalityMvPageLimit(settings, filter, requestedPages);
          targets.push({
            url: buildGlobalU21MarketValuesQueryUrl(filter, landId),
            label: `U21 global nationality ${landId}${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'u21-global-nationality-mv-search',
            landId: landId,
            filter: filter,
            pageLimit: pageLimit,
            priority: 105 - Number(filter.weight || 0)
          });
          state.debug.adaptivePageLimits.push({
            group: 'u21-global-nationality-mv-search',
            label: `land_id ${landId}${filter.label ? ` · ${filter.label}` : ''}`,
            filterWeight: filter.weight || 0,
            pageLimit: pageLimit,
            sourceBudget: maxTotalSources,
            note: 'nationality-first global U21 source; MV range controls depth'
          });
        });
      });

      // A tiny competition sweep remains as a fallback for table quirks, but it is not multiplied into 700+ pages.
      buildU21CompactCompetitionCodes(settings).slice(0, 18).forEach(function addCompactCompetition(code) {
        const p = getU21CompetitionPriority(code, settings) + getU21DomesticCompetitionBoost(code, settings);
        sourceFilters.slice(0, 2).forEach(function addFilter(filter) {
          nationalityLandIds.forEach(function addLand(landId) {
            targets.push({
              url: buildCompetitionMarketValuesQueryUrl(code, filter, landId),
              label: `U21 ${code}${filter.label ? ` · ${filter.label}` : ''} · nat ${landId}`,
              sourceGroup: 'u21-compact-competition-nationality-search',
              landId: landId,
              filter: filter,
              pageLimit: 1,
              priority: 72 + (p / 20) - Number(filter.weight || 0)
            });
          });
        });
      });

      if (getU21SelectedCountryKeys(settings).length > nationalityLandIds.length) {
        unique(buildU21CompactCompetitionCodes(settings)).slice(0, 18).forEach(function addUnknownLandFallback(code) {
          const basePriority = getU21CompetitionPriority(code, settings);
          sourceFilters.slice(0, 2).forEach(function addFilter(filter) {
            targets.push({
              url: buildCompetitionMarketValuesQueryUrl(code, filter, '0'),
              label: `U21 ${code}${filter.label ? ` · ${filter.label}` : ''} · all-nationalities fallback`,
              sourceGroup: 'u21-unknown-nationality-fallback',
              filter: filter,
              pageLimit: 1,
              priority: 48 + (basePriority / 25) - Number(filter.weight || 0)
            });
          });
        });
      }
    } else {
      // Unknown/no selected nationality: fall back to a compact league sweep.
      unique(buildU21CompactCompetitionCodes(settings)).forEach(function addCompetition(code) {
        const basePriority = getU21CompetitionPriority(code, settings);
        const codePriority = basePriority + getU21DomesticCompetitionBoost(code, settings);
        sourceFilters.forEach(function addFilter(filter) {
          const pageLimit = getU21SourcePageLimit(code, filter.weight || 0, requestedPages, settings, basePriority);
          targets.push({
            url: buildCompetitionMarketValuesQueryUrl(code, filter, '0'),
            label: `U21 ${code}${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'u21-compact-broad-mv-search',
            filter: filter,
            pageLimit: pageLimit,
            priority: codePriority - Number(filter.weight || 0)
          });
          state.debug.adaptivePageLimits.push({
            group: 'u21-compact-broad-mv-search',
            label: `U21 ${code}${filter.label ? ` · ${filter.label}` : ''}`,
            filterWeight: filter.weight || 0,
            pageLimit: pageLimit,
            sourceBudget: maxTotalSources,
            note: 'no known nationality land_id; compact league source search'
          });
        });
      });
    }

    addU21GlobalRecoveryTargets(settings, sourceFilters, requestedPages, maxTotalSources, nationalityLandIds, knownNationalityMode, targets);

    targets.sort(function bySignal(a, b) {
      return (b.priority - a.priority)
        || ((a.filter && a.filter.weight || 0) - (b.filter && b.filter.weight || 0))
        || String(a.label || '').localeCompare(String(b.label || ''));
    });

    for (let page = 1; page <= requestedPages && plan.length < maxTotalSources; page += 1) {
      for (const target of targets) {
        if (plan.length >= maxTotalSources) break;
        if (page > target.pageLimit) continue;
        const pagedUrl = addTransfermarktPage(target.url, page);
        const key = pagedUrl.replace(/\/$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        plan.push({
          url: pagedUrl,
          type: 'u21-prospect',
          label: `${target.label}${page > 1 ? ` p.${page}` : ''}`,
          sourceGroup: target.sourceGroup,
          page: page,
          plannedPageLimit: target.pageLimit,
          sourceFilterWeight: target.filter ? target.filter.weight || 0 : 0
        });
      }
    }

    return plan;
  }

  function addU21GlobalRecoveryTargets(settings, sourceFilters, requestedPages, maxTotalSources, nationalityLandIds, knownNationalityMode, targets) {
    const depth = normalizeSearchDepth(settings && settings.searchDepth);
    if (depth === 'fast') return;

    const selectedCountryCount = getU21SelectedCountryKeys(settings).length;
    const useSpecificLandIds = Array.isArray(nationalityLandIds) && nationalityLandIds.length > 0;
    const landIds = useSpecificLandIds ? nationalityLandIds.slice() : ['0'];
    const sliceCount = depth === 'deep' ? 4 : 2;
    const chosenFilters = (sourceFilters || []).slice(0, sliceCount);

    landIds.forEach(function addLand(landId) {
      chosenFilters.forEach(function addFilter(filter) {
        const baseLimit = getU21NationalityMvPageLimit(settings, filter, requestedPages);
        const pageLimit = depth === 'deep' ? Math.min(requestedPages, baseLimit + 4) : baseLimit;
        targets.push({
          url: buildGlobalU21MarketValuesQueryUrl(filter, landId),
          label: `U21 global recovery${landId && landId !== '0' ? ` · nat ${landId}` : ''}${filter.label ? ` · ${filter.label}` : ''}`,
          sourceGroup: useSpecificLandIds ? 'u21-global-known-nationality-recovery' : (selectedCountryCount ? 'u21-global-local-nationality-recovery' : 'u21-global-all-nationalities-recovery'),
          landId: landId,
          filter: filter,
          pageLimit: pageLimit,
          priority: (useSpecificLandIds ? 96 : selectedCountryCount ? 82 : 76) - Number(filter.weight || 0)
        });
        state.debug.adaptivePageLimits.push({
          group: useSpecificLandIds ? 'u21-global-known-nationality-recovery' : 'u21-global-local-nationality-recovery',
          label: `U21 global recovery land_id ${landId}${filter.label ? ` · ${filter.label}` : ''}`,
          filterWeight: filter.weight || 0,
          pageLimit: pageLimit,
          sourceBudget: maxTotalSources,
          note: useSpecificLandIds ? 'known nationality land_id recovery' : 'all-nationality global recovery + local exact nationality filter'
        });
      });
    });
  }

  function getU21TotalSourceBudget(settings, sourceFilterCount) {
    const requested = Math.max(1, Number(settings.u21MaxSourcePages || DEFAULTS.u21MaxSourcePages || 16));
    const filterCount = Math.max(1, Number(sourceFilterCount || 1));
    const hasKnownNationality = getSelectedU21NationalityLandIds(settings).length > 0;
    const nationalities = Math.max(1, hasKnownNationality ? getSelectedU21NationalityLandIds(settings).length : 1);
    const depthMul = searchDepthBudgetMultiplier(settings) * candidateTargetBudgetMultiplier(settings, true);
    if (hasKnownNationality) {
      // Nationality-filtered global pages are much denser, so the total plan should stay compact.
      return Math.max(12, Math.min(360, Math.round(((requested * 0.75) + (filterCount * nationalities * 8)) * depthMul)));
    }
    return Math.max(18, Math.min(520, Math.round(requested * (filterCount > 1 ? 1.8 : 2.4) * depthMul)));
  }

  function getU21NationalityMvPageLimit(settings, filter, requestedPages) {
    const requested = Math.max(1, Number(requestedPages || DEFAULTS.u21MaxSourcePages || 16));
    const minMv = Number(settings.u21MinMv || 0);
    const maxMv = Number(settings.u21MaxMv || 0);
    const weightPenalty = Number(filter && filter.weight || 0) >= 2 ? 1 : 0;

    // Global nationality pages are sorted by market value. MV range cannot be perfectly expressed in the URL,
    // but the selected MV band decides how deep we go. Low max-MV bands need a few more pages to reach cheaper players.
    let limit = 8;
    if (maxMv > 0 && maxMv <= 250000) limit = 15;
    else if (maxMv > 0 && maxMv <= 500000) limit = 12;
    else if (maxMv > 0 && maxMv <= 1000000) limit = 9;
    else if (minMv >= 1000000) limit = 4;
    else if (minMv >= 500000) limit = 6;
    if (normalizeSearchDepth(settings && settings.searchDepth) === 'deep') limit += 5;
    if (normalizeSearchDepth(settings && settings.searchDepth) === 'fast') limit -= 3;
    return Math.max(2, Math.min(requested, limit - weightPenalty));
  }

  function buildGlobalU21MarketValuesQueryUrl(filter, landId) {
    const f = normalizeSourceFilter(filter);
    const url = new URL('https://www.transfermarkt.com/spieler-statistik/wertvollstespieler/marktwertetop/mw/plus/1');
    url.searchParams.set('ausrichtung', f.alignment);
    url.searchParams.set('spielerposition_id', f.detailId);
    url.searchParams.set('altersklasse', f.ageClass);
    url.searchParams.set('land_id', String(landId || '0'));
    url.searchParams.set('yt0', 'Show');
    return url.toString();
  }


  function buildU21CompactSourceFilters(settings) {
    const ageClass = getTransfermarktAgeClassForRange(settings.u21MinAge, settings.u21MaxAge);
    const base = { ageClass: ageClass, alignment: 'alle', detailId: 'alle', label: `age ${ageClass}`, weight: 0 };
    const mode = normalizePositionFilterMode(settings.positionFilterMode);

    if (mode !== 'detail') {
      const selected = [];
      if (settings.posGK) selected.push({ ageClass, alignment: 'Torwart', detailId: 'alle', label: 'GK', weight: 1 });
      if (settings.posDEF) selected.push({ ageClass, alignment: 'Abwehr', detailId: 'alle', label: 'DEF', weight: 1 });
      if (settings.posMID) selected.push({ ageClass, alignment: 'Mittelfeld', detailId: 'alle', label: 'MID', weight: 1 });
      if (settings.posFWD) selected.push({ ageClass, alignment: 'Sturm', detailId: 'alle', label: 'FWD', weight: 1 });
      if (!selected.length || selected.length >= 4) return [base];
      return selected.slice(0, 4);
    }

    const detailMap = [
      ['detailGK', 'Torwart', '1', 'GK'],
      ['detailCB', 'Abwehr', '3', 'CB'],
      ['detailLB', 'Abwehr', '4', 'LB'],
      ['detailRB', 'Abwehr', '5', 'RB'],
      ['detailDM', 'Mittelfeld', '6', 'DM'],
      ['detailCM', 'Mittelfeld', '7', 'CM'],
      ['detailRM', 'Mittelfeld', '8', 'RM'],
      ['detailLM', 'Mittelfeld', '9', 'LM'],
      ['detailAM', 'Mittelfeld', '10', 'AM'],
      ['detailLW', 'Sturm', '11', 'LW'],
      ['detailRW', 'Sturm', '12', 'RW'],
      ['detailSS', 'Sturm', '13', 'SS'],
      ['detailCF', 'Sturm', '14', 'CF']
    ];
    const selected = detailMap
      .filter(function enabled(item) { return Boolean(settings[item[0]]); })
      .map(function toFilter(item) { return { ageClass, alignment: item[1], detailId: item[2], label: item[3], weight: 2 }; });

    // If nearly everything is checked, one all-position source is much faster and avoids 5000+ URLs.
    if (!selected.length || selected.length > 5 || (selected.length >= 4 && settings.detailWING && settings.detailOther)) return [base];
    return uniquePositionSourceFilters(selected).slice(0, 5);
  }

  function getTransfermarktAgeClassForRange(minAge, maxAge) {
    const min = Number(minAge || 0);
    const max = Number(maxAge || 99);
    if (max <= 16) return 'u17';
    if (max <= 17) return 'u18';
    if (max <= 18) return 'u19';
    if (max <= 19) return 'u20';
    if (max <= 20) return 'u21';
    if (max <= 22) return 'u23';
    if (min <= 22) return 'u23';
    return 'alle';
  }

  function buildU21CompactCompetitionCodes(settings) {
    const codes = [];
    const add = function add(code) { if (code) codes.push(String(code).toUpperCase()); };
    const addMany = function addMany(list) { (list || []).forEach(add); };

    // A kiválasztott nemzetiség csak játékosfilter. Forrásoldalnál szélesen keresünk,
    // mert egy román/magyar/szerb/ukrán U21 bárhol játszhat Európában.
    if (settings.europeLeaguePages) addMany(getPrimaryCompetitionCodes(settings));
    if (settings.lowerLeaguePages) addMany(getLowerCompetitionCodes(settings));

    // Hasznos extra utánpótlás / alacsonyabb piaci források, ahol fiatal profilok gyakran vannak.
    addMany(['GB3', 'L3', 'FR3', 'IT3A', 'IT3B', 'IT3C', 'E3G1', 'E3G2', 'PL3', 'SC3', 'C3']);

    if (!codes.length) addMany(getPrimaryCompetitionCodes(settings).concat(getLowerCompetitionCodes(settings)));

    const limit = getSelectedU21NationalityLandIds(settings).length ? 48 : 72;
    return unique(codes).sort(function byPriority(a, b) {
      return (getU21CompetitionPriority(b, settings) + getU21DomesticCompetitionBoost(b, settings)) - (getU21CompetitionPriority(a, settings) + getU21DomesticCompetitionBoost(a, settings))
        || String(a).localeCompare(String(b));
    }).slice(0, limit);
  }

  function getU21CompetitionPriority(code, settings) {
    const c = String(code || '').toUpperCase();

    if (/^(GB1|ES1|IT1|L1|FR1)$/.test(c)) return 92;
    if (/^(NL1|PO1|BE1|TR1|A1|C1|DK1|SE1|NO1|PL1|SC1|GR1)$/.test(c)) return 84;
    if (/^(RO1|UNG1|SER1|KRO1|UKR1|SLO1|TS1|BUL1|ZYP1|ISR1|FIN1|IR1)$/.test(c)) return 78;
    if (/^(GB2|ES2|IT2|L2|FR2|NL2|PO2|BE2|TR2|A2|C2|DK2|SE2|NO2|PL2|SC2|GR2)$/.test(c)) return 74;
    if (/^(RO2|UNG2|SER2|KRO2|UKR2|SLO2|TS2|BUL2|ZYP2|ISR2|FIN2|IR2)$/.test(c)) return 72;
    if (/^(GB3|L3|FR3|IT3A|IT3B|IT3C|E3G1|E3G2|PL3|SC3|C3)$/.test(c)) return 68;
    if (/2$|3$|3A$|3B$|3C$|E3|USL/.test(c)) return 62;
    return 55;
  }

  function getU21SourcePageLimit(code, filterWeight, maxPages, settings, priority) {
    const requested = Math.max(1, Number(maxPages || DEFAULTS.u21MaxSourcePages || 16));
    const c = String(code || '').toUpperCase();
    const p = Number(priority || getU21CompetitionPriority(c, settings));
    const filterPenalty = Number(filterWeight || 0) >= 2 ? 1 : 0;

    const depthExtra = normalizeSearchDepth(settings && settings.searchDepth) === 'deep' ? 2 : normalizeSearchDepth(settings && settings.searchDepth) === 'fast' ? -1 : 0;
    if (p >= 90) return Math.max(1, Math.min(requested, 7 + depthExtra - filterPenalty));
    if (p >= 78) return Math.max(1, Math.min(requested, 6 + depthExtra - filterPenalty));
    if (p >= 70) return Math.max(1, Math.min(requested, 5 + depthExtra - filterPenalty));
    if (p >= 62) return Math.max(1, Math.min(requested, 4 + depthExtra - filterPenalty));
    return Math.max(1, Math.min(requested, 3 + depthExtra - filterPenalty));
  }

  function buildCompetitionMarketValuesQueryUrl(code, filter, landId) {
    const cleanCode = String(code || '').trim().toUpperCase();
    const f = normalizeSourceFilter(filter);
    const url = new URL(`https://www.transfermarkt.com/-/marktwerte/wettbewerb/${encodeURIComponent(cleanCode)}/plus/1`);
    url.searchParams.set('ausrichtung', f.alignment);
    url.searchParams.set('spielerposition_id', f.detailId);
    url.searchParams.set('altersklasse', f.ageClass);
    url.searchParams.set('land_id', String(landId || '0'));
    url.searchParams.set('yt0', 'Show');
    return url.toString();
  }

  function addTransfermarktPage(url, page) {
    if (page <= 1) return url;
    try {
      const parsed = new URL(url);
      let path = parsed.pathname.replace(/\/$/, '');

      /*
       * Transfermarkt's current contract-ending filter uses query params:
       * /transfers/endendevertraege/statistik?plus=1&jahr=2026&...
       * Query-based routes must paginate with ?page=N; only legacy /plus/1
       * routes should fall back to /galerie/0/page/N.
       */
      if (/\/transfers\/endendevertraege\/statistik(?:\/|$)/i.test(path)
        || /\/statistik\/(vertragslosespieler|endendevertraege)$/i.test(path)
        || /\/endendevertraege\/wettbewerb\/[A-Z0-9]+(?:\/|$)/i.test(path)) {
        if (parsed.search && parsed.search.length > 1) {
          parsed.searchParams.set('page', String(page));
          return parsed.toString();
        }
        if (/\/page\/\d+$/i.test(path)) {
          path = path.replace(/\/page\/\d+$/i, `/page/${page}`);
        } else {
          path = `${path}/page/${page}`;
        }
        parsed.pathname = path;
        return parsed.toString();
      }

      if (/\/page\/\d+$/i.test(path)) {
        path = path.replace(/\/page\/\d+$/i, `/page/${page}`);
      } else if (/\/plus\/1(?:\/galerie\/0)?$/i.test(path)) {
        path = path.replace(/(?:\/galerie\/0)?$/i, `/galerie/0/page/${page}`);
      } else {
        parsed.searchParams.set('page', String(page));
        return parsed.toString();
      }
      parsed.pathname = path;
      return parsed.toString();
    } catch (_error) {
      return url;
    }
  }

  function getEuropeCompetitionCodes() {
    return [
      'GB1', 'ES1', 'IT1', 'L1', 'FR1', 'NL1', 'PO1', 'TR1', 'BE1', 'SC1',
      'GR1', 'UKR1', 'RU1', 'DK1', 'SE1', 'NO1', 'PL1', 'A1', 'C1', 'RO1',
      'SER1', 'KRO1', 'UNG1', 'SLO1', 'TS1', 'BUL1', 'ZYP1', 'ISR1', 'FIN1', 'IR1'
    ];
  }

  function getStrongLowerCompetitionCodes(depth) {
    const secondTiers = [
      // Big 5 + strong export leagues
      'GB2', 'ES2', 'IT2', 'L2', 'FR2', 'NL2', 'PO2', 'TR2', 'BE2', 'SC2',
      // Strong / useful secondary markets
      'GR2', 'UKR2', 'RU2', 'DK2', 'SE2', 'NO2', 'PL2', 'A2', 'C2', 'RO2',
      'SER2', 'KRO2', 'UNG2', 'SLO2', 'TS2', 'BUL2', 'ZYP2', 'ISR2', 'FIN2', 'IR2'
    ];
    if (normalizeLowerLeagueDepth(depth) !== '2-3') return secondTiers;
    const selectedThirdTiers = [
      // Reliable high-signal third tiers from the best markets
      'GB3', 'L3', 'E3G1', 'E3G2', 'FR3', 'IT3A', 'IT3B', 'IT3C',
      // A few higher-signal third tiers where the target-MV band is still realistic
      'SC3', 'PL3', 'C3'
    ];
    return Array.from(new Set(secondTiers.concat(selectedThirdTiers)));
  }


  function getPrimaryCompetitionCodes(settings) {
    const europe = getEuropeCompetitionCodes();
    if (!settings || settings.europeanClubSourcesOnly !== false) return europe;
    return unique(europe.concat(GLOBAL_EXTRA_FIRST_DIVISION_CODES));
  }

  function getLowerCompetitionCodes(settings) {
    const europeLower = getStrongLowerCompetitionCodes(settings && settings.lowerLeagueDepth);
    if (!settings || settings.europeanClubSourcesOnly !== false) return europeLower;
    const globalLower = ['BRA2','AR2','MEX2','JAP2','USL','CL2','COL2'];
    return unique(europeLower.concat(globalLower));
  }

  function isEuropeanCompetitionCode(code) {
    const normalized = String(code || '').toUpperCase();
    return EUROPE_COMPETITION_CODE_SET.has(normalized);
  }

  function competitionLabel(code) {
    const normalized = String(code || '').toUpperCase();
    return COMPETITION_LABELS[normalized] || normalized;
  }

  function normalizeLowerLeagueDepth(value) {
    return String(value || '').trim() === '2' ? '2' : '2-3';
  }

  function normalizeYear(value) {
    const parsed = parseInt(String(value || '').replace(/\D/g, ''), 10);
    if (!Number.isFinite(parsed) || parsed < 2000 || parsed > 2100) return String(new Date().getFullYear());
    return String(parsed);
  }

  function parseExtraUrls(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function trim(line) { return line.trim(); })
      .filter(Boolean);
  }

  function normalizeTransfermarktUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      if (!/transfermarkt\.(com|us|co\.uk|de|at|world)$/i.test(parsed.hostname)) {
        return '';
      }
      return canonicalizeScoutUrl(parsed.toString());
    } catch (_error) {
      return '';
    }
  }

  function isAllowedTransfermarktSource(url) {
    try {
      const parsed = new URL(url);
      return /transfermarkt\.(com|us|co\.uk|de|at|world)$/i.test(parsed.hostname)
        && /(vertragslosespieler|endendevertraege)/i.test(parsed.pathname);
    } catch (_error) {
      return false;
    }
  }

  function detectSourceTypeFromUrl(url) {
    return /vertragslosespieler/i.test(url) ? 'free-agent' : 'contract-expiring';
  }

  function parseSourcePage(html, source) {
    const doc = parseHtml(html);
    const rows = Array.from(doc.querySelectorAll('table.items tbody tr'));
    const out = [];

    rows.forEach(function parseRow(row) {
      try {
        const profileLink = findProfileLink(row);
        if (!profileLink) return;
        const href = absoluteTransfermarktUrl(profileLink.getAttribute('href'));
        const playerId = extractPlayerId(href);
        if (!playerId) return;

        const rowText = cleanText(row.textContent);
        const playerCell = profileLink.closest('td') || row;
        const sourceType = source.type || detectSourceTypeFromUrl(source.url);
        const position = extractPositionFromRow(row, playerCell);
        const age = extractAgeFromRow(row, rowText);
        const nationality = extractNationalities(row);
        const mv = extractMarketValueFromRow(row, rowText);
        const club = extractClubFromRow(row, profileLink, sourceType);
        const clubIds = extractClubIdsFromRow(row);
        const contractUntil = extractContractDate(rowText);

        out.push({
          playerId: playerId,
          slug: extractSlug(href),
          name: cleanText(profileLink.textContent) || extractNameFallback(playerCell) || `Player ${playerId}`,
          profileUrl: href,
          age: age,
          nationality: nationality,
          position: position,
          positionGroup: positionGroup(position),
          marketValue: mv,
          club: club,
          clubIds: clubIds,
          contractUntil: contractUntil,
          competitionCodes: extractCompetitionCodesFromRow(row, source.url),
          sourceTypes: [sourceType],
          sourceLabels: [source.label || sourceType],
          sourceUrls: [source.url]
        });
      } catch (error) {
        pushError('source row parse failed', stringifyError(error));
      }
    });

    return out;
  }

  function findProfileLink(row) {
    const links = Array.from(row.querySelectorAll('a[href*="/profil/spieler/"]'));
    return links.find(function usable(link) {
      return extractPlayerId(link.getAttribute('href')) && cleanText(link.textContent).length > 1;
    }) || links[0] || null;
  }

  function absoluteTransfermarktUrl(href) {
    try {
      const origin = location.hostname.includes('transfermarkt') ? location.origin : 'https://www.transfermarkt.com';
      return new URL(href || '', origin).toString();
    } catch (_error) {
      return '';
    }
  }

  function extractPlayerId(url) {
    const match = String(url || '').match(/\/spieler\/(\d+)/i);
    return match ? match[1] : '';
  }

  function extractSlug(url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean);
      const idx = parts.indexOf('profil');
      return idx > 0 ? parts[idx - 1] : '';
    } catch (_error) {
      return '';
    }
  }

  function extractCompetitionCodesFromRow(row, sourceUrl) {
    const codes = [];
    collectCompetitionCodesFromText(sourceUrl || '').forEach(function addSourceCode(code) { codes.push(code); });
    Array.from((row && row.querySelectorAll) ? row.querySelectorAll('a[href*="/wettbewerb/"]') : []).forEach(function collect(link) {
      collectCompetitionCodesFromText(link.getAttribute('href') || '').forEach(function addLinkCode(code) { codes.push(code); });
    });
    return expandAdjacentCompetitionCodes(unique(codes)).slice(0, 8);
  }

  function extractCompetitionCodesFromProfile(doc, bodyText, profileUrl) {
    const codes = [];
    collectCompetitionCodesFromText(profileUrl || '').forEach(function addProfileCode(code) { codes.push(code); });
    Array.from((doc && doc.querySelectorAll) ? doc.querySelectorAll('a[href*="/wettbewerb/"]') : []).forEach(function collect(link) {
      const text = normalizeText(link.textContent || link.getAttribute('title') || '');
      const href = link.getAttribute('href') || '';
      // The profile header usually contains the current league; quick links also contain lots of irrelevant pages.
      if (/league|liga|division|tier|bundesliga|laliga|serie|premier|superliga|eredivisie|ligue|championship|portugal|jupiler|allsvenskan|ekstraklasa|austrian|swiss|romania|croatia|serbia|hungary|turkey|greece|scotland|denmark|norway|sweden|ukraine|russia/i.test(text + ' ' + href)) {
        collectCompetitionCodesFromText(href).forEach(function addHrefCode(code) { codes.push(code); });
      }
    });
    // Last-resort: some TM pages expose competition URLs only inside scripts/text.
    collectCompetitionCodesFromText(bodyText || '').slice(0, 12).forEach(function addBodyCode(code) { codes.push(code); });
    return expandAdjacentCompetitionCodes(unique(codes)).slice(0, 10);
  }

  function collectCompetitionCodesFromText(text) {
    const out = [];
    const value = String(text || '');
    Array.from(value.matchAll(/\/wettbewerb\/([A-Z0-9]{2,8})/gi)).forEach(function matchCode(match) {
      if (match && match[1]) out.push(match[1].toUpperCase());
    });
    Array.from(value.matchAll(/(?:^|[?&\/])wettbewerb[=/]([A-Z0-9]{2,8})/gi)).forEach(function matchCode(match) {
      if (match && match[1]) out.push(match[1].toUpperCase());
    });
    return unique(out).filter(function saneCompetitionCode(code) {
      return /^[A-Z]{1,4}\d{0,3}$/.test(code) || /^[A-Z0-9]{2,8}$/.test(code);
    });
  }

  function expandAdjacentCompetitionCodes(codes) {
    const map = {
      GB1: ['GB2'], GB2: ['GB1'], ES1: ['ES2'], ES2: ['ES1'], IT1: ['IT2'], IT2: ['IT1'],
      L1: ['L2'], L2: ['L1'], FR1: ['FR2'], FR2: ['FR1'], PO1: ['PO2'], PO2: ['PO1'],
      NL1: ['NL2'], NL2: ['NL1'], BE1: ['BE2'], BE2: ['BE1'], TR1: ['TR2'], TR2: ['TR1'],
      A1: ['A2'], A2: ['A1'], C1: ['C2'], C2: ['C1'], RO1: ['RO2'], RO2: ['RO1'],
      DK1: ['DK2'], DK2: ['DK1'], SE1: ['SE2'], SE2: ['SE1'], NO1: ['NO2'], NO2: ['NO1'],
      PL1: ['PL2'], PL2: ['PL1'], SC1: ['SC2'], SC2: ['SC1'], GR1: ['GR2'], GR2: ['GR1'],
      UKR1: ['UKR2'], UKR2: ['UKR1'], RU1: ['RU2'], RU2: ['RU1'], SER1: ['SER2'], SER2: ['SER1'],
      KRO1: ['KRO2'], KRO2: ['KRO1'], UNG1: ['UNG2'], UNG2: ['UNG1'], SLO1: ['SLO2'], SLO2: ['SLO1'],
      BUL1: ['BUL2'], BUL2: ['BUL1'], ZYP1: ['ZYP2'], ZYP2: ['ZYP1'], ISR1: ['ISR2'], ISR2: ['ISR1'],
      FIN1: ['FIN2'], FIN2: ['FIN1'], IR1: ['IR2'], IR2: ['IR1'], MLS1: ['USL'], USL: ['MLS1']
    };
    const out = [];
    (codes || []).forEach(function add(code) {
      if (!code) return;
      out.push(code);
      (map[code] || []).forEach(function addSibling(sibling) { out.push(sibling); });
    });
    return unique(out);
  }

  function extractNameFallback(cell) {
    const strong = cell.querySelector('.hauptlink, strong, b');
    return strong ? cleanText(strong.textContent) : '';
  }

  function extractAgeFromRow(row, rowText) {
    const centered = Array.from(row.querySelectorAll('td.zentriert, td')).map(function cellText(td) {
      return cleanText(td.textContent);
    });
    for (const text of centered) {
      const onlyAge = text.match(/^(1[5-9]|[2-3]\d|4[0-5])$/);
      if (onlyAge) return parseInt(onlyAge[1], 10);
    }
    const ageNearBirth = rowText.match(/\((1[5-9]|[2-3]\d|4[0-5])\)/);
    if (ageNearBirth) return parseInt(ageNearBirth[1], 10);
    return null;
  }

  function extractNationalities(scope) {
    const values = [];
    Array.from(scope.querySelectorAll('img')).forEach(function collectFlag(img) {
      const cls = String(img.className || '');
      const src = String(img.getAttribute('src') || '');
      const title = cleanText(img.getAttribute('title') || img.getAttribute('alt') || '');
      if ((cls.includes('flaggenrahmen') || /flagge|flag/i.test(src)) && title) {
        values.push(title);
      }
    });
    return unique(values).join(', ');
  }

  function extractPositionFromRow(row, playerCell) {
    const inlineRows = Array.from(playerCell.querySelectorAll('table.inline-table tr'));
    if (inlineRows.length > 1) {
      const candidate = cleanText(inlineRows[1].textContent);
      if (candidate && !looksLikeMarketValue(candidate) && !looksLikeAge(candidate)) return candidate;
    }

    const rowText = cleanText(row.textContent);
    const known = findKnownPosition(rowText);
    if (known) return known;

    const cells = Array.from(row.querySelectorAll('td')).map(function text(td) { return cleanText(td.textContent); });
    for (const cell of cells) {
      if (findKnownPosition(cell)) return findKnownPosition(cell);
    }
    return '';
  }

  function findKnownPosition(text) {
    const normalized = normalizeText(text);
    const positions = [
      ['Goalkeeper', ['goalkeeper', 'keeper', 'torwart', 'portero', 'gardien', 'brankeeper']],
      ['Centre-Back', ['centre-back', 'center-back', 'central defender', 'innenverteidiger', 'defensor central']],
      ['Left-Back', ['left-back', 'left back', 'linker verteidiger', 'lateral izquierdo']],
      ['Right-Back', ['right-back', 'right back', 'rechter verteidiger', 'lateral derecho']],
      ['Defensive Midfield', ['defensive midfield', 'defensives mittelfeld', 'defensive midfielder', 'volante']],
      ['Central Midfield', ['central midfield', 'central midfielder', 'zentrales mittelfeld', 'mittelmittelfeld']],
      ['Attacking Midfield', ['attacking midfield', 'attacking midfielder', 'offensives mittelfeld', 'enganche']],
      ['Left Midfield', ['left midfield', 'linkes mittelfeld']],
      ['Right Midfield', ['right midfield', 'rechtes mittelfeld']],
      ['Left Winger', ['left winger', 'left wing', 'linksaußen', 'left forward', 'extremo izquierdo']],
      ['Right Winger', ['right winger', 'right wing', 'rechtsaußen', 'right forward', 'extremo derecho']],
      ['Centre-Forward', ['centre-forward', 'center-forward', 'centre forward', 'center forward', 'striker', 'mittelstürmer', 'stürmer', 'delantero centro']],
      ['Second Striker', ['second striker', 'hängende spitze', 'shadow striker']]
    ];

    for (const [label, aliases] of positions) {
      if (aliases.some(function hasAlias(alias) { return normalized.includes(normalizeText(alias)); })) return label;
    }
    return '';
  }

  function positionGroup(position) {
    const normalized = normalizeText(position);
    if (!normalized) return '';
    if (/(goalkeeper|keeper|torwart|portero|gardien)/.test(normalized)) return 'GK';
    if (/(back|defender|verteidiger|lateral|centre-back|center-back|central defender|innenverteidiger)/.test(normalized)) return 'DEF';
    if (/(midfield|mittelfeld|volante|enganche)/.test(normalized)) return 'MID';
    if (/(winger|forward|striker|stürmer|delantero|spitze|left wing|right wing)/.test(normalized)) return 'FWD';
    return '';
  }

  function positionDetail(position) {
    const normalized = normalizeText(position);
    if (!normalized) return 'Other';
    if (/(goalkeeper|keeper|torwart|portero|gardien)/.test(normalized)) return 'GK';
    if (/(centre-back|center-back|central defender|innenverteidiger|defensor central)/.test(normalized)) return 'CB';
    if (/(left-back|left back|linker verteidiger|lateral izquierdo)/.test(normalized)) return 'LB';
    if (/(right-back|right back|rechter verteidiger|lateral derecho)/.test(normalized)) return 'RB';
    if (/(defensive midfield|defensive midfielder|defensives mittelfeld|volante)/.test(normalized)) return 'DM';
    if (/(central midfield|central midfielder|zentrales mittelfeld|mittelmittelfeld)/.test(normalized)) return 'CM';
    if (/(attacking midfield|attacking midfielder|offensives mittelfeld|enganche)/.test(normalized)) return 'AM';
    if (/(left midfield|linkes mittelfeld)/.test(normalized)) return 'LM';
    if (/(right midfield|rechtes mittelfeld)/.test(normalized)) return 'RM';
    if (/(left winger|left wing|linksaußen|left forward|extremo izquierdo)/.test(normalized)) return 'LW';
    if (/(right winger|right wing|rechtsaußen|right forward|extremo derecho)/.test(normalized)) return 'RW';
    if (/(winger|wing|flügelspieler|extremo)/.test(normalized)) return 'WING';
    if (/(centre-forward|center-forward|centre forward|center forward|striker|mittelstürmer|stürmer|delantero centro)/.test(normalized)) return 'CF';
    if (/(second striker|hängende spitze|shadow striker)/.test(normalized)) return 'SS';
    return 'Other';
  }

  function chooseBestPosition(profilePosition, candidatePosition) {
    const profile = cleanText(profilePosition);
    const candidate = cleanText(candidatePosition);
    if (profile && positionGroup(profile)) return profile;
    if (candidate && positionGroup(candidate)) return candidate;
    return profile || candidate || '';
  }

  function extractMarketValueFromRow(row, rowText) {
    const preferred = Array.from(row.querySelectorAll('td.rechts, td.hauptlink, a, span'))
      .map(function text(node) { return cleanText(node.textContent); })
      .filter(looksLikeMarketValue);
    for (const text of preferred) {
      const parsed = parseMarketValue(text);
      if (parsed !== null) return parsed;
    }
    return parseMarketValue(rowText);
  }

  function extractClubFromRow(row, profileLink, sourceType) {
    const profileHost = profileLink ? extractPlayerId(profileLink.href) : '';
    const clubLinks = Array.from(row.querySelectorAll('a[href*="/verein/"]'));
    for (const link of clubLinks) {
      const title = cleanText(link.getAttribute('title') || link.textContent);
      if (title && !title.includes(profileHost)) return title;
    }

    const imgTitles = Array.from(row.querySelectorAll('img')).map(function imgTitle(img) {
      return cleanText(img.getAttribute('title') || img.getAttribute('alt') || '');
    }).filter(Boolean);
    const nonFlags = imgTitles.filter(function notCountry(name) {
      return !/flag/i.test(name) && !/national/i.test(name);
    });
    if (nonFlags.length) return nonFlags[0];
    return sourceType === 'free-agent' ? 'Without Club / last club unknown' : '';
  }


  function extractClubIdsFromRow(row) {
    const ids = [];
    Array.from((row && row.querySelectorAll) ? row.querySelectorAll('a[href*="/verein/"]') : []).forEach(function collectClubId(link) {
      collectClubIdsFromText(link.getAttribute('href') || '').forEach(function add(id) { ids.push(id); });
    });
    Array.from((row && row.querySelectorAll) ? row.querySelectorAll('[data-verein-id],[data-club-id],[data-clubid]') : []).forEach(function collectDataId(node) {
      [node.getAttribute('data-verein-id'), node.getAttribute('data-club-id'), node.getAttribute('data-clubid')]
        .forEach(function addDataId(value) { if (/^\d+$/.test(String(value || '').trim())) ids.push(String(value).trim()); });
    });
    return unique(ids);
  }

  function extractProfileClubIds(doc) {
    const ids = [];
    const preferred = Array.from((doc && doc.querySelectorAll) ? doc.querySelectorAll('.data-header a[href*="/verein/"], .data-header__club a[href*="/verein/"], .data-header__box--big a[href*="/verein/"]') : []);
    const fallback = preferred.length ? preferred : Array.from((doc && doc.querySelectorAll) ? doc.querySelectorAll('a[href*="/verein/"]') : []);
    fallback.forEach(function collectClubId(link) {
      collectClubIdsFromText(link.getAttribute('href') || '').forEach(function add(id) { ids.push(id); });
    });
    return unique(ids);
  }

  function collectClubIdsFromText(text) {
    const out = [];
    const value = String(text || '');
    Array.from(value.matchAll(/\/verein\/(\d+)/gi)).forEach(function matchClubId(match) {
      if (match && match[1]) out.push(String(match[1]));
    });
    Array.from(value.matchAll(/(?:^|[?&\/])(verein|club|clubId|clubid|team|teamId)[=\/](\d+)/gi)).forEach(function matchClubParam(match) {
      if (match && match[2]) out.push(String(match[2]));
    });
    return unique(out);
  }

  function extractContractDate(text) {
    const patterns = [
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/i,
      /\b\d{1,2}\.?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/i,
      /\b\d{1,2}\.\d{1,2}\.\d{4}\b/,
      /\b\d{4}-\d{2}-\d{2}\b/
    ];
    for (const pattern of patterns) {
      const match = cleanText(text).match(pattern);
      if (match) return match[0];
    }
    return '';
  }

  function mergeCandidates(a, b) {
    return {
      playerId: a.playerId || b.playerId,
      slug: a.slug || b.slug,
      name: a.name || b.name,
      profileUrl: a.profileUrl || b.profileUrl,
      age: a.age !== null && a.age !== undefined ? a.age : b.age,
      nationality: a.nationality || b.nationality,
      position: a.position || b.position,
      positionGroup: a.positionGroup || b.positionGroup,
      marketValue: a.marketValue !== null && a.marketValue !== undefined ? a.marketValue : b.marketValue,
      club: a.club || b.club,
      clubIds: unique([].concat(a.clubIds || [], b.clubIds || [])),
      contractUntil: a.contractUntil || b.contractUntil,
      competitionCodes: unique([].concat(a.competitionCodes || [], b.competitionCodes || [])),
      sourceTypes: unique([].concat(a.sourceTypes || [], b.sourceTypes || [])),
      sourceLabels: unique([].concat(a.sourceLabels || [], b.sourceLabels || [])),
      sourceUrls: unique([].concat(a.sourceUrls || [], b.sourceUrls || []))
    };
  }

  function countSourceTypes(candidates) {
    const counts = { contractExpiring: 0, freeAgent: 0, mixed: 0 };
    candidates.forEach(function count(candidate) {
      const types = candidate.sourceTypes || [];
      const hasExpiring = types.includes('contract-expiring');
      const hasFree = types.includes('free-agent');
      if (hasExpiring && hasFree) counts.mixed += 1;
      else if (hasExpiring) counts.contractExpiring += 1;
      else if (hasFree) counts.freeAgent += 1;
    });
    return counts;
  }

  function isAvailabilityCandidate(candidate) {
    const types = candidate.sourceTypes || [];
    return types.includes('free-agent') || types.includes('contract-expiring');
  }

  function passesObviousSourceFilters(candidate, settings) {
    if (isU21Mode(settings)) return passesObviousU21SourceFilters(candidate, settings);
    const reasons = [];

    if (!isAvailabilityCandidate(candidate)) reasons.push('not-free-agent-or-expiring');

    /*
     * Source pages already expose age, market value and position for most rows.
     * Do not waste profile/MV/API requests on obvious misses like a 31-year-old
     * €2m player when the UI filter says 22–30 and €200k–€800k.
     * Missing values are allowed through because the profile page can still fix them.
     */
    if (candidate.age !== null && candidate.age !== undefined && candidate.age !== 0) {
      if (candidate.age < settings.minAge || candidate.age > settings.maxAge) reasons.push('age-out-of-range-source');
    }

    if (candidate.marketValue !== null && candidate.marketValue !== undefined && candidate.marketValue !== 0) {
      if (candidate.marketValue < settings.minMv || candidate.marketValue > settings.maxMv) reasons.push('mv-out-of-range-source');
    }

    if (!matchesSelectedNationality(candidate.nationality, settings.contractNationalities || [])) reasons.push('contract-nationality-disabled-source');

    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    const group = candidate.positionGroup || positionGroup(candidate.position);
    const detail = positionDetail(candidate.position);
    if (mode === 'broad') {
      if (group && !isGroupEnabled(group, settings)) reasons.push('position-disabled-source');
    } else {
      // Source rows are often broad (e.g. only "Defender"), while the profile has the exact position.
      // Do not kill a possible CB/LB/RB/CM hit before the profile page can clarify it.
      if (detail && detail !== 'Other') {
        if (!isDetailEnabled(detail, settings)) reasons.push('detail-position-disabled-source');
      } else if (group && !isAnyDetailInGroupEnabled(group, settings)) {
        reasons.push('detail-position-group-disabled-source');
      }
    }

    if (shouldApplyOwnTeamFilter(settings) && matchesOwnTeamSourceCandidate(candidate, settings)) {
      reasons.push('own-team-source-club');
    }

    return { ok: reasons.length === 0, reasons: reasons };
  }


  function passesObviousU21SourceFilters(candidate, settings) {
    const reasons = [];
    const age = candidate.age;
    const mv = candidate.marketValue;
    if (age !== null && age !== undefined && age !== 0) {
      if (age < settings.u21MinAge || age > settings.u21MaxAge) reasons.push('u21-age-out-of-range-source');
    }
    if (mv !== null && mv !== undefined && mv !== 0) {
      if (mv < settings.u21MinMv || mv > settings.u21MaxMv) reasons.push('u21-mv-out-of-range-source');
    }
    if (!matchesU21Nationality(candidate.nationality, settings)) reasons.push('u21-nationality-disabled-source');

    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    const group = candidate.positionGroup || positionGroup(candidate.position);
    const detail = positionDetail(candidate.position);
    if (mode === 'broad') {
      if (group && !isGroupEnabled(group, settings)) reasons.push('position-disabled-source');
    } else {
      // Source rows are often broad (e.g. only "Defender"), while the profile has the exact position.
      // Do not kill a possible CB/LB/RB/CM hit before the profile page can clarify it.
      if (detail && detail !== 'Other') {
        if (!isDetailEnabled(detail, settings)) reasons.push('detail-position-disabled-source');
      } else if (group && !isAnyDetailInGroupEnabled(group, settings)) {
        reasons.push('detail-position-group-disabled-source');
      }
    }

    // U21-ben is működjön a saját csapat kizárás már a source-szinten,
    // ugyanazzal a logikával, mint a lejáró szerződéses scoutban.
    if (shouldApplyOwnTeamFilter(settings) && matchesOwnTeamSourceCandidate(candidate, settings)) {
      reasons.push('own-team-source-club');
    }

    return { ok: reasons.length === 0, reasons: reasons };
  }

  function sortCandidatesForEnrich(a, b) {
    const af = hasCandidateSourceType(a, 'free-agent') ? 1 : 0;
    const bf = hasCandidateSourceType(b, 'free-agent') ? 1 : 0;
    const av = a.marketValue || 0;
    const bv = b.marketValue || 0;
    return (bf - af) || (bv - av) || String(a.name).localeCompare(String(b.name));
  }

  function hasCandidateSourceType(candidate, type) {
    return (candidate && Array.isArray(candidate.sourceTypes) ? candidate.sourceTypes : []).includes(type);
  }

  function limitCandidatesForEnrich(candidates, settings) {
    const list = Array.isArray(candidates) ? candidates : [];
    const max = Math.max(1, Number(isU21Mode(settings) ? settings.u21MaxCandidates : settings.maxCandidates) || 1);
    if (list.length <= max) return list.slice();
    if (isU21Mode(settings) || !settings.includeFreeAgents) return list.slice(0, max);

    const freeAgents = list.filter(function isFree(candidate) { return hasCandidateSourceType(candidate, 'free-agent'); });
    const others = list.filter(function isNotFree(candidate) { return !hasCandidateSourceType(candidate, 'free-agent'); });
    if (!freeAgents.length) return list.slice(0, max);

    const depth = normalizeSearchDepth(settings && settings.searchDepth);
    const freeRatio = depth === 'deep' ? 0.65 : depth === 'fast' ? 0.35 : 0.50;
    const freeFloor = depth === 'deep' ? 48 : depth === 'fast' ? 18 : 32;
    const freeTarget = Math.min(freeAgents.length, Math.max(freeFloor, Math.round(max * freeRatio)));
    const selected = [];
    const seen = new Set();

    function add(candidate) {
      const id = String(candidate && candidate.playerId || '');
      if (!id || seen.has(id) || selected.length >= max) return;
      seen.add(id);
      selected.push(candidate);
    }

    freeAgents.slice(0, freeTarget).forEach(add);
    others.slice(0, Math.max(0, max - selected.length)).forEach(add);
    list.forEach(add);
    return selected;
  }


  function sortU21CandidatesForEnrich(a, b) {
    const aa = Number(a.age || 99);
    const ba = Number(b.age || 99);
    const am = Number(a.marketValue || 0);
    const bm = Number(b.marketValue || 0);
    const as = getU21CandidateSeedPriority(a);
    const bs = getU21CandidateSeedPriority(b);

    // U21-nél nem a legdrágábbak és nem csak az ismert MV-s játékosok mennek előre.
    // Előny: fiatalabb, U21/U19 válogatott vagy utánpótlás-seed forrás, majd csak utána MV.
    return (aa - ba)
      || (bs - as)
      || (am - bm)
      || String(a.name || '').localeCompare(String(b.name || ''));
  }

  function getU21CandidateSeedPriority(candidate) {
    const text = String([].concat(candidate.sourceLabels || [], candidate.sourceUrls || [], candidate.sourceTypes || []).join(' ')).toLowerCase();
    if (/u21-national-squad-seed|u19|u21|youth|academy|u-19|u-21/.test(text)) return 35;
    if (/u21-prospect/.test(text)) return 12;
    return 0;
  }

  async function enrichCandidate(candidate, settings) {
    const profile = await getProfileInfo(candidate);
    const mvGraph = await getMarketValueGraph(candidate, settings.growthSince, settings.maxMvDropPct);
    const playingTimeCandidate = Object.assign({}, candidate, {
      slug: candidate.slug || profile.slug,
      profileUrl: candidate.profileUrl || profile.profileUrl,
      competitionCodes: unique([].concat(candidate.competitionCodes || [], profile.competitionCodes || []))
    });
    const playingTime = await getPlayingTime(playingTimeCandidate);
    const ownTeamExclusion = detectOwnTeamHistory(candidate, profile, playingTime, settings);
    const chosenPosition = chooseBestPosition(profile.position, candidate.position);
    const clubContext = buildClubLeagueContext(candidate, profile, playingTime, playingTimeCandidate.competitionCodes || []);

    const normalizedMvGraph = normalizeMvGraphForDisplay(
      mvGraph,
      firstDefinedNumber(profile.currentMarketValue, mvGraph && mvGraph.latestValue, candidate.marketValue),
      settings.growthSince,
      settings.maxMvDropPct
    );
    const mergedCurrentMarketValue = firstDefinedNumber(profile.currentMarketValue, normalizedMvGraph.latestValue, candidate.marketValue);

    const merged = {
      playerId: candidate.playerId,
      slug: candidate.slug || profile.slug,
      name: profile.name || candidate.name,
      profileUrl: candidate.profileUrl || profile.profileUrl,
      age: firstDefinedNumber(profile.age, candidate.age),
      nationality: profile.nationality || candidate.nationality,
      position: chosenPosition,
      positionGroup: positionGroup(chosenPosition),
      positionDetail: positionDetail(chosenPosition),
      club: clubContext.club || profile.club || candidate.club,
      lastClub: clubContext.club || profile.club || candidate.club,
      lastLeague: clubContext.league || '',
      lastLeagueCode: clubContext.leagueCode || '',
      clubLeagueContext: clubContext.label || '',
      clubIds: unique([].concat(candidate.clubIds || [], profile.clubIds || [])),
      contractUntil: profile.contractUntil || candidate.contractUntil,
      sourceTypes: candidate.sourceTypes || [],
      sourceLabels: candidate.sourceLabels || [],
      sourceUrls: candidate.sourceUrls || [],
      competitionCodes: unique([].concat(playingTimeCandidate.competitionCodes || [], clubContext.leagueCode ? [clubContext.leagueCode] : [])),
      availability: buildAvailability(candidate, profile, clubContext),
      currentMarketValue: mergedCurrentMarketValue,
      sourceMarketValue: candidate.marketValue,
      profileMarketValue: profile.currentMarketValue,
      mv: normalizedMvGraph,
      playingTime: playingTime,
      ownTeamExclusion: ownTeamExclusion,
      futureTransferDetected: Boolean(profile.futureTransferDetected),
      futureTransferEvidence: profile.futureTransferEvidence || '',
      raw: {
        candidate: candidate,
        profile: profile
      }
    };

    if (!merged.positionGroup) merged.positionGroup = positionGroup(merged.position);
    if (!merged.positionDetail) merged.positionDetail = positionDetail(merged.position);
    if (isU21Mode(settings)) {
      merged.u21 = buildU21Metrics(merged, settings);
      merged.availability = buildU21Availability(merged);
    }
    return merged;
  }

  async function getProfileInfo(candidate) {
    const cacheKey = `${APP.cachePrefix}profileInfo:${candidate.playerId || hashString(candidate.profileUrl || '')}`;
    try {
      const cached = await gmGet(cacheKey, null);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < Math.min(APP.ttlMs, 48 * 60 * 60 * 1000) && cached.value) {
        state.debug.cacheHits += 1;
        return Object.assign({}, cached.value);
      }
    } catch (error) {
      pushError('profile cache read skipped', stringifyError(error));
    }

    const html = await httpGetCached(candidate.profileUrl, 'text');
    const doc = parseHtml(html);
    const bodyText = cleanText(doc.body ? doc.body.textContent : html);
    const name = extractProfileName(doc) || candidate.name;
    const age = extractProfileAge(doc, bodyText) || candidate.age;
    const nationality = extractProfileNationality(doc) || candidate.nationality;
    const position = extractProfilePosition(doc, bodyText) || candidate.position;
    const club = extractProfileClub(doc, bodyText) || candidate.club;
    const clubIds = extractProfileClubIds(doc);
    const contractUntil = extractProfileContractUntil(doc, bodyText) || candidate.contractUntil;
    const currentMarketValue = extractProfileMarketValue(doc, bodyText) || candidate.marketValue;
    const futureTransfer = detectFutureTransfer(bodyText);
    const competitionCodes = extractCompetitionCodesFromProfile(doc, bodyText, candidate.profileUrl);

    const profile = {
      playerId: candidate.playerId,
      slug: candidate.slug,
      name: name,
      profileUrl: candidate.profileUrl,
      age: age,
      nationality: nationality,
      position: position,
      club: club,
      clubIds: clubIds,
      contractUntil: contractUntil,
      currentMarketValue: currentMarketValue,
      competitionCodes: competitionCodes,
      futureTransferDetected: futureTransfer.detected,
      futureTransferEvidence: futureTransfer.evidence
    };

    try {
      const serialized = JSON.stringify(profile);
      if (serialized.length <= 60000) await gmSet(cacheKey, { savedAt: Date.now(), value: profile });
    } catch (error) {
      pushError('profile cache write skipped', stringifyError(error));
    }

    return profile;
  }

  function extractProfileName(doc) {
    const selectors = [
      'h1.data-header__headline-wrapper',
      '.data-header__headline-wrapper h1',
      '.data-header__headline-wrapper',
      'h1'
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = cleanText(node && node.textContent);
      if (text && text.length > 2) return text.replace(/^#\d+\s*/, '').trim();
    }
    return '';
  }

  function extractProfileAge(doc, bodyText) {
    const birthNode = doc.querySelector('[itemprop="birthDate"]');
    const birthText = cleanText(birthNode && birthNode.textContent);
    const birthMatch = birthText.match(/\((1[5-9]|[2-3]\d|4[0-9])\)/);
    if (birthMatch) return parseInt(birthMatch[1], 10);

    const patterns = [
      /Date of birth\/Age:\s*[^()]*\((1[5-9]|[2-3]\d|4[0-9])\)/i,
      /Age:\s*(1[5-9]|[2-3]\d|4[0-9])/i,
      /Alter:\s*(1[5-9]|[2-3]\d|4[0-9])/i,
      /\((1[5-9]|[2-3]\d|4[0-9])\)/
    ];
    for (const pattern of patterns) {
      const match = bodyText.match(pattern);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  function extractProfileNationality(doc) {
    const header = doc.querySelector('.data-header, header') || doc;
    const values = extractNationalities(header);
    return values || extractNationalities(doc);
  }

  function extractProfilePosition(doc, bodyText) {
    const labelValue = findLabeledText(doc, ['Position:', 'Position', 'Main position:', 'Main position', 'Positionen:', 'Hauptposition:']);
    if (labelValue && findKnownPosition(labelValue)) return findKnownPosition(labelValue);
    if (labelValue) return labelValue;
    return findKnownPosition(bodyText) || '';
  }

  function extractProfileClub(doc, bodyText) {
    const selectors = [
      '.data-header__club a',
      '.data-header__box--big a[href*="/verein/"]',
      '.data-header a[href*="/verein/"]'
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const text = cleanText((node && (node.getAttribute('title') || node.textContent)) || '');
      if (text) return text;
    }
    if (/without club|vertragslos|sans club|sin club/i.test(bodyText)) return 'Without Club';
    const clubLabel = findLabeledText(doc, ['Current club:', 'Club:', 'Aktueller Verein:', 'Verein:']);
    return clubLabel || '';
  }

  function extractProfileContractUntil(doc, bodyText) {
    const labelValue = findLabeledText(doc, ['Contract expires:', 'Contract until:', 'Vertrag bis:', 'Contrat jusqu\'à:']);
    if (labelValue) return labelValue;
    const match = bodyText.match(/(?:Contract expires|Contract until|Vertrag bis):?\s*([^|•\n]{3,40})/i);
    return match ? cleanText(match[1]) : '';
  }

  function extractProfileMarketValue(doc, bodyText) {
    const selectors = [
      '.data-header__market-value-wrapper',
      '.tm-player-market-value-development__current-value',
      '[class*="market-value"]'
    ];
    for (const selector of selectors) {
      const node = doc.querySelector(selector);
      const value = parseMarketValue(cleanText(node && node.textContent));
      if (value !== null) return value;
    }
    const marker = bodyText.match(/Current market value:?\s*([^|•\n]{2,40})/i);
    if (marker) {
      const value = parseMarketValue(marker[1]);
      if (value !== null) return value;
    }
    return parseMarketValue(bodyText);
  }

  function findLabeledText(doc, labels) {
    const labelNodes = Array.from(doc.querySelectorAll('.data-header__label, .info-table__content--regular, th, dt, span, li'));
    for (const node of labelNodes) {
      const text = cleanText(node.textContent);
      const label = labels.find(function sameLabel(item) {
        return normalizeText(text).replace(/:$/, '') === normalizeText(item).replace(/:$/, '') || normalizeText(text).includes(normalizeText(item));
      });
      if (!label) continue;
      const sibling = node.nextElementSibling;
      const siblingText = cleanText(sibling && sibling.textContent);
      if (siblingText && siblingText !== text) return siblingText;
      const parentText = cleanText(node.parentElement && node.parentElement.textContent);
      const replaced = cleanText(parentText.replace(new RegExp(escapeRegExp(label), 'i'), ''));
      if (replaced && replaced !== parentText) return replaced;
    }
    return '';
  }

  function detectFutureTransfer(text) {
    const regex = /\b(will join|joins on|joining on|future transfer|already signed|signed for|next season joins|pre-contract|pre contract)\b.{0,120}/gi;
    const matches = [];
    let match;
    while ((match = regex.exec(text)) && matches.length < 3) {
      matches.push(cleanText(match[0]));
    }
    return { detected: matches.length > 0, evidence: matches.join(' | ') };
  }

  async function getMarketValueGraph(candidateOrPlayerId, growthSince, maxMvDropPct) {
    const candidate = typeof candidateOrPlayerId === 'object' && candidateOrPlayerId !== null
      ? candidateOrPlayerId
      : { playerId: candidateOrPlayerId };
    const playerId = String(candidate.playerId || candidateOrPlayerId || '').trim();
    if (!playerId) return emptyMvGraph(growthSince, maxMvDropPct, true);

    // v17: do not accept "unknown" after the first CEAPI miss. Transfermarkt sometimes
    // serves the MV graph through slightly different JSON/HTML payloads, especially for
    // free agents / recently moved players. We now try the CEAPI graph, tmapi fallbacks,
    // and finally the player/profile MV-history HTML before giving up.
    const jsonUrls = buildMarketValueJsonUrls(playerId);
    for (const url of jsonUrls) {
      try {
        const json = await httpGetCached(url, 'json');
        const points = uniqueMvPoints(extractMvPoints(json)).sort(function byDate(a, b) {
          return a.dateMs - b.dateMs;
        });
        const graph = finishMvGraphFromPoints(points, growthSince, maxMvDropPct, `json:${shortMvSourceLabel(url)}`);
        if (graph && graph.ok) return graph;
      } catch (error) {
        pushError('mv graph json fallback failed', { playerId: playerId, url: url, error: stringifyError(error) });
      }
    }

    const htmlUrls = buildMarketValueHtmlUrls(candidate, playerId);
    for (const url of htmlUrls) {
      try {
        const html = await httpGetCached(url, 'text');
        const points = uniqueMvPoints(extractMvPointsFromHtml(html)).sort(function byDate(a, b) {
          return a.dateMs - b.dateMs;
        });
        const graph = finishMvGraphFromPoints(points, growthSince, maxMvDropPct, `html:${shortMvSourceLabel(url)}`);
        if (graph && graph.ok) return graph;
      } catch (error) {
        pushError('mv graph html fallback failed', { playerId: playerId, url: url, error: stringifyError(error) });
      }
    }

    return emptyMvGraph(growthSince, maxMvDropPct, true);
  }

  function buildMarketValueJsonUrls(playerId) {
    const encoded = encodeURIComponent(playerId);
    return unique([
      `https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${encoded}`,
      `https://www.transfermarkt.de/ceapi/marketValueDevelopment/graph/${encoded}`,
      `https://tmapi.transfermarkt.technology/player/${encoded}/market-value-development`,
      `https://tmapi.transfermarkt.technology/player/${encoded}/market-value`,
      `https://tmapi.transfermarkt.technology/player/${encoded}/marketValueDevelopment`
    ]);
  }

  function buildMarketValueHtmlUrls(candidate, playerId) {
    const slug = sanitizeTmSlug(candidate && candidate.slug ? candidate.slug : extractSlugFromProfileUrl(candidate && candidate.profileUrl));
    const encoded = encodeURIComponent(playerId);
    const urls = [];
    if (candidate && candidate.profileUrl) urls.push(candidate.profileUrl);
    if (slug) {
      urls.push(`https://www.transfermarkt.com/${slug}/marktwertverlauf/spieler/${encoded}`);
      urls.push(`https://www.transfermarkt.com/${slug}/market-value-history/spieler/${encoded}`);
      urls.push(`https://www.transfermarkt.de/${slug}/marktwertverlauf/spieler/${encoded}`);
    }
    return unique(urls.filter(Boolean));
  }

  function sanitizeTmSlug(value) {
    return String(value || '')
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/\?.*$/, '')
      .replace(/#.*/, '')
      .split('/')[0]
      .trim();
  }

  function extractSlugFromProfileUrl(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.href);
      return sanitizeTmSlug(parsed.pathname.replace(/^\//, ''));
    } catch (_error) {
      const match = String(url || '').match(/transfermarkt\.[^/]+\/([^/?#]+)/i);
      return match ? sanitizeTmSlug(match[1]) : '';
    }
  }

  function shortMvSourceLabel(url) {
    try {
      const parsed = new URL(String(url || ''), window.location.href);
      return parsed.hostname.replace(/^www\./, '') + parsed.pathname.replace(/\/\d+$/, '/:id');
    } catch (_error) {
      return 'fallback';
    }
  }

  function finishMvGraphFromPoints(points, growthSince, maxMvDropPct, sourceLabel) {
    const sorted = uniqueMvPoints(points || []).sort(function byDate(a, b) {
      return Number(a.dateMs || 0) - Number(b.dateMs || 0);
    });
    if (!sorted.length) return null;
    const latest = sorted[sorted.length - 1];
    const baseline = findBaselinePoint(sorted, growthSince) || sorted[0];
    if (!latest || !baseline || !Number.isFinite(Number(latest.value)) || !Number.isFinite(Number(baseline.value))) return null;
    const absGrowth = Math.round(Number(latest.value) - Number(baseline.value));
    const pctGrowth = Number(baseline.value) > 0 ? (absGrowth / Number(baseline.value)) * 100 : null;
    const dropPct = Number.isFinite(maxMvDropPct) ? Math.max(0, Math.min(90, Number(maxMvDropPct))) : 15;
    const minAllowedValue = Number(baseline.value) > 0 ? Math.round(Number(baseline.value) * (1 - dropPct / 100)) : Number(baseline.value);
    const passedTrend = Number(latest.value) >= minAllowedValue;
    const lastStep = findLastStepUp(sorted);

    return {
      ok: true,
      unknown: false,
      fallbackNoHistory: false,
      fallbackSource: sourceLabel || 'mv-history',
      growthSince: growthSince,
      maxMvDropPct: dropPct,
      minAllowedValue: minAllowedValue,
      latestDate: latest.date,
      latestValue: Math.round(Number(latest.value)),
      baselineDate: baseline.date,
      baselineValue: Math.round(Number(baseline.value)),
      absGrowth: absGrowth,
      pctGrowth: pctGrowth,
      grew: absGrowth > 0,
      passedTrend: passedTrend,
      droppedTooMuch: !passedTrend,
      lastStepUp: lastStep,
      points: sorted
    };
  }

  function extractMvPointsFromHtml(html) {
    const text = decodeHtmlEntities(String(html || ''));
    const points = [];
    points.push.apply(points, extractObjectishMvPoints(text));
    points.push.apply(points, extractDateValueWindowMvPoints(text));
    return uniqueMvPoints(points);
  }

  function extractObjectishMvPoints(text) {
    const out = [];
    const compact = String(text || '')
      .replace(/\\\//g, '/')
      .replace(/&quot;/g, '"')
      .replace(/&#034;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'");
    const objectRegex = /\{[^{}]{0,1800}(?:datum_mw|datumMw|mw_datum|mwDatum|marketValueDate|market_value_date|dateFormatted|date|x)[^{}]{0,1800}(?:mw|yFormatted|yformatted|marketValue|market_value|value|amount|y)[^{}]{0,1800}\}/gi;
    let match;
    while ((match = objectRegex.exec(compact)) && out.length < 500) {
      const blob = match[0];
      const dateCandidate = extractLooseObjectValue(blob, ['x', 'date', 'datum_mw', 'datumMw', 'mw_datum', 'mwDatum', 'marketValueDate', 'market_value_date', 'dateFormatted', 'date_formatted']);
      const altDateCandidate = extractLooseObjectValue(blob, ['datum_mw', 'datumMw', 'mwdatum', 'mwDatum']);
      const valueCandidate = extractLooseObjectValue(blob, ['y', 'value', 'amount', 'marketValue', 'market_value', 'mw', 'yFormatted', 'yformatted', 'marketValueFormatted', 'market_value_formatted']);
      const altValueCandidate = extractLooseObjectValue(blob, ['mw', 'marketValueFormatted', 'market_value_formatted', 'yFormatted', 'yformatted']);
      addLooseMvPoint(out, dateCandidate !== undefined ? dateCandidate : altDateCandidate, valueCandidate !== undefined ? valueCandidate : altValueCandidate, blob);
    }
    return out;
  }

  function extractLooseObjectValue(blob, names) {
    const source = String(blob || '');
    for (const name of names) {
      const escaped = escapeRegExp(name);
      const regexes = [
        new RegExp("[\"']" + escaped + "[\"']\\s*:\\s*([\"'])(.*?)\\1", 'i'),
        new RegExp("(?:^|[,\\s])" + escaped + "\\s*:\\s*([\"'])(.*?)\\1", 'i'),
        new RegExp("[\"']" + escaped + "[\"']\\s*:\\s*([^,}]+)", 'i'),
        new RegExp('(?:^|[,\\s])' + escaped + '\\s*:\\s*([^,}]+)', 'i')
      ];
      for (const regex of regexes) {
        const match = source.match(regex);
        if (!match) continue;
        const raw = match[2] !== undefined ? match[2] : match[1];
        const value = cleanText(String(raw || '').replace(/^['"]|['"]$/g, ''));
        if (value) return value;
      }
    }
    return undefined;
  }

  function extractDateValueWindowMvPoints(text) {
    const out = [];
    const source = cleanText(String(text || '').replace(/<[^>]+>/g, ' '));
    const dateRegex = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\.\\d{1,2}\\.\\d{4}|\\d{1,2}/\\d{1,2}/\\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{4})';
    const valueRegex = '€\\s*[0-9]+(?:[.,][0-9]+)?\\s*(?:bn|b|m|mil\\.?|k|th\\.?|thousand)?|[0-9]+(?:[.,][0-9]+)?\\s*(?:bn|b|m|mil\\.?|k|th\\.?|thousand)\\s*€';
    const dateThenValue = new RegExp('(' + dateRegex + ')[^€]{0,180}(' + valueRegex + ')', 'gi');
    const valueThenDate = new RegExp('(' + valueRegex + ')[^0-9A-Za-z]{0,80}(?:[^0-9A-Za-z]{0,80})(' + dateRegex + ')', 'gi');
    let match;
    while ((match = dateThenValue.exec(source)) && out.length < 500) addLooseMvPoint(out, match[1], match[2], match[0]);
    while ((match = valueThenDate.exec(source)) && out.length < 500) addLooseMvPoint(out, match[2], match[1], match[0]);
    return out;
  }

  function addLooseMvPoint(out, dateCandidate, valueCandidate, raw) {
    const dateInfo = parseMvDate(dateCandidate);
    const value = parseMarketValueAny(valueCandidate);
    if (!dateInfo || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
    out.push({
      date: dateInfo.iso,
      dateMs: dateInfo.ms,
      value: Math.round(Number(value)),
      raw: raw
    });
  }

  function emptyMvGraph(growthSince, maxMvDropPct, passWhenUnknown) {
    const dropPct = Number.isFinite(maxMvDropPct) ? Math.max(0, Math.min(90, Number(maxMvDropPct))) : 15;
    return {
      ok: false,
      unknown: true,
      growthSince: growthSince,
      maxMvDropPct: dropPct,
      minAllowedValue: null,
      latestDate: '',
      latestValue: null,
      baselineDate: '',
      baselineValue: null,
      absGrowth: null,
      pctGrowth: null,
      grew: false,
      passedTrend: Boolean(passWhenUnknown),
      droppedTooMuch: false,
      lastStepUp: null,
      points: []
    };
  }


  function normalizeMvGraphForDisplay(mvGraph, currentMarketValue, growthSince, maxMvDropPct) {
    const dropPct = Number.isFinite(maxMvDropPct) ? Math.max(0, Math.min(90, Number(maxMvDropPct))) : 15;
    const current = Number(currentMarketValue);
    const hasCurrent = Number.isFinite(current) && current > 0;
    const base = Object.assign(emptyMvGraph(growthSince, dropPct, true), mvGraph || {});
    const points = Array.isArray(base.points) ? base.points.slice().sort(function byDate(a, b) { return Number(a.dateMs || 0) - Number(b.dateMs || 0); }) : [];

    function completeFromValues(baselineValue, latestValue, baselineDate, latestDate, sourceLabel) {
      const baseline = Number(baselineValue);
      const latest = Number(latestValue);
      if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(latest) || latest <= 0) return null;
      const absGrowth = Math.round(latest - baseline);
      const pctGrowth = baseline > 0 ? (absGrowth / baseline) * 100 : null;
      const minAllowedValue = Math.round(baseline * (1 - dropPct / 100));
      const passedTrend = latest >= minAllowedValue;
      return Object.assign({}, base, {
        ok: true,
        unknown: false,
        fallbackNoHistory: false,
        fallbackSource: sourceLabel || base.fallbackSource || '',
        growthSince: growthSince,
        maxMvDropPct: dropPct,
        minAllowedValue: minAllowedValue,
        latestDate: latestDate || base.latestDate || '',
        latestValue: latest,
        baselineDate: baselineDate || base.baselineDate || '',
        baselineValue: baseline,
        absGrowth: absGrowth,
        pctGrowth: pctGrowth,
        grew: absGrowth > 0,
        passedTrend: passedTrend,
        droppedTooMuch: !passedTrend,
        points: points
      });
    }

    if (points.length) {
      const latestPoint = points[points.length - 1];
      const baselinePoint = findBaselinePoint(points, growthSince) || points[0];
      const fromPoints = completeFromValues(
        baselinePoint && baselinePoint.value,
        hasCurrent ? current : latestPoint && latestPoint.value,
        baselinePoint && baselinePoint.date,
        hasCurrent ? '' : latestPoint && latestPoint.date,
        hasCurrent ? 'current-market-value-fallback' : 'points'
      );
      if (fromPoints) return fromPoints;
    }

    const directBaseline = Number(base.baselineValue);
    const directLatest = Number(base.latestValue);
    const direct = completeFromValues(
      directBaseline,
      hasCurrent ? current : directLatest,
      base.baselineDate,
      hasCurrent ? '' : base.latestDate,
      hasCurrent && (!Number.isFinite(directLatest) || directLatest <= 0) ? 'current-market-value-fallback' : 'direct'
    );
    if (direct) return direct;

    if (hasCurrent) {
      return Object.assign({}, base, {
        ok: false,
        unknown: false,
        fallbackNoHistory: true,
        fallbackSource: 'current-market-value-only',
        growthSince: growthSince,
        maxMvDropPct: dropPct,
        latestValue: current,
        latestDate: base.latestDate || '',
        baselineValue: null,
        baselineDate: '',
        absGrowth: null,
        pctGrowth: null,
        grew: false,
        passedTrend: true,
        droppedTooMuch: false,
        points: points
      });
    }

    return Object.assign({}, base, {
      unknown: true,
      fallbackNoHistory: true,
      growthSince: growthSince,
      maxMvDropPct: dropPct,
      passedTrend: true,
      droppedTooMuch: false,
      points: points
    });
  }

  function extractMvPoints(json) {
    const points = [];
    const seen = new WeakSet();

    function addPoint(dateCandidate, valueCandidate, raw) {
      const dateInfo = parseMvDate(dateCandidate);
      const value = parseMarketValueAny(valueCandidate);
      if (!dateInfo || value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) return;
      points.push({
        date: dateInfo.iso,
        dateMs: dateInfo.ms,
        value: Math.round(Number(value)),
        raw: raw
      });
    }

    function visit(item) {
      if (item === null || item === undefined) return;

      if (Array.isArray(item)) {
        if (item.length >= 2 && (looksLikeMvDateValue(item[0]) || looksLikeMvDateValue(item[1]))) {
          addPoint(item[0], item[1], item);
          addPoint(item[1], item[0], item);
          return;
        }
        item.forEach(visit);
        return;
      }

      if (typeof item !== 'object') return;
      if (seen.has(item)) return;
      seen.add(item);

      const dateCandidate = firstDeepValue(item, /^(x|date|datum|datetime|timestamp|marketvaluedate|market_value_date|dateformatted|mwdatum)$/i, looksLikeMvDateValue);
      const valueCandidate = firstDeepValue(item, /^(y|value|amount|marketvalue|market_value|mw|yformatted|marketvalueformatted|market_value_formatted|marketvalueamount|market_value_amount)$/i, looksLikeMvValue);
      if (dateCandidate !== undefined && valueCandidate !== undefined) addPoint(dateCandidate, valueCandidate, item);

      Object.keys(item).forEach(function visitChild(key) {
        const child = item[key];
        if (child && typeof child === 'object') visit(child);
      });
    }

    visit(json);
    return points;
  }

  function uniqueMvPoints(points) {
    const map = new Map();
    (points || []).forEach(function keep(point) {
      const key = `${point.dateMs}:${point.value}`;
      if (!map.has(key)) map.set(key, point);
    });
    return Array.from(map.values());
  }

  function parseMarketValueAny(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const parsed = parseMarketValueAny(item);
        if (parsed !== null) return parsed;
      }
      return null;
    }
    if (typeof value === 'object') {
      const direct = firstDefinedNumber(
        toNumber(value.amount),
        toNumber(value.value),
        toNumber(value.marketValue),
        toNumber(value.market_value),
        toNumber(value.y)
      );
      if (direct !== null) return direct;
      const formatted = [value.formatted, value.formattedValue, value.marketValueFormatted, value.market_value_formatted, value.text, value.label]
        .map(parseMarketValue)
        .find(function found(parsed) { return parsed !== null && parsed !== undefined; });
      if (formatted !== undefined) return formatted;
      return null;
    }
    const text = cleanText(value);
    const parsedText = parseMarketValue(text);
    if (parsedText !== null) return parsedText;
    const numeric = toNumber(text);
    return numeric !== null && numeric !== undefined && Number.isFinite(Number(numeric)) ? Math.round(Number(numeric)) : null;
  }

  function looksLikeMvDateValue(value) {
    return Boolean(parseMvDate(value));
  }

  function looksLikeMvValue(value) {
    return parseMarketValueAny(value) !== null;
  }

  function parseMvDate(input) {
    if (input === null || input === undefined || input === '') return null;
    if (typeof input === 'number') {
      const ms = input > 100000000000 ? input : input * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return { ms: d.getTime(), iso: d.toISOString().slice(0, 10) };
    }
    const text = String(input).trim();
    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 1000000) return parseMvDate(asNumber);

    const parsed = Date.parse(text);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      return { ms: d.getTime(), iso: d.toISOString().slice(0, 10) };
    }

    const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (german) {
      const d = new Date(Date.UTC(parseInt(german[3], 10), parseInt(german[2], 10) - 1, parseInt(german[1], 10)));
      return { ms: d.getTime(), iso: d.toISOString().slice(0, 10) };
    }
    return null;
  }

  function findBaselinePoint(points, growthSince) {
    const target = Date.parse(growthSince);
    if (Number.isNaN(target)) return points[0];
    let before = null;
    points.forEach(function eachPoint(point) {
      if (point.dateMs <= target) before = point;
    });
    if (before) return before;
    let nearest = points[0];
    points.forEach(function eachPoint(point) {
      if (Math.abs(point.dateMs - target) < Math.abs(nearest.dateMs - target)) nearest = point;
    });
    return nearest;
  }

  function findLastStepUp(points) {
    for (let index = points.length - 1; index > 0; index -= 1) {
      const current = points[index];
      const previous = points[index - 1];
      if (current.value > previous.value) {
        return {
          fromDate: previous.date,
          toDate: current.date,
          fromValue: previous.value,
          toValue: current.value,
          absGrowth: current.value - previous.value,
          pctGrowth: previous.value > 0 ? ((current.value - previous.value) / previous.value) * 100 : null
        };
      }
    }
    return null;
  }

  async function getPlayingTime(candidateOrPlayerId) {
    const candidate = typeof candidateOrPlayerId === 'object' ? candidateOrPlayerId : { playerId: candidateOrPlayerId };
    const playerId = String(candidate.playerId || candidateOrPlayerId || '');
    const seasonStarts = recentSeasonStartYears();
    const sourcesTried = [];
    const encodedId = encodeURIComponent(playerId);

    // Fast path: the tmapi generic performance-game endpoint already returns all
    // season rows in the schema the user sampled. One request per player is much
    // faster than 1 + 2N season URLs + HTML fallback pages.
    const genericUrl = `https://tmapi.transfermarkt.technology/player/${encodedId}/performance-game`;
    let bestApi = null;
    try {
      sourcesTried.push(genericUrl);
      const apiJson = await httpGetCached(genericUrl, 'json');
      bestApi = parsePlayingTimeApiResponse(apiJson, seasonStarts);
      const finished = Object.assign(bestApi, {
        source: 'tmapi-fast',
        sourcesTried: sourcesTried.slice(0, 8)
      });
      if ((finished.rawRows || 0) > 0) return finished;
    } catch (error) {
      pushError('playing time api failed', { playerId: playerId, url: genericUrl, error: stringifyError(error) });
    }

    // Slow API fallback only if generic tmapi came back empty / failed.
    const bySeasonMap = new Map();
    let rawRows = bestApi ? (bestApi.rawRows || 0) : 0;
    let countedRows = bestApi ? (bestApi.countedRows || 0) : 0;
    if (bestApi && bestApi.bySeason) mergePlayingTimeMaps(bySeasonMap, bestApi.bySeason);

    for (const seasonStart of seasonStarts) {
      const apiUrl = `https://tmapi.transfermarkt.technology/player/${encodedId}/performance-game?season=${encodeURIComponent(seasonStart)}`;
      try {
        sourcesTried.push(apiUrl);
        const apiJson = await httpGetCached(apiUrl, 'json');
        const parsed = parsePlayingTimeApiResponse(apiJson, seasonStarts);
        rawRows += parsed.rawRows || 0;
        countedRows += parsed.countedRows || 0;
        mergePlayingTimeMaps(bySeasonMap, parsed.bySeason || []);
      } catch (error) {
        pushError('playing time api failed', { playerId: playerId, url: apiUrl, error: stringifyError(error) });
      }
    }

    const apiFinished = finishPlayingTime(bySeasonMap, rawRows, countedRows, true);
    if (apiFinished.rawRows > 0 || apiFinished.apps > 0 || apiFinished.minutes > 0) {
      apiFinished.source = 'tmapi-season-fallback';
      apiFinished.sourcesTried = sourcesTried.slice(0, 8);
      return apiFinished;
    }

    const fallback = await getPlayingTimeFromTransfermarktStats(candidate, seasonStarts);
    fallback.sourcesTried = sourcesTried.concat(fallback.sourcesTried || []).slice(0, 12);
    if (fallback.apps > 0 || fallback.minutes > 0) return fallback;

    const empty = emptyPlayingTime();
    empty.ok = true;
    empty.source = 'tmapi-and-transfermarkt-empty';
    empty.rawRows = rawRows + (fallback.rawRows || 0);
    empty.countedRows = countedRows + (fallback.countedRows || 0);
    empty.sourcesTried = fallback.sourcesTried || sourcesTried;
    return empty;
  }

  function parsePlayingTimeApiResponse(json, allowedSeasonStarts) {
    /*
     * tmapi.transfermarkt.technology/player/{id}/performance-game returns the useful
     * match rows under data.performance. The row schema is not flat:
     * - gameInformation.seasonId === 2025 for 25/26
     * - gameInformation.isNationalGame marks national team rows
     * - statistics.generalStatistics.participationState is played / in squad / not in squad
     * - statistics.playingTimeStatistics.playedMinutes contains the real minutes
     * Earlier versions tried to discover this with generic deep parsing and missed season.display.
     */
    const tmapiRows = getTmapiPerformanceRows(json);
    if (tmapiRows.length) {
      const allowedStarts = new Set((allowedSeasonStarts || []).map(function normalizeStart(start) {
        const number = parseInt(start, 10);
        return Number.isFinite(number) ? number : null;
      }).filter(function validStart(start) { return start !== null; }));
      const bySeasonMap = new Map();
      const playedGames = new Map();

      tmapiRows.forEach(function collectUniqueTmapiGame(row) {
        if (!row || typeof row !== 'object') return;
        const game = row.gameInformation || {};
        const stats = row.statistics || {};
        const general = stats.generalStatistics || {};
        const playingTime = stats.playingTimeStatistics || {};

        if (game.isNationalGame === true) return;

        const seasonStart = getTmapiSeasonStart(row);
        if (!Number.isFinite(seasonStart)) return;
        if (allowedStarts.size && !allowedStarts.has(seasonStart)) return;

        const minutes = parseMinutesLike(playingTime.playedMinutes);
        const safeMinutes = Math.max(0, minutes || 0);
        const state = normalizeText(general.participationState || '');
        const played = state === 'played' || safeMinutes > 0;
        if (!played) return;

        // TMAPI sometimes returns the same match more than once through different
        // query variants / competition group rows. Apps must be unique matches, not
        // raw rows. gameInformation.gameId is the canonical key when present.
        const key = getTmapiGameDedupeKey(row, seasonStart);
        const competition = cleanText(game.competitionId || game.competitionName || game.competitionDisplayName || '');
        const clubIds = extractClubIdsFromTmapiPerformanceRow(row).map(String);
        const existing = playedGames.get(key);
        if (existing) {
          existing.minutes = Math.max(existing.minutes, safeMinutes);
          if (competition) existing.competitions.add(competition);
          clubIds.forEach(function addExistingClubId(id) { if (id) existing.clubIds.add(id); });
          return;
        }

        playedGames.set(key, {
          season: `${seasonStart}/${String(seasonStart + 1).slice(-2)}`,
          minutes: safeMinutes,
          competitions: new Set(competition ? [competition] : []),
          clubIds: new Set(clubIds)
        });
      });

      playedGames.forEach(function addUniqueGame(game) {
        ensureSeasonBucket(bySeasonMap, game.season);
        const bucket = bySeasonMap.get(game.season);
        bucket.apps += 1;
        bucket.minutes += game.minutes;
        game.competitions.forEach(function addCompetition(name) { if (name) bucket.competitions.add(name); });
        game.clubIds.forEach(function addClubId(id) { if (id) bucket.clubIds.add(String(id)); });
      });

      const finished = finishPlayingTime(bySeasonMap, tmapiRows.length, playedGames.size, true);
      finished.dedupedRows = tmapiRows.length - playedGames.size;
      return finished;
    }

    // Fallback for future / changed tmapi shapes.
    const rows = uniquePerformanceRows(flattenPerformanceRows(json));
    const seasonSet = new Set((allowedSeasonStarts || []).map(function toSeason(start) { return `${start}/${String(start + 1).slice(-2)}`; }));
    const playedClubRows = rows.filter(function validGame(row) {
      const season = normalizeSeasonName(getRowSeason(row));
      return isClubPerformanceRow(row) && didPlay(row) && season && (!seasonSet.size || seasonSet.has(season));
    });

    const bySeasonMap = new Map();
    playedClubRows.forEach(function addGame(row) {
      const season = normalizeSeasonName(getRowSeason(row));
      if (!season) return;
      const minutes = extractPlayedMinutes(row);
      const apps = extractAppsFromPerformanceRow(row, minutes);
      if (apps <= 0 && minutes <= 0) return;
      ensureSeasonBucket(bySeasonMap, season);
      const bucket = bySeasonMap.get(season);
      bucket.apps += Math.max(0, apps);
      bucket.minutes += Math.max(0, minutes);
      const competition = getCompetitionName(row);
      if (competition) bucket.competitions.add(competition);
      extractClubIdsFromGenericPerformanceRow(row).forEach(function addGenericClubId(id) { bucket.clubIds.add(String(id)); });
    });

    return finishPlayingTime(bySeasonMap, rows.length, playedClubRows.length, true);
  }

  function getTmapiPerformanceRows(json) {
    if (!json || typeof json !== 'object') return [];
    if (json.data && Array.isArray(json.data.performance)) return json.data.performance;
    if (Array.isArray(json.performance)) return json.performance;
    if (Array.isArray(json.data)) return json.data;
    return [];
  }

  function getTmapiGameDedupeKey(row, seasonStart) {
    const game = row && row.gameInformation ? row.gameInformation : {};
    const clubs = row && row.clubsInformation ? row.clubsInformation : {};
    const club = clubs.club || {};
    const opponent = clubs.opponent || {};
    const id = cleanText(game.gameId || game.id || game.matchId || '');
    if (id) return `game:${id}`;
    const date = game.date && typeof game.date === 'object' ? cleanText(game.date.dateTimeUTC || game.date.date || game.date.datetime || '') : cleanText(game.date || '');
    const comp = cleanText(game.competitionId || game.competitionName || '');
    const clubId = cleanText(club.clubId || club.id || '');
    const oppId = cleanText(opponent.clubId || opponent.id || '');
    return `fallback:${seasonStart}|${date}|${comp}|${clubId}|${oppId}`;
  }

  function getTmapiSeasonStart(row) {
    const game = row && row.gameInformation ? row.gameInformation : {};
    const season = game.season && typeof game.season === 'object' ? game.season : {};
    const numeric = [game.seasonId, season.id, season.startYear, season.year].map(function toNumber(value) {
      const parsed = parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }).find(function valid(value) { return value !== null && value >= 1900 && value <= 2100; });
    if (numeric !== undefined) return numeric;

    const seasonText = [season.display, season.name, season.title, season.displayName, season.label, season.nonCyclicalName, season.cyclicalName]
      .map(cleanText)
      .find(Boolean);
    const normalized = normalizeSeasonName(seasonText);
    if (normalized) return seasonSortKey(normalized);

    const dateText = game.date && typeof game.date === 'object' ? (game.date.dateTimeUTC || game.date.date || game.date.datetime) : '';
    const parsedDate = parseMvDate(dateText);
    if (parsedDate) return seasonSortKey(seasonFromDate(new Date(parsedDate.ms)));
    return null;
  }

  function emptyPlayingTime() {
    return {
      ok: false,
      source: '',
      apps: 0,
      minutes: 0,
      latestSeasonApps: 0,
      latestSeasonMinutes: 0,
      competitionsSample: [],
      clubIdsSample: [],
      bySeason: [],
      recentSeasons: [],
      rawRows: 0,
      countedRows: 0,
      sourcesTried: []
    };
  }

  function ensureSeasonBucket(map, season) {
    if (!map.has(season)) map.set(season, { season: season, apps: 0, minutes: 0, competitions: new Set(), clubIds: new Set() });
  }

  function mergePlayingTimeMaps(bySeasonMap, seasons) {
    (seasons || []).forEach(function mergeSeason(season) {
      if (!season || !season.season) return;
      ensureSeasonBucket(bySeasonMap, season.season);
      const bucket = bySeasonMap.get(season.season);
      bucket.apps += Number(season.apps) || 0;
      bucket.minutes += Number(season.minutes) || 0;
      (season.competitions || []).forEach(function addCompetition(name) { if (name) bucket.competitions.add(name); });
      (season.clubIds || []).forEach(function addClubId(id) { if (id) bucket.clubIds.add(String(id)); });
    });
  }

  function finishPlayingTime(bySeasonMap, rawRows, countedRows, ok) {
    const bySeason = Array.from(bySeasonMap.values())
      .map(function finalizeSeason(bucket) {
        return {
          season: bucket.season,
          apps: bucket.apps,
          minutes: bucket.minutes,
          competitions: Array.from(bucket.competitions).slice(0, 6),
          clubIds: Array.from(bucket.clubIds || []).slice(0, 8)
        };
      })
      .sort(function latestSeasonFirst(a, b) {
        return seasonSortKey(b.season) - seasonSortKey(a.season);
      });

    const wantedLabels = selectedSeasonLabels();
    const wanted = new Set(wantedLabels);
    const seasonByName = new Map(bySeason.map(function pair(season) { return [season.season, season]; }));
    const recent = wantedLabels.map(function wantedSeason(label) {
      return seasonByName.get(label) || { season: label, apps: 0, minutes: 0, competitions: [] };
    });
    const totals = recent.reduce(function sum(acc, season) {
      acc.apps += season.apps;
      acc.minutes += season.minutes;
      season.competitions.forEach(function pushCompetition(name) { acc.competitions.push(name); });
      season.clubIds = season.clubIds || [];
      season.clubIds.forEach(function pushClubId(id) { if (id) acc.clubIds.push(String(id)); });
      return acc;
    }, { apps: 0, minutes: 0, competitions: [], clubIds: [] });

    return {
      ok: Boolean(ok),
      source: '',
      apps: totals.apps,
      minutes: totals.minutes,
      latestSeasonApps: recent[0] ? recent[0].apps : 0,
      latestSeasonMinutes: recent[0] ? recent[0].minutes : 0,
      competitionsSample: unique(totals.competitions).slice(0, 7),
      clubIdsSample: unique(totals.clubIds).slice(0, 12),
      bySeason: bySeason,
      recentSeasons: recent,
      rawRows: rawRows || 0,
      countedRows: countedRows || 0
    };
  }

  function flattenPerformanceRows(value) {
    const rows = [];
    const seen = new WeakSet();

    function visit(item) {
      if (!item || typeof item !== 'object') return false;
      if (seen.has(item)) return false;
      seen.add(item);

      if (Array.isArray(item)) {
        let found = false;
        item.forEach(function visitArrayItem(child) {
          if (visit(child)) found = true;
        });
        return found;
      }

      let childRows = 0;
      Object.keys(item).forEach(function visitChild(key) {
        const child = item[key];
        if (child && typeof child === 'object' && visit(child)) childRows += 1;
      });

      if (looksLikePerformanceRow(item)) {
        rows.push(item);
        return true;
      }

      return childRows > 0;
    }

    visit(value);
    return rows;
  }

  function uniquePerformanceRows(rows) {
    const map = new Map();
    (rows || []).forEach(function keep(row, index) {
      const season = normalizeSeasonName(getRowSeason(row));
      const comp = normalizeText(getCompetitionName(row));
      const club = normalizeText(getRowClubName(row));
      const date = normalizeText(getRowDate(row));
      const min = extractPlayedMinutes(row);
      const apps = extractAppsFromPerformanceRow(row, min);
      const key = `${season}|${comp}|${club}|${date}|${min}|${apps}|${index}`;
      if (season && (min > 0 || apps > 0) && !map.has(key)) map.set(key, row);
    });
    return Array.from(map.values());
  }

  function looksLikePerformanceRow(row) {
    if (!row || typeof row !== 'object') return false;
    const season = normalizeSeasonName(getRowSeason(row));
    if (!season) return false;
    const minutes = extractPlayedMinutes(row);
    const apps = extractAppsFromPerformanceRow(row, minutes);
    const stateText = normalizeText(firstDeepValue(row, /participation|state|status|played/i, function hasText(value) { return cleanText(value).length > 0; }) || '');
    return minutes > 0 || apps > 0 || /played|eingesetzt|starter|substitute|subbed|bench/.test(stateText);
  }

  function isClubPerformanceRow(row) {
    const blob = normalizeText(JSON.stringify({
      competition: getCompetitionName(row),
      competitionType: firstDeepValue(row, /competitiontype|competition_type|type|category/i, function any(value) { return cleanText(value).length > 0; }) || '',
      teamType: firstDeepValue(row, /teamtype|team_type|squadtype|squad_type/i, function any(value) { return cleanText(value).length > 0; }) || '',
      national: firstDeepValue(row, /nationalteam|isnational|is_national/i, function any(value) { return value === true || cleanText(value).length > 0; }) || '',
      club: getRowClubName(row)
    }));

    if (firstDeepValue(row, /^(nationalteam|isnationalteam|isnational|is_national)$/i, function yes(value) { return value === true; }) === true) return false;
    if (/national team|international|world cup|european championship|euro qualification|nations league|africa cup|asian cup|copa america|gold cup|friendlies|qualification|u21|u20|u19/.test(blob)) {
      if (!/champions league|europa league|conference league|libertadores|sudamericana|club world cup/.test(blob)) return false;
    }
    return true;
  }

  function didPlay(row) {
    const stateText = normalizeText(firstDeepValue(row, /participationstate|participation|appearancestatus|status|state/i, function any(value) { return cleanText(value).length > 0; }) || '');
    if (/played|eingesetzt|starter|starting xi|substitute|subbed on|substitution in/.test(stateText)) return true;
    if (/not in squad|on the bench|bench only|unused|suspended|injured|absent/.test(stateText)) return false;
    return extractPlayedMinutes(row) > 0 || extractAppsFromPerformanceRow(row, 0) > 0;
  }

  function extractAppsFromPerformanceRow(row, minutesHint) {
    const direct = firstDeepValue(row, /^(appearances|appearance|apps|matches|matchcount|match_count|games|gamecount|game_count|playedgames|played_games|einsaetze|einsatze|spiele)$/i, function numbery(value) {
      const parsed = parseIntegerLike(value);
      return parsed !== null && parsed >= 0 && parsed < 80;
    });
    const parsed = parseIntegerLike(direct);
    if (parsed !== null) return parsed;
    return minutesHint && minutesHint > 0 ? 1 : 0;
  }

  function extractPlayedMinutes(row) {
    const direct = firstDeepValue(row, /^(playedminutes|played_minutes|minutesplayed|minutes_played|minutes|minute|einsatzminuten|playtime|minutesonfield|minutes_on_field)$/i, function minutes(value) {
      const parsed = parseMinutesLike(value);
      return parsed !== null && parsed >= 0;
    });
    const parsedDirect = parseMinutesLike(direct);
    if (parsedDirect !== null) return parsedDirect;

    const blob = JSON.stringify(row);
    const match = blob.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:'|min\b|minutes\b)/i);
    return match ? parseMinutesLike(match[1]) || 0 : 0;
  }

  function getRowSeason(row) {
    const direct = firstDeepValue(row, /^(seasonid|season_id|seasonname|season_name|season|competitionseasonname|competition_season_name|seasontitle|season_title|year)$/i, function seasony(value) {
      if (value && typeof value === 'object') return false;
      return Boolean(normalizeSeasonName(value));
    });
    if (direct !== undefined && direct !== null && direct !== '') return direct;

    const seasonObj = firstDeepValue(row, /^season$/i, function objectSeason(value) { return Boolean(value && typeof value === 'object'); });
    if (seasonObj && typeof seasonObj === 'object') {
      const fromObj = [seasonObj.display, seasonObj.name, seasonObj.title, seasonObj.displayName, seasonObj.label, seasonObj.nonCyclicalName, seasonObj.cyclicalName].find(function filled(value) { return Boolean(normalizeSeasonName(value)); });
      if (fromObj) return fromObj;
    }

    const dateValue = getRowDate(row);
    const parsedDate = parseMvDate(dateValue);
    if (parsedDate) return seasonFromDate(new Date(parsedDate.ms));
    return '';
  }

  function normalizeSeasonName(season) {
    const text = cleanText(season);
    if (!text) return '';
    const slash = text.match(/(20\d{2})\s*\/\s*(\d{2}|20\d{2})/);
    if (slash) return `${slash[1]}/${String(slash[2]).slice(-2)}`;
    const range = text.match(/(20\d{2})\s*-\s*(20\d{2})/);
    if (range) return `${range[1]}/${range[2].slice(-2)}`;
    const short = text.match(/(?:^|\b)(\d{2})\s*\/\s*(\d{2})(?:\b|$)/);
    if (short) {
      const start = parseInt(short[1], 10) >= 70 ? 1900 + parseInt(short[1], 10) : 2000 + parseInt(short[1], 10);
      return `${start}/${String(short[2]).padStart(2, '0')}`;
    }
    const single = text.match(/(20\d{2})/);
    if (single) return `${single[1]}/${String(parseInt(single[1], 10) + 1).slice(-2)}`;
    return '';
  }

  function seasonFromDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getUTCFullYear();
    const start = date.getUTCMonth() >= 6 ? year : year - 1;
    return `${start}/${String(start + 1).slice(-2)}`;
  }

  function seasonSortKey(season) {
    const match = String(season || '').match(/(20\d{2})/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function getCompetitionName(row) {
    const direct = firstDeepValue(row, /^(competitionid|competition_id|competitionname|competition_name|competitiontitle|competition_title|tournamentname|tournament_name|leaguename|league_name|wettbewerb|competition)$/i, function comp(value) {
      return value && typeof value !== 'object' && cleanText(value).length > 0;
    });
    if (direct) return cleanText(direct);
    const compObj = firstDeepValue(row, /^(competition|league|tournament)$/i, function compObj(value) { return Boolean(value && typeof value === 'object'); });
    if (compObj && typeof compObj === 'object') {
      return [compObj.name, compObj.title, compObj.displayName, compObj.label].map(cleanText).find(Boolean) || '';
    }
    return '';
  }

  function getRowClubName(row) {
    const direct = firstDeepValue(row, /^(clubname|club_name|teamname|team_name|verein|club|team)$/i, function club(value) {
      return value && typeof value !== 'object' && cleanText(value).length > 0;
    });
    if (direct) return cleanText(direct);
    const clubObj = firstDeepValue(row, /^(club|team|verein)$/i, function clubObj(value) { return Boolean(value && typeof value === 'object'); });
    if (clubObj && typeof clubObj === 'object') return [clubObj.name, clubObj.title, clubObj.displayName, clubObj.label].map(cleanText).find(Boolean) || '';
    return '';
  }

  function getRowDate(row) {
    return firstDeepValue(row, /^(date|matchdate|match_date|game_date|datum|datetime|datetimeutc|date_time_utc)$/i, looksLikeMvDateValue) || '';
  }

  function firstDeepValue(obj, keyRegex, predicate, maxDepth) {
    const seen = new WeakSet();
    const limit = maxDepth === undefined ? 5 : maxDepth;

    function visit(value, depth, key) {
      if (depth > limit) return undefined;
      if (key && keyRegex.test(String(key).replace(/[_\-\s]/g, ''))) {
        try {
          if (!predicate || predicate(value)) return value;
        } catch (ignore) {}
      }
      if (!value || typeof value !== 'object') return undefined;
      if (seen.has(value)) return undefined;
      seen.add(value);
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const found = visit(value[index], depth + 1, String(index));
          if (found !== undefined) return found;
        }
        return undefined;
      }
      for (const childKey of Object.keys(value)) {
        const found = visit(value[childKey], depth + 1, childKey);
        if (found !== undefined) return found;
      }
      return undefined;
    }

    return visit(obj, 0, '');
  }

  async function getPlayingTimeFromTransfermarktStats(candidate, seasonStarts) {
    const playerId = String(candidate.playerId || '');
    const slug = candidate.slug || extractSlug(candidate.profileUrl) || `player-${playerId}`;
    const slugPath = getPlayerSlugPath(candidate.profileUrl, slug);
    const competitionCodes = getCandidateCompetitionCodes(candidate);
    const bySeasonMap = new Map();
    let rawRows = 0;
    let countedRows = 0;
    const sourcesTried = [];

    for (const seasonStart of (seasonStarts || recentSeasonStartYears())) {
      const urls = buildPerformanceFallbackUrls(slugPath, playerId, seasonStart, competitionCodes);
      let seasonSolved = false;
      for (const url of urls) {
        try {
          sourcesTried.push(url);
          const html = await httpGetCached(url, 'text');
          const parsed = parseTransfermarktStatsPage(html, seasonStart);
          rawRows += parsed.rawRows;
          countedRows += parsed.countedRows;
          if (parsed.countedRows > 0 || parsed.bySeason.some(function someSeason(season) { return season.apps > 0 || season.minutes > 0; })) {
            mergePlayingTimeMaps(bySeasonMap, parsed.bySeason);
            seasonSolved = true;
            break;
          }
        } catch (error) {
          pushError('playing time fallback page failed', { playerId: playerId, season: seasonStart, url: url, error: stringifyError(error) });
        }
      }
      if (!seasonSolved) ensureSeasonBucket(bySeasonMap, `${seasonStart}/${String(seasonStart + 1).slice(-2)}`);
    }

    const finished = finishPlayingTime(bySeasonMap, rawRows, countedRows, true);
    finished.source = 'transfermarkt-stats-fallback';
    finished.sourcesTried = sourcesTried.slice(0, 12);
    return finished;
  }

  function recentSeasonStartYears() {
    const settings = state.settings || DEFAULTS;
    const latestStart = latestRelevantSeasonStart(settings);
    const windowMode = normalizePerformanceWindow(settings.performanceWindow || DEFAULTS.performanceWindow);

    if (windowMode !== 'auto') {
      const count = Math.max(1, Math.min(3, parseInt(windowMode, 10) || 2));
      return Array.from({ length: count }, function makeSeason(_unused, index) { return latestStart - index; });
    }

    const referenceStart = seasonStartFromReferenceDate(settings.growthSince);
    const firstStart = Math.min(referenceStart, latestStart);
    const years = [];
    for (let year = latestStart; year >= firstStart; year -= 1) years.push(year);
    return years.length ? years : [latestStart];
  }

  function latestRelevantSeasonStart(settings) {
    const contractYear = parseInt(settings && settings.contractYear, 10);
    if (Number.isFinite(contractYear) && contractYear >= 2000) return contractYear - 1;
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  }

  function seasonStartFromReferenceDate(value) {
    const parsed = parseMvDate(value);
    if (!parsed) return latestRelevantSeasonStart(state.settings || DEFAULTS);
    const date = new Date(parsed.ms);
    const month = date.getUTCMonth();
    // Treat June 30 / July 1 scout reference dates as the start of the next football season.
    // Example: 2023-06-30 => 2023/24, so Auto mode checks 23/24, 24/25, 25/26.
    return month >= 5 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  }

  function seasonLabelFromStart(start) {
    return `${start}/${String(start + 1).slice(-2)}`;
  }

  function selectedSeasonLabels() {
    return recentSeasonStartYears().map(seasonLabelFromStart);
  }

  function getPlayerSlugPath(profileUrl, slug) {
    try {
      const path = new URL(profileUrl).pathname;
      const beforeProfile = path.split('/profil/spieler/')[0];
      if (beforeProfile && beforeProfile !== '/') return beforeProfile;
    } catch (_error) {}
    return `/${String(slug || '').replace(/^\/+|\/+$/g, '')}`;
  }

  function getCandidateCompetitionCodes(candidate) {
    const codes = [];
    (candidate.competitionCodes || []).forEach(function addExisting(code) { if (code) codes.push(String(code).toUpperCase()); });
    (candidate.sourceUrls || []).forEach(function addSource(url) {
      collectCompetitionCodesFromText(url || '').forEach(function addCode(code) { codes.push(code); });
    });
    return expandAdjacentCompetitionCodes(unique(codes)).slice(0, 8);
  }

  function buildPerformanceFallbackUrls(slugPath, playerId, seasonStart, competitionCodes) {
    const safeSlugPath = String(slugPath || '').startsWith('/') ? String(slugPath || '') : `/${slugPath}`;
    const encodedId = encodeURIComponent(playerId);
    const season = encodeURIComponent(seasonStart);
    const urls = [
      // Correct TM order: /spieler/{id}/saison/{year}/wettbewerb/{code-or-empty}
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/saison/${season}/wettbewerb//`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/saison/${season}`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/plus/0/saison/${season}/wettbewerb//`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/plus/1/saison/${season}/wettbewerb//`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/plus/0?saison=${season}`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdatendetails/spieler/${encodedId}/plus/0/saison/${season}/wettbewerb//verein/0/liga/0`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdatendetails/spieler/${encodedId}/plus/1/saison/${season}/wettbewerb//verein/0/liga/0`,
      `https://www.transfermarkt.com${safeSlugPath}/leistungsdatendetails/spieler/${encodedId}/saison/${season}/wettbewerb//verein/0/liga/0/plus/1`
    ];

    (competitionCodes || []).slice(0, 6).forEach(function addCompetitionCode(code) {
      const c = encodeURIComponent(String(code || '').toUpperCase());
      if (!c) return;
      urls.push(`https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/saison/${season}/wettbewerb/${c}`);
      urls.push(`https://www.transfermarkt.com${safeSlugPath}/leistungsdaten/spieler/${encodedId}/plus/0/saison/${season}/wettbewerb/${c}`);
      urls.push(`https://www.transfermarkt.com${safeSlugPath}/leistungsdatendetails/spieler/${encodedId}/plus/0/saison/${season}/wettbewerb/${c}/verein/0/liga/0`);
      urls.push(`https://www.transfermarkt.com${safeSlugPath}/leistungsdatendetails/spieler/${encodedId}/plus/1/saison/${season}/wettbewerb/${c}/verein/0/liga/0`);
    });

    return unique(urls);
  }

  function parseTransfermarktStatsPage(html, seasonStart) {
    const doc = parseHtml(html);
    const season = `${seasonStart}/${String(seasonStart + 1).slice(-2)}`;
    const bySeasonMap = new Map();
    ensureSeasonBucket(bySeasonMap, season);

    const rows = Array.from(doc.querySelectorAll('table.items tbody tr, .responsive-table table tbody tr, table tbody tr')).filter(function realRow(row) {
      return row.querySelectorAll('td').length >= 3 && !row.classList.contains('thead') && !/^(season|competition|wettbewerb|verein|club)$/i.test(cleanText(row.textContent));
    });

    rows.forEach(function parseStatsRow(row) {
      const rowText = cleanText(row.textContent);
      if (!rowText || isNationalCompetitionText(rowText)) return;

      const cells = Array.from(row.querySelectorAll('td')).map(function cellText(td) { return cleanText(td.textContent); });
      const minutes = extractMinutesFromStatsCells(cells, rowText);
      const apps = extractAppsFromStatsCells(cells, minutes, rowText);
      if (apps <= 0 && minutes <= 0) return;

      const bucket = bySeasonMap.get(season);
      bucket.apps += apps;
      bucket.minutes += minutes;
      const comp = extractCompetitionFromStatsRow(row);
      if (comp) bucket.competitions.add(comp);
    });

    if (!rows.length) {
      const textParsed = parseStatsFromPlainText(cleanText(doc.body ? doc.body.textContent : html), season);
      if (textParsed.apps > 0 || textParsed.minutes > 0) {
        const bucket = bySeasonMap.get(season);
        bucket.apps += textParsed.apps;
        bucket.minutes += textParsed.minutes;
        textParsed.competitions.forEach(function addPlainCompetition(name) { if (name) bucket.competitions.add(name); });
      }
    }

    const bucket = bySeasonMap.get(season);
    const countedRows = bucket.apps;
    return {
      rawRows: rows.length,
      countedRows: countedRows,
      bySeason: [{
        season: season,
        apps: bucket.apps,
        minutes: bucket.minutes,
        competitions: Array.from(bucket.competitions).slice(0, 6)
      }]
    };
  }

  function parseStatsFromPlainText(text, season) {
    const normalized = cleanText(text || '');
    const result = { season: season, apps: 0, minutes: 0, competitions: [] };
    if (!normalized) return result;

    // TM rendered/markdown pages can collapse the summary table into text such as:
    // "Liga Portugal 2 28 10 ... 2,161'". Grab conservative apps + minutes pairs.
    const chunks = normalized.split(/(?=(?:Liga|Premier|Championship|Serie|LaLiga|Bundesliga|Eredivisie|SuperLiga|Super League|Cup|League|Pokal|Taça|Copa|Conference|Europa|Champions))/i);
    chunks.forEach(function parseChunk(chunk) {
      if (!chunk || isNationalCompetitionText(chunk)) return;
      const minutes = extractMinutesFromStatsRow(chunk);
      if (minutes <= 0) return;
      const numbers = Array.from(chunk.matchAll(/(\d{1,2})/g)).map(function toInt(match) { return parseInt(match[1], 10); }).filter(function sane(n) { return n > 0 && n < 70; });
      const apps = numbers.length ? numbers[0] : 1;
      result.apps += apps;
      result.minutes += minutes;
      const compMatch = chunk.match(/^(.{3,60}?)(?:\s+\d{1,2}|\s+\d{1,3}(?:[.,]\d{3})*\s*(?:'|min))/);
      if (compMatch) result.competitions.push(cleanText(compMatch[1]).slice(0, 60));
    });
    return result;
  }

  function extractCompetitionFromStatsRow(row) {
    const link = row.querySelector('a[href*="/wettbewerb/"], a[href*="/competition/"], td.hauptlink a, td a[title]');
    return cleanText((link && (link.getAttribute('title') || link.textContent)) || '');
  }

  function extractMinutesFromStatsCells(cells, rowText) {
    const cellValues = (cells || []).map(function parseCell(cell) {
      return /('|min\b|minutes\b)/i.test(cell) ? parseMinutesLike(cell) : null;
    }).filter(function valid(value) { return value !== null && value !== undefined; });
    if (cellValues.length) return Math.max.apply(null, cellValues);
    return extractMinutesFromStatsRow(rowText);
  }

  function extractMinutesFromStatsRow(rowText) {
    const matches = Array.from(String(rowText || '').matchAll(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:'|min\b|minutes\b)/gi));
    if (!matches.length) return 0;
    const values = matches.map(function toMin(match) { return parseMinutesLike(match[1]) || 0; });
    return Math.max.apply(null, values);
  }

  function extractAppsFromStatsCells(cells, minutes, rowText) {
    const safeCells = cells || [];
    if (minutes > 0 && looksLikeDetailedMatchRow(rowText, safeCells)) return 1;

    // Summary performance pages usually have: Competition | Appearances | Goals | ... | Minutes.
    // Prefer the first small positive numeric cell after the competition name.
    const likelyCells = safeCells.slice(1, Math.min(safeCells.length, 7));
    for (const cell of likelyCells) {
      if (/('|min\b|minutes\b)/i.test(cell)) continue;
      const parsed = parseIntegerLike(cell);
      if (parsed !== null && parsed > 0 && parsed < 80) return parsed;
    }
    return minutes > 0 ? 1 : 0;
  }

  function looksLikeDetailedMatchRow(rowText, cells) {
    const text = cleanText(rowText);
    if (/(\d{1,2}\.\d{1,2}\.\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})/.test(text)) return true;
    return (cells || []).some(function hasDate(cell) { return /(\d{1,2}\.\d{1,2}\.\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})/.test(cell); });
  }

  function extractAppsFromStatsRow(rowText, minutes) {
    if (minutes > 0 && /(\d{1,2}\.\d{1,2}\.\d{4}|[A-Z][a-z]{2}\s+\d{1,2},\s+20\d{2})/.test(rowText)) return 1;
    const compact = cleanText(rowText);
    const cells = compact.split(/\s+/).slice(-12);
    for (const token of cells) {
      const parsed = parseIntegerLike(token);
      if (parsed !== null && parsed > 0 && parsed < 80) return parsed;
    }
    return minutes > 0 ? 1 : 0;
  }

  function isNationalCompetitionText(text) {
    const normalized = normalizeText(text);
    return /national team|international|world cup|european championship|euro qualification|nations league|africa cup|asian cup|copa america|gold cup|friendlies|u21|u20|u19/.test(normalized)
      && !/champions league|europa league|conference league|club world cup|libertadores|sudamericana/.test(normalized);
  }


  function normalizeOwnTeamLookback(value) {
    return String(value || '').toLowerCase() === 'selectedseasons' ? 'selectedSeasons' : 'latestSeason';
  }

  function shouldApplyOwnTeamFilter(settings) {
    if (!settings || !settings.excludeOwnTeam) return false;
    const parsed = parseOwnTeamFilter(settings.ownTeamFilter);
    return parsed.ids.length > 0 || parsed.names.length > 0;
  }

  function parseOwnTeamFilter(value) {
    const ids = [];
    const names = [];
    String(value || '')
      .split(/[\n,;|]+/)
      .map(function trimPart(part) { return cleanText(part); })
      .filter(Boolean)
      .forEach(function parsePart(part) {
        collectClubIdsFromText(part).forEach(function addUrlId(id) { ids.push(id); });
        if (/^\d+$/.test(part)) ids.push(part);
        const name = normalizeOwnTeamName(part);
        if (name && !/^\d+$/.test(name) && !isGenericOwnTeamName(name)) names.push(name);
      });
    return { ids: unique(ids), names: unique(names) };
  }

  function normalizeOwnTeamName(value) {
    return normalizeText(value)
      .replace(/\b(football club|fc|cf|fk|sc|ac|afc|csm|cs|club|fotbal|association)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isGenericOwnTeamName(value) {
    const text = normalizeText(value);
    return !text || text.length < 3 || /^(fc|cf|fk|sc|ac|club|team|fotbal|football)$/.test(text);
  }

  function matchesOwnTeamSourceCandidate(candidate, settings) {
    const parsed = parseOwnTeamFilter(settings && settings.ownTeamFilter);
    if (!parsed.ids.length && !parsed.names.length) return false;
    const ids = [].concat(candidate && candidate.clubIds || []);
    if (ownTeamIdMatches(ids, parsed)) return true;
    return ownTeamNameMatches(candidate && candidate.club, parsed);
  }

  function detectOwnTeamHistory(candidate, profile, playingTime, settings) {
    const parsed = parseOwnTeamFilter(settings && settings.ownTeamFilter);
    const result = {
      detected: false,
      filter: cleanText(settings && settings.ownTeamFilter),
      lookback: normalizeOwnTeamLookback(settings && settings.ownTeamLookback),
      evidence: '',
      matchedClubIds: [],
      matchedClubNames: []
    };
    if (!parsed.ids.length && !parsed.names.length) return result;

    const evidence = [];
    const matchedIds = [];
    const matchedNames = [];

    const currentIds = unique([].concat(candidate && candidate.clubIds || [], profile && profile.clubIds || []));
    const currentNames = unique([candidate && candidate.club, profile && profile.club].filter(Boolean));

    if (ownTeamIdMatches(currentIds, parsed)) {
      currentIds.filter(function hasId(id) { return parsed.ids.includes(String(id)); }).forEach(function addId(id) {
        matchedIds.push(String(id));
        evidence.push('source/profile club ID ' + id);
      });
    }

    currentNames.forEach(function currentName(name) {
      if (ownTeamNameMatches(name, parsed)) {
        matchedNames.push(cleanText(name));
        evidence.push('source/profile club name ' + cleanText(name));
      }
    });

    const seasons = getOwnTeamLookbackSeasons(playingTime, result.lookback);
    seasons.forEach(function checkSeason(season) {
      const seasonIds = unique(season && season.clubIds || []);
      seasonIds.forEach(function seasonClubId(id) {
        if (parsed.ids.includes(String(id))) {
          matchedIds.push(String(id));
          evidence.push('performance ' + (season.season || 'season') + ' club ID ' + id);
        }
      });
    });

    result.matchedClubIds = unique(matchedIds);
    result.matchedClubNames = unique(matchedNames);
    result.evidence = unique(evidence).join(' | ');
    result.detected = Boolean(result.evidence);
    return result;
  }

  function getOwnTeamLookbackSeasons(playingTime, lookback) {
    const pt = playingTime || emptyPlayingTime();
    const recent = pt.recentSeasons && pt.recentSeasons.length ? pt.recentSeasons : [];
    if (normalizeOwnTeamLookback(lookback) === 'selectedSeasons') return recent;
    return recent.slice(0, 1);
  }

  function ownTeamIdMatches(ids, parsed) {
    if (!parsed || !parsed.ids || !parsed.ids.length) return false;
    return unique(ids || []).some(function sameId(id) { return parsed.ids.includes(String(id)); });
  }

  function ownTeamNameMatches(name, parsed) {
    if (!parsed || !parsed.names || !parsed.names.length) return false;
    const normalized = normalizeOwnTeamName(name);
    if (!normalized || isGenericOwnTeamName(normalized)) return false;
    return parsed.names.some(function sameName(term) {
      if (!term || isGenericOwnTeamName(term)) return false;
      return normalized === term || normalized.includes(term) || term.includes(normalized);
    });
  }

  function extractClubIdsFromTmapiPerformanceRow(row) {
    const ids = [];
    const club = row && row.clubsInformation && row.clubsInformation.club ? row.clubsInformation.club : null;
    const general = row && row.statistics && row.statistics.generalStatistics ? row.statistics.generalStatistics : null;
    [club && club.clubId, general && general.primaryClubId].forEach(function addId(value) {
      if (value !== null && value !== undefined && /^\d+$/.test(String(value))) ids.push(String(value));
    });
    return unique(ids);
  }

  function extractClubIdsFromGenericPerformanceRow(row) {
    const ids = [];
    const primaryClubId = firstDeepValue(row, /^(primaryclubid|primary_club_id)$/i, function validPrimaryId(value) {
      return value !== null && value !== undefined && /^\d+$/.test(String(value));
    }, 6);
    if (primaryClubId !== undefined && primaryClubId !== null) ids.push(String(primaryClubId));
    return unique(ids);
  }



  function isWithoutClubText(value) {
    return /without club|last club unknown|vertragslos|vereinslos|sans club|sin club/i.test(String(value || ''));
  }

  function resolveCurrentOrLastClub(candidate, profile) {
    const candidateClub = cleanText(candidate && candidate.club);
    const profileClub = cleanText(profile && profile.club);
    if (profileClub && !isWithoutClubText(profileClub)) return profileClub;
    if (candidateClub && !isWithoutClubText(candidateClub)) return candidateClub;
    return profileClub || candidateClub || '';
  }

  function getLatestPlayedSeason(playingTime) {
    const seasons = (playingTime && playingTime.recentSeasons) || (playingTime && playingTime.bySeason) || [];
    return seasons.find(function played(season) {
      return Number(season && (season.apps || 0)) > 0 || Number(season && (season.minutes || 0)) > 0;
    }) || seasons.find(function hasCompetition(season) {
      return season && season.competitions && season.competitions.length;
    }) || null;
  }

  function getPlayerCompetitionCodes(player) {
    const codes = [];
    (player && player.competitionCodes || []).forEach(function addExisting(code) { if (code) codes.push(String(code).toUpperCase()); });
    collectCodesFromLabels(player && player.sourceLabels || []).forEach(function addLabelCode(code) { if (code) codes.push(String(code).toUpperCase()); });
    collectCodesFromLabels(player && player.sourceUrls || []).forEach(function addUrlCode(code) { if (code) codes.push(String(code).toUpperCase()); });
    if (player && player.lastLeagueCode) codes.push(String(player.lastLeagueCode).toUpperCase());
    return unique(codes);
  }

  function buildClubLeagueContext(candidate, profile, playingTime, competitionCodes) {
    const club = resolveCurrentOrLastClub(candidate, profile);
    const latestSeason = getLatestPlayedSeason(playingTime);
    const latestCompetition = latestSeason && latestSeason.competitions && latestSeason.competitions.length ? cleanText(latestSeason.competitions[0]) : '';
    const codes = unique([].concat(competitionCodes || [], candidate && candidate.competitionCodes || [], profile && profile.competitionCodes || []));
    const firstCode = codes.find(Boolean) || '';
    const leagueFromCode = firstCode ? competitionLabel(firstCode) : '';
    const league = latestCompetition || leagueFromCode || extractLeagueFromSourceLabels(candidate && candidate.sourceLabels);
    return {
      club: club,
      league: league,
      leagueCode: firstCode,
      label: [club, league].filter(Boolean).join(' · '),
      latestSeason: latestSeason ? latestSeason.season : ''
    };
  }

  function extractLeagueFromSourceLabels(labels) {
    const values = labels || [];
    for (const label of values) {
      const codeMatch = String(label || '').match(/\b([A-Z]{1,4}\d[A-Z0-9]{0,4}|AR1N|MEXA|MLS1|JAP1|BRA1|CSL|SA1|QSL|UAE1)\b/);
      if (codeMatch && competitionLabel(codeMatch[1]) !== codeMatch[1]) return competitionLabel(codeMatch[1]);
      const text = cleanText(label);
      if (/league|liga|division|serie|bundesliga|superliga|premier|eredivisie|ligue|championship/i.test(text)) return text;
    }
    return '';
  }

  function formatClubLeagueText(player) {
    const club = cleanText(player && (player.club || player.lastClub));
    const league = cleanText(player && (player.lastLeague || player.currentLeague));
    if (club && league) return club + ' · ' + league;
    return club || league || '—';
  }

  function isEuropeanClubLeague(player) {
    const codes = getPlayerCompetitionCodes(player);
    if (codes.some(isEuropeanCompetitionCode)) return true;
    if (codes.length && codes.some(function knownGlobal(code) { return GLOBAL_EXTRA_FIRST_DIVISION_CODES.includes(code); })) return false;

    const text = normalizeText([player && player.lastLeague, player && player.availability, player && (player.sourceLabels || []).join(' ')].join(' '));
    if (/premier league|championship|league one|laliga|serie a|serie b|bundesliga|ligue 1|ligue 2|eredivisie|liga portugal|superliga|allsvenskan|ekstraklasa|jupiler|super league greece|süper lig|super lig|nb i|nb ii|hnl|prvaliga|veikkausliiga|eliteserien|superettan|superligaen|austrian|swiss|romanian|serbian|croatian|hungarian|czech|slovak|slovenian|bulgarian|cypriot|israeli|irish|scottish|ukrainian|russian/.test(text)) return true;
    if (/major league soccer|brasileir|argentina|liga mx|j1 league|j2 league|chinese super league|k league|a-league|saudi pro league|qatar stars|uae pro league|primera división|primera division|categoría primera|categoria primera|botola|egyptian|tunisian|algerian|south african|canadian premier/.test(text)) return false;

    // Unknown league should not kill an otherwise good candidate. TM sometimes hides the
    // current competition in profile HTML, so keep unknowns and show the missing league as —.
    return true;
  }

  function buildAvailability(candidate, profile, clubContext) {
    const types = candidate.sourceTypes || [];
    const bits = [];
    if (types.includes('free-agent') || /without club|vertragslos/i.test(profile.club || '')) bits.push('Free agent');
    if (types.includes('contract-expiring') || profile.contractUntil) bits.push(`Contract expiring${profile.contractUntil ? ` (${profile.contractUntil})` : ''}`);
    const league = clubContext && clubContext.league ? clubContext.league : '';
    const club = clubContext && clubContext.club ? clubContext.club : '';
    const context = [];
    if (club) context.push(`Utolsó klub: ${club}`);
    if (league) context.push(`Utolsó liga: ${league}`);
    const title = unique(bits).join(' + ') || 'Candidate';
    return context.length ? `${title} · ${context.join(' · ')}` : title;
  }

  function evaluatePlayer(player, settings) {
    if (isU21Mode(settings)) return evaluateU21Player(player, settings);
    const reasons = [];
    const mv = player.currentMarketValue;
    const age = player.age;
    const group = player.positionGroup;
    const pt = player.playingTime || emptyPlayingTime();

    if (mv === null || mv === undefined || mv < settings.minMv || mv > settings.maxMv) reasons.push('mv-out-of-range');
    if (age === null || age === undefined || age < settings.minAge || age > settings.maxAge) reasons.push('age-out-of-range');
    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    const detail = player.positionDetail || positionDetail(player.position);
    if (mode === 'broad') {
      if (!group || !isGroupEnabled(group, settings)) reasons.push('position-disabled');
    } else if (!isDetailEnabled(detail, settings)) {
      reasons.push('detail-position-disabled');
    }
    if (player.mv && player.mv.ok && !player.mv.passedTrend) reasons.push('market-value-dropped-too-much');
    if (!passesPlayingTimeThreshold(pt, settings)) reasons.push(settings.requireEverySeason ? 'playing-time-below-threshold-per-season' : 'playing-time-below-threshold');
    if (!matchesSelectedNationality(player.nationality, settings.contractNationalities || [])) reasons.push('contract-nationality-disabled');
    if (!isAvailabilityCandidate(player)) reasons.push('not-free-agent-or-expiring');
    if (settings.futureExclude && player.futureTransferDetected) reasons.push('future-transfer-detected');
    if (shouldApplyOwnTeamFilter(settings) && player.ownTeamExclusion && player.ownTeamExclusion.detected) reasons.push('own-team-recent-history');
    if (settings.europeanClubSourcesOnly !== false && !isEuropeanClubLeague(player)) reasons.push('outside-european-club-league');

    return { ok: reasons.length === 0, reasons: reasons };
  }


  function evaluateU21Player(player, settings) {
    const reasons = [];
    const mv = player.currentMarketValue;
    const age = player.age;
    const group = player.positionGroup;
    const detail = player.positionDetail || positionDetail(player.position);
    const u21 = player.u21 || buildU21Metrics(player, settings);

    // Missing/zero MV is allowed in U21 mode. If TM has a real MV, then the MV filter applies.
    if (mv !== null && mv !== undefined && Number(mv) > 0 && (mv < settings.u21MinMv || mv > settings.u21MaxMv)) reasons.push('u21-mv-out-of-range');
    if (age === null || age === undefined || age < settings.u21MinAge || age > settings.u21MaxAge) reasons.push('u21-age-out-of-range');
    if (!matchesU21Nationality(player.nationality, settings)) reasons.push('u21-nationality-disabled');
    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    if (mode === 'broad') {
      if (!group || !isGroupEnabled(group, settings)) reasons.push('position-disabled');
    } else if (!isDetailEnabled(detail, settings)) {
      reasons.push('detail-position-disabled');
    }
    if ((u21.matchRatio || 0) < settings.u21MinMatchRatio) reasons.push('u21-match-ratio-too-low');
    if (settings.futureExclude && player.futureTransferDetected) reasons.push('future-transfer-detected');
    if (shouldApplyOwnTeamFilter(settings) && player.ownTeamExclusion && player.ownTeamExclusion.detected) reasons.push('own-team-recent-history');
    if (settings.europeanClubSourcesOnly !== false && !isEuropeanClubLeague(player)) reasons.push('outside-european-club-league');

    return { ok: reasons.length === 0, reasons: reasons };
  }

  function computeU21MvTrendScore(mv, currentValue) {
    if (!mv || mv.absGrowth === null || mv.absGrowth === undefined) {
      // No MV / no MV history should not kill a youth profile. Treat it as neutral.
      return 50;
    }
    const absGrowth = Number(mv.absGrowth || 0);
    const pctGrowth = Number(mv.pctGrowth || 0);
    let score = 50;
    if (absGrowth > 0) score += Math.min(28, Math.log10(Math.max(1, absGrowth)) * 7);
    if (pctGrowth > 0) score += Math.min(22, pctGrowth / 3);
    if (absGrowth < 0) score -= Math.min(26, Math.log10(Math.max(1, Math.abs(absGrowth))) * 7);
    if (pctGrowth < 0) score -= Math.min(18, Math.abs(pctGrowth) / 4);
    return Math.max(0, Math.min(100, score));
  }

  function buildU21Metrics(player, settings) {
    const matchRatio = estimateU21MatchRatio(player.playingTime, player);
    const age = Number(player.age || 0);
    const mv = Number(player.currentMarketValue || player.sourceMarketValue || player.profileMarketValue || 0);
    const ageScore = age > 0 ? Math.max(0, Math.min(100, (22 - age) * 13 + 35)) : 35;
    const mvTrend = computeU21MvTrendScore(player.mv, mv);
    const playingVolume = computeU21PlayingVolumeScore(player.playingTime);

    // U21 score: játékidő + MV-változás + életkor + játékvolumen.
    // A lényeg: játszik-e elég sokat ott, ahol van + mit mozdult az MV + mennyire fiatal.
    const total = Math.round(
      (matchRatio * 0.46) +
      (mvTrend * 0.28) +
      (ageScore * 0.16) +
      (playingVolume * 0.10)
    );

    return {
      total: Math.max(0, Math.min(100, total)),
      matchRatio: Math.round(matchRatio),
      ageBonus: Math.round(ageScore),
      mvTrend: Math.round(mvTrend),
      playingVolume: Math.round(playingVolume)
    };
  }

  function buildU21Availability(player) {
    const u21 = player.u21 || {};
    return `U21 score ${u21.total || 0}/100 · Meccsarány ${u21.matchRatio || 0}% · MV ${u21.mvTrend || 0}`;
  }

  function estimateU21MatchRatio(playingTime, player) {
    const pt = playingTime || emptyPlayingTime();
    const latest = pt.recentSeasons && pt.recentSeasons.length ? pt.recentSeasons[0] : null;
    const apps = Number((latest && latest.apps) || pt.latestSeasonApps || pt.apps || 0);
    const minutes = Number((latest && latest.minutes) || pt.latestSeasonMinutes || pt.minutes || 0);

    // Fix 34-es szezon-alap: nem próbálunk mesterséges környezeti pontszámot számolni.
    // Ez tisztább, és nem bünteti/tolja túl mesterségesen a Serie A Primavera,
    // U19, román/magyar másodosztály jellegű környezetet sem.
    const expectedMatches = 34;
    const expectedMinutes = expectedMatches * 90;
    const appRatio = Math.max(0, Math.min(100, (apps / expectedMatches) * 100));
    const minuteRatio = Math.max(0, Math.min(100, (minutes / expectedMinutes) * 100));
    return Math.max(appRatio, minuteRatio);
  }

  function computeU21PlayingVolumeScore(playingTime) {
    const pt = playingTime || emptyPlayingTime();
    const latest = pt.recentSeasons && pt.recentSeasons.length ? pt.recentSeasons[0] : null;
    const apps = Number((latest && latest.apps) || pt.latestSeasonApps || pt.apps || 0);
    const minutes = Number((latest && latest.minutes) || pt.latestSeasonMinutes || pt.minutes || 0);
    const appScore = Math.min(100, apps * 4);
    const minuteScore = Math.min(100, minutes / 18);
    return Math.max(appScore, minuteScore);
  }

  function collectCodesFromLabels(values) {
    const codes = [];
    (values || []).forEach(function collect(value) {
      collectCompetitionCodesFromText(value || '').forEach(function add(code) { codes.push(code); });
    });
    return unique(codes);
  }

  function matchesSelectedNationality(nationality, selectedValues) {
    const selected = getSelectedCountryKeys(selectedValues || []);
    if (!selected.length) return true;
    const raw = normalizeCountrySearch(nationality || '');
    if (!raw) return true;
    return selected.some(function match(country) {
      const blob = countrySearchBlob(country);
      const normalizedCountry = normalizeCountrySearch(country);
      return blob.includes(raw) || raw.includes(normalizedCountry) || normalizedCountry.includes(raw);
    });
  }

  function matchesU21Nationality(nationality, settings) {
    return matchesSelectedNationality(nationality, (settings && settings.u21Nationalities) || []);
  }

  function formatU21Score(u21) {
    if (!u21) return '—';
    return `${u21.total || 0}/100 · Meccs ${u21.matchRatio || 0}% · MV ${u21.mvTrend || 0}`;
  }

  function formatU21Club(u21, player) {
    return formatClubLeagueText(player);
  }

  function formatU21MatchRatio(u21, playingTime) {
    return `${u21 && u21.matchRatio !== undefined ? u21.matchRatio : 0}% · ${formatPlayingTime(playingTime)}`;
  }

  function isGroupEnabled(group, settings) {
    return (group === 'GK' && settings.posGK)
      || (group === 'DEF' && settings.posDEF)
      || (group === 'MID' && settings.posMID)
      || (group === 'FWD' && settings.posFWD);
  }

  function isDetailEnabled(detail, settings) {
    const normalized = String(detail || 'Other').toUpperCase();
    const map = {
      GK: 'detailGK',
      CB: 'detailCB',
      LB: 'detailLB',
      RB: 'detailRB',
      DM: 'detailDM',
      CM: 'detailCM',
      AM: 'detailAM',
      LM: 'detailLM',
      RM: 'detailRM',
      LW: 'detailLW',
      RW: 'detailRW',
      WING: 'detailWING',
      CF: 'detailCF',
      SS: 'detailSS',
      OTHER: 'detailOther'
    };
    const key = map[normalized] || 'detailOther';
    return Boolean(settings[key]);
  }

  function isAnyDetailInGroupEnabled(group, settings) {
    const normalized = String(group || '').toUpperCase();
    if (normalized === 'GK') return Boolean(settings.detailGK);
    if (normalized === 'DEF') return Boolean(settings.detailCB || settings.detailLB || settings.detailRB || settings.detailOther);
    if (normalized === 'MID') return Boolean(settings.detailDM || settings.detailCM || settings.detailAM || settings.detailLM || settings.detailRM || settings.detailOther);
    if (normalized === 'FWD') return Boolean(settings.detailLW || settings.detailRW || settings.detailWING || settings.detailCF || settings.detailSS || settings.detailOther);
    return Boolean(settings.detailOther || anyDetailedPositionEnabled(settings));
  }

  function anyDetailedPositionEnabled(settings) {
    return DETAIL_POSITION_KEYS.some(function hasDetail(key) { return Boolean(settings[key]); });
  }

  function normalizePositionFilterMode(value) {
    return String(value || '').toLowerCase() === 'detail' ? 'detail' : 'broad';
  }

  function normalizeSearchDepth(_value) {
    // v10: the planner is always in the deepest/recovery mode.
    // User-facing control is only the max candidate count, so old saved fast/balanced values cannot weaken the search.
    return 'deep';
  }

  function searchDepthRank(settings) {
    const mode = normalizeSearchDepth((settings || state.settings || DEFAULTS).searchDepth);
    if (mode === 'fast') return 0;
    if (mode === 'deep') return 2;
    return 1;
  }

  function searchDepthBudgetMultiplier(settings) {
    const rank = searchDepthRank(settings);
    if (rank <= 0) return 0.7;
    if (rank >= 2) return 1.65;
    return 1;
  }


  function normalizeScoutMode(value) {
    return String(value || '').toLowerCase() === 'u21' ? 'u21' : 'contract';
  }

  function isU21Mode(settings) {
    return normalizeScoutMode((settings || state.settings || DEFAULTS).scoutMode) === 'u21';
  }

  function readMultiSelectValues(input) {
    if (!input || !input.options) return [];
    return Array.from(input.options).filter(function selected(option) { return option.selected; }).map(function value(option) { return option.value; }).filter(Boolean);
  }

  function setMultiSelectValue(input, values) {
    if (!input || !input.options) return;
    const selected = new Set((Array.isArray(values) ? values : []).map(String));
    Array.from(input.options).forEach(function mark(option) { option.selected = selected.has(String(option.value)); });
    input.dataset.manualTouched = selected.size ? '1' : '0';
    syncNationalityPickerFromSelect(input);
  }

  function syncNationalityPickerFromSelect(select) {
    if (!select || !select.dataset || !select.dataset.pickerId) return;
    const picker = document.getElementById(select.dataset.pickerId);
    if (!picker) return;
    Array.from(picker.querySelectorAll('[data-nationality-value]')).forEach(function syncItem(item) {
      const value = item.getAttribute('data-nationality-value');
      const option = Array.from(select.options).find(function findOption(opt) { return String(opt.value) === String(value); });
      const selected = Boolean(option && option.selected);
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function bindToggleableMultiSelect(panel) {
    Array.from(panel.querySelectorAll('select.tm-scout-v2-multi-select')).forEach(function bindOne(select) {
      bindOneToggleableMultiSelect(select);
    });
  }

  function bindOneToggleableMultiSelect(select) {
    if (!select || select.dataset.toggleBound === '1') return;
    select.dataset.toggleBound = '1';

    // Native <select multiple> jumps badly in Chrome when it is scrolled and an
    // off-screen option is toggled. Use a stable custom checklist while keeping
    // the original select hidden, so readSettings() can keep reading the same values.
    const pickerId = 'tm-scout-v2-nationality-picker-' + Math.random().toString(36).slice(2);
    select.dataset.pickerId = pickerId;
    select.classList.add('tm-scout-v2-native-multi-hidden');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;

    const wrapper = document.createElement('div');
    wrapper.className = 'tm-scout-v2-nationality-wrapper';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'tm-scout-v2-nationality-search';
    search.setAttribute('data-nationality-search', '1');
    search.placeholder = tx('Keresés nemzetiségre');
    search.setAttribute('aria-label', tx('Keresés nemzetiségre'));
    search.autocomplete = 'off';
    wrapper.appendChild(search);

    const picker = document.createElement('div');
    picker.id = pickerId;
    picker.className = 'tm-scout-v2-nationality-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', tx(select.name === 'contractNationalities' ? 'Contract nemzetiségek' : 'Nemzetiségek'));

    Array.from(select.options).forEach(function buildNationalityItem(option) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tm-scout-v2-nationality-option';
      item.setAttribute('data-nationality-value', option.value);
      item.setAttribute('data-search', option.getAttribute('data-search') || countrySearchBlob(option.value));
      item.setAttribute('aria-pressed', option.selected ? 'true' : 'false');
      item.innerHTML = [
        '<span class="tm-scout-v2-nationality-check" aria-hidden="true"></span>',
        `<span class="tm-scout-v2-nationality-name">${escapeHtml(countryLabel(option.value))}</span>`
      ].join('');
      if (option.selected) item.classList.add('is-selected');
      picker.appendChild(item);
    });
    wrapper.appendChild(picker);

    const empty = document.createElement('div');
    empty.className = 'tm-scout-v2-nationality-empty';
    empty.setAttribute('data-nationality-empty', '1');
    empty.hidden = true;
    empty.textContent = tx('Nincs egyező nemzetiség');
    wrapper.appendChild(empty);

    select.insertAdjacentElement('afterend', wrapper);

    search.addEventListener('input', function onNationalitySearchInput() {
      filterNationalityPicker(picker, search.value);
    });

    picker.addEventListener('click', function onNationalityPickerClick(event) {
      const item = event.target && event.target.closest ? event.target.closest('[data-nationality-value]') : null;
      if (!item) return;
      event.preventDefault();
      const scrollTop = picker.scrollTop;
      const value = item.getAttribute('data-nationality-value');
      const option = Array.from(select.options).find(function findOption(opt) { return String(opt.value) === String(value); });
      if (!option || option.disabled) return;
      option.selected = !option.selected;
      select.dataset.manualTouched = '1';
      syncNationalityPickerFromSelect(select);
      picker.scrollTop = scrollTop;
      window.requestAnimationFrame(function restoreNationalityPickerScroll() { picker.scrollTop = scrollTop; });
    });

    picker.addEventListener('keydown', function onNationalityPickerKeydown(event) {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      const item = event.target && event.target.closest ? event.target.closest('[data-nationality-value]') : null;
      if (!item) return;
      event.preventDefault();
      item.click();
    });
  }

  function setScoutModeUi(panel, mode) {
    const normalized = normalizeScoutMode(mode);

    // A sima hidden attribútum kevés volt, mert a panel CSS-ben több fieldset
    // display:grid!important szabályt kap. Ezért itt inline display:none!important
    // is megy rá, hogy U21 módban tényleg eltűnjenek a contract blokkok,
    // contract módban pedig tényleg eltűnjön az U21 blokk.
    function forceVisibility(block, shouldShow) {
      if (!block) return;
      block.hidden = !shouldShow;
      block.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      block.classList.toggle('tm-scout-v2-mode-hidden', !shouldShow);
      if (shouldShow) {
        block.style.removeProperty('display');
      } else {
        block.style.setProperty('display', 'none', 'important');
      }
    }

    Array.from(panel.querySelectorAll('[data-u21-settings]')).forEach(function toggle(block) {
      forceVisibility(block, normalized === 'u21');
    });
    Array.from(panel.querySelectorAll('[data-contract-settings]')).forEach(function toggle(block) {
      forceVisibility(block, normalized !== 'u21');
    });

    // A posztblokkok közösek mindkét módhoz, ezért maradnak láthatók, csak
    // broad/detail szerint váltanak a setPositionModeUi-ban.
    const note = panel.querySelector('[data-role="mode-note"]');
    if (note) {
      note.textContent = normalized === 'u21'
        ? tx('U21 mód: életkor + MV + játszott meccsarány + MV-változás. Nem kell lejáró szerződés.')
        : tx('Contract mód: csak lejáró/free agent menü; U21 prospect szűrők elrejtve.');
    }
  }

  function savedHasOwn(saved, key) {
    return Boolean(saved && Object.prototype.hasOwnProperty.call(saved, key));
  }

  function setPositionModeUi(panel, mode) {
    const normalized = normalizePositionFilterMode(mode);
    const broad = panel.querySelector('[data-position-mode-block="broad"]');
    const detail = panel.querySelector('[data-position-mode-block="detail"]');
    togglePositionBlock(broad, normalized === 'broad');
    togglePositionBlock(detail, normalized === 'detail');
  }

  function togglePositionBlock(block, active) {
    if (!block) return;
    block.classList.toggle('tm-scout-v2-muted-block', !active);
    Array.from(block.querySelectorAll('input,select,textarea')).forEach(function toggleInput(input) {
      input.disabled = !active;
    });
  }

  function passesPlayingTimeThreshold(playingTime, settings) {
    const pt = playingTime || emptyPlayingTime();
    const rule = normalizeSeasonPassRule(settings.seasonPassRule || DEFAULTS.seasonPassRule);
    const passSeason = function passSeason(season) {
      const appsOk = (Number(season && season.apps) || 0) >= settings.minApps;
      const minutesOk = (Number(season && season.minutes) || 0) >= settings.minMinutes;
      return rule === 'and' ? (appsOk && minutesOk) : (appsOk || minutesOk);
    };

    if (settings.requireEverySeason) {
      const required = selectedSeasonLabels();
      const byName = new Map((pt.recentSeasons || pt.bySeason || []).map(function pair(season) { return [season.season, season]; }));
      return required.every(function eachRequired(label) {
        return passSeason(byName.get(label) || { season: label, apps: 0, minutes: 0 });
      });
    }

    const appsOk = (Number(pt.apps) || 0) >= settings.minApps;
    const minutesOk = (Number(pt.minutes) || 0) >= settings.minMinutes;
    return rule === 'and' ? (appsOk && minutesOk) : (appsOk || minutesOk);
  }

  function normalizePerformanceWindow(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'auto') return 'auto';
    if (raw === '1' || raw === '2' || raw === '3') return raw;
    return DEFAULTS.performanceWindow;
  }

  function normalizeSeasonPassRule(value) {
    return String(value || '').toLowerCase() === 'and' ? 'and' : 'or';
  }

  function sortFinalResults(a, b) {
    if (isU21Mode(state.settings)) {
      const au = a.u21 || {};
      const bu = b.u21 || {};
      return (Number(bu.total || 0) - Number(au.total || 0))
        || (Number(bu.matchRatio || 0) - Number(au.matchRatio || 0))
        || (getSortableAbsGrowth(b) - getSortableAbsGrowth(a))
        || ((a.age || 99) - (b.age || 99))
        || String(a.name || '').localeCompare(String(b.name || ''));
    }
    const ag = getSortableAbsGrowth(a);
    const bg = getSortableAbsGrowth(b);
    const ap = getSortablePctGrowth(a);
    const bp = getSortablePctGrowth(b);
    const am = a.currentMarketValue || 0;
    const bm = b.currentMarketValue || 0;

    // Primary sort: absolute MV growth in euros, descending.
    // Example: +€500k beats +€300k, even if the percentage growth is smaller.
    return bg - ag || bp - ap || bm - am || String(a.name || '').localeCompare(String(b.name || ''));
  }

  function getSortableAbsGrowth(player) {
    const value = player && player.mv ? Number(player.mv.absGrowth) : NaN;
    return Number.isFinite(value) ? value : -Infinity;
  }

  function getSortablePctGrowth(player) {
    const value = player && player.mv ? Number(player.mv.pctGrowth) : NaN;
    return Number.isFinite(value) ? value : -Infinity;
  }


  function setResultTableHeaders(panel, headers) {
    const tr = panel.querySelector('.tm-scout-v2-table thead tr');
    if (!tr) return;
    tr.innerHTML = headers.map(function headerCell(label, index) {
      const translated = tx(label);
      return `<th title="${escapeAttr(translated)}" data-col-index="${index + 1}">${escapeHtml(translated)}</th>`;
    }).join('');
  }

  function renderU21Results(panel, results) {
    setResultTableHeaders(panel, ['Játékos','Poszt','Kor','Nemzetiség','U21 score','Klub / csapat','MV most','MV változás','Játszott meccsarány','Utolsó szezonok','TM profil']);
    const tbody = panel.querySelector('[data-role="results"]');
    if (!tbody) return;
    tbody.textContent = '';

    if (!results.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.className = 'tm-scout-v2-empty';
      td.textContent = tx('Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.');
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    results.forEach(function addRow(player) {
      const tr = document.createElement('tr');
      const u21 = player.u21 || buildU21Metrics(player, state.settings || DEFAULTS);
      const cells = [
        player.name,
        `${player.positionGroup || '—'}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age === null || player.age === undefined ? '—' : String(player.age),
        player.nationality || '—',
        formatU21Score(u21),
        formatU21Club(u21, player),
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatU21MatchRatio(u21, player.playingTime),
        formatRecentSeasons(player.playingTime)
      ];
      const cellClasses = ['player','position','age','nation','u21-score','club','mv','growth','playing','seasons'];
      cells.forEach(function addCell(value, index) {
        const td = document.createElement('td');
        td.className = 'tm-scout-v2-cell-' + (cellClasses[index] || 'plain');
        td.textContent = value;
        td.title = String(value || '');
        tr.appendChild(td);
      });

      const linkTd = document.createElement('td');
      const link = document.createElement('a');
      link.href = player.profileUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = tx('Profil');
      linkTd.appendChild(link);
      tr.appendChild(linkTd);
      tbody.appendChild(tr);
    });
  }

  function renderResults(panel, results) {
    if (isU21Mode(state.settings)) {
      renderU21Results(panel, results);
      return;
    }
    setResultTableHeaders(panel, ['Játékos','Poszt','Kor','Nemzetiség','Elérhetőség','Klub / utolsó klub + liga','MV most','MV változás','Játékidő','Utolsó szezonok','TM profil']);
    const tbody = panel.querySelector('[data-role="results"]');
    if (!tbody) return;
    tbody.textContent = '';

    if (!results.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 11;
      td.className = 'tm-scout-v2-empty';
      td.textContent = tx('Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.');
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    results.forEach(function addRow(player) {
      const tr = document.createElement('tr');
      const cells = [
        player.name,
        `${player.positionGroup || '—'}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age === null || player.age === undefined ? '—' : String(player.age),
        player.nationality || '—',
        translateRuntimeText(player.availability || '—'),
        formatClubLeagueText(player),
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatPlayingTime(player.playingTime),
        formatRecentSeasons(player.playingTime)
      ];

      const cellClasses = ['player','position','age','nation','availability','club','mv','growth','playing','seasons'];
      cells.forEach(function addCell(value, index) {
        const td = document.createElement('td');
        td.className = 'tm-scout-v2-cell-' + (cellClasses[index] || 'plain');
        td.textContent = value;
        td.title = String(value || '');
        tr.appendChild(td);
      });

      const linkTd = document.createElement('td');
      const link = document.createElement('a');
      link.href = player.profileUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = tx('Profil');
      linkTd.appendChild(link);
      tr.appendChild(linkTd);
      tbody.appendChild(tr);
    });
  }

  function renderStats(panel) {
    if (!panel) panel = document.getElementById(APP.panelId);
    if (!panel) return;
    const stats = panel.querySelector('[data-role="stats"]');
    if (!stats) return;

    const cards = [
      [tx('Találatok'), state.results.length],
      [tx('Vizsgált játékosok'), state.rawCandidates.length || state.debug.rawCandidates || 0],
      [tx('Ellenőrizve'), state.enrichedCount || state.debug.enriched || 0]
    ];

    stats.textContent = '';
    cards.forEach(function addStat(card) {
      const div = document.createElement('div');
      div.className = 'tm-scout-v2-stat';
      const k = document.createElement('span');
      const v = document.createElement('strong');
      k.textContent = card[0];
      v.textContent = String(card[1]);
      div.appendChild(k);
      div.appendChild(v);
      stats.appendChild(div);
    });
  }

  function setLastKnownStatusLanguage(panel) {
    if (!panel) return;
    const status = panel.querySelector('[data-role="status"]');
    if (!status) return;
    const canonical = status.getAttribute('data-status-canonical') || normalizeRuntimeTextToCanonical(status.textContent || '');
    status.setAttribute('data-status-canonical', canonical);
    status.textContent = translateRuntimeText(canonical);
  }

  function setRowCellText(row, index, value) {
    if (!row || !row.children || !row.children[index]) return;
    const text = value === null || value === undefined ? '' : String(value);
    const cell = row.children[index];
    if (cell.textContent !== text) cell.textContent = text;
    if (cell.title !== text) cell.title = text;
  }

  function setRowProfileText(row, index) {
    if (!row || !row.children || !row.children[index]) return;
    const link = row.children[index].querySelector('a');
    if (link) link.textContent = tx('Profil');
  }

  function refreshRenderedResultsLanguage(panel, results) {
    if (!panel) return;
    const tbody = panel.querySelector('[data-role="results"]');
    if (!tbody) return;

    if (isU21Mode(state.settings)) {
      setResultTableHeaders(panel, ['Játékos','Poszt','Kor','Nemzetiség','U21 score','Klub / csapat','MV most','MV változás','Játszott meccsarány','Utolsó szezonok','TM profil']);
      if (!results.length) {
        const empty = tbody.querySelector('.tm-scout-v2-empty');
        if (empty) empty.textContent = tx('Nincs U21 találat még. Engedj a meccsarány / MV / kor / poszt / nemzetiség szűrőn, vagy emelj Max pages értéket.');
        return;
      }
      const rows = Array.from(tbody.querySelectorAll('tr'));
      results.forEach(function updateU21Row(player, index) {
        const row = rows[index];
        if (!row) return;
        const u21 = player.u21 || buildU21Metrics(player, state.settings || DEFAULTS);
        const cells = [
          player.name,
          `${player.positionGroup || '—'}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
          player.age === null || player.age === undefined ? '—' : String(player.age),
          player.nationality || '—',
          formatU21Score(u21),
          formatU21Club(u21, player),
          formatEuro(player.currentMarketValue),
          formatGrowth(player.mv),
          formatU21MatchRatio(u21, player.playingTime),
          formatRecentSeasons(player.playingTime)
        ];
        cells.forEach(function updateCell(value, cellIndex) { setRowCellText(row, cellIndex, value); });
        setRowProfileText(row, 10);
      });
      return;
    }

    setResultTableHeaders(panel, ['Játékos','Poszt','Kor','Nemzetiség','Elérhetőség','Klub / utolsó klub + liga','MV most','MV változás','Játékidő','Utolsó szezonok','TM profil']);
    if (!results.length) {
      const empty = tbody.querySelector('.tm-scout-v2-empty');
      if (empty) empty.textContent = tx('Nincs találat még. Vagy túl szigorú a filter, vagy Transfermarkt épp trollkodik.');
      return;
    }

    const rows = Array.from(tbody.querySelectorAll('tr'));
    results.forEach(function updateContractRow(player, index) {
      const row = rows[index];
      if (!row) return;
      const cells = [
        player.name,
        `${player.positionGroup || '—'}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age === null || player.age === undefined ? '—' : String(player.age),
        player.nationality || '—',
        translateRuntimeText(player.availability || '—'),
        formatClubLeagueText(player),
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatPlayingTime(player.playingTime),
        formatRecentSeasons(player.playingTime)
      ];
      cells.forEach(function updateCell(value, cellIndex) { setRowCellText(row, cellIndex, value); });
      setRowProfileText(row, 10);
    });
  }

  function setStatus(panel, text, progress) {
    const status = panel.querySelector('[data-role="status"]');
    const bar = panel.querySelector('[data-role="progress"]');
    if (status) {
      const canonical = normalizeRuntimeTextToCanonical(text);
      status.setAttribute('data-status-canonical', canonical);
      status.textContent = translateRuntimeText(canonical);
    }
    if (bar && progress !== null && progress !== undefined) {
      bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    }
    renderStats(panel);
  }

  function buildCsvExport(results) {
    if (isU21Mode(state.settings)) return buildU21CsvExport(results);
    const headers = [
      ex('player'), ex('position'), ex('age'), ex('nationality'), ex('availability'), ex('clubLeague'),
      ex('currentMv'), ex('mvChange'), ex('playingTime'), ex('recentSeasons'), ex('tmProfile')
    ];
    const rows = results.map(function row(player) {
      return [
        player.name,
        `${player.positionGroup || ''}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age,
        player.nationality,
        player.availability,
        formatClubLeagueText(player),
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatPlayingTime(player.playingTime),
        formatRecentSeasons(player.playingTime),
        player.profileUrl
      ];
    });
    return [headers].concat(rows).map(function csvRow(row) {
      return row.map(csvEscape).join(',');
    }).join('\r\n');
  }


  function buildU21CsvExport(results) {
    const headers = [ex('player'), ex('position'), ex('age'), ex('nationality'), ex('u21Score'), ex('clubTeam'), ex('currentMv'), ex('mvChange'), ex('matchRatio'), ex('recentSeasons'), ex('tmProfile')];
    const rows = results.map(function row(player) {
      const u21 = player.u21 || {};
      return [
        player.name,
        `${player.positionGroup || ''}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age,
        player.nationality,
        formatU21Score(u21),
        formatU21Club(u21, player),
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatU21MatchRatio(u21, player.playingTime),
        formatRecentSeasons(player.playingTime),
        player.profileUrl
      ];
    });
    return [headers].concat(rows).map(function csvRow(row) {
      return row.map(csvEscape).join(',');
    }).join('\r\n');
  }

  function exportLocale() {
    const lang = currentUiLanguage();
    if (lang === 'ro') return 'ro-RO';
    if (lang === 'en') return 'en-US';
    return 'hu-HU';
  }

  function ex(key) {
    const lang = currentUiLanguage();
    const dict = {
      hu: {
        exportTitle: 'TM Scout V2 · Export',
        scoutExport: 'Transfermarkt Scout Export',
        generated: 'Export',
        u21Export: 'U21 export',
        contractExport: 'Lejáró szerződés / free agent export',
        results: 'találatok',
        checkedPlayers: 'vizsgált játékosok',
        enriched: 'ellenőrizve',
        mode: 'mód',
        filtersAndSorting: 'Szűrés és rendezés',
        players: 'játékos',
        sort: 'Rendezés',
        reset: 'Reset',
        backToFilters: 'Vissza a filterekhez',
        noResults: 'Nincs találat.',
        noExportRows: 'Nincs exportálható találat.',
        clientNote: 'A szűrés és rendezés kliensoldali. Nem indít új scrapinget.',
        player: 'Játékos',
        position: 'Poszt',
        age: 'Kor',
        nationality: 'Nemzetiség',
        availability: 'Elérhetőség',
        club: 'Klub',
        clubTeam: 'Klub / csapat',
        clubLeague: 'Klub / utolsó klub + liga',
        currentMv: 'MV most',
        mvChange: 'MV változás',
        playingTime: 'Játékidő',
        recentSeasons: 'Utolsó szezonok',
        profile: 'Profil',
        tmProfile: 'TM profil',
        u21Status: 'U21 állapot',
        u21Score: 'U21 score',
        matchRatio: 'Játszott meccsarány',
        broadPos: 'Tág poszt',
        detailPos: 'Konkrét poszt',
        allBroad: 'Összes tág poszt',
        allDetail: 'Összes konkrét poszt',
        allNationalities: 'Összes nemzetiség',
        availabilityFilter: 'Elérhetőség',
        allPlayers: 'Összes játékos',
        freeAgentsOnly: 'Csak free agentek',
        nonFreeOnly: 'Nem free agentek',
        absGrowth: 'Abszolút MV növekedés',
        mvNowSort: 'Jelenlegi MV',
        pctImprove: 'Százalékos javulás',
        pctDrop: 'Százalékos romlás',
        nameAZ: 'Név A–Z',
        scoreSort: 'U21 score',
        matchSort: 'Meccsarány',
        youngerFirst: 'Fiatalabb előre',
        criteriaMv: 'MV',
        criteriaAge: 'Kor',
        contractYear: 'Szerződés lejárati éve',
        mvRef: 'MV ref',
        maxMvDrop: 'Max MV drop',
        sortAbsGrowth: 'Rendezés: abszolút MV növekedés',
        countries: 'Nemzetiségek',
        all: 'összes',
        minMatchRatio: 'Min meccsarány',
        maxPages: 'Max oldalak',
        maxCandidates: 'Max jelöltek',
        searchDepth: 'Keresési mód',
        searchDepthFast: 'Gyors',
        searchDepthBalanced: 'Kiegyensúlyozott',
        searchDepthDeep: 'Alapos recovery',
        sortU21: 'Rendezés: U21 score',
        u21Weights: 'Fő súlyok: meccsarány · MV-változás · életkor · játékvolumen',
        joined: 'Érkezett',
        ends: 'Lejár',
        leagueLevel: 'Liga-szint',
        apps: 'meccs',
        app: 'meccs',
        min: 'perc',
        unknown: 'ismeretlen',
        noMvHistory: 'Nincs MV history',
        other: 'Other/unknown'
      },
      en: {
        exportTitle: 'TM Scout V2 · Export',
        scoutExport: 'Transfermarkt Scout Export',
        generated: 'Export',
        u21Export: 'U21 export',
        contractExport: 'Contract / free agent export',
        results: 'results',
        checkedPlayers: 'players checked',
        enriched: 'enriched',
        mode: 'mode',
        filtersAndSorting: 'Filters and sorting',
        players: 'players',
        sort: 'Sort',
        reset: 'Reset',
        backToFilters: 'Back to filters',
        noResults: 'No results.',
        noExportRows: 'No exportable results.',
        clientNote: 'Filtering and sorting are client-side. No new scraping is started.',
        player: 'Player',
        position: 'Position',
        age: 'Age',
        nationality: 'Nationality',
        availability: 'Availability',
        club: 'Club',
        clubTeam: 'Club / team',
        clubLeague: 'Club / last club + league',
        currentMv: 'Current MV',
        mvChange: 'MV change',
        playingTime: 'Playing time',
        recentSeasons: 'Recent seasons',
        profile: 'Profile',
        tmProfile: 'TM profile',
        u21Status: 'U21 status',
        u21Score: 'U21 score',
        matchRatio: 'Played-match ratio',
        broadPos: 'Broad position',
        detailPos: 'Exact position',
        allBroad: 'All broad positions',
        allDetail: 'All exact positions',
        allNationalities: 'All nationalities',
        availabilityFilter: 'Availability',
        allPlayers: 'All players',
        freeAgentsOnly: 'Free agents only',
        nonFreeOnly: 'Non-free agents',
        absGrowth: 'Absolute MV growth',
        mvNowSort: 'Current MV',
        pctImprove: 'Percentage improvement',
        pctDrop: 'Percentage decline',
        nameAZ: 'Name A–Z',
        scoreSort: 'U21 score',
        matchSort: 'Match ratio',
        youngerFirst: 'Younger first',
        criteriaMv: 'MV',
        criteriaAge: 'Age',
        contractYear: 'Contract expiry year',
        mvRef: 'MV ref',
        maxMvDrop: 'Max MV drop',
        sortAbsGrowth: 'Sort: absolute MV growth',
        countries: 'Nationalities',
        all: 'all',
        minMatchRatio: 'Min match ratio',
        maxPages: 'Max pages',
        maxCandidates: 'Max candidates',
        searchDepth: 'Search mode',
        searchDepthFast: 'Fast',
        searchDepthBalanced: 'Balanced',
        searchDepthDeep: 'Deep recovery',
        sortU21: 'Sort: U21 score',
        u21Weights: 'Main weights: match ratio · MV change · age · playing volume',
        joined: 'Joined',
        ends: 'Ends',
        leagueLevel: 'League level',
        apps: 'apps',
        app: 'app',
        min: 'min',
        unknown: 'unknown',
        noMvHistory: 'No MV history',
        other: 'Other/unknown'
      },
      ro: {
        exportTitle: 'TM Scout V2 · Export',
        scoutExport: 'Export Transfermarkt Scout',
        generated: 'Export',
        u21Export: 'Export U21',
        contractExport: 'Export contracte / jucători liberi',
        results: 'rezultate',
        checkedPlayers: 'jucători analizați',
        enriched: 'verificați',
        mode: 'mod',
        filtersAndSorting: 'Filtre și sortare',
        players: 'jucători',
        sort: 'Sortare',
        reset: 'Resetare',
        backToFilters: 'Înapoi la filtre',
        noResults: 'Nu există rezultate.',
        noExportRows: 'Nu există rezultate exportabile.',
        clientNote: 'Filtrarea și sortarea sunt locale. Nu pornește o nouă scanare.',
        player: 'Jucător',
        position: 'Post',
        age: 'Vârstă',
        nationality: 'Naționalitate',
        availability: 'Disponibilitate',
        club: 'Club',
        clubTeam: 'Club / echipă',
        clubLeague: 'Club / ultimul club + ligă',
        currentMv: 'MV actual',
        mvChange: 'Schimbare MV',
        playingTime: 'Minute jucate',
        recentSeasons: 'Sezoane recente',
        profile: 'Profil',
        tmProfile: 'Profil TM',
        u21Status: 'Status U21',
        u21Score: 'Scor U21',
        matchRatio: 'Procent meciuri jucate',
        broadPos: 'Grupă post',
        detailPos: 'Post exact',
        allBroad: 'Toate grupele',
        allDetail: 'Toate posturile exacte',
        allNationalities: 'Toate naționalitățile',
        availabilityFilter: 'Disponibilitate',
        allPlayers: 'Toți jucătorii',
        freeAgentsOnly: 'Doar jucători liberi',
        nonFreeOnly: 'Nu sunt jucători liberi',
        absGrowth: 'Creștere MV absolută',
        mvNowSort: 'MV actual',
        pctImprove: 'Îmbunătățire procentuală',
        pctDrop: 'Scădere procentuală',
        nameAZ: 'Nume A–Z',
        scoreSort: 'Scor U21',
        matchSort: 'Procent meciuri',
        youngerFirst: 'Mai tineri primii',
        criteriaMv: 'MV',
        criteriaAge: 'Vârstă',
        contractYear: 'Anul expirării contractului',
        mvRef: 'MV ref',
        maxMvDrop: 'Scădere MV max',
        sortAbsGrowth: 'Sortare: creștere MV absolută',
        countries: 'Naționalități',
        all: 'toate',
        minMatchRatio: 'Procent minim meciuri',
        maxPages: 'Pagini maxime',
        maxCandidates: 'Candidați maximi',
        searchDepth: 'Mod căutare',
        searchDepthFast: 'Rapid',
        searchDepthBalanced: 'Echilibrat',
        searchDepthDeep: 'Recuperare profundă',
        sortU21: 'Sortare: scor U21',
        u21Weights: 'Ponderi principale: procent meciuri · schimbare MV · vârstă · volum de joc',
        joined: 'Sosit',
        ends: 'Expiră',
        leagueLevel: 'Nivel ligă',
        apps: 'meciuri',
        app: 'meci',
        min: 'min',
        unknown: 'necunoscut',
        noMvHistory: 'Fără istoric MV',
        other: 'Altul/necunoscut'
      }
    };
    return (dict[lang] && dict[lang][key]) || dict.hu[key] || key;
  }

  function buildExportPositionCriteria(settings) {
    const s = settings || {};
    const broad = [];
    if (s.posGK) broad.push('GK');
    if (s.posDEF) broad.push('DEF');
    if (s.posMID) broad.push('MID');
    if (s.posFWD) broad.push('FWD');
    const allBroadSelected = broad.length === 0 || broad.length === 4;
    if (String(s.positionFilterMode || DEFAULTS.positionFilterMode) !== 'detail') {
      return allBroadSelected ? ex('allBroad') : broad.join(', ');
    }
    const detailPairs = [
      ['detailGK', 'GK'], ['detailCB', 'CB'], ['detailLB', 'LB'], ['detailRB', 'RB'],
      ['detailDM', 'DM'], ['detailCM', 'CM'], ['detailAM', 'AM'], ['detailLM', 'LM'], ['detailRM', 'RM'],
      ['detailLW', 'LW'], ['detailRW', 'RW'], ['detailWING', 'Winger'], ['detailCF', 'CF/ST'], ['detailSS', 'SS'], ['detailOther', ex('other')]
    ];
    const selected = detailPairs.filter(function pairEnabled(pair) { return Boolean(s[pair[0]]); }).map(function pairLabel(pair) { return pair[1]; });
    return selected.length === 0 || selected.length === detailPairs.length ? ex('allDetail') : selected.join(', ');
  }

  function formatSelectedCountries(values) {
    const list = values || [];
    if (!list.length) return ex('all');
    return list.map(function country(value) { return countryLabel(value); }).join(', ');
  }

  function formatExportSearchDepth(settings) {
    const depth = normalizeSearchDepth(settings && settings.searchDepth);
    if (depth === 'fast') return ex('searchDepthFast');
    if (depth === 'deep') return ex('searchDepthDeep');
    return ex('searchDepthBalanced');
  }

  function buildExportCriteria(settings) {
    const s = settings || {};
    if (isU21Mode(s)) {
      const countries = formatSelectedCountries(s.u21Nationalities || []);
      return [
        `${ex('criteriaAge')}: ${s.u21MinAge || '—'}–${s.u21MaxAge || '—'}`,
        `${ex('criteriaMv')}: ${formatEuro(s.u21MinMv || 0)} – ${formatEuro(s.u21MaxMv || 0)}`,
        `${ex('position')}: ${buildExportPositionCriteria(s)}`,
        `${ex('minMatchRatio')}: ${s.u21MinMatchRatio || 0}%`,
        `${ex('countries')}: ${countries}`,
        `${ex('maxPages')}: ${s.u21MaxSourcePages || DEFAULTS.u21MaxSourcePages}`,
        `${ex('maxCandidates')}: ${s.u21MaxCandidates || DEFAULTS.u21MaxCandidates}`,
        ex('sortU21'),
        ex('u21Weights')
      ];
    }
    const countries = formatSelectedCountries(s.contractNationalities || []);
    return [
      `${ex('criteriaMv')}: ${formatEuro(s.minMv)}–${formatEuro(s.maxMv)}`,
      `${ex('criteriaAge')}: ${s.minAge || '—'}–${s.maxAge || '—'}`,
      `${ex('countries')}: ${countries}`,
      `${ex('position')}: ${buildExportPositionCriteria(s)}`,
      `${ex('contractYear')}: ${s.contractYear || '—'}`,
      `${ex('mvRef')}: ${s.growthSince || '—'}`,
      `${ex('maxMvDrop')}: ${s.maxMvDropPct || 0}%`,
      ex('sortAbsGrowth')
    ];
  }

  function buildHtmlExport() {
    const mode = isU21Mode(state.settings) ? 'u21' : 'contract';
    const debug = state.debug || {};
    const settings = state.settings || debug.settings || {};
    const results = state.results || [];
    const lang = currentUiLanguage();
    const locale = exportLocale();

    function cleanDash(value) {
      const text = String(value === null || value === undefined || value === '' ? '—' : value).trim();
      return text || '—';
    }

    function splitChips(text) {
      return String(text || '').split(',').map(function trimChip(part) { return part.trim(); }).filter(Boolean);
    }

    function renderInlineList(text, fallback) {
      const items = splitChips(text);
      if (!items.length) return `<span class="muted">${escapeHtml(fallback || '—')}</span>`;
      return `<span class="plain-list">${items.map(function item(label) { return escapeHtml(label); }).join(', ')}</span>`;
    }

    function renderPlayer(player, index) {
      return [
        '<div class="player-cell">',
        `<div class="rank-line" data-rank>#${index + 1}</div>`,
        `<strong>${escapeHtml(cleanDash(player.name))}</strong>`,
        `<a class="profile-mini" href="${escapeAttr(player.profileUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex('tmProfile'))}</a>`,
        '</div>'
      ].join('');
    }

    function renderPosition(player) {
      const group = cleanDash(player.positionGroup || '—');
      const detail = cleanDash(player.positionDetail || '—');
      const label = cleanDash(player.position || '—');
      const detailLine = player.positionDetail ? `<div class="position-detail">${escapeHtml(detail)}</div>` : '';
      return ['<div class="position-cell">', `<div class="position-code">${escapeHtml(group)}</div>`, detailLine, `<div class="position-label">${escapeHtml(label)}</div>`, '</div>'].join('');
    }

    function renderClubLeague(player) {
      const club = cleanDash(player && (player.club || player.lastClub));
      const league = cleanDash(player && (player.lastLeague || player.currentLeague));
      const leagueLine = league !== '—' ? `<span class="muted-line">${escapeHtml(ex('leagueLevel'))}: ${escapeHtml(league)}</span>` : '';
      return `<div class="club-cell"><strong>${escapeHtml(club)}</strong>${leagueLine}</div>`;
    }

    function renderAvailability(text) {
      const raw = cleanDash(text);
      const match = raw.match(/^([^()]+)\((.*)\)$/);
      const title = match ? match[1].trim() : raw;
      let details = match ? match[2].trim() : '';
      const dates = details.match(/\b\d{2}\/\d{2}\/\d{4}\b/g) || [];
      const joinedMatch = details.match(/Joined:\s*(\d{2}\/\d{2}\/\d{4})/i);
      const joined = joinedMatch ? joinedMatch[1] : '';
      const expires = dates.length ? dates[dates.length - 1] : '';
      details = details.replace(/Joined:\s*\d{2}\/\d{2}\/\d{4}/i, '').trim();
      if (expires) details = details.replace(new RegExp(expires.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$'), '');
      details = details.replace(/\s+/g, ' ').trim();
      let leagueLevel = '';
      const levelMatch = details.match(/League level:\s*(.*)$/i);
      if (levelMatch) {
        leagueLevel = levelMatch[1].trim();
        details = details.slice(0, levelMatch.index).trim();
      }
      const detailParts = [];
      if (details) {
        const compact = translateRuntimeText(details);
        const splitByDash = compact.split(/\s+[·•-]\s+/).map(function cleanPart(part) { return part.trim(); }).filter(Boolean);
        detailParts.push.apply(detailParts, splitByDash.length > 1 ? splitByDash.slice(0, 3) : [compact]);
      }
      return ['<div class="availability-cell">', `<strong>${escapeHtml(translateRuntimeText(title))}</strong>`, detailParts.map(function detailLine(line) { return `<span>${escapeHtml(line)}</span>`; }).join(''), leagueLevel ? `<span class="muted-line">${escapeHtml(ex('leagueLevel'))}: ${escapeHtml(leagueLevel)}</span>` : '', (joined || expires) ? `<span class="date-line">${joined ? `${escapeHtml(ex('joined'))} ${escapeHtml(joined)}` : ''}${joined && expires ? ' · ' : ''}${expires ? `${escapeHtml(ex('ends'))} ${escapeHtml(expires)}` : ''}</span>` : '', '</div>'].join('');
    }

    function renderGrowth(mv) {
      if (!mv || mv.absGrowth === null || mv.absGrowth === undefined || !Number.isFinite(Number(mv.absGrowth))) {
        const current = mv && Number.isFinite(Number(mv.latestValue)) && Number(mv.latestValue) > 0 ? Number(mv.latestValue) : null;
        const label = mv && (mv.fallbackNoHistory || mv.unknown) ? ex('noMvHistory') : '—';
        const currentLine = current ? `<span class="muted-line">${escapeHtml(ex('currentMv'))}: ${escapeHtml(formatEuro(current))}</span>` : '';
        return `<div class="growth-cell"><span class="muted">${escapeHtml(label)}</span>${currentLine}</div>`;
      }
      const pct = mv.pctGrowth === null || mv.pctGrowth === undefined ? '—' : `${mv.pctGrowth >= 0 ? '+' : ''}${mv.pctGrowth.toFixed(1)}%`;
      const cls = mv.absGrowth >= 0 ? 'growth-positive' : 'growth-negative';
      return ['<div class="growth-cell">', `<div class="mv-route"><span>${escapeHtml(formatEuro(mv.baselineValue))}</span><span>→</span><span>${escapeHtml(formatEuro(mv.latestValue))}</span></div>`, `<div class="growth-line ${cls}">${mv.absGrowth >= 0 ? '+' : ''}${escapeHtml(formatEuro(mv.absGrowth))} (${escapeHtml(pct)})</div>`, '</div>'].join('');
    }

    function renderPlayingTime(pt, u21) {
      const safe = pt || emptyPlayingTime();
      const ratio = u21 && u21.matchRatio !== undefined ? `<span class="muted-line">${escapeHtml(String(u21.matchRatio))}% ${escapeHtml(ex('matchRatio').toLowerCase())}</span>` : '';
      return `<div class="playing-cell"><span><strong>${escapeHtml(String(safe.apps || 0))}</strong> ${escapeHtml(Number(safe.apps || 0) === 1 ? ex('app') : ex('apps'))}</span><span><strong>${escapeHtml(String(safe.minutes || 0))}</strong> ${escapeHtml(ex('min'))}</span>${ratio}</div>`;
    }

    function renderSeasons(pt) {
      const safe = pt || emptyPlayingTime();
      if (!safe.recentSeasons || !safe.recentSeasons.length) return '<span class="muted">—</span>';
      return `<div class="season-list">${safe.recentSeasons.map(function seasonRow(season) { return `<div class="season-row"><strong>${escapeHtml(season.season)}</strong><span class="season-stats"><span>${escapeHtml(String(season.apps))} ${escapeHtml(Number(season.apps || 0) === 1 ? ex('app') : ex('apps'))}</span><span>${escapeHtml(String(season.minutes))} ${escapeHtml(ex('min'))}</span></span></div>`; }).join('')}</div>`;
    }

    function isExportFreeAgent(player) {
      const blob = [player.availability || '', (player.sourceTypes || []).join(' '), (player.sourceLabels || []).join(' '), player.club || ''].join(' ').toLowerCase();
      return /free[-\s]?agent|current[-\s]?free|without club|vertragslos|vereinslos/.test(blob);
    }

    function getExportDetail(player) {
      const detail = String(player.positionDetail || '').toUpperCase().trim();
      if (detail) return detail;
      const label = String(player.position || '').toLowerCase();
      if (/goalkeeper|keeper|\bgk\b/.test(label)) return 'GK';
      if (/centre[-\s]?back|center[-\s]?back|\bcb\b/.test(label)) return 'CB';
      if (/left[-\s]?back|\blb\b/.test(label)) return 'LB';
      if (/right[-\s]?back|\brb\b/.test(label)) return 'RB';
      if (/defensive midfield|\bdm\b/.test(label)) return 'DM';
      if (/central midfield|centre midfield|center midfield|\bcm\b/.test(label)) return 'CM';
      if (/attacking midfield|\bam\b/.test(label)) return 'AM';
      if (/left midfield|\blm\b/.test(label)) return 'LM';
      if (/right midfield|\brm\b/.test(label)) return 'RM';
      if (/left winger|left wing|\blw\b/.test(label)) return 'LW';
      if (/right winger|right wing|\brw\b/.test(label)) return 'RW';
      if (/winger|wing/.test(label)) return 'WING';
      if (/centre[-\s]?forward|center[-\s]?forward|striker|\bcf\b|\bst\b/.test(label)) return 'CF';
      if (/second striker|\bss\b/.test(label)) return 'SS';
      return 'OTHER';
    }

    function rowDataAttrs(player) {
      const u21 = player.u21 || {};
      const mvNow = Number(player.currentMarketValue || 0);
      const abs = player && player.mv && Number.isFinite(Number(player.mv.absGrowth)) ? Number(player.mv.absGrowth) : -999999999999;
      const pct = player && player.mv && Number.isFinite(Number(player.mv.pctGrowth)) ? Number(player.mv.pctGrowth) : -999999999999;
      const broad = String(player.positionGroup || 'OTHER').toUpperCase();
      const detail = getExportDetail(player);
      return ['data-row="1"', `data-free-agent="${isExportFreeAgent(player) ? 'true' : 'false'}"`, `data-broad-pos="${escapeAttr(broad)}"`, `data-detail-pos="${escapeAttr(detail)}"`, `data-nationality="${escapeAttr(normalizeText(player.nationality || ''))}"`, `data-u21-score="${escapeAttr(u21.total || 0)}"`, `data-match-ratio="${escapeAttr(u21.matchRatio || 0)}"`, `data-age="${escapeAttr(player.age === null || player.age === undefined ? 999 : Number(player.age || 999))}"`, `data-mv-now="${Number.isFinite(mvNow) ? mvNow : 0}"`, `data-mv-abs="${abs}"`, `data-mv-pct="${pct}"`, `data-player-name="${escapeAttr(cleanDash(player.name).toLowerCase())}"`].join(' ');
    }

    function cell(labelKey, className, html) {
      return `<td class="${className}" data-label="${escapeAttr(ex(labelKey))}">${html}</td>`;
    }

    const rows = results.map(function row(player, index) {
      const u21 = player.u21 || buildU21Metrics(player, settings);
      if (mode === 'u21') {
        return ['<tr ' + rowDataAttrs(player) + '>', cell('player', 'player-col', renderPlayer(player, index)), cell('position', 'position-col', renderPosition(player)), cell('age', 'age-col', escapeHtml(player.age === null || player.age === undefined ? '—' : String(player.age))), cell('nationality', 'nation-col', renderInlineList(player.nationality, '—')), cell('u21Status', 'availability-col', `<div class="availability-cell"><strong>${escapeHtml(formatU21Score(u21))}</strong><span>${escapeHtml(formatU21MatchRatio(u21, player.playingTime))}</span></div>`), cell('clubTeam', 'club-col', renderClubLeague(player)), cell('currentMv', 'mv-now-col', `<strong>${escapeHtml(formatEuro(player.currentMarketValue))}</strong>`), cell('mvChange', 'growth-col', renderGrowth(player.mv)), cell('playingTime', 'playing-col', renderPlayingTime(player.playingTime, u21)), cell('recentSeasons', 'season-col', renderSeasons(player.playingTime)), cell('profile', 'link-col', `<a class="open-link" href="${escapeAttr(player.profileUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex('profile'))}</a>`), '</tr>'].join('');
      }
      return ['<tr ' + rowDataAttrs(player) + '>', cell('player', 'player-col', renderPlayer(player, index)), cell('position', 'position-col', renderPosition(player)), cell('age', 'age-col', escapeHtml(player.age === null || player.age === undefined ? '—' : String(player.age))), cell('nationality', 'nation-col', renderInlineList(player.nationality, '—')), cell('availability', 'availability-col', renderAvailability(player.availability)), cell('clubLeague', 'club-col', renderClubLeague(player)), cell('currentMv', 'mv-now-col', `<strong>${escapeHtml(formatEuro(player.currentMarketValue))}</strong>`), cell('mvChange', 'growth-col', renderGrowth(player.mv)), cell('playingTime', 'playing-col', renderPlayingTime(player.playingTime)), cell('recentSeasons', 'season-col', renderSeasons(player.playingTime)), cell('profile', 'link-col', `<a class="open-link" href="${escapeAttr(player.profileUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex('profile'))}</a>`), '</tr>'].join('');
    }).join('\n');

    const criteria = buildExportCriteria(settings);
    const nationalityOptions = mode === 'u21' ? unique(results.map(function nat(player) { return player.nationality || ''; }).filter(Boolean)).sort().map(function natOption(nat) { return `<option value="${escapeAttr(normalizeText(nat))}">${escapeHtml(nat)}</option>`; }).join('') : '';

    const controls = mode === 'u21'
      ? ['<label>' + ex('sort') + '<select id="sortBy"><option value="scoreDesc">' + ex('scoreSort') + '</option><option value="matchDesc">' + ex('matchSort') + '</option><option value="mvGrowthDesc">' + ex('absGrowth') + '</option><option value="mvDesc">' + ex('mvNowSort') + '</option><option value="ageAsc">' + ex('youngerFirst') + '</option><option value="nameAsc">' + ex('nameAZ') + '</option></select></label>', '<label>' + ex('broadPos') + '<select id="broadFilter"><option value="all">' + ex('allBroad') + '</option><option value="GK">GK</option><option value="DEF">DEF</option><option value="MID">MID</option><option value="FWD">ATT/FWD</option></select></label>', '<label>' + ex('detailPos') + '<select id="detailFilter"><option value="all">' + ex('allDetail') + '</option><option value="GK">GK</option><option value="CB">CB</option><option value="LB">LB</option><option value="RB">RB</option><option value="DM">DM</option><option value="CM">CM</option><option value="AM">AM</option><option value="LM">LM</option><option value="RM">RM</option><option value="LW">Left Winger</option><option value="RW">Right Winger</option><option value="WING">Winger</option><option value="CF">CF/ST</option><option value="SS">SS</option><option value="OTHER">' + ex('other') + '</option></select></label>', '<label>' + ex('nationality') + '<select id="nationalityFilter"><option value="all">' + ex('allNationalities') + '</option>' + nationalityOptions + '</select></label>'].join('\n')
      : ['<label>' + ex('sort') + '<select id="sortBy"><option value="absDesc">' + ex('absGrowth') + '</option><option value="mvDesc">' + ex('mvNowSort') + '</option><option value="pctDesc">' + ex('pctImprove') + '</option><option value="pctAsc">' + ex('pctDrop') + '</option><option value="nameAsc">' + ex('nameAZ') + '</option></select></label>', '<label>' + ex('availabilityFilter') + '<select id="freeFilter"><option value="all">' + ex('allPlayers') + '</option><option value="free">' + ex('freeAgentsOnly') + '</option><option value="nonfree">' + ex('nonFreeOnly') + '</option></select></label>', '<label>' + ex('broadPos') + '<select id="broadFilter"><option value="all">' + ex('allBroad') + '</option><option value="GK">GK</option><option value="DEF">DEF</option><option value="MID">MID</option><option value="FWD">ATT/FWD</option></select></label>', '<label>' + ex('detailPos') + '<select id="detailFilter"><option value="all">' + ex('allDetail') + '</option><option value="GK">GK</option><option value="CB">CB</option><option value="LB">LB</option><option value="RB">RB</option><option value="DM">DM</option><option value="CM">CM</option><option value="AM">AM</option><option value="LM">LM</option><option value="RM">RM</option><option value="LW">Left Winger</option><option value="RW">Right Winger</option><option value="WING">Winger</option><option value="CF">CF/ST</option><option value="SS">SS</option><option value="OTHER">' + ex('other') + '</option></select></label>'].join('\n');

    const filterControls = ['<section id="exportFilters" class="export-controls" aria-label="' + escapeAttr(ex('filtersAndSorting')) + '">', '<div class="export-control-head"><strong>' + escapeHtml(ex('filtersAndSorting')) + '</strong><span><b id="visibleCount">' + escapeHtml(String(results.length)) + '</b> / <b id="totalCount">' + escapeHtml(String(results.length)) + '</b> ' + escapeHtml(ex('players')) + '</span></div>', '<div class="export-control-grid">', controls, '<button type="button" id="resetFilters">' + escapeHtml(ex('reset')) + '</button>', '</div>', '<p class="export-control-note">' + escapeHtml(ex('clientNote')) + '</p>', '</section>'].join('\n');

    const headers = mode === 'u21'
      ? ['player','position','age','nationality','u21Status','clubTeam','currentMv','mvChange','playingTime','recentSeasons','profile']
      : ['player','position','age','nationality','availability','clubLeague','currentMv','mvChange','playingTime','recentSeasons','profile'];
    const colClasses = mode === 'u21'
      ? ['player','position','age','nation','availability','club','mvnow','growth','playing','season','link']
      : ['player','position','age','nation','availability','club','mvnow','growth','playing','season','link'];

    return ['<!doctype html>', `<html lang="${escapeAttr(lang)}">`, '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', `<title>${escapeHtml(ex('exportTitle'))}</title>`, '<style>', exportCss(), '</style>', '</head>', '<body>', '<main>', '<section class="hero">', '<div class="topline">', '<div>', `<div class="kicker">${escapeHtml(ex('scoutExport'))}</div>`, '<h1>TM Scout V2</h1>', `<p>${escapeHtml(mode === 'u21' ? ex('u21Export') : ex('contractExport'))} · ${escapeHtml(new Date().toLocaleString(locale))}</p>`, '</div>', `<div class="criteria">${criteria.map(function criterion(text) { return `<span>${escapeHtml(text)}</span>`; }).join('')}</div>`, '</div>', '<div class="stats">', `<div class="stat"><span>${escapeHtml(ex('results'))}</span><strong>${escapeHtml(String(results.length))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('checkedPlayers'))}</span><strong>${escapeHtml(String(state.rawCandidates.length || debug.rawCandidates || 0))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('enriched'))}</span><strong>${escapeHtml(String(state.enrichedCount || debug.enriched || 0))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('mode'))}</span><strong>${escapeHtml(mode === 'u21' ? 'U21' : 'Contract')}</strong></div>`, '</div>', '</section>', filterControls, '<section class="table-wrap">', '<table>', `<colgroup>${colClasses.map(function cc(cls) { return `<col class="${escapeAttr(cls)}">`; }).join('')}</colgroup>`, `<thead><tr>${headers.map(function h(key) { const label = ex(key); return `<th title="${escapeAttr(label)}">${escapeHtml(label)}</th>`; }).join('')}</tr></thead>`, `<tbody data-export-body>${rows || '<tr><td colspan="11">' + escapeHtml(ex('noResults')) + '</td></tr>'}</tbody>`, '</table>', '</section>', '</main>', '<button type="button" id="jumpToFilters" class="filter-jump" aria-label="' + escapeAttr(ex('backToFilters')) + '">↑ ' + escapeHtml(ex('backToFilters')) + '</button>', '<script>', exportScript(mode), exportMobileJumpScript(), '</script>', '</body>', '</html>'].join('\n');
  }

  function exportCss() {
    return [
      ':root{color-scheme:dark;--bg:#071018;--panel:#0b1722;--panel2:#0e1f2e;--line:rgba(125,166,200,.24);--line2:rgba(125,166,200,.14);--text:#eef7ff;--muted:#9fb3c7;--green:#56f097;--blue:#9bd2ff;--red:#ff8b8b}',
      '*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,rgba(86,240,151,.13),transparent 34rem),radial-gradient(circle at top right,rgba(80,140,220,.14),transparent 32rem),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.42}main{width:min(1820px,calc(100% - 28px));margin:0 auto;padding:22px 0 42px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.hero,.export-controls,.table-wrap{border:1px solid var(--line);border-radius:22px;background:rgba(11,23,34,.88);box-shadow:0 22px 70px rgba(0,0,0,.25)}.hero{padding:22px;margin-bottom:14px}.topline{display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.kicker{color:var(--green);font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:900}h1{margin:5px 0 7px;font-size:clamp(30px,4.8vw,56px);letter-spacing:-.055em;line-height:.95}.hero p{margin:0;color:var(--muted)}.criteria{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;max-width:720px}.criteria span{border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.045);padding:6px 10px;color:#dceafa;font-size:12px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.stat{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.045);padding:13px}.stat span{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px}.stat strong{display:block;font-size:26px;margin-top:3px}.export-controls{padding:14px 16px;margin-bottom:14px}.export-control-head{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:12px;color:#dceafa}.export-control-head strong{font-size:14px}.export-control-head span{font-size:12px;color:var(--muted)}.export-control-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr)) auto;gap:10px;align-items:end}.export-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:800;color:#9fb6c9;text-transform:uppercase;letter-spacing:.04em}.export-controls select{width:100%;border:1px solid var(--line);border-radius:10px;background:#071018;color:#eef6ff;padding:8px 10px;font:700 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif}.export-controls button{height:35px;border:1px solid var(--line);border-radius:10px;background:#102235;color:#eaf4ff;font-weight:800;cursor:pointer;padding:0 14px}.export-controls button:hover{background:#16314a}.export-control-note{margin:10px 0 0;color:#849aaf;font-size:11.5px}.table-wrap{overflow:auto}table{width:100%;min-width:1540px;border-collapse:collapse;table-layout:fixed}th,td{padding:13px 10px;border-bottom:1px solid var(--line2);vertical-align:top;text-align:left;overflow-wrap:anywhere}th{position:sticky;top:0;background:#102235;color:#dceafa;font-size:10.2px;text-transform:uppercase;letter-spacing:.035em;z-index:1;white-space:normal;word-break:normal;overflow-wrap:normal;hyphens:auto;line-height:1.18}tr:nth-child(even) td{background:rgba(255,255,255,.025)}.rank-line{color:var(--green);font-size:16px;font-weight:950;line-height:1;margin-bottom:4px}.player-cell strong{display:block;font-size:19px;line-height:1.16;letter-spacing:-.018em}.profile-mini{display:inline-block;font-size:12px;line-height:1.12;font-weight:800;margin-top:3px}.open-link{font-weight:800}.position-code{font-weight:950;font-size:15px;line-height:1.18}.position-detail{display:block;font-weight:900;color:#dceafa;margin-top:3px;font-size:14px;line-height:1.2}.position-label,.muted,.muted-line,.date-line{display:block;color:var(--muted);font-size:12px;margin-top:3px;line-height:1.25}.availability-cell strong,.availability-cell span,.playing-cell span{display:block}.availability-cell strong{margin-bottom:3px}.playing-cell{display:flex;flex-direction:column;gap:2px}.season-list{display:flex;flex-direction:column;gap:7px;min-width:0}.season-row{display:grid;grid-template-columns:64px minmax(0,1fr);column-gap:10px;align-items:start;line-height:1.24}.season-row span{display:block}.season-row strong{font-size:14.6px;color:#eef7ff;white-space:nowrap;font-weight:950}.season-stats{display:flex!important;flex-wrap:wrap;gap:2px 10px;color:#e8f4ff;font-size:14.1px;font-weight:850}.season-stats span{white-space:nowrap}.plain-list{font-weight:700}.growth-positive{color:var(--green);font-weight:950}.growth-negative{color:var(--red);font-weight:950}.mv-route{display:flex;gap:7px;color:#f0f8ff;font-size:14.5px;font-weight:950;line-height:1.18;letter-spacing:-.01em}.mv-route span{white-space:nowrap}.growth-line{font-size:15.2px;line-height:1.16;margin-top:4px}.playing-cell strong{color:#fff}.season-row{font-size:14px;color:#e8f4ff}col.player{width:175px}col.position{width:130px}col.age{width:82px}col.nation{width:150px}col.availability{width:285px}col.club{width:165px}col.mvnow{width:100px}col.growth{width:160px}col.playing{width:135px}col.season{width:300px}col.link{width:92px}.club-col strong{display:block;line-height:1.24}.availability-cell{line-height:1.28}.availability-cell strong{font-size:14px;line-height:1.25}.mv-now-col strong{font-size:16px}.player-col{font-weight:800}.is-hidden{display:none!important}',
      '@media(max-width:900px){body{font-size:13px;line-height:1.34;padding-bottom:72px}main{width:100%;padding:10px 7px calc(92px + env(safe-area-inset-bottom))}.hero{padding:13px;border-radius:15px;margin-bottom:10px}.topline{display:block}.kicker{font-size:9.5px;letter-spacing:.11em}h1{font-size:clamp(24px,8vw,34px);margin:3px 0 5px}.hero p{font-size:11.5px;line-height:1.32}.criteria{justify-content:flex-start;margin-top:9px;gap:6px}.criteria span{font-size:10.5px;padding:4px 7px}.stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:12px}.stat{padding:9px;border-radius:13px}.stat span{font-size:9.5px;letter-spacing:.055em}.stat strong{font-size:20px}.export-controls{padding:11px;border-radius:15px;margin-bottom:10px}.export-control-head{align-items:flex-start;flex-direction:column;gap:6px;margin-bottom:9px}.export-control-head strong{font-size:12.5px}.export-control-head span{font-size:10.8px}.export-control-grid{grid-template-columns:1fr 1fr;gap:8px}.export-control-grid button{grid-column:1/-1}.export-controls label{font-size:9.8px;gap:4px;letter-spacing:.035em}.export-controls select{padding:7px 8px;border-radius:9px;font-size:11px;line-height:1.15}.export-controls button{height:32px;font-size:11px;padding:0 10px}.export-control-note{font-size:10.5px;line-height:1.28;margin-top:8px}.table-wrap{border:0;background:transparent;overflow:visible;box-shadow:none}table,thead,tbody,tr,td{display:block;min-width:0;width:100%}colgroup,thead{display:none}tr{margin:0 0 9px;border:1px solid var(--line);border-radius:14px;background:#0b1824;overflow:hidden}td{display:grid;grid-template-columns:98px 1fr;gap:8px;border-bottom:1px solid var(--line2);padding:9px 9px;background:#0b1824!important;font-size:12.2px;line-height:1.3}td::before{content:attr(data-label);font-weight:850;color:var(--muted);text-transform:uppercase;font-size:8.9px;letter-spacing:.045em;line-height:1.18}.rank-line{font-size:13px}.player-cell strong{font-size:15.5px;line-height:1.13}.profile-mini{font-size:10.5px}.position-code{font-size:12.8px}.position-detail{font-size:12px}.position-label,.muted,.muted-line,.date-line{font-size:10.5px;line-height:1.22}.availability-cell strong{font-size:12px}.mv-now-col strong{font-size:13.5px}.mv-route{font-size:12.4px;gap:5px}.growth-line{font-size:12.8px}.season-list{gap:5px}.season-row{grid-template-columns:52px minmax(0,1fr);column-gap:7px;font-size:11.6px}.season-row strong{font-size:12.2px}.season-stats{font-size:11.7px;gap:1px 7px}.plain-list{font-size:11.8px}.filter-jump{display:block;position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:50;border:1px solid rgba(86,240,151,.55);border-radius:999px;background:#102235;color:#eef7ff;box-shadow:0 14px 40px rgba(0,0,0,.48);height:42px;font:900 12px/1 Inter,system-ui,-apple-system,Segoe UI,sans-serif;letter-spacing:.02em;cursor:pointer}.filter-jump:active{transform:translateY(1px)}}',
      '@media(min-width:901px){.filter-jump{display:none!important}}',
      '@media(max-width:540px){body{font-size:12px}.stats,.export-control-grid{grid-template-columns:1fr}.hero{padding:11px}.criteria span{font-size:9.8px}.stat strong{font-size:18px}td{grid-template-columns:1fr;gap:4px;padding:8px;font-size:11.4px}td::before{font-size:8.4px}.player-cell strong{font-size:14.5px}.season-row{grid-template-columns:1fr;gap:2px}.season-stats{font-size:11.1px}.filter-jump{height:39px;font-size:11.2px}}',
      '@media(max-width:900px),(pointer:coarse){html{font-size:10px!important}body{font-size:10.5px!important;line-height:1.22!important;padding-bottom:58px!important}main{width:100%!important;padding:6px 5px calc(64px + env(safe-area-inset-bottom))!important}.hero{padding:9px!important;border-radius:12px!important;margin-bottom:7px!important}.topline{display:block!important}.kicker{font-size:7.8px!important;letter-spacing:.11em!important}h1{font-size:22px!important;line-height:.98!important;margin:2px 0 4px!important;letter-spacing:-.045em!important}.hero p{font-size:9.8px!important;line-height:1.25!important}.criteria{justify-content:flex-start!important;margin-top:7px!important;gap:4px!important}.criteria span{font-size:8.9px!important;line-height:1.15!important;padding:3px 6px!important}.stats{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;margin-top:8px!important}.stat{padding:7px 8px!important;border-radius:11px!important}.stat span{font-size:7.8px!important;letter-spacing:.055em!important}.stat strong{font-size:16px!important;margin-top:1px!important}.export-controls{padding:8px!important;border-radius:12px!important;margin-bottom:7px!important}.export-control-head{gap:3px!important;margin-bottom:6px!important}.export-control-head strong{font-size:11px!important;line-height:1.15!important}.export-control-head span{font-size:9.4px!important}.export-control-grid{grid-template-columns:1fr 1fr!important;gap:6px!important}.export-controls label{font-size:7.9px!important;line-height:1.1!important;gap:3px!important;letter-spacing:.03em!important}.export-controls select{min-height:28px!important;height:28px!important;padding:5px 7px!important;border-radius:8px!important;font-size:9.5px!important;line-height:1.12!important}.export-controls button{grid-column:1/-1!important;height:29px!important;font-size:9.8px!important;border-radius:8px!important;padding:0 8px!important}.export-control-note{display:none!important}.table-wrap{border:0!important;background:transparent!important;box-shadow:none!important;overflow:visible!important}table,thead,tbody,tr,td{display:block!important;min-width:0!important;width:100%!important}colgroup,thead{display:none!important}tr{margin:0 0 6px!important;border:1px solid var(--line)!important;border-radius:11px!important;background:#0b1824!important;overflow:hidden!important}td{display:grid!important;grid-template-columns:82px minmax(0,1fr)!important;gap:5px!important;align-items:start!important;border-bottom:1px solid var(--line2)!important;padding:6px 7px!important;background:#0b1824!important;font-size:10.4px!important;line-height:1.18!important}td::before{content:attr(data-label)!important;font-size:7.4px!important;line-height:1.08!important;letter-spacing:.035em!important;font-weight:900!important;color:var(--muted)!important;text-transform:uppercase!important}.rank-line{font-size:10.5px!important;margin-bottom:2px!important}.player-cell strong{font-size:13.1px!important;line-height:1.06!important;letter-spacing:-.01em!important}.profile-mini{font-size:9.1px!important;margin-top:2px!important}.position-code{font-size:10.8px!important;line-height:1.1!important}.position-detail{font-size:10px!important;margin-top:2px!important;line-height:1.12!important}.position-label,.muted,.muted-line,.date-line{font-size:8.9px!important;line-height:1.15!important;margin-top:2px!important}.availability-cell{line-height:1.15!important}.availability-cell strong{font-size:10.2px!important;line-height:1.14!important;margin-bottom:2px!important}.availability-cell span{font-size:9.8px!important;line-height:1.14!important}.club-col strong{font-size:10.8px!important;line-height:1.15!important}.mv-now-col strong{font-size:11.2px!important}.mv-route{font-size:10.5px!important;gap:4px!important;line-height:1.12!important}.growth-line{font-size:10.8px!important;line-height:1.12!important;margin-top:2px!important}.playing-cell{gap:1px!important}.playing-cell span,.playing-cell strong{font-size:10.4px!important;line-height:1.12!important}.season-list{gap:4px!important}.season-row{grid-template-columns:46px minmax(0,1fr)!important;column-gap:5px!important;font-size:9.8px!important;line-height:1.12!important}.season-row strong{font-size:10.2px!important}.season-stats{font-size:9.8px!important;gap:1px 5px!important;line-height:1.12!important}.plain-list{font-size:10px!important}.open-link{font-size:10.4px!important}.filter-jump{display:block!important;position:fixed!important;left:8px!important;right:8px!important;bottom:calc(8px + env(safe-area-inset-bottom))!important;z-index:999!important;height:36px!important;border-radius:999px!important;font:900 10.5px/1 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}}',
      '@media(max-width:420px),(pointer:coarse){td{grid-template-columns:74px minmax(0,1fr)!important;padding:5px 6px!important;font-size:9.9px!important}td::before{font-size:7px!important}.player-cell strong{font-size:12.6px!important}h1{font-size:20px!important}.criteria span{font-size:8.4px!important}.stat strong{font-size:15px!important}.season-row{grid-template-columns:42px minmax(0,1fr)!important}.season-stats{font-size:9.3px!important}.availability-cell strong{font-size:9.8px!important}.filter-jump{height:34px!important;font-size:10px!important}}'
    ].join('');
  }

  function exportScript(mode) {
    if (mode === 'u21') {
      return `(function(){const tbody=document.querySelector('[data-export-body]');if(!tbody)return;const rows=Array.from(tbody.querySelectorAll('tr[data-row]'));const sortBy=document.getElementById('sortBy');const broadFilter=document.getElementById('broadFilter');const detailFilter=document.getElementById('detailFilter');const nationalityFilter=document.getElementById('nationalityFilter');const visibleCount=document.getElementById('visibleCount');const reset=document.getElementById('resetFilters');function num(row,key){const value=Number(row.dataset[key]);return Number.isFinite(value)?value:-999999999;}function name(row){return String(row.dataset.playerName||'');}function compareRows(a,b){const mode=sortBy?sortBy.value:'scoreDesc';if(mode==='matchDesc')return num(b,'matchRatio')-num(a,'matchRatio')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='mvGrowthDesc')return num(b,'mvAbs')-num(a,'mvAbs')||num(b,'mvPct')-num(a,'mvPct')||name(a).localeCompare(name(b));if(mode==='mvDesc')return num(b,'mvNow')-num(a,'mvNow')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='ageAsc')return num(a,'age')-num(b,'age')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='nameAsc')return name(a).localeCompare(name(b));return num(b,'u21Score')-num(a,'u21Score')||num(b,'matchRatio')-num(a,'matchRatio')||name(a).localeCompare(name(b));}function passes(row){const detail=detailFilter?detailFilter.value:'all';const broad=broadFilter?broadFilter.value:'all';const nat=nationalityFilter?nationalityFilter.value:'all';if(detail&&detail!=='all'&&row.dataset.detailPos!==detail)return false;if((!detail||detail==='all')&&broad&&broad!=='all'&&row.dataset.broadPos!==broad)return false;if(nat&&nat!=='all'&&row.dataset.nationality!==nat)return false;return true;}function apply(){const filtered=rows.filter(passes).sort(compareRows);rows.forEach(function(row){row.classList.add('is-hidden');});filtered.forEach(function(row,index){row.classList.remove('is-hidden');tbody.appendChild(row);const rank=row.querySelector('[data-rank]');if(rank)rank.textContent='#'+(index+1);});if(visibleCount)visibleCount.textContent=String(filtered.length);}[sortBy,broadFilter,detailFilter,nationalityFilter].forEach(function(el){if(el)el.addEventListener('change',apply);});if(reset)reset.addEventListener('click',function(){if(sortBy)sortBy.value='scoreDesc';if(broadFilter)broadFilter.value='all';if(detailFilter)detailFilter.value='all';if(nationalityFilter)nationalityFilter.value='all';apply();});apply();})();`;
    }
    return `(function(){const tbody=document.querySelector('[data-export-body]');if(!tbody)return;const rows=Array.from(tbody.querySelectorAll('tr[data-row]'));const sortBy=document.getElementById('sortBy');const freeFilter=document.getElementById('freeFilter');const broadFilter=document.getElementById('broadFilter');const detailFilter=document.getElementById('detailFilter');const visibleCount=document.getElementById('visibleCount');const reset=document.getElementById('resetFilters');function num(row,key){const value=Number(row.dataset[key]);return Number.isFinite(value)?value:-999999999999;}function name(row){return String(row.dataset.playerName||'');}function compareRows(a,b){const mode=sortBy?sortBy.value:'absDesc';if(mode==='mvDesc')return num(b,'mvNow')-num(a,'mvNow')||num(b,'mvAbs')-num(a,'mvAbs')||name(a).localeCompare(name(b));if(mode==='pctDesc')return num(b,'mvPct')-num(a,'mvPct')||num(b,'mvAbs')-num(a,'mvAbs')||name(a).localeCompare(name(b));if(mode==='pctAsc')return num(a,'mvPct')-num(b,'mvPct')||num(a,'mvAbs')-num(b,'mvAbs')||name(a).localeCompare(name(b));if(mode==='nameAsc')return name(a).localeCompare(name(b));return num(b,'mvAbs')-num(a,'mvAbs')||num(b,'mvPct')-num(a,'mvPct')||num(b,'mvNow')-num(a,'mvNow')||name(a).localeCompare(name(b));}function passes(row){const freeMode=freeFilter?freeFilter.value:'all';if(freeMode==='free'&&row.dataset.freeAgent!=='true')return false;if(freeMode==='nonfree'&&row.dataset.freeAgent==='true')return false;const detail=detailFilter?detailFilter.value:'all';const broad=broadFilter?broadFilter.value:'all';if(detail&&detail!=='all')return row.dataset.detailPos===detail;if(broad&&broad!=='all')return row.dataset.broadPos===broad;return true;}function apply(){const filtered=rows.filter(passes).sort(compareRows);rows.forEach(function(row){row.classList.add('is-hidden');});filtered.forEach(function(row,index){row.classList.remove('is-hidden');tbody.appendChild(row);const rank=row.querySelector('[data-rank]');if(rank)rank.textContent='#'+(index+1);});if(visibleCount)visibleCount.textContent=String(filtered.length);}[sortBy,freeFilter,broadFilter,detailFilter].forEach(function(el){if(el)el.addEventListener('change',apply);});if(reset)reset.addEventListener('click',function(){if(sortBy)sortBy.value='absDesc';if(freeFilter)freeFilter.value='all';if(broadFilter)broadFilter.value='all';if(detailFilter)detailFilter.value='all';apply();});apply();})();`;
  }



  function exportMobileJumpScript() {
    return `(function(){const button=document.getElementById('jumpToFilters');const filters=document.getElementById('exportFilters');if(!button||!filters)return;function jump(){filters.scrollIntoView({behavior:'smooth',block:'start'});}button.addEventListener('click',jump);button.addEventListener('touchend',function(event){event.preventDefault();jump();},{passive:false});})();`;
  }




  function showUiModal(message, options) {
    const opts = options || {};
    const overlay = document.createElement('div');
    overlay.className = `tm-scout-v2-ui-modal${opts.variant ? ' is-' + opts.variant : ''}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const title = opts.title || (opts.variant === 'error' ? tx('Hoppá') : APP.name);
    const text = translateRuntimeText(String(message || ''));
    overlay.innerHTML = [
      '<div class="tm-scout-v2-ui-modal-card">',
      '  <div class="tm-scout-v2-ui-modal-icon">✨</div>',
      `  <h3>${escapeHtml(title)}</h3>`,
      `  <p>${escapeHtml(text)}</p>`,
      `  <button type="button" data-close-ui-modal>${escapeHtml(tx('Oké'))}</button>`,
      '</div>'
    ].join('');
    document.body.appendChild(overlay);
    const close = function closeModal() { overlay.remove(); };
    const btn = overlay.querySelector('[data-close-ui-modal]');
    if (btn) btn.addEventListener('click', close, { once: true });
    overlay.addEventListener('click', function onOverlayClick(event) {
      if (event.target === overlay) close();
    });
    document.addEventListener('keydown', function onModalKey(event) {
      if (event.key === 'Escape') {
        document.removeEventListener('keydown', onModalKey);
        close();
      }
    });
    if (btn && btn.focus) window.setTimeout(function focusModalButton() { btn.focus(); }, 0);
  }

  function ensureHasResults() {
    if (!state.results.length) throw new Error(tx('Nincs exportálható találat. Előbb futtasd a keresést.'));
  }


  function openHtmlView() {
    const html = buildHtmlExport();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, 'tmScoutV2HtmlView', 'noopener,noreferrer,width=1280,height=900');
    if (!popup) {
      const overlay = document.createElement('div');
      overlay.className = 'tm-scout-v2-html-modal';
      overlay.innerHTML = [
        '<div class="tm-scout-v2-html-modal-head">',
        `<strong>${escapeHtml(tx('HTML nézet'))}</strong>`,
        `<button type="button" data-close-html-view>${escapeHtml(tx('Bezárás'))}</button>`,
        '</div>',
        `<iframe title="${escapeAttr(tx('HTML nézet'))}" src="${escapeAttr(url)}"></iframe>`
      ].join('');
      document.body.appendChild(overlay);
      overlay.querySelector('[data-close-html-view]').addEventListener('click', function closeHtmlView() {
        overlay.remove();
        URL.revokeObjectURL(url);
      });
      return;
    }
    window.setTimeout(function cleanupHtmlViewUrl() {
      URL.revokeObjectURL(url);
    }, 60000);
  }

  function downloadText(filename, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function cleanup() {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  async function httpGetCached(url, responseKind) {
    const key = `${APP.cachePrefix}http:${hashString(url)}`;
    const canReadCache = responseKind === 'json';
    if (canReadCache) {
      const cached = await gmGet(key, null);
      if (cached && cached.savedAt && Date.now() - cached.savedAt < APP.ttlMs) {
        state.debug.cacheHits += 1;
        return cached.value;
      }
    }

    state.debug.cacheMisses += 1;
    state.debug.networkRequests += 1;
    const value = await httpGet(url, responseKind);

    // Do NOT cache Transfermarkt HTML pages. They are large, and Tampermonkey/Chrome can
    // fail to inject scripts when GM storage grows beyond the extension message limit.
    // Cache only reasonably small JSON API payloads.
    if (responseKind === 'json') {
      try {
        const serialized = JSON.stringify(value);
        if (serialized && serialized.length <= 600000) {
          await gmSet(key, { savedAt: Date.now(), value: value });
        }
      } catch (error) {
        pushError('cache write skipped', stringifyError(error));
      }
    }
    return value;
  }

  function httpGet(url, responseKind) {
    if (isBatchableTransfermarktUrl(url) && tmScoutBatchEndpoint()) {
      return httpGetViaBatchProxy(url, responseKind);
    }
    return httpGetDirect(url, responseKind);
  }

  function httpGetViaBatchProxy(url, responseKind) {
    const normalizedKind = responseKind || 'text';
    const key = tmScoutBatchCacheKey(url, normalizedKind);
    const cached = tmScoutBatchMemoryGet(key);
    if (cached.hit) return Promise.resolve(cached.value);
    const pending = tmScoutBatchPendingByKey.get(key);
    if (pending) return pending;

    const promise = new Promise(function batchProxyPromise(resolve, reject) {
      tmScoutBatchQueue.push({ key: key, url: String(url), responseKind: normalizedKind, resolve: resolve, reject: reject });
      if (tmScoutBatchQueue.length >= TM_SCOUT_BATCH_SIZE) {
        flushTmScoutBatchProxyQueue();
        return;
      }
      if (!tmScoutBatchTimer) {
        tmScoutBatchTimer = window.setTimeout(flushTmScoutBatchProxyQueue, TM_SCOUT_BATCH_DELAY_MS);
      }
    });

    tmScoutBatchPendingByKey.set(key, promise);
    promise.then(function clearPendingOk(){ tmScoutBatchPendingByKey.delete(key); }, function clearPendingErr(){ tmScoutBatchPendingByKey.delete(key); });
    return promise;
  }

  function flushTmScoutBatchProxyQueue() {
    if (!tmScoutBatchQueue.length) return;
    if (tmScoutBatchTimer) {
      window.clearTimeout(tmScoutBatchTimer);
      tmScoutBatchTimer = null;
    }

    const endpoint = tmScoutBatchEndpoint();
    const batch = tmScoutBatchQueue.splice(0, TM_SCOUT_BATCH_SIZE);
    if (tmScoutBatchQueue.length && !tmScoutBatchTimer) {
      tmScoutBatchTimer = window.setTimeout(flushTmScoutBatchProxyQueue, TM_SCOUT_BATCH_DELAY_MS);
    }

    if (!endpoint || isTmScoutBatchPostTemporarilyDisabled()) {
      batch.forEach(function fallbackNoEndpointOrPostDisabled(item) {
        httpGetDirect(item.url, item.responseKind).then(function(value){ tmScoutBatchMemorySet(item.key, value); item.resolve(value); }).catch(item.reject);
      });
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(function abortBatch(){ controller.abort(); }, 60000);

    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=utf-8',
        'Accept': 'application/json,text/plain,*/*'
      },
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal,
      body: JSON.stringify({
        source: 'tm-scout-v2',
        mode: 'batch',
        items: batch.map(function mapBatchItem(item) {
          return { url: item.url, kind: item.responseKind || 'text' };
        })
      })
    }).then(async function onBatchResponse(response) {
      window.clearTimeout(timeout);
      if (!response.ok) {
        const error = new Error(`Batch proxy HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      const results = Array.isArray(payload && payload.results) ? payload.results : [];
      if (results.length !== batch.length) throw new Error('Batch proxy result count mismatch');

      results.forEach(function resolveBatchItem(result, index) {
        const item = batch[index];
        if (!result || result.ok === false || Number(result.status || 0) >= 400) {
          item.reject(new Error(result && result.error ? result.error : `HTTP ${result && result.status ? result.status : 'error'}`));
          return;
        }
        const body = result.body == null ? '' : String(result.body);
        if (item.responseKind === 'json') {
          const parsed = safeJsonParse(body, null);
          if (parsed == null && body.trim()) {
            item.reject(new Error('Batch proxy JSON parse failed'));
            return;
          }
          tmScoutBatchMemorySet(item.key, parsed);
          item.resolve(parsed);
          return;
        }
        tmScoutBatchMemorySet(item.key, body);
        item.resolve(body);
      });
    }).catch(function onBatchError(error) {
      window.clearTimeout(timeout);
      // If the deployed Worker is still an older GET-only build, the batch POST returns 405.
      // Do not keep hammering the root endpoint with POST for every batch; switch this browser tab
      // to the old single-GET proxy path for a few minutes. After deploying the v13 Worker, refresh
      // and batch mode will work again.
      const status = Number(error && error.status ? error.status : 0);
      if (status === 405 || status === 404 || status === 415 || status === 501) {
        disableTmScoutBatchPostTemporarily(`Batch proxy HTTP ${status}`);
      } else if (!tmScoutBatchFallbackWarningShown) {
        tmScoutBatchFallbackWarningShown = true;
        pushError('batch proxy fallback', stringifyError(error));
      }
      batch.forEach(function fallbackBatchItem(item) {
        httpGetDirect(item.url, item.responseKind).then(function(value){ tmScoutBatchMemorySet(item.key, value); item.resolve(value); }).catch(item.reject);
      });
    });
  }

  function httpGetDirect(url, responseKind) {
    return new Promise(function requestPromise(resolve, reject) {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          responseType: responseKind === 'json' ? 'json' : 'text',
          timeout: 30000,
          headers: {
            'Accept': responseKind === 'json' ? 'application/json,text/plain,*/*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'X-Requested-With': 'XMLHttpRequest'
          },
          onload: function onload(response) {
            if (response.status >= 200 && response.status < 300) {
              if (responseKind === 'json') {
                if (response.response && typeof response.response === 'object') {
                  resolve(response.response);
                  return;
                }
                const parsed = safeJsonParse(response.responseText, null);
                if (parsed) resolve(parsed);
                else reject(new Error(`Invalid JSON from ${url}`));
                return;
              }
              resolve(String(response.responseText || ''));
              return;
            }
            reject(new Error(`HTTP ${response.status} for ${url}`));
          },
          onerror: function onerror(error) {
            reject(new Error(`Network error for ${url}: ${stringifyError(error)}`));
          },
          ontimeout: function ontimeout() {
            reject(new Error(`Timeout for ${url}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async function clearOwnCache() {
    let keys = [];
    try {
      keys = await gmList();
    } catch (error) {
      pushError('cache list failed', stringifyError(error));
      return 0;
    }
    const own = keys.filter(function ownKey(key) { return String(key).startsWith(APP.cachePrefix); });
    await Promise.all(own.map(function deleteKey(key) { return gmDelete(key); }));
    return own.length;
  }

  async function gmGet(key, fallback) {
    const value = GM_getValue(key, fallback);
    return value && typeof value.then === 'function' ? value : Promise.resolve(value);
  }

  async function gmSet(key, value) {
    const result = GM_setValue(key, value);
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  async function gmDelete(key) {
    const result = GM_deleteValue(key);
    return result && typeof result.then === 'function' ? result : Promise.resolve(result);
  }

  async function gmList() {
    const result = GM_listValues();
    return result && typeof result.then === 'function' ? result : Promise.resolve(result || []);
  }

  async function mapLimit(items, limit, iterator) {
    const output = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(limit, items.length || 1));

    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await iterator(items[index], index);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, worker));
    return output;
  }

  function ensureStyles() {
    if (document.getElementById(APP.styleId)) return;
    const style = document.createElement('style');
    style.id = APP.styleId;
    style.textContent = `
      .tm-scout-v2-launcher,#tm-scout-v2rescue-launcher{display:none!important}
      .tm-scout-v2-panel{position:fixed!important;inset:18px;z-index:2147483646;color:#e8f2fb;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;}
      #tmScoutMount .tm-scout-v2-panel{position:relative!important;inset:auto!important;z-index:1!important;width:100%!important;height:calc(100vh - 150px)!important;min-height:680px!important}
      .tm-scout-v2-panel[hidden]{display:none!important}
      .tm-scout-v2-shell{height:100%;display:flex;flex-direction:column;background:#071018;border:1px solid rgba(125,166,200,.30);border-radius:20px;overflow:hidden;box-shadow:0 24px 86px rgba(0,0,0,.56)}
      .tm-scout-v2-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:16px 18px;border-bottom:1px solid rgba(125,166,200,.18);background:#09131d;backdrop-filter:blur(10px)}
      .tm-scout-v2-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.16em;color:#7edfa0;font-weight:800}.tm-scout-v2-head h2{margin:4px 0 3px;font-size:25px;line-height:1.05;color:#f5f9fd}.tm-scout-v2-head p{margin:0;color:#9fb3c7;font-size:12px}.tm-scout-v2-head-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;justify-content:flex-end}.tm-scout-v2-head-lang{display:flex;flex-direction:column;gap:5px;color:#c8d8e7;font:800 11px/1.1 Inter,system-ui,-apple-system,Segoe UI,sans-serif}.tm-scout-v2-head-lang select{min-width:132px;border:1px solid rgba(125,166,200,.32);border-radius:10px;background:#07111a;color:#eef6ff;padding:8px 10px;font:800 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif;outline:none}.tm-scout-v2-head-lang select:focus{border-color:#73add7;background:#091722}
      .tm-scout-v2-panel button{border:1px solid rgba(125,166,200,.28);border-radius:10px;background:#102235;color:#eaf4ff;padding:8px 10px;font:700 12px/1 Inter,system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}.tm-scout-v2-panel button:hover{background:#152d42}.tm-scout-v2-panel button:disabled{opacity:.55;cursor:wait}.tm-scout-v2-primary{background:#1f8f64!important;border-color:#2ab07b!important;color:#fff!important}
      .tm-scout-v2-body{min-height:0;flex:1;display:grid;grid-template-columns:440px minmax(0,1fr);gap:0}.tm-scout-v2-controls{overflow:auto;padding:15px 15px 140px!important;border-right:1px solid rgba(125,166,200,.18);background:#08121b;scrollbar-color:#31516b #08121b;scroll-padding-bottom:150px}
      .tm-scout-v2-controls fieldset{border:1px solid rgba(125,166,200,.24)!important;border-radius:15px!important;margin:0 0 13px!important;padding:15px 15px 14px!important;background:#0a1621!important;box-shadow:none!important;min-width:0!important}.tm-scout-v2-controls legend{display:inline-block!important;background:#0a1621!important;color:#9bd8ab!important;border:0!important;border-radius:0!important;font:800 11px/1.1 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;letter-spacing:.02em!important;margin:0!important;padding:0 7px!important;white-space:normal!important;width:auto!important;max-width:100%!important}
      .tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px 12px!important}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks)>legend{grid-column:1/-1!important}.tm-scout-v2-controls [hidden],.tm-scout-v2-controls .tm-scout-v2-mode-hidden{display:none!important}.tm-scout-v2-controls label{display:block!important;color:#c8d8e7!important;font:700 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;margin:0!important;min-width:0!important}.tm-scout-v2-controls input,.tm-scout-v2-controls select,.tm-scout-v2-controls textarea{width:100%!important;max-width:100%!important;min-width:0!important;border:1px solid rgba(125,166,200,.32)!important;border-radius:9px!important;background:#07111a!important;color:#eef6ff!important;padding:7px 8px!important;font:650 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;box-shadow:none!important;outline:none!important}.tm-scout-v2-controls label>input:not([type="checkbox"]),.tm-scout-v2-controls label>select,.tm-scout-v2-controls label>textarea{display:block!important;margin-top:6px!important}.tm-scout-v2-controls input:focus,.tm-scout-v2-controls select:focus,.tm-scout-v2-controls textarea:focus{border-color:#73add7!important;background:#091722!important}.tm-scout-v2-controls select{display:block!important;height:36px!important;min-height:36px!important;line-height:1.2!important;padding:8px 34px 8px 10px!important;font-size:12px!important;font-weight:750!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;-webkit-appearance:menulist!important;appearance:auto!important;background-color:#07111a!important;color:#eef6ff!important}.tm-scout-v2-controls select option{background:#07111a!important;color:#eef6ff!important;font:700 13px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}.tm-scout-v2-controls select[multiple],.tm-scout-v2-controls .tm-scout-v2-multi-select{height:auto!important;min-height:220px!important;max-height:320px!important;overflow-y:auto!important;overflow-x:hidden!important;padding:8px 10px!important;white-space:normal!important;text-overflow:clip!important;-webkit-appearance:listbox!important;appearance:auto!important;background-image:none!important}.tm-scout-v2-controls select[multiple] option,.tm-scout-v2-controls .tm-scout-v2-multi-select option{padding:5px 8px!important;min-height:24px!important;line-height:1.25!important;white-space:normal!important}.tm-scout-v2-native-multi-hidden{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;min-height:1px!important;max-height:1px!important;opacity:0!important;pointer-events:none!important}.tm-scout-v2-nationality-wrapper{grid-column:1/-1!important;display:grid!important;gap:7px!important}.tm-scout-v2-nationality-search{width:100%!important;margin:0!important;border:1px solid rgba(125,166,200,.36)!important;border-radius:10px!important;background:#07111a!important;color:#eef6ff!important;padding:9px 10px!important;font:800 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}.tm-scout-v2-nationality-empty{padding:8px 10px!important;border:1px dashed rgba(125,166,200,.34)!important;border-radius:10px!important;color:#9fb3c7!important;font:800 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}.tm-scout-v2-field-note{grid-column:1/-1!important;margin:-4px 0 2px!important;color:#9fb3c7!important;font:700 11px/1.35 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}.club-cell{display:grid!important;gap:3px!important}.tm-scout-v2-nationality-picker{grid-column:1/-1!important;display:grid!important;grid-template-columns:1fr!important;gap:4px!important;max-height:260px!important;overflow:auto!important;padding:7px!important;border:1px solid rgba(125,166,200,.32)!important;border-radius:10px!important;background:#07111a!important;scrollbar-color:#31516b #07111a!important}.tm-scout-v2-nationality-option{display:flex!important;align-items:center!important;gap:8px!important;width:100%!important;min-height:28px!important;padding:6px 8px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#eef6ff!important;text-align:left!important;font:800 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;cursor:pointer!important}.tm-scout-v2-nationality-option:hover{background:#0e2233!important}.tm-scout-v2-nationality-option.is-selected{background:#235f8d!important;color:#fff!important}.tm-scout-v2-nationality-check{width:14px!important;height:14px!important;border:1px solid rgba(125,166,200,.55)!important;border-radius:4px!important;background:#101f2d!important;flex:0 0 14px!important}.tm-scout-v2-nationality-option.is-selected .tm-scout-v2-nationality-check{background:#56f097!important;border-color:#56f097!important;box-shadow:inset 0 0 0 3px #235f8d!important}.tm-scout-v2-nationality-name{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.tm-scout-v2-controls input[type="checkbox"]{width:15px!important;height:15px!important;flex:0 0 15px!important;padding:0!important;margin:0!important;accent-color:#3cae78!important}.tm-scout-v2-controls textarea{resize:vertical;min-height:92px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important}.tm-scout-v2-controls label.tm-scout-v2-wide{grid-column:1/-1!important;display:block!important}.tm-scout-v2-controls label.tm-scout-v2-checkline{grid-column:1/-1!important;display:flex!important;align-items:center!important;gap:9px!important;margin:2px 0!important;color:#d1e1ee!important}
      .tm-scout-v2-checks{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px 14px!important}.tm-scout-v2-checks legend{grid-column:1/-1!important}.tm-scout-v2-checks label{display:flex!important;align-items:center!important;gap:8px!important;margin:0!important;color:#c9d8e5!important;font-weight:700!important;line-height:1.2!important}.tm-scout-v2-source-options{display:block!important}.tm-scout-v2-source-options label{display:flex!important;align-items:center!important;gap:8px!important;margin:9px 0!important}.tm-scout-v2-source-options label.tm-scout-v2-wide{display:block!important;margin:10px 0!important}.tm-scout-v2-source-options label.tm-scout-v2-wide select,.tm-scout-v2-source-options label.tm-scout-v2-wide input{margin-top:6px!important}.tm-scout-v2-detail-options{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tm-scout-v2-actions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;position:static!important;bottom:auto!important;z-index:1!important;margin:14px 0 0!important;padding:9px!important;background:#091722!important;border:1px solid rgba(125,166,200,.24)!important;border-radius:14px!important;box-shadow:none!important}.tm-scout-v2-actions button{width:100%!important;min-height:32px!important;padding:7px 6px!important;border-radius:9px!important;font-size:11px!important;line-height:1.05!important;white-space:nowrap!important}.tm-scout-v2-actions .tm-scout-v2-primary{grid-column:auto!important}
      .tm-scout-v2-output{min-width:0;display:flex;flex-direction:column;overflow:hidden}.tm-scout-v2-statusbar{padding:13px 16px;border-bottom:1px solid rgba(125,166,200,.18);background:#0b1722}.tm-scout-v2-status{color:#d7e8f8;font-size:13px;font-weight:750;margin-bottom:9px}.tm-scout-v2-progress{height:8px;background:#071018;border-radius:999px;overflow:hidden;border:1px solid rgba(125,166,200,.18)}.tm-scout-v2-progress span{display:block;height:100%;width:0;background:#3a97d4;transition:width .2s ease}
      .tm-scout-v2-note-mini{font-size:11px;line-height:1.35;color:#95aabd;grid-column:1/-1;margin:2px 0 0}.tm-scout-v2-muted-block{opacity:.45}.tm-scout-v2-muted-block legend::after{content:' (inaktív)';font-weight:700;color:#c49d51}.tm-scout-v2-note{border:1px solid rgba(125,166,200,.22);background:#0a1621;border-radius:11px;padding:9px 11px;margin-bottom:12px;color:#bdd4e7;font-size:12px;line-height:1.35}.tm-scout-v2-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:12px 16px;border-bottom:1px solid rgba(125,166,200,.18)}.tm-scout-v2-stat{background:#0a1621;border:1px solid rgba(125,166,200,.18);border-radius:11px;padding:9px 10px}.tm-scout-v2-stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#95aabd;font-weight:800}.tm-scout-v2-stat strong{display:block;margin-top:3px;color:#fff;font-size:18px}
      .tm-scout-v2-table-wrap{overflow:auto;min-height:0;flex:1;padding:0 0 14px;background:#071018!important}.tm-scout-v2-table{width:100%;border-collapse:separate!important;border-spacing:0!important;min-width:1480px;background:#071018!important;table-layout:auto!important}.tm-scout-v2-table th,.tm-scout-v2-table td{padding:9px 10px!important;border-bottom:1px solid rgba(126,163,196,.18)!important;text-align:left!important;vertical-align:top!important;font-size:12px!important;line-height:1.34!important}.tm-scout-v2-table th{position:sticky!important;top:0!important;z-index:2!important;background:#102235!important;color:#d7e7f5!important;font-size:10px!important;text-transform:uppercase!important;letter-spacing:.035em!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;word-break:normal!important;overflow-wrap:normal!important;hyphens:auto!important}.tm-scout-v2-table th:nth-child(1),.tm-scout-v2-table td:nth-child(1){min-width:160px!important}.tm-scout-v2-table th:nth-child(2),.tm-scout-v2-table td:nth-child(2){min-width:145px!important}.tm-scout-v2-table th:nth-child(3),.tm-scout-v2-table td:nth-child(3){min-width:72px!important}.tm-scout-v2-table th:nth-child(4),.tm-scout-v2-table td:nth-child(4){min-width:145px!important}.tm-scout-v2-table th:nth-child(5),.tm-scout-v2-table td:nth-child(5){min-width:270px!important}.tm-scout-v2-table th:nth-child(6),.tm-scout-v2-table td:nth-child(6){min-width:175px!important}.tm-scout-v2-table th:nth-child(7),.tm-scout-v2-table td:nth-child(7){min-width:92px!important}.tm-scout-v2-table th:nth-child(8),.tm-scout-v2-table td:nth-child(8){min-width:145px!important}.tm-scout-v2-table th:nth-child(9),.tm-scout-v2-table td:nth-child(9){min-width:130px!important}.tm-scout-v2-table th:nth-child(10),.tm-scout-v2-table td:nth-child(10){min-width:220px!important}.tm-scout-v2-table th:nth-child(11),.tm-scout-v2-table td:nth-child(11){min-width:96px!important}.tm-scout-v2-table tbody tr:nth-child(odd) td{background:#0a1722!important}.tm-scout-v2-table tbody tr:nth-child(even) td{background:#0c1b27!important}.tm-scout-v2-table tbody tr:hover td{background:#10263a!important;color:#ffffff!important}.tm-scout-v2-table td{color:#dcecff!important}.tm-scout-v2-table a{color:#9bd2ff!important;font-weight:800!important}.tm-scout-v2-cell-player{font-weight:800!important;color:#ffffff!important;min-width:150px}.tm-scout-v2-cell-position{color:#a7f0bf!important;font-weight:800!important;min-width:150px}.tm-scout-v2-cell-growth{color:#dbeff0!important;font-weight:800!important;white-space:nowrap}.tm-scout-v2-cell-playing{color:#ecd996!important;font-weight:800!important;white-space:nowrap}.tm-scout-v2-cell-seasons{color:#c2d7eb!important;min-width:180px}.tm-scout-v2-cell-availability{color:#cfe2f6!important;min-width:310px}.tm-scout-v2-empty{text-align:center!important;color:#9fb4c6!important;padding:30px!important;background:#0a1724!important}
      .tm-scout-v2-collapsed{inset:auto 16px 16px auto;width:min(520px,calc(100vw - 32px));height:auto}.tm-scout-v2-collapsed .tm-scout-v2-body{display:none}.tm-scout-v2-collapsed .tm-scout-v2-shell{height:auto}.tm-scout-v2-collapsed .tm-scout-v2-head{border-bottom:0}

      .tm-scout-v2-ui-modal{position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:center!important;padding:18px!important;background:rgba(2,8,13,.72)!important;backdrop-filter:blur(8px)!important}.tm-scout-v2-ui-modal-card{width:min(420px,calc(100vw - 28px))!important;border:1px solid rgba(86,240,151,.38)!important;border-radius:22px!important;background:linear-gradient(180deg,#102235,#08131d)!important;box-shadow:0 28px 90px rgba(0,0,0,.55)!important;color:#eef7ff!important;padding:18px!important;text-align:left!important}.tm-scout-v2-ui-modal-icon{width:42px!important;height:42px!important;border-radius:16px!important;display:grid!important;place-items:center!important;background:rgba(86,240,151,.16)!important;border:1px solid rgba(86,240,151,.35)!important;margin-bottom:10px!important}.tm-scout-v2-ui-modal-card h3{margin:0 0 8px!important;font-size:18px!important;line-height:1.1!important;color:#fff!important}.tm-scout-v2-ui-modal-card p{margin:0 0 14px!important;color:#cfe0ef!important;font-size:13px!important;line-height:1.45!important}.tm-scout-v2-ui-modal-card button{width:100%!important;border:0!important;border-radius:13px!important;background:#56f097!important;color:#06120d!important;font-weight:950!important;padding:10px 14px!important;cursor:pointer!important}.tm-scout-v2-ui-modal.is-error .tm-scout-v2-ui-modal-card{border-color:rgba(255,184,77,.45)!important}.tm-scout-v2-ui-modal.is-error .tm-scout-v2-ui-modal-icon{background:rgba(255,184,77,.16)!important;border-color:rgba(255,184,77,.38)!important}.tm-scout-v2-actions button{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      @media(max-width:520px){.tm-scout-v2-actions{grid-template-columns:1fr 1fr!important}.tm-scout-v2-actions button{white-space:normal!important}}
      @media(max-width:1100px){.tm-scout-v2-body{grid-template-columns:420px minmax(0,1fr)}}
      .tm-scout-v2-html-modal{position:fixed!important;inset:18px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;background:#071018!important;border:1px solid rgba(125,166,200,.35)!important;border-radius:18px!important;box-shadow:0 30px 90px rgba(0,0,0,.55)!important;overflow:hidden!important}.tm-scout-v2-html-modal-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:10px 12px!important;background:#102235!important;color:#eef7ff!important}.tm-scout-v2-html-modal-head button{border:1px solid rgba(125,166,200,.35)!important;border-radius:9px!important;background:#0a1722!important;color:#eef7ff!important;font-weight:800!important;padding:7px 10px!important;cursor:pointer!important}.tm-scout-v2-html-modal iframe{width:100%!important;height:100%!important;border:0!important;background:#071018!important}
      @media(max-width:900px){#tmScoutMount .tm-scout-v2-panel,.tm-scout-v2-panel{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;min-height:0!important}.tm-scout-v2-shell{height:auto!important;min-height:0!important;overflow:visible!important;border-radius:18px!important}.tm-scout-v2-body{display:block!important}.tm-scout-v2-controls{max-height:none!important;overflow:visible!important;border-right:0!important;border-bottom:1px solid rgba(125,166,200,.18)!important;padding:12px!important;scroll-padding-bottom:0!important}.tm-scout-v2-output{overflow:visible!important}.tm-scout-v2-table-wrap{max-height:68vh!important;overflow:auto!important}.tm-scout-v2-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.tm-scout-v2-head{display:block;padding:15px!important}.tm-scout-v2-head-actions{margin-top:12px;justify-content:flex-start!important}.tm-scout-v2-head-lang select{min-width:0;width:100%}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){grid-template-columns:repeat(2,minmax(0,1fr))!important}.tm-scout-v2-broad-options,.tm-scout-v2-detail-options{grid-template-columns:1fr 1fr}.tm-scout-v2-actions{grid-template-columns:repeat(3,minmax(0,1fr))!important}.tm-scout-v2-panel.tm-scout-v2-running .tm-scout-v2-table-wrap{display:none!important}}
      @media(max-width:560px){.tm-scout-v2-head h2{font-size:24px!important}.tm-scout-v2-head p{font-size:12px!important;line-height:1.4!important}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){grid-template-columns:1fr!important}.tm-scout-v2-checks,.tm-scout-v2-broad-options,.tm-scout-v2-detail-options{grid-template-columns:1fr!important}.tm-scout-v2-stats{grid-template-columns:1fr 1fr!important;padding:10px!important}.tm-scout-v2-statusbar{padding:12px!important}.tm-scout-v2-actions{grid-template-columns:1fr 1fr!important}.tm-scout-v2-table{min-width:980px!important}.tm-scout-v2-table th,.tm-scout-v2-table td{font-size:11px!important;padding:8px!important}.tm-scout-v2-controls select[multiple],.tm-scout-v2-controls .tm-scout-v2-multi-select{min-height:180px!important;max-height:260px!important}}
      @media(max-width:900px),(pointer:coarse){.tm-scout-v2-html-modal{inset:4px!important;border-radius:12px!important}.tm-scout-v2-html-modal-head{padding:6px 8px!important;gap:8px!important}.tm-scout-v2-html-modal-head strong{font-size:13px!important;line-height:1.1!important}.tm-scout-v2-html-modal-head button{border-radius:8px!important;font-size:11px!important;line-height:1!important;padding:6px 8px!important}.tm-scout-v2-html-modal iframe{min-height:0!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(String(html || ''), 'text/html');
  }

  function parseMarketValue(value) {
    const text = cleanText(value).replace(/\u00a0/g, ' ');
    const regexes = [
      /€\s*([0-9]+(?:[.,][0-9]+)?)\s*(bn|b|m|mil\.?|k|th\.?|thousand)?/i,
      /([0-9]+(?:[.,][0-9]+)?)\s*(bn|b|m|mil\.?|k|th\.?|thousand)\s*€/i
    ];
    for (const regex of regexes) {
      const match = text.match(regex);
      if (!match) continue;
      const number = parseFloat(match[1].replace(',', '.'));
      if (!Number.isFinite(number)) continue;
      const unit = String(match[2] || '').toLowerCase();
      if (/^(bn|b)$/.test(unit)) return Math.round(number * 1000000000);
      if (/^(m|mil\.)$/.test(unit)) return Math.round(number * 1000000);
      if (/^(k|th\.?|thousand)$/.test(unit)) return Math.round(number * 1000);
      return Math.round(number);
    }
    return null;
  }

  function looksLikeMarketValue(text) {
    return /€\s*[0-9]/i.test(String(text || '')) || /[0-9]\s*(m|k|bn|mil\.|th\.)\s*€/i.test(String(text || ''));
  }

  function looksLikeAge(text) {
    return /^(1[5-9]|[2-3]\d|4[0-9])$/.test(cleanText(text));
  }

  function formatEuro(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
    const n = Number(value);
    if (Math.abs(n) >= 1000000) return `€${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 2)}m`;
    if (Math.abs(n) >= 1000) return `€${Math.round(n / 1000)}k`;
    return `€${n}`;
  }

  function formatGrowth(mv) {
    if (!mv || mv.absGrowth === null || mv.absGrowth === undefined || !Number.isFinite(Number(mv.absGrowth))) {
      if (mv && (mv.fallbackNoHistory || mv.unknown)) {
        const current = Number(mv.latestValue);
        return Number.isFinite(current) && current > 0
          ? `${ex('noMvHistory')} · ${ex('currentMv')}: ${formatEuro(current)}`
          : ex('noMvHistory');
      }
      return '—';
    }
    const pct = mv.pctGrowth === null || mv.pctGrowth === undefined ? '' : ` (${mv.pctGrowth >= 0 ? '+' : ''}${mv.pctGrowth.toFixed(1)}%)`;
    return `${formatEuro(mv.baselineValue)} → ${formatEuro(mv.latestValue)} · ${mv.absGrowth >= 0 ? '+' : ''}${formatEuro(mv.absGrowth)}${pct}`;
  }

  function formatPlayingTime(playingTime) {
    const pt = playingTime || emptyPlayingTime();
    return `${pt.apps || 0} apps · ${pt.minutes || 0} min`;
  }

  function formatRecentSeasons(playingTime) {
    const pt = playingTime || emptyPlayingTime();
    if (!pt.recentSeasons || !pt.recentSeasons.length) return '—';
    return pt.recentSeasons.map(function seasonText(season) {
      return `${season.season}: ${season.apps} apps/${season.minutes} min`;
    }).join(' | ');
  }

  function csvEscape(value) {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  function cleanText(value) {
    return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function normalizeText(value) {
    return cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function unique(list) {
    return Array.from(new Set((list || []).map(cleanText).filter(Boolean)));
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(',', '.');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseIntegerLike(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    let text = String(value).trim();
    if (!text || text === '-' || text === '—') return null;
    text = text.replace(/[^\d.,-]/g, '');
    if (!text) return null;

    if (/^\d{1,3}([.,]\d{3})+$/.test(text)) {
      const parsedThousands = parseInt(text.replace(/[.,]/g, ''), 10);
      return Number.isFinite(parsedThousands) ? parsedThousands : null;
    }

    if (/^\d+([.,]\d+)?$/.test(text)) {
      const parsed = Number(text.replace(',', '.'));
      return Number.isFinite(parsed) ? Math.round(parsed) : null;
    }

    const parsed = parseInt(text.replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseMinutesLike(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;
    const text = String(value).trim();
    if (!text || text === '-' || text === '—') return null;
    const minuteMatch = text.match(/(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:'|min\b|minutes\b)?/i);
    if (!minuteMatch) return null;
    return parseIntegerLike(minuteMatch[1]);
  }

  function firstDefinedNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (value !== null && value !== undefined && Number.isFinite(Number(value))) return Number(value);
    }
    return null;
  }

  function clampNumber(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  function readNumber(input, fallback) {
    const parsed = Number(input && input.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function safeJsonParse(text, fallback) {
    try {
      return JSON.parse(text);
    } catch (_error) {
      return fallback;
    }
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function hashString(text) {
    let hash = 2166136261;
    const input = String(text);
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function trimUrl(url) {
    return String(url || '').replace(/^https?:\/\//, '').slice(0, 96);
  }

  function progressRatio(start, end, index, total) {
    if (!total) return start;
    return start + ((end - start) * (index + 1)) / total;
  }

  function dateStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  function stringifyError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error.message) return error.message;
    try { return JSON.stringify(error); } catch (_jsonError) { return String(error); }
  }

  function pushError(type, detail) {
    state.debug.errors.push({
      at: new Date().toISOString(),
      type: type,
      detail: detail
    });
  }

  function logError(message, error) {
    console.error(`${APP.logPrefix} error: ${message}`, error);
    pushError(message, stringifyError(error));
  }

  function queueMicrotaskSafe(fn) {
    if (typeof queueMicrotask === 'function') queueMicrotask(fn);
    else window.setTimeout(fn, 0);
  }
})();


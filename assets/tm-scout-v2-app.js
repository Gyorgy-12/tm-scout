/*
 * efficient-batch-proxy-plus-20260706
 * export-table-typography-polish-20260706
 * Based on full-i18n-export-popup; keeps old export design, removes List column, improves table typography and export line breaks.
 * TM Scout V2 GitHub Pages build
 * Source: Tampermonkey userscript converted to static frontend.
 * Network: GM_xmlhttpRequest shim -> hardcoded Cloudflare Worker proxy endpoint.
 */
(function installGithubPageShims(){
  'use strict';
  // efficient-batch-proxy-plus-20260706

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
  // u21-nationality-mv-source-prune-20260706: U21 source discovery is pruned by selected nationality + MV window, not just capped after generation.

  const APP = Object.freeze({
    name: 'TM Scout V2',
    logPrefix: '[TM Scout V2]',
    cachePrefix: 'tmScoutV2InteractiveHtmlExport:',
    ttlMs: 14 * 24 * 60 * 60 * 1000,
    launcherId: 'tm-scout-v2ihe-launcher',
    panelId: 'tm-scout-v2ihe-panel',
    styleId: 'tm-scout-v2ihe-style',
    menuOpen: 'Open TM Scout V2',
    menuClear: 'Clear TM Scout V2 cache'
  });


  // efficient-batch-proxy-plus-20260706:
  // A GitHub Pages frontend eddig minden TM oldalt külön Worker requestként vitt át.
  // A batch proxy most 24 URL-t fog össze egy POST-ba, plusz kliensoldali URL dedupe/pending cache
  // is van. Ez a Cloudflare Worker request countot tipikusan még kb. felezi a 12-es batchhez képest,
  // és a duplikált/egyszerre újrakért TM oldalakat ugyanazon böngészőfülben nem küldi ki újra.
  const TM_SCOUT_BATCH_PROXY_ENDPOINT = 'https://tm-scout-v2-proxy.wc26-guesses.workers.dev';
  const TM_SCOUT_BATCH_SIZE = 24;
  const TM_SCOUT_BATCH_DELAY_MS = 35;
  const TM_SCOUT_BATCH_MEMORY_CACHE_TTL_MS = 30 * 60 * 1000;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEMS = 900;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_CHARS = 32 * 1024 * 1024;
  const TM_SCOUT_BATCH_MEMORY_CACHE_MAX_ITEM_CHARS = 750000;
  let tmScoutBatchQueue = [];
  let tmScoutBatchTimer = null;
  let tmScoutBatchMemoryCacheChars = 0;
  const tmScoutBatchMemoryCache = new Map();
  const tmScoutBatchPendingByKey = new Map();

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

  function tmScoutBatchCacheKey(url, responseKind) {
    let normalized = String(url || '');
    try {
      const parsed = new URL(normalized, window.location.href);
      parsed.hash = '';
      normalized = parsed.toString();
    } catch (_error) {}
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
    "United States": "United States"
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
    "United States": "Statele Unite"
  }
});

  function normalizeUiLanguage(value) {
    const lang = String(value || '').toLowerCase();
    return lang === 'en' || lang === 'ro' ? lang : 'hu';
  }

  function currentUiLanguage() {
    return normalizeUiLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'hu');
  }

  function canonicalI18nKey(text) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (Object.prototype.hasOwnProperty.call(I18N.en, raw) || Object.prototype.hasOwnProperty.call(I18N.ro, raw)) return raw;
    for (const dict of Object.values(I18N)) {
      for (const [hu, translated] of Object.entries(dict)) {
        if (String(translated) === raw) return hu;
      }
    }
    return raw;
  }

  function tx(text) {
    const key = canonicalI18nKey(text);
    const lang = currentUiLanguage();
    if (lang === 'hu') return key;
    return (I18N[lang] && I18N[lang][key]) || key;
  }

  function translateRuntimeText(text) {
    const lang = currentUiLanguage();
    if (lang === 'hu') return String(text || '');
    let out = String(text || '');
    const entries = Object.entries(I18N[lang] || {}).sort(function byLength(a, b) { return b[0].length - a[0].length; });
    for (const [hu, translated] of entries) {
      if (!hu || !translated || hu.length < 4) continue;
      out = out.split(hu).join(translated);
    }
    return out;
  }

  function translateTextNodeValue(value) {
    const raw = String(value || '');
    const match = raw.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2]) return raw;
    const translated = tx(match[2]);
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
        if (parent.closest && parent.closest('[data-role="results"]')) return NodeFilter.FILTER_REJECT;
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
    Array.from(scope.querySelectorAll ? scope.querySelectorAll('[placeholder]') : []).forEach(function translatePlaceholder(el) {
      const next = tx(el.getAttribute('placeholder'));
      if (next) el.setAttribute('placeholder', next);
    });
    Array.from(scope.querySelectorAll ? scope.querySelectorAll('select[name="uiLanguage"], #tmLangSelect') : []).forEach(function syncSelect(sel) {
      sel.value = lang;
    });
  }

  function setUiLanguage(lang) {
    const normalized = normalizeUiLanguage(lang);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
    localizeRoot(document);
    const panel = document.getElementById(APP.panelId);
    if (panel) {
      renderStats(panel);
      renderResults(panel, state.results || []);
    }
    try { window.dispatchEvent(new CustomEvent('tmScoutV2LanguageApplied', { detail: { language: normalized } })); } catch (_error) {}
  }

  window.tmScoutSetLanguage = setUiLanguage;
  window.addEventListener('tmScoutV2LanguageChange', function onExternalLanguageChange(event) {
    setUiLanguage(event && event.detail ? event.detail.language : currentUiLanguage());
  });


  const DEFAULTS = Object.freeze({
    minMv: 200000,
    maxMv: 800000,
    minAge: 22,
    maxAge: 30,
    growthSince: defaultSeasonStart(),
    maxMvDropPct: 15,
    contractYear: String(new Date().getFullYear()),
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
    concurrency: 4,

    // U21 prospect mode: broad youth search. MV is useful, but missing MV is not an exclusion reason.
    scoutMode: 'contract',
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

  function buildPanel() {
    const panel = document.createElement('section');
    panel.id = APP.panelId;
    panel.className = 'tm-scout-v2-panel';
    panel.setAttribute('aria-label', 'TM Scout V2 panel');

    panel.innerHTML = [
      '<div class="tm-scout-v2-shell">',
      '  <header class="tm-scout-v2-head">',
      '    <div>',
      '      <div class="tm-scout-v2-kicker">Transfermarkt Scout</div>',
      '      <h2>TM Scout V2</h2>',
      '      <p>Lejáró szerződéses játékosok és U21 prospectek keresése egy helyen.</p>',
      '    </div>',
      '    <div class="tm-scout-v2-head-actions">',
      '      <label class="tm-scout-v2-head-lang">Felület nyelve <select name="uiLanguage" aria-label="Felület nyelve"><option value="hu">Magyar</option><option value="en">English</option><option value="ro">Română</option></select></label>',
      '      <button type="button" data-action="collapse">Összecsukás</button>',
      '      <button type="button" data-action="close">Bezárás</button>',
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
      '            <option value="Argentina">Argentina</option><option value="Austria">Austria</option><option value="Belgium">Belgium</option><option value="Brazil">Brazil</option><option value="Croatia">Croatia</option><option value="Czech Republic">Czech Republic</option>',
      '            <option value="Denmark">Denmark</option><option value="England">England</option><option value="France">France</option><option value="Germany">Germany</option><option value="Ghana">Ghana</option><option value="Hungary">Hungary</option>',
      '            <option value="Italy">Italy</option><option value="Netherlands">Netherlands</option><option value="Norway">Norway</option><option value="Poland">Poland</option><option value="Portugal">Portugal</option><option value="Romania">Romania</option>',
      '            <option value="Scotland">Scotland</option><option value="Serbia">Serbia</option><option value="Slovakia">Slovakia</option><option value="Slovenia">Slovenia</option><option value="Spain">Spain</option><option value="Sweden">Sweden</option>',
      '            <option value="Switzerland">Switzerland</option><option value="Turkey">Turkey</option><option value="Ukraine">Ukraine</option><option value="Uruguay">Uruguay</option><option value="USA">United States</option>',
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
      '              <th>Lista</th>',
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

    Object.keys(DEFAULTS).forEach(function setInput(name) {
      const input = form.elements[name];
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(state.settings[name]);
      else if (input.tagName !== 'SELECT' || !input.multiple) input.value = state.settings[name];
    });
    setMultiSelectValue(form.elements.u21Nationalities, state.settings.u21Nationalities);
    if (form.elements.uiLanguage) form.elements.uiLanguage.value = currentUiLanguage();
    state.settings.scoutMode = normalizeScoutMode(state.settings.scoutMode);
    setScoutModeUi(panel, state.settings.scoutMode);
    setPositionModeUi(panel, state.settings.positionFilterMode);
    localizeRoot(panel);
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
      }
      if (target && target.name === 'scoutMode') {
        setScoutModeUi(panel, normalizeScoutMode(target.value));
        renderResults(panel, state.results || []);
        renderStats(panel);
        localizeRoot(panel);
      }
    });

    panel.addEventListener('click', async function handlePanelClick(event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.getAttribute('data-action');

      try {
        if (action === 'close') {
          panel.hidden = true;
          return;
        }
        if (action === 'collapse') {
          state.panelCollapsed = !state.panelCollapsed;
          panel.classList.toggle('tm-scout-v2-collapsed', state.panelCollapsed);
          button.textContent = state.panelCollapsed ? 'Kinyitás' : 'Összecsukás';
          return;
        }
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
      const sourceDocs = await mapLimit(sources, Math.min(6, settings.concurrency + 2), async function loadSource(source, index) {
        setStatus(panel, `Forrásoldal ${index + 1}/${sources.length}`, progressRatio(5, 25, index, sources.length));
        try {
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
        const parsed = parseSourcePage(item.html, item.source);
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
      rawCandidates = rawCandidates.slice(0, isU21Mode(settings) ? settings.u21MaxCandidates : settings.maxCandidates);

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

      await mapLimit(rawCandidates, settings.concurrency, async function enrichOne(candidate, index) {
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
      scoutMode: normalizeScoutMode(form.elements.scoutMode ? form.elements.scoutMode.value : DEFAULTS.scoutMode),
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
      window.localStorage.setItem('tmScoutV2SelectReadableFixUiSettings', JSON.stringify(stored));
    } catch (error) {
      pushError('ui settings save failed', stringifyError(error));
    }
  }

  function buildContractEndingQueryUrl(year, filter) {
    const f = normalizeSourceFilter(filter);
    // Path-style filters are used here because TM exposes the contract table filters
    // as jahr/ausrichtung/spielerposition_id/altersklasse/plus/1 routes on league pages.
    return `https://www.transfermarkt.com/transfers/endendevertraege/statistik/jahr/${encodeURIComponent(normalizeYear(year))}/land_id/0/ausrichtung/${encodeURIComponent(f.alignment)}/spielerposition_id/${encodeURIComponent(f.detailId)}/altersklasse/${encodeURIComponent(f.ageClass)}/plus/1`;
  }

  function buildCompetitionContractEndingQueryUrl(code, year, filter) {
    const cleanCode = String(code || '').trim().toUpperCase();
    const f = normalizeSourceFilter(filter);
    return `https://www.transfermarkt.com/-/endendevertraege/wettbewerb/${encodeURIComponent(cleanCode)}/jahr/${encodeURIComponent(normalizeYear(year))}/land_id/0/ausrichtung/${encodeURIComponent(f.alignment)}/spielerposition_id/${encodeURIComponent(f.detailId)}/altersklasse/${encodeURIComponent(f.ageClass)}/plus/1`;
  }

  function buildFreeAgentQueryUrl(filter) {
    const f = normalizeSourceFilter(filter);
    const url = new URL('https://www.transfermarkt.com/statistik/vertragslosespieler');
    url.searchParams.set('plus', '1');
    url.searchParams.set('ausrichtung', f.alignment);
    url.searchParams.set('spielerposition_id', f.detailId);
    url.searchParams.set('altersklasse', f.ageClass);
    url.searchParams.set('land_id', '0');
    url.searchParams.set('yt0', 'Show');
    return url.toString();
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
    const year = normalizeYear(settings.contractYear);
    const canonical = 'https://www.transfermarkt.com';
    const sourceFilters = buildSourceFilterCombos(settings);
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
    sourceFilters.forEach(function addCoreSource(filter) {
      coreSources.push({
        url: buildContractEndingQueryUrl(year, filter),
        type: 'contract-expiring',
        label: `Contracts ending ${year}${filter.label ? ` · ${filter.label}` : ''}`,
        sourceGroup: 'core-contracts-year',
        pageLimitMode: 'deep',
        sourceFilterWeight: filter.weight || 0
      });
    });

    // Do NOT use /statistik/endendevertraege as a generic fallback here.
    // Transfermarkt can default that page to a different year, so every contract
    // source must be built from the selected contract expiry year.

    if (settings.includeFreeAgents) {
      sourceFilters.forEach(function addFreeAgentSource(filter) {
        coreSources.push({
          url: buildFreeAgentQueryUrl(filter),
          type: 'free-agent',
          label: `Current free agents${filter.label ? ` · ${filter.label}` : ''}`,
          sourceGroup: 'current-free-agents',
          pageLimitMode: 'free-agent',
          sourceFilterWeight: filter.weight || 0
        });
      });
    }

    const leagueSources = [];
    if (settings.europeLeaguePages) {
      getEuropeCompetitionCodes().forEach(function addLeague(code) {
        sourceFilters.forEach(function addLeagueFilter(filter) {
          leagueSources.push({
            url: buildCompetitionContractEndingQueryUrl(code, year, filter),
            type: 'contract-expiring',
            label: `League ${code} contracts ending${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'europe-league-contracts',
            pageLimitMode: 'league',
            sourceFilterWeight: filter.weight || 0
          });
        });
      });
    }

    const lowerLeagueSources = [];
    if (settings.lowerLeaguePages) {
      getStrongLowerCompetitionCodes(settings.lowerLeagueDepth).forEach(function addLowerLeague(code) {
        sourceFilters.forEach(function addLowerFilter(filter) {
          lowerLeagueSources.push({
            url: buildCompetitionContractEndingQueryUrl(code, year, filter),
            type: 'contract-expiring',
            label: `Lower league ${code} contracts ending${filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'strong-lower-league-contracts',
            pageLimitMode: 'lower-league',
            sourceFilterWeight: filter.weight || 0
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
        sourceFilterWeight: 0
      };
    });

    const cleanCoreSources = coreSources
      .map(function cleanSource(source) { return Object.assign({}, source, { url: normalizeTransfermarktUrl(source.url) }); })
      .filter(function validSource(source) { return source.url && isAllowedTransfermarktSource(source.url); });

    const cleanLeagueSources = leagueSources
      .map(function cleanSource(source) { return Object.assign({}, source, { url: normalizeTransfermarktUrl(source.url) }); })
      .filter(function validSource(source) { return source.url && isAllowedTransfermarktSource(source.url); });

    const cleanLowerLeagueSources = lowerLeagueSources
      .map(function cleanSource(source) { return Object.assign({}, source, { url: normalizeTransfermarktUrl(source.url) }); })
      .filter(function validSource(source) { return source.url && isAllowedTransfermarktSource(source.url); });

    const cleanExtraSources = extraSources
      .filter(function validSource(source) { return source.url && isAllowedTransfermarktSource(source.url); });

    const maxCorePages = Math.max(1, settings.maxSourcePages);
    const maxShallowPages = Math.min(maxCorePages, 4);
    const seen = new Set();
    const plan = [];

    function adaptivePageLimit(source) {
      const weight = Number(source.sourceFilterWeight || 0);
      if (source.pageLimitMode === 'deep') return weight >= 2 ? Math.min(maxCorePages, 8) : weight === 1 ? Math.min(maxCorePages, 14) : maxCorePages;
      if (source.pageLimitMode === 'league') return weight >= 1 ? Math.min(maxCorePages, 1) : Math.min(maxCorePages, 2);
      if (source.pageLimitMode === 'lower-league') return weight >= 1 ? Math.min(maxCorePages, 1) : Math.min(maxCorePages, settings.lowerLeagueDepth === '2' ? 2 : 3);
      if (source.pageLimitMode === 'free-agent') return weight >= 1 ? Math.min(maxCorePages, 2) : Math.min(maxCorePages, 4);
      return maxShallowPages;
    }

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

    function addPagesForSource(source) {
      const pageLimit = adaptivePageLimit(source);
      state.debug.adaptivePageLimits.push({
        group: source.sourceGroup,
        label: source.label,
        filterWeight: source.sourceFilterWeight || 0,
        pageLimit: pageLimit
      });
      for (let page = 1; page <= pageLimit; page += 1) addPlannedSource(source, page, pageLimit);
    }

    cleanCoreSources.forEach(addPagesForSource);
    cleanLeagueSources.forEach(addPagesForSource);
    cleanLowerLeagueSources.forEach(addPagesForSource);

    cleanExtraSources.forEach(function addExtraSource(source) {
      for (let page = 1; page <= maxCorePages; page += 1) addPlannedSource(source, page, maxCorePages);
    });

    return plan;
  }



  function getU21SelectedCountryKeys(settings) {
    return (settings.u21Nationalities || []).map(function normalizeCountry(value) {
      const n = normalizeText(value);
      if (n === 'usa' || n === 'united states') return 'united states';
      return n;
    }).filter(Boolean);
  }

  function getTransfermarktNationalityLandId(countryKey) {
    const map = {
      // TM land_id values. Unknown countries intentionally fall back to 0 so the search still works.
      'romania': '140',
      'hungary': '178'
    };
    return map[normalizeText(countryKey)] || '';
  }

  function getSelectedU21NationalityLandIds(settings) {
    return unique(getU21SelectedCountryKeys(settings).map(getTransfermarktNationalityLandId).filter(Boolean));
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
      if ((domesticCodes[country] || []).includes(c)) return 18;
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
      (nationalSources[countryKey] || []).forEach(function addEntry(entry) {
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
    const seen = new Set();
    const plan = [];
    const nationalityLandIds = getSelectedU21NationalityLandIds(settings);
    const hasNationalitySourceFilter = nationalityLandIds.length > 0;
    const safetyMaxSources = Math.max(80, Math.min(900, requestedPages * 18));

    function pushSource(source) {
      if (!source || !source.url || plan.length >= safetyMaxSources) return false;
      const key = source.url.replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      plan.push(source);
      return true;
    }

    // U21/U19 national squad pages stay as seed sources. They catch no-MV / academy-like players
    // that a market-value list can miss.
    for (const seed of getU21NationalTeamSourceUrls(settings)) {
      pushSource(seed);
      state.debug.adaptivePageLimits.push({
        group: seed.sourceGroup,
        label: seed.label,
        filterWeight: 0,
        pageLimit: 1,
        note: 'selected-nationality youth squad seed'
      });
    }

    const targets = [];

    if (hasNationalitySourceFilter) {
      // Selected nationality is a player filter, not a domestic-league filter.
      // So the main discovery source is the worldwide TM market-value table filtered by:
      // nationality + U21 age class + selected position. This searches every club/league where that
      // nationality appears, without multiplying every competition by every position.
      sourceFilters.forEach(function addFilter(filter) {
        nationalityLandIds.forEach(function addLand(landId) {
          const mvWindow = getU21MvSourcePageWindow(settings, requestedPages, filter.weight || 0);
          targets.push({
            url: buildGlobalU21MarketValueQueryUrl(filter, landId),
            label: `U21 global nat ${landId}${filter && filter.label ? ` · ${filter.label}` : ''}`,
            sourceGroup: 'u21-global-nationality-mv-search',
            pageStart: mvWindow.start,
            pageEnd: mvWindow.end,
            filter: filter,
            priority: 100,
            landId: landId,
            note: mvWindow.note
          });
          state.debug.adaptivePageLimits.push({
            group: 'u21-global-nationality-mv-search',
            label: `U21 global nat ${landId}${filter && filter.label ? ` · ${filter.label}` : ''}`,
            filterWeight: filter.weight || 0,
            pageStart: mvWindow.start,
            pageLimit: mvWindow.end,
            note: mvWindow.note
          });
        });
      });

      // Tiny domestic probe only: it improves club/competition signal for RO/HU/etc., but it no longer
      // owns the whole source plan. This is intentionally small and still nationality-filtered.
      const domesticProbeCodes = unique(buildU21CompactCompetitionCodes(settings)
        .filter(function domesticOnly(code) { return getU21DomesticCompetitionBoost(code, settings) > 0; }))
        .slice(0, 6);
      domesticProbeCodes.forEach(function addDomesticProbe(code) {
        const basePriority = getU21CompetitionPriority(code, settings);
        sourceFilters.slice(0, 2).forEach(function addFilter(filter) {
          nationalityLandIds.forEach(function addLand(landId) {
            const url = buildCompetitionMarketValuesQueryUrl(code, filter, landId, settings);
            targets.push({
              url: url,
              label: `U21 ${code}${filter && filter.label ? ` · ${filter.label}` : ''} · nat ${landId}`,
              sourceGroup: 'u21-domestic-nationality-probe',
              pageStart: 1,
              pageEnd: Math.max(1, Math.min(2, requestedPages)),
              filter: filter,
              priority: basePriority + 18,
              landId: landId,
              code: code,
              note: 'small nationality-filtered domestic probe'
            });
          });
        });
      });
    } else {
      // No nationality filter selected: fall back to the competition-based broad scan.
      const codes = buildU21CompactCompetitionCodes(settings);
      unique(codes).forEach(function addCompetition(code) {
        const basePriority = getU21CompetitionPriority(code, settings);
        const codePriority = basePriority + getU21DomesticCompetitionBoost(code, settings);
        sourceFilters.forEach(function addFilter(filter) {
          const mvWindow = getU21MvSourcePageWindow(settings, requestedPages, filter.weight || 0);
          const url = buildCompetitionMarketValuesQueryUrl(code, filter, '0', settings);
          targets.push({
            code: code,
            filter: filter,
            url: url,
            pageStart: Math.max(1, mvWindow.start),
            pageEnd: Math.min(getU21SourcePageLimit(code, filter.weight || 0, requestedPages, settings, basePriority), mvWindow.end),
            priority: codePriority,
            landId: '0',
            sourceGroup: 'u21-broad-mv-window-search',
            label: `U21 ${code}${filter && filter.label ? ` · ${filter.label}` : ''}`,
            note: mvWindow.note
          });
          state.debug.adaptivePageLimits.push({
            group: 'u21-broad-mv-window-search',
            label: `U21 ${code}${filter && filter.label ? ` · ${filter.label}` : ''}`,
            filterWeight: filter.weight || 0,
            pageStart: Math.max(1, mvWindow.start),
            pageLimit: Math.min(getU21SourcePageLimit(code, filter.weight || 0, requestedPages, settings, basePriority), mvWindow.end),
            note: mvWindow.note
          });
        });
      });
    }

    targets.sort(function bySignal(a, b) {
      return (Number(b.priority || 0) - Number(a.priority || 0))
        || (Number(a.pageStart || 1) - Number(b.pageStart || 1))
        || (Number(a.filter && a.filter.weight || 0) - Number(b.filter && b.filter.weight || 0))
        || String(a.label || '').localeCompare(String(b.label || ''));
    });

    const minPage = targets.reduce(function min(acc, target) { return Math.min(acc, Number(target.pageStart || 1)); }, requestedPages);
    const maxPage = targets.reduce(function max(acc, target) { return Math.max(acc, Number(target.pageEnd || 1)); }, 1);

    // Round-robin by page so every selected nationality/position gets a chance before deepening.
    for (let page = minPage; page <= maxPage && plan.length < safetyMaxSources; page += 1) {
      for (const target of targets) {
        if (plan.length >= safetyMaxSources) break;
        if (page < Number(target.pageStart || 1) || page > Number(target.pageEnd || 1)) continue;
        const pagedUrl = addTransfermarktPage(target.url, page);
        pushSource({
          url: pagedUrl,
          type: 'u21-prospect',
          label: `${target.label}${page > 1 ? ` p.${page}` : ''}`,
          sourceGroup: target.sourceGroup,
          page: page,
          plannedPageLimit: target.pageEnd,
          sourceFilterWeight: target.filter ? target.filter.weight || 0 : 0,
          mvWindowNote: target.note || ''
        });
      }
    }

    return plan;
  }

  function buildGlobalU21MarketValueQueryUrl(filter, landId) {
    const f = normalizeSourceFilter(filter);
    return `https://www.transfermarkt.com/spieler-statistik/wertvollstespieler/marktwertetop/plus/ausrichtung/${encodeURIComponent(f.alignment)}/spielerposition_id/${encodeURIComponent(f.detailId)}/altersklasse/${encodeURIComponent(f.ageClass)}/jahrgang/0/land_id/${encodeURIComponent(String(landId || '0'))}/yt0/Show/0/`;
  }

  function getU21MvSourcePageWindow(settings, requestedPages, filterWeight) { // u21-nationality-mv-source-prune
    const minMv = Number(settings.u21MinMv || 0);
    const maxMvRaw = Number(settings.u21MaxMv || 0);
    const requested = Math.max(1, Number(requestedPages || DEFAULTS.u21MaxSourcePages || 16));
    const detailPenalty = Number(filterWeight || 0) >= 2 ? 1 : 0;

    // Transfermarkt market-value lists are sorted from highest MV downward. There is no dependable
    // competition-specific MV min/max URL on every table, so we shrink the source pages by using the
    // selected MV band as a page-window before scraping, then the row-level MV filter remains exact.
    if (maxMvRaw > 0 && maxMvRaw <= 100000) {
      return { start: Math.max(1, 6 - detailPenalty), end: Math.min(requested, 18), note: 'mv-window <=100k' };
    }
    if (maxMvRaw > 0 && maxMvRaw <= 250000) {
      return { start: Math.max(1, 4 - detailPenalty), end: Math.min(requested, 16), note: 'mv-window <=250k' };
    }
    if (maxMvRaw > 0 && maxMvRaw <= 500000) {
      return { start: Math.max(1, 2 - detailPenalty), end: Math.min(requested, 14), note: 'mv-window <=500k' };
    }
    if (maxMvRaw > 0 && maxMvRaw <= 1000000) {
      return { start: 1, end: Math.min(requested, 12), note: 'mv-window <=1m' };
    }
    if (minMv >= 1000000) return { start: 1, end: Math.min(requested, 8), note: 'mv-window min>=1m' };
    if (minMv >= 500000) return { start: 1, end: Math.min(requested, 10), note: 'mv-window min>=500k' };
    return { start: 1, end: Math.min(requested, 16), note: 'mv-window broad' };
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
    if (settings.europeLeaguePages) addMany(getEuropeCompetitionCodes());
    if (settings.lowerLeaguePages) addMany(getStrongLowerCompetitionCodes(settings.lowerLeagueDepth));

    // Hasznos extra utánpótlás / alacsonyabb piaci források, ahol fiatal profilok gyakran vannak.
    addMany(['GB3', 'L3', 'FR3', 'IT3A', 'IT3B', 'IT3C', 'E3G1', 'E3G2', 'PL3', 'SC3', 'C3']);

    if (!codes.length) addMany(getEuropeCompetitionCodes().concat(getStrongLowerCompetitionCodes(settings.lowerLeagueDepth)));

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

    if (p >= 90) return Math.max(1, Math.min(requested, 7 - filterPenalty));
    if (p >= 78) return Math.max(1, Math.min(requested, 6 - filterPenalty));
    if (p >= 70) return Math.max(1, Math.min(requested, 5 - filterPenalty));
    if (p >= 62) return Math.max(1, Math.min(requested, 4 - filterPenalty));
    return Math.max(1, Math.min(requested, 3 - filterPenalty));
  }

  function buildCompetitionMarketValuesQueryUrl(code, filter, landId, settings) {
    const cleanCode = String(code || '').trim().toUpperCase();
    const f = normalizeSourceFilter(filter);
    const url = new URL(`https://www.transfermarkt.com/-/marktwerte/wettbewerb/${encodeURIComponent(cleanCode)}/plus/1`);
    url.searchParams.set('ausrichtung', f.alignment);
    url.searchParams.set('spielerposition_id', f.detailId);
    url.searchParams.set('altersklasse', f.ageClass);
    url.searchParams.set('land_id', String(landId || '0'));
    // These query params are harmless if TM ignores them, but useful on pages/routes where the
    // market-value form accepts them. Exact filtering still happens row-by-row after parsing.
    if (settings && Number(settings.u21MinMv || 0) > 0) url.searchParams.set('marktwert_von', String(Math.max(0, Number(settings.u21MinMv || 0))));
    if (settings && Number(settings.u21MaxMv || 0) > 0) url.searchParams.set('marktwert_bis', String(Math.max(0, Number(settings.u21MaxMv || 0))));
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
      if (/\/spieler-statistik\/wertvollstespieler\/marktwertetop(?:\/|$)/i.test(path)) {
        if (/\/page\/\d+$/i.test(path)) {
          path = path.replace(/\/page\/\d+$/i, `/page/${page}`);
        } else {
          path = `${path.replace(/\/$/, '')}/page/${page}`;
        }
        parsed.pathname = path;
        return parsed.toString();
      }

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
      parsed.hash = '';
      return parsed.toString();
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

    const mode = normalizePositionFilterMode(settings.positionFilterMode);
    const group = candidate.positionGroup || positionGroup(candidate.position);
    const detail = positionDetail(candidate.position);
    if (mode === 'broad') {
      if (group && !isGroupEnabled(group, settings)) reasons.push('position-disabled-source');
    } else {
      if (detail && !isDetailEnabled(detail, settings)) reasons.push('detail-position-disabled-source');
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
      if (detail && !isDetailEnabled(detail, settings)) reasons.push('detail-position-disabled-source');
    }

    // U21-ben is működjön a saját csapat kizárás már a source-szinten,
    // ugyanazzal a logikával, mint a lejáró szerződéses scoutban.
    if (shouldApplyOwnTeamFilter(settings) && matchesOwnTeamSourceCandidate(candidate, settings)) {
      reasons.push('own-team-source-club');
    }

    return { ok: reasons.length === 0, reasons: reasons };
  }

  function sortCandidatesForEnrich(a, b) {
    const av = a.marketValue || 0;
    const bv = b.marketValue || 0;
    return bv - av || String(a.name).localeCompare(String(b.name));
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
    const mvGraph = await getMarketValueGraph(candidate.playerId, settings.growthSince, settings.maxMvDropPct);
    const playingTimeCandidate = Object.assign({}, candidate, {
      slug: candidate.slug || profile.slug,
      profileUrl: candidate.profileUrl || profile.profileUrl,
      competitionCodes: unique([].concat(candidate.competitionCodes || [], profile.competitionCodes || []))
    });
    const playingTime = await getPlayingTime(playingTimeCandidate);
    const ownTeamExclusion = detectOwnTeamHistory(candidate, profile, playingTime, settings);
    const chosenPosition = chooseBestPosition(profile.position, candidate.position);

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
      club: profile.club || candidate.club,
      clubIds: unique([].concat(candidate.clubIds || [], profile.clubIds || [])),
      contractUntil: profile.contractUntil || candidate.contractUntil,
      sourceTypes: candidate.sourceTypes || [],
      sourceLabels: candidate.sourceLabels || [],
      sourceUrls: candidate.sourceUrls || [],
      competitionCodes: playingTimeCandidate.competitionCodes || [],
      availability: buildAvailability(candidate, profile),
      currentMarketValue: firstDefinedNumber(profile.currentMarketValue, mvGraph.latestValue, candidate.marketValue),
      sourceMarketValue: candidate.marketValue,
      profileMarketValue: profile.currentMarketValue,
      mv: mvGraph,
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

    return {
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

  async function getMarketValueGraph(playerId, growthSince, maxMvDropPct) {
    const url = `https://www.transfermarkt.com/ceapi/marketValueDevelopment/graph/${encodeURIComponent(playerId)}`;
    let json = null;
    try {
      json = await httpGetCached(url, 'json');
    } catch (error) {
      pushError('mv graph failed', { playerId: playerId, error: stringifyError(error) });
      return emptyMvGraph(growthSince, maxMvDropPct, true);
    }

    const points = uniqueMvPoints(extractMvPoints(json)).sort(function byDate(a, b) {
      return a.dateMs - b.dateMs;
    });

    if (!points.length) return emptyMvGraph(growthSince, maxMvDropPct, true);
    const latest = points[points.length - 1];
    const baseline = findBaselinePoint(points, growthSince) || points[0];
    const absGrowth = latest.value - baseline.value;
    const pctGrowth = baseline.value > 0 ? (absGrowth / baseline.value) * 100 : null;
    const dropPct = Number.isFinite(maxMvDropPct) ? Math.max(0, Math.min(90, Number(maxMvDropPct))) : 15;
    const minAllowedValue = baseline.value > 0 ? Math.round(baseline.value * (1 - dropPct / 100)) : baseline.value;
    const passedTrend = latest.value >= minAllowedValue;
    const lastStep = findLastStepUp(points);

    return {
      ok: true,
      unknown: false,
      growthSince: growthSince,
      maxMvDropPct: dropPct,
      minAllowedValue: minAllowedValue,
      latestDate: latest.date,
      latestValue: latest.value,
      baselineDate: baseline.date,
      baselineValue: baseline.value,
      absGrowth: absGrowth,
      pctGrowth: pctGrowth,
      grew: absGrowth > 0,
      passedTrend: passedTrend,
      droppedTooMuch: !passedTrend,
      lastStepUp: lastStep,
      points: points
    };
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

  function buildAvailability(candidate, profile) {
    const types = candidate.sourceTypes || [];
    const bits = [];
    if (types.includes('free-agent') || /without club|vertragslos/i.test(profile.club || '')) bits.push('Free agent');
    if (types.includes('contract-expiring') || profile.contractUntil) bits.push(`Contract expiring${profile.contractUntil ? ` (${profile.contractUntil})` : ''}`);
    return unique(bits).join(' + ') || 'Candidate';
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
    if (!isAvailabilityCandidate(player)) reasons.push('not-free-agent-or-expiring');
    if (settings.futureExclude && player.futureTransferDetected) reasons.push('future-transfer-detected');
    if (shouldApplyOwnTeamFilter(settings) && player.ownTeamExclusion && player.ownTeamExclusion.detected) reasons.push('own-team-recent-history');

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

  function matchesU21Nationality(nationality, settings) {
    const selected = (settings.u21Nationalities || []).map(normalizeText).filter(Boolean);
    if (!selected.length) return true;
    const raw = normalizeText(nationality || '');
    if (!raw) return true;
    return selected.some(function match(country) { return raw.includes(country) || country.includes(raw); });
  }

  function formatU21Score(u21) {
    if (!u21) return '—';
    return `${u21.total || 0}/100 · Meccs ${u21.matchRatio || 0}% · MV ${u21.mvTrend || 0}`;
  }

  function formatU21Club(u21, player) {
    const club = player && player.club ? player.club : '';
    return club || '—';
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

  function anyDetailedPositionEnabled(settings) {
    return DETAIL_POSITION_KEYS.some(function hasDetail(key) { return Boolean(settings[key]); });
  }

  function normalizePositionFilterMode(value) {
    return String(value || '').toLowerCase() === 'detail' ? 'detail' : 'broad';
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
    const select = panel.querySelector('select[name="u21Nationalities"]');
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

    const picker = document.createElement('div');
    picker.id = pickerId;
    picker.className = 'tm-scout-v2-nationality-picker';
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Nemzetiségek');

    Array.from(select.options).forEach(function buildNationalityItem(option) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tm-scout-v2-nationality-option';
      item.setAttribute('data-nationality-value', option.value);
      item.setAttribute('aria-pressed', option.selected ? 'true' : 'false');
      item.innerHTML = [
        '<span class="tm-scout-v2-nationality-check" aria-hidden="true"></span>',
        `<span class="tm-scout-v2-nationality-name">${escapeHtml(tx(cleanText(option.textContent) || option.value))}</span>`
      ].join('');
      if (option.selected) item.classList.add('is-selected');
      picker.appendChild(item);
    });

    select.insertAdjacentElement('afterend', picker);

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
    tr.innerHTML = headers.map(function headerCell(label) { return `<th>${escapeHtml(tx(label))}</th>`; }).join('');
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
    setResultTableHeaders(panel, ['Játékos','Poszt','Kor','Nemzetiség','Elérhetőség','Klub / utolsó klub','MV most','MV változás','Játékidő','Utolsó szezonok','Forrás','TM profil']);
    const tbody = panel.querySelector('[data-role="results"]');
    if (!tbody) return;
    tbody.textContent = '';

    if (!results.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 12;
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
        player.availability || '—',
        player.club || '—',
        formatEuro(player.currentMarketValue),
        formatGrowth(player.mv),
        formatPlayingTime(player.playingTime),
        formatRecentSeasons(player.playingTime),
        unique(player.sourceLabels || player.sourceTypes || []).join(', ') || '—'
      ];

      const cellClasses = ['player','position','age','nation','availability','club','mv','growth','playing','seasons','source'];
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

  function setStatus(panel, text, progress) {
    const status = panel.querySelector('[data-role="status"]');
    const bar = panel.querySelector('[data-role="progress"]');
    if (status) status.textContent = translateRuntimeText(text);
    if (bar && progress !== null && progress !== undefined) {
      bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    }
    renderStats(panel);
  }

  function buildCsvExport(results) {
    if (isU21Mode(state.settings)) return buildU21CsvExport(results);
    const headers = [
      ex('player'), ex('position'), ex('age'), ex('nationality'), ex('availability'), ex('club'),
      ex('currentMv'), ex('mvChange'), ex('playingTime'), ex('recentSeasons'), ex('tmProfile')
    ];
    const rows = results.map(function row(player) {
      return [
        player.name,
        `${player.positionGroup || ''}${player.positionDetail ? `/${player.positionDetail}` : ''}${player.position ? ` · ${player.position}` : ''}`,
        player.age,
        player.nationality,
        player.availability,
        player.club,
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
        currentMv: 'MV most',
        mvChange: 'MV változás',
        playingTime: 'Játékidő',
        recentSeasons: 'Utolsó szezonok',
        list: 'Lista',
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
        sortU21: 'Rendezés: U21 score',
        u21Weights: 'Fő súlyok: meccsarány · MV-változás · életkor · játékvolumen',
        joined: 'Érkezett',
        ends: 'Lejár',
        leagueLevel: 'Liga-szint',
        apps: 'meccs',
        app: 'meccs',
        min: 'perc',
        unknown: 'ismeretlen',
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
        currentMv: 'Current MV',
        mvChange: 'MV change',
        playingTime: 'Playing time',
        recentSeasons: 'Recent seasons',
        list: 'List',
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
        sortU21: 'Sort: U21 score',
        u21Weights: 'Main weights: match ratio · MV change · age · playing volume',
        joined: 'Joined',
        ends: 'Ends',
        leagueLevel: 'League level',
        apps: 'apps',
        app: 'app',
        min: 'min',
        unknown: 'unknown',
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
        currentMv: 'MV actual',
        mvChange: 'Schimbare MV',
        playingTime: 'Minute jucate',
        recentSeasons: 'Sezoane recente',
        list: 'Listă',
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
        sortU21: 'Sortare: scor U21',
        u21Weights: 'Ponderi principale: procent meciuri · schimbare MV · vârstă · volum de joc',
        joined: 'Sosit',
        ends: 'Expiră',
        leagueLevel: 'Nivel ligă',
        apps: 'meciuri',
        app: 'meci',
        min: 'min',
        unknown: 'necunoscut',
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

  function buildExportCriteria(settings) {
    const s = settings || {};
    if (isU21Mode(s)) {
      const countries = (s.u21Nationalities || []).length ? s.u21Nationalities.join(', ') : ex('all');
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
    return [
      `${ex('criteriaMv')}: ${formatEuro(s.minMv)}–${formatEuro(s.maxMv)}`,
      `${ex('criteriaAge')}: ${s.minAge || '—'}–${s.maxAge || '—'}`,
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
      if (!mv || mv.absGrowth === null || mv.absGrowth === undefined) {
        return `<div class="growth-cell"><span class="muted">${escapeHtml(mv && mv.unknown ? ex('unknown') : '—')}</span></div>`;
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

    function renderSource(player) {
      const labels = unique(player.sourceLabels || player.sourceTypes || []);
      if (!labels.length) return '<span class="muted">—</span>';
      return `<div class="source-list">${labels.slice(0, 4).map(function sourceLabel(label) { return `<span>${escapeHtml(translateRuntimeText(label))}</span>`; }).join('')}</div>`;
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
        return ['<tr ' + rowDataAttrs(player) + '>', cell('player', 'player-col', renderPlayer(player, index)), cell('position', 'position-col', renderPosition(player)), cell('age', 'age-col', escapeHtml(player.age === null || player.age === undefined ? '—' : String(player.age))), cell('nationality', 'nation-col', renderInlineList(player.nationality, '—')), cell('u21Status', 'availability-col', `<div class="availability-cell"><strong>${escapeHtml(formatU21Score(u21))}</strong><span>${escapeHtml(formatU21MatchRatio(u21, player.playingTime))}</span></div>`), cell('clubTeam', 'club-col', `<strong>${escapeHtml(formatU21Club(u21, player))}</strong>`), cell('currentMv', 'mv-now-col', `<strong>${escapeHtml(formatEuro(player.currentMarketValue))}</strong>`), cell('mvChange', 'growth-col', renderGrowth(player.mv)), cell('playingTime', 'playing-col', renderPlayingTime(player.playingTime, u21)), cell('recentSeasons', 'season-col', renderSeasons(player.playingTime)), cell('profile', 'link-col', `<a class="open-link" href="${escapeAttr(player.profileUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex('profile'))}</a>`), '</tr>'].join('');
      }
      return ['<tr ' + rowDataAttrs(player) + '>', cell('player', 'player-col', renderPlayer(player, index)), cell('position', 'position-col', renderPosition(player)), cell('age', 'age-col', escapeHtml(player.age === null || player.age === undefined ? '—' : String(player.age))), cell('nationality', 'nation-col', renderInlineList(player.nationality, '—')), cell('availability', 'availability-col', renderAvailability(player.availability)), cell('club', 'club-col', `<strong>${escapeHtml(cleanDash(player.club))}</strong>`), cell('currentMv', 'mv-now-col', `<strong>${escapeHtml(formatEuro(player.currentMarketValue))}</strong>`), cell('mvChange', 'growth-col', renderGrowth(player.mv)), cell('playingTime', 'playing-col', renderPlayingTime(player.playingTime)), cell('recentSeasons', 'season-col', renderSeasons(player.playingTime)), cell('profile', 'link-col', `<a class="open-link" href="${escapeAttr(player.profileUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(ex('profile'))}</a>`), '</tr>'].join('');
    }).join('\n');

    const criteria = buildExportCriteria(settings);
    const nationalityOptions = mode === 'u21' ? unique(results.map(function nat(player) { return player.nationality || ''; }).filter(Boolean)).sort().map(function natOption(nat) { return `<option value="${escapeAttr(normalizeText(nat))}">${escapeHtml(nat)}</option>`; }).join('') : '';

    const controls = mode === 'u21'
      ? ['<label>' + ex('sort') + '<select id="sortBy"><option value="scoreDesc">' + ex('scoreSort') + '</option><option value="matchDesc">' + ex('matchSort') + '</option><option value="mvGrowthDesc">' + ex('absGrowth') + '</option><option value="mvDesc">' + ex('mvNowSort') + '</option><option value="ageAsc">' + ex('youngerFirst') + '</option><option value="nameAsc">' + ex('nameAZ') + '</option></select></label>', '<label>' + ex('broadPos') + '<select id="broadFilter"><option value="all">' + ex('allBroad') + '</option><option value="GK">GK</option><option value="DEF">DEF</option><option value="MID">MID</option><option value="FWD">ATT/FWD</option></select></label>', '<label>' + ex('detailPos') + '<select id="detailFilter"><option value="all">' + ex('allDetail') + '</option><option value="GK">GK</option><option value="CB">CB</option><option value="LB">LB</option><option value="RB">RB</option><option value="DM">DM</option><option value="CM">CM</option><option value="AM">AM</option><option value="LM">LM</option><option value="RM">RM</option><option value="LW">Left Winger</option><option value="RW">Right Winger</option><option value="WING">Winger</option><option value="CF">CF/ST</option><option value="SS">SS</option><option value="OTHER">' + ex('other') + '</option></select></label>', '<label>' + ex('nationality') + '<select id="nationalityFilter"><option value="all">' + ex('allNationalities') + '</option>' + nationalityOptions + '</select></label>'].join('\n')
      : ['<label>' + ex('sort') + '<select id="sortBy"><option value="absDesc">' + ex('absGrowth') + '</option><option value="mvDesc">' + ex('mvNowSort') + '</option><option value="pctDesc">' + ex('pctImprove') + '</option><option value="pctAsc">' + ex('pctDrop') + '</option><option value="nameAsc">' + ex('nameAZ') + '</option></select></label>', '<label>' + ex('availabilityFilter') + '<select id="freeFilter"><option value="all">' + ex('allPlayers') + '</option><option value="free">' + ex('freeAgentsOnly') + '</option><option value="nonfree">' + ex('nonFreeOnly') + '</option></select></label>', '<label>' + ex('broadPos') + '<select id="broadFilter"><option value="all">' + ex('allBroad') + '</option><option value="GK">GK</option><option value="DEF">DEF</option><option value="MID">MID</option><option value="FWD">ATT/FWD</option></select></label>', '<label>' + ex('detailPos') + '<select id="detailFilter"><option value="all">' + ex('allDetail') + '</option><option value="GK">GK</option><option value="CB">CB</option><option value="LB">LB</option><option value="RB">RB</option><option value="DM">DM</option><option value="CM">CM</option><option value="AM">AM</option><option value="LM">LM</option><option value="RM">RM</option><option value="LW">Left Winger</option><option value="RW">Right Winger</option><option value="WING">Winger</option><option value="CF">CF/ST</option><option value="SS">SS</option><option value="OTHER">' + ex('other') + '</option></select></label>'].join('\n');

    const filterControls = ['<section class="export-controls" aria-label="' + escapeAttr(ex('filtersAndSorting')) + '">', '<div class="export-control-head"><strong>' + escapeHtml(ex('filtersAndSorting')) + '</strong><span><b id="visibleCount">' + escapeHtml(String(results.length)) + '</b> / <b id="totalCount">' + escapeHtml(String(results.length)) + '</b> ' + escapeHtml(ex('players')) + '</span></div>', '<div class="export-control-grid">', controls, '<button type="button" id="resetFilters">' + escapeHtml(ex('reset')) + '</button>', '</div>', '<p class="export-control-note">' + escapeHtml(ex('clientNote')) + '</p>', '</section>'].join('\n');

    const headers = mode === 'u21'
      ? ['player','position','age','nationality','u21Status','clubTeam','currentMv','mvChange','playingTime','recentSeasons','profile']
      : ['player','position','age','nationality','availability','club','currentMv','mvChange','playingTime','recentSeasons','profile'];
    const colClasses = mode === 'u21'
      ? ['player','position','age','nation','availability','club','mvnow','growth','playing','season','link']
      : ['player','position','age','nation','availability','club','mvnow','growth','playing','season','link'];

    return ['<!doctype html>', `<html lang="${escapeAttr(lang)}">`, '<head>', '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">', `<title>${escapeHtml(ex('exportTitle'))}</title>`, '<style>', exportCss(), '</style>', '</head>', '<body>', '<main>', '<section class="hero">', '<div class="topline">', '<div>', `<div class="kicker">${escapeHtml(ex('scoutExport'))}</div>`, '<h1>TM Scout V2</h1>', `<p>${escapeHtml(mode === 'u21' ? ex('u21Export') : ex('contractExport'))} · ${escapeHtml(new Date().toLocaleString(locale))}</p>`, '</div>', `<div class="criteria">${criteria.map(function criterion(text) { return `<span>${escapeHtml(text)}</span>`; }).join('')}</div>`, '</div>', '<div class="stats">', `<div class="stat"><span>${escapeHtml(ex('results'))}</span><strong>${escapeHtml(String(results.length))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('checkedPlayers'))}</span><strong>${escapeHtml(String(state.rawCandidates.length || debug.rawCandidates || 0))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('enriched'))}</span><strong>${escapeHtml(String(state.enrichedCount || debug.enriched || 0))}</strong></div>`, `<div class="stat"><span>${escapeHtml(ex('mode'))}</span><strong>${escapeHtml(mode === 'u21' ? 'U21' : 'Contract')}</strong></div>`, '</div>', '</section>', filterControls, '<section class="table-wrap">', '<table>', `<colgroup>${colClasses.map(function cc(cls) { return `<col class="${escapeAttr(cls)}">`; }).join('')}</colgroup>`, `<thead><tr>${headers.map(function h(key) { return `<th>${escapeHtml(ex(key))}</th>`; }).join('')}</tr></thead>`, `<tbody data-export-body>${rows || '<tr><td colspan="11">' + escapeHtml(ex('noResults')) + '</td></tr>'}</tbody>`, '</table>', '</section>', '</main>', '<script>', exportScript(mode), '</script>', '</body>', '</html>'].join('\n');
  }

  function exportCss() {
    return [
      ':root{color-scheme:dark;--bg:#071018;--panel:#0b1722;--panel2:#0e1f2e;--line:rgba(125,166,200,.24);--line2:rgba(125,166,200,.14);--text:#eef7ff;--muted:#9fb3c7;--green:#56f097;--blue:#9bd2ff;--red:#ff8b8b}',
      '*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,rgba(86,240,151,.13),transparent 34rem),radial-gradient(circle at top right,rgba(80,140,220,.14),transparent 32rem),var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.42}main{width:min(1660px,calc(100% - 28px));margin:0 auto;padding:22px 0 42px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.hero,.export-controls,.table-wrap{border:1px solid var(--line);border-radius:22px;background:rgba(11,23,34,.88);box-shadow:0 22px 70px rgba(0,0,0,.25)}.hero{padding:22px;margin-bottom:14px}.topline{display:flex;justify-content:space-between;gap:22px;align-items:flex-start}.kicker{color:var(--green);font-size:11px;text-transform:uppercase;letter-spacing:.14em;font-weight:900}h1{margin:5px 0 7px;font-size:clamp(30px,4.8vw,56px);letter-spacing:-.055em;line-height:.95}.hero p{margin:0;color:var(--muted)}.criteria{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;max-width:720px}.criteria span{border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.045);padding:6px 10px;color:#dceafa;font-size:12px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:18px}.stat{border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.045);padding:13px}.stat span{display:block;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:11px}.stat strong{display:block;font-size:26px;margin-top:3px}.export-controls{padding:14px 16px;margin-bottom:14px}.export-control-head{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:12px;color:#dceafa}.export-control-head strong{font-size:14px}.export-control-head span{font-size:12px;color:var(--muted)}.export-control-grid{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr)) auto;gap:10px;align-items:end}.export-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:800;color:#9fb6c9;text-transform:uppercase;letter-spacing:.04em}.export-controls select{width:100%;border:1px solid var(--line);border-radius:10px;background:#071018;color:#eef6ff;padding:8px 10px;font:700 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif}.export-controls button{height:35px;border:1px solid var(--line);border-radius:10px;background:#102235;color:#eaf4ff;font-weight:800;cursor:pointer;padding:0 14px}.export-controls button:hover{background:#16314a}.export-control-note{margin:10px 0 0;color:#849aaf;font-size:11.5px}.table-wrap{overflow:auto}table{width:100%;min-width:1380px;border-collapse:collapse;table-layout:fixed}th,td{padding:13px 10px;border-bottom:1px solid var(--line2);vertical-align:top;text-align:left;overflow-wrap:anywhere}th{position:sticky;top:0;background:#102235;color:#dceafa;font-size:11px;text-transform:uppercase;letter-spacing:.06em;z-index:1}tr:nth-child(even) td{background:rgba(255,255,255,.025)}.rank-line{color:var(--green);font-size:16px;font-weight:950;line-height:1;margin-bottom:4px}.player-cell strong{display:block;font-size:19px;line-height:1.16;letter-spacing:-.018em}.profile-mini{display:inline-block;font-size:12px;line-height:1.12;font-weight:800;margin-top:3px}.open-link{font-weight:800}.position-code{font-weight:950;font-size:15px;line-height:1.18}.position-detail{display:block;font-weight:900;color:#dceafa;margin-top:3px;font-size:14px;line-height:1.2}.position-label,.muted,.muted-line,.date-line{display:block;color:var(--muted);font-size:12px;margin-top:3px;line-height:1.25}.availability-cell strong,.availability-cell span,.playing-cell span{display:block}.availability-cell strong{margin-bottom:3px}.playing-cell{display:flex;flex-direction:column;gap:2px}.season-list{display:flex;flex-direction:column;gap:7px;min-width:0}.season-row{display:grid;grid-template-columns:64px minmax(0,1fr);column-gap:10px;align-items:start;line-height:1.24}.season-row span{display:block}.season-row strong{font-size:14.6px;color:#eef7ff;white-space:nowrap;font-weight:950}.season-stats{display:flex!important;flex-wrap:wrap;gap:2px 10px;color:#e8f4ff;font-size:14.1px;font-weight:850}.season-stats span{white-space:nowrap}.plain-list{font-weight:700}.growth-positive{color:var(--green);font-weight:950}.growth-negative{color:var(--red);font-weight:950}.mv-route{display:flex;gap:7px;color:#f0f8ff;font-size:14.5px;font-weight:950;line-height:1.18;letter-spacing:-.01em}.mv-route span{white-space:nowrap}.growth-line{font-size:15.2px;line-height:1.16;margin-top:4px}.playing-cell strong{color:#fff}.season-row{font-size:14px;color:#e8f4ff}.source-list{display:flex;flex-wrap:wrap;gap:5px}.source-list span{border:1px solid var(--line2);background:rgba(255,255,255,.045);border-radius:999px;padding:3px 7px;color:#dceafa;font-size:11px}col.player{width:156px}col.position{width:112px}col.age{width:54px}col.nation{width:120px}col.availability{width:205px}col.club{width:120px}col.mvnow{width:92px}col.growth{width:150px}col.playing{width:105px}col.season{width:270px}col.link{width:78px}.club-col strong{display:block;line-height:1.24}.availability-cell{line-height:1.28}.availability-cell strong{font-size:14px;line-height:1.25}.mv-now-col strong{font-size:16px}.player-col{font-weight:800}.is-hidden{display:none!important}',
      '@media(max-width:900px){main{width:100%;padding:12px 8px 28px}.hero{padding:17px;border-radius:16px}.topline{display:block}.criteria{justify-content:flex-start;margin-top:12px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.export-control-grid{grid-template-columns:1fr 1fr}.export-control-grid button{grid-column:1/-1}.export-control-head{align-items:flex-start;flex-direction:column}.table-wrap{border:0;background:transparent;overflow:visible;box-shadow:none}table,thead,tbody,tr,td{display:block;min-width:0;width:100%}colgroup,thead{display:none}tr{margin:0 0 12px;border:1px solid var(--line);border-radius:16px;background:#0b1824;overflow:hidden}td{display:grid;grid-template-columns:112px 1fr;gap:10px;border-bottom:1px solid var(--line2);padding:11px;background:#0b1824!important}td::before{content:attr(data-label);font-weight:800;color:var(--muted);text-transform:uppercase;font-size:10px;letter-spacing:.06em}}',
      '@media(max-width:540px){.stats,.export-control-grid{grid-template-columns:1fr}td{grid-template-columns:1fr;gap:4px}.criteria span{font-size:11px}}'
    ].join('');
  }

  function exportScript(mode) {
    if (mode === 'u21') {
      return `(function(){const tbody=document.querySelector('[data-export-body]');if(!tbody)return;const rows=Array.from(tbody.querySelectorAll('tr[data-row]'));const sortBy=document.getElementById('sortBy');const broadFilter=document.getElementById('broadFilter');const detailFilter=document.getElementById('detailFilter');const nationalityFilter=document.getElementById('nationalityFilter');const visibleCount=document.getElementById('visibleCount');const reset=document.getElementById('resetFilters');function num(row,key){const value=Number(row.dataset[key]);return Number.isFinite(value)?value:-999999999;}function name(row){return String(row.dataset.playerName||'');}function compareRows(a,b){const mode=sortBy?sortBy.value:'scoreDesc';if(mode==='matchDesc')return num(b,'matchRatio')-num(a,'matchRatio')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='mvGrowthDesc')return num(b,'mvAbs')-num(a,'mvAbs')||num(b,'mvPct')-num(a,'mvPct')||name(a).localeCompare(name(b));if(mode==='mvDesc')return num(b,'mvNow')-num(a,'mvNow')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='ageAsc')return num(a,'age')-num(b,'age')||num(b,'u21Score')-num(a,'u21Score')||name(a).localeCompare(name(b));if(mode==='nameAsc')return name(a).localeCompare(name(b));return num(b,'u21Score')-num(a,'u21Score')||num(b,'matchRatio')-num(a,'matchRatio')||name(a).localeCompare(name(b));}function passes(row){const detail=detailFilter?detailFilter.value:'all';const broad=broadFilter?broadFilter.value:'all';const nat=nationalityFilter?nationalityFilter.value:'all';if(detail&&detail!=='all'&&row.dataset.detailPos!==detail)return false;if((!detail||detail==='all')&&broad&&broad!=='all'&&row.dataset.broadPos!==broad)return false;if(nat&&nat!=='all'&&row.dataset.nationality!==nat)return false;return true;}function apply(){const filtered=rows.filter(passes).sort(compareRows);rows.forEach(function(row){row.classList.add('is-hidden');});filtered.forEach(function(row,index){row.classList.remove('is-hidden');tbody.appendChild(row);const rank=row.querySelector('[data-rank]');if(rank)rank.textContent='#'+(index+1);});if(visibleCount)visibleCount.textContent=String(filtered.length);}[sortBy,broadFilter,detailFilter,nationalityFilter].forEach(function(el){if(el)el.addEventListener('change',apply);});if(reset)reset.addEventListener('click',function(){if(sortBy)sortBy.value='scoreDesc';if(broadFilter)broadFilter.value='all';if(detailFilter)detailFilter.value='all';if(nationalityFilter)nationalityFilter.value='all';apply();});apply();})();`;
    }
    return `(function(){const tbody=document.querySelector('[data-export-body]');if(!tbody)return;const rows=Array.from(tbody.querySelectorAll('tr[data-row]'));const sortBy=document.getElementById('sortBy');const freeFilter=document.getElementById('freeFilter');const broadFilter=document.getElementById('broadFilter');const detailFilter=document.getElementById('detailFilter');const visibleCount=document.getElementById('visibleCount');const reset=document.getElementById('resetFilters');function num(row,key){const value=Number(row.dataset[key]);return Number.isFinite(value)?value:-999999999999;}function name(row){return String(row.dataset.playerName||'');}function compareRows(a,b){const mode=sortBy?sortBy.value:'absDesc';if(mode==='mvDesc')return num(b,'mvNow')-num(a,'mvNow')||num(b,'mvAbs')-num(a,'mvAbs')||name(a).localeCompare(name(b));if(mode==='pctDesc')return num(b,'mvPct')-num(a,'mvPct')||num(b,'mvAbs')-num(a,'mvAbs')||name(a).localeCompare(name(b));if(mode==='pctAsc')return num(a,'mvPct')-num(b,'mvPct')||num(a,'mvAbs')-num(b,'mvAbs')||name(a).localeCompare(name(b));if(mode==='nameAsc')return name(a).localeCompare(name(b));return num(b,'mvAbs')-num(a,'mvAbs')||num(b,'mvPct')-num(a,'mvPct')||num(b,'mvNow')-num(a,'mvNow')||name(a).localeCompare(name(b));}function passes(row){const freeMode=freeFilter?freeFilter.value:'all';if(freeMode==='free'&&row.dataset.freeAgent!=='true')return false;if(freeMode==='nonfree'&&row.dataset.freeAgent==='true')return false;const detail=detailFilter?detailFilter.value:'all';const broad=broadFilter?broadFilter.value:'all';if(detail&&detail!=='all')return row.dataset.detailPos===detail;if(broad&&broad!=='all')return row.dataset.broadPos===broad;return true;}function apply(){const filtered=rows.filter(passes).sort(compareRows);rows.forEach(function(row){row.classList.add('is-hidden');});filtered.forEach(function(row,index){row.classList.remove('is-hidden');tbody.appendChild(row);const rank=row.querySelector('[data-rank]');if(rank)rank.textContent='#'+(index+1);});if(visibleCount)visibleCount.textContent=String(filtered.length);}[sortBy,freeFilter,broadFilter,detailFilter].forEach(function(el){if(el)el.addEventListener('change',apply);});if(reset)reset.addEventListener('click',function(){if(sortBy)sortBy.value='absDesc';if(freeFilter)freeFilter.value='all';if(broadFilter)broadFilter.value='all';if(detailFilter)detailFilter.value='all';apply();});apply();})();`;
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

    if (!endpoint) {
      batch.forEach(function fallbackNoEndpoint(item) {
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
      if (!response.ok) throw new Error(`Batch proxy HTTP ${response.status}`);
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
      // Worker nincs még frissítve / batch endpoint ideiglenesen hibázik: ne álljon meg a keresés,
      // csak menjen vissza a régi egyenkénti proxyra.
      pushError('batch proxy fallback', stringifyError(error));
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
      .tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px 12px!important}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks)>legend{grid-column:1/-1!important}.tm-scout-v2-controls [hidden],.tm-scout-v2-controls .tm-scout-v2-mode-hidden{display:none!important}.tm-scout-v2-controls label{display:block!important;color:#c8d8e7!important;font:700 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;margin:0!important;min-width:0!important}.tm-scout-v2-controls input,.tm-scout-v2-controls select,.tm-scout-v2-controls textarea{width:100%!important;max-width:100%!important;min-width:0!important;border:1px solid rgba(125,166,200,.32)!important;border-radius:9px!important;background:#07111a!important;color:#eef6ff!important;padding:7px 8px!important;font:650 12px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;box-shadow:none!important;outline:none!important}.tm-scout-v2-controls label>input:not([type="checkbox"]),.tm-scout-v2-controls label>select,.tm-scout-v2-controls label>textarea{display:block!important;margin-top:6px!important}.tm-scout-v2-controls input:focus,.tm-scout-v2-controls select:focus,.tm-scout-v2-controls textarea:focus{border-color:#73add7!important;background:#091722!important}.tm-scout-v2-controls select{display:block!important;height:36px!important;min-height:36px!important;line-height:1.2!important;padding:8px 34px 8px 10px!important;font-size:12px!important;font-weight:750!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;-webkit-appearance:menulist!important;appearance:auto!important;background-color:#07111a!important;color:#eef6ff!important}.tm-scout-v2-controls select option{background:#07111a!important;color:#eef6ff!important;font:700 13px/1.25 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important}.tm-scout-v2-controls select[multiple],.tm-scout-v2-controls .tm-scout-v2-multi-select{height:auto!important;min-height:220px!important;max-height:320px!important;overflow-y:auto!important;overflow-x:hidden!important;padding:8px 10px!important;white-space:normal!important;text-overflow:clip!important;-webkit-appearance:listbox!important;appearance:auto!important;background-image:none!important}.tm-scout-v2-controls select[multiple] option,.tm-scout-v2-controls .tm-scout-v2-multi-select option{padding:5px 8px!important;min-height:24px!important;line-height:1.25!important;white-space:normal!important}.tm-scout-v2-native-multi-hidden{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;min-height:1px!important;max-height:1px!important;opacity:0!important;pointer-events:none!important}.tm-scout-v2-nationality-picker{grid-column:1/-1!important;display:grid!important;grid-template-columns:1fr!important;gap:4px!important;max-height:260px!important;overflow:auto!important;padding:7px!important;border:1px solid rgba(125,166,200,.32)!important;border-radius:10px!important;background:#07111a!important;scrollbar-color:#31516b #07111a!important}.tm-scout-v2-nationality-option{display:flex!important;align-items:center!important;gap:8px!important;width:100%!important;min-height:28px!important;padding:6px 8px!important;border:0!important;border-radius:8px!important;background:transparent!important;color:#eef6ff!important;text-align:left!important;font:800 12px/1.2 Inter,system-ui,-apple-system,Segoe UI,sans-serif!important;cursor:pointer!important}.tm-scout-v2-nationality-option:hover{background:#0e2233!important}.tm-scout-v2-nationality-option.is-selected{background:#235f8d!important;color:#fff!important}.tm-scout-v2-nationality-check{width:14px!important;height:14px!important;border:1px solid rgba(125,166,200,.55)!important;border-radius:4px!important;background:#101f2d!important;flex:0 0 14px!important}.tm-scout-v2-nationality-option.is-selected .tm-scout-v2-nationality-check{background:#56f097!important;border-color:#56f097!important;box-shadow:inset 0 0 0 3px #235f8d!important}.tm-scout-v2-nationality-name{overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}.tm-scout-v2-controls input[type="checkbox"]{width:15px!important;height:15px!important;flex:0 0 15px!important;padding:0!important;margin:0!important;accent-color:#3cae78!important}.tm-scout-v2-controls textarea{resize:vertical;min-height:92px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important}.tm-scout-v2-controls label.tm-scout-v2-wide{grid-column:1/-1!important;display:block!important}.tm-scout-v2-controls label.tm-scout-v2-checkline{grid-column:1/-1!important;display:flex!important;align-items:center!important;gap:9px!important;margin:2px 0!important;color:#d1e1ee!important}
      .tm-scout-v2-checks{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px 14px!important}.tm-scout-v2-checks legend{grid-column:1/-1!important}.tm-scout-v2-checks label{display:flex!important;align-items:center!important;gap:8px!important;margin:0!important;color:#c9d8e5!important;font-weight:700!important;line-height:1.2!important}.tm-scout-v2-source-options{display:block!important}.tm-scout-v2-source-options label{display:flex!important;align-items:center!important;gap:8px!important;margin:9px 0!important}.tm-scout-v2-source-options label.tm-scout-v2-wide{display:block!important;margin:10px 0!important}.tm-scout-v2-source-options label.tm-scout-v2-wide select,.tm-scout-v2-source-options label.tm-scout-v2-wide input{margin-top:6px!important}.tm-scout-v2-detail-options{grid-template-columns:repeat(2,minmax(0,1fr))!important}.tm-scout-v2-actions{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important;position:static!important;bottom:auto!important;z-index:1!important;margin:14px 0 0!important;padding:9px!important;background:#091722!important;border:1px solid rgba(125,166,200,.24)!important;border-radius:14px!important;box-shadow:none!important}.tm-scout-v2-actions button{width:100%!important;min-height:32px!important;padding:7px 6px!important;border-radius:9px!important;font-size:11px!important;line-height:1.05!important;white-space:nowrap!important}.tm-scout-v2-actions .tm-scout-v2-primary{grid-column:auto!important}
      .tm-scout-v2-output{min-width:0;display:flex;flex-direction:column;overflow:hidden}.tm-scout-v2-statusbar{padding:13px 16px;border-bottom:1px solid rgba(125,166,200,.18);background:#0b1722}.tm-scout-v2-status{color:#d7e8f8;font-size:13px;font-weight:750;margin-bottom:9px}.tm-scout-v2-progress{height:8px;background:#071018;border-radius:999px;overflow:hidden;border:1px solid rgba(125,166,200,.18)}.tm-scout-v2-progress span{display:block;height:100%;width:0;background:#3a97d4;transition:width .2s ease}
      .tm-scout-v2-note-mini{font-size:11px;line-height:1.35;color:#95aabd;grid-column:1/-1;margin:2px 0 0}.tm-scout-v2-muted-block{opacity:.45}.tm-scout-v2-muted-block legend::after{content:' (inaktív)';font-weight:700;color:#c49d51}.tm-scout-v2-note{border:1px solid rgba(125,166,200,.22);background:#0a1621;border-radius:11px;padding:9px 11px;margin-bottom:12px;color:#bdd4e7;font-size:12px;line-height:1.35}.tm-scout-v2-stats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;padding:12px 16px;border-bottom:1px solid rgba(125,166,200,.18)}.tm-scout-v2-stat{background:#0a1621;border:1px solid rgba(125,166,200,.18);border-radius:11px;padding:9px 10px}.tm-scout-v2-stat span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#95aabd;font-weight:800}.tm-scout-v2-stat strong{display:block;margin-top:3px;color:#fff;font-size:18px}
      .tm-scout-v2-table-wrap{overflow:auto;min-height:0;flex:1;padding:0 0 14px;background:#071018!important}.tm-scout-v2-table{width:100%;border-collapse:separate!important;border-spacing:0!important;min-width:1280px;background:#071018!important}.tm-scout-v2-table th,.tm-scout-v2-table td{padding:9px 10px!important;border-bottom:1px solid rgba(126,163,196,.18)!important;text-align:left!important;vertical-align:top!important;font-size:12px!important;line-height:1.34!important}.tm-scout-v2-table th{position:sticky!important;top:0!important;z-index:2!important;background:#102235!important;color:#d7e7f5!important;font-size:10px!important;text-transform:uppercase!important;letter-spacing:.06em!important}.tm-scout-v2-table tbody tr:nth-child(odd) td{background:#0a1722!important}.tm-scout-v2-table tbody tr:nth-child(even) td{background:#0c1b27!important}.tm-scout-v2-table tbody tr:hover td{background:#10263a!important;color:#ffffff!important}.tm-scout-v2-table td{color:#dcecff!important}.tm-scout-v2-table a{color:#9bd2ff!important;font-weight:800!important}.tm-scout-v2-cell-player{font-weight:800!important;color:#ffffff!important;min-width:150px}.tm-scout-v2-cell-position{color:#a7f0bf!important;font-weight:800!important;min-width:150px}.tm-scout-v2-cell-growth{color:#dbeff0!important;font-weight:800!important;white-space:nowrap}.tm-scout-v2-cell-playing{color:#ecd996!important;font-weight:800!important;white-space:nowrap}.tm-scout-v2-cell-seasons{color:#c2d7eb!important;min-width:180px}.tm-scout-v2-cell-availability{color:#cfe2f6!important;min-width:310px}.tm-scout-v2-cell-source{color:#aebfd0!important;min-width:170px}.tm-scout-v2-empty{text-align:center!important;color:#9fb4c6!important;padding:30px!important;background:#0a1724!important}
      .tm-scout-v2-collapsed{inset:auto 16px 16px auto;width:min(520px,calc(100vw - 32px));height:auto}.tm-scout-v2-collapsed .tm-scout-v2-body{display:none}.tm-scout-v2-collapsed .tm-scout-v2-shell{height:auto}.tm-scout-v2-collapsed .tm-scout-v2-head{border-bottom:0}

      .tm-scout-v2-ui-modal{position:fixed!important;inset:0!important;z-index:2147483647!important;display:grid!important;place-items:center!important;padding:18px!important;background:rgba(2,8,13,.72)!important;backdrop-filter:blur(8px)!important}.tm-scout-v2-ui-modal-card{width:min(420px,calc(100vw - 28px))!important;border:1px solid rgba(86,240,151,.38)!important;border-radius:22px!important;background:linear-gradient(180deg,#102235,#08131d)!important;box-shadow:0 28px 90px rgba(0,0,0,.55)!important;color:#eef7ff!important;padding:18px!important;text-align:left!important}.tm-scout-v2-ui-modal-icon{width:42px!important;height:42px!important;border-radius:16px!important;display:grid!important;place-items:center!important;background:rgba(86,240,151,.16)!important;border:1px solid rgba(86,240,151,.35)!important;margin-bottom:10px!important}.tm-scout-v2-ui-modal-card h3{margin:0 0 8px!important;font-size:18px!important;line-height:1.1!important;color:#fff!important}.tm-scout-v2-ui-modal-card p{margin:0 0 14px!important;color:#cfe0ef!important;font-size:13px!important;line-height:1.45!important}.tm-scout-v2-ui-modal-card button{width:100%!important;border:0!important;border-radius:13px!important;background:#56f097!important;color:#06120d!important;font-weight:950!important;padding:10px 14px!important;cursor:pointer!important}.tm-scout-v2-ui-modal.is-error .tm-scout-v2-ui-modal-card{border-color:rgba(255,184,77,.45)!important}.tm-scout-v2-ui-modal.is-error .tm-scout-v2-ui-modal-icon{background:rgba(255,184,77,.16)!important;border-color:rgba(255,184,77,.38)!important}.tm-scout-v2-actions button{min-width:0!important;overflow:hidden!important;text-overflow:ellipsis!important;white-space:nowrap!important}
      @media(max-width:520px){.tm-scout-v2-actions{grid-template-columns:1fr 1fr!important}.tm-scout-v2-actions button{white-space:normal!important}}
      @media(max-width:1100px){.tm-scout-v2-body{grid-template-columns:420px minmax(0,1fr)}}
      .tm-scout-v2-html-modal{position:fixed!important;inset:18px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;background:#071018!important;border:1px solid rgba(125,166,200,.35)!important;border-radius:18px!important;box-shadow:0 30px 90px rgba(0,0,0,.55)!important;overflow:hidden!important}.tm-scout-v2-html-modal-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:10px 12px!important;background:#102235!important;color:#eef7ff!important}.tm-scout-v2-html-modal-head button{border:1px solid rgba(125,166,200,.35)!important;border-radius:9px!important;background:#0a1722!important;color:#eef7ff!important;font-weight:800!important;padding:7px 10px!important;cursor:pointer!important}.tm-scout-v2-html-modal iframe{width:100%!important;height:100%!important;border:0!important;background:#071018!important}
      @media(max-width:900px){#tmScoutMount .tm-scout-v2-panel,.tm-scout-v2-panel{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;min-height:0!important}.tm-scout-v2-shell{height:auto!important;min-height:0!important;overflow:visible!important;border-radius:18px!important}.tm-scout-v2-body{display:block!important}.tm-scout-v2-controls{max-height:none!important;overflow:visible!important;border-right:0!important;border-bottom:1px solid rgba(125,166,200,.18)!important;padding:12px!important;scroll-padding-bottom:0!important}.tm-scout-v2-output{overflow:visible!important}.tm-scout-v2-table-wrap{max-height:68vh!important;overflow:auto!important}.tm-scout-v2-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.tm-scout-v2-head{display:block;padding:15px!important}.tm-scout-v2-head-actions{margin-top:12px;justify-content:flex-start!important}.tm-scout-v2-head-lang select{min-width:0;width:100%}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){grid-template-columns:repeat(2,minmax(0,1fr))!important}.tm-scout-v2-broad-options,.tm-scout-v2-detail-options{grid-template-columns:1fr 1fr}.tm-scout-v2-actions{grid-template-columns:repeat(3,minmax(0,1fr))!important}.tm-scout-v2-panel.tm-scout-v2-running .tm-scout-v2-table-wrap{display:none!important}}
      @media(max-width:560px){.tm-scout-v2-head h2{font-size:24px!important}.tm-scout-v2-head p{font-size:12px!important;line-height:1.4!important}.tm-scout-v2-controls fieldset:not(.tm-scout-v2-checks){grid-template-columns:1fr!important}.tm-scout-v2-checks,.tm-scout-v2-broad-options,.tm-scout-v2-detail-options{grid-template-columns:1fr!important}.tm-scout-v2-stats{grid-template-columns:1fr 1fr!important;padding:10px!important}.tm-scout-v2-statusbar{padding:12px!important}.tm-scout-v2-actions{grid-template-columns:1fr 1fr!important}.tm-scout-v2-table{min-width:980px!important}.tm-scout-v2-table th,.tm-scout-v2-table td{font-size:11px!important;padding:8px!important}.tm-scout-v2-controls select[multiple],.tm-scout-v2-controls .tm-scout-v2-multi-select{min-height:180px!important;max-height:260px!important}}    `;
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
    if (!mv || mv.absGrowth === null || mv.absGrowth === undefined) return mv && mv.unknown ? 'unknown' : '—';
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


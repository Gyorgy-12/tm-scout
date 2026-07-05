# TM Scout V2 GitHub Pages projekt

Ez a csomag a Tampermonkey userscriptből kiszedett, GitHub Pagesen futtatható frontend változat.

## Miért kell Worker?

A GitHub Pages statikus oldal. A Transfermarkt oldalait böngészőből közvetlenül általában blokkolja a CORS, ezért a projekt mellé adtam egy Cloudflare Worker proxyt:

- `worker/tm-proxy-worker.js`

## Telepítés

1. Hozz létre egy GitHub repót.
2. Másold fel a projekt gyökerébe ezeket:
   - `index.html`
   - `assets/site.css`
   - `assets/tm-scout-v2-app.js`
   - `.nojekyll`
3. GitHub repo → Settings → Pages → Deploy from branch → `main` / root.
4. Cloudflare Workersben hozz létre egy új Workert, és másold bele a `worker/tm-proxy-worker.js` tartalmát.
5. Nyisd meg a GitHub Pages oldalt, majd felül illeszd be a Worker URL-t, például:
   - `https://tm-proxy.valami.workers.dev`
6. Mentés után mehet a keresés.

## Megjegyzés

Ez nem Tampermonkey-scriptként fut, hanem külön HTML appként. A korábbi GM storage hívások localStorage shimre vannak rakva, a `GM_xmlhttpRequest` pedig Worker proxyn keresztül fetch-el.


## U21 prospect mód

Az appban a **Scout mód** mezőnél választható az `U21 prospect` mód. Ebben nem a lejáró szerződés és nem az MV-drop a fő szűrő, hanem:

- liga-szint score,
- játszott meccsarány,
- akadémia / klubkörnyezet score,
- opcionális nemzetiség multiple choice,
- U21 életkor- és market value-sáv.

A végeredmény U21 score szerint rendeződik. A két mód menüje szét van választva: U21 módban nem látszanak a contract/MV-drop/Játékidő+szezonok szűrők, contract módban pedig nem látszik az U21 prospect blokk. A Transfermarkt oldalak olvasásához továbbra is kell a Cloudflare Worker proxy.


## U21 / Contract menü javítás

Ebben a buildben a módváltás már nem csak `hidden` attribútumot állít, hanem `display:none!important`-et is. Ez javítja azt, hogy U21 módban a contract/MV-drop blokkok ne látszódjanak, contract módban pedig az U21 blokk ne látszódjon. Az `index.html` cache-bust query stringgel tölti a friss JS-t.


## U21 nemzetiség-választó és gombsor javítás

Ebben a buildben a nemzetiség-listában egy sima kattintás ki/be kapcsolja az adott országot, nem kell Ctrl-kattintás. A keresés/export/cache gombsor már nem lebeg sticky elemként a szűrők felett, hanem a bal oldali űrlap alján marad a normál folyamban.

## Többnyelvű felület

A felület három nyelven váltható:

- magyar,
- English,
- română.

A nyelvválasztó fent, a proxy mezőnél és az appon belül is elérhető. A választás localStorage-ban marad, ezért újratöltés után is megmarad.


## Frissítés

- A lebegő TM Scout V2 indítógomb ki lett véve GitHub Pages módban.
- A nyelvválasztó a megnyitott app jobb felső sarkába került.


## 2026-07-05

Removed the extra source links textarea from the public UI.

## Frissítés: szerződés lejárati év

A lejáró szerződés / free agent módban külön választható a szerződés lejárati éve.
A source URL-ek kizárólag a kiválasztott évvel épülnek, így a Transfermarkt alapértelmezett 2027-es nézete nem keveredik bele a 2026-os keresésbe.

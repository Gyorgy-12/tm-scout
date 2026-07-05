# TM Scout V2

TM Scout V2 is a GitHub Pages frontend for scouting Transfermarkt players through two separate modes:

- **Contract / free agent scout**: finds players with contracts ending in a selected year, plus current free agents.
- **U21 prospect scout**: ranks younger players by league level, match involvement, academy/club environment, age and market-value context.

The app was originally built from a Tampermonkey userscript, but this version is structured as a normal version-controlled GitHub project.

## Why a Cloudflare Worker is required

GitHub Pages is a static frontend. Browser requests from GitHub Pages to Transfermarkt are usually blocked by CORS, so the frontend uses a small Cloudflare Worker proxy:

```txt
worker/tm-proxy-worker.js
```

The frontend sends Transfermarkt URLs to the Worker. The Worker fetches the HTML and returns it to the app.

## Project structure

```txt
index.html
assets/
  site.css
  tm-scout-v2-app.js
worker/
  tm-proxy-worker.js
wrangler.toml
package.json
.nojekyll
README.md
DEV-STEPS.md
```

## Frontend deployment with GitHub Pages

1. Create a GitHub repository, for example `tm-scout-v2`.
2. Clone it locally.
3. Copy the project files into the repository root.
4. Commit and push:

```bat
git add .
git commit -m "Initial TM Scout V2 app"
git push
```

5. In GitHub, open:

```txt
Settings -> Pages
```

6. Set:

```txt
Source: Deploy from a branch
Branch: main
Folder: /root
```

7. Open the GitHub Pages URL after deployment finishes.

## Worker deployment with Wrangler

Install dependencies and deploy the Worker:

```bat
npm install
npx wrangler login
npx wrangler deploy
```

The Worker name is configured in `wrangler.toml`:

```txt
name = "tm-scout-v2-proxy"
main = "worker/tm-proxy-worker.js"
```

After deployment, use the Worker URL in the frontend proxy field, for example:

```txt
https://tm-scout-v2-proxy.wc26-guesses.workers.dev
```

## Contract / free agent mode

This mode searches Transfermarkt contract-ending and free-agent sources.

Main filters include:

- contract expiry year, such as 2026 or 2027;
- market-value range;
- age range;
- market-value reference date;
- maximum market-value drop percentage;
- minimum minutes or appearances per season;
- broad or detailed position filters;
- first-tier and selected lower-league source coverage;
- current free agents.

The contract expiry year is applied directly to the generated Transfermarkt source URLs, so the app does not accidentally fall back to Transfermarkt's default year view.

## U21 prospect mode

This mode is separated from the contract/free-agent filters. It focuses on prospect context rather than contract expiry.

The U21 ranking uses:

- league-level score;
- match involvement ratio;
- academy or club-environment score;
- age context;
- market-value context;
- optional nationality multiple-choice filtering.

The U21 interface hides the contract-specific filters, and contract mode hides the U21-specific block.

## Localization

The interface supports three languages:

- Hungarian;
- English;
- Romanian.

The language selector is placed in the top-right area of the opened app. The selected language is saved in `localStorage`.

## Current UI behavior

- The old floating `TM Scout V2` launcher button is removed in the GitHub Pages build.
- The app opens directly.
- The extra source-link textarea is removed from the public UI.
- The nationality multiple-select supports normal click-to-toggle selection, so Ctrl-click is not required.
- The search/export/cache button row stays in the normal form flow and does not float above the fields.

## Development workflow

For normal frontend changes:

```bat
git status
git add .
git commit -m "Describe the change"
git push
```

For Worker changes:

```bat
npx wrangler deploy
```

More detailed local workflow notes are in `DEV-STEPS.md`.

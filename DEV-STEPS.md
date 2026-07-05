# TM Scout V2 - version-controlled workflow

## First setup in CMD

```bat
cd C:\Users\Asus\Desktop\GPT Generated HTMLs\WebProjects
git clone https://github.com/<GITHUB_USER>/tm-scout-v2.git
cd tm-scout-v2
```

Copy these project files into the cloned folder, then:

```bat
git add .
git commit -m "Initial TM Scout V2 GitHub Pages app"
git push
```

## Local change workflow

```bat
git status
git add .
git commit -m "Describe what changed"
git push
```

## Cloudflare Worker deploy from repo

```bat
npm install
npx wrangler login
npx wrangler deploy
```

The Worker URL should be used in the frontend proxy field, for example:

```txt
https://tm-scout-v2-proxy.wc26-guesses.workers.dev
```

## GitHub Pages

Repository Settings -> Pages:

- Source: Deploy from branch
- Branch: main
- Folder: /root


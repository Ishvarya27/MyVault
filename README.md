# MyVault — Personal Finance Ledger

A local-first personal finance tracker: log salary, investments (FD/RD/stocks/gold),
daily expenses, and savings goals — with charts, insights, and annual reminders
(ITR, TDS, etc). Installable as a PWA on Android/iOS.

## Project structure

```
myvault/
├── index.html          # markup only
├── css/
│   └── styles.css       # all styling
├── js/
│   ├── db.js             # persistence layer (IndexedDB)
│   └── app.js             # state, calculations, charts, rendering, events
└── README.md
```

The app logic itself was not changed — this is the same code as the original
single-file build, split into files by concern (markup / styles / storage / app logic)
so it reads and maintains like a normal front-end project.

## Data & persistence

MyVault stores everything in **IndexedDB**, a database built into the browser —
there is no backend, no server, and no network request involved in saving data.

- All reads/writes go through `js/db.js`, which owns four object stores:
  `months`, `goals`, `holdings`, and `meta` (used for reminders/settings).
- Data is written to disk by the browser itself, so it survives page reloads,
  closing the tab, and even fully quitting the browser or app.
- Data is only lost if the user clears this site's browser data, or taps
  **"Erase all data"** in Settings.
- Because storage is per-browser/per-device, use **Settings → Export backup**
  to download a `.json` snapshot, and **Import backup** to restore it (e.g. on
  a new device, or after clearing browser data).

## Running it

No build step or server required — it's a static site.

- **Quickest:** open `index.html` directly in a browser.
- **Recommended** (some browsers restrict IndexedDB on `file://` URLs), serve it locally:
  ```bash
  cd myvault
  python3 -m http.server 8000
  # then open http://localhost:8000
  ```
- Any static host works too (GitHub Pages, Netlify, Vercel, etc.) — just deploy
  the folder as-is.

## Installing as an app

- **Android (Chrome):** ⋮ menu → "Add to Home screen"
- **iOS (Safari):** Share icon → "Add to Home Screen"

The app then opens full-screen like a native app, with all previously saved data intact.

## Tech

Vanilla HTML/CSS/JS — no frameworks, no build tools, no external chart library
(charts are hand-drawn inline SVG so they never depend on a CDN being reachable).

# CLAUDE.md — qada-tracker

Offline-first PWA (Arabic, RTL) for tracking make-up (qada) prayers. Plain HTML/CSS/vanilla JS — **no frameworks, no dependencies, no build step**. Deployed via GitHub Pages; users install it with "Add to Home Screen".

## Architecture

| File | Role |
|---|---|
| `index.html` | Single page holding all 3 views: `#view-setup`, `#view-main`, `#view-settings` (toggled via `hidden`), plus the bulk-add `<dialog>`, toast, update banner, and install hint |
| `js/app.js` | All logic: state, calculation, rendering, backup, SW registration |
| `css/style.css` | Mobile-first RTL styles; light + dark via `prefers-color-scheme`; per-prayer accent colors via `--p-color` custom property |
| `sw.js` | Cache-first service worker + update notification |
| `manifest.json` | PWA manifest (ar, rtl, standalone) |

## State model — the critical invariant

Single object in `localStorage` under key `qada-state-v1`:

```js
{ version: 1, calendar: "hijri"|"gregorian",
  totals: {fajr, dhuhr, asr, maghrib, isha},
  done:   {fajr, dhuhr, asr, maghrib, isha}, updatedAt }
```

- **Every mutation must go through `update(fn)` in app.js** — it runs the mutator, then `sanitize()` (clamps `0 ≤ done[i] ≤ totals[i]`, coerces ints via `toSafeInt`), then `persist()`, then `renderMain()`. Never write to `state` or `localStorage` directly elsewhere.
- Corrupt stored JSON is preserved under a `backup-corrupt-<ts>` key, never silently deleted.
- User progress (`done`) must survive every feature: recalculation, editing totals, imports. Losing progress is the one unforgivable bug here.

## Release process (required on every deployed change)

1. Bump `CACHE_NAME` in `sw.js` (`qada-v3` → `qada-v4` → …) — without this, offline users never get the update.
2. Set `UPDATE_NOTE` in `sw.js` to a short Arabic description of what changed — it is shown to users in the in-app update banner (new SW posts `{type:"UPDATE_READY", note}` to open pages on activate; app.js shows `#update-banner` only when the page already had a controller, so first installs don't see it).
3. Commit and push to `main` — GitHub Pages redeploys automatically.

## Conventions

- UI text is Arabic; numbers displayed with `Intl.NumberFormat("ar-EG")` via the `num()` helper. Mind Arabic pluralization (يوم واحد / يومين / أيام / يومًا).
- Prayer order and ids come from the `PRAYERS` array (`fajr, dhuhr, asr, maghrib, isha`) — iterate it, never hardcode the five.
- DOM access via the `$(id)` helper; cards' element refs cached in `cardEls`.
- Keep it dependency-free and small (~45 KB total). No build tooling.
- Calculation: `totalDays = years*(354|365) + months*30 + days`; each prayer owes `totalDays`.

## Testing (no test framework)

- Syntax: `node --check js/app.js`
- Manual/E2E: serve statically (`python -m http.server 8734`) and drive with headless Chrome. Pattern used: a throwaway `test-*.html` in the project root that loads `index.html` in an iframe, seeds `localStorage`, clicks buttons, writes PASS/FAIL into a `#out` div, read via `chrome --headless=new --dump-dom`. Delete test files afterwards.
- Headless screenshot note: screenshots of RTL root documents come out shifted (Chromium quirk); screenshot through an LTR wrapper page with an iframe to judge layout.

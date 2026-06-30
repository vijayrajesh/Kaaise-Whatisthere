# What's There?

An installable web app (PWA) that turns your phone into a **pointing radar**: hold it flat,
aim it in any direction, and it reveals the notable places — cities, towns, mountains, lakes,
forts, beaches, national parks, airports — sitting in front of you, up to 100 km away.

<p align="center">
  <img src="screenshot.png" alt="Kaaise — notable places in the direction you're pointing, with a scanning beam on a rotating compass map" width="320">
</p>

> This is a **different app** from Kotsethe (the `which-direction/` sub-app). Kotsethe guides
> you to **one place you searched for**; *What's There?* surfaces **many notable places**
> around you as you sweep your phone. They share no code.

## Install on your phone

What's There? is a PWA (`manifest.json` + `sw.js`):

- **Android / Chromium**: open it in the browser and use the menu's **Install app** / **Add to
  Home screen**; it then launches full-screen.
- **iPhone / Safari**: tap **Share → Add to Home Screen**.
- Once installed the app shell works offline (the map still needs network for tiles, and
  fresh places need network for Wikidata — but recently scanned areas are cached).

## What it does

1. On **Start Exploring** (one tap, needed for iOS motion permission) it reads your location
   (`navigator.geolocation.watchPosition`) and the direction the phone is pointing
   (`DeviceOrientation`).
2. Pulls **curated, notable places** near you from the **Wikidata Query Service** (SPARQL
   `wikibase:around`), scanning in two expanding rings (**40 km**, then **100 km**) so nearby
   places appear fast and far ones fill in. Results are ranked by a **significance score**
   (distance ÷ notability weight), not raw distance.
3. Draws a **field-of-view beam** on the map — a straight, constant-width corridor pointing
   exactly where you face (100 km long, **8 km wide** by default). Places inside the beam are
   the ones "in front of you".
4. Lists those places in a panel, closest/most-notable first, revealing new ones with a smooth
   cascade as they enter your beam. Each row shows a live **direction badge** — `◀` left /
   `▶` right / `▲` ahead with the angle off your heading (e.g. `▶ 5°`), turning **green when the
   place is within ~10° of straight ahead** — so you can see which one you're pointing most
   directly at. Tap a place to highlight it on the map. If the phone has **no compass**, it
   falls back to listing **all nearby places** (distance-ranked) with a "no compass" notice.
5. A **compass needle** in the header tracks your heading, and the **map rotates heading-up**
   (via leaflet-rotate) so "up" is always where you're pointing.
6. Extras: a **recenter** button (snaps back to your location), a **Settings** panel to change
   the **beam width** (2–40 km) and **rescan** an area ignoring the cache, a **Debug**
   panel showing live sensor values (with Copy), and an **About** dialog (the ⓘ in the header).

### Example

You're standing in a city and slowly sweep your phone toward the **north-east**. The beam on
the map swings to the north-east; the list repopulates with the notable towns and a mountain
that fall inside that corridor within 100 km, closest/most-notable first. Turn toward the
**west** and the list smoothly swaps to what's that way instead.

## How the direction sensing works

- The compass comes from `DeviceOrientation` (`deviceorientationabsolute` where available,
  falling back to `deviceorientation`; iOS uses `webkitCompassHeading`).
- The heading is the compass direction of the **top edge of the phone held flat** (screen up),
  projected onto the ground from `alpha`/`beta` (`getCompassHeading` in `app.js`). Hold the
  phone like a radar you look down at and sweep it around.
- The map is rotated heading-up with `map.setBearing((360 - heading))`, and the FOV beam is
  rebuilt each heading change from your position, the heading, and the beam half-width.
- A place counts as "in front of you" when its forward distance along the heading is positive
  and its sideways offset is within the beam's half-width (`isWithinBeam`).
- iOS needs a user gesture to grant motion access, so sensors start from the **Start
  Exploring** overlay.

## Places cache

To avoid hammering Wikidata on every reload, scanned places are cached in `localStorage`,
keyed to a **~11 km grid** with a **7-day TTL**. It stores a slim record per place (id, name,
type, lat/lon, and ranking fields like weight/population); distance, bearing and score are
recomputed for your exact position on load (so it stays accurate anywhere in the cell, and
works offline for areas you've already explored).
**Rescan** in Settings bypasses the cache for the current area.

## Files

- `index.html` — markup, CDN includes (Leaflet + leaflet-rotate + Outfit font), PWA tags.
- `app.js` — sensors, Wikidata scanning + cache, FOV beam, list UI, map, settings, debug,
  and service-worker registration.
- `index.css` — dark UI: header/compass, resizable list/map split, panels, beam styling.
- `manifest.json` — PWA metadata (name, icons, theme, standalone display).
- `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon-180.png` — app icons
  (a blue discovery-radar; the PNGs are rasterised from `icon.svg`).
- `sw.js` — service worker: caches the app shell, network-first so updates apply on reload.
- `version.json` — *optional* "new version available" banner for already-open clients. Code
  freshness itself is automatic: `index.html` appends `?v=<timestamp>` to `app.js`/`index.css`,
  so a fresh upload is always picked up. Edit the number only to nudge open clients to reload.
- `.htaccess` — Apache/Hostinger cache headers (never-cache the HTML shell + control files).
- `.gitignore` — excludes logs, archives, `.env*`, `node_modules/`, and OS files.
- `DATA_SOURCES.md` — comparison of place-data providers and why Wikidata is the current pick.

## Data source

Currently **Wikidata Query Service** — free, no key, notable-only (no hamlet noise), with
population/notability for ranking and a CC0 license. See **`DATA_SOURCES.md`** for the full
comparison (GeoNames, Overpass, Geoapify, Google Places, …) and when to switch.

## Running it

It's a plain static site with **no build step** — just serve the files. Geolocation and
Device Orientation require a **secure context**, so it must be served over **HTTPS** (any
static host works; `localhost` also counts as secure for desktop testing). Open the HTTPS URL
on your phone and tap **Start Exploring**.

## Tech stack

Vanilla HTML/CSS/JS · Leaflet.js + leaflet-rotate (rotating map) · Wikidata Query Service
(places) · OpenStreetMap tiles · Service Worker + Web Manifest (installable PWA).

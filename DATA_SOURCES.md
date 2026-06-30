# Places Data Source Options — "What's There?"

Reference for choosing the data source that answers the app's one core question:
**"Give me named places (with coordinates + type) near a point."**

> Pricing/limits change often — figures are approximate (as of 2026). Always verify on the provider's current pricing page.

---

## TL;DR recommendation

| Situation | Use |
|---|---|
| **Now / hobby / no hosting** | **Wikidata Query Service** (current) — free, no key, reliable, notable places |
| **Want complete town coverage + population ranking** | **GeoNames** (`cities1000`, ~30 MB, self-host or API) |
| **Need rich POIs / business data (restaurants, hours, photos)** | **Foursquare** or **Google Places** (paid) |
| **Production, OSM-based, generous free tier** | **Geoapify** Places API |
| **Maximum flexibility / dev** | **Overpass** (self-hosted for production) |

---

## Free / Open options

### 1. Wikidata Query Service (SPARQL) — *currently used*
- **Data:** Wikidata — *notable* places worldwide (everything has an encyclopedia-grade entry).
- **Query:** `wikibase:around` SPARQL — places of given types within a radius.
- **Features:** structured types (city/town/mountain/lake/fort…), multilingual labels, **population (P1082)**, images, descriptions, cross-links (QID → Wikipedia/Commons).
- **Free tier:** Free, **no key, no signup**. Hosted by Wikimedia.
- **Limits:** ~60 s query timeout, shared endpoint, ~1 concurrent query, throttles under heavy load.
- **License:** **CC0** (public domain).
- **Self-host:** Possible (Blazegraph/QLever + Wikidata dump ~100+ GB TTL) — heavy; rarely needed.
- **Best for:** Notable, recognizable places with zero hosting. ✅ Reliable.
- **Weak at:** Completeness of *small* towns/villages; no geometry/shapes.

### 2. OpenStreetMap + Overpass API (public)
- **Data:** Full OSM — *any* feature/tag, including geometry.
- **Query:** Overpass QL — arbitrary filters, areas, relations.
- **Features:** Most flexible; every tag queryable; area shapes.
- **Free tier:** Free, no key.
- **Limits:** **Strict fair-use** (~2 slots/IP), frequent **429/504**, **not for production**.
- **License:** **ODbL** (attribution + share-alike on derived databases).
- **Self-host:** **150–600 GB** (planet, with/without metadata); region far smaller.
- **Best for:** Flexible queries, prototyping. ❌ Unreliable on public servers.

### 3. GeoNames
- **Data:** Gazetteer — populated places + natural/man-made features.
- **Query:** REST endpoints (`findNearbyPlaceName`, `cities` bbox, `findNearby`, `findNearbyWikipedia`).
- **Features:** **Population**, admin hierarchy (country→state→district), alternate/multilingual names, timezone, elevation, feature codes.
- **Free tier:** Free with a **username** (1-min signup). ~20,000 credits/day, ~1,000/hour per app.
- **License:** **CC BY 4.0** (attribution required).
- **Self-host (dumps):** `cities1000` ~**30 MB** · `cities500` ~45 MB · country (e.g. `IN.txt`) ~100–150 MB · `allCountries` ~**1.6 GB** (→ ~2–3 GB in an indexed DB).
- **Best for:** Complete **settlement** coverage + population ranking; cheap to self-host (even client-side/SQLite).
- **Weak at:** Curated landmarks, geometry, rich metadata; population often missing/zero.

### 4. Nominatim (OSM)
- **Purpose:** Geocoding / search (name→coords, reverse, search).
- **Free tier:** Public server fair-use (≤1 req/s, no heavy use).
- **License:** ODbL.
- **Self-host:** PostgreSQL/PostGIS + OSM import — country ~tens of GB, planet ~1 TB+.
- **Best for:** Address geocoding/search. Not ideal for "nearby POIs by type."

### 5. Photon (OSM, by Komoot)
- **Purpose:** Open-source geocoder (Elasticsearch), great **autocomplete**.
- **Free:** Public demo (fair-use); self-host for production.
- **License:** ODbL.
- **Best for:** Search-as-you-type.

### 6. Pelias (open geocoder)
- **Purpose:** Multi-source open geocoder (OSM + OpenAddresses + Who's On First + GeoNames).
- **Free:** Self-host; or hosted via **Stadia Maps** (paid tiers).
- **Best for:** Full geocoding stack you control.

### 7. Wikipedia GeoSearch API
- **Data:** Wikipedia articles near a point.
- **Free:** No key (Wikimedia).
- **Limits:** **radius max 10 km**, ≤500 results.
- **Best for:** Notable articles in a small radius. Too short-range for 100 km.

### 8. Natural Earth
- **Data:** Public-domain vector data — countries + major populated places (coarse).
- **Free:** Public domain; bundle it (static).
- **Best for:** Coarse offline major-place labels.

---

## Paid / Managed Places APIs (most have free tiers)

### Geoapify Places
- **Data:** OSM-based. **Places near point by category**, geocoding, routing, maps.
- **Free:** ~**3,000 credits/day**.
- **Paid:** Tiered (~€49+/mo) / pay-as-you-go.
- **License:** OSM attribution.
- **Best for:** Drop-in "places near point" with a real free tier + SLA.

### Foursquare Places
- **Data:** Rich **POI / business** data — categories, photos, ratings, hours.
- **Free:** Limited free calls/month.
- **Paid:** Usage-based.
- **Best for:** Business/venue discovery (restaurants, shops…).

### Google Places API
- **Data:** Best-in-class POI/business coverage, photos, reviews, autocomplete.
- **Free:** Per-SKU monthly free caps (changed from the old $200 credit in 2025).
- **Paid:** Pay-per-use; **expensive at scale**; requires billing account.
- **Best for:** Production business/POI. ❗ Cost + lock-in.

### Mapbox (Geocoding / Search Box / Tilequery)
- **Data:** OSM + own. **Tilequery** = features near a point from vector tiles.
- **Free:** ~50k–100k req/mo (varies by API).
- **Paid:** Pay-as-you-go.
- **Best for:** If you also use Mapbox maps. (Note v2 GL JS license ties you to Mapbox tiles.)

### HERE Geocoding & Search
- **Data:** HERE proprietary. "Discover"/"Browse" = POIs near point by category.
- **Free:** ~1,000 req/day (Base).
- **Best for:** Enterprise / automotive.

### TomTom Search API
- **Data:** TomTom proprietary. POI search + geocoding.
- **Free:** ~2,500 req/day.
- **Best for:** Automotive / POI.

### LocationIQ
- **Data:** OSM-based geocoding + nearby.
- **Free:** ~5,000 req/day.
- **Paid:** Cheap tiers.
- **Best for:** Budget OSM geocoding.

### OpenCage
- **Data:** Aggregated (OSM + others) **geocoding**.
- **Free:** ~2,500 req/day.
- **Best for:** Geocoding (not POI-by-type).

### Radar.io
- **Data:** Geocoding + Places + geofencing.
- **Free:** Generous free tier.
- **Best for:** Mobile apps / geofencing.

### Esri ArcGIS Location Platform
- **Data:** Esri World Geocoding + Places.
- **Free:** Free tier (credits) via ArcGIS Location Platform.
- **Best for:** Enterprise / GIS.

### Amazon Location Service
- **Data:** Esri / HERE / Grab / OpenData behind one API.
- **Free:** AWS free tier; pay-per-use after.
- **Best for:** AWS-based stacks.

---

## Self-hosting size cheat-sheet

| Source | Download | In a DB (indexed) | Notes |
|---|---|---|---|
| GeoNames `cities1000` | ~10 MB | tens of MB | Settlements only; could run in SQLite/browser |
| GeoNames country (`IN`) | ~30–50 MB | ~150 MB | One country |
| GeoNames `allCountries` | ~380 MB | ~2–3 GB | Everything (points only) |
| Overpass region | small | tens of GB | Country-sized OSM |
| Overpass planet | ~80 GB pbf | **150–600 GB** | Full OSM, with/without metadata |
| Nominatim planet | — | ~1 TB+ | Geocoding DB |
| Wikidata dump | ~100+ GB | heavy | Blazegraph/QLever |

**Why GeoNames is tiny:** it stores *points* (name/lat/lon/class/population), **no geometry** — orders of magnitude smaller than OSM.

---

## Feature comparison (for *this* app)

| | Wikidata | Overpass | GeoNames | Geoapify | Google Places |
|---|---|---|---|---|---|
| Find places near point | ✅ | ✅ | ✅ | ✅ | ✅ |
| No key / no signup | ✅ | ✅ | ❌ (username) | ❌ | ❌ |
| Reliability | ✅✅ | ❌ | ✅ | ✅ | ✅✅ |
| Notable-only (no hamlet noise) | ✅ | ❌ | ❌ | partial | n/a |
| Population for ranking | ✅ | ❌ | ✅✅ | ❌ | ❌ |
| Rich POIs / business data | ❌ | partial | ❌ | ✅ | ✅✅ |
| Area shapes / geometry | ❌ | ✅ | ❌ | ✅ | ❌ |
| Self-host size | heavy | huge | **tiny** | n/a | n/a |
| Cost at scale | free | free* | free* | free→paid | $$$ |
| License | CC0 | ODbL | CC BY | ODbL | proprietary |

\* free but you run/maintain the server.

---

## Recommendation for "What's There?"

1. **Now:** stay on **Wikidata** — reliable, free, no hosting, notable places. ✅ (current)
2. **If small towns feel missing:** add **GeoNames `cities1000`** as a settlement layer (~30 MB, self-host or API) for completeness + population ranking.
3. **If it grows big / commercial:** move to **Geoapify** (OSM, SLA, free tier) or self-host **Overpass/GeoNames**; reserve **Google/Foursquare** for when you need true business/POI data.

Across all of them, keep the **client-side cache** (grid-snap + `localStorage`) — it cuts calls dramatically regardless of source.

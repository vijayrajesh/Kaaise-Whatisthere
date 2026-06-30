const startBtn = document.getElementById('start-btn');
const recenterBtn = document.getElementById('recenter-btn');
const overlay = document.getElementById('start-overlay');
const headingText = document.getElementById('heading-text');
const placesList = document.getElementById('places-list');
const loadingText = document.getElementById('loading-text');

// The beam is a straight, constant-width rectangle pointing where you face.
const FOV_RANGE_KM = 100;            // How far the beam extends in front of you
const DEFAULT_BEAM_WIDTH_KM = 8;     // Default total width; user-adjustable in settings
const BEAM_WIDTH_MIN_KM = 2;
const BEAM_WIDTH_MAX_KM = 40;

// Half-width actually used by the geometry. Loaded from localStorage if present.
let FOV_HALF_WIDTH_KM = (() => {
    const saved = parseFloat(localStorage.getItem('beamWidthKm'));
    const total = (!isNaN(saved) && saved >= BEAM_WIDTH_MIN_KM && saved <= BEAM_WIDTH_MAX_KM)
        ? saved
        : DEFAULT_BEAM_WIDTH_KM;
    return total / 2;
})();

let map;
let userMarker;
let fovBeam = null; // Leaflet polygon for the FOV beam (corridor)
let selectedMarker = null; // single marker for the place tapped in the list
let userLat = null;
let userLon = null;
let currentHeading = null;
let allPlaces = [];
let lastRenderedIndices = "";
let currentScanStatus = "";
let absoluteFired = false;
let lastFetchError = ""; // why the last Wikidata fetch failed, for the status/debug
let selectedPlaceId = null; // place currently tapped in the list

// Debug info captured from the live sensors for the on-screen debug panel
const debug = {
    rawHeading: null,
    source: '-',
    orientEvents: 0,
    alpha: null, beta: null, gamma: null,
    accuracy: null,
    gpsTime: null,
    totalPlaces: 0,
    visibleCount: 0
};

// PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            registrations.forEach(r => r.unregister());
        });
        navigator.serviceWorker.register(`./sw.js?v=${new Date().getTime()}`).catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// --- Version check: notify when a newer build has been deployed ---
// Bump the "version" field in version.json on each deploy. The value seen at
// page-load is remembered; if a later poll sees a different value, we show the
// update banner. Only version.json needs changing on deploy.
let loadedVersion = null;
const updateBanner = document.getElementById('update-banner');

async function fetchVersion() {
    try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        return data.version;
    } catch (e) {
        return null; // offline or missing — ignore
    }
}

async function checkForUpdate() {
    const v = await fetchVersion();
    if (v === null) return;
    if (loadedVersion === null) {
        loadedVersion = v; // first read: remember what we're running
    } else if (v !== loadedVersion) {
        updateBanner.classList.remove('hidden'); // a new build is live
    }
}

updateBanner.addEventListener('click', async () => {
    updateBanner.textContent = 'Updating…';
    // Drop caches + service workers so the reload pulls the fresh build
    try {
        if ('caches' in window) {
            const keys = await caches.keys();
            await Promise.all(keys.map(k => caches.delete(k)));
        }
        if ('serviceWorker' in navigator) {
            const regs = await navigator.serviceWorker.getRegistrations();
            await Promise.all(regs.map(r => r.unregister()));
        }
    } catch (e) { /* best effort */ }
    location.reload();
});

// Check on load, when the tab regains focus, and every 5 minutes.
checkForUpdate();
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
});
setInterval(checkForUpdate, 5 * 60 * 1000);

// Event Listeners
startBtn.addEventListener('click', async () => {
    try {
        // Request Device Orientation for iOS 13+
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permission = await DeviceOrientationEvent.requestPermission();
            if (permission === 'granted') {
                startSensors();
            } else {
                alert("Permission to access device orientation was denied.");
            }
        } else {
            // Non-iOS 13+ devices
            startSensors();
        }
    } catch (e) {
        console.error(e);
        startSensors(); // Try starting anyway
    }
});

// Recenter the map on the user's current position
recenterBtn.addEventListener('click', () => {
    if (userLat === null || !map) return;
    map.flyTo([userLat, userLon], 10, { duration: 0.6 });
});

// Tap a place in the list to focus it on the map (event delegation)
const selectedBanner = document.getElementById('selected-banner');
placesList.addEventListener('click', (e) => {
    const item = e.target.closest('.place-item');
    if (!item) return;
    const id = item.getAttribute('data-id');
    const place = allPlaces.find(p => String(p.id) === id);
    if (place) selectPlace(place);
});

// --- Settings panel (beam width) ---
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsClose = document.getElementById('settings-close');
const beamWidthRange = document.getElementById('beam-width-range');
const beamWidthValue = document.getElementById('beam-width-value');

// Initialise the slider from the stored/derived width
beamWidthRange.value = String(Math.round(FOV_HALF_WIDTH_KM * 2));
beamWidthValue.textContent = beamWidthRange.value;

function applyBeamWidth(totalKm) {
    FOV_HALF_WIDTH_KM = totalKm / 2;
    beamWidthValue.textContent = String(totalKm);
    localStorage.setItem('beamWidthKm', String(totalKm));

    // Redraw the rectangle and force the list/markers to re-filter immediately
    if (currentHeading !== null) updateFovBeam(currentHeading);
    lastRenderedIndices = '';
    updateUI();
}

beamWidthRange.addEventListener('input', () => applyBeamWidth(parseInt(beamWidthRange.value, 10)));

settingsBtn.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
settingsClose.addEventListener('click', () => settingsPanel.classList.add('hidden'));

// --- About dialog ---
const aboutBtn = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');
const aboutClose = document.getElementById('about-close');
if (aboutBtn && aboutModal) {
    const openAbout = () => aboutModal.classList.remove('hidden');
    const closeAbout = () => aboutModal.classList.add('hidden');
    aboutBtn.addEventListener('click', openAbout);
    if (aboutClose) aboutClose.addEventListener('click', closeAbout);
    aboutModal.addEventListener('click', event => { if (event.target === aboutModal) closeAbout(); });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !aboutModal.classList.contains('hidden')) closeAbout();
    });
}

// Force a fresh scan: drop this cell's cache and re-query Wikidata
document.getElementById('rescan-btn').addEventListener('click', () => {
    if (userLat === null) return;
    try { localStorage.removeItem(cacheKey(userLat, userLon)); } catch {}
    settingsPanel.classList.add('hidden');
    allPlaces = [];
    lastRenderedIndices = "";
    scanProgressively(userLat, userLon);
});

// --- Debug panel ---
const debugBtn = document.getElementById('debug-btn');
const debugPanel = document.getElementById('debug-panel');
const debugContent = document.getElementById('debug-content');
const debugCopy = document.getElementById('debug-copy');
const debugClose = document.getElementById('debug-close');

function buildDebugText() {
    const f = (n, d = 5) => (n === null || n === undefined || isNaN(n)) ? '-' : Number(n).toFixed(d);
    const heading = currentHeading === null ? null : ((currentHeading % 360) + 360) % 360;
    return [
        `Heading (smoothed): ${f(heading, 1)}°  (${heading === null ? '-' : getCardinalDirection(heading)})`,
        `Heading (raw):      ${f(debug.rawHeading, 1)}°`,
        `Sensor source:      ${debug.source}`,
        `Orientation events: ${debug.orientEvents}`,
        `alpha/beta/gamma:   ${f(debug.alpha, 1)} / ${f(debug.beta, 1)} / ${f(debug.gamma, 1)}`,
        ``,
        `Lat / Lon:          ${f(userLat)} , ${f(userLon)}`,
        `GPS accuracy:       ${debug.accuracy === null ? '-' : f(debug.accuracy, 0) + ' m'}`,
        `GPS fix time:       ${debug.gpsTime ? new Date(debug.gpsTime).toLocaleTimeString() : '-'}`,
        ``,
        `Beam: ${FOV_HALF_WIDTH_KM * 2}km wide × ${FOV_RANGE_KM}km`,
        `Places fetched:     ${debug.totalPlaces}`,
        `Places in beam:     ${debug.visibleCount}`,
        `Last fetch error:   ${lastFetchError || 'none'}`
    ].join('\n');
}

function renderDebug() {
    if (debugPanel.classList.contains('hidden')) return;
    debugContent.textContent = buildDebugText();
}

debugBtn.addEventListener('click', () => {
    debugPanel.classList.toggle('hidden');
    renderDebug();
});

debugClose.addEventListener('click', () => debugPanel.classList.add('hidden'));

debugCopy.addEventListener('click', async () => {
    const text = buildDebugText();
    try {
        await navigator.clipboard.writeText(text);
        debugCopy.textContent = 'Copied!';
        setTimeout(() => { debugCopy.textContent = 'Copy'; }, 1200);
    } catch (e) {
        // Fallback for non-secure contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        debugCopy.textContent = 'Copied!';
        setTimeout(() => { debugCopy.textContent = 'Copy'; }, 1200);
    }
});

// --- Draggable resizer between the places list and the map ---
const resizer = document.getElementById('resizer');
const listContainer = document.getElementById('list-container');
const mainContent = document.getElementById('main-content');
const MAP_MIN_PX = 80;   // keep at least this much map visible
const LIST_MIN_PX = 120; // keep at least this much list visible

function resizeTo(pointerY) {
    const bounds = mainContent.getBoundingClientRect();
    const resizerH = resizer.offsetHeight;
    let newListH = pointerY - bounds.top;

    const maxListH = bounds.height - resizerH - MAP_MIN_PX;
    newListH = Math.max(LIST_MIN_PX, Math.min(newListH, maxListH));

    listContainer.style.height = `${newListH}px`;

    // Resize the oversized map square + let Leaflet recompute its size
    fitMapContainer();
}

resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.classList.add('dragging');
    resizer.setPointerCapture(e.pointerId);

    const onMove = (ev) => resizeTo(ev.clientY);
    const onUp = (ev) => {
        resizer.classList.remove('dragging');
        resizer.releasePointerCapture(e.pointerId);
        resizer.removeEventListener('pointermove', onMove);
        resizer.removeEventListener('pointerup', onUp);
        resizer.removeEventListener('pointercancel', onUp);
    };

    resizer.addEventListener('pointermove', onMove);
    resizer.addEventListener('pointerup', onUp);
    resizer.addEventListener('pointercancel', onUp);
});

function startSensors() {
    overlay.classList.remove('active');
    
    // Start Map
    initMap();
    
    // Start Geolocation
    if (navigator.geolocation) {
        loadingText.innerText = "Finding your location...";
        navigator.geolocation.watchPosition(
            handlePositionUpdate,
            handlePositionError,
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
        );
    } else {
        alert("Geolocation is not supported by your browser.");
    }
    
    // Start Device Orientation
    // Listen to both to ensure compatibility with Chrome DevTools simulator and various devices
    window.addEventListener('deviceorientationabsolute', handleOrientation);
    window.addEventListener('deviceorientation', handleOrientation);
}

function initMap() {
    // rotate: true enables leaflet-rotate, which rotates inside Leaflet's own
    // coordinate math so dragging and overlays stay in sync (unlike a CSS rotate).
    map = L.map('map-container', {
        zoomControl: false,
        rotate: true,
        rotateControl: false,
        touchRotate: false, // rotation is driven by the compass, not two-finger gestures
        bearing: 0
    }).setView([30.2672, -97.7431], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    }).addTo(map);

    // Reposition zoom control to bottom right to keep it out of the way
    L.control.zoom({ position: 'bottomright' }).addTo(map);
}

// Let Leaflet recompute its size when the viewport / split changes.
function fitMapContainer() {
    if (map) map.invalidateSize();
}

window.addEventListener('resize', fitMapContainer);

async function handlePositionUpdate(position) {
    const isFirstTime = (userLat === null);
    userLat = position.coords.latitude;
    userLon = position.coords.longitude;
    debug.accuracy = position.coords.accuracy;
    debug.gpsTime = position.timestamp;
    renderDebug();
    
    // Center on the user only on the first fix. Afterwards leave the map where
    // it is so you can drag/pan freely; the recenter button brings you back.
    const newLatLng = new L.LatLng(userLat, userLon);
    if (isFirstTime) {
        map.setView(newLatLng, 10);
    }
    
    if (!userMarker) {
        const userIcon = L.divIcon({
            className: 'custom-user-marker',
            html: `<div class="marker-dot"></div>`,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
        userMarker = L.marker(newLatLng, {icon: userIcon}).addTo(map);
    } else {
        userMarker.setLatLng(newLatLng);
    }

    if (isFirstTime) {
        // Draw an initial beam (pointing north) so it's visible immediately
        updateFovBeam(currentHeading || 0);

        // Use cached places for this area if we have a fresh copy — avoids
        // hammering Wikidata on every reload (and works offline).
        const cached = loadPlacesCache(userLat, userLon);
        if (cached) {
            allPlaces = cached.map(p => withGeo(p, userLat, userLon));
            currentScanStatus = "";
            lastRenderedIndices = "";
            updateUI();
        } else {
            scanProgressively(userLat, userLon);
        }
    }
}

// --- Places cache (localStorage) ---
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_PREFIX = 'wit_places_popular_stations_';

// Snap to a ~11 km grid so nearby positions share one cache entry.
function cacheKey(lat, lon) {
    const snap = v => (Math.round(v * 10) / 10).toFixed(1);
    return `${CACHE_PREFIX}${snap(lat)}_${snap(lon)}`;
}

// Recompute distance/bearing/score for the current position (cached places
// store absolute lat/lon, so this stays accurate wherever you are in the cell).
function withGeo(p, lat, lon) {
    const distance = calculateDistance(lat, lon, p.lat, p.lon);
    return {
        ...p,
        distance,
        bearing: calculateBearing(lat, lon, p.lat, p.lon),
        score: distance / p.weight
    };
}

function loadPlacesCache(lat, lon) {
    try {
        const raw = localStorage.getItem(cacheKey(lat, lon));
        if (!raw) return null;
        const { t, places } = JSON.parse(raw);
        if (!places || (Date.now() - t) > CACHE_TTL_MS) return null;
        return places;
    } catch { return null; }
}

function savePlacesCache(lat, lon, places) {
    try {
        // Store only what we need; geo fields are recomputed on load.
        const slim = places.map(p => ({
            id: p.id,
            name: p.name,
            type: p.type,
            weight: p.weight,
            population: p.population || 0,
            sitelinks: p.sitelinks || 0,
            lat: p.lat,
            lon: p.lon
        }));
        localStorage.setItem(cacheKey(lat, lon), JSON.stringify({ t: Date.now(), places: slim }));
    } catch { /* quota / disabled — ignore */ }
}

// Scan in two expanding disks (40 km, then 100 km) so nearby places appear
// quickly and far ones fill in. Two plain queries keep request count and server
// load low; a failed step keeps whatever the earlier step found.
async function scanProgressively(lat, lon) {
    const RADII_KM = [40, 100];
    const byName = new Map();

    for (const radiusKm of RADII_KM) {
        currentScanStatus = `Scanning ${radiusKm} km…`;
        lastRenderedIndices = "";
        updateUI();

        let batch = [];
        try {
            batch = await fetchPlaces(lat, lon, radiusKm);
        } catch (e) {
            console.error("Scan step failed", e);
        }

        // Merge into the running set, keeping most-significant/nearest
        for (const p of batch) {
            const key = p.name.toLowerCase();
            const e = byName.get(key);
            if (!e || p.weight > e.weight || (p.weight === e.weight && p.distance < e.distance)) {
                byName.set(key, p);
            }
        }
        allPlaces = Array.from(byName.values()).sort((a, b) => a.score - b.score);

        // Stop on a hard error so we don't keep hammering a throttled server
        if (batch.length === 0 && lastFetchError) {
            currentScanStatus = allPlaces.length
                ? `Showing nearby only — ${lastFetchError}`
                : `Couldn't load places — ${lastFetchError}`;
            lastRenderedIndices = "";
            updateUI();
            return;
        }

        lastRenderedIndices = "";
        updateUI();
    }

    // Full scan succeeded — cache it so reloads in this area don't re-query.
    if (allPlaces.length) savePlacesCache(lat, lon, allPlaces);

    currentScanStatus = "";
    lastRenderedIndices = "";
    updateUI();
}

function handlePositionError(error) {
    console.warn('ERROR(' + error.code + '): ' + error.message);
    loadingText.innerText = "Could not get your location. Please ensure GPS is enabled.";
}

function smoothHeading(currentUnbounded, target, alpha = 0.1) {
    if (currentUnbounded === null) return target;
    
    // Get the current heading mapped to 0-360
    let currentMod = ((currentUnbounded % 360) + 360) % 360;
    let diff = target - currentMod;
    
    // Normalize diff to -180 to 180 to always take the shortest path
    diff = ((diff + 540) % 360) - 180;
    
    // Add the shortest path diff to the UNBOUNDED continuous variable
    // This allows the DOM element to rotate past 360 without spinning backwards!
    return currentUnbounded + (diff * alpha);
}

function getCompassHeading(alpha, beta, gamma) {
    // W3C DeviceOrientation uses ZXY intrinsic Euler angles.
    // For a phone held flat (screen up), the "pointing direction" is
    // the device Y-axis (top of phone). We project it onto the world
    // horizontal plane to get a compass heading.
    //
    // World frame: X=East, Y=North, Z=Up
    // R = Rz(alpha) * Rx(beta) * Ry(gamma)
    // Device Y [0,1,0] in world coords = second column of R:
    //   world_east  = -sin(alpha) * cos(beta)
    //   world_north =  cos(alpha) * cos(beta)
    //   world_up    =  sin(beta)
    //
    // Compass heading (clockwise from north) = atan2(east, north)

    const alphaRad = (alpha || 0) * Math.PI / 180;
    const betaRad  = (beta  || 0) * Math.PI / 180;

    const east  = -Math.sin(alphaRad) * Math.cos(betaRad);
    const north =  Math.cos(alphaRad) * Math.cos(betaRad);

    let heading = Math.atan2(east, north) * 180 / Math.PI;
    if (heading < 0) heading += 360;

    return heading;
}

function handleOrientation(event) {
    debug.orientEvents++;

    // Work out a heading from whatever this event provides
    let heading = null;
    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
        // iOS provides a pre-computed true compass heading
        heading = event.webkitCompassHeading;
        debug.source = `iOS webkitCompassHeading (${event.type})`;
    } else if (event.alpha !== null && event.alpha !== undefined) {
        // Android: compute true compass heading from 3D tilt (beta/gamma)
        heading = getCompassHeading(event.alpha, event.beta, event.gamma);
        debug.source = `alpha/beta/gamma (${event.type})`;
    }

    debug.rawHeading = heading;
    debug.alpha = event.alpha;
    debug.beta = event.beta;
    debug.gamma = event.gamma;

    // Prefer absolute events once one actually delivers a usable heading, then
    // ignore relative events (stops Android's flip-flop). A useless absolute
    // event (null alpha) must NOT block the relative events.
    const usable = heading !== null && !isNaN(heading);
    if (event.type === 'deviceorientationabsolute') {
        if (usable) absoluteFired = true;
    } else if (event.type === 'deviceorientation' && absoluteFired && event.webkitCompassHeading === undefined) {
        renderDebug();
        return;
    }

    if (usable) {
        currentHeading = smoothHeading(currentHeading, heading);
        updateHeadingUI(currentHeading);
        updateFovBeam(currentHeading);
        if (allPlaces && allPlaces.length > 0) updateUI();
    }
    renderDebug(); // always refresh the debug panel so raw values are visible
}

// Geo utility: given a start point, bearing (degrees), and distance (km), return destination [lat, lon]
function destinationPoint(lat, lon, bearing, distKm) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const toDeg = r => r * 180 / Math.PI;
    const lat1 = toRad(lat);
    const lon1 = toRad(lon);
    const brng = toRad(bearing);
    const d = distKm / R;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [toDeg(lat2), toDeg(lon2)];
}

// Return the lat/lon for a point `forwardKm` ahead along `h` and `lateralKm`
// to the side (positive = right of heading).
function beamPoint(forwardKm, lateralKm, h) {
    const ahead = destinationPoint(userLat, userLon, h, forwardKm);
    if (!lateralKm) return ahead;
    const sideBearing = lateralKm > 0 ? (h + 90) % 360 : (h - 90 + 360) % 360;
    return destinationPoint(ahead[0], ahead[1], sideBearing, Math.abs(lateralKm));
}

// Draw / update the FOV beam (a constant-width rectangle) on the Leaflet map
function updateFovBeam(heading) {
    if (userLat === null || !map) return;

    // Normalize heading to 0-360
    const h = ((heading % 360) + 360) % 360;

    // Rectangle: two near corners beside you, two far corners FOV_RANGE_KM ahead.
    const beamCoords = [
        beamPoint(0, -FOV_HALF_WIDTH_KM, h),            // near left
        beamPoint(FOV_RANGE_KM, -FOV_HALF_WIDTH_KM, h), // far left
        beamPoint(FOV_RANGE_KM,  FOV_HALF_WIDTH_KM, h), // far right
        beamPoint(0,  FOV_HALF_WIDTH_KM, h)             // near right
    ];

    if (fovBeam) {
        fovBeam.setLatLngs(beamCoords);
    } else {
        fovBeam = L.polygon(beamCoords, {
            color: '#ef4444',
            weight: 2,
            fillColor: '#ef4444',
            fillOpacity: 0.2,
            dashArray: '6, 4',
            interactive: false
        }).addTo(map);
    }
}

// Math Utilities
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;  
    const dLon = (lon2 - lon1) * Math.PI / 180; 
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    const dLon = toRad(lon2 - lon1);
    lat1 = toRad(lat1);
    lat2 = toRad(lat2);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const bearing = toDeg(Math.atan2(y, x));

    return (bearing + 360) % 360;
}

// True if a place falls inside the rectangular beam: in front of you and within
// the corridor's half-width measured perpendicular to your heading.
function isWithinBeam(distanceKm, targetBearing, currentHeading, halfWidthKm = FOV_HALF_WIDTH_KM) {
    // Normalize unbounded heading back to 0-360 for math
    currentHeading = ((currentHeading % 360) + 360) % 360;

    // Signed angle between the place and where you're pointing (-180..180)
    let diff = ((targetBearing - currentHeading + 540) % 360) - 180;
    const diffRad = diff * Math.PI / 180;

    const forwardKm = distanceKm * Math.cos(diffRad); // along the heading
    const lateralKm = distanceKm * Math.sin(diffRad); // sideways offset

    return forwardKm > 0 && Math.abs(lateralKm) <= halfWidthKm;
}

function getCardinalDirection(heading) {
    const directions = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
    const index = Math.round(((heading %= 360) < 0 ? heading + 360 : heading) / 45) % 8;
    return directions[index];
}

function getCardinalInitials(heading) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((heading %= 360) < 0 ? heading + 360 : heading) / 45) % 8;
    return directions[index];
}

function updateHeadingUI(heading) {
    const h = ((heading % 360) + 360) % 360;
    headingText.innerText = getCardinalInitials(heading);

    // Spin the compass needle to point in the heading direction (arrow up = N).
    const arrow = document.getElementById('compass-arrow');
    if (arrow) {
        arrow.style.opacity = '1';
        arrow.style.transform = `rotate(${h}deg)`;
    }

    // Rotate the map so "up" always matches where you're pointing.
    // leaflet-rotate's setBearing rotates the content clockwise, so to bring the
    // heading to the top we pass (360 - heading).
    if (map && typeof map.setBearing === 'function') {
        map.setBearing((360 - h) % 360);
    }
}

// Clear the current selection, fading the marker and banner out
function clearSelection() {
    selectedPlaceId = null;
    selectedBanner.classList.remove('show'); // CSS fades opacity to 0

    if (selectedMarker) {
        const m = selectedMarker;
        selectedMarker = null;
        m.setOpacity(0); // CSS transition fades it out
        setTimeout(() => { if (map) map.removeLayer(m); }, 400);
    }

    Array.from(placesList.querySelectorAll('.place-item.selected')).forEach(n => n.classList.remove('selected'));
}

// Focus a place tapped in the list: drop a single marker, pan to it, show the
// banner. Tapping the already-selected place clears it (toggle).
function selectPlace(place) {
    if (selectedPlaceId === place.id) {
        clearSelection();
        return;
    }

    selectedPlaceId = place.id;

    const icon = L.divIcon({
        className: 'selected-place-marker',
        html: `<div class="selected-pin"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });
    if (selectedMarker) {
        selectedMarker.setLatLng([place.lat, place.lon]).setIcon(icon);
    } else {
        selectedMarker = L.marker([place.lat, place.lon], { icon, interactive: false }).addTo(map);
    }

    if (map) {
        map.flyTo([place.lat, place.lon], Math.max(map.getZoom(), 11), { duration: 0.6 });
    }

    selectedBanner.textContent = `📍 ${place.name} · ${place.distance.toFixed(1)} km`;
    selectedBanner.classList.add('show');

    // Reflect selection in the list
    Array.from(placesList.querySelectorAll('.place-item.selected')).forEach(n => n.classList.remove('selected'));
    const node = placesList.querySelector(`.place-item[data-id="${place.id}"]`);
    if (node) node.classList.add('selected');
}

// Wikidata type (QID) -> [display label, base significance weight]. Higher
// weight = more important; population and Wikipedia/sister-site links add a
// popularity boost after the query returns.
const WIKIDATA_TYPES = {
    // Settlements
    Q515:     ['City', 3.0],
    Q1549591: ['City', 3.0],   // big city
    Q3957:    ['Town', 2.0],
    Q532:     ['Village', 0.8],
    // Important areas / landmarks
    Q8502:    ['Mountain', 1.6],
    Q8072:    ['Volcano', 1.8],
    Q23397:   ['Lake', 1.6],
    Q131681:  ['Reservoir', 1.6],
    Q34038:   ['Waterfall', 1.8],
    Q40080:   ['Beach', 1.6],
    Q23413:   ['Castle', 2.0],
    Q57821:   ['Fort', 2.0],
    Q46169:   ['National Park', 2.5],
    Q55488:   ['Railway Station', 1.8],
    Q494829:  ['Bus Station', 1.4],
    Q1248784: ['Airport', 3.0],
    Q644371:  ['Airport', 3.0]   // international airport
};

// Always shown regardless of popularity: a handful of landmark/airport types
// that are individually useful and few in number (a lake or fort is worth
// showing even with no Wikipedia article). Everything else — settlements AND
// the long tail of minor railway/bus stations — must clear the popularity
// signal, so you keep major towns/junctions but drop tiny villages and halts.
const ALWAYS_KEEP_QIDS = new Set([
    'Q8502', 'Q8072', 'Q23397', 'Q131681', 'Q34038', 'Q40080', // mountain, volcano, lake, reservoir, waterfall, beach
    'Q23413', 'Q57821', 'Q46169',                              // castle, fort, national park
    'Q1248784', 'Q644371'                                      // airports
]);

const MIN_POPULAR_SITELINKS = 1;
const MIN_POPULAR_POPULATION = 10000;

function popularityBoost(population, sitelinks) {
    const popBoost = population > 0 ? Math.log10(population + 1) / 8 : 0;
    const linkBoost = sitelinks > 0 ? Math.log(sitelinks + 1) / 4 : 0;
    return 1 + popBoost + linkBoost;
}

function hasPopularitySignal(place) {
    return place.sitelinks >= MIN_POPULAR_SITELINKS
        || place.population >= MIN_POPULAR_POPULATION;
}

// Fetch Data
async function fetchPlaces(lat, lon, radiusKm = 100) {
    // Query Wikidata for places of our chosen types within the radius, then keep
    // only entries with a popularity signal. That keeps the list focused on
    // recognizable places instead of every small map label.
    const typeValues = Object.keys(WIKIDATA_TYPES).map(q => `wd:${q}`).join(' ');
    const sparql = `
        SELECT ?place ?placeLabel ?loc ?type ?population ?sitelinks ?dist WHERE {
          SERVICE wikibase:around {
            ?place wdt:P625 ?loc.
            bd:serviceParam wikibase:center "Point(${lon} ${lat})"^^geo:wktLiteral.
            bd:serviceParam wikibase:radius "${radiusKm}".
            bd:serviceParam wikibase:distance ?dist.
          }
          ?place wdt:P31 ?type.
          VALUES ?type { ${typeValues} }
          OPTIONAL { ?place wdt:P1082 ?population. }
          ?place wikibase:sitelinks ?sitelinks.
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
        }
        ORDER BY ?dist
        LIMIT 600`;

    const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
    const FETCH_TIMEOUT_MS = 30000;

    lastFetchError = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let data = null;
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/sparql-results+json' } });
        if (!response.ok) {
            lastFetchError = `Wikidata HTTP ${response.status}`;
            return [];
        }
        data = await response.json();
    } catch (e) {
        lastFetchError = e.name === 'AbortError'
            ? `Wikidata timed out after ${FETCH_TIMEOUT_MS / 1000}s`
            : `Wikidata: ${e.message}`;
        return [];
    } finally {
        clearTimeout(timer);
    }

    try {
        const rows = (data.results && data.results.bindings) || [];
        // One item can have several P31 types -> several rows. Keep the row with
        // the highest weight per item (QID).
        const byId = new Map();
        for (const r of rows) {
            const qid = r.place.value.split('/').pop();          // .../entity/Q123
            const typeQid = r.type.value.split('/').pop();
            const meta = WIKIDATA_TYPES[typeQid];
            if (!meta) continue;
            const [label, weight] = meta;

            // "Point(lon lat)" -> numbers
            const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(r.loc.value);
            if (!m) continue;
            const plon = parseFloat(m[1]), plat = parseFloat(m[2]);

            const name = r.placeLabel ? r.placeLabel.value : qid;
            if (name === qid) continue; // no human label -> skip
            const population = r.population ? parseInt(r.population.value, 10) || 0 : 0;
            const sitelinks = r.sitelinks ? parseInt(r.sitelinks.value, 10) || 0 : 0;
            const finalWeight = weight * popularityBoost(population, sitelinks);
            const place = {
                id: qid,
                name,
                type: label,
                weight: finalWeight,
                population,
                sitelinks,
                lat: plat,
                lon: plon
            };
            // Keep the few landmark/airport types always; gate everything else
            // (settlements + minor stations) on the popularity signal.
            if (!ALWAYS_KEEP_QIDS.has(typeQid) && !hasPopularitySignal(place)) continue;

            const prev = byId.get(qid);
            if (!prev || finalWeight > prev.weight) {
                byId.set(qid, place);
            }
        }

        const places = Array.from(byId.values())
            .map(p => withGeo(p, lat, lon))
            .filter(p => p.distance > 0.3);

        return places.sort((a, b) => a.score - b.score);
    } catch (e) {
        lastFetchError = `Parse error: ${e.message}`;
        console.error("Failed to process places", e);
        return [];
    }
}

// Update each visible row's "+N° / −N°" angular offset from the current heading.
// Runs on every heading change so the badges track live as you rotate.
function updateDegreeBadges() {
    const haveHeading = currentHeading !== null && !isNaN(currentHeading);
    const h = haveHeading ? ((currentHeading % 360) + 360) % 360 : 0;

    placesList.querySelectorAll('.place-item').forEach(node => {
        const deg = node.querySelector('.place-degree');
        if (!deg) return;
        if (!haveHeading) { deg.textContent = ''; deg.classList.remove('ahead'); return; }

        const place = allPlaces.find(p => String(p.id) === node.getAttribute('data-id'));
        if (!place) { deg.textContent = ''; deg.classList.remove('ahead'); return; }

        // Signed angle: positive = to your right, negative = to your left
        const diff = ((place.bearing - h + 540) % 360) - 180;
        const mag = Math.abs(diff);
        // ▲ dead ahead, ▶ to the right, ◀ to the left
        const arrow = mag < 2 ? '▲' : (diff > 0 ? '▶' : '◀');
        deg.textContent = `${arrow} ${mag.toFixed(0)}°`;
        // Highlight places that are roughly straight ahead (within 10°)
        deg.classList.toggle('ahead', mag <= 10);
    });
}

// Render UI
function updateUI() {
    if (!allPlaces || allPlaces.length === 0) {
        placesList.innerHTML = `<div class="loading-state">${currentScanStatus || "Waiting for location..."}</div>`;
        return;
    }
    
    // Filter places. A place ENTERS the moment it's inside the drawn rectangle
    // (FOV_HALF_WIDTH_KM) so the list matches the shape exactly; once visible it
    // only drops out past a +1km buffer, which prevents flicker on the edge.
    const haveHeading = currentHeading !== null && !isNaN(currentHeading);

    let visiblePlaces;
    if (haveHeading) {
        visiblePlaces = allPlaces.filter(place => {
            const halfWidth = place.isVisible ? (FOV_HALF_WIDTH_KM + 1) : FOV_HALF_WIDTH_KM;
            place.isVisible = isWithinBeam(place.distance, place.bearing, currentHeading, halfWidth);
            return place.isVisible;
        });
    } else {
        // No compass available — show all nearby places (already ranked) so the
        // app is still useful without a working magnetometer.
        visiblePlaces = allPlaces.slice();
    }

    // Status shown above the list: scan progress takes priority, else a
    // no-compass hint when we can't determine direction.
    const displayStatus = currentScanStatus
        || (!haveHeading && allPlaces.length ? '🧭 No compass detected — showing all nearby places' : '');

    const placesToShow = visiblePlaces.slice(0, 50);

    // If the tapped place has rotated out of the beam, fade the selection away
    if (selectedPlaceId !== null && !visiblePlaces.some(p => p.id === selectedPlaceId)) {
        clearSelection();
    }

    // Keep the debug panel counts current
    debug.totalPlaces = allPlaces.length;
    debug.visibleCount = visiblePlaces.length;
    renderDebug();

    // Refresh the live degree badges even when the visible set is unchanged
    // (e.g. you're just rotating in place).
    updateDegreeBadges();

    // Append status to the hash to ensure UI re-renders when status changes
    const currentIndices = placesToShow.map(p => p.id).join(',') + '|' + displayStatus;
    if (currentIndices === lastRenderedIndices) return;
    lastRenderedIndices = currentIndices;
    
    // Remove loading state if present
    const loadingState = document.querySelector('.loading-state');
    if (loadingState && loadingState.id !== 'empty-state') loadingState.remove();

    // Handle status banner
    let statusDiv = document.getElementById('scan-status');
    if (displayStatus) {
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'scan-status';
            statusDiv.style.textAlign = 'center';
            statusDiv.style.padding = '0.5rem';
            statusDiv.style.marginBottom = '1rem';
            statusDiv.style.color = '#3b82f6';
            statusDiv.style.fontWeight = '600';
            statusDiv.style.fontSize = '0.85rem';
            statusDiv.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            statusDiv.style.borderRadius = '8px';
            placesList.insertBefore(statusDiv, placesList.firstChild);
        }
        statusDiv.innerText = displayStatus;
    } else if (statusDiv) {
        statusDiv.remove();
        statusDiv = null;
    }

    if (placesToShow.length === 0) {
        // Clear all places
        Array.from(placesList.children).forEach(child => {
            if (child.classList.contains('place-item')) child.remove();
        });
        
        if (!document.getElementById('empty-state')) {
            const emptyDiv = document.createElement('div');
            emptyDiv.id = 'empty-state';
            emptyDiv.className = 'loading-state';
            emptyDiv.innerText = 'No major places found in this direction.';
            placesList.appendChild(emptyDiv);
        }
        return;
    }

    // Remove empty state if present
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.remove();

    // DOM Reconciliation for places
    const existingNodes = new Map();
    Array.from(placesList.children).forEach(child => {
        if (child.classList.contains('place-item')) {
            existingNodes.set(child.getAttribute('data-id'), child);
        }
    });

    const desiredIds = new Set(placesToShow.map(p => p.id.toString()));

    // Remove nodes that are no longer visible
    existingNodes.forEach((node, id) => {
        if (!desiredIds.has(id)) {
            node.remove();
        }
    });

    // Add or reorder nodes
    let previousNode = statusDiv || null;

    placesToShow.forEach((place) => {
        const idStr = place.id.toString();
        let node = existingNodes.get(idStr);

        if (!node) {
            // Create new node
            node = document.createElement('div');
            node.className = 'place-item';
            node.setAttribute('data-id', idStr);
            node.style.animationDelay = '0s'; // No cascading delay for dynamically added items
            node.innerHTML = `
                <div class="place-info">
                    <h3>${place.name}</h3>
                    <p>${place.type}</p>
                </div>
                <div class="place-distance">
                    <span class="place-km">${place.distance.toFixed(1)} km</span>
                    <span class="place-degree"></span>
                </div>
            `;
        }

        // Keep the tapped item highlighted across re-renders
        node.classList.toggle('selected', idStr === String(selectedPlaceId));

        // Insert in correct order
        const nextExpectedSibling = previousNode ? previousNode.nextSibling : placesList.firstChild;
        if (node !== nextExpectedSibling) {
            placesList.insertBefore(node, nextExpectedSibling);
        }

        previousNode = node;
    });

    // Fill in the degree badges for any freshly-created nodes
    updateDegreeBadges();
}

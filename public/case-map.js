// Original mapping prototype and Leaflet implementation contributed by: [TEAMMATE NAME]
// Refactored and integrated into VisionFind AI.
// Original mapping implementation created by project teammate.
// Extended with CCTV sightings, case filtering and search-zone logic.

// ===============================
// MAP SETTINGS FROM TEAMMATE PROTOTYPE
// ===============================
const SINGAPORE_CENTER = [1.3521, 103.8198];
const SINGAPORE_BOUNDS = [
  [1.16, 103.6],
  [1.47, 104.1]
];

const movementSpeedMetresPerMinute = {
  walking: 75,
  vehicle: 500,
  public_transport: 350,
  unknown: 100
};

const startingRadiusMetres = 150;
const maximumRadiusMetres = 5000;

let caseMap;
let markerLayer;
let routeLayer;
let searchZoneLayer;
let estimatedTrailLayer;
let searchZoneCircle;
let latestSightingForZone = null;
let searchZoneTimer = null;
let currentMarkers = [];
let showLabelsByDefault = true;

// ===============================
// SAFE TEXT HELPERS
// ===============================
function text(value, fallback = "") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function formatMovementMode(value) {
  return text(value, "unknown").replace(/_/g, " ");
}

function formatSightingTime(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRadius(radiusMetres) {
  return radiusMetres >= 1000 ? `${(radiusMetres / 1000).toFixed(2)} km` : `${Math.round(radiusMetres)} m`;
}

function setMapStatus(message, isError = false) {
  const status = document.getElementById("caseMapStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", Boolean(isError));
}

function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

function getSeenAt(sighting) {
  return sighting.seen_at || sighting.seenAt || sighting.sighted_at || sighting.sightedAt;
}

// ===============================
// LEAFLET MAP INITIALISATION
// ===============================
function initialiseCaseMap() {
  const mapElement = document.getElementById("caseMap");
  if (!mapElement || typeof L === "undefined") return;

  const singaporeBounds = L.latLngBounds(SINGAPORE_BOUNDS);

  // Original mapping implementation created by project teammate.
  // Extended with protected Supabase case filtering and search-zone logic.
  caseMap = L.map("caseMap", {
    maxBounds: singaporeBounds,
    maxBoundsViscosity: 1,
    minZoom: 11
  }).setView(SINGAPORE_CENTER, 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    minZoom: 11,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(caseMap);

  markerLayer = L.layerGroup().addTo(caseMap);
  routeLayer = L.layerGroup().addTo(caseMap);
  searchZoneLayer = L.layerGroup().addTo(caseMap);

  caseMap.on("drag", () => {
    caseMap.panInsideBounds(singaporeBounds, { animate: false });
  });

  bindMapControls();
  loadCaseFromUrl();
}

function bindMapControls() {
  const form = document.getElementById("caseMapSearchForm");
  const toggleButton = document.getElementById("toggleLabelsBtn");

  if (form && form.dataset.mapListenerAttached !== "true") {
    form.dataset.mapListenerAttached = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("caseMapSearchInput");
      await searchCaseSightings(input?.value || "");
    });
  }

  if (toggleButton && toggleButton.dataset.mapListenerAttached !== "true") {
    toggleButton.dataset.mapListenerAttached = "true";
    toggleButton.addEventListener("click", toggleLabels);
  }
}

function loadCaseFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const caseNumber = params.get("caseNumber");
  if (!caseNumber) return;

  const input = document.getElementById("caseMapSearchInput");
  if (input) input.value = caseNumber;
  searchCaseSightings(caseNumber);
}

// ===============================
// LABEL TOGGLE FROM TEAMMATE PROTOTYPE
// ===============================
function toggleLabels() {
  showLabelsByDefault = !showLabelsByDefault;
  const labelMode = document.getElementById("labelMode");
  if (labelMode) {
    labelMode.textContent = `Labels mode: ${showLabelsByDefault ? "Always visible" : "Hover only"}`;
  }

  currentMarkers.forEach(({ marker, sighting, index }) => {
    marker.unbindTooltip();
    bindMarkerLabel(marker, sighting, index);
  });
}

function bindMarkerLabel(marker, sighting, index) {
  const label = `Point ${String.fromCharCode(65 + index)} | ${formatSightingTime(getSeenAt(sighting))}`;
  marker.bindTooltip(label, {
    permanent: showLabelsByDefault,
    direction: "top",
    offset: [0, -12],
    className: "case-map-label"
  });
}

// ===============================
// PROTECTED SUPABASE API SEARCH
// ===============================
async function getAccessToken() {
  const { data: { session } } = await window.supabaseClient.auth.getSession();
  return session?.access_token || "";
}

function caseField(record, ...names) {
  const entries = Object.entries(record || {});
  for (const name of names) {
    const match = entries.find(([key]) => key.trim().toLowerCase() === name.toLowerCase());
    if (match && match[1] !== "") return match[1];
  }
  return "";
}

function officialSeenAt(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  if (!date) return null;

  const twelveHour = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") hour += 12;
    const isoLike = `${date}T${String(hour).padStart(2, "0")}:${twelveHour[2]}:00+08:00`;
    const parsed = new Date(isoLike);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const fallback = new Date(`${date} ${time}`.trim());
  return Number.isNaN(fallback.getTime()) ? null : fallback.toISOString();
}

function officialLocationsFromWorkflow(payload) {
  return (payload.locations || []).map((location, index) => {
    const record = location.full_record || {};
    const coordinateText = location.coordinates || caseField(record, "coordinates");
    const [latitude, longitude] = String(coordinateText || "").split(",").map(Number);
    const date = location.date || caseField(record, "Last Seen Date");
    const time = location.time || caseField(record, "Last seen timing", "Last Seen Time");
    const details = [
      caseField(record, "CCTV description", "CCTV description "),
      caseField(record, "Witness info", "Witness information"),
      caseField(record, "Additional Info")
    ].filter(Boolean);

    return {
      case_number: payload.case_id,
      location_name: caseField(record, "Location", "Last Seen Location", "Incident Location") || `Official location ${index + 1}`,
      latitude,
      longitude,
      seen_at: officialSeenAt(date, time),
      movement_mode: "unknown",
      notes: details.join(" | ") || "Official case location record.",
      status: location.status || caseField(record, "Status")
    };
  });
}

async function searchCaseSightings(caseNumberValue) {
  const caseNumber = caseNumberValue.trim();
  if (!caseNumber) {
    setMapStatus("Enter a case number before searching.", true);
    return;
  }

  clearMapLayers();
  setMapStatus(`Searching protected records for ${caseNumber}...`);

  try {
    const token = await getAccessToken();
    if (!token) throw new Error("No active Supabase session. Please log in again.");

    const response = await fetch("/api/visionfind", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ feature: "map", case_id: caseNumber })
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Unable to load case sightings.");
    }

    renderSightings(officialLocationsFromWorkflow(payload));
  } catch (error) {
    console.error("Case sighting search failed:", error);
    setMapStatus(error.message, true);
    renderTimeline([]);
    updateSearchZoneMetrics(null);
  }
}

function clearMapLayers() {
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  searchZoneLayer.clearLayers();
  estimatedTrailLayer = null;
  searchZoneCircle = null;
  latestSightingForZone = null;
  currentMarkers = [];
}

function normaliseSightings(records) {
  return (records || [])
    .map((record) => ({
      ...record,
      latitude: Number(record.latitude),
      longitude: Number(record.longitude),
      seen_at: getSeenAt(record),
      movement_mode: record.movement_mode || record.movementMode || "unknown"
    }))
    .filter((record) => {
      const validCoordinate = isValidCoordinate(record.latitude, record.longitude);
      const validDate = !Number.isNaN(new Date(record.seen_at).getTime());
      if (!validCoordinate) console.warn("Skipping invalid sighting coordinates:", record);
      if (!validDate) console.warn("Skipping invalid sighting timestamp:", record);
      return validCoordinate && validDate;
    })
    .sort((a, b) => new Date(a.seen_at) - new Date(b.seen_at));
}

function renderSightings(records) {
  const sightings = normaliseSightings(records);
  renderTimeline(sightings);

  if (!sightings.length) {
    setMapStatus("No valid sighting records found for this case.");
    updateSearchZoneMetrics(null);
    caseMap.setView(SINGAPORE_CENTER, 12);
    return;
  }

  sightings.forEach((sighting, index) => addSightingMarker(sighting, index));
  latestSightingForZone = sightings[sightings.length - 1];
  updateSearchZone();

  if (sightings.length >= 2) {
    drawEstimatedTrail(sightings);
  } else {
    setMapStatus("One CCTV sighting loaded. Showing marker and estimated search zone only.");
  }

  focusMapOnSightingsAndZone(sightings);
  startSearchZoneTimer();

  if (sightings.length >= 2) {
    setMapStatus(`Loaded ${sightings.length} CCTV sightings. Estimated CCTV trail displayed.`);
  }
}

function addSightingMarker(sighting, index) {
  const pointName = `Point ${String.fromCharCode(65 + index)}`;
  const marker = L.circleMarker([sighting.latitude, sighting.longitude], {
    radius: 9,
    color: "#ffffff",
    weight: 2,
    fillColor: "#ff0000",
    fillOpacity: 1
  }).addTo(markerLayer);

  bindMarkerLabel(marker, sighting, index);
  marker.bindPopup(createPopupContent(sighting, pointName));
  currentMarkers.push({ marker, sighting, index });
}

function createPopupContent(sighting, pointName) {
  const wrapper = document.createElement("div");
  wrapper.className = "case-map-popup";

  const title = document.createElement("strong");
  title.textContent = `${pointName} | Estimated CCTV sighting`;
  wrapper.appendChild(title);

  const caseNumber = document.createElement("p");
  caseNumber.textContent = `Case: ${text(sighting.case_number, "Not recorded")}`;
  wrapper.appendChild(caseNumber);

  const location = document.createElement("p");
  location.textContent = `Location: ${text(sighting.location_name, "Unnamed location")}`;
  wrapper.appendChild(location);

  const time = document.createElement("p");
  time.textContent = `Seen: ${formatSightingTime(sighting.seen_at)}`;
  wrapper.appendChild(time);

  const movement = document.createElement("p");
  movement.textContent = `Movement: ${formatMovementMode(sighting.movement_mode)}`;
  wrapper.appendChild(movement);

  if (sighting.generated_image_url) {
    const image = document.createElement("img");
    image.className = "case-map-sketch-thumb";
    image.src = sighting.generated_image_url;
    image.alt = "AI-assisted sketch reference";
    wrapper.appendChild(image);
  }

  if (sighting.notes) {
    const notes = document.createElement("p");
    notes.textContent = `Notes: ${sighting.notes}`;
    wrapper.appendChild(notes);
  }

  return wrapper;
}

function focusMapOnSightingsAndZone(sightings) {
  const coordinates = sightings.map((sighting) => [sighting.latitude, sighting.longitude]);
  const bounds = L.latLngBounds(coordinates);

  if (searchZoneCircle) {
    bounds.extend(searchZoneCircle.getBounds());
  }

  if (coordinates.length === 1 && !searchZoneCircle) {
    caseMap.flyTo(coordinates[0], 16, { animate: true, duration: 1.2 });
    return;
  }

  caseMap.flyToBounds(bounds, {
    padding: [55, 55],
    animate: true,
    duration: 1.2
  });
}

// ===============================
// ESTIMATED TRAIL FROM TEAMMATE ROUTE DISPLAY IDEA
// ===============================
function drawEstimatedTrail(sightings) {
  const routePoints = sightings.map((sighting) => [sighting.latitude, sighting.longitude]);

  if (estimatedTrailLayer) {
    routeLayer.removeLayer(estimatedTrailLayer);
  }

  estimatedTrailLayer = L.polyline(routePoints, {
    color: "#ff0000",
    weight: 7,
    opacity: 1,
    dashArray: "12, 8"
  }).addTo(routeLayer);

  estimatedTrailLayer.bindTooltip("Estimated CCTV trail", {
    permanent: false,
    direction: "center",
    className: "case-map-label"
  });
}

// ===============================
// GROWING ESTIMATED SEARCH ZONE
// ===============================
function calculateSearchZoneRadius(sighting) {
  const seenTime = new Date(sighting.seen_at).getTime();
  const elapsedMinutes = Math.max(0, (Date.now() - seenTime) / 60000);
  const movementMode = sighting.movement_mode || "unknown";
  const selectedMovementSpeed = movementSpeedMetresPerMinute[movementMode] || movementSpeedMetresPerMinute.unknown;
  const radiusMetres = Math.min(maximumRadiusMetres, startingRadiusMetres + elapsedMinutes * selectedMovementSpeed);

  return { elapsedMinutes, radiusMetres, movementMode };
}

function updateSearchZone() {
  if (!latestSightingForZone) return;

  const { radiusMetres } = calculateSearchZoneRadius(latestSightingForZone);
  const latLng = [latestSightingForZone.latitude, latestSightingForZone.longitude];

  if (searchZoneCircle) {
    searchZoneCircle.setLatLng(latLng);
    searchZoneCircle.setRadius(radiusMetres);
  } else {
    searchZoneCircle = L.circle(latLng, {
      radius: radiusMetres,
      color: "#ff0000",
      weight: 3,
      opacity: 1,
      fillColor: "#ff0000",
      fillOpacity: 0.12,
      dashArray: "10, 8"
    }).addTo(searchZoneLayer);
  }

  searchZoneCircle.bindTooltip("Estimated search zone only", {
    permanent: false,
    direction: "top",
    className: "case-map-label"
  });

  updateSearchZoneMetrics(latestSightingForZone);
}

function updateSearchZoneMetrics(sighting) {
  const metrics = document.getElementById("searchZoneMetrics");
  if (!metrics) return;

  if (!sighting) {
    metrics.textContent = "Search zone metrics will appear after a case is loaded.";
    return;
  }

  const { elapsedMinutes, radiusMetres, movementMode } = calculateSearchZoneRadius(sighting);
  metrics.textContent = `Latest sighting: ${text(sighting.location_name, "Unnamed location")} | Seen: ${formatSightingTime(sighting.seen_at)} | Elapsed: ${Math.floor(elapsedMinutes)} min | Estimated radius: ${formatRadius(radiusMetres)} | Movement mode: ${formatMovementMode(movementMode)}`;
}

function startSearchZoneTimer() {
  if (searchZoneTimer) return;
  searchZoneTimer = setInterval(updateSearchZone, 60000);
}

// ===============================
// SIGHTING TIMELINE
// ===============================
function renderTimeline(sightings) {
  const timeline = document.getElementById("sightingTimeline");
  if (!timeline) return;

  timeline.replaceChildren();

  if (!sightings.length) {
    const empty = document.createElement("article");
    empty.className = "sighting-card";
    const title = document.createElement("h3");
    title.textContent = "No sightings to display";
    const body = document.createElement("p");
    body.textContent = "Search a case number with indexed CCTV sighting records.";
    empty.append(title, body);
    timeline.appendChild(empty);
    return;
  }

  sightings.forEach((sighting, index) => {
    const card = document.createElement("article");
    card.className = "sighting-card";

    const label = document.createElement("span");
    label.className = "sighting-point";
    label.textContent = `Point ${String.fromCharCode(65 + index)}`;

    const title = document.createElement("h3");
    title.textContent = text(sighting.location_name, "Unnamed location");

    const meta = document.createElement("p");
    meta.textContent = `${text(sighting.case_number)} | ${formatSightingTime(sighting.seen_at)}`;

    const movement = document.createElement("p");
    movement.textContent = `Movement mode: ${formatMovementMode(sighting.movement_mode)}`;

    const notes = document.createElement("p");
    notes.textContent = text(sighting.notes, "No additional notes supplied.");

    card.append(label, title, meta, movement, notes);
    timeline.appendChild(card);
  });
}

// ===============================
// LEGACY TEAMMATE CSV PROTOTYPE SECTION
// ===============================
// Legacy prototype data source contributed by teammate.
// Replaced by protected Supabase API for VisionFind integration.
// Kept here as documentation of the original CSV parsing idea.
function parseLegacyCsvRows(textValue) {
  const rows = [];
  let current = [];
  let insideQuotes = false;
  let field = "";

  for (const char of textValue) {
    if (char === "\"") {
      insideQuotes = !insideQuotes;
    } else if (char === "," && !insideQuotes) {
      current.push(field);
      field = "";
    } else if (char === "\n" && !insideQuotes) {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || current.length > 0) {
    current.push(field);
    rows.push(current);
  }

  return rows;
}

document.addEventListener("DOMContentLoaded", initialiseCaseMap);

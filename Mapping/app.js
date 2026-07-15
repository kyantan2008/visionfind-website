// Initialize map centered on Singapore
var map = L.map('map').setView([1.3521, 103.8198], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  minZoom: 11
}).addTo(map);

// Restrict map to Singapore bounds
var singaporeBounds = [
  [1.16, 103.6], // Southwest corner
  [1.47, 104.1]  // Northeast corner
];
map.setMaxBounds(singaporeBounds);
map.on('drag', function() {
  map.panInsideBounds(singaporeBounds, { animate: false });
});

// Toggle: true = always show labels, false = only show on hover
let showLabelsByDefault = true;

function toggleLabels() {
  showLabelsByDefault = !showLabelsByDefault;
  document.getElementById("labelMode").innerText =
    "Labels mode: " + (showLabelsByDefault ? "Always visible" : "Hover only");
}

// Helper: parse CSV safely
function parseCSV(text) {
  const rows = [];
  let current = [], insideQuotes = false, field = "";

  for (let char of text) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      current.push(field);
      field = "";
    } else if (char === '\n' && !insideQuotes) {
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

// Fetch sightings from Google Sheets
async function fetchSightingsFromSheet(caseId) {
    const url = `https://docs.google.com/spreadsheets/d/e/2PACX-1vR7xQlA9J_0kQ8GmVW9Nu3HpwXrwy_G0bnEIsh5wItzqzmG0CPmxdVRUVNRo9MamlVJ7hgvMMBifK2y/pub?gid=623442398&single=true&output=csv`;

  let res = await fetch(url);
  let text = await res.text();

  let rows = parseCSV(text);
  let headers = rows[0];
  let data = rows.slice(1).map(r => {
    return {
      caseId: r[0]?.trim(),
      name: r[1]?.trim(),
      age: r[2]?.trim(),
      condition: r[3]?.trim(),
      coords: r[4]?.trim(), // "lat,lon"
      lastDate: r[5]?.trim(),
      lastTime: r[6]?.trim()
    };
  });

  console.log("Fetched data:", data); // DEBUG: see what’s coming in

  // Filter by Case ID
  return data.filter(d => d.caseId === caseId).sort((a,b) =>
    new Date(b.lastDate + " " + b.lastTime) - new Date(a.lastDate + " " + a.lastTime)
  );
}

async function loadSightings() {
  let caseId = document.getElementById("personName").value.trim();
  let data = await fetchSightingsFromSheet(caseId);

  if (data.length === 0) {
    alert("No data for Case ID " + caseId);
    return;
  }

  // Clear old markers/routes
  map.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.GeoJSON) map.removeLayer(layer);
  });

  let coords = [];
  data.forEach(s => {
    if (!s.coords) return;
    let [lat, lon] = s.coords.split(",").map(Number);
    let marker = L.marker([lat, lon]).addTo(map);

    let label = `${s.lastDate} ${s.lastTime}`;
    if (showLabelsByDefault) {
      marker.bindTooltip(label, { permanent: true, direction: "right" });
    } else {
      marker.bindTooltip(label, { permanent: false });
    }

    coords.push([lat, lon]);
  });

  if (coords.length === 0) return;

  // Animate to most recent sighting
  let [latestLat, latestLon] = data[0].coords.split(",").map(Number);
  map.flyTo([latestLat, latestLon], 16, { animate: true, duration: 2 });

  // Fit bounds to all sightings
  let bounds = L.latLngBounds(coords);
  map.flyToBounds(bounds, { padding: [50, 50], animate: true, duration: 2 });

  // Draw walking route
  let url = `http://router.project-osrm.org/route/v1/foot/${coords.map(c=>c[1]+','+c[0]).join(';')}?overview=full&geometries=geojson`;
  fetch(url)
    .then(res => res.json())
    .then(route => {
      if(route.routes && route.routes.length > 0) {
        L.geoJSON(route.routes[0].geometry).addTo(map);
      }
    });
}

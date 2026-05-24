// Weekly refresh script — fetches all Delek stations and saves to stations.json
// Scheduled: every Saturday at 02:00 via Windows Task Scheduler

const fs   = require('fs');
const path = require('path');
const OUT  = path.join(__dirname, 'stations.json');

// ── Overpass fetch ────────────────────────────────────────────────────────────
async function fetchOverpass() {
  const bbox  = '29.0,34.2,33.5,36.0'; // Israel bounding box
  const query = `[out:json][timeout:60];(
    node["amenity"="fuel"]["brand"~"[Dd]elek|דלק"](${bbox});
    node["amenity"="fuel"]["operator"~"[Dd]elek|דלק"](${bbox});
    node["amenity"="fuel"]["name"~"[Dd]elek|דלק"](${bbox});
    way["amenity"="fuel"]["brand"~"[Dd]elek|דלק"](${bbox});
    way["amenity"="fuel"]["operator"~"[Dd]elek|דלק"](${bbox});
    way["amenity"="fuel"]["name"~"[Dd]elek|דלק"](${bbox});
  );out center;`;

  console.log('→ Fetching from Overpass API...');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', body: query,
    headers: { 'User-Agent': 'DekelStationsRefresher/1.0' }
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

// ── Parse ─────────────────────────────────────────────────────────────────────
function buildName(t, street, houseNo, city) {
  const raw = (t.name || t.brand || t.operator || '').trim();
  const generic = !raw || /^(delek|דלק|תחנת דלק)$/i.test(raw);
  if (!generic) return raw;
  const sp = street ? street + (houseNo ? ' ' + houseNo : '') : '';
  if (sp && city) return `דלק ${sp}, ${city}`;
  if (sp)         return `דלק ${sp}`;
  if (city)       return `דלק ${city}`;
  return 'תחנת דלק';
}

function parse(data) {
  const seen = new Set(), out = [];
  for (const el of data.elements) {
    let lat, lon;
    if (el.type === 'node')   { lat = el.lat;        lon = el.lon; }
    else if (el.center)       { lat = el.center.lat;  lon = el.center.lon; }
    if (!lat || !lon) continue;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t  = el.tags || {};
    const street  = t['addr:street']      || '';
    const houseNo = t['addr:housenumber'] || '';
    const city    = t['addr:city'] || t['addr:town'] || t['addr:village'] || '';
    const addr    = [street + (houseNo ? ' ' + houseNo : ''), city].filter(Boolean).join(', ');
    out.push({ id: el.id, lat, lon, name: buildName(t, street, houseNo, city), addr });
  }
  return out;
}

// ── Reverse geocode stations that are missing an address ──────────────────────
async function geocodeMissing(stations) {
  const todo = stations.filter(s => !s.addr);
  if (!todo.length) { console.log('→ All stations already have addresses.'); return; }
  console.log(`→ Reverse-geocoding ${todo.length} stations (one per second)...`);
  for (let i = 0; i < todo.length; i++) {
    const s = todo[i];
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${s.lat}&lon=${s.lon}&format=json&accept-language=he&zoom=18`,
        { headers: { 'User-Agent': 'DekelStationsRefresher/1.0' } }
      );
      if (res.ok) {
        const a = (await res.json()).address || {};
        const street  = a.road || a.pedestrian || a.footway || '';
        const houseNo = a.house_number || '';
        const city    = a.city || a.town || a.village || a.suburb || a.neighbourhood || '';
        const sp      = street + (houseNo ? ' ' + houseNo : '');
        s.addr = [sp, city].filter(Boolean).join(', ');
        s.name = buildName({}, street, houseNo, city);
      }
    } catch (_) { /* keep going */ }
    process.stdout.write(`\r  ${i + 1}/${todo.length} — ${s.name.padEnd(40)}`);
    await new Promise(r => setTimeout(r, 1100)); // Nominatim: max 1 req/sec
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  const start = Date.now();
  console.log(`\n====== Delek Stations Refresh ======`);
  console.log(`Time: ${new Date().toISOString()}\n`);
  try {
    const raw      = await fetchOverpass();
    const stations = parse(raw);
    console.log(`→ Found ${stations.length} stations.`);

    await geocodeMissing(stations);

    const result = { generated: new Date().toISOString(), count: stations.length, stations };
    fs.writeFileSync(OUT, JSON.stringify(result), 'utf8');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✓ Saved ${stations.length} stations to stations.json (${elapsed}s)`);
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
})();

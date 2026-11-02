// Các công cụ mà LLM orchestrator được phép gọi: geocode, lấy quãng đường (Google Maps / OSRM), dự đoán bằng mô hình.
const MODEL_URL = process.env.MODEL_URL || 'http://127.0.0.1:8000';
const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const UA = { 'User-Agent': 'UNETI-Olympic-AI-2026-taxi-app' };
// Khung New York của dữ liệu huấn luyện, dùng để ưu tiên kết quả tìm địa điểm
const NYC_BOX = { west: -74.27, south: 40.49, east: -73.68, north: 40.92 };

export const hasGoogleKey = () => Boolean(GOOGLE_KEY);

async function getJson(url, options = {}) {
  const r = await fetch(url, options);
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${url.split('?')[0]} trả về ${r.status}: ${text.slice(0, 160)}`);
  }
  if (!r.ok) throw new Error(body.detail || body.error_message || `HTTP ${r.status}`);
  return body;
}

export function modelApi(path, body) {
  return getJson(`${MODEL_URL}${path}`, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function googleMapsLinks(pickup, dropoff) {
  const o = `${pickup.lat},${pickup.lon}`;
  const d = `${dropoff.lat},${dropoff.lon}`;
  return { directions: `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving` };
}

async function geocodeGoogle(query) {
  const bounds = `${NYC_BOX.south},${NYC_BOX.west}|${NYC_BOX.north},${NYC_BOX.east}`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}`
    + `&bounds=${encodeURIComponent(bounds)}&region=us&language=vi&key=${GOOGLE_KEY}`;
  const j = await getJson(url);
  if (j.status !== 'OK' || !j.results.length) return null;
  const g = j.results[0];
  return { name: g.formatted_address, lat: g.geometry.location.lat, lon: g.geometry.location.lng, source: 'Google Maps' };
}

async function geocodeNominatim(query, bounded) {
  const vb = `${NYC_BOX.west},${NYC_BOX.north},${NYC_BOX.east},${NYC_BOX.south}`;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=vi,en`
    + `&viewbox=${vb}&bounded=${bounded ? 1 : 0}&q=${encodeURIComponent(query)}`;
  const j = await getJson(url, { headers: UA });
  if (!j.length) return null;
  return { name: j[0].display_name, lat: Number(j[0].lat), lon: Number(j[0].lon), source: 'OpenStreetMap' };
}

// Photon (komoot) – geocoder OpenStreetMap dự phòng khi Nominatim không truy cập được
async function geocodePhoton(query, bounded) {
  const bbox = bounded ? `&bbox=${NYC_BOX.west},${NYC_BOX.south},${NYC_BOX.east},${NYC_BOX.north}` : '';
  const tim = (loc = '') => getJson(`https://photon.komoot.io/api/?limit=1&lat=40.75&lon=-73.97${bbox}${loc}`
    + `&q=${encodeURIComponent(query)}`, { headers: UA }).then((j) => j.features?.[0]);
  // "JFK Airport" dễ khớp nhầm ga tàu / bãi đỗ xe có chữ Airport -> hỏi sân bay thì tìm trong các sân bay trước
  const hoiSanBay = /airport|sân bay|san bay|\bjfk\b|laguardia|\blga\b|newark|\bewr\b/i.test(query);
  const f = (hoiSanBay && (await tim('&osm_tag=aeroway:aerodrome'))) || (await tim());
  if (!f) return null;
  const p = f.properties;
  const name = [p.name, p.street && [p.housenumber, p.street].filter(Boolean).join(' '), p.city || p.district, p.state]
    .filter(Boolean).join(', ');
  return { name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], source: 'OpenStreetMap (Photon)' };
}

export async function geocodePlace({ query }) {
  const nguon = [
    ...(GOOGLE_KEY ? [() => geocodeGoogle(query)] : []),
    () => geocodeNominatim(query, true),
    () => geocodePhoton(query, true),
    () => geocodeNominatim(query, false),
    () => geocodePhoton(query, false),
  ];
  let loi;
  for (const thu of nguon) {
    try {
      const r = await thu();
      if (r) return r;
    } catch (e) {
      loi = e; // dịch vụ lỗi/không truy cập được -> thử nguồn tiếp theo
    }
  }
  throw new Error(loi && !GOOGLE_KEY ? `Không tra được địa điểm "${query}" (${loi.message})` : `Không tìm thấy địa điểm "${query}"`);
}

async function googleDistance(pickup, dropoff) {
  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
    + `?origins=${pickup.lat},${pickup.lon}&destinations=${dropoff.lat},${dropoff.lon}`
    + `&mode=driving&departure_time=now&language=vi&key=${GOOGLE_KEY}`;
  const j = await getJson(url);
  const e = j.rows?.[0]?.elements?.[0];
  if (j.status !== 'OK' || e?.status !== 'OK') throw new Error(`Google Distance Matrix: ${j.status}/${e?.status}`);
  return {
    km: e.distance.value / 1000,
    min: e.duration.value / 60,
    min_traffic: e.duration_in_traffic ? e.duration_in_traffic.value / 60 : null,
  };
}

// Quãng đường cho 2 điểm: chim bay (haversine) + đường thực tế (Google Maps nếu có key, OSRM luôn có).
// Mô hình được huấn luyện với road_km_osrm/road_min_osrm tính theo ô 0,01° nên model_inputs lấy đúng nguồn đó.
export async function getRouteDistances({ pickup, dropoff }) {
  const [r, google] = await Promise.all([
    modelApi('/route', { pickup, dropoff }),
    GOOGLE_KEY ? googleDistance(pickup, dropoff).catch((e) => ({ error: e.message })) : Promise.resolve(null),
  ]);
  return {
    pickup,
    dropoff,
    straight_line_km: r.straight_line_km,
    road_google: google,
    road_osrm: r.osrm_exact ? { km: r.osrm_exact.km, min: r.osrm_exact.min } : null,
    geometry: r.osrm_exact?.geometry || null,
    in_nyc: r.in_nyc,
    model_inputs: r.model_road && {
      straight_line_km_approx: r.straight_line_km_approx,
      road_km_osrm: r.model_road.road_km_osrm,
      road_min_osrm: r.model_road.road_min_osrm,
      source: r.model_road.source,
    },
    google_maps: googleMapsLinks(pickup, dropoff),
  };
}

export function predictTripDuration(args) {
  return modelApi('/predict', args);
}

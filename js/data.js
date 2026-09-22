// Acceso a servicios externos (todos gratuitos, sin API key, con CORS habilitado).
//  - Open-Meteo Historical API (reanálisis ERA5-Land 0.1°, 1950–presente)
//  - Open-Meteo Elevation API (DEM Copernicus 90 m)
//  - Nominatim / OpenStreetMap (geocodificación de vereda y municipio)
import { dailyToMonthly } from './climate.js';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
export const START_DATE = '1950-01-01';

export const DEPARTAMENTOS = [
  'Amazonas', 'Antioquia', 'Arauca', 'Atlántico', 'Bogotá D.C.', 'Bolívar', 'Boyacá', 'Caldas',
  'Caquetá', 'Casanare', 'Cauca', 'Cesar', 'Chocó', 'Córdoba', 'Cundinamarca', 'Guainía',
  'Guaviare', 'Huila', 'La Guajira', 'Magdalena', 'Meta', 'Nariño', 'Norte de Santander',
  'Putumayo', 'Quindío', 'Risaralda', 'San Andrés y Providencia', 'Santander', 'Sucre',
  'Tolima', 'Valle del Cauca', 'Vaupés', 'Vichada',
];

// Último día del mes más reciente cuyos datos ERA5 ya están publicados (retraso ~5 días).
export function lastCompleteMonthEnd(today = new Date()) {
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 7));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return end.toISOString().slice(0, 10);
}

async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.reason || `HTTP ${r.status}`);
  return j;
}

function cacheGet(key) {
  try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function cacheSet(key, v) {
  try { sessionStorage.setItem(key, JSON.stringify(v)); } catch { /* cuota llena o bloqueado */ }
}

export async function fetchMonthlyClimate(lat, lon) {
  const end = lastCompleteMonthEnd();
  const key = `clim:${lat.toFixed(3)}:${lon.toFixed(3)}:${end}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const params = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    start_date: START_DATE, end_date: end,
    daily: 'precipitation_sum,et0_fao_evapotranspiration,temperature_2m_max',
    timezone: 'America/Bogota',
  });
  let j, model = 'era5_land';
  try {
    j = await getJSON(`${ARCHIVE}?${params}&models=era5_land`);
  } catch {
    model = 'era5';
    j = await getJSON(`${ARCHIVE}?${params}&models=era5`);
  }
  const out = { model, end, gridElevation: j.elevation, monthly: dailyToMonthly(j.daily) };
  cacheSet(key, out);
  return out;
}

export async function fetchElevation(lat, lon) {
  try {
    const j = await getJSON(`${ELEVATION}?latitude=${lat}&longitude=${lon}`);
    return j.elevation?.[0] ?? null;
  } catch { return null; }
}

async function nominatim(q, extra = {}) {
  const p = new URLSearchParams({ format: 'jsonv2', countrycodes: 'co', limit: '5', 'accept-language': 'es', q, ...extra });
  return getJSON(`${NOMINATIM}/search?${p}`);
}

// Devuelve { lat, lon, precision: 'vereda'|'municipio', label, bbox }
export async function geocode(departamento, municipio, vereda) {
  const muni = await nominatim(`${municipio}, ${departamento}, Colombia`);
  if (!muni.length) throw new Error(`No se encontró el municipio "${municipio}" en ${departamento}.`);
  const m = muni[0];
  const bbox = m.boundingbox.map(Number); // [latS, latN, lonW, lonE]
  if (vereda && vereda.trim()) {
    const viewbox = `${bbox[2]},${bbox[1]},${bbox[3]},${bbox[0]}`;
    for (const q of [`${vereda}, ${municipio}`, `vereda ${vereda}`, vereda]) {
      const res = await nominatim(q, { viewbox, bounded: '1' });
      if (res.length) {
        return { lat: +res[0].lat, lon: +res[0].lon, precision: 'vereda', label: res[0].display_name, bbox };
      }
    }
  }
  return { lat: +m.lat, lon: +m.lon, precision: 'municipio', label: m.display_name, bbox };
}

export async function reverseGeocode(lat, lon) {
  try {
    const p = new URLSearchParams({ format: 'jsonv2', lat, lon, zoom: '14', 'accept-language': 'es' });
    const j = await getJSON(`${NOMINATIM}/reverse?${p}`);
    const a = j.address || {};
    const place = a.hamlet || a.village || a.neighbourhood || a.suburb || '';
    const muni = a.town || a.city || a.municipality || a.county || '';
    return [place, muni, a.state].filter(Boolean).join(', ');
  } catch { return ''; }
}

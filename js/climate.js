// Agregación de datos diarios ERA5-Land a mensual y construcción de la base de regresión.
import { mean, sd } from './stats.js';

export const REF_START = 1991; // normal climatológica OMM 1991-2020
export const REF_END = 2020;
const MIN_DAY_FRACTION = 0.9;

// daily: { time: ['1950-01-01', ...], precipitation_sum: [...], et0_fao_evapotranspiration: [...], temperature_2m_max: [...] }
export function dailyToMonthly(daily) {
  const acc = new Map();
  const n = daily.time.length;
  for (let i = 0; i < n; i++) {
    const [ys, ms] = daily.time[i].split('-');
    const key = `${ys}-${ms}`;
    let a = acc.get(key);
    if (!a) {
      a = { y: +ys, m: +ms - 1, P: 0, E: 0, T: 0, nP: 0, nE: 0, nT: 0 };
      acc.set(key, a);
    }
    const p = daily.precipitation_sum[i];
    const e = daily.et0_fao_evapotranspiration[i];
    const t = daily.temperature_2m_max[i];
    if (p != null) { a.P += p; a.nP++; }
    if (e != null) { a.E += e; a.nE++; }
    if (t != null) { a.T += t; a.nT++; }
  }
  const out = [];
  for (const a of acc.values()) {
    const days = new Date(Date.UTC(a.y, a.m + 1, 0)).getUTCDate();
    const ok = Math.min(a.nP, a.nE, a.nT) >= MIN_DAY_FRACTION * days;
    // Sumas escaladas por días faltantes (≤10 %) para no sesgar el mes.
    out.push({
      y: a.y, m: a.m,
      P: ok ? (a.P * days) / a.nP : null,
      ET0: ok ? (a.E * days) / a.nE : null,
      Tmax: ok ? a.T / a.nT : null,
    });
  }
  out.sort((u, v) => u.y - v.y || u.m - v.m);
  return out;
}

export function oniAt(ONI, y, m) {
  // m puede ser -1 (diciembre del año anterior)
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const row = ONI[yy];
  return row && row[mm] != null ? row[mm] : null;
}

// Construye, por mes calendario, filas {year, oni, D3, Tmax, P} con las variables estandarizadas.
// D3: balance hídrico climático P − ET0 acumulado en 3 meses (m-2..m), índice tipo SPEI-3.
// Predictor: ONI del trimestre centrado en m-1 (es decir, el mismo trimestre m-2..m).
export function buildDataset(monthly, ONI) {
  const byKey = new Map(monthly.map((r) => [r.y * 12 + r.m, r]));
  const rows = Array.from({ length: 12 }, () => []);
  for (const r of monthly) {
    const k = r.y * 12 + r.m;
    const w = [byKey.get(k - 2), byKey.get(k - 1), r];
    if (w.some((x) => !x || x.P == null)) continue;
    const oni = oniAt(ONI, r.y, r.m - 1);
    if (oni == null) continue;
    rows[r.m].push({
      year: r.y,
      oni,
      D3: w.reduce((s, x) => s + x.P - x.ET0, 0),
      Tmax: r.Tmax,
      P: r.P,
    });
  }
  const clim = rows.map((list) => {
    const ref = list.filter((r) => r.year >= REF_START && r.year <= REF_END);
    const base = ref.length >= 20 ? ref : list;
    const c = {};
    for (const v of ['D3', 'Tmax', 'P']) {
      const vals = base.map((r) => r[v]);
      c[v] = { mean: mean(vals), sd: sd(vals) };
    }
    return c;
  });
  rows.forEach((list, m) => list.forEach((r) => {
    r.zD3 = (r.D3 - clim[m].D3.mean) / clim[m].D3.sd;
    r.zT = (r.Tmax - clim[m].Tmax.mean) / clim[m].Tmax.sd;
    r.zP = (r.P - clim[m].P.mean) / clim[m].P.sd;
  }));
  return { rows, clim };
}

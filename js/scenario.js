// Eventos El Niño históricos y trayectoria de ONI para un escenario (moderado / fuerte / super Niño).
import { mean } from './stats.js';
import { oniAt } from './climate.js';

export const SCENARIOS = {
  moderado: { label: 'El Niño moderado', peak: 1.2 },
  fuerte: { label: 'El Niño fuerte', peak: 1.8 },
  super: { label: 'Super Niño', peak: 2.4 },
};

export function classify(peak) {
  if (peak >= 2.0) return 'Super Niño (muy fuerte)';
  if (peak >= 1.5) return 'Fuerte';
  if (peak >= 1.0) return 'Moderado';
  return 'Débil';
}

function flatten(ONI) {
  const years = Object.keys(ONI).map(Number).sort((a, b) => a - b);
  const out = [];
  for (const y of years) ONI[y].forEach((v, m) => { if (v != null) out.push({ y, m, v }); });
  return out;
}

// Definición operativa NOAA: ONI ≥ +0.5 durante ≥ 5 trimestres consecutivos.
export function findElNinoEvents(ONI) {
  const s = flatten(ONI);
  const events = [];
  let i = 0;
  while (i < s.length) {
    if (s[i].v >= 0.5) {
      let j = i;
      while (j + 1 < s.length && s[j + 1].v >= 0.5) j++;
      if (j - i + 1 >= 5) {
        let pk = i;
        for (let k = i; k <= j; k++) if (s[k].v > s[pk].v) pk = k;
        const p = s[pk];
        events.push({
          start: s[i], end: s[j], peak: p.v, peakY: p.y, peakM: p.m,
          year0: p.m >= 5 ? p.y : p.y - 1, // año de desarrollo del evento
          ongoing: j === s.length - 1,
          class: classify(p.v),
        });
      }
      i = j + 1;
    } else i++;
  }
  return events;
}

// Forma media normalizada del ONI desde ene(-1) hasta dic(+1) (36 meses) para eventos con pico ≥ minPeak.
export function oniTemplate(ONI, minPeak = 1.5) {
  const evs = findElNinoEvents(ONI).filter((e) => e.peak >= minPeak && !e.ongoing);
  const shape = Array(36).fill(0);
  const cnt = Array(36).fill(0);
  for (const e of evs) {
    for (let k = 0; k < 36; k++) {
      const v = oniAt(ONI, e.year0 - 1, k);
      if (v == null) continue;
      shape[k] += v / e.peak;
      cnt[k]++;
    }
  }
  const out = shape.map((s, k) => (cnt[k] ? s / cnt[k] : 0));
  const mx = Math.max(...out);
  return { shape: out.map((v) => v / mx), events: evs };
}

// Devuelve los 12 meses de proyección {y, m, oni} desde (startY, startM) para un evento
// cuyo año de desarrollo es year0 y cuyo pico es `peak`.
export function scenarioTrajectory(template, peak, year0, startY, startM, months = 12) {
  const out = [];
  for (let i = 0; i < months; i++) {
    const abs = startY * 12 + startM + i;
    const y = Math.floor(abs / 12), m = abs % 12;
    // El predictor de un mes m es el ONI centrado en m-1 (ver climate.buildDataset)
    const k = (y - (year0 - 1)) * 12 + (m - 1);
    const oni = k >= 0 && k < 36 ? template.shape[k] * peak : 0;
    out.push({ y, m, oni });
  }
  return out;
}

export function meanPeak(events) {
  return mean(events.map((e) => e.peak));
}

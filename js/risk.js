// Modelo de amenaza condicionado a ENOS + Índice de Riesgo Climático para Café (IRCC).
//
// Para cada mes calendario m y variable estandarizada z (D3 = balance hídrico 3 meses, Tmax):
//     z_{m,año} = b0 + b1·ONI + b2·(año − 2000)/10 + e
// b1 = señal ENOS local; b2 = tendencia (calentamiento), para no confundir ENOS con tendencia.
// Probabilidad de mes estresante bajo el escenario = P(z < −0.8416) (seco, percentil 20)
// o P(z > +0.8416) (caliente, percentil 80), usando la distribución empírica de residuos
// inflada por la incertidumbre de parámetros (√(1+h0)). Incertidumbre total por bootstrap
// de años completos (preserva la dependencia entre meses del mismo año).
import { ols, leverage, quantile, rng, benjaminiHochberg } from './stats.js';

export const Z20 = 0.8416; // cuantil 80 de la normal estándar
const VARS = ['zD3', 'zT', 'zP'];

const design = (oni, year) => [1, oni, (year - 2000) / 10];

export function fitMonth(rows, v) {
  const r = rows.filter((x) => Number.isFinite(x[v]));
  return ols(r.map((x) => design(x.oni, x.year)), r.map((x) => x[v]));
}

export function fitAll(rowsByMonth) {
  return rowsByMonth.map((rows) => Object.fromEntries(VARS.map((v) => [v, fitMonth(rows, v)])));
}

// Probabilidad de exceder el umbral: dir = -1 (z < −Z20) o +1 (z > +Z20)
export function exceedProb(fit, x0, dir) {
  const mu = x0.reduce((s, v, j) => s + v * fit.beta[j], 0);
  const infl = Math.sqrt((fit.n / fit.df) * (1 + leverage(fit.XtXinv, x0)));
  let c = 0;
  for (const e of fit.resid) {
    const z = mu + e * infl;
    if (dir < 0 ? z < -Z20 : z > Z20) c++;
  }
  return c / fit.resid.length;
}

export function irc(calendar, pd, ph) {
  let num = 0, den = 0;
  calendar.forEach((c, i) => { num += c.Sd * pd[i] + c.Sh * ph[i]; den += c.Sd + c.Sh; });
  return (100 * num) / den;
}

function monthProbs(fits, trajectory) {
  const pdS = [], phS = [], pdN = [], phN = [];
  trajectory.forEach(({ y, m, oni }) => {
    const f = fits[m];
    const xs = design(oni, y), xn = design(0, y);
    pdS.push(exceedProb(f.zD3, xs, -1));
    phS.push(exceedProb(f.zT, xs, +1));
    pdN.push(exceedProb(f.zD3, xn, -1));
    phN.push(exceedProb(f.zT, xn, +1));
  });
  return { pdS, phS, pdN, phN };
}

export function category(v) {
  if (v < 25) return { key: 'bajo', label: 'Bajo' };
  if (v < 35) return { key: 'moderado', label: 'Moderado' };
  if (v < 50) return { key: 'alto', label: 'Alto' };
  return { key: 'muyalto', label: 'Muy alto' };
}

/**
 * dataset: salida de climate.buildDataset; trajectory: [{y,m,oni}] (12 meses);
 * calendar: salida de phenology.sensitivityCalendar (mismo largo).
 */
export function computeRisk(dataset, trajectory, calendar, { B = 1000, seed = 20260922 } = {}) {
  const { rows, clim } = dataset;
  const fits = fitAll(rows);
  const pr = monthProbs(fits, trajectory);
  const ircS = irc(calendar, pr.pdS, pr.phS);
  const ircN = irc(calendar, pr.pdN, pr.phN);

  // Significancia de la señal ENOS por mes (pendiente b1) con control FDR (Benjamini-Hochberg).
  const pD = fits.map((f) => f.zD3.p[1]);
  const pT = fits.map((f) => f.zT.p[1]);
  const q = benjaminiHochberg([...pD, ...pT]);
  const qD = q.slice(0, 12), qT = q.slice(12);

  const months = trajectory.map(({ y, m, oni }, i) => {
    const f = fits[m], c = clim[m];
    return {
      y, m, oni,
      ...calendar[i],
      pDry: pr.pdS[i], pDryNeutral: pr.pdN[i],
      pHot: pr.phS[i], pHotNeutral: pr.phN[i],
      dD3mm: f.zD3.beta[1] * oni * c.D3.sd,
      dPpct: (100 * f.zP.beta[1] * oni * c.P.sd) / c.P.mean,
      dTmax: f.zT.beta[1] * oni * c.Tmax.sd,
      slopeD: f.zD3.beta[1], pSlopeD: pD[m], qSlopeD: qD[m],
      slopeT: f.zT.beta[1], pSlopeT: pT[m], qSlopeT: qT[m],
      climP: c.P.mean, climTmax: c.Tmax.mean,
      r2D: f.zD3.r2, nYears: f.zD3.n,
    };
  });

  // Bootstrap por años.
  const years = [...new Set(rows.flat().map((r) => r.year))].sort((a, b) => a - b);
  const byMonthYear = rows.map((list) => {
    const mp = new Map();
    list.forEach((r) => mp.set(r.year, r));
    return mp;
  });
  const rand = rng(seed);
  const bS = [], bN = [], bD = [];
  for (let b = 0; b < B; b++) {
    const sample = years.map(() => years[Math.floor(rand() * years.length)]);
    try {
      const bf = byMonthYear.map((mp) => {
        const rs = sample.map((y) => mp.get(y)).filter(Boolean);
        return { zD3: fitMonth(rs, 'zD3'), zT: fitMonth(rs, 'zT') };
      });
      const p = monthProbs(bf, trajectory);
      const s = irc(calendar, p.pdS, p.phS), n = irc(calendar, p.pdN, p.phN);
      bS.push(s); bN.push(n); bD.push(s - n);
    } catch { /* réplica degenerada: se descarta */ }
  }
  const pBoot = (bD.filter((d) => d <= 0).length + 1) / (bD.length + 1);

  return {
    months,
    irc: ircS,
    ircNeutral: ircN,
    delta: ircS - ircN,
    ratio: ircS / ircN,
    ci: [quantile(bS, 0.05), quantile(bS, 0.95)],
    ciDelta: [quantile(bD, 0.05), quantile(bD, 0.95)],
    pBoot,
    nBoot: bD.length,
    significant: pBoot < 0.05,
    category: category(ircS),
    categoryNeutral: category(ircN),
    nSigMonthsD: qD.filter((x) => x < 0.05).length,
    nSigMonthsT: qT.filter((x) => x < 0.05).length,
    yearsRange: [years[0], years[years.length - 1]],
  };
}

// Qué pasó realmente en la ubicación durante eventos históricos fuertes, en la misma
// ventana relativa de meses que la proyección (validación empírica / análogos).
export function analogs(dataset, events, trajectory, calendar, year0) {
  const byMonthYear = dataset.rows.map((list) => new Map(list.map((r) => [r.year, r])));
  return events.map((e) => {
    const pd = [], ph = [], zd = [], zt = [];
    trajectory.forEach(({ y, m }) => {
      const r = byMonthYear[m].get(y - year0 + e.year0);
      if (!r) { pd.push(null); return; }
      zd.push(r.zD3); zt.push(r.zT);
      pd.push(r.zD3 < -Z20 ? 1 : 0);
      ph.push(r.zT > Z20 ? 1 : 0);
    });
    if (pd.some((v) => v == null)) return { ...e, available: false };
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      ...e, available: true,
      ircObserved: irc(calendar, pd, ph),
      meanZD3: avg(zd), meanZT: avg(zt),
      dryMonths: pd.reduce((s, v) => s + v, 0),
      hotMonths: ph.reduce((s, v) => s + v, 0),
    };
  });
}

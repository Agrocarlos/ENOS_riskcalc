import test from 'node:test';
import assert from 'node:assert/strict';
import { ONI } from '../data/oni.js';
import { rng, randn } from '../js/stats.js';
import { dailyToMonthly, buildDataset, oniAt } from '../js/climate.js';
import { fitMonth, exceedProb, computeRisk, analogs } from '../js/risk.js';
import { findElNinoEvents, oniTemplate, scenarioTrajectory } from '../js/scenario.js';
import { sensitivityCalendar } from '../js/phenology.js';

// Clima mensual sintético: P y Tmax con efecto ENOS controlado (effP en desviaciones por unidad de ONI).
function synthMonthly(effP, effT, seed) {
  const r = rng(seed);
  const out = [];
  for (let y = 1950; y <= 2024; y++) {
    for (let m = 0; m < 12; m++) {
      const o = oniAt(ONI, y, m) ?? 0;
      const clim = 150 + 80 * Math.sin((2 * Math.PI * m) / 6);
      out.push({
        y, m,
        P: Math.max(0, clim + 45 * (effP * o + randn(r))),
        ET0: 110 + 5 * randn(r),
        Tmax: 24 + 0.8 * (effT * o + randn(r)) + 0.02 * (y - 1950),
      });
    }
  }
  return out;
}

test('dailyToMonthly suma, promedia y descarta meses incompletos', () => {
  const time = [], p = [], e = [], t = [];
  for (let d = 1; d <= 31; d++) { time.push(`2000-01-${String(d).padStart(2, '0')}`); p.push(2); e.push(3); t.push(20 + (d % 2)); }
  for (let d = 1; d <= 10; d++) { time.push(`2000-02-${String(d).padStart(2, '0')}`); p.push(1); e.push(1); t.push(20); }
  const mo = dailyToMonthly({ time, precipitation_sum: p, et0_fao_evapotranspiration: e, temperature_2m_max: t });
  assert.equal(mo[0].P, 62);
  assert.equal(mo[0].ET0, 93);
  assert.ok(Math.abs(mo[0].Tmax - 20.516) < 0.01);
  assert.equal(mo[1].P, null);
});

test('Error tipo I ≈ 5 % sin señal ENOS (prueba de calibración)', () => {
  let rej = 0;
  const N = 400;
  for (let s = 0; s < N; s++) {
    const ds = buildDataset(synthMonthly(0, 0, s + 1), ONI);
    if (fitMonth(ds.rows[0], 'zD3').p[1] < 0.05) rej++;
  }
  const rate = rej / N;
  assert.ok(rate > 0.02 && rate < 0.09, `tasa de rechazo ${rate}`);
});

// Nota: el 20 % climatológico incluye años Niño y Niña; con señal fuerte, un año neutro
// queda por debajo del 20 % (la varianza residual es menor que la total).
test('Con señal seca, P(mes seco | Super Niño) >> P(mes seco | neutro)', () => {
  const ds = buildDataset(synthMonthly(-0.6, 0.6, 7), ONI);
  const f = fitMonth(ds.rows[0], 'zD3');
  assert.ok(f.beta[1] < -0.2 && f.p[1] < 0.01);
  const pN = exceedProb(f, [1, 0, 2.6], -1);
  const pS = exceedProb(f, [1, 2.4, 2.6], -1);
  assert.ok(pN > 0.02 && pN < 0.25, `neutro ${pN}`);
  assert.ok(pS > 0.4 && pS > 3 * pN, `escenario ${pS} vs neutro ${pN}`);
});

test('Eventos El Niño y plantilla de ONI', () => {
  const ev = findElNinoEvents(ONI);
  const e97 = ev.find((e) => e.year0 === 1997);
  const e15 = ev.find((e) => e.year0 === 2015);
  assert.ok(e97 && e97.peak >= 2.3);
  assert.ok(e15 && e15.peak >= 2.5);
  const tpl = oniTemplate(ONI, 1.5);
  assert.ok(tpl.events.length >= 8);
  const peakIdx = tpl.shape.indexOf(1);
  assert.ok(peakIdx >= 20 && peakIdx <= 24, `pico en índice ${peakIdx}`); // oct(0)–ene(+1)
  const tr = scenarioTrajectory(tpl, 2.4, 2026, 2026, 9);
  assert.equal(tr.length, 12);
  assert.ok(Math.max(...tr.map((x) => x.oni)) > 2.2);
  assert.ok(tr[11].oni < 1.0); // decae hacia sep(+1)
});

test('computeRisk: riesgo significativo con señal y no con ruido', () => {
  const tpl = oniTemplate(ONI, 1.5);
  const tr = scenarioTrajectory(tpl, 2.4, 2026, 2026, 9);
  const crop = { ageMonths: 48, zoca: false, pattern: 'centro', elevation: 1500 };
  const cal = sensitivityCalendar(crop, tr);

  const sig = computeRisk(buildDataset(synthMonthly(-0.6, 0.6, 11), ONI), tr, cal, { B: 300 });
  assert.ok(sig.irc > sig.ircNeutral + 10, `${sig.irc} vs ${sig.ircNeutral}`);
  assert.ok(sig.significant && sig.pBoot < 0.01);
  assert.ok(sig.ci[0] < sig.irc && sig.irc < sig.ci[1]);

  const nul = computeRisk(buildDataset(synthMonthly(0, 0, 12), ONI), tr, cal, { B: 300 });
  assert.ok(Math.abs(nul.delta) < 6, `delta nulo ${nul.delta}`);
});

test('analogs reproduce eventos observados', () => {
  const ds = buildDataset(synthMonthly(-0.6, 0.6, 11), ONI);
  const tpl = oniTemplate(ONI, 1.5);
  const tr = scenarioTrajectory(tpl, 2.4, 2026, 2026, 9);
  const cal = sensitivityCalendar({ ageMonths: 48, zoca: false, pattern: 'centro', elevation: 1500 }, tr);
  const an = analogs(ds, tpl.events, tr, cal, 2026);
  const a97 = an.find((a) => a.year0 === 1997);
  assert.ok(a97.available && a97.meanZD3 < 0);
});

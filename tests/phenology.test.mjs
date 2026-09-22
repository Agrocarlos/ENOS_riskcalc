import test from 'node:test';
import assert from 'node:assert/strict';
import { sensitivityCalendar, patternFromLatitude, altitudeHeatFactor } from '../js/phenology.js';

const months = (y, m, n) => Array.from({ length: n }, (_, i) => ({ y: y + Math.floor((m + i) / 12), m: (m + i) % 12 }));

test('siembra nueva: establecimiento y levante', () => {
  const cal = sensitivityCalendar({ ageMonths: 2, zoca: false, pattern: 'centro', elevation: 1500 }, months(2026, 9, 12));
  assert.match(cal[0].stage, /Establecimiento/);
  assert.equal(cal[0].Sd, 1);
  assert.match(cal[8].stage, /Levante/);
});

test('zoca: rebrote menos sensible que siembra nueva', () => {
  const z = sensitivityCalendar({ ageMonths: 80, zoca: true, monthsSinceZoca: 1, pattern: 'centro', elevation: 1500 }, months(2026, 9, 1));
  const s = sensitivityCalendar({ ageMonths: 1, zoca: false, pattern: 'centro', elevation: 1500 }, months(2026, 9, 1));
  assert.match(z[0].stage, /zoca/);
  assert.ok(z[0].Sd < s[0].Sd);
});

test('cafetal productivo zona centro: floración en marzo, expansión abr–jun', () => {
  const cal = sensitivityCalendar({ ageMonths: 48, zoca: false, pattern: 'centro', elevation: 1500 }, months(2027, 0, 12));
  assert.match(cal[2].stage, /Floración/);
  assert.match(cal[4].stage, /Expansión/);
  assert.ok(cal[4].Sd === 1);
});

test('latitud y altitud', () => {
  assert.equal(patternFromLatitude(8), 'norte');
  assert.equal(patternFromLatitude(5), 'centro');
  assert.equal(patternFromLatitude(2), 'sur');
  assert.ok(altitudeHeatFactor(1100) > altitudeHeatFactor(1900));
});

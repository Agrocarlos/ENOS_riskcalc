import test from 'node:test';
import assert from 'node:assert/strict';
import { ols, tTwoSidedP, tCdf, benjaminiHochberg, invert, quantile, rng, randn } from '../js/stats.js';

test('p-valor t de Student coincide con tablas', () => {
  assert.ok(Math.abs(tTwoSidedP(2.0, 10) - 0.07339) < 1e-4);
  assert.ok(Math.abs(tTwoSidedP(1.96, 1e6) - 0.05) < 1e-3);
  assert.ok(Math.abs(tCdf(-2.228, 10) - 0.025) < 1e-3);
});

test('inversa de matriz', () => {
  const A = [[4, 7, 2], [3, 6, 1], [2, 5, 3]];
  const I = invert(A);
  const prod = A.map((r) => I[0].map((_, j) => r.reduce((s, v, k) => s + v * I[k][j], 0)));
  prod.forEach((r, i) => r.forEach((v, j) => assert.ok(Math.abs(v - (i === j ? 1 : 0)) < 1e-10)));
});

test('OLS recupera coeficientes conocidos', () => {
  const r = rng(1);
  const X = [], y = [];
  for (let i = 0; i < 500; i++) {
    const a = randn(r), b = randn(r);
    X.push([1, a, b]);
    y.push(1 + 2 * a - 0.5 * b + 0.1 * randn(r));
  }
  const f = ols(X, y);
  assert.ok(Math.abs(f.beta[0] - 1) < 0.02);
  assert.ok(Math.abs(f.beta[1] - 2) < 0.02);
  assert.ok(Math.abs(f.beta[2] + 0.5) < 0.02);
  assert.ok(f.p[1] < 1e-10);
});

test('Benjamini-Hochberg', () => {
  const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
  assert.deepEqual(q.map((v) => +v.toFixed(4)), [0.04, 0.0533, 0.0533, 0.5]);
});

test('cuantil', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
});

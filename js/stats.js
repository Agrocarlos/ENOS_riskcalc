// Utilidades estadísticas puras (sin dependencias). Todas testeadas en tests/stats.test.mjs.

export function mean(a) {
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function sd(a) {
  const m = mean(a);
  let s = 0;
  for (const v of a) s += (v - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

export function quantile(a, q) {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// PRNG determinista (mulberry32) para que el bootstrap sea reproducible.
export function rng(seed = 12345) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Normal estándar vía Box-Muller (solo para simulaciones en tests).
export function randn(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function logGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// Fracción continua de la beta incompleta (Numerical Recipes, betacf).
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function betaInc(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// P(|T| > |t|) para una t de Student con df grados de libertad.
export function tTwoSidedP(t, df) {
  return betaInc(df / 2, 0.5, df / (df + t * t));
}

export function tCdf(t, df) {
  const p = 0.5 * betaInc(df / 2, 0.5, df / (df + t * t));
  return t >= 0 ? 1 - p : p;
}

// Inversa 3x3 / nxn por Gauss-Jordan (n pequeño).
export function invert(M) {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) throw new Error('Matriz singular');
    [A[c], A[p]] = [A[p], A[c]];
    const piv = A[c][c];
    for (let j = 0; j < 2 * n; j++) A[c][j] /= piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(n));
}

// Mínimos cuadrados ordinarios. X: filas con intercepto incluido.
export function ols(X, y) {
  const n = X.length, p = X[0].length;
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  const inv = invert(XtX);
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * Xty[j], 0));
  const resid = y.map((yi, i) => yi - X[i].reduce((s, v, j) => s + v * beta[j], 0));
  const df = n - p;
  const sigma2 = resid.reduce((s, r) => s + r * r, 0) / df;
  const se = inv.map((row, j) => Math.sqrt(sigma2 * row[j]));
  const t = beta.map((b, j) => b / se[j]);
  const pval = t.map((tj) => tTwoSidedP(tj, df));
  const ssTot = y.reduce((s, v) => s + (v - mean(y)) ** 2, 0);
  const r2 = 1 - resid.reduce((s, r) => s + r * r, 0) / ssTot;
  return { beta, se, t, p: pval, resid, df, sigma: Math.sqrt(sigma2), XtXinv: inv, r2, n };
}

// Palanca de un punto nuevo x0: x0' (X'X)^-1 x0
export function leverage(XtXinv, x0) {
  let h = 0;
  for (let a = 0; a < x0.length; a++) for (let b = 0; b < x0.length; b++) h += x0[a] * XtXinv[a][b] * x0[b];
  return h;
}

// Benjamini-Hochberg: devuelve p ajustados (q-values) en el orden original.
export function benjaminiHochberg(pvals) {
  const m = pvals.length;
  const idx = pvals.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const q = Array(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const [p, i] = idx[k];
    prev = Math.min(prev, (p * m) / (k + 1));
    q[i] = prev;
  }
  return q;
}

// Autocorrelación de rezago 1 (diagnóstico de independencia de residuos).
export function lag1Autocorr(a) {
  const m = mean(a);
  let num = 0, den = 0;
  for (let i = 0; i < a.length; i++) {
    den += (a[i] - m) ** 2;
    if (i > 0) num += (a[i] - m) * (a[i - 1] - m);
  }
  return num / den;
}

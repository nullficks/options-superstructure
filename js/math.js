/**
 * Options Probabilistic Superstructure — Mathematical & Statistical Primitives
 * Brownian Motion with Carry Drift, Reflection Principle, and Information Theory.
 */

function formatIsoDate(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function formatHumanDate(dt) {
  return dt.getUTCDate() + ' ' + MONTH_NAMES[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear();
}

function parseDeribitDte(expStr) {
  const rx = /^(\d+)([A-Z]{3})(\d+)$/;
  const m = rx.exec(expStr);
  if (!m) return 7;
  const dd = Number(m[1]), mmm = m[2], yy = Number(m[3]);
  const dt = new Date(Date.UTC(2000 + yy, MONTHS[mmm], dd, 8, 0, 0));
  return Math.max(1, Math.round((dt.getTime() - Date.now()) / 86400000));
}

function fmtMoney(val) {
  const cur = currentState.currency || '$';
  if (val == null || isNaN(val)) return '—';
  if (val < 10) return cur + val.toFixed(4);
  if (val < 1000) return cur + val.toFixed(2);
  return cur + Math.round(val).toLocaleString('en-US');
}

function buildCustomOptionStratUrl(ticker, legs) {
  const clean = (sym) => {
    const m = /^(.*[CP])(\d{8})$/.exec(sym);
    if (!m) return sym;
    return m[1] + (Number(m[2]) / 1000);
  };
  const parts = legs.map((l) => {
    if (l.isUnderlying) return ticker + 'x' + Math.round(l.qty);
    return '.' + clean(l.symbol) + 'x' + Math.round(l.qty);
  });
  return 'https://optionstrat.com/build/custom/' + ticker + '/' + parts.join(',');
}

function buildDeribitOptionUrl(coin, expStr, instrumentName) {
  return 'https://www.deribit.com/options/' + coin + '/' + coin + '-' + expStr + '/' + instrumentName;
}

/**
 * Standard Normal Cumulative Distribution Function (Abramowitz & Stegun approximation)
 */
function normCdf(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2.0);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Analytical First-Passage (Touch) Probability under Geometric Brownian Motion with Carry Drift (r)
 * Uses the Reflection Principle with constant drift:
 * P(Touch before T) = N(z1) + (Target / Spot)^(2*mu / sigma^2) * N(z2)
 */
function analyticalTouchProbWithDrift(spot, target, tYears, sigma, r) {
  if (tYears <= 0 || sigma <= 0) return 0;
  if ((target >= spot && spot >= target) || Math.abs(target - spot) < 1e-9) return 1.0;
  const isUp = target > spot;
  const mu = r - 0.5 * sigma * sigma;
  const logRatio = Math.log(target / spot);
  const sqrtT = Math.sqrt(tYears);

  const z1 = isUp
    ? (-logRatio + mu * tYears) / (sigma * sqrtT)
    : (logRatio - mu * tYears) / (sigma * sqrtT);
  const z2 = isUp
    ? (-logRatio - mu * tYears) / (sigma * sqrtT)
    : (logRatio + mu * tYears) / (sigma * sqrtT);

  const exponent = (2.0 * mu) / (sigma * sigma);
  const reflectTerm = Math.pow(target / spot, exponent) * normCdf(z2);
  const pTouch = normCdf(z1) + reflectTerm;
  return Math.min(1.0, Math.max(0.0, pTouch));
}

/**
 * Analytical Expiration Probability: P(S_T >= Target | Spot, r, sigma)
 */
function analyticalExpireProbWithDrift(spot, target, tYears, sigma, r) {
  if (tYears <= 0 || sigma <= 0) return 0;
  const isUp = target > spot;
  const mu = r - 0.5 * sigma * sigma;
  const logRatio = Math.log(target / spot);
  const sqrtT = Math.sqrt(tYears);
  const z = isUp
    ? (-logRatio + mu * tYears) / (sigma * sqrtT)
    : (logRatio - mu * tYears) / (sigma * sqrtT);
  return Math.min(1.0, Math.max(0.0, normCdf(z)));
}

/**
 * Shannon Surprisal / Self-Information: I(P) = -log2(P)
 */
function shannonBits(p) {
  if (p <= 0) return Infinity;
  if (p >= 1) return 0;
  return -Math.log2(p);
}

/**
 * Kelly Criterion Optimal Bet Fraction: f* = p - (1-p)/b
 */
function kellyFraction(p, b) {
  if (b <= 0) return 0;
  return p - (1 - p) / b;
}

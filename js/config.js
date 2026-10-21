/**
 * Options Probabilistic Superstructure — Configuration & State Management
 * Pure client-side zero-build module compatible with GitHub Pages and local servers.
 */

const WORKER_URL = 'https://yfina.julian-883.workers.dev';
const localCache = new Map();
const engineCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

let currentState = {
  venue: 'CRYPTO',
  symbol: 'BTC',
  currency: '$',
  spot: 0,
  forward: 0,
  carryApr: 0,
  selectedExp: null,
  dte: 7,
  spreads: [],
  rawCryptoContracts: [],
  rawYahooRoot: null,
  activeTarget: 0
};

function showError(msg) {
  const el = document.getElementById('errorBanner');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = '⚠️ ' + msg;
  }
}

function setStatus(text, isOk) {
  const badge = document.getElementById('engineStatus');
  if (!badge) return;
  badge.textContent = text;
  badge.className = isOk
    ? 'px-2.5 py-1 rounded bg-[#13221b] text-[#3ea87c] border border-[#1e4433] mono'
    : 'px-2.5 py-1 rounded bg-[#2a2215] text-[#d49a42] border border-[#3f311c] mono';
}

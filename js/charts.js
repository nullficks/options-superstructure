/**
 * Options Probabilistic Superstructure — Visx SVG Visualizations & Chart Engines
 * High-performance, GPU-accelerated mathematical SVG paths, Monotone Splines, and Tooltips.
 */

// --- VISX PRIMITIVES: FRITSCH-CARLSON MONOTONE CUBIC SPLINE ---
function monotoneCubicPath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
  if (pts.length === 2) {
    return 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1) + ' L ' + pts[1].x.toFixed(1) + ' ' + pts[1].y.toFixed(1);
  }

  const n = pts.length;
  const d = new Float64Array(n - 1);
  const m = new Float64Array(n);

  for (let k = 0; k < n - 1; k++) {
    const dx = pts[k + 1].x - pts[k].x;
    d[k] = dx === 0 ? 0 : (pts[k + 1].y - pts[k].y) / dx;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) {
    if (d[k - 1] * d[k] <= 0) {
      m[k] = 0;
    } else {
      m[k] = (d[k - 1] + d[k]) / 2;
    }
  }

  for (let k = 0; k < n - 1; k++) {
    if (d[k] === 0) {
      m[k] = 0;
      m[k + 1] = 0;
    } else {
      const alpha = m[k] / d[k];
      const beta = m[k + 1] / d[k];
      const dist = alpha * alpha + beta * beta;
      if (dist > 9) {
        const tau = 3 / Math.sqrt(dist);
        m[k] = tau * alpha * d[k];
        m[k + 1] = tau * beta * d[k];
      }
    }
  }

  let path = 'M ' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
  for (let k = 0; k < n - 1; k++) {
    const dx = (pts[k + 1].x - pts[k].x) / 3;
    const cp1x = pts[k].x + dx;
    const cp1y = pts[k].y + m[k] * dx;
    const cp2x = pts[k + 1].x - dx;
    const cp2y = pts[k + 1].y - m[k + 1] * dx;
    path += ' C ' + cp1x.toFixed(1) + ' ' + cp1y.toFixed(1) + ', ' + cp2x.toFixed(1) + ' ' + cp2y.toFixed(1) + ', ' + pts[k + 1].x.toFixed(1) + ' ' + pts[k + 1].y.toFixed(1);
  }
  return path;
}

// --- VISX FLOATING GLASS TOOLTIP SYSTEM ---
function visxShowTooltip(e, html) {
  const tip = document.getElementById('visxTooltip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.classList.remove('hidden');

  const pad = 16;
  const tipW = 280;
  let left = e.clientX + pad;
  let top = e.clientY - pad;

  if (left + tipW > window.innerWidth) {
    left = e.clientX - tipW - pad;
  }
  if (top < 10) top = 10;

  tip.style.left = Math.max(10, left) + 'px';
  tip.style.top = top + 'px';
}

function visxHideTooltip() {
  const tip = document.getElementById('visxTooltip');
  if (tip) tip.classList.add('hidden');
}

// --- TAB 1: VISX SUPERSTRUCTURE BELL CURVE & TOUCH BARRIER ---
function renderSuperstructureBellChart(spot, forward, target, pTouch, pExpire, spreads) {
  const svg = document.getElementById('bellCurveSvg');
  if (!svg || spot <= 0) return;

  const W = 800, H = 240;
  const L = 60, R = 750, T = 35, B = 205;
  const Wu = R - L, Hu = B - T;

  let minP = spot * 0.85, maxP = spot * 1.15;
  if (spreads && spreads.length > 0) {
    minP = Math.min(minP, spreads[0].target * 0.98);
    maxP = Math.max(maxP, spreads[spreads.length - 1].target * 1.02);
  }
  if (target > 0) {
    minP = Math.min(minP, target * 0.96);
    maxP = Math.max(maxP, target * 1.04);
  }
  if (forward > 0) {
    minP = Math.min(minP, forward * 0.96);
    maxP = Math.max(maxP, forward * 1.04);
  }

  const toX = (p) => L + ((p - minP) / (maxP - minP)) * Wu;
  const fromX = (x) => minP + ((x - L) / Wu) * (maxP - minP);

  const xSpot = Math.max(L, Math.min(R, toX(spot)));
  const xFwd = Math.max(L, Math.min(R, toX(forward > 0 ? forward : spot)));
  const xTarget = Math.max(L, Math.min(R, toX(target)));

  // Lognormal probability density function around Forward (with Carry Drift)
  const dte = Math.max(1, currentState.dte || 7);
  const tYears = dte / 365.0;
  const iv = 0.40;
  const r = (currentState.carryApr || 4.25) / 100.0;
  const mu = Math.log(spot) + (r - 0.5 * iv * iv) * tYears;
  const v = Math.max(1e-4, iv * Math.sqrt(tYears));

  const pts = [];
  const steps = 140;
  let maxDens = 0;
  for (let i = 0; i <= steps; i++) {
    const p = minP + (i / steps) * (maxP - minP);
    if (p <= 0) continue;
    const lnDiff = Math.log(p) - mu;
    const dens = (1.0 / (p * v * Math.sqrt(2 * Math.PI))) * Math.exp(-(lnDiff * lnDiff) / (2 * v * v));
    if (dens > maxDens) maxDens = dens;
    pts.push({ p, dens });
  }

  if (maxDens <= 0) maxDens = 1;
  const toY = (dens) => B - (dens / maxDens) * (Hu * 0.88);
  const coords = pts.map(pt => ({ x: toX(pt.p), y: toY(pt.dens), p: pt.p, dens: pt.dens }));

  // Fritsch-Carlson Monotone Spline
  const dCurve = monotoneCubicPath(coords);
  const dArea = dCurve + ' L ' + coords[coords.length - 1].x.toFixed(1) + ' ' + B + ' L ' + coords[0].x.toFixed(1) + ' ' + B + ' Z';

  const isUp = target >= spot;
  const shadedPts = isUp ? coords.filter(pt => pt.p >= target) : coords.filter(pt => pt.p <= target);
  let dShaded = '';
  if (shadedPts.length > 1) {
    const firstShaded = shadedPts[0];
    const lastShaded = shadedPts[shadedPts.length - 1];
    dShaded = 'M ' + xTarget.toFixed(1) + ' ' + B + ' L ' + xTarget.toFixed(1) + ' ' + toY(firstShaded.dens).toFixed(1) +
      monotoneCubicPath(shadedPts).replace(/^M [0-9.]+ [0-9.]+/, '') +
      ' L ' + lastShaded.x.toFixed(1) + ' ' + B + ' Z';
  }

  const carryDeltaPct = forward > 0 ? ((forward / spot - 1) * 100).toFixed(1) : '0.0';
  const carryDir = Number(carryDeltaPct) >= 0 ? '+' : '';

  svg.innerHTML = `
    <defs>
      <linearGradient id="bellGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3d76b8" stop-opacity="0.38"/>
        <stop offset="100%" stop-color="#3d76b8" stop-opacity="0.02"/>
      </linearGradient>
      <linearGradient id="shadedGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9b88bf" stop-opacity="0.50"/>
        <stop offset="100%" stop-color="#9b88bf" stop-opacity="0.06"/>
      </linearGradient>
      <filter id="visxGlowGreen" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#3da678" flood-opacity="0.75"/>
      </filter>
    </defs>

    <!-- Background Guidelines -->
    <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#232d3b" stroke-width="1"/>
    <line x1="${L}" y1="${B - Hu * 0.5}" x2="${R}" y2="${B - Hu * 0.5}" stroke="#232d3b" stroke-width="1" stroke-dasharray="2,4"/>
    <line x1="${L}" y1="${T}" x2="${R}" y2="${T}" stroke="#232d3b" stroke-width="1" stroke-dasharray="2,4"/>

    <!-- Filled Splines -->
    <path d="${dArea}" fill="url(#bellGrad)"/>
    ${dShaded ? `<path d="${dShaded}" fill="url(#shadedGrad)"/>` : ''}
    <path d="${dCurve}" fill="none" stroke="#3d76b8" stroke-width="2.5" stroke-linejoin="round"/>

    <!-- Spot Line (Aizome Blue) -->
    <line x1="${xSpot}" y1="${T + 12}" x2="${xSpot}" y2="${B}" stroke="#3d76b8" stroke-width="2"/>
    <circle cx="${xSpot}" cy="${B}" r="3.5" fill="#3d76b8"/>
    <rect x="${Math.max(L, xSpot - 38)}" y="${T - 12}" width="76" height="20" rx="4" fill="#151b23" stroke="#3d76b8" stroke-width="1.2"/>
    <text x="${Math.max(L + 38, xSpot)}" y="${T + 2}" font-size="10" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#ebe8e1" text-anchor="middle">
      Spot ${fmtMoney(spot)}
    </text>

    <!-- Forward Line with Carry Drift (Kin-cha Gold) -->
    <line x1="${xFwd}" y1="${T + 15}" x2="${xFwd}" y2="${B}" stroke="#c8963e" stroke-width="1.8" stroke-dasharray="3,3"/>
    <circle cx="${xFwd}" cy="${B}" r="3" fill="#c8963e"/>
    <rect x="${Math.max(L, xFwd - 46)}" y="${T + 14}" width="92" height="18" rx="4" fill="#151b23" stroke="#c8963e" stroke-width="1"/>
    <text x="${Math.max(L + 46, xFwd)}" y="${T + 27}" font-size="9.5" font-family="'JetBrains Mono', monospace" font-weight="600" fill="#c8963e" text-anchor="middle">
      Fwd ${fmtMoney(forward)} (${carryDir}${carryDeltaPct}%)
    </text>

    <!-- Target Barrier Line (Matsu-ba Green with Glow Glyph) -->
    <line x1="${xTarget}" y1="${T - 18}" x2="${xTarget}" y2="${B}" stroke="#3da678" stroke-width="2.5"/>
    <circle cx="${xTarget}" cy="${T - 18}" r="5" fill="#3da678" filter="url(#visxGlowGreen)"/>
    <circle cx="${xTarget}" cy="${T - 18}" r="9" fill="none" stroke="#3da678" stroke-width="1.2" stroke-opacity="0.7"/>

    <!-- Target Barrier Badge -->
    <rect x="${Math.max(L, Math.min(R - 115, xTarget - 57))}" y="${T - 34}" width="115" height="22" rx="4" fill="#13221b" stroke="#3da678" stroke-width="1.5"/>
    <text x="${Math.max(L + 57, Math.min(R - 57, xTarget))}" y="${T - 19}" font-size="10.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#3da678" text-anchor="middle">
      🎯 ${fmtMoney(target)} (${(pTouch * 100).toFixed(1)}%)
    </text>

    <!-- Shaded ITM Expiry Label -->
    ${dShaded ? `
      <text x="${Math.max(L + 45, Math.min(R - 45, isUp ? xTarget + (R - xTarget) / 2 : L + (xTarget - L) / 2))}" y="${B - 10}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#9b88bf" text-anchor="middle">
        P(Expire): ${(pExpire * 100).toFixed(1)}%
      </text>
    ` : ''}

    <!-- Axis Labels -->
    <text x="${L}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">${fmtMoney(minP)}</text>
    <text x="${W / 2}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Εύρος Τιμών Λήξης (Lognormal PDF)</text>
    <text x="${R}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">${fmtMoney(maxP)}</text>

    <!-- Magnetic Crosshair Elements -->
    <g id="bellCrosshairGroup" opacity="0" pointer-events="none">
      <line id="bellCrosshairLine" x1="0" y1="${T}" x2="0" y2="${B}" stroke="#8e99a8" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
      <circle id="bellCrosshairDot" cx="0" cy="0" r="4.5" fill="#ebe8e1" stroke="#3d76b8" stroke-width="2"/>
    </g>
  `;

  // Magnetic hover tracking
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    if (mouseX < L || mouseX > R) {
      visxHideTooltip();
      return;
    }
    const curP = fromX(mouseX);
    const lnDiff = Math.log(curP) - mu;
    const dens = (1.0 / (curP * v * Math.sqrt(2 * Math.PI))) * Math.exp(-(lnDiff * lnDiff) / (2 * v * v));
    const curY = toY(dens);

    const crossGroup = document.getElementById('bellCrosshairGroup');
    const crossLine = document.getElementById('bellCrosshairLine');
    const crossDot = document.getElementById('bellCrosshairDot');

    if (crossGroup && crossLine && crossDot) {
      crossGroup.setAttribute('opacity', '1');
      crossLine.setAttribute('x1', mouseX.toFixed(1));
      crossLine.setAttribute('x2', mouseX.toFixed(1));
      crossDot.setAttribute('cx', mouseX.toFixed(1));
      crossDot.setAttribute('cy', curY.toFixed(1));
    }

    const distSpot = ((curP / spot - 1) * 100).toFixed(1);
    const distFwd = forward > 0 ? ((curP / forward - 1) * 100).toFixed(1) : '—';
    const curPt = analyticalTouchProbWithDrift(spot, curP, tYears, iv, r);
    const curPe = analyticalExpireProbWithDrift(spot, curP, tYears, iv, r);
    const bits = curPt > 0 ? (-Math.log2(curPt)).toFixed(1) : '—';
    const rarity = curPt > 0 ? (1 / curPt).toFixed(1) : '—';
    const regimeBadge = curPt >= 0.5
      ? '<span class="text-[#c8963e] font-bold">Αναμενόμενος Θόρυβος</span>'
      : '<span class="text-[#9b88bf] font-bold">Σπάνιο Alpha</span>';

    visxShowTooltip(e, `
      <div class="font-bold text-[#3d76b8] border-b border-[#232d3b] pb-1 mb-1.5 flex justify-between">
        <span>Τιμή: ${fmtMoney(curP)}</span>
        <span class="text-[#ebe8e1]">${distSpot >= 0 ? '+' : ''}${distSpot}%</span>
      </div>
      <div class="space-y-1 text-[11px]">
        <div class="flex justify-between text-[#8e99a8]"><span>Απόσταση vs Forward:</span> <span class="text-[#c8963e] mono font-bold">${distFwd}%</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Πιθανότητα P(Touch):</span> <span class="text-[#3da678] mono font-bold">${(curPt * 100).toFixed(1)}%</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Πιθανότητα P(Expire):</span> <span class="text-[#9b88bf] mono font-bold">${(curPe * 100).toFixed(1)}%</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Shannon Bits:</span> <span class="text-[#ebe8e1] mono font-bold">${bits} Bits (1 στις ${rarity})</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Καθεστώς Πληροφορίας:</span> <span>${regimeBadge}</span></div>
      </div>
      <div class="text-[10px] text-[#596575] mt-1.5 pt-1 border-t border-[#232d3b]">💡 Κλικ για ορισμό στόχου • Πάτα τα Bits για ανάλυση Shannon</div>
    `);
  };

  svg.onmouseleave = () => {
    const crossGroup = document.getElementById('bellCrosshairGroup');
    if (crossGroup) crossGroup.setAttribute('opacity', '0');
    visxHideTooltip();
  };

  svg.onclick = (e) => {
    const rect = svg.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * W;
    if (clickX >= L && clickX <= R) {
      const clickedP = fromX(clickX);
      const slider = document.getElementById('targetSlider');
      if (slider) {
        slider.value = clickedP;
        onSliderChange(clickedP);
      }
    }
  };
}

// --- TAB 2: VISX TIME-TO-TOUCH TRAJECTORY CHART ---
function renderTimelineCurveChart(spot, target, ivPct, ratePct, days50, days75) {
  const svg = document.getElementById('timelineCurveSvg');
  if (!svg || spot <= 0 || target <= 0) return;

  const W = 800, H = 250;
  const L = 55, R = 750, T = 30, B = 205;
  const Wu = R - L, Hu = B - T;

  const toX = (days) => L + (days / 365.0) * Wu;
  const fromX = (x) => ((x - L) / Wu) * 365.0;
  const toY = (prob) => B - Math.max(0, Math.min(1, prob)) * Hu;

  const sigma = ivPct / 100.0;
  const r = ratePct / 100.0;

  const carryPts = [];
  const naivePts = [];
  for (let d = 1; d <= 365; d += 2) {
    const t = d / 365.0;
    const pCarry = analyticalTouchProbWithDrift(spot, target, t, sigma, r);
    const pNaive = analyticalTouchProbWithDrift(spot, target, t, sigma, 0.0);
    carryPts.push({ x: toX(d), y: toY(pCarry), d, p: pCarry });
    naivePts.push({ x: toX(d), y: toY(pNaive), d, p: pNaive });
  }

  const dCarry = monotoneCubicPath(carryPts);
  const dCarryArea = dCarry + ' L ' + carryPts[carryPts.length - 1].x.toFixed(1) + ' ' + B + ' L ' + carryPts[0].x.toFixed(1) + ' ' + B + ' Z';
  const dNaive = monotoneCubicPath(naivePts);

  const y50 = toY(0.50);
  const y75 = toY(0.75);
  const x50 = days50 && days50 <= 365 ? toX(days50) : null;
  const x75 = days75 && days75 <= 365 ? toX(days75) : null;

  svg.innerHTML = `
    <defs>
      <linearGradient id="tlGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3da678" stop-opacity="0.32"/>
        <stop offset="100%" stop-color="#3da678" stop-opacity="0.02"/>
      </linearGradient>
      <filter id="visxGlowGold" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#c8963e" flood-opacity="0.75"/>
      </filter>
    </defs>

    <!-- Horizontal Probability Gridlines -->
    <line x1="${L}" y1="${toY(1.0)}" x2="${R}" y2="${toY(1.0)}" stroke="#232d3b" stroke-width="1"/>
    <text x="${L - 8}" y="${toY(1.0) + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">100%</text>

    <line x1="${L}" y1="${y75}" x2="${R}" y2="${y75}" stroke="#c8963e" stroke-width="1" stroke-dasharray="3,3" stroke-opacity="0.5"/>
    <text x="${L - 8}" y="${y75 + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#c8963e" text-anchor="end">75%</text>

    <line x1="${L}" y1="${y50}" x2="${R}" y2="${y50}" stroke="#3da678" stroke-width="1" stroke-dasharray="3,3" stroke-opacity="0.5"/>
    <text x="${L - 8}" y="${y50 + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#3da678" text-anchor="end">50%</text>

    <line x1="${L}" y1="${toY(0.25)}" x2="${R}" y2="${toY(0.25)}" stroke="#232d3b" stroke-width="1" stroke-dasharray="2,4"/>
    <text x="${L - 8}" y="${toY(0.25) + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">25%</text>

    <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#232d3b" stroke-width="1"/>
    <text x="${L - 8}" y="${B + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">0%</text>

    <!-- Vertical Time Gridlines -->
    ${[30, 60, 90, 180, 270, 365].map(d => `
      <line x1="${toX(d)}" y1="${T}" x2="${toX(d)}" y2="${B}" stroke="#1e2633" stroke-width="1" stroke-dasharray="2,4"/>
      <text x="${toX(d)}" y="${B + 16}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">${d}d</text>
    `).join('')}

    <!-- Filled Area and Curves -->
    <path d="${dCarryArea}" fill="url(#tlGrad)"/>
    <path d="${dNaive}" fill="none" stroke="#596575" stroke-width="1.8" stroke-dasharray="4,4"/>
    <path d="${dCarry}" fill="none" stroke="#3da678" stroke-width="3" stroke-linejoin="round"/>

    <!-- 50% Median Milestone Callout -->
    ${x50 ? `
      <line x1="${x50}" y1="${y50}" x2="${x50}" y2="${B}" stroke="#3da678" stroke-width="1.5" stroke-dasharray="2,2"/>
      <circle cx="${x50}" cy="${y50}" r="5" fill="#3da678" filter="url(#visxGlowGreen)"/>
      <circle cx="${x50}" cy="${y50}" r="9" fill="none" stroke="#3da678" stroke-width="1.2"/>
      <rect x="${Math.max(L, x50 - 45)}" y="${y50 - 24}" width="90" height="18" rx="4" fill="#13221b" stroke="#3da678" stroke-width="1"/>
      <text x="${Math.max(L + 45, x50)}" y="${y50 - 12}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#3da678" text-anchor="middle">
        50% σε ${days50}d
      </text>
    ` : ''}

    <!-- 75% High Probability Milestone Callout -->
    ${x75 ? `
      <line x1="${x75}" y1="${y75}" x2="${x75}" y2="${B}" stroke="#c8963e" stroke-width="1.5" stroke-dasharray="2,2"/>
      <circle cx="${x75}" cy="${y75}" r="5" fill="#c8963e" filter="url(#visxGlowGold)"/>
      <circle cx="${x75}" cy="${y75}" r="9" fill="none" stroke="#c8963e" stroke-width="1.2"/>
      <rect x="${Math.max(L, x75 - 45)}" y="${y75 - 24}" width="90" height="18" rx="4" fill="#2a2215" stroke="#c8963e" stroke-width="1"/>
      <text x="${Math.max(L + 45, x75)}" y="${y75 - 12}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#c8963e" text-anchor="middle">
        75% σε ${days75}d
      </text>
    ` : ''}

    <!-- Magnetic Crosshair Elements -->
    <g id="tlCrosshairGroup" opacity="0" pointer-events="none">
      <line id="tlCrosshairLine" x1="0" y1="${T}" x2="0" y2="${B}" stroke="#8e99a8" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>
      <circle id="tlCrosshairDot" cx="0" cy="0" r="4.5" fill="#3da678" stroke="#ebe8e1" stroke-width="2"/>
    </g>
  `;

  // Magnetic hover tracking on Timeline
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    if (mouseX < L || mouseX > R) {
      visxHideTooltip();
      return;
    }
    const days = Math.max(1, Math.min(365, Math.round(fromX(mouseX))));
    const t = days / 365.0;
    const pCarry = analyticalTouchProbWithDrift(spot, target, t, sigma, r);
    const pNaive = analyticalTouchProbWithDrift(spot, target, t, sigma, 0.0);
    const curY = toY(pCarry);

    const crossGroup = document.getElementById('tlCrosshairGroup');
    const crossLine = document.getElementById('tlCrosshairLine');
    const crossDot = document.getElementById('tlCrosshairDot');

    if (crossGroup && crossLine && crossDot) {
      crossGroup.setAttribute('opacity', '1');
      crossLine.setAttribute('x1', mouseX.toFixed(1));
      crossLine.setAttribute('x2', mouseX.toFixed(1));
      crossDot.setAttribute('cx', mouseX.toFixed(1));
      crossDot.setAttribute('cy', curY.toFixed(1));
    }

    const targetDate = new Date(Date.now() + days * 86400000);
    const dateStr = targetDate.toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
    const diffPp = ((pCarry - pNaive) * 100).toFixed(1);
    const fairMult = pCarry > 0 ? (1 / pCarry).toFixed(2) + 'x' : '—';

    visxShowTooltip(e, `
      <div class="font-bold text-[#3da678] border-b border-[#232d3b] pb-1 mb-1.5 flex justify-between">
        <span>Ορίζοντας: ${days} ημέρες</span>
        <span class="text-[#8e99a8]">${dateStr}</span>
      </div>
      <div class="space-y-1 text-[11px]">
        <div class="flex justify-between text-[#8e99a8]"><span>P(Touch) με Carry:</span> <span class="text-[#3da678] mono font-bold">${(pCarry * 100).toFixed(1)}%</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>P(Touch) χωρίς Carry:</span> <span class="text-[#596575] mono font-bold">${(pNaive * 100).toFixed(1)}%</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Carry Advantage:</span> <span class="text-[#c8963e] mono font-bold">+${diffPp} pp</span></div>
        <div class="flex justify-between text-[#8e99a8]"><span>Δίκαιο Multiple:</span> <span class="text-[#ebe8e1] mono font-bold">${fairMult}</span></div>
      </div>
    `);
  };

  svg.onmouseleave = () => {
    const crossGroup = document.getElementById('tlCrosshairGroup');
    if (crossGroup) crossGroup.setAttribute('opacity', '0');
    visxHideTooltip();
  };
}

// --- TAB 3: VISX STRADDLES MARKET VOLATILITY CORRIDOR CHART ---
function renderStraddlesCorridorChart(items) {
  const svg = document.getElementById('straddlesCorridorSvg');
  if (!svg || !items || !items.length) return;

  const spot = currentState.spot || items[0].strikeAbsolute;
  const sorted = [...items].sort((a, b) => a.DTE - b.DTE);

  const W = 800, H = 270;
  const L = 60, R = 750, T = 35, B = 225;
  const Wu = R - L, Hu = B - T;

  const maxDte = Math.max(90, Math.max(...sorted.map(s => s.DTE)));
  const maxUp = Math.max(...sorted.map(s => s.breakEvenVsFullMoneyUpAbsolute));
  const minDown = Math.min(...sorted.map(s => s.breakEvenVsFullMoneyDownAbsolute));

  const minP = minDown * 0.96;
  const maxP = maxUp * 1.04;

  const toX = (dte) => L + (dte / maxDte) * Wu;
  const toY = (p) => B - ((p - minP) / (maxP - minP)) * Hu;
  const ySpot = toY(spot);

  const upPts = sorted.map(s => ({ x: toX(s.DTE), y: toY(s.breakEvenVsFullMoneyUpAbsolute), dte: s.DTE, p: s.breakEvenVsFullMoneyUpAbsolute, raw: s }));
  const downPts = sorted.map(s => ({ x: toX(s.DTE), y: toY(s.breakEvenVsFullMoneyDownAbsolute), dte: s.DTE, p: s.breakEvenVsFullMoneyDownAbsolute, raw: s }));

  const dUp = monotoneCubicPath(upPts);
  const dDown = monotoneCubicPath(downPts);

  const revDown = [...downPts].reverse();
  let dCorridorArea = dUp;
  for (const pt of revDown) {
    dCorridorArea += ' L ' + pt.x.toFixed(1) + ' ' + pt.y.toFixed(1);
  }
  dCorridorArea += ' Z';

  svg.innerHTML = `
    <defs>
      <linearGradient id="corridorGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3da678" stop-opacity="0.30"/>
        <stop offset="50%" stop-color="#c8963e" stop-opacity="0.10"/>
        <stop offset="100%" stop-color="#c85648" stop-opacity="0.30"/>
      </linearGradient>
    </defs>

    <line x1="${L}" y1="${ySpot}" x2="${R}" y2="${ySpot}" stroke="#3d76b8" stroke-width="2"/>
    <text x="${L - 8}" y="${ySpot + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#3d76b8" text-anchor="end font-bold">Spot ${fmtMoney(spot)}</text>

    <path d="${dCorridorArea}" fill="url(#corridorGrad)"/>
    <path d="${dUp}" fill="none" stroke="#3da678" stroke-width="2.5"/>
    <path d="${dDown}" fill="none" stroke="#c85648" stroke-width="2.5"/>

    ${upPts.map(pt => `
      <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#3da678" stroke="#151b23" stroke-width="1"/>
    `).join('')}
    ${downPts.map(pt => `
      <circle cx="${pt.x}" cy="${pt.y}" r="4" fill="#c85648" stroke="#151b23" stroke-width="1"/>
    `).join('')}

    <text x="${L}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">1d</text>
    <text x="${W / 2}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Χρονικός Ορίζοντας (Ημέρες DTE)</text>
    <text x="${R}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">${maxDte}d</text>
  `;

  const shortItem = sorted.find(s => s.DTE >= 7 && s.DTE <= 16) || sorted[0];
  const midItem = sorted.find(s => s.DTE >= 25 && s.DTE <= 45) || sorted[Math.floor(sorted.length / 2)];
  const longItem = sorted[sorted.length - 1];

  const cardShort = document.getElementById('straddleCardShort');
  const cardMid = document.getElementById('straddleCardMid');
  const cardLong = document.getElementById('straddleCardLong');

  if (cardShort && shortItem) cardShort.textContent = '±' + (shortItem.impliedCorridorPct / 2).toFixed(1) + '% (' + shortItem.DTE + 'd)';
  if (cardMid && midItem) cardMid.textContent = '±' + (midItem.impliedCorridorPct / 2).toFixed(1) + '% (' + midItem.DTE + 'd)';
  if (cardLong && longItem) cardLong.textContent = '±' + (longItem.impliedCorridorPct / 2).toFixed(1) + '% (' + longItem.DTE + 'd)';
}

// --- TAB 3: VISX VERTICAL SPREADS FRONTIER CHART ---
function renderVsFrontierChart(items) {
  const svg = document.getElementById('vsFrontierSvg');
  if (!svg || !items || !items.length) return;

  const W = 800, H = 270;
  const L = 60, R = 750, T = 35, B = 225;
  const Wu = R - L, Hu = B - T;

  const maxMult = Math.max(10, Math.ceil(Math.max(...items.map(x => x.touchReturnMultiple)) * 1.1));
  const maxProb = Math.min(1.0, Math.max(...items.map(x => x.probTouchBeforeExpiry)) * 1.15);

  const toX = (p) => L + (p / maxProb) * Wu;
  const toY = (m) => B - (m / maxMult) * Hu;

  svg.innerHTML = `
    <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#232d3b" stroke-width="1"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#232d3b" stroke-width="1"/>

    ${[0.25, 0.5, 0.75, 1.0].map(frac => {
      const yVal = maxMult * frac;
      return `
        <line x1="${L}" y1="${toY(yVal)}" x2="${R}" y2="${toY(yVal)}" stroke="#1e2633" stroke-width="1" stroke-dasharray="2,4"/>
        <text x="${L - 8}" y="${toY(yVal) + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">${yVal.toFixed(1)}x</text>
      `;
    }).join('')}

    <text x="${W / 2}" y="${B + 30}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Πιθανότητα Επαφής P(Touch) % →</text>
    <text x="${L + 5}" y="${T - 12}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">Πολλαπλασιαστής (Multiple) ↑</text>

    ${items.slice(0, 80).map(x => {
      const cx = toX(x.probTouchBeforeExpiry);
      const cy = toY(x.touchReturnMultiple);
      return `
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="#3ea87c" fill-opacity="0.8" stroke="#151b23" stroke-width="1" class="cursor-pointer">
          <title>${x.formattedDate} Στόχος: ${fmtMoney(x.target)} | P(Touch): ${(x.probTouchBeforeExpiry * 100).toFixed(1)}% | Multiple: ${x.touchReturnMultiple.toFixed(2)}x</title>
        </circle>
      `;
    }).join('')}
  `;
}

// --- TAB 3: VISX LONG OPTIONS LEVERAGE CHART ---
function renderLongLeverageChart(items) {
  const svg = document.getElementById('longLeverageSvg');
  if (!svg || !items || !items.length) return;

  const W = 800, H = 270;
  const L = 60, R = 750, T = 35, B = 225;
  const Wu = R - L, Hu = B - T;

  const maxLev = Math.max(20, Math.ceil(Math.max(...items.map(x => x.maxLeverage)) * 1.1));
  const spot = currentState.spot || items[0].strikeAbsolute;

  const mapped = items.map(x => ({
    ...x,
    diffPct: ((x.strikeAbsolute / spot - 1) * 100)
  }));

  const minDiff = Math.min(...mapped.map(m => m.diffPct));
  const maxDiff = Math.max(...mapped.map(m => m.diffPct));

  const toX = (diff) => L + ((diff - minDiff) / (maxDiff - minDiff)) * Wu;
  const toY = (lev) => B - (lev / maxLev) * Hu;

  svg.innerHTML = `
    <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#232d3b" stroke-width="1"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#232d3b" stroke-width="1"/>

    <text x="${W / 2}" y="${B + 30}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Απόσταση Strike vs Spot % →</text>
    <text x="${L + 5}" y="${T - 12}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">Πραγματική Μόχλευση (Spot / Premium) ↑</text>

    ${mapped.slice(0, 80).map(x => {
      const cx = toX(x.diffPct);
      const cy = toY(x.maxLeverage);
      const isCall = x.strategyType === 'longCall';
      return `
        <circle cx="${cx}" cy="${cy}" r="4.5" fill="${isCall ? '#3da678' : '#c85648'}" fill-opacity="0.8" stroke="#151b23" stroke-width="1" class="cursor-pointer">
          <title>${x.option} Strike: ${fmtMoney(x.strikeAbsolute)} | Μόχλευση: ${x.maxLeverage.toFixed(1)}x</title>
        </circle>
      `;
    }).join('')}
  `;
}

// --- TAB 4: VISX PUT-CALL PARITY BALANCE & CARRY ARBITRAGE DIAGRAM ---
function renderParityFlowDiagram(spot, ratePct, dte) {
  const svg = document.getElementById('parityFlowSvg');
  if (!svg) return;

  spot = spot || currentState.spot || 200;
  ratePct = ratePct != null ? ratePct : (currentState.carryApr || 4.5);
  dte = dte || currentState.dte || 30;

  const tYears = dte / 365.0;
  const r = ratePct / 100.0;
  const forward = spot * Math.exp(r * tYears);
  const carryDrift = forward - spot;
  const carryPct = ((forward / spot - 1) * 100).toFixed(2);

  svg.innerHTML = `
    <defs>
      <linearGradient id="parityCarryWedge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3d76b8" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#c8963e" stop-opacity="0.75"/>
      </linearGradient>
      <filter id="visxParityGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3.5" flood-color="#c8963e" flood-opacity="0.6"/>
      </filter>
    </defs>

    <line x1="80" y1="130" x2="720" y2="130" stroke="#3a4b61" stroke-width="3" stroke-linecap="round"/>
    <polygon points="400,130 385,160 415,160" fill="#c8963e"/>
    <circle cx="400" cy="130" r="5" fill="#ebe8e1"/>

    <rect x="330" y="80" width="140" height="24" rx="4" fill="#13221b" stroke="#3da678" stroke-width="1.2"/>
    <text x="400" y="96" font-size="10.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#3da678" text-anchor="middle">
      ✓ C - P = S₀ - K&middot;e⁻ʳᵀ
    </text>

    <rect x="90" y="55" width="220" height="70" rx="8" fill="#141c28" stroke="#3d76b8" stroke-width="1.5"/>
    <text x="200" y="76" font-size="11" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#3d76b8" text-anchor="middle">
      ΑΡΙΣΤΕΡΟΣ ΒΡΑΧΙΟΝΑΣ: S₀ + P
    </text>
    <text x="200" y="96" font-size="13" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#ebe8e1" text-anchor="middle">
      Spot: ${fmtMoney(spot)}
    </text>
    <text x="200" y="114" font-size="10" font-family="'Inter', sans-serif" fill="#8e99a8" text-anchor="middle">
      Κατοχή Asset + Ασφάλεια Πτώσης
    </text>

    <rect x="490" y="55" width="220" height="70" rx="8" fill="#241d14" stroke="#c8963e" stroke-width="1.5"/>
    <text x="600" y="76" font-size="11" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#c8963e" text-anchor="middle">
      ΔΕΞΙΟΣ ΒΡΑΧΙΟΝΑΣ: C + K&middot;e⁻ʳᵀ
    </text>
    <text x="600" y="96" font-size="13" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#ebe8e1" text-anchor="middle">
      Forward: ${fmtMoney(forward)} (+${carryPct}%)
    </text>
    <text x="600" y="114" font-size="10" font-family="'Inter', sans-serif" fill="#8e99a8" text-anchor="middle">
      Συνθετικό Asset + Τόκος Χρήματος
    </text>

    <path d="M 120 200 L 680 185 L 680 215 Z" fill="url(#parityCarryWedge)"/>
    <line x1="120" y1="200" x2="680" y2="200" stroke="#8e99a8" stroke-width="1" stroke-dasharray="2,3"/>

    <text x="120" y="222" font-size="9.5" font-family="'JetBrains Mono', monospace" fill="#3d76b8">Spot S₀ = ${fmtMoney(spot)}</text>
    <text x="400" y="196" font-size="10" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#c8963e" text-anchor="middle">
      CARRY WEDGE (r = ${ratePct.toFixed(2)}%, ${dte}d) → +${fmtMoney(carryDrift)}
    </text>
    <text x="680" y="222" font-size="9.5" font-family="'JetBrains Mono', monospace" fill="#c8963e" text-anchor="end">F = ${fmtMoney(forward)}</text>
  `;
}

function updateParityDiagram() {
  const rateSlider = document.getElementById('parityRateSlider');
  const dteSlider = document.getElementById('parityDteSlider');
  const rateLabel = document.getElementById('parityRateLabel');
  const dteLabel = document.getElementById('parityDteLabel');

  const r = rateSlider ? Number(rateSlider.value) : 4.5;
  const d = dteSlider ? Number(dteSlider.value) : 30;

  if (rateLabel) rateLabel.textContent = r.toFixed(2) + '%';
  if (dteLabel) dteLabel.textContent = d + ' ημέρες';

  renderParityFlowDiagram(currentState.spot || 200, r, d);
}

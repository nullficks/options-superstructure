/**
 * Options Probability & Strategy Analyzer — Covered Call Analysis & Payoff Simulation
 * Integrated with TaxEngine for After-Tax Payoff Curves, Rebuy Equivalence & Cliff Loss.
 */

let currentCcItems = [];
let currentCcActiveItem = null;
let currentCcView = 'PAYOFF';

function switchCcView(view) {
  currentCcView = view;
  const payoffContainer = document.getElementById('ccPayoffViewContainer');
  const frontierContainer = document.getElementById('ccFrontierViewContainer');
  const btnPayoff = document.getElementById('btnCcViewPayoff');
  const btnFrontier = document.getElementById('btnCcViewFrontier');
  const badge = document.getElementById('ccCurrentViewBadge');

  if (view === 'PAYOFF') {
    if (payoffContainer) payoffContainer.classList.remove('hidden');
    if (frontierContainer) frontierContainer.classList.add('hidden');
    if (btnPayoff) btnPayoff.className = 'px-3 py-1.5 rounded bg-[#c8963e] text-white font-bold text-xs transition';
    if (btnFrontier) btnFrontier.className = 'px-3 py-1.5 rounded bg-[#1c232e] text-[#8e99a8] hover:text-[#ebe8e1] font-bold text-xs transition';
    if (badge) badge.textContent = 'Payoff Curve';
    if (currentCcActiveItem) renderCoveredCallPayoffChart(currentCcActiveItem);
  } else {
    if (payoffContainer) payoffContainer.classList.add('hidden');
    if (frontierContainer) frontierContainer.classList.remove('hidden');
    if (btnPayoff) btnPayoff.className = 'px-3 py-1.5 rounded bg-[#1c232e] text-[#8e99a8] hover:text-[#ebe8e1] font-bold text-xs transition';
    if (btnFrontier) btnFrontier.className = 'px-3 py-1.5 rounded bg-[#c8963e] text-white font-bold text-xs transition';
    if (badge) badge.textContent = 'Efficient Frontier';
    if (currentCcItems && currentCcItems.length) renderCoveredCallFrontierChart(currentCcItems, currentCcActiveItem);
  }
}

// --- TAB 3: INTERACTIVE COVERED CALL PAYOFF CURVE & SCENARIO SIMULATOR ---
function renderCoveredCallPayoffChart(item, simPrice = null) {
  const svg = document.getElementById('ccPayoffSvg');
  if (!svg || !item) return;

  const spot = currentState.spot || item.strikeAbsolute * 0.95;
  const K = item.strikeAbsolute;
  const BE = item.breakEvenVsFullMoneyAbsolute;
  const P = Math.max(0, spot - BE);
  const maxProf = K - BE;

  // Retrieve Tax & Cost Basis parameters (Praxeological Model)
  const rawBasis = document.getElementById('taxCostBasis')?.value || document.getElementById('stratCostBasis')?.value || document.getElementById('cockpitCostBasis')?.value;
  const taxPct = Number(document.getElementById('taxRateInput')?.value || document.getElementById('stratTaxRate')?.value || document.getElementById('cockpitTaxRate')?.value || 0);
  const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
  const taxRate = TaxEngine.resolveTaxRate(taxPct);
  const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot, taxMode);
  const isTaxActive = taxRate > 0 && (taxMode === 'FRESH' || costBasis !== spot);

  if (simPrice == null) simPrice = K * 1.01;

  const W = 800, H = 270;
  const L = 60, R = 750, T = 35, B = 225;
  const Wu = R - L, Hu = B - T;

  const minPx = Math.max(1, Math.min(spot * 0.78, BE * 0.85));
  const maxPx = Math.max(spot * 1.25, K * 1.20);

  // Pre-tax payoff function (relative to spot acquisition)
  const calcProfit = (p) => (Math.min(p, K) - BE);

  // After-tax net value function (relative to holding spot today)
  const calcAfterTaxProfit = (p) => {
    if (p < K) {
      // OTM: Stock gain (p - costBasis) is unrealized! Only option premium P is taxed.
      const netOption = P * (1 - taxRate);
      return (p + netOption) - spot;
    } else {
      // Assignment: Full realized tax on (K - costBasis + P)
      const assignment = TaxEngine.calcNetCashAtAssignment(K, P, costBasis, taxRate);
      return assignment.netCash - spot;
    }
  };

  const minProf = calcProfit(minPx);
  const maxDisplayProf = Math.max(maxProf * 1.25, Math.abs(minProf) * 0.35);

  const toX = (p) => L + ((p - minPx) / (maxPx - minPx)) * Wu;
  const fromX = (x) => minPx + ((x - L) / Wu) * (maxPx - minPx);
  const toY = (prof) => B - ((prof - minProf) / (maxDisplayProf - minProf)) * Hu;

  const yZero = toY(0);
  const xBE = toX(BE);
  const xSpot = toX(spot);
  const xK = toX(K);
  const yK = toY(maxProf);
  const ySpot = toY(P);

  // Pre-tax Payoff path points
  const p1 = { x: toX(minPx), y: toY(minProf) };
  const pBE = { x: xBE, y: yZero };
  const pSpot = { x: xSpot, y: ySpot };
  const pK = { x: xK, y: yK };
  const pMax = { x: toX(maxPx), y: yK };

  const dPayoff = `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L ${pBE.x.toFixed(1)} ${pBE.y.toFixed(1)} L ${pSpot.x.toFixed(1)} ${pSpot.y.toFixed(1)} L ${pK.x.toFixed(1)} ${pK.y.toFixed(1)} L ${pMax.x.toFixed(1)} ${pMax.y.toFixed(1)}`;

  // Shaded Cushion Zone (Protection from Spot down to Breakeven)
  const dCushion = `M ${pBE.x.toFixed(1)} ${yZero.toFixed(1)} L ${pSpot.x.toFixed(1)} ${pSpot.y.toFixed(1)} L ${pSpot.x.toFixed(1)} ${yZero.toFixed(1)} Z`;

  // Shaded Max Profit Plateau Zone
  const dMaxPlateau = `M ${pK.x.toFixed(1)} ${yK.toFixed(1)} L ${pMax.x.toFixed(1)} ${pMax.y.toFixed(1)} L ${pMax.x.toFixed(1)} ${yZero.toFixed(1)} L ${pK.x.toFixed(1)} ${yZero.toFixed(1)} Z`;

  // After-tax line calculations (Praxeological step-down at K)
  let dAfterTax = '';
  let yCliffTop = yK;
  let yCliffBottom = yK;
  let taxCliffLoss = 0;
  let t2pInfo = null;

  if (isTaxActive) {
    const atMinProf = calcAfterTaxProfit(minPx);
    const atKMinus = calcAfterTaxProfit(K - 0.001);
    const atKPlus = calcAfterTaxProfit(K + 0.001);
    const atMaxProf = calcAfterTaxProfit(maxPx);

    yCliffTop = toY(atKMinus);
    yCliffBottom = toY(atKPlus);
    taxCliffLoss = TaxEngine.calcTaxCliffLoss(K, costBasis, taxRate);
    t2pInfo = TaxEngine.calcTaxToPremiumRatio(K, P, costBasis, taxRate);

    // After-tax path with mathematically exact step-down cliff at K
    dAfterTax = `M ${toX(minPx).toFixed(1)} ${toY(atMinProf).toFixed(1)} ` +
      `L ${toX(K).toFixed(1)} ${yCliffTop.toFixed(1)} ` +
      `L ${toX(K).toFixed(1)} ${yCliffBottom.toFixed(1)} ` +
      `L ${toX(maxPx).toFixed(1)} ${toY(atMaxProf).toFixed(1)}`;
  }

  // Simulation marker position
  const xSim = toX(simPrice);
  const simProf = calcProfit(simPrice);
  const ySim = toY(simProf);

  svg.innerHTML = `
    <defs>
      <linearGradient id="cushionGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3da678" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#3da678" stop-opacity="0.08"/>
      </linearGradient>
      <linearGradient id="plateauGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c8963e" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#c8963e" stop-opacity="0.04"/>
      </linearGradient>
      <filter id="visxPlateauGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#c8963e" flood-opacity="0.7"/>
      </filter>
      <filter id="visxTaxGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#c85648" flood-opacity="0.8"/>
      </filter>
    </defs>

    <!-- Zero Profit Baseline -->
    <line x1="${L}" y1="${yZero}" x2="${R}" y2="${yZero}" stroke="#3a4b61" stroke-width="1.5"/>
    <text x="${L - 8}" y="${yZero + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">0.00€</text>

    <!-- Shaded Zones -->
    <path d="${dCushion}" fill="url(#cushionGrad)"/>
    <path d="${dMaxPlateau}" fill="url(#plateauGrad)"/>

    <!-- Pre-Tax Payoff Hockey Stick Line -->
    <path d="${dPayoff}" fill="none" stroke="${isTaxActive ? '#596575' : '#ebe8e1'}" stroke-width="${isTaxActive ? 2 : 3}" stroke-linejoin="round" stroke-dasharray="${isTaxActive ? '4,4' : 'none'}"/>

    <!-- Capped Plateau Line -->
    <line x1="${pK.x}" y1="${yK}" x2="${pMax.x}" y2="${yK}" stroke="${isTaxActive ? '#8e7033' : '#c8963e'}" stroke-width="${isTaxActive ? 2 : 4}" stroke-linecap="round"/>

    <!-- After-Tax Payoff Line (with Tax Cliff Step-Down) -->
    ${isTaxActive ? `
      <path d="${dAfterTax}" fill="none" stroke="#e0aa4f" stroke-width="3" stroke-linejoin="round"/>
      <!-- Tax Cliff Step Down Discontinuity Indicator at K -->
      <line x1="${xK}" y1="${yCliffTop}" x2="${xK}" y2="${yCliffBottom}" stroke="#c85648" stroke-width="3.5" stroke-dasharray="3,2" filter="url(#visxTaxGlow)"/>
      <rect x="${Math.min(R - 130, xK + 8)}" y="${(yCliffTop + yCliffBottom) / 2 - 11}" width="124" height="22" rx="4" fill="#241315" stroke="${t2pInfo?.isTrap ? '#ff5252' : '#c85648'}" stroke-width="1.2"/>
      <text x="${Math.min(R - 68, xK + 70)}" y="${(yCliffTop + yCliffBottom) / 2 + 4}" font-size="8.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="${t2pInfo?.isTrap ? '#ff8a80' : '#f3a49b'}" text-anchor="middle">
        ${t2pInfo?.isTrap ? '🔴 TRAP ' : '⚡ Cliff '}-${fmtMoney(taxCliffLoss)}
      </text>
    ` : ''}

    <!-- Breakeven Marker -->
    <line x1="${xBE}" y1="${yZero - 20}" x2="${xBE}" y2="${B}" stroke="#c85648" stroke-width="1.5" stroke-dasharray="2,3"/>
    <circle cx="${xBE}" cy="${yZero}" r="5" fill="#c85648"/>
    <rect x="${Math.max(L, xBE - 50)}" y="${yZero + 8}" width="100" height="18" rx="4" fill="#241315" stroke="#c85648" stroke-width="1"/>
    <text x="${Math.max(L + 50, xBE)}" y="${yZero + 20}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#f3a49b" text-anchor="middle">
      🛡️ BE ${fmtMoney(BE)}
    </text>

    <!-- Spot Marker -->
    <line x1="${xSpot}" y1="${T}" x2="${xSpot}" y2="${B}" stroke="#3d76b8" stroke-width="1.5" stroke-dasharray="2,3"/>
    <circle cx="${xSpot}" cy="${ySpot}" r="5" fill="#3d76b8"/>
    <rect x="${Math.max(L, xSpot - 40)}" y="${T - 14}" width="80" height="18" rx="4" fill="#151b23" stroke="#3d76b8" stroke-width="1"/>
    <text x="${Math.max(L + 40, xSpot)}" y="${T - 2}" font-size="9" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#ebe8e1" text-anchor="middle">
      Spot ${fmtMoney(spot)}
    </text>

    <!-- Strike Knee Marker -->
    <line x1="${xK}" y1="${T}" x2="${xK}" y2="${B}" stroke="#c8963e" stroke-width="1.5" stroke-dasharray="2,3"/>
    <circle cx="${xK}" cy="${yK}" r="6" fill="#c8963e" filter="url(#visxPlateauGlow)"/>
    <rect x="${Math.max(L, Math.min(R - 100, xK - 50))}" y="${yK - 24}" width="100" height="20" rx="4" fill="#292218" stroke="#c8963e" stroke-width="1.2"/>
    <text x="${Math.max(L + 50, Math.min(R - 50, xK))}" y="${yK - 10}" font-size="9.5" font-family="'JetBrains Mono', monospace" font-weight="700" fill="#c8963e" text-anchor="middle">
      🎯 Strike ${fmtMoney(K)}
    </text>

    <!-- Simulation Price Beacon Marker -->
    <g id="ccSimMarkerGroup">
      <line x1="${xSim}" y1="${T}" x2="${xSim}" y2="${B}" stroke="#3da678" stroke-width="2"/>
      <circle cx="${xSim}" cy="${ySim}" r="6" fill="#3da678"/>
      <circle cx="${xSim}" cy="${ySim}" r="10" fill="none" stroke="#3da678" stroke-width="1.5"/>
    </g>

    <!-- Axis Labels -->
    <text x="${L}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">${fmtMoney(minPx)}</text>
    <text x="${W / 2}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Τιμή Υποκειμένου στη Λήξη (S<sub>T</sub>)</text>
    <text x="${R}" y="${B + 16}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">${fmtMoney(maxPx)}</text>
  `;

  // Update Scenario Slider attributes
  const slider = document.getElementById('ccScenarioSlider');
  if (slider) {
    slider.min = Math.round(minPx);
    slider.max = Math.round(maxPx);
    slider.step = Math.max(0.1, (maxPx - minPx) / 200);
    slider.value = Math.round(simPrice);
  }

  // Update outcome badge text
  updateCcSimulationOutcome(item, spot, K, BE, P, simPrice);

  // SVG interactive hover tracking
  svg.onmousemove = (e) => {
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * W;
    if (mouseX < L || mouseX > R) {
      visxHideTooltip();
      return;
    }
    const hoverP = fromX(mouseX);
    const hoverProf = calcProfit(hoverP);
    const isAssigned = hoverP >= K;
    const isProtected = hoverP >= BE;

    const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
    const taxEval = isTaxActive
      ? TaxEngine.evaluateContract({ spot, strike: K, premium: P, costBasis, taxRate, dte: item.DTE, mode: taxMode, simPrice: hoverP })
      : null;

    visxShowTooltip(e, `
      <div class="font-bold text-[#ebe8e1] border-b border-[#232d3b] pb-1 mb-1.5 flex justify-between">
        <span>Τιμή Λήξης: ${fmtMoney(hoverP)}</span>
        <span class="${hoverProf >= 0 ? 'text-[#3da678]' : 'text-[#c85648]'}">${hoverProf >= 0 ? '+' : ''}${fmtMoney(hoverProf)}</span>
      </div>
      <div class="space-y-1 text-[11px]">
        <div class="flex justify-between text-[#8e99a8]"><span>Κατάσταση:</span> <span class="mono font-bold ${isAssigned ? 'text-[#c8963e]' : (isProtected ? 'text-[#3d76b8]' : 'text-[#c85648]')}">${isAssigned ? 'Εκχώρηση (Assigned)' : (isProtected ? 'Προστατευμένο (OTM)' : 'Ζημιά (< BE)')}</span></div>
        ${isTaxActive && isAssigned ? `
          <div class="flex justify-between text-[#8e99a8]"><span>Φόρος Assignment:</span> <span class="mono font-bold text-[#c85648]">-${fmtMoney(taxEval.taxPaid)}</span></div>
          <div class="flex justify-between text-[#8e99a8]"><span>Καθαρά Μετρητά:</span> <span class="mono font-bold text-[#ebe8e1]">${fmtMoney(taxEval.netCash)}</span></div>
          <div class="flex justify-between text-[#8e99a8]"><span>T2P Ratio:</span> <span class="mono font-bold ${taxEval.isTaxTrap ? 'text-[#ff5252]' : 'text-[#3da678]'}">${taxEval.t2p.label} ${taxEval.isTaxTrap ? '⚠️ TRAP' : '✅'}</span></div>
          <div class="flex justify-between text-[#8e99a8]"><span>Rebuy Price:</span> <span class="mono font-bold text-[#9b88bf]">${fmtMoney(taxEval.rebuyPrice)}</span></div>
          <div class="flex justify-between text-[#8e99a8]"><span>Διατήρηση Τεμαχίων:</span> <span class="mono font-bold ${taxEval.unitDestruction.units < 1 ? 'text-[#c8963e]' : 'text-[#3da678]'}">${taxEval.unitDestruction.label}</span></div>
        ` : (isTaxActive ? `
          <div class="flex justify-between text-[#8e99a8]"><span>Φόρος Μετοχής:</span> <span class="mono font-bold text-[#3da678]">0% (Unrealized)</span></div>
          <div class="flex justify-between text-[#8e99a8]"><span>Φόρος Premium:</span> <span class="mono font-bold text-[#c85648]">-${fmtMoney(P * taxRate)}</span></div>
        ` : '')}
      </div>
      <div class="text-[10px] text-[#596575] mt-1.5 pt-1 border-t border-[#232d3b]">💡 Σύρε το slider παρακάτω για δοκιμή σεναρίου</div>
    `);
  };

  svg.onmouseleave = () => {
    visxHideTooltip();
  };
}

function onCcScenarioSlider(val) {
  const p = Number(val);
  if (!currentCcActiveItem) return;
  renderCoveredCallPayoffChart(currentCcActiveItem, p);
}

function updateCcSimulationOutcome(item, spot, K, BE, P, simPrice) {
  const labelEl = document.getElementById('ccSimExpiryPriceLabel');
  const badgeEl = document.getElementById('ccSimOutcomeBadge');
  if (!labelEl || !badgeEl) return;

  const deltaPct = ((simPrice / spot - 1) * 100).toFixed(1);
  const deltaDir = Number(deltaPct) >= 0 ? '+' : '';
  labelEl.textContent = fmtMoney(simPrice) + ' (' + deltaDir + deltaPct + '%)';

  const rawBasis = document.getElementById('taxCostBasis')?.value || document.getElementById('stratCostBasis')?.value || document.getElementById('cockpitCostBasis')?.value;
  const taxPct = Number(document.getElementById('taxRateInput')?.value || document.getElementById('stratTaxRate')?.value || document.getElementById('cockpitTaxRate')?.value || 0);
  const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
  const taxRate = TaxEngine.resolveTaxRate(taxPct);
  const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot, taxMode);
  const isTaxActive = taxRate > 0 && (taxMode === 'FRESH' || costBasis !== spot);

  const profit = Math.min(simPrice, K) - BE;
  const retPct = ((profit / BE) * 100).toFixed(1);
  const aprPct = (Number(retPct) * (365 / Math.max(1, item.DTE))).toFixed(1);

  if (simPrice >= K) {
    if (isTaxActive) {
      const taxEval = TaxEngine.evaluateContract({
        spot, strike: K, premium: P, costBasis, taxRate, dte: item.DTE,
        mode: taxMode, simPrice
      });
      badgeEl.className = 'mt-2.5 text-xs p-3 rounded-lg bg-[#1a1c24] border ' + (taxEval.isTaxTrap ? 'border-[#ff5252]/50' : 'border-[#3da678]/40') + ' leading-relaxed text-[#ebe8e1] space-y-1';
      badgeEl.innerHTML = `
        <div class="flex items-center justify-between border-b border-[#2d3848] pb-1.5 mb-1">
          <b class="${taxEval.isTaxTrap ? 'text-[#ff8a80]' : 'text-[#3da678]'}">🎉 Σενάριο Εκχώρησης (Assigned @ Strike ${fmtMoney(K)}):</b>
          <span class="mono text-[10px] px-2 py-0.5 rounded ${taxEval.isTaxTrap ? 'bg-[#ff5252]/20 text-[#ff8a80]' : 'bg-[#3da678]/20 text-[#3da678]'} font-bold">
            ${taxEval.isTaxTrap ? '⚠️ TAX TRAP (T2P: ' + taxEval.t2p.label + ')' : '✅ TAX SAFE (T2P: ' + taxEval.t2p.label + ')'}
          </span>
        </div>
        <div>• <b>Φορολογητέο Κέρδος:</b> ${fmtMoney(taxEval.taxableGain)} (από Cost Basis ${fmtMoney(costBasis)})</div>
        <div>• <b>Φόρος Εκχώρησης:</b> <span class="text-[#c85648] font-bold">-${fmtMoney(taxEval.taxPaid)} (${(taxRate * 100).toFixed(1)}%)</span></div>
        <div>• <b>Καθαρά Μετρητά στην Τσέπη:</b> <b class="text-white">${fmtMoney(taxEval.netCash)}</b> (<span class="${taxEval.isTaxSafe ? 'text-[#3da678]' : 'text-[#c8963e]'} font-bold">${taxEval.deltaVsSpotPct >= 0 ? '+' : ''}${taxEval.deltaVsSpotPct.toFixed(2)}% vs Spot ${taxEval.isTaxSafe ? '✅' : '⚠️'}</span>)</div>
        <div>• <b>Τιμή Επαναγοράς (Rebuy Price):</b> Πρέπει η τιμή να πέσει στα <b class="text-[#9b88bf]">${fmtMoney(taxEval.rebuyPrice)}</b> για 100% επαναγορά!</div>
        ${simPrice > taxEval.rebuyPrice ? `<div class="text-[#c8963e]">• <b>Απώλεια Τεμαχίων (Dilution):</b> Αν αγοράσεις στα ${fmtMoney(simPrice)}, παίρνεις <b>${taxEval.unitDestruction.label}</b>.</div>` : ''}
        ${taxEval.taxShield.hasLoss ? `<div class="text-[#3d76b8]">• <b>Φορολογική Ασπίδα:</b> ${taxEval.taxShield.description}</div>` : ''}
      `;
    } else {
      badgeEl.className = 'mt-2.5 text-xs p-2.5 rounded bg-[#16221b] border border-[#3da678]/40 leading-relaxed text-[#ebe8e1]';
      badgeEl.innerHTML = `
        <b class="text-[#3da678]">🎉 Σενάριο Εκχώρησης (Assigned):</b> Η τιμή κλείνει στα <b>${fmtMoney(simPrice)}</b> (&ge; Strike ${fmtMoney(K)}).
        Παραδίδεις το asset και κλειδώνεις μέγιστο κέρδος <b class="text-[#3da678]">+${fmtMoney(profit)} (+${retPct}%, ${aprPct}% APR)</b> σε μετρητά ($/€).
      `;
    }
  } else if (simPrice >= BE) {
    badgeEl.className = 'mt-2.5 text-xs p-2.5 rounded bg-[#18202c] border border-[#3d76b8]/40 leading-relaxed text-[#ebe8e1]';
    badgeEl.innerHTML = `
      <b class="text-[#3d76b8]">🛡️ Σενάριο Μαξιλαριού &amp; Αύξησης Τεμαχίων (OTM):</b> Η τιμή κλείνει στα <b>${fmtMoney(simPrice)}</b> (ανάμεσα σε Spot και Breakeven).
      ${isTaxActive ? `<b>Η υπεραξία της μετοχής παραμένει UNREALIZED (0% φόρος)!</b> Κρατάς το 100% των τεμαχίων σου.` : `Το asset έπεσε, αλλά λόγω του premium δεν έχεις καμία ζημιά!`}
      Κρατάς το premium (+${((item.underlyingYield - 1) * 100).toFixed(2)}% τεμάχια).
    `;
  } else {
    badgeEl.className = 'mt-2.5 text-xs p-2.5 rounded bg-[#241315] border border-[#c85648]/40 leading-relaxed text-[#ebe8e1]';
    badgeEl.innerHTML = `
      <b class="text-[#c85648]">📉 Πτώση κάτω από το Breakeven:</b> Η τιμή κατέρρευσε στα <b>${fmtMoney(simPrice)}</b> (καθαρή ζημιά ${fmtMoney(profit)}).
      Ωστόσο, χάνεις <b>${fmtMoney(P)} ΛΙΓΟΤΕΡΟ</b> σε σχέση με κάποιον που απλώς αγόρασε και κρατούσε το asset (Buy &amp; Hold)!
    `;
  }
}

// --- TAB 3: VISX COVERED CALL EFFICIENT FRONTIER CHART ---
function renderCoveredCallFrontierChart(items, activeItem) {
  const svg = document.getElementById('ccFrontierSvg');
  if (!svg || !items || !items.length) return;

  const W = 800, H = 280;
  const L = 60, R = 750, T = 35, B = 230;
  const Wu = R - L, Hu = B - T;

  const mapped = items.map(x => {
    const cushionPct = Math.max(0, (1 - x.breakEvenVsFullMoneyRelative) * 100);
    const aprPct = Math.max(0, ((x.moneyYield - 1) * (365 / Math.max(1, x.DTE))) * 100);
    const unitYieldPct = ((x.underlyingYield - 1) * 100);
    const cashYieldPct = ((x.moneyYield - 1) * 100);
    return {
      raw: x,
      cushionPct,
      aprPct,
      unitYieldPct,
      cashYieldPct,
      score: cushionPct * Math.sqrt(Math.max(0.1, aprPct))
    };
  });

  const maxCushion = Math.max(15, Math.ceil(Math.max(...mapped.map(m => m.cushionPct)) * 1.15));
  const maxApr = Math.max(40, Math.ceil(Math.max(...mapped.map(m => m.aprPct)) * 1.15));

  const toX = (cushion) => L + (cushion / maxCushion) * Wu;
  const toY = (apr) => B - (apr / maxApr) * Hu;

  const sortedByCushion = [...mapped].sort((a, b) => b.cushionPct - a.cushionPct);
  const frontier = [];
  let maxSoFar = -1;
  for (const p of sortedByCushion) {
    if (p.aprPct > maxSoFar) {
      frontier.push(p);
      maxSoFar = p.aprPct;
    }
  }
  frontier.sort((a, b) => a.cushionPct - b.cushionPct);

  const frontierCoords = frontier.map(f => ({ x: toX(f.cushionPct), y: toY(f.aprPct) }));
  const dFrontier = monotoneCubicPath(frontierCoords);

  const selectedTarget = activeItem ? activeItem.strikeAbsolute : null;

  svg.innerHTML = `
    <defs>
      <linearGradient id="frontierGrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#3d76b8"/>
        <stop offset="50%" stop-color="#c8963e"/>
        <stop offset="100%" stop-color="#3da678"/>
      </linearGradient>
    </defs>

    <line x1="${L}" y1="${B}" x2="${R}" y2="${B}" stroke="#232d3b" stroke-width="1"/>
    <line x1="${L}" y1="${T}" x2="${L}" y2="${B}" stroke="#232d3b" stroke-width="1"/>

    ${[0.25, 0.5, 0.75, 1.0].map(frac => {
      const yVal = maxApr * frac;
      return `
        <line x1="${L}" y1="${toY(yVal)}" x2="${R}" y2="${toY(yVal)}" stroke="#1e2633" stroke-width="1" stroke-dasharray="2,4"/>
        <text x="${L - 8}" y="${toY(yVal) + 4}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="end">${yVal.toFixed(0)}%</text>
      `;
    }).join('')}

    ${[0.25, 0.5, 0.75, 1.0].map(frac => {
      const xVal = maxCushion * frac;
      return `
        <line x1="${toX(xVal)}" y1="${T}" x2="${toX(xVal)}" y2="${B}" stroke="#1e2633" stroke-width="1" stroke-dasharray="2,4"/>
        <text x="${toX(xVal)}" y="${B + 16}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">${xVal.toFixed(0)}%</text>
      `;
    }).join('')}

    <text x="${L}" y="${B + 16}" font-size="9" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">0%</text>
    <text x="${W / 2}" y="${B + 30}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="middle">Προστασία Πτώσης (Downside Cushion) % →</text>
    <text x="${L + 5}" y="${T - 12}" font-size="10" font-family="'JetBrains Mono', monospace" fill="#8e99a8" text-anchor="start">Ετησιοποιημένη Απόδοση (APR) % ↑</text>

    ${dFrontier ? `<path d="${dFrontier}" fill="none" stroke="url(#frontierGrad)" stroke-width="2.5" stroke-dasharray="4,3"/>` : ''}

    ${mapped.map(m => {
      const cx = toX(m.cushionPct);
      const cy = toY(m.aprPct);
      const isSelected = selectedTarget != null && m.raw.strikeAbsolute === selectedTarget;
      const isSweet = frontier.some(f => f.raw.strikeAbsolute === m.raw.strikeAbsolute);

      let color = '#3d76b8';
      if (isSweet) color = '#c8963e';
      if (m.aprPct >= maxApr * 0.7) color = '#3da678';

      return `
        <g class="cursor-pointer" onclick="selectCcItemByStrike(${m.raw.strikeAbsolute})">
          ${isSelected ? `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="#ebe8e1" stroke-width="2"/>` : ''}
          <circle cx="${cx}" cy="${cy}" r="${isSelected ? 6 : (isSweet ? 5 : 3.5)}" fill="${color}" stroke="#151b23" stroke-width="1"/>
        </g>
      `;
    }).join('')}
  `;
}

function selectCcProfile(profile) {
  if (!currentCcItems || !currentCcItems.length) return;

  const mapped = currentCcItems.map(x => {
    const cushionPct = Math.max(0, (1 - x.breakEvenVsFullMoneyRelative) * 100);
    const aprPct = Math.max(0, ((x.moneyYield - 1) * (365 / Math.max(1, x.DTE))) * 100);
    return {
      raw: x,
      cushionPct,
      aprPct,
      score: cushionPct * Math.sqrt(Math.max(0.1, aprPct))
    };
  });

  let chosen = null;
  if (profile === 'CONSERVATIVE') {
    mapped.sort((a, b) => b.cushionPct - a.cushionPct);
    chosen = mapped[0];
  } else if (profile === 'AGGRESSIVE') {
    mapped.sort((a, b) => b.aprPct - a.aprPct);
    chosen = mapped[0];
  } else {
    mapped.sort((a, b) => b.score - a.score);
    chosen = mapped[0];
  }

  const btnCons = document.getElementById('btnCcCons');
  const btnBal = document.getElementById('btnCcBal');
  const btnAggr = document.getElementById('btnCcAggr');

  const activeCons = profile === 'CONSERVATIVE';
  const activeBal = profile === 'BALANCED';
  const activeAggr = profile === 'AGGRESSIVE';

  if (btnCons) {
    btnCons.className = 'card-elevated p-3 text-left border-l-4 border-[#3d76b8] transition ' + (activeCons ? 'bg-[#1e2a3a] ring-1 ring-[#3d76b8]' : 'bg-[#151b23] opacity-80 hover:opacity-100');
  }
  if (btnBal) {
    btnBal.className = 'card-elevated p-3 text-left border-l-4 border-[#c8963e] transition ' + (activeBal ? 'bg-[#292218] ring-1 ring-[#c8963e]' : 'bg-[#151b23] opacity-80 hover:opacity-100');
  }
  if (btnAggr) {
    btnAggr.className = 'card-elevated p-3 text-left border-l-4 border-[#3da678] transition ' + (activeAggr ? 'bg-[#182820] ring-1 ring-[#3da678]' : 'bg-[#151b23] opacity-80 hover:opacity-100');
  }

  if (chosen) {
    selectCcItem(chosen.raw);
  }
}

function selectCcItemByStrike(strike) {
  if (!currentCcItems) return;
  const match = currentCcItems.find(x => x.strikeAbsolute === strike);
  if (match) selectCcItem(match);
}

function selectCcItem(item) {
  currentCcActiveItem = item;
  updateCcActiveCards(item);

  // Sync with Tax & Cost Basis Analysis Panel
  const fnUpdate = typeof updateTaxAnalysisHud === 'function' ? updateTaxAnalysisHud : (typeof updateTaxCockpitHud === 'function' ? updateTaxCockpitHud : null);
  if (fnUpdate) {
    const rawBasis = document.getElementById('taxCostBasis')?.value || document.getElementById('stratCostBasis')?.value || document.getElementById('cockpitCostBasis')?.value;
    const taxPct = Number(document.getElementById('taxRateInput')?.value || document.getElementById('stratTaxRate')?.value || document.getElementById('cockpitTaxRate')?.value || 0);
    const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
    const taxRate = TaxEngine.resolveTaxRate(taxPct);
    const spot = currentState.spot || item.spotPrice || item.strikeAbsolute * 0.95;
    const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot, taxMode);
    fnUpdate(spot, costBasis, taxRate, taxMode, item);
  }

  if (currentCcView === 'PAYOFF') {
    renderCoveredCallPayoffChart(item);
  } else {
    renderCoveredCallFrontierChart(currentCcItems, item);
  }

  const tbody = document.getElementById('stratTableBody');
  if (tbody) {
    const rows = tbody.querySelectorAll('tr[data-strike]');
    rows.forEach(tr => {
      const isMatch = tr.getAttribute('data-strike') === String(item.strikeAbsolute);
      if (isMatch) {
        tr.className = 'cursor-pointer bg-[#222e40] font-bold text-white transition';
      } else {
        tr.className = 'cursor-pointer hover:bg-[#1a2332] transition';
      }
    });
  }
}

function updateCcActiveCards(item) {
  if (!item) return;

  const spot = currentState.spot || item.strikeAbsolute * 0.95;
  const cushionPct = Math.max(0, (1 - item.breakEvenVsFullMoneyRelative) * 100);
  const aprPct = (((item.moneyYield - 1) * (365 / Math.max(1, item.DTE))) * 100);
  const cashYieldPct = ((item.moneyYield - 1) * 100);
  const unitYieldPct = ((item.underlyingYield - 1) * 100);
  const premium = Math.max(0, spot - item.breakEvenVsFullMoneyAbsolute);
  const maxProfitCash = item.strikeAbsolute - item.breakEvenVsFullMoneyAbsolute;

  const rawBasis = document.getElementById('taxCostBasis')?.value || document.getElementById('stratCostBasis')?.value || document.getElementById('cockpitCostBasis')?.value;
  const taxPct = Number(document.getElementById('taxRateInput')?.value || document.getElementById('stratTaxRate')?.value || document.getElementById('cockpitTaxRate')?.value || 0);
  const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
  const taxRate = TaxEngine.resolveTaxRate(taxPct);
  const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot, taxMode);
  const isTaxActive = taxRate > 0 && (taxMode === 'FRESH' || costBasis !== spot);

  const cashYieldEl = document.getElementById('ccCardCashYield');
  const cashSubEl = document.getElementById('ccCardCashSub');
  const unitYieldEl = document.getElementById('ccCardUnitYield');
  const unitSubEl = document.getElementById('ccCardUnitSub');
  const cushionEl = document.getElementById('ccCardCushion');
  const cushionSubEl = document.getElementById('ccCardCushionSub');

  if (isTaxActive) {
    const taxEval = TaxEngine.evaluateContract({
      spot, strike: item.strikeAbsolute, premium, costBasis, taxRate, dte: item.DTE,
      mode: taxMode
    });
    if (cashYieldEl) {
      cashYieldEl.textContent = (taxEval.deltaVsSpotPct >= 0 ? '+' : '') + taxEval.deltaVsSpotPct.toFixed(2) + '% Net';
      cashYieldEl.className = 'text-2xl font-bold mt-1 mono ' + (taxEval.isTaxSafe ? 'text-[#3da678]' : 'text-[#c8963e]');
    }
    if (cashSubEl) {
      cashSubEl.textContent = `Καθαρά: ${fmtMoney(taxEval.netCash)} (Φόρος: -${fmtMoney(taxEval.taxPaid)}) | Net APR: ${taxEval.afterTaxAprPct.toFixed(1)}%`;
    }
    if (cushionEl) {
      cushionEl.textContent = fmtMoney(taxEval.rebuyPrice);
    }
    if (cushionSubEl) {
      cushionSubEl.textContent = `Rebuy Price (${(taxEval.rebuyPrice / spot * 100).toFixed(1)}% Spot) | BE: ${fmtMoney(item.breakEvenVsFullMoneyAbsolute)}`;
    }
  } else {
    if (cashYieldEl) {
      cashYieldEl.textContent = '+' + cashYieldPct.toFixed(2) + '%';
      cashYieldEl.className = 'text-2xl font-bold text-[#3da678] mt-1 mono';
    }
    if (cashSubEl) cashSubEl.textContent = 'Ετησιοποιημένο APR: ' + aprPct.toFixed(1) + '% | Κέρδος: +' + fmtMoney(maxProfitCash);
    if (cushionEl) cushionEl.textContent = '-' + cushionPct.toFixed(1) + '%';
    if (cushionSubEl) cushionSubEl.textContent = 'Νεκρό Σημείο: ' + fmtMoney(item.breakEvenVsFullMoneyAbsolute);
  }

  if (unitYieldEl) unitYieldEl.textContent = '+' + unitYieldPct.toFixed(2) + '%';
  if (unitSubEl) unitSubEl.textContent = 'Δωρεάν Επανεπένδυση (' + item.underlying + ')';

  // Order Execution & Cash Flow Ticket (Δελτίο Συναλλαγής & Ταμειακές Ροές)
  const leg1El = document.getElementById('ccTicketLeg1');
  const leg2El = document.getElementById('ccTicketLeg2');
  const netDebitEl = document.getElementById('ccTicketNetDebit');
  const creditEl = document.getElementById('ccTicketCredit');
  const targetEl = document.getElementById('ccTicketTarget');
  const bufferEl = document.getElementById('ccTicketBuffer');
  const linkEl = document.getElementById('ccSelectedPayoffLink');

  const isPreExisting = taxMode === 'PRE_EXISTING' && costBasis !== spot;
  const isCrypto = currentState.venue === 'CRYPTO' || item.venue === 'Deribit';
  const unitSizeStr = isCrypto ? (item.underlying === 'BTC' ? '0.1x' : '1.0x') : '100x';
  const lotMultiplier = isCrypto ? (item.underlying === 'BTC' ? 0.1 : 1.0) : 100.0;

  if (leg1El) {
    leg1El.textContent = isPreExisting
      ? `HOLD ${unitSizeStr} ${item.underlying} (Cost Basis: ${fmtMoney(costBasis)})`
      : `BUY ${unitSizeStr} ${item.underlying} @ Spot ${fmtMoney(spot)} (Αγορά Μετοχής / Buy Stock)`;
  }
  if (leg2El) {
    const contractNote = isCrypto ? `SELL 1 Call (${unitSizeStr} ${item.underlying})` : `SELL 1 Call (100 μετοχές)`;
    leg2El.textContent = `${contractNote} @ Strike ${fmtMoney(item.strikeAbsolute)} (${item.formattedDate})`;
  }
  if (netDebitEl) {
    const totalOutlay = (spot - premium) * lotMultiplier;
    netDebitEl.textContent = isPreExisting ? '$0.00 (Υπάρχουσα Θέση / Zero Cash Outlay)' : fmtMoney(totalOutlay);
  }
  if (creditEl) {
    creditEl.textContent = 'Άμεσο Cash: +' + fmtMoney(premium * lotMultiplier);
  }
  if (targetEl) {
    targetEl.textContent = 'Max: +' + fmtMoney(maxProfitCash * lotMultiplier) + ' (' + aprPct.toFixed(1) + '% APR)';
  }
  if (bufferEl) {
    bufferEl.textContent = 'Μαξιλάρι: -' + cushionPct.toFixed(1) + '% (έως ' + fmtMoney(item.breakEvenVsFullMoneyAbsolute) + ')';
  }
  if (linkEl) linkEl.href = item.strategyURL;
}

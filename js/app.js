/**
 * Options Probabilistic Superstructure — Application Controller & UI Orchestration
 * Coordinates user events, live market orderbooks, strategy scans, and interactive modals.
 */

function switchTab(tab) {
  document.getElementById('tabProb').classList.toggle('hidden', tab !== 'PROB');
  document.getElementById('tabTimeline').classList.toggle('hidden', tab !== 'TIMELINE');
  document.getElementById('tabStrat').classList.toggle('hidden', tab !== 'STRAT');
  document.getElementById('tabTheory').classList.toggle('hidden', tab !== 'THEORY');
  const tabMythsEl = document.getElementById('tabMyths');
  if (tabMythsEl) tabMythsEl.classList.toggle('hidden', tab !== 'MYTHS');

  document.getElementById('marketControlBar').classList.toggle('hidden', tab === 'THEORY' || tab === 'MYTHS');

  const btnProb = document.getElementById('tabBtnProb');
  const btnTl = document.getElementById('tabBtnTimeline');
  const btnSt = document.getElementById('tabBtnStrat');
  const btnTh = document.getElementById('tabBtnTheory');
  const btnMyths = document.getElementById('tabBtnMyths');

  const activeCls = 'px-4 py-2 rounded bg-[#4a86c6] text-white transition font-bold shadow-sm';
  const inactiveCls = 'px-4 py-2 rounded bg-[#171c24] text-[#9aa4b2] hover:bg-[#1e2430] transition font-bold';

  if (btnProb) btnProb.className = tab === 'PROB' ? activeCls : inactiveCls;
  if (btnTl) btnTl.className = tab === 'TIMELINE' ? activeCls : inactiveCls;
  if (btnSt) btnSt.className = tab === 'STRAT' ? activeCls : inactiveCls;
  if (btnTh) btnTh.className = tab === 'THEORY' ? activeCls : inactiveCls;
  if (btnMyths) btnMyths.className = tab === 'MYTHS' ? activeCls : inactiveCls;

  if (tab === 'TIMELINE') {
    syncTimelineWithLiveChain();
  } else if (tab === 'STRAT') {
    runStrategyScanner();
  } else if (tab === 'THEORY') {
    updateParityDiagram();
    safeRenderMath(document.getElementById('tabTheory'));
  } else if (tab === 'MYTHS') {
    runRuinSimulator();
    runTailShockSimulator();
    safeRenderMath(document.getElementById('tabMyths'));
  }
}

function quickLoad(venue, ticker) {
  document.getElementById('venueSelect').value = venue;
  document.getElementById('tickerInput').value = ticker;
  currentState.selectedExp = null;
  loadChain();
}

function onVenueChange() {
  const venue = document.getElementById('venueSelect').value;
  document.getElementById('tickerInput').value = venue === 'CRYPTO' ? 'BTC' : 'NVDA';
  currentState.selectedExp = null;
  loadChain();
}

function onExpirationChange() {
  const val = document.getElementById('expSelect').value;
  currentState.selectedExp = val;
  if (currentState.venue === 'STOCK') {
    loadStockChain(currentState.symbol, val);
  } else {
    processCryptoExpiration(val);
  }
}

async function loadChain(desiredTarget = null) {
  showError(null);
  setStatus('⏳ Φόρτωση...', false);
  const venue = document.getElementById('venueSelect').value;
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  currentState.venue = venue;
  currentState.symbol = ticker;
  try {
    if (venue === 'STOCK') {
      await loadStockChain(ticker, currentState.selectedExp, desiredTarget);
    } else {
      await loadCryptoChain(ticker, currentState.selectedExp, desiredTarget);
    }
    setStatus('✅ Engine: Ready', true);
    if (!document.getElementById('tabStrat').classList.contains('hidden')) {
      runStrategyScanner();
    }
  } catch (err) {
    setStatus('⚠️ Σφάλμα', false);
    showError(
      'Αδυναμία φόρτωσης ' + ticker + ' (' + err.message + '). ' +
      'Αν είσαι σε Μετοχές και το Yahoo επιστρέφει σφάλμα, δοκίμασε BTC/ETH (Deribit) ή το Tab 2 (Χρονοδιάγραμμα)!'
    );
  }
}

async function loadStockChain(ticker, epochDate, desiredTarget = null) {
  const cacheKey = 'STOCK_' + ticker + '_' + (epochDate || 'first');
  let json;
  if (localCache.has(cacheKey)) {
    json = localCache.get(cacheKey);
  } else {
    let url = WORKER_URL + '/?symbol=' + encodeURIComponent(ticker);
    if (epochDate) url += '&date=' + epochDate;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Worker HTTP ' + res.status);
    json = await res.json();
    if (json.error) throw new Error(json.error);
    localCache.set(cacheKey, json);
  }

  const result = json && json.optionChain && json.optionChain.result && json.optionChain.result[0];
  if (!result) {
    throw new Error('Δεν βρέθηκαν δεδομένα options για το σύμβολο ' + ticker);
  }

  const quote = result.quote || {};
  const spot = Number(quote.regularMarketPrice || quote.postMarketPrice || quote.regularMarketPreviousClose || 0);
  const currency = quote.currency === 'EUR' ? '€' : '$';
  const exps = result.expirationDates || [];
  const optBlock = (result.options && result.options[0]) || {};

  const expSelect = document.getElementById('expSelect');
  const activeEpoch = epochDate ? Number(epochDate) : exps[0];
  currentState.selectedExp = activeEpoch;

  expSelect.innerHTML = exps.map(ep => {
    const dt = new Date(ep * 1000);
    const days = Math.max(1, Math.round((dt - Date.now()) / 86400000));
    const str = dt.toISOString().slice(0, 10);
    return '<option value="' + ep + '" ' + (ep === activeEpoch ? 'selected' : '') + '>' + str + ' (' + days + ' μέρες)</option>';
  }).join('');

  const dte = Math.max(1, Math.round((activeEpoch * 1000 - Date.now()) / 86400000));

  const parseSide = (arr, type) => (arr || []).map(c => {
    const rawBid = Number(c.bid || 0);
    const rawAsk = Number(c.ask || 0);
    const last = Number(c.lastPrice || 0);
    let bid = 0, ask = 0, mid = 0;
    if (rawBid > 0 && rawAsk >= rawBid) {
      bid = rawBid; ask = rawAsk; mid = (rawBid + rawAsk) / 2;
    } else if (rawAsk > 0.01 && last > 0.01) {
      mid = last; bid = last * 0.95; ask = Math.max(rawAsk, last * 1.05);
    } else if (last > 0.01) {
      mid = last; bid = last * 0.95; ask = last * 1.05;
    } else {
      return null;
    }
    return { symbol: c.contractSymbol, strike: Number(c.strike), bid, ask, mid, iv: Number(c.impliedVolatility || 0), type };
  }).filter(Boolean);

  const calls = parseSide(optBlock.calls, 'C');
  const puts = parseSide(optBlock.puts, 'P');
  const forward = estimatePutCallParityForward(spot, calls, puts);
  const carryApr = ((forward / spot - 1) * (365 / dte)) * 100;
  
  currentState.dte = dte;
  const spreads = buildVerticalSpreads(spot, forward, 1.0, calls, puts);

  currentState = { ...currentState, currency, spot, forward, carryApr, dte, spreads };
  updateUiAfterLoad(desiredTarget);
}

async function loadCryptoChain(coin, desiredExp = null, desiredTarget = null) {
  const url = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' + coin + '&kind=option';
  const res = await fetch(url);
  const data = await res.json();
  const raw = data.result || [];

  const parsed = [];
  const rx = /^(\w+)-(.*?)-(\d+)-(P|C)$/;
  for (const item of raw) {
    if (!item.bid_price || !item.ask_price || !item.mid_price) continue;
    if (item.bid_price <= 0 || item.mid_price > item.ask_price) continue;
    const m = rx.exec(item.instrument_name);
    if (!m) continue;
    parsed.push({
      symbol: item.instrument_name,
      expStr: m[2],
      strike: Number(m[3]),
      type: m[4],
      bid: item.bid_price,
      ask: item.ask_price,
      mid: item.mid_price,
      spot: item.estimated_delivery_price,
      future: item.underlying_price
    });
  }

  currentState.rawCryptoContracts = parsed;
  const expSet = [...new Set(parsed.map(c => c.expStr))];
  const validExps = expSet.filter(e => parseDeribitDte(e) >= 2);
  const activeExp = (desiredExp && validExps.includes(desiredExp)) ? desiredExp : (validExps[0] || expSet[0]);
  currentState.selectedExp = activeExp;

  const expSelect = document.getElementById('expSelect');
  expSelect.innerHTML = validExps.map(e =>
    '<option value="' + e + '" ' + (e === activeExp ? 'selected' : '') + '>' + e + ' (' + parseDeribitDte(e) + ' μέρες)</option>'
  ).join('');

  processCryptoExpiration(activeExp, desiredTarget);
}

function processCryptoExpiration(expStr, desiredTarget = null) {
  const subset = currentState.rawCryptoContracts.filter(c => c.expStr === expStr);
  if (!subset.length) return;
  const spot = subset[0].spot;
  const forward = subset[0].future;
  const dte = Math.max(1, parseDeribitDte(expStr));
  const carryApr = ((forward / spot - 1) * (365 / dte)) * 100;

  const calls = subset.filter(c => c.type === 'C');
  const puts = subset.filter(c => c.type === 'P');
  
  currentState.dte = dte;
  const spreads = buildVerticalSpreads(spot, forward, forward, calls, puts);

  currentState = { ...currentState, currency: '$', spot, forward, carryApr, dte, spreads };
  updateUiAfterLoad(desiredTarget);
}

function estimatePutCallParityForward(spot, calls, puts) {
  const putMap = new Map(puts.map(p => [p.strike, p]));
  const pairs = [];
  for (const c of calls) {
    const p = putMap.get(c.strike);
    if (p && Math.abs(c.strike - spot) / spot <= 0.15) {
      pairs.push({ k: c.strike, diff: c.mid - p.mid, cMid: c.mid, pMid: p.mid, iv: c.iv || p.iv || 0 });
    }
  }
  if (pairs.length === 0) return spot;
  pairs.sort((a, b) => a.k - b.k);

  for (let i = 0; i < pairs.length - 1; i++) {
    const p1 = pairs[i];
    const p2 = pairs[i + 1];
    if (p1.diff >= 0 && p2.diff <= 0 && p1.diff !== p2.diff) {
      return p1.k + (p1.diff / (p1.diff - p2.diff)) * (p2.k - p1.k);
    }
  }

  let closest = pairs[0];
  for (const pr of pairs) {
    if (Math.abs(pr.k - spot) < Math.abs(closest.k - spot)) closest = pr;
  }
  return closest.k + closest.diff;
}

function buildVerticalSpreads(spot, forward, multFactor, calls, puts) {
  const list = [];
  const dteDays = Math.max(1, currentState.dte || 7);
  const tYears = dteDays / 365.0;

  const putMap = new Map(puts.map(p => [p.strike, p]));
  const parityPairs = [];
  for (const c of calls) {
    const p = putMap.get(c.strike);
    if (p && c.mid > 0 && p.mid > 0 && Math.abs(c.strike - spot) / spot <= 0.10) {
      parityPairs.push({ k: c.strike, cMid: c.mid, pMid: p.mid });
    }
  }

  let discountFactor = 1.0;
  if (parityPairs.length >= 2) {
    parityPairs.sort((a, b) => a.k - b.k);
    const pA = parityPairs[0];
    const pB = parityPairs[parityPairs.length - 1];
    const deltaK = pB.k - pA.k;
    const deltaBox = (pA.cMid - pA.pMid) - (pB.cMid - pB.pMid);
    if (deltaK > 0 && deltaBox > 0) {
      discountFactor = Math.min(1.05, Math.max(0.70, deltaBox / deltaK));
    }
  }
  if (discountFactor === 1.0 && forward > 0 && spot > 0) {
    discountFactor = spot / forward;
  }

  const bCarry = tYears > 0 ? -Math.log(discountFactor) / tYears : 0.04;

  let atmIv = 0.40;
  const atmCalls = calls.filter(c => Math.abs(c.strike - spot) / spot <= 0.05 && c.iv > 0.01);
  if (atmCalls.length > 0) {
    atmIv = atmCalls.reduce((s, c) => s + c.iv, 0) / atmCalls.length;
  }

  const processLegs = (items, isCall) => {
    const sorted = [...items].sort((a, b) => a.strike - b.strike);
    for (let i = 0; i < sorted.length - 1; i++) {
      const k1 = sorted[i];
      const k2 = sorted[i + 1];
      const width = k2.strike - k1.strike;
      if (width <= 0) continue;

      const midTarget = (k1.strike + k2.strike) / 2;
      const isOtm = isCall ? (midTarget >= spot) : (midTarget <= spot);
      if (!isOtm) continue;

      const spreadMid = isCall
        ? (k1.mid - k2.mid) * multFactor
        : (k2.mid - k1.mid) * multFactor;

      const spreadAsk = isCall
        ? (k1.ask - k2.bid) * multFactor
        : (k2.ask - k1.bid) * multFactor;

      const pExpire = Math.min(1.0, Math.max(0.0, (spreadMid / width) / discountFactor));

      const localSigma = (k1.iv > 0.05 && k2.iv > 0.05)
        ? (k1.iv + k2.iv) / 2
        : atmIv;

      const modelExp = analyticalExpireProbWithDrift(spot, midTarget, tYears, localSigma, bCarry);
      const modelTouch = analyticalTouchProbWithDrift(spot, midTarget, tYears, localSigma, bCarry);

      const touchFraction = (modelTouch > 1e-6 && modelExp > 1e-6)
        ? Math.min(0.85, Math.max(0.15, modelExp / modelTouch))
        : 0.50;

      const touchExit = touchFraction * width;
      const pTouch = Math.min(1.0, Math.max(0.0, pExpire / touchFraction));
      const pNoTouch = 1.0 - pTouch;
      const touchMult = spreadAsk > 0 ? (touchExit / spreadAsk) : 0;
      const fairMult = pTouch > 0 ? (1.0 / pTouch) : 0;

      if (spreadMid > 0 && pTouch >= 0.005 && pTouch <= 0.998) {
        list.push({
          target: midTarget,
          k1: k1.strike,
          k2: k2.strike,
          sym1: k1.symbol,
          sym2: k2.symbol,
          type: isCall ? 'C' : 'P',
          width, spreadMid, spreadAsk, touchExit,
          pExpire, pTouch, pNoTouch, touchMult, fairMult
        });
      }
    }
  };

  processLegs(puts, false);
  processLegs(calls, true);
  return list.sort((a, b) => a.target - b.target);
}

function updateUiAfterLoad(desiredTarget = null) {
  const { spreads, spot } = currentState;
  if (!spreads.length) {
    showError('Δεν βρέθηκαν ρευστά Vertical Spreads σε αυτή τη λήξη. Επίλεξε την επόμενη ημερομηνία λήξης από το μενού.');
    return;
  }

  const slider = document.getElementById('targetSlider');
  const minTarget = spreads[0].target;
  const maxTarget = spreads[spreads.length - 1].target;

  slider.min = minTarget;
  slider.max = maxTarget;
  slider.step = ((maxTarget - minTarget) / 100).toFixed(2);

  let initialTarget;
  if (desiredTarget != null && desiredTarget >= minTarget && desiredTarget <= maxTarget) {
    initialTarget = Number(desiredTarget);
  } else {
    const higher = spreads.filter(s => s.target >= spot);
    initialTarget = higher.length > 0 ? higher[Math.min(2, higher.length - 1)].target : spreads[Math.floor(spreads.length / 2)].target;
  }

  slider.value = initialTarget;
  currentState.activeTarget = initialTarget;
  onSliderChange(initialTarget);
}

function onSliderChange(targetVal) {
  const target = Number(targetVal);
  currentState.activeTarget = target;
  document.getElementById('targetLabel').textContent = fmtMoney(target);

  const { spreads, spot, forward, carryApr, dte, currency, venue, symbol } = currentState;
  if (!spreads.length) return;

  let nearest = spreads[0];
  let minDiff = Math.abs(spreads[0].target - target);
  for (const s of spreads) {
    const d = Math.abs(s.target - target);
    if (d < minDiff) {
      minDiff = d;
      nearest = s;
    }
  }

  const distSpot = ((target / spot - 1) * 100);
  const distFwd = ((target / forward - 1) * 100);

  document.getElementById('kpiSpot').textContent = fmtMoney(spot);
  document.getElementById('kpiDte').textContent = 'Λήξη: ' + dte + ' ημέρες';

  const carrySign = carryApr >= 0 ? '+' : '';
  document.getElementById('kpiForward').textContent = fmtMoney(forward);
  document.getElementById('kpiCarry').textContent = 'Forward: ' + (distFwd >= 0 ? '+' : '') + distFwd.toFixed(1) + '% (Επιτόκιο: ' + carrySign + carryApr.toFixed(2) + '% ετησίως)';

  document.getElementById('kpiTouch').textContent = (nearest.pTouch * 100).toFixed(1) + '%';
  document.getElementById('kpiTouchSub').textContent = 'Στόχος: ' + fmtMoney(nearest.target) + ' (' + (distSpot >= 0 ? '+' : '') + distSpot.toFixed(1) + '%)';

  document.getElementById('kpiNoTouch').textContent = (nearest.pNoTouch * 100).toFixed(1) + '%';
  document.getElementById('kpiNoTouchSub').textContent = 'Πιθανότητα να μην αγγίξει μέχρι τη λήξη';

  const pTouchVal = Math.max(1e-4, nearest.pTouch);
  const pExpireVal = Math.max(1e-4, nearest.pExpire);
  const bitsVal = -Math.log2(pTouchVal);
  const bits = bitsVal.toFixed(1);
  const rarityOdds = (1 / pTouchVal).toFixed(1);
  const spreadType = nearest.type === 'C' ? 'Call' : 'Put';
  const multStr = nearest.touchMult > 0 ? nearest.touchMult.toFixed(2) + 'x' : '—';

  let kellyHtml = '';
  if (nearest.touchMult > 1) {
    const b = nearest.touchMult - 1;
    const kellyFraction = pTouchVal - ((1 - pTouchVal) / b);
    if (kellyFraction > 0) {
      const fullKelly = (kellyFraction * 100).toFixed(1);
      const halfKelly = (kellyFraction * 50).toFixed(1);
      kellyHtml = '<span class="text-[#3ea87c] font-bold">+' + fullKelly + '% του Bankroll (Half-Kelly: ' + halfKelly + '%)</span> — Θετικό Edge (+EV) έναντι της αγοράς!';
    } else {
      kellyHtml = '<span class="text-[#c85648] font-bold">0.0% (-EV)</span> — Η αγορά τιμολογεί το spread ακριβά σε σχέση με το P(Touch).';
    }
  } else {
    kellyHtml = '<span class="text-[#8e99a8]">Μηδενικό ή ανεπαρκές Multiple</span>';
  }

  let shannonNarrative = '';
  if (pTouchVal >= 0.50) {
    shannonNarrative =
      '<div>• <b>Πληροφοριακή Δυσκολία ($I = -\\log_2 P_{\\text{Touch}}$):</b> ' +
      '<span class="mono font-bold text-[#c8963e]">' + bits + ' Bits</span> ' +
      '<span class="text-[11px] text-[#8e99a8]">(Σπανιότητα: <b>1 στις ' + rarityOdds + ' φορές</b> • Πιθανότητα: <b>' + (pTouchVal * 100).toFixed(1) + '%</b>)</span>. ' +
      '<span class="px-1.5 py-0.5 rounded bg-[#2e2617] text-[#c8963e] text-[10px] font-bold border border-[#524122]">Αναμενόμενος Θόρυβος Αγοράς (Noise / Baseline)</span>' +
      '<div class="text-[11px] text-[#8e99a8] mt-0.5 pl-3 border-l-2 border-[#c8963e]/40">' +
      'Η αγορά τιμολογεί ήδη την επαφή ως το πιθανότερο σενάριο ($P_{\\text{Touch}} \\ge 50\\%$). Η πρόβλεψη περιέχει <b>λιγότερο από 1 Bit πληροφορίας</b> (στατιστικά ευκολότερο κι από ένα απλό στρίψιμο νομίσματος). ' +
      'Πρόκειται για φυσιολογική, αναμενόμενη διακύμανση της αγοράς (Noise / Baseline) και όχι για σπάνιο προγνωστικό πλεονέκτημα (Alpha). ' +
      '<button onclick="openShannonModal()" class="text-[#9b88bf] hover:underline font-bold ml-1">🔬 Θεωρία Πληροφοριών Shannon &amp; Kelly ↗</button>' +
      '</div></div>';
  } else {
    const coinEquivalent = bitsVal.toFixed(1);
    shannonNarrative =
      '<div>• <b>Πληροφοριακή Δυσκολία ($I = -\\log_2 P_{\\text{Touch}}$):</b> ' +
      '<span class="mono font-bold text-[#9b88bf]">' + bits + ' Bits</span> ' +
      '<span class="text-[11px] text-[#8e99a8]">(Σπανιότητα: <b>1 στις ' + rarityOdds + ' φορές</b> • Πιθανότητα: <b>' + (pTouchVal * 100).toFixed(1) + '%</b>)</span>. ' +
      '<span class="px-1.5 py-0.5 rounded bg-[#221c2e] text-[#9b88bf] text-[10px] font-bold border border-[#3c2f52]">Πληροφοριακή Έκπληξη (Alpha / Rarity)</span>' +
      '<div class="text-[11px] text-[#8e99a8] mt-0.5 pl-3 border-l-2 border-[#9b88bf]/40">' +
      'Ισοδύναμο με <b>' + coinEquivalent + ' διαδοχικές σωστές προβλέψεις σε κορώνα-γράμματα</b> ($2^{-' + coinEquivalent + '} \\approx ' + (pTouchVal * 100).toFixed(1) + '\\%$). ' +
      'Εδώ ο αναλυτής ισχυρίζεται ότι κατέχει σπάνιο προγνωστικό πλεονέκτημα (Alpha) που η αγορά τιμολογεί ως απίθανο γεγονός. ' +
      '<button onclick="openShannonModal()" class="text-[#9b88bf] hover:underline font-bold ml-1">🔬 Ανάλυση Claude Shannon ↗</button>' +
      '</div></div>';
  }

  const verdictEl = document.getElementById('verdictText');
  verdictEl.innerHTML =
    '<div>• <b>Ισχυρισμός Πρόβλεψης:</b> Κίνηση στα <b>' + fmtMoney(nearest.target) + '</b> (' + (distSpot >= 0 ? '+' : '') + distSpot.toFixed(1) + '%) εντός <b>' + dte + ' ημερών</b>.</div>' +
    '<div>• <b>Αντικειμενικές Πιθανότητες Αγοράς:</b> <b>$P_{\\text{Touch}} = ' + (nearest.pTouch * 100).toFixed(1) + '\\%$</b> (Επαφή οποτεδήποτε) | <b>$P_{\\text{Expire}} = ' + (nearest.pExpire * 100).toFixed(1) + '\\%$</b> (Λήξη ITM).</div>' +
    shannonNarrative +
    '<div>• <b>Το Στοίχημα Skin in the Game:</b> Στενό Vertical Spread <b>' + nearest.k1 + ' / ' + nearest.k2 + ' ' + spreadType + '</b>. Κοστίζει <b>' + fmtMoney(nearest.spreadAsk) + '</b> σήμερα και αξίζει <b>' + fmtMoney(nearest.touchExit) + '</b> στο Touch.</div>' +
    '<div>• <b>Πολλαπλασιαστής Απόδοσης (Multiple):</b> <span class="font-bold text-[#3ea87c] text-sm">' + multStr + '</span>. Αν ο αναλυτής πιστεύει την πρόβλεψή του, η αγορά τον πληρώνει <b>' + multStr + '</b> τα χρήματά του. Αν δεν αγοράζει αυτό το spread, πουλάει λόγια χωρίς κόστος!</div>' +
    '<div>• <b>Kelly Criterion Sizing ($f^* = p - \\frac{1-p}{b}$):</b> ' + kellyHtml + '</div>';

  safeRenderMath(verdictEl);

  const touchLink = document.getElementById('optionStratTouchLink');
  const noTouchLink = document.getElementById('optionStratNoTouchLink');

  if (venue === 'CRYPTO') {
    const deribitUrl = 'https://www.deribit.com/options/' + symbol;
    touchLink.href = deribitUrl;
    noTouchLink.href = deribitUrl;
    touchLink.textContent = 'Touch Bet στο Deribit ↗';
    noTouchLink.textContent = 'No-Touch Bet στο Deribit ↗';
  } else {
    touchLink.href = buildCustomOptionStratUrl(symbol, nearest.type === 'C'
      ? [{ symbol: nearest.sym1, qty: 1 }, { symbol: nearest.sym2, qty: -1 }]
      : [{ symbol: nearest.sym2, qty: 1 }, { symbol: nearest.sym1, qty: -1 }]);
    noTouchLink.href = buildCustomOptionStratUrl(symbol, nearest.type === 'C'
      ? [{ symbol: nearest.sym1, qty: -1 }, { symbol: nearest.sym2, qty: 1 }]
      : [{ symbol: nearest.sym2, qty: -1 }, { symbol: nearest.sym1, qty: 1 }]);
    touchLink.textContent = 'Touch Bet στο OptionStrat ↗';
    noTouchLink.textContent = 'No-Touch Bet στο OptionStrat ↗';
  }

  renderSpreadsTable(nearest);

  // Update Asymmetric Multiplier Bar
  const riskCost = nearest.spreadAsk;
  const payoutVal = nearest.touchExit;
  const asymRiskValEl = document.getElementById('asymRiskVal');
  const asymPayoutValEl = document.getElementById('asymPayoutVal');
  const asymMultLabelEl = document.getElementById('asymMultLabel');
  const asymBitsBadgeEl = document.getElementById('asymBitsBadge');
  const asymRiskBarEl = document.getElementById('asymRiskBar');
  const asymPayoutBarEl = document.getElementById('asymPayoutBar');
  const asymSpotLabelEl = document.getElementById('asymSpotLabel');
  const asymTargetLabelEl = document.getElementById('asymTargetLabel');

  if (asymRiskValEl) asymRiskValEl.textContent = fmtMoney(riskCost);
  if (asymPayoutValEl) asymPayoutValEl.textContent = fmtMoney(payoutVal);
  if (asymMultLabelEl) asymMultLabelEl.textContent = '⚡ ' + multStr + ' Multiple';
  if (asymBitsBadgeEl) {
    if (pTouchVal >= 0.50) {
      asymBitsBadgeEl.innerHTML = '<span>🔬 ' + bits + ' Bits (1 στις ' + rarityOdds + ' • Θόρυβος Αγοράς)</span> <span class="text-[9px] bg-[#3c2f52] px-1 rounded font-sans">Εξήγηση ↗</span>';
    } else {
      asymBitsBadgeEl.innerHTML = '<span>🔬 ' + bits + ' Bits (1 στις ' + rarityOdds + ' • Σπάνιο Alpha)</span> <span class="text-[9px] bg-[#3c2f52] px-1 rounded font-sans">Εξήγηση ↗</span>';
    }
  }
  if (asymSpotLabelEl) asymSpotLabelEl.textContent = 'Spot: ' + fmtMoney(spot);
  if (asymTargetLabelEl) asymTargetLabelEl.textContent = 'Target: ' + fmtMoney(nearest.target);

  if (asymRiskBarEl && asymPayoutBarEl) {
    const totalVal = Math.max(1e-4, riskCost + payoutVal);
    const riskRatio = Math.min(60, Math.max(10, (riskCost / totalVal) * 100));
    asymRiskBarEl.style.width = riskRatio.toFixed(1) + '%';
    asymPayoutBarEl.style.width = (100 - riskRatio).toFixed(1) + '%';
  }

  renderSuperstructureBellChart(spot, forward, nearest.target, nearest.pTouch, nearest.pExpire, spreads);
}

function renderSpreadsTable(activeSpread) {
  const { spreads, spot, forward, currency, venue, symbol } = currentState;
  const tbody = document.getElementById('probTableBody');

  tbody.innerHTML = spreads.map(s => {
    const isSelected = activeSpread && s.target === activeSpread.target;
    const moveSpot = ((s.target / spot - 1) * 100);
    const moveFwd = ((s.target / forward - 1) * 100);
    const pTouchClamped = Math.max(1e-4, s.pTouch);
    const bits = (-Math.log2(pTouchClamped)).toFixed(1);
    const rarity = (1 / pTouchClamped).toFixed(1);
    const multStr = s.touchMult > 0 ? (s.touchMult.toFixed(2) + 'x') : '—';
    const isCall = s.type === 'C';
    const bitsColor = s.pTouch >= 0.5 ? 'text-[#c8963e]' : 'text-[#9b88bf] font-bold';

    const pnlUrl = venue === 'CRYPTO'
      ? ('https://www.deribit.com/options/' + symbol)
      : buildCustomOptionStratUrl(symbol, isCall
          ? [{ symbol: s.sym1, qty: 1 }, { symbol: s.sym2, qty: -1 }]
          : [{ symbol: s.sym2, qty: 1 }, { symbol: s.sym1, qty: -1 }]);

    const rowBg = isSelected
      ? 'bg-[#1e2736] font-bold text-white'
      : (s.target === spot ? 'bg-[#151921]' : '');

    return '<tr class="cursor-pointer transition ' + rowBg + '" onclick="selectTargetFromTable(' + s.target + ')">' +
      '<td class="p-3 font-bold text-[#e8eaed]">' + fmtMoney(s.target) + '</td>' +
      '<td class="p-3 ' + (moveSpot >= 0 ? 'text-[#3ea87c]' : 'text-[#d95d4e]') + '">' + (moveSpot >= 0 ? '+' : '') + moveSpot.toFixed(1) + '%</td>' +
      '<td class="p-3 text-[#d49a42]">' + (moveFwd >= 0 ? '+' : '') + moveFwd.toFixed(1) + '%</td>' +
      '<td class="p-3 font-sans text-gray-300">' + s.k1 + ' / ' + s.k2 + ' ' + (isCall ? '<span class="text-[#3ea87c]">Call</span>' : '<span class="text-[#d95d4e]">Put</span>') + '</td>' +
      '<td class="p-3 text-right font-bold text-[#3ea87c]">' + (s.pTouch * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right text-[#d95d4e]">' + (s.pNoTouch * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right text-[#9b7ad6]">' + (s.pExpire * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right mono ' + bitsColor + '" title="Σπανιότητα: 1 στις ' + rarity + ' φορές (' + (s.pTouch >= 0.5 ? 'Θόρυβος Αγοράς' : 'Σπάνιο Alpha') + ')">' + bits + ' <span class="text-[10px] text-[#8e99a8]">b</span></td>' +
      '<td class="p-3 text-right">' + fmtMoney(s.spreadAsk) + '</td>' +
      '<td class="p-3 text-right text-gray-300">' + fmtMoney(s.touchExit) + '</td>' +
      '<td class="p-3 text-right font-bold ' + (s.touchMult >= 2.0 ? 'text-[#3ea87c]' : 'text-[#d49a42]') + '">' + multStr + '</td>' +
      '<td class="p-3 text-center"><a href="' + pnlUrl + '" target="_blank" onclick="event.stopPropagation()" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
      '</tr>';
  }).join('');
}

function selectTargetFromTable(targetVal) {
  document.getElementById('targetSlider').value = targetVal;
  onSliderChange(targetVal);
}

function syncTimelineWithLiveChain() {
  const { spot, activeTarget, carryApr } = currentState;
  if (spot > 0) {
    document.getElementById('tlSpot').value = spot;
    document.getElementById('tlTarget').value = activeTarget > 0 ? activeTarget : (spot * 1.10).toFixed(2);
    document.getElementById('tlRate').value = carryApr !== 0 ? Math.abs(carryApr).toFixed(2) : '4.25';
  }
  runTimelineCalculator();
}

function runTimelineCalculator() {
  const spot = Number(document.getElementById('tlSpot').value);
  const target = Number(document.getElementById('tlTarget').value);
  const ivPct = Number(document.getElementById('tlIv').value);
  const ratePct = Number(document.getElementById('tlRate').value);

  if (spot <= 0 || target <= 0 || ivPct <= 0) return;

  const sigma = ivPct / 100.0;
  const r = ratePct / 100.0;
  const movePct = ((target / spot) - 1) * 100;
  const fmt = (v) => spot < 10 ? v.toFixed(4) : (spot < 1000 ? v.toFixed(2) : Math.round(v));

  document.getElementById('tlMovePct').textContent = (movePct >= 0 ? '+' : '') + movePct.toFixed(2) + '%';
  document.getElementById('tlMoveSub').textContent = 'Από ' + fmt(spot) + ' σε ' + fmt(target);

  let days50 = null;
  let days75 = null;
  for (let d = 1; d <= 1825; d++) {
    const p = analyticalTouchProbWithDrift(spot, target, d / 365.0, sigma, r);
    if (days50 === null && p >= 0.50) days50 = d;
    if (days75 === null && p >= 0.75) { days75 = d; break; }
  }

  const now = Date.now();
  if (days50 !== null) {
    const dt50 = new Date(now + days50 * 86400000).toISOString().slice(0, 10);
    document.getElementById('tlMedianDays').textContent = days50 + ' ημέρες';
    document.getElementById('tlMedianDate').textContent = 'Περνάει το 50% στις ' + dt50;
  } else {
    document.getElementById('tlMedianDays').textContent = '> 5 έτη';
    document.getElementById('tlMedianDate').textContent = 'Πολύ μακρινός στόχος για αυτή τη μεταβλητότητα';
  }

  if (days75 !== null) {
    const dt75 = new Date(now + days75 * 86400000).toISOString().slice(0, 10);
    document.getElementById('tlHighDays').textContent = days75 + ' ημέρες';
    document.getElementById('tlHighDate').textContent = 'Περνάει το 75% στις ' + dt75;
  } else {
    document.getElementById('tlHighDays').textContent = '> 5 έτη';
    document.getElementById('tlHighDate').textContent = 'Δεν φτάνει το 75% εντός 5ετίας';
  }

  const horizons = [3, 7, 14, 21, 30, 45, 60, 90, 120, 180, 270, 365];
  const tbody = document.getElementById('tlTableBody');

  tbody.innerHTML = horizons.map(days => {
    const tYears = days / 365.0;
    const dtStr = new Date(now + days * 86400000).toISOString().slice(0, 10);
    const fwd = spot * Math.exp(r * tYears);
    const pTouchDrift = analyticalTouchProbWithDrift(spot, target, tYears, sigma, r);
    const pTouchNaive = analyticalTouchProbWithDrift(spot, target, tYears, sigma, 0.0);
    const pExpireDrift = analyticalExpireProbWithDrift(spot, target, tYears, sigma, r);
    const pNoTouch = 1.0 - pTouchDrift;
    const fairMult = pTouchDrift > 0.001 ? (1.0 / pTouchDrift) : 999;

    const highlight = (days50 && Math.abs(days - days50) <= 7) ? 'bg-[#192620]' : '';

    return '<tr class="' + highlight + '">' +
      '<td class="p-3 font-bold text-[#e8eaed]">' + days + ' ημέρες</td>' +
      '<td class="p-3 text-[#9aa4b2]">' + dtStr + '</td>' +
      '<td class="p-3 text-right text-[#d49a42]">' + fmt(fwd) + '</td>' +
      '<td class="p-3 text-right font-bold text-[#3ea87c]">' + (pTouchDrift * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right text-[#637083]">' + (pTouchNaive * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right text-[#d95d4e]">' + (pNoTouch * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right text-[#9b7ad6]">' + (pExpireDrift * 100).toFixed(1) + '%</td>' +
      '<td class="p-3 text-right font-bold text-[#3ea87c]">' + (fairMult > 100 ? '>100x' : (fairMult.toFixed(2) + 'x')) + '</td>' +
      '</tr>';
  }).join('');

  renderTimelineCurveChart(spot, target, ivPct, ratePct, days50, days75);
}

// ==================== ΦΟΡΟΛΟΓΙΚΗ ΑΝΑΛΥΣΗ & ΒΑΣΗ ΚΟΣΤΟΥΣ / TAX & COST BASIS ANALYSIS ====================
window.currentTaxTradingMode = 'PRE_EXISTING';
window.currentTaxRegimeKey = 'GR_STOCKS';

function setTaxTradingMode(mode) {
  window.currentTaxTradingMode = mode;
  const btnFresh = document.getElementById('btnTaxModeFresh');
  const btnExisting = document.getElementById('btnTaxModeExisting');
  const costInput = document.getElementById('taxCostBasis') || document.getElementById('cockpitCostBasis');
  const stratCost = document.getElementById('stratCostBasis');

  if (mode === 'FRESH') {
    if (btnFresh) {
      btnFresh.className = 'p-3 rounded-lg border text-left transition flex items-start gap-3 bg-[#1e293b] border-[#3d76b8] shadow-md';
    }
    if (btnExisting) {
      btnExisting.className = 'p-3 rounded-lg border text-left transition flex items-start gap-3 bg-[#12161f] border-[#2d3848] opacity-75 hover:opacity-100';
    }
    if (costInput) {
      costInput.disabled = true;
      costInput.placeholder = 'Spot (Market.long)';
      costInput.value = '';
    }
    if (stratCost) {
      stratCost.disabled = true;
      stratCost.placeholder = 'Spot';
      stratCost.value = '';
    }
  } else {
    if (btnFresh) {
      btnFresh.className = 'p-3 rounded-lg border text-left transition flex items-start gap-3 bg-[#12161f] border-[#2d3848] opacity-75 hover:opacity-100';
    }
    if (btnExisting) {
      btnExisting.className = 'p-3 rounded-lg border text-left transition flex items-start gap-3 bg-[#1e1916] border-[#c8963e] shadow-md';
    }
    if (costInput) {
      costInput.disabled = false;
      costInput.placeholder = 'Cost Basis B';
    }
    if (stratCost) {
      stratCost.disabled = false;
      stratCost.placeholder = 'Spot';
    }
  }

  runStrategyScanner();
}

function applyTaxRegime(regimeKey) {
  const regime = TaxEngine.REGIMES[regimeKey];
  if (!regime) return;
  window.currentTaxRegimeKey = regimeKey;

  const rateEl1 = document.getElementById('stratTaxRate');
  const rateEl2 = document.getElementById('taxRateInput') || document.getElementById('cockpitTaxRate');
  if (rateEl1) rateEl1.value = regime.rate;
  if (rateEl2) rateEl2.value = regime.rate;

  const lawEl = document.getElementById('taxLawLabel') || document.getElementById('cockpitLawLabel');
  if (lawEl) lawEl.textContent = regime.law;

  const badgeEl = document.getElementById('taxRegimeBadge') || document.getElementById('taxCockpitRegimeBadge');
  if (badgeEl) {
    badgeEl.textContent = regime.name;
    badgeEl.className = regime.rate === 0
      ? 'text-xs px-2.5 py-1 rounded bg-[#3da678]/20 text-[#3da678] border border-[#3da678]/40 font-mono font-bold'
      : 'text-xs px-2.5 py-1 rounded bg-[#c8963e]/20 text-[#c8963e] border border-[#c8963e]/40 font-mono font-bold';
  }

  // Update regime button styles
  Object.keys(TaxEngine.REGIMES).forEach(key => {
    const btn = document.getElementById('btnRegime_' + key);
    if (!btn) return;
    if (key === regimeKey) {
      btn.className = 'px-2.5 py-1 rounded text-xs border border-[#3ea87c] bg-[#1a2e24] text-white font-semibold transition';
    } else {
      btn.className = 'px-2.5 py-1 rounded text-xs border border-[#2d3848] bg-[#1a2332] text-[#8e99a8] hover:border-[#3ea87c] transition';
    }
  });

  runStrategyScanner();
}

function setCostBasisPct(ratio) {
  const spot = currentState.spot || 100;
  const cost = (spot * ratio).toFixed(2);
  const costInput = document.getElementById('taxCostBasis') || document.getElementById('cockpitCostBasis');
  const stratCost = document.getElementById('stratCostBasis');

  if (ratio === 1.0) {
    setTaxTradingMode('FRESH');
  } else {
    setTaxTradingMode('PRE_EXISTING');
    if (costInput) costInput.value = cost;
    if (stratCost) stratCost.value = cost;
    runStrategyScanner();
  }
}

function syncTaxInputs(sourceId) {
  const costInput1 = document.getElementById('stratCostBasis');
  const costInput2 = document.getElementById('taxCostBasis') || document.getElementById('cockpitCostBasis');
  const rateInput1 = document.getElementById('stratTaxRate');
  const rateInput2 = document.getElementById('taxRateInput') || document.getElementById('cockpitTaxRate');

  if (sourceId === 'stratCostBasis' && costInput2) {
    costInput2.value = costInput1.value;
  } else if ((sourceId === 'taxCostBasis' || sourceId === 'cockpitCostBasis') && costInput1) {
    costInput1.value = costInput2.value;
  }

  if (sourceId === 'stratTaxRate' && rateInput2) {
    rateInput2.value = rateInput1.value;
  } else if ((sourceId === 'taxRateInput' || sourceId === 'cockpitTaxRate') && rateInput1) {
    rateInput1.value = rateInput2.value;
  }

  runStrategyScanner();
}

function updateTaxAnalysisHud(spot, costBasis, taxRate, taxMode, activeItem) {
  const spotEl = document.getElementById('taxSpotDisplay') || document.getElementById('cockpitSpotDisplay');
  const outlayEl = document.getElementById('taxCashOutlayDisplay') || document.getElementById('cockpitCashOutlayDisplay');
  const outlaySubEl = document.getElementById('taxCashOutlaySub') || document.getElementById('cockpitCashOutlaySub');
  const hudEmbedded = document.getElementById('hudEmbeddedTax');
  const hudEmbeddedSub = document.getElementById('hudEmbeddedTaxSub');
  const hudCliff = document.getElementById('hudTaxCliff');
  const hudCliffSub = document.getElementById('hudTaxCliffSub');
  const hudT2P = document.getElementById('hudT2P');
  const hudT2PSub = document.getElementById('hudT2PSub');
  const hudNeutral = document.getElementById('hudTaxNeutral');
  const hudNeutralSub = document.getElementById('hudTaxNeutralSub');
  const advisoryEl = document.getElementById('taxAdvisoryText');
  const advisoryBanner = document.getElementById('taxAdvisoryBanner');

  if (spotEl) spotEl.textContent = fmtMoney(spot);

  const K = activeItem?.strikeAbsolute || spot * 1.05;
  const P = Math.max(0, activeItem ? (spot - activeItem.breakEvenVsFullMoneyAbsolute) : (spot * 0.03));
  const DTE = activeItem?.DTE || 30;

  const evalRes = TaxEngine.evaluateContract({
    spot, strike: K, premium: P, costBasis, taxRate, dte: DTE, mode: taxMode
  });

  if (outlayEl) {
    if (taxMode === 'FRESH') {
      outlayEl.textContent = fmtMoney(evalRes.initialCashOutlay);
      outlayEl.className = 'mono text-base font-bold text-[#c8963e] py-1.5';
      if (outlaySubEl) outlaySubEl.textContent = `Αγορά Spot (${fmtMoney(spot)}) - Premium (${fmtMoney(P)})`;
    } else {
      outlayEl.textContent = '$0.00';
      outlayEl.className = 'mono text-base font-bold text-[#3da678] py-1.5';
      if (outlaySubEl) outlaySubEl.textContent = 'Υπάρχουσα θέση (μηδενικό cash flow σήμερα)';
    }
  }

  if (hudEmbedded) hudEmbedded.textContent = fmtMoney(evalRes.embeddedTaxNow);
  if (hudEmbeddedSub) {
    hudEmbeddedSub.textContent = evalRes.embeddedTaxNow > 0
      ? `Αναβαλλόμενο κέρδος: ${fmtMoney(spot - costBasis)}`
      : 'Μηδενικός ιστορικός φόρος';
  }

  if (hudCliff) hudCliff.textContent = fmtMoney(evalRes.cliffLoss);
  if (hudCliffSub) {
    hudCliffSub.textContent = `Στο Strike ${fmtMoney(K)} (${(taxRate * 100).toFixed(0)}% φόρος)`;
  }

  if (hudT2P) {
    hudT2P.textContent = evalRes.t2p.label;
    hudT2P.className = 'text-xl font-bold mono mt-1 ' + (
      evalRes.t2p.status === 'TRAP' ? 'text-[#ff5252]' : (evalRes.t2p.status === 'MODERATE' ? 'text-[#c8963e]' : 'text-[#3da678]')
    );
  }
  if (hudT2PSub) {
    hudT2PSub.textContent = evalRes.t2p.status === 'TRAP'
      ? '🔴 TAX TRAP (Φόρος > Premium!)'
      : (evalRes.t2p.status === 'MODERATE' ? '🟡 Μέτριο Ρίσκο (50-100%)' : '🟢 Ασφαλής Ζώνη (<0.5x)');
    hudT2PSub.className = 'text-[10px] mt-0.5 ' + (
      evalRes.t2p.status === 'TRAP' ? 'text-[#ff8a80]' : (evalRes.t2p.status === 'MODERATE' ? 'text-[#e0aa4f]' : 'text-[#3da678]')
    );
  }

  if (hudNeutral) hudNeutral.textContent = fmtMoney(evalRes.taxNeutralTarget);
  if (hudNeutralSub) {
    hudNeutralSub.textContent = `Strike+Prem ≥ ${fmtMoney(evalRes.taxNeutralTarget)} για Net ≥ Spot`;
  }

  if (advisoryEl && advisoryBanner) {
    if (taxMode === 'FRESH') {
      advisoryBanner.className = 'p-3 rounded-lg bg-[#14202d] border border-[#3d76b8]/50 text-xs text-[#ebe8e1] leading-relaxed flex items-start gap-2.5';
      advisoryEl.innerHTML = `<b>🛒 Fresh Buy-Write Mode (Market.long):</b> Αγοράζεις 100 μετοχές στο Spot <b>${fmtMoney(spot)}</b> και πουλάς Call. Αρχική εκροή: <b>${fmtMoney(evalRes.initialCashOutlay)}</b>. Δεν κουβαλάς ιστορικό φόρο. Αν ασκηθείς στο ${fmtMoney(K)}, κλειδώνεις καθαρό κέρδος <b>+${fmtMoney(evalRes.deltaVsSpot)} (+${evalRes.deltaVsSpotPct.toFixed(2)}%)</b>.`;
    } else if (evalRes.isTaxTrap) {
      advisoryBanner.className = 'p-3 rounded-lg bg-[#2b1416] border border-[#ff5252]/60 text-xs text-[#ebe8e1] leading-relaxed flex items-start gap-2.5 shadow-lg';
      advisoryEl.innerHTML = `<b class="text-[#ff8a80]">⚠️ TAX TRAP ALERT (T2P: ${evalRes.t2p.label}):</b> Ο φόρος εκχώρησης (<b>${fmtMoney(evalRes.cliffLoss)}</b>) υπερβαίνει το premium (<b>${fmtMoney(P)}</b>)! Ρισκάρεις να ρευστοποιήσεις όλη την ιστορική υπεραξία και να πληρώσεις περισσότερο φόρο από ό,τι κερδίζεις. <b>Σύσταση:</b> Επίλεξε Strike <b>&ge; ${fmtMoney(evalRes.taxNeutralTarget)}</b> με χαμηλό Delta (&lt;0.15) για να διατηρήσεις την υπεραξία unrealized.`;
    } else {
      advisoryBanner.className = 'p-3 rounded-lg bg-[#18202c] border border-[#3d76b8]/40 text-xs text-[#ebe8e1] leading-relaxed flex items-start gap-2.5';
      advisoryEl.innerHTML = `<b>💼 Pre-Existing Holding (Cost Basis ${fmtMoney(costBasis)}):</b> Κουβαλάς <b>${fmtMoney(evalRes.embeddedTaxNow)}</b> αναβαλλόμενο φόρο. Στο επιλεγμένο Strike ${fmtMoney(K)}, τα καθαρά μετρητά αν γίνει assignment είναι <b>${fmtMoney(evalRes.netCash)}</b> (${evalRes.deltaVsSpotPct >= 0 ? '+' : ''}${evalRes.deltaVsSpotPct.toFixed(2)}% vs Spot ${evalRes.isTaxSafe ? '✅' : '⚠️'}). Αν λήξει OTM, κρατάς το 100% των τεμαχίων σου και ο φόρος μετοχής παραμένει 0%!`;
    }
  }
}

async function runStrategyScanner() {
  const thead = document.getElementById('stratTableHead');
  const tbody = document.getElementById('stratTableBody');
  const note = document.getElementById('stratTheoryNote');
  const badge = document.getElementById('stratSummaryBadge');

  const venue = document.getElementById('venueSelect').value;
  const ticker = document.getElementById('tickerInput').value.trim().toUpperCase();
  const strat = document.getElementById('stratType').value;
  const slip = Number(document.getElementById('stratSlippage').value);
  const minDte = Number(document.getElementById('stratMinDte').value);
  const maxDte = Number(document.getElementById('stratMaxDte').value);

  tbody.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-gray-400 font-sans">Σάρωση στρατηγικών σε όλες τις λήξεις για ' + ticker + '...</td></tr>';

  try {
    let fn = null;
    if (venue === 'CRYPTO') {
      if (strat === 'CC') fn = window.deribitCoveredCallsDart;
      if (strat === 'VS') fn = window.deribitVerticalSpreadsDart;
      if (strat === 'STRADDLE') fn = window.deribitStraddlesDart;
      if (strat === 'LONG') fn = window.deribitLongOptionsDart;
    } else {
      if (strat === 'CC') fn = window.yfinanceCoveredCallsDart;
      if (strat === 'VS') fn = window.yfinanceVerticalSpreadsDart;
      if (strat === 'STRADDLE') fn = window.yfinanceStraddlesDart;
      if (strat === 'LONG') fn = window.yfinanceLongOptionsDart;
    }

    const jsonStr = await fn(ticker, slip, minDte, maxDte);
    const items = JSON.parse(jsonStr);

    const ccSection = document.getElementById('ccAnalysisSection') || document.getElementById('ccCockpitSection');
    const straddleSection = document.getElementById('straddlesAnalysisSection') || document.getElementById('straddlesCockpitSection');
    const vsSection = document.getElementById('vsAnalysisSection') || document.getElementById('vsCockpitSection');
    const longSection = document.getElementById('longAnalysisSection') || document.getElementById('longCockpitSection');

    if (ccSection) ccSection.classList.toggle('hidden', strat !== 'CC');
    if (straddleSection) straddleSection.classList.toggle('hidden', strat !== 'STRADDLE');
    if (vsSection) vsSection.classList.toggle('hidden', strat !== 'VS');
    if (longSection) longSection.classList.toggle('hidden', strat !== 'LONG');

    if (strat === 'CC') {
      const rawBasis = document.getElementById('taxCostBasis')?.value || document.getElementById('stratCostBasis')?.value || document.getElementById('cockpitCostBasis')?.value;
      const taxPct = Number(document.getElementById('taxRateInput')?.value || document.getElementById('stratTaxRate')?.value || document.getElementById('cockpitTaxRate')?.value || 0);
      const taxMode = window.currentTaxTradingMode || 'PRE_EXISTING';
      const taxRate = TaxEngine.resolveTaxRate(taxPct);
      const taxSafeOnly = document.getElementById('stratTaxSafeOnly')?.checked;

      let validCC = items.filter(x => x.strikeRelative >= 0.995 && x.moneyYield > 1.002);
      const spot0 = validCC[0]?.spotPrice || currentState.spot || 100;
      const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot0, taxMode);
      const isTaxActive = taxRate > 0 && (taxMode === 'FRESH' || costBasis !== spot0);

      // Filter by Tax-Safe if toggled
      if (taxSafeOnly && isTaxActive) {
        validCC = validCC.filter(x => {
          const prem = Math.max(0, (x.spotPrice || spot0) - x.breakEvenVsFullMoneyAbsolute);
          const ev = TaxEngine.evaluateContract({
            spot: x.spotPrice || spot0,
            strike: x.strikeAbsolute,
            premium: prem,
            costBasis,
            taxRate,
            dte: x.DTE,
            mode: taxMode
          });
          return ev.isTaxSafe;
        });
      }

      const embeddedTaxNow = TaxEngine.calcEmbeddedTax(spot0, costBasis, taxRate);
      const taxFreeTarget = TaxEngine.calcTaxNeutralTarget(spot0, costBasis, taxRate);

      badge.textContent = validCC.length + ' Covered Calls' + (taxSafeOnly ? ' (Tax-Safe Only)' : '');

      const assetUnit = venue === 'CRYPTO' ? ticker : 'μετοχή';
      note.innerHTML = isTaxActive
        ? (taxMode === 'FRESH'
            ? '💡 <b>Νέα Θέση Αγοράς Υποκειμένου &amp; Πώλησης Call / Fresh Buy-Write Mode (Spot: ' + fmtMoney(spot0) + '):</b> ' +
              'Αγορά του asset και ταυτόχρονη πώληση Call. Αρχική καθαρή εκροή: <b>Spot - Premium</b>. ' +
              'Χωρίς αναβαλλόμενο ιστορικό φόρο. Κέρδη πάνω από το Spot φορολογούνται με ' + (taxRate * 100).toFixed(0) + '%.'
            : '💡 <b>Φορολογική Ανάλυση &amp; Βάση Κόστους / Taxation &amp; Cost Basis (Βάση Κόστους / Cost Basis: ' + fmtMoney(costBasis) + ' | ' + (TaxEngine.REGIMES[window.currentTaxRegimeKey]?.name || (taxPct + '%')) + '):</b> ' +
              'Σήμερα κουβαλάς <b>' + fmtMoney(embeddedTaxNow) + '/' + assetUnit + '</b> αναβαλλόμενη (unrealized) φορολογική υποχρέωση. ' +
              'Σε περίπτωση λήξης OTM, ο φόρος κεφαλαιακών κερδών παραμένει <b>0%</b>! Σε περίπτωση άσκησης (Assignment), για πλήρη κάλυψη του φόρου ' +
              'απαιτείται <b>Strike + Premium &ge; ' + fmtMoney(taxFreeTarget) + '</b>. ' +
              'Παρακολούθηση δείκτη <b>T2P / Alert</b> για αποφυγή φορολογικής επιβάρυνσης!')
        : '💡 <b>Καλυμμένο Δικαίωμα Αγοράς / Covered Call (Αφορολόγητο ή Spot = Basis):</b> ' +
          'Διπλή αξιολόγηση: <b>Απόδοση σε Χρήμα ($)</b> (αν ασκηθείς) έναντι <b>Απόδοσης σε Τεμάχια</b> (πόσες περισσότερες μονάδες διακρατούνται μέσω του premium αν δεν ασκηθείς). ' +
          'Χρησιμοποίησε την ενότητα <b>Φορολογική Ανάλυση &amp; Βάση Κόστους / Taxation &amp; Cost Basis</b> παραπάνω για να εισάγεις το πραγματικό ιστορικό κόστος κτήσης.';

      currentCcItems = validCC;
      selectCcProfile('BALANCED');

      thead.innerHTML = '<tr class="border-b border-[#26303e] text-[11px]">' +
        '<th class="p-3">Λήξη / Expiration (DTE)</th>' +
        '<th class="p-3">Τιμή Άσκησης / Strike</th>' +
        '<th class="p-3 text-right">Ασφάλιστρο / Premium (' + (venue === 'CRYPTO' ? ticker : 'μετ.') + ')</th>' +
        '<th class="p-3 text-right text-[#c85648]">Φόρος Άσκησης / Tax</th>' +
        '<th class="p-3 text-right font-bold text-white">Καθαρά Μετρητά / Net Cash</th>' +
        '<th class="p-3 text-right">Net vs Spot Σήμερα</th>' +
        '<th class="p-3 text-center">Κατάσταση / T2P Status</th>' +
        '<th class="p-3 text-right text-[#9b88bf]">Τιμή Επαναγοράς / Rebuy Price</th>' +
        '<th class="p-3 text-right">Πιθανότητα Άσκησης / P(Assignment)</th>' +
        '<th class="p-3 text-center">Διάγραμμα / Payoff</th>' +
        '</tr>';

      validCC.sort((a, b) => ((b.moneyYield - 1) / b.DTE) - ((a.moneyYield - 1) / a.DTE));

      tbody.innerHTML = validCC.slice(0, 60).map(x => {
        const s = x.spotPrice || spot0;
        const k = x.strikeAbsolute;
        const prem = Math.max(0, s - x.breakEvenVsFullMoneyAbsolute);
        const taxEval = TaxEngine.evaluateContract({
          spot: s,
          strike: k,
          premium: prem,
          costBasis,
          taxRate,
          dte: x.DTE,
          mode: taxMode
        });

        const moveStrike = ((x.strikeRelative - 1) * 100).toFixed(1);
        const pAssign = x.moneyProbability != null ? ((x.moneyProbability * 100).toFixed(1) + '%') : '—';
        const isRowMatch = currentCcActiveItem && currentCcActiveItem.strikeAbsolute === k;

        const t2pBadge = !isTaxActive
          ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#232d3b] text-[#8e99a8] font-mono">0% Tax</span>'
          : (taxEval.isTaxTrap
              ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#ff5252]/20 text-[#ff8a80] font-mono font-bold" title="Tax Cliff exceeds Option Premium">🔴 TRAP ' + taxEval.t2p.label + '</span>'
              : (taxEval.t2p.status === 'MODERATE'
                  ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#c8963e]/20 text-[#e0aa4f] font-mono font-bold">🟡 ' + taxEval.t2p.label + '</span>'
                  : '<span class="text-[10px] px-1.5 py-0.5 rounded bg-[#3da678]/15 text-[#3da678] font-mono font-bold">🟢 ' + taxEval.t2p.label + '</span>'));

        return '<tr class="cursor-pointer transition ' + (isRowMatch ? 'bg-[#222e40] font-bold text-white' : (taxEval.isTaxSafe ? 'hover:bg-[#1a2332]' : 'bg-[#241a18]/40 hover:bg-[#2e1f1d]')) + '" data-strike="' + k + '" onclick="selectCcItemByStrike(' + k + ')">' +
          '<td class="p-3">' + x.formattedDate + ' <span class="text-gray-500">(' + x.DTE + 'd)</span></td>' +
          '<td class="p-3 font-bold">' + fmtMoney(k) + ' <span class="text-[#3ea87c]">(+' + moveStrike + '%)</span></td>' +
          '<td class="p-3 text-right text-[#3d76b8]">+' + fmtMoney(prem) + '</td>' +
          '<td class="p-3 text-right text-[#c85648]">-' + fmtMoney(taxEval.taxPaid) + '</td>' +
          '<td class="p-3 text-right font-bold text-white">' + fmtMoney(taxEval.netCash) + '</td>' +
          '<td class="p-3 text-right font-bold ' + (taxEval.isTaxSafe ? 'text-[#3ea87c]' : 'text-[#c8963e]') + '">' +
            (taxEval.deltaVsSpotPct >= 0 ? '+' : '') + taxEval.deltaVsSpotPct.toFixed(2) + '% ' + (taxEval.isTaxSafe ? '✅' : '⚠️') +
          '</td>' +
          '<td class="p-3 text-center">' + t2pBadge + '</td>' +
          '<td class="p-3 text-right text-[#9b88bf]">' + fmtMoney(taxEval.rebuyPrice) + '</td>' +
          '<td class="p-3 text-right text-[#8e99a8]">' + pAssign + '</td>' +
          '<td class="p-3 text-center"><a href="' + x.strategyURL + '" target="_blank" onclick="event.stopPropagation()" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
        '</tr>';
      }).join('');

      // Refresh the Tax HUD with active item
      updateTaxAnalysisHud(spot0, costBasis, taxRate, taxMode, currentCcActiveItem || validCC[0]);
    } else if (strat === 'VS') {
      const actionable = items.filter(x => x.touchReturnMultiple >= 1.25 && x.probTouchBeforeExpiry >= 0.02);
      badge.textContent = actionable.length + ' Touch Spreads';

      if (vsSection) renderVsFrontierChart(actionable);

      note.innerHTML =
        '💡 <b>Κάθετα Ανοίγματα Επαφής / Touch Spreads:</b> Εντοπίζει κάθετα ανοίγματα (Vertical Spreads) όπου ο καθαρός πολλαπλασιαστής απόδοσης στο Touch υπερβαίνει το <b>1.25x</b> μετά το Slippage.';

      thead.innerHTML = '<tr class="border-b border-[#26303e] text-[11px]">' +
        '<th class="p-3">Λήξη / Expiration (DTE)</th>' +
        '<th class="p-3">Τιμή-Στόχος / Target</th>' +
        '<th class="p-3">Κάθετο Άνοιγμα / Spread</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Πιθανότητα Επαφής / P(Touch)</th>' +
        '<th class="p-3 text-right text-[#9b7ad6]">Πιθανότητα Λήξης / P(Expire)</th>' +
        '<th class="p-3 text-right">Κόστος / Premium (Ask)</th>' +
        '<th class="p-3 text-right">Αξία στο Touch / Touch Value</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Πολλαπλασιαστής / Multiple</th>' +
        '<th class="p-3 text-center">Διάγραμμα / Payoff</th>' +
        '</tr>';

      actionable.sort((a, b) => b.touchReturnMultiple - a.touchReturnMultiple);

      tbody.innerHTML = actionable.slice(0, 60).map(x => {
        return '<tr>' +
          '<td class="p-3">' + x.formattedDate + ' <span class="text-gray-500">(' + x.DTE + 'd)</span></td>' +
          '<td class="p-3 font-bold">' + fmtMoney(x.target) + '</td>' +
          '<td class="p-3 font-sans text-gray-300">' + x.spreadLabel + '</td>' +
          '<td class="p-3 text-right font-bold text-[#3ea87c]">' + (x.probTouchBeforeExpiry * 100).toFixed(1) + '%</td>' +
          '<td class="p-3 text-right text-[#9b7ad6]">' + (x.probExpireBeyondTarget * 100).toFixed(1) + '%</td>' +
          '<td class="p-3 text-right">' + fmtMoney(x.spreadCostAsk) + '</td>' +
          '<td class="p-3 text-right">' + fmtMoney(x.touchExitValue) + '</td>' +
          '<td class="p-3 text-right font-bold text-[#3ea87c]">' + x.touchReturnMultiple.toFixed(2) + 'x</td>' +
          '<td class="p-3 text-center"><a href="' + x.strategyURL + '" target="_blank" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
          '</tr>';
      }).join('');
    } else if (strat === 'STRADDLE') {
      badge.textContent = items.length + ' Straddles';
      if (straddleSection) renderStraddlesCorridorChart(items);

      note.innerHTML = '💡 <b>Αμφίδρομα Ανοίγματα / Straddles (Αναμενόμενο Εύρος Κίνησης / Implied Volatility Corridor):</b> Ταυτόχρονη αγορά ATM Call και ATM Put για απεικόνιση του εύρους διακύμανσης (±%) που τιμολογεί η αγορά μέχρι τη λήξη.';

      thead.innerHTML = '<tr class="border-b border-[#26303e] text-[11px]">' +
        '<th class="p-3">Λήξη / Expiration (DTE)</th>' +
        '<th class="p-3">Τιμή Άσκησης / Central Strike</th>' +
        '<th class="p-3 text-right text-[#d95d4e]">Κάτω Νεκρό Σημείο / Lower Breakeven</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Άνω Νεκρό Σημείο / Upper Breakeven</th>' +
        '<th class="p-3 text-right text-[#d49a42]">Εύρος Αγοράς / Market Corridor (±%)</th>' +
        '<th class="p-3 text-right">Συνολικό Κόστος / Total Premium</th>' +
        '<th class="p-3 text-center">Διάγραμμα / Payoff</th>' +
        '</tr>';

      tbody.innerHTML = items.slice(0, 60).map(x => {
        const corridorPct = x.impliedCorridorPct.toFixed(1);
        const downPct = (((x.breakEvenVsFullMoneyDownAbsolute / currentState.spot) - 1) * 100).toFixed(1);
        const upPct = (((x.breakEvenVsFullMoneyUpAbsolute / currentState.spot) - 1) * 100).toFixed(1);

        return '<tr>' +
          '<td class="p-3 font-bold">' + x.formattedDate + ' <span class="text-gray-500">(' + x.DTE + 'd)</span></td>' +
          '<td class="p-3">' + fmtMoney(x.strikeAbsolute) + '</td>' +
          '<td class="p-3 text-right text-[#d95d4e]">' + fmtMoney(x.breakEvenVsFullMoneyDownAbsolute) + ' (' + downPct + '%)</td>' +
          '<td class="p-3 text-right text-[#3ea87c]">' + fmtMoney(x.breakEvenVsFullMoneyUpAbsolute) + ' (+' + upPct + '%)</td>' +
          '<td class="p-3 text-right font-bold text-[#d49a42]">±' + (corridorPct / 2).toFixed(1) + '% (Εύρος ' + corridorPct + '%)</td>' +
          '<td class="p-3 text-right">' + fmtMoney(x.moneySize) + '</td>' +
          '<td class="p-3 text-center"><a href="' + x.strategyURL + '" target="_blank" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
          '</tr>';
      }).join('');
    } else if (strat === 'LONG') {
      badge.textContent = items.length + ' Συμβόλαια / Contracts';
      if (longSection) renderLongLeverageChart(items);

      note.innerHTML = '💡 <b>Απλά Δικαιώματα Αγοράς &amp; Πώλησης / Long Calls &amp; Puts (Κατάταξη Μόχλευσης / Leverage Ranking):</b> Απεικόνιση πραγματικής αποτελεσματικής μόχλευσης (Spot / Ασφάλιστρο Option) ανά συμβόλαιο.';

      thead.innerHTML = '<tr class="border-b border-[#26303e] text-[11px]">' +
        '<th class="p-3">Λήξη / Expiration (DTE)</th>' +
        '<th class="p-3">Τύπος / Option Type</th>' +
        '<th class="p-3">Τιμή Άσκησης / Strike</th>' +
        '<th class="p-3 text-right text-[#d95d4e]">Νεκρό Σημείο / Breakeven</th>' +
        '<th class="p-3 text-right text-[#9b88bf]">Απόσταση / Distance (%)</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Μόχλευση / Effective Leverage</th>' +
        '<th class="p-3 text-right">Κόστος / Option Premium</th>' +
        '<th class="p-3 text-center">Διάγραμμα / Payoff</th>' +
        '</tr>';

      items.sort((a, b) => b.maxLeverage - a.maxLeverage);

      tbody.innerHTML = items.slice(0, 60).map(x => {
        const beMove = ((x.breakEvenVsFullMoneyRelative - 1) * 100).toFixed(1);
        const isCall = x.strategyType === 'longCall';

        return '<tr>' +
          '<td class="p-3">' + x.formattedDate + ' <span class="text-gray-500">(' + x.DTE + 'd)</span></td>' +
          '<td class="p-3 font-sans font-bold ' + (isCall ? 'text-[#3ea87c]' : 'text-[#d95d4e]') + '">' + (isCall ? 'Call ↗' : 'Put ↘') + '</td>' +
          '<td class="p-3 font-bold">' + fmtMoney(x.strikeAbsolute) + '</td>' +
          '<td class="p-3 text-right">' + fmtMoney(x.breakEvenVsFullMoneyAbsolute) + '</td>' +
          '<td class="p-3 text-right ' + (Number(beMove) >= 0 ? 'text-[#3ea87c]' : 'text-[#d95d4e]') + '">' + (Number(beMove) >= 0 ? '+' : '') + beMove + '%</td>' +
          '<td class="p-3 text-right font-bold text-[#3ea87c]">' + x.maxLeverage.toFixed(1) + 'x</td>' +
          '<td class="p-3 text-right">' + fmtMoney(x.moneySize) + '</td>' +
          '<td class="p-3 text-center"><a href="' + x.strategyURL + '" target="_blank" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
          '</tr>';
      }).join('');
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="10" class="p-6 text-center text-red-400 font-sans">Σφάλμα σάρωσης: ' + err.message + '</td></tr>';
  }
}

function copyShareableUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('venue', currentState.venue);
  url.searchParams.set('symbol', currentState.symbol);
  if (currentState.selectedExp) url.searchParams.set('exp', currentState.selectedExp);
  if (currentState.activeTarget) url.searchParams.set('target', currentState.activeTarget);

  navigator.clipboard.writeText(url.toString()).then(() => {
    const btn = document.getElementById('shareBtn');
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = '✅ Αντιγράφηκε!';
      btn.classList.add('bg-[#1e4433]', 'text-[#3ea87c]');
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.classList.remove('bg-[#1e4433]', 'text-[#3ea87c]');
      }, 2000);
    }
  }).catch(() => {
    prompt('Αντιγραφή συνδέσμου:', url.toString());
  });
}

// --- SHANNON INFORMATION & KELLY MODAL LOGIC ---
function safeRenderMath(container) {
  if (!container) return;
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(container, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } catch (e) {
      console.warn('KaTeX render note:', e);
    }
  }
}

function openShannonModal() {
  const modal = document.getElementById('shannonModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  const activePt = currentState && currentState.spreads && currentState.spreads.length > 0 && currentState.activeTarget > 0
    ? (currentState.spreads.find(s => s.target === currentState.activeTarget)?.pTouch || 0.707)
    : 0.707;
  const pPct = Math.max(1, Math.min(99, activePt * 100));
  const slider = document.getElementById('modalProbSlider');
  if (slider) slider.value = pPct.toFixed(1);
  onShannonSlider(pPct);
  safeRenderMath(modal);
}

function closeShannonModal() {
  const modal = document.getElementById('shannonModal');
  if (modal) modal.classList.add('hidden');
}

function onShannonSlider(val) {
  const p = Number(val) / 100.0;
  if (p <= 0 || p >= 1) return;

  const bits = (-Math.log2(p)).toFixed(2);
  const odds = (1 / p).toFixed(1);
  const fairMult = (1 / p).toFixed(2) + 'x';

  const badge = document.getElementById('modalProbBadge');
  const outProb = document.getElementById('modalOutProb');
  const outBits = document.getElementById('modalOutBits');
  const outOdds = document.getElementById('modalOutOdds');
  const outMult = document.getElementById('modalOutMult');
  const outInterp = document.getElementById('modalOutInterpretation');

  if (badge) badge.textContent = 'P = ' + (p * 100).toFixed(1) + '%';
  if (outProb) outProb.textContent = (p * 100).toFixed(1) + '%';
  if (outBits) outBits.textContent = bits + ' Bits';
  if (outOdds) outOdds.textContent = '1 στις ' + odds;
  if (outMult) outMult.textContent = fairMult;

  if (outInterp) {
    if (p >= 0.50) {
      outInterp.className = 'p-2.5 rounded bg-[#241c12] border border-[#4d3a1f] text-[11px] leading-relaxed text-[#e0b96b]';
      outInterp.innerHTML =
        '<b>📻 Καθεστώς 1 — Αναμενόμενος Θόρυβος Αγοράς (Noise / Baseline Distribution):</b><br/>' +
        'Επειδή η πιθανότητα είναι $\\ge 50\\%$, η αυτοπληροφορία είναι <b>λιγότερο από 1 Bit</b> ($I < 1.0$). ' +
        'Στατιστικά είναι ευκολότερο ακόμη κι από ένα στρίψιμο νομίσματος. Μια πρόβλεψη σε αυτή τη ζώνη ' +
        'δεν παρέχει ουσιαστική στατιστική πληροφόρηση (μηδενικός Alpha), καθώς αντικατοπτρίζει τη φυσιολογική συμπεριφορά της αγοράς.';
    } else {
      const flips = Number(bits).toFixed(1);
      outInterp.className = 'p-2.5 rounded bg-[#1c1628] border border-[#3e2e58] text-[11px] leading-relaxed text-[#c3b6dd]';
      outInterp.innerHTML =
        '<b>⚡ Καθεστώς 2 — Πληροφοριακή Έκπληξη (Forecasting Alpha &amp; Surprisal):</b><br/>' +
        'Επειδή η πιθανότητα είναι $< 50\\%$, η πρόβλεψη απαιτεί <b>' + bits + ' Bits καθαρής έκπληξης</b>. ' +
        'Ισοδυναμεί με <b>' + flips + ' διαδοχικές σωστές προβλέψεις σε κορώνα-γράμματα</b> ($2^{-' + flips + '} \\approx ' + (p * 100).toFixed(1) + '\\%$). ' +
        'Εφόσον υφίσταται πραγματικό στατιστικό πλεονέκτημα, η αγορά προσφέρει δίκαιο πολλαπλασιαστή <b>' + fairMult + '</b> στο Touch. ' +
        'Η αξιοποίηση τέτοιων σεναρίων απαιτεί αυστηρό έλεγχο κινδύνου (Skin in the Game).';
    }
    safeRenderMath(outInterp);
  }
}

// --- TAB 5: RISK MANAGEMENT & STRESS TESTING SIMULATORS ---
function runRuinSimulator() {
  const probSlider = document.getElementById('ruinProbSlider');
  const tradesSlider = document.getElementById('ruinTradesSlider');
  if (!probSlider || !tradesSlider) return;

  const p = Number(probSlider.value) / 100.0;
  const n = Number(tradesSlider.value);

  const probLabel = document.getElementById('ruinProbLabel');
  const tradesLabel = document.getElementById('ruinTradesLabel');
  const oddsBadge = document.getElementById('ruinOddsBadge');
  const verdictBox = document.getElementById('ruinVerdictBox');

  if (probLabel) probLabel.textContent = (p * 100).toFixed(0) + '%';
  if (tradesLabel) tradesLabel.textContent = n;

  const pZeroWins = Math.pow(1 - p, n);
  const ruinOddsPct = (pZeroWins * 100).toFixed(1);
  const bitsPerTrade = (-Math.log2(p)).toFixed(1);

  if (oddsBadge) oddsBadge.textContent = 'Πιθανότητα Μηδενικών Επιτυχιών: ' + ruinOddsPct + '%';

  if (verdictBox) {
    verdictBox.innerHTML =
      'Σε <b>' + n + '</b> διαδοχικές συναλλαγές βαθιά OTM δικαιωμάτων με $P = ' + (p * 100).toFixed(0) + '\\%$, ' +
      'η πιθανότητα μηδενικής επιτυχίας (πλήρης απώλεια κεφαλαίου θέσης) ανέρχεται σε <span class="text-[#c85648] font-bold text-xs">' + ruinOddsPct + '%</span>! ' +
      'Απαιτούνται <b>' + bitsPerTrade + ' Bits</b> πληροφορίας ανά συναλλαγή, επιβαρυνόμενα από Bid-Ask Spread και Volatility Smile. ' +
      'Μαθηματικά, η συστηματική έκθεση σε τέτοιες κατανομές οδηγεί σε βέβαιη εξάντληση κεφαλαίου (Ruin).';
    safeRenderMath(verdictBox);
  }
}

function runTailShockSimulator() {
  const premSlider = document.getElementById('turkeyPremSlider');
  const shockSelect = document.getElementById('turkeyShockSelect');
  if (!premSlider || !shockSelect) return;

  const prem = Number(premSlider.value);
  const shockPct = Number(shockSelect.value);

  const premLabel = document.getElementById('turkeyPremLabel');
  const netBadge = document.getElementById('turkeyNetBadge');
  const verdictBox = document.getElementById('turkeyVerdictBox');

  if (premLabel) premLabel.textContent = '$' + prem;

  const yearlyGains = prem * 52;
  const notional = 60000;
  const grossLoss = notional * (shockPct / 100.0);
  const netPnL = yearlyGains - grossLoss;

  if (netBadge) {
    netBadge.textContent = 'Καθαρό Αποτέλεσμα (Net PnL): ' + (netPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(netPnL)).toLocaleString('en-US');
    netBadge.className = netPnL >= 0 ? 'mono text-[#3ea87c] font-bold' : 'mono text-[#c85648] font-bold';
  }

  if (verdictBox) {
    verdictBox.innerHTML =
      'Είσπραξη ασφαλίστρου <b>$' + prem + '/εβδομάδα</b> επί 52 εβδομάδες $\\implies$ Ετήσια σωρευμένη είσπραξη: <span class="text-[#3ea87c] font-bold">+$' + yearlyGains.toLocaleString('en-US') + '</span>.<br/>' +
      'Σενάριο ακραίας διόρθωσης (Tail Shock) <b>-' + shockPct + '%</b> $\\implies$ Ζημιά θέσης υποκειμένου: <span class="text-[#c85648] font-bold">-$' + Math.round(grossLoss).toLocaleString('en-US') + '</span>.<br/>' +
      '<b>Καθαρό Αποτέλεσμα:</b> <span class="' + (netPnL >= 0 ? 'text-[#3ea87c]' : 'text-[#c85648]') + ' font-bold">' + (netPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(netPnL)).toLocaleString('en-US') + '</span>. ' +
      'Ένα μεμονωμένο ακραίο γεγονός (Fat Tail) εξανεμίζει έως και <b>' + (grossLoss / (yearlyGains || 1)).toFixed(1) + ' έτη</b> εισπραχθέντων ασφαλίστρων.';
    safeRenderMath(verdictBox);
  }
}

// --- INITIALIZATION ---
(function initFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const venue = params.get('venue') || 'CRYPTO';
  const symbol = params.get('symbol') || 'BTC';
  const exp = params.get('exp');
  const target = params.get('target');

  document.getElementById('venueSelect').value = venue;
  document.getElementById('tickerInput').value = symbol;
  if (exp) currentState.selectedExp = exp;

  runTimelineCalculator();
  loadChain(target);

  setTimeout(() => {
    safeRenderMath(document.body);
    runRuinSimulator();
    runTailShockSimulator();
  }, 300);
})();

window.updateTaxAnalysisHud = updateTaxAnalysisHud;
window.updateTaxCockpitHud = updateTaxAnalysisHud;

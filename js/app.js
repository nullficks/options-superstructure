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
      'Η αγορά θεωρεί ήδη την επαφή ως το πιθανότερο σενάριο ($P_{\\text{Touch}} \\ge 50\\%$). Η πρόβλεψη περιέχει <b>λιγότερο από 1 Bit πληροφορίας</b> (ευκολότερο ακόμη κι από ένα απλό στρίψιμο νομίσματος!). ' +
      'Ο finfluencer πουλάει ως «επίτευγμα» αυτό που αποτελεί τη φυσιολογική, αναμενόμενη διακύμανση της αγοράς. ' +
      '<button onclick="openShannonModal()" class="text-[#9b88bf] hover:underline font-bold ml-1">🔬 Ανάλυση Claude Shannon ↗</button>' +
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

    const ccCockpit = document.getElementById('ccCockpitSection');
    const straddleCockpit = document.getElementById('straddlesCockpitSection');
    const vsCockpit = document.getElementById('vsCockpitSection');
    const longCockpit = document.getElementById('longCockpitSection');

    if (ccCockpit) ccCockpit.classList.toggle('hidden', strat !== 'CC');
    if (straddleCockpit) straddleCockpit.classList.toggle('hidden', strat !== 'STRADDLE');
    if (vsCockpit) vsCockpit.classList.toggle('hidden', strat !== 'VS');
    if (longCockpit) longCockpit.classList.toggle('hidden', strat !== 'LONG');

    if (strat === 'CC') {
      const rawBasis = document.getElementById('stratCostBasis')?.value;
      const taxPct = Number(document.getElementById('stratTaxRate')?.value || 0);
      const taxRate = TaxEngine.resolveTaxRate(taxPct);

      const validCC = items.filter(x => x.strikeRelative >= 0.995 && x.moneyYield > 1.002);
      const spot0 = validCC[0]?.spotPrice || currentState.spot || 100;
      const costBasis = TaxEngine.resolveCostBasis(rawBasis, spot0);
      const isTaxActive = taxRate > 0 && costBasis !== spot0;

      const embeddedTaxNow = TaxEngine.calcEmbeddedTax(spot0, costBasis, taxRate);
      const taxFreeTarget = TaxEngine.calcTaxNeutralTarget(spot0, costBasis, taxRate);

      badge.textContent = validCC.length + ' Covered Calls';

      const assetUnit = venue === 'CRYPTO' ? ticker : 'μετοχή';
      note.innerHTML = isTaxActive
        ? '💡 <b>Φορολογική Ανάλυση Covered Call (Cost Basis: ' + fmtMoney(costBasis) + ' | Φόρος: ' + taxPct + '% [Ελλάδα/Ν.4172]):</b> ' +
          'Σήμερα κουβαλάς <b>' + fmtMoney(embeddedTaxNow) + '/' + assetUnit + '</b> αναβαλλόμενο (unrealized) φόρο. ' +
          'Για να σου πληρώσει το Covered Call <b>ολόκληρο τον φόρο</b> αν γίνει assignment (ώστε τα καθαρά μετρητά να είναι τουλάχιστον ίσα με το σημερινό Spot ' + fmtMoney(spot0) + '), ' +
          'χρειάζεσαι <b>Strike + Premium &ge; ' + fmtMoney(taxFreeTarget) + '</b>! ' +
          'Η στήλη <b>Rebuy Price</b> δείχνει πόσο πρέπει να πέσει η τιμή μετά το assignment για να ξαναγοράσεις τον ίδιο αριθμό ' + (venue === 'CRYPTO' ? 'coins' : 'μετοχών') + '.'
        : '💡 <b>Geometric Covered Call (Buy-Write Σήμερα στο Spot):</b> ' +
          'Εξετάζουμε δύο μεγέθη: <b>Απόδοση σε Χρήμα ($)</b> (αν ασκηθείς) vs <b>Απόδοση σε Τεμάχια</b> (πόσες περισσότερες μετοχές/coins κρατάς λόγω του premium αν δεν ασκηθείς). ' +
          'Συμπλήρωσε τα πεδία <b>Avg Cost</b> και <b>Φόρος %</b> παραπάνω αν έχεις ήδη τη θέση από παλιά!';

      currentCcItems = validCC;
      selectCcProfile('BALANCED');

      thead.innerHTML = '<tr class="border-b border-[#26303e]">' +
        '<th class="p-3">Λήξη (DTE)</th>' +
        '<th class="p-3">Strike</th>' +
        '<th class="p-3 text-right">Premium / ' + (venue === 'CRYPTO' ? ticker : 'μετ.') + '</th>' +
        '<th class="p-3 text-right text-[#c85648]">Φόρος αν Ασκηθεί</th>' +
        '<th class="p-3 text-right font-bold text-white">Καθαρά Μετρητά (Net)</th>' +
        '<th class="p-3 text-right">Net vs Spot Σήμερα</th>' +
        '<th class="p-3 text-right text-[#9b88bf]">Rebuy Price</th>' +
        '<th class="p-3 text-right">P(Assignment)</th>' +
        '<th class="p-3 text-center">Payoff</th>' +
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
          dte: x.DTE
        });

        const moveStrike = ((x.strikeRelative - 1) * 100).toFixed(1);
        const pAssign = x.moneyProbability != null ? ((x.moneyProbability * 100).toFixed(1) + '%') : '—';
        const isRowMatch = currentCcActiveItem && currentCcActiveItem.strikeAbsolute === k;

        return '<tr class="cursor-pointer transition ' + (isRowMatch ? 'bg-[#222e40] font-bold text-white' : (taxEval.isTaxSafe ? 'hover:bg-[#1a2332]' : 'bg-[#241a18]/40 hover:bg-[#2e1f1d]')) + '" data-strike="' + k + '" onclick="selectCcItemByStrike(' + k + ')">' +
          '<td class="p-3">' + x.formattedDate + ' <span class="text-gray-500">(' + x.DTE + 'd)</span></td>' +
          '<td class="p-3 font-bold">' + fmtMoney(k) + ' <span class="text-[#3ea87c]">(+' + moveStrike + '%)</span></td>' +
          '<td class="p-3 text-right text-[#3d76b8]">+' + fmtMoney(prem) + '</td>' +
          '<td class="p-3 text-right text-[#c85648]">-' + fmtMoney(taxEval.taxPaid) + '</td>' +
          '<td class="p-3 text-right font-bold text-white">' + fmtMoney(taxEval.netCash) + '</td>' +
          '<td class="p-3 text-right font-bold ' + (taxEval.isTaxSafe ? 'text-[#3ea87c]' : 'text-[#c8963e]') + '">' +
            (taxEval.deltaVsSpotPct >= 0 ? '+' : '') + taxEval.deltaVsSpotPct.toFixed(2) + '% ' + (taxEval.isTaxSafe ? '✅' : '⚠️') +
          '</td>' +
          '<td class="p-3 text-right text-[#9b88bf]">' + fmtMoney(taxEval.rebuyPrice) + '</td>' +
          '<td class="p-3 text-right text-[#8e99a8]">' + pAssign + '</td>' +
          '<td class="p-3 text-center"><a href="' + x.strategyURL + '" target="_blank" onclick="event.stopPropagation()" class="text-[#4a86c6] hover:underline font-sans">Payoff ↗</a></td>' +
        '</tr>';
      }).join('');
    } else if (strat === 'VS') {
      const actionable = items.filter(x => x.touchReturnMultiple >= 1.25 && x.probTouchBeforeExpiry >= 0.02);
      badge.textContent = actionable.length + ' Touch Spreads';

      if (vsCockpit) renderVsFrontierChart(actionable);

      note.innerHTML =
        '💡 <b>Touch Spreads σε Όλες τις Λήξεις:</b> Εντοπίζει στενά Vertical Spreads όπου η καθαρή απόδοση στο Touch υπερβαίνει το <b>1.25x</b> μετά το Slippage.';

      thead.innerHTML = '<tr class="border-b border-[#26303e]">' +
        '<th class="p-3">Λήξη (Μέρες)</th>' +
        '<th class="p-3">Στόχος</th>' +
        '<th class="p-3">Spread</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">P(Touch)</th>' +
        '<th class="p-3 text-right text-[#9b7ad6]">P(Expire)</th>' +
        '<th class="p-3 text-right">Κόστος (Ask)</th>' +
        '<th class="p-3 text-right">Αξία στο Touch</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Απόδοση (Multiple)</th>' +
        '<th class="p-3 text-center">Payoff</th>' +
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
      if (straddleCockpit) renderStraddlesCorridorChart(items);

      note.innerHTML = '💡 <b>Straddles (Αναμενόμενο Εύρος Κίνησης):</b> Αγοράζοντας ταυτόχρονα το ATM Call και το ATM Put, βλέπεις ακριβώς πόσο % αναμένει η αγορά να κινηθεί το asset μέχρι τη λήξη.';

      thead.innerHTML = '<tr class="border-b border-[#26303e]">' +
        '<th class="p-3">Λήξη (Μέρες)</th>' +
        '<th class="p-3">Κεντρικό Strike</th>' +
        '<th class="p-3 text-right text-[#d95d4e]">Κάτω Breakeven</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Πάνω Breakeven</th>' +
        '<th class="p-3 text-right text-[#d49a42]">Εύρος Αγοράς (±%)</th>' +
        '<th class="p-3 text-right">Συνολικό Κόστος</th>' +
        '<th class="p-3 text-center">Payoff</th>' +
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
      badge.textContent = items.length + ' Συμβόλαια';
      if (longCockpit) renderLongLeverageChart(items);

      note.innerHTML = '💡 <b>Απλά Calls &amp; Puts (Κατάταξη Μόχλευσης):</b> Δείχνει πόση πραγματική μόχλευση (Spot / Κόστος Option) προσφέρει κάθε συμβόλαιο.';

      thead.innerHTML = '<tr class="border-b border-[#26303e]">' +
        '<th class="p-3">Λήξη (Μέρες)</th>' +
        '<th class="p-3">Συμβόλαιο</th>' +
        '<th class="p-3">Strike</th>' +
        '<th class="p-3 text-right text-[#d95d4e]">Breakeven</th>' +
        '<th class="p-3 text-right text-[#9b7ad6]">Απόσταση Breakeven</th>' +
        '<th class="p-3 text-right text-[#3ea87c]">Πραγματική Μόχλευση</th>' +
        '<th class="p-3 text-right">Κόστος Αγοράς</th>' +
        '<th class="p-3 text-center">Payoff</th>' +
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
        '<b>📻 Καθεστώς 1 — Αναμενόμενος Θόρυβος Αγοράς (Noise / Baseline):</b><br/>' +
        'Επειδή η πιθανότητα είναι $\\ge 50\\%$, η αυτοπληροφορία είναι <b>λιγότερο από 1 Bit</b> ($I < 1.0$). ' +
        'Είναι ευκολότερο ακόμη κι από ένα στρίψιμο νομίσματος! Αν ένας finfluencer προβλέψει αυτή την κίνηση, ' +
        'δεν παρέχει σχεδόν καμία πληροφορία (μηδενικός Alpha). Προβλέπει κάτι που η αγορά θεωρεί αυτονόητο.';
    } else {
      const flips = Number(bits).toFixed(1);
      outInterp.className = 'p-2.5 rounded bg-[#1c1628] border border-[#3e2e58] text-[11px] leading-relaxed text-[#c3b6dd]';
      outInterp.innerHTML =
        '<b>⚡ Καθεστώς 2 — Πληροφοριακή Έκπληξη (Forecasting Alpha):</b><br/>' +
        'Επειδή η πιθανότητα είναι $< 50\\%$, η πρόβλεψη απαιτεί <b>' + bits + ' Bits καθαρής έκπληξης</b>. ' +
        'Ισοδυναμεί με <b>' + flips + ' διαδοχικές σωστές προβλέψεις σε κορώνα-γράμματα</b> ($2^{-' + flips + '} \\approx ' + (p * 100).toFixed(1) + '\\%$). ' +
        'Αν ο αναλυτής έχει όντως edge, η αγορά τον πληρώνει δίκαιο πολλαπλασιαστή <b>' + fairMult + '</b> στο Touch. ' +
        'Απαιτείται αυστηρό Skin in the Game!';
    }
    safeRenderMath(outInterp);
  }
}

// --- TAB 5: MYTHBUSTERS LIVE SIMULATORS ---
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

  if (oddsBadge) oddsBadge.textContent = 'Μηδενικές Επιτυχίες: ' + ruinOddsPct + '%';

  if (verdictBox) {
    verdictBox.innerHTML =
      'Σε <b>' + n + '</b> διαδοχικά trades OTM λαχείων με $P = ' + (p * 100).toFixed(0) + '\\%$, ' +
      'η πιθανότητα να μην κερδίσεις <b>ΟΥΤΕ ΜΙΑ ΦΟΡΑ</b> (100% loss) είναι <span class="text-[#c85648] font-bold text-xs">' + ruinOddsPct + '%</span>! ' +
      'Απαιτείς <b>' + bitsPerTrade + ' Bits</b> πληροφορίας σε κάθε trade ενώ πληρώνεις bid-ask spread & volatility smile. ' +
      'Μαθηματικά, το drawdown $>80\\%$ επέρχεται σχεδόν νομοτελειακά.';
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
    netBadge.textContent = 'Καθαρό PnL: ' + (netPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(netPnL)).toLocaleString('en-US');
    netBadge.className = netPnL >= 0 ? 'mono text-[#3ea87c] font-bold' : 'mono text-[#c85648] font-bold';
  }

  if (verdictBox) {
    verdictBox.innerHTML =
      'Μαζεύεις <b>$' + prem + '/εβδομάδα</b> επί 52 εβδομάδες $\\implies$ Ετήσιο κέρδος: <span class="text-[#3ea87c] font-bold">+$' + yearlyGains.toLocaleString('en-US') + '</span>.<br/>' +
      'Ξαφνικό σοκ <b>-' + shockPct + '%</b> σε 1 ημέρα $\\implies$ Ζημιά θέσης: <span class="text-[#c85648] font-bold">-$' + Math.round(grossLoss).toLocaleString('en-US') + '</span>.<br/>' +
      '<b>Τελικό Αποτέλεσμα:</b> <span class="' + (netPnL >= 0 ? 'text-[#3ea87c]' : 'text-[#c85648]') + ' font-bold">' + (netPnL >= 0 ? '+$' : '-$') + Math.abs(Math.round(netPnL)).toLocaleString('en-US') + '</span>. ' +
      'Ένα και μόνο 4-sigma tail event εξαφάνισε έως και <b>' + (grossLoss / (yearlyGains || 1)).toFixed(1) + ' χρόνια</b> κερδών!';
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

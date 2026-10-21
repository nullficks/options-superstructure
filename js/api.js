/**
 * Options Probabilistic Superstructure — Market Data & Strategy Engines
 * Deribit (Crypto 24/7) and Yahoo Finance Options Worker API with slippage modelling.
 */

async function fetchCachedJson(url) {
  const now = Date.now();
  const hit = engineCache.get(url);
  if (hit && (now - hit.ts < CACHE_TTL_MS)) {
    return hit.data;
  }
  const res = await fetch(url);
  if (!res.ok) {
    const errTxt = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + errTxt);
  }
  const data = await res.json();
  engineCache.set(url, { ts: now, data });
  return data;
}

async function fetchDeribitChain(ticker, minDTE, maxDTE) {
  const currency = (ticker === 'BTC' || ticker === 'ETH') ? ticker : 'USDC';
  const url = 'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=' + currency + '&kind=option';
  const json = await fetchCachedJson(url);
  const raw = json.result || [];
  const rx = /^(\w+)-(\d+)([A-Z]{3})(\d+)-(\d+)-(P|C)$/;
  const now = Date.now();
  const contracts = [];

  for (const r of raw) {
    if (!r.bid_price || !r.ask_price || r.bid_price <= 0 || r.ask_price < r.bid_price) continue;
    const m = rx.exec(r.instrument_name);
    if (!m) continue;
    const asset = m[1];
    if (asset !== ticker) continue;

    const dd = Number(m[2]);
    const mmm = m[3];
    const yy = Number(m[4]);
    const expStr = m[2] + mmm + m[4];
    const strike = Number(m[5]);
    const type = m[6];

    const expDate = new Date(Date.UTC(2000 + yy, MONTHS[mmm], dd, 8, 0, 0));
    const dte = Math.max(1, Math.round((expDate.getTime() - now) / 86400000));
    if (dte < minDTE || dte > maxDTE) continue;

    const spot = Number(r.estimated_delivery_price);
    const future = Number(r.underlying_price);
    const bidUsd = Number(r.bid_price) * spot;
    const askUsd = Number(r.ask_price) * spot;
    const midUsd = (bidUsd + askUsd) / 2;

    contracts.push({
      venue: 'Deribit',
      asset,
      money: 'USD',
      symbol: r.instrument_name,
      expDate,
      expStr,
      dte,
      strike,
      isCall: type === 'C',
      isPut: type === 'P',
      bid: bidUsd,
      ask: askUsd,
      mid: midUsd,
      spot,
      future,
      minSize: asset === 'BTC' ? 0.1 : 1.0,
      lotSize: 1.0,
      optionUrl: buildDeribitOptionUrl(asset, expStr, r.instrument_name),
      underlyingUrl: 'https://www.deribit.com/spot/' + asset + '_USDT'
    });
  }
  return contracts;
}

async function fetchYahooChainAllExpirations(ticker, minDTE, maxDTE) {
  const cleanTicker = ticker.trim().toUpperCase();
  const firstUrl = WORKER_URL + '/?symbol=' + encodeURIComponent(cleanTicker);
  const rootJson = await fetchCachedJson(firstUrl);
  const firstResult = rootJson && rootJson.optionChain && rootJson.optionChain.result && rootJson.optionChain.result[0];
  if (!firstResult) throw new Error('Δεν βρέθηκαν δεδομένα στο Yahoo για ' + cleanTicker);

  const quote = firstResult.quote || {};
  const spot = Number(quote.regularMarketPrice || quote.postMarketPrice || quote.regularMarketPreviousClose || 0);
  if (spot <= 0) throw new Error('Αδυναμία ανάγνωσης Spot Price για ' + cleanTicker);

  const currency = quote.currency || 'USD';
  const allEpochs = firstResult.expirationDates || [];
  const now = Date.now();

  const targetEpochs = allEpochs.filter((ep) => {
    const dte = Math.max(1, Math.round((ep * 1000 - now) / 86400000));
    return dte >= minDTE && dte <= maxDTE;
  });

  const chainBlocks = [];
  if (firstResult.options && firstResult.options[0]) {
    const firstEp = firstResult.options[0].expirationDate;
    const firstDte = Math.max(1, Math.round((firstEp * 1000 - now) / 86400000));
    if (firstDte >= minDTE && firstDte <= maxDTE) {
      chainBlocks.push(firstResult.options[0]);
    }
  }

  const remainingEpochs = targetEpochs
    .filter((ep) => !chainBlocks.some((b) => b.expirationDate === ep))
    .slice(0, 5);

  const extraResponses = await Promise.all(
    remainingEpochs.map((ep) =>
      fetchCachedJson(WORKER_URL + '/?symbol=' + encodeURIComponent(cleanTicker) + '&date=' + ep).catch(() => null)
    )
  );

  for (const extra of extraResponses) {
    const block = extra && extra.optionChain && extra.optionChain.result && extra.optionChain.result[0] && extra.optionChain.result[0].options && extra.optionChain.result[0].options[0];
    if (block) chainBlocks.push(block);
  }

  const contracts = [];
  for (const block of chainBlocks) {
    const expEpoch = block.expirationDate;
    const expDate = new Date(expEpoch * 1000);
    const dte = Math.max(1, Math.round((expDate.getTime() - now) / 86400000));
    const expStr = formatIsoDate(expDate);

    const parseSide = (items, isCall) => {
      for (const c of (items || [])) {
        const last = Number(c.lastPrice || 0);
        const rawBid = Number(c.bid || 0);
        const rawAsk = Number(c.ask || 0);

        let bid = 0, ask = 0;
        if (rawBid > 0 && rawAsk >= rawBid) {
          bid = rawBid; ask = rawAsk;
        } else if (last > 0.01 && rawAsk > 0.01) {
          bid = last * 0.96; ask = Math.max(rawAsk, last * 1.04);
        } else if (last > 0.01) {
          bid = last * 0.95; ask = last * 1.05;
        } else {
          continue;
        }

        contracts.push({
          venue: 'OptionStrat',
          asset: cleanTicker,
          money: currency,
          symbol: c.contractSymbol,
          expDate,
          expStr,
          dte,
          strike: Number(c.strike),
          isCall,
          isPut: !isCall,
          bid,
          ask,
          mid: (bid + ask) / 2,
          spot,
          future: spot,
          minSize: 1.0,
          lotSize: 100.0,
          optionUrl: 'https://optionstrat.com/build/long-call/' + cleanTicker + '/.' + c.contractSymbol,
          underlyingUrl: 'https://finance.yahoo.com/quote/' + cleanTicker
        });
      }
    };
    parseSide(block.calls, true);
    parseSide(block.puts, false);
  }
  return contracts;
}

function engineBuildCoveredCalls(contracts, slippageRatio = 0.25) {
  const result = [];
  for (const c of contracts) {
    if (!c.isCall || c.strike < c.spot * 0.99) continue;
    const bidAfterSlip = c.bid - (c.ask - c.bid) * slippageRatio;
    if (bidAfterSlip <= 0) continue;

    const netMoneyCost = c.spot - bidAfterSlip;
    if (netMoneyCost <= 0) continue;

    const moneyYield = c.strike / netMoneyCost;
    const underlyingYield = c.spot / netMoneyCost;
    const breakEvenVsFullMoneyAbsolute = netMoneyCost;
    const breakEvenVsFullMoneyRelative = netMoneyCost / c.spot;
    const strikeRelative = c.strike / c.spot;

    const iv = 0.35;
    const tYears = c.dte / 365.0;
    const pExpire = analyticalExpireProbWithDrift(c.spot, c.strike, tYears, iv, 0.04);

    result.push({
      strategyType: 'coveredCall',
      venue: c.venue,
      money: c.money,
      underlying: c.asset,
      option: c.symbol,
      expDate: c.expDate,
      formattedDate: c.expStr,
      DTE: c.dte,
      spotPrice: c.spot,
      strikeAbsolute: c.strike,
      strikeRelative,
      breakEvenVsFullMoneyAbsolute,
      breakEvenVsFullMoneyRelative,
      moneyYield,
      underlyingYield,
      moneyProbability: pExpire,
      moneySize: netMoneyCost * (c.lotSize || 1),
      strategyURL: c.venue === 'Deribit'
        ? c.optionUrl
        : buildCustomOptionStratUrl(c.asset, [{ isUnderlying: true, qty: 100 }, { symbol: c.symbol, qty: -1 }])
    });
  }
  return result;
}

function engineBuildVerticalSpreads(contracts, slippageRatio = 0.25) {
  const list = [];
  const grouped = new Map();
  for (const c of contracts) {
    const key = c.expStr + '_' + (c.isCall ? 'C' : 'P');
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }

  for (const [key, legs] of grouped.entries()) {
    legs.sort((a, b) => a.strike - b.strike);
    const isCall = key.endsWith('_C');
    for (let i = 0; i < legs.length - 1; i++) {
      const k1 = legs[i];
      const k2 = legs[i + 1];
      const width = k2.strike - k1.strike;
      if (width <= 0) continue;

      const target = (k1.strike + k2.strike) / 2;
      const isOtm = isCall ? (target > k1.spot) : (target < k1.spot);
      if (!isOtm) continue;

      const spreadMid = isCall ? (k1.mid - k2.mid) : (k2.mid - k1.mid);
      const rawAsk = isCall ? (k1.ask - k2.bid) : (k2.ask - k1.bid);
      const spreadAsk = rawAsk + (rawAsk - spreadMid) * slippageRatio;
      if (spreadAsk <= 0 || spreadAsk >= width) continue;

      const touchExit = 0.50 * width;
      const pExpire = Math.min(1, Math.max(0, spreadMid / width));
      const pTouch = Math.min(1, Math.max(0, spreadMid / touchExit));
      const touchReturnMultiple = touchExit / spreadAsk;

      list.push({
        strategyType: isCall ? 'bullCallSpread' : 'bearPutSpread',
        venue: k1.venue,
        money: k1.money,
        underlying: k1.asset,
        formattedDate: k1.expStr,
        DTE: k1.dte,
        target,
        lowerStrike: k1.strike,
        upperStrike: k2.strike,
        spreadLabel: k1.strike + '/' + k2.strike + (isCall ? ' C' : ' P'),
        probTouchBeforeExpiry: pTouch,
        probExpireBeyondTarget: pExpire,
        spreadCostAsk: spreadAsk,
        touchExitValue: touchExit,
        touchReturnMultiple,
        strategyURL: k1.venue === 'Deribit'
          ? k1.optionUrl
          : buildCustomOptionStratUrl(k1.asset, isCall
              ? [{ symbol: k1.symbol, qty: 1 }, { symbol: k2.symbol, qty: -1 }]
              : [{ symbol: k2.symbol, qty: 1 }, { symbol: k1.symbol, qty: -1 }])
      });
    }
  }
  return list;
}

function engineBuildLongOptions(contracts, slippageRatio = 0.25) {
  const result = [];
  for (const c of contracts) {
    const askCost = c.ask + (c.ask - c.mid) * slippageRatio;
    if (askCost <= 0) continue;
    const maxLeverage = c.spot / askCost;
    const breakEven = c.isCall ? (c.strike + askCost) : (c.strike - askCost);

    result.push({
      strategyType: c.isCall ? 'longCall' : 'longPut',
      venue: c.venue,
      money: c.money,
      underlying: c.asset,
      option: c.symbol,
      formattedDate: c.expStr,
      DTE: c.dte,
      strikeAbsolute: c.strike,
      breakEvenVsFullMoneyAbsolute: breakEven,
      breakEvenVsFullMoneyRelative: breakEven / c.spot,
      maxLeverage,
      moneySize: askCost * (c.lotSize || 1),
      strategyURL: c.optionUrl
    });
  }
  return result;
}

function engineBuildStraddles(contracts, slippageRatio = 0.25) {
  const list = [];
  const exps = [...new Set(contracts.map(c => c.expStr))];
  for (const exp of exps) {
    const subset = contracts.filter(c => c.expStr === exp);
    if (!subset.length) continue;
    const spot = subset[0].spot;
    const calls = subset.filter(c => c.isCall);
    const puts = subset.filter(c => c.isPut);
    const putMap = new Map(puts.map(p => [p.strike, p]));

    let bestPair = null, minDiff = 1e9;
    for (const c of calls) {
      const p = putMap.get(c.strike);
      if (!p) continue;
      const diff = Math.abs(c.strike - spot);
      if (diff < minDiff) {
        minDiff = diff;
        bestPair = { c, p };
      }
    }
    if (!bestPair) continue;

    const { c, p } = bestPair;
    const cost = (c.ask + p.ask) * (1 + slippageRatio * 0.1);
    const corridor = (cost / spot) * 100;

    list.push({
      strategyType: 'straddle',
      venue: c.venue,
      money: c.money,
      underlying: c.asset,
      formattedDate: c.expStr,
      DTE: c.dte,
      strikeAbsolute: c.strike,
      breakEvenVsFullMoneyDownAbsolute: c.strike - cost,
      breakEvenVsFullMoneyUpAbsolute: c.strike + cost,
      impliedCorridorPct: corridor,
      moneySize: cost * (c.lotSize || 1),
      strategyURL: c.venue === 'Deribit'
        ? c.optionUrl
        : buildCustomOptionStratUrl(c.asset, [{ symbol: c.symbol, qty: 1 }, { symbol: p.symbol, qty: 1 }])
    });
  }
  return list;
}

// Global interop hooks
window.deribitCoveredCallsDart = async (t, s, min, max) => JSON.stringify(engineBuildCoveredCalls(await fetchDeribitChain(t, min, max), s));
window.deribitVerticalSpreadsDart = async (t, s, min, max) => JSON.stringify(engineBuildVerticalSpreads(await fetchDeribitChain(t, min, max), s));
window.deribitLongOptionsDart = async (t, s, min, max) => JSON.stringify(engineBuildLongOptions(await fetchDeribitChain(t, min, max), s));
window.deribitStraddlesDart = async (t, s, min, max) => JSON.stringify(engineBuildStraddles(await fetchDeribitChain(t, min, max), s));

window.yfinanceCoveredCallsDart = async (t, s, min, max) => JSON.stringify(engineBuildCoveredCalls(await fetchYahooChainAllExpirations(t, min, max), s));
window.yfinanceVerticalSpreadsDart = async (t, s, min, max) => JSON.stringify(engineBuildVerticalSpreads(await fetchYahooChainAllExpirations(t, min, max), s));
window.yfinanceLongOptionsDart = async (t, s, min, max) => JSON.stringify(engineBuildLongOptions(await fetchYahooChainAllExpirations(t, min, max), s));
window.yfinanceStraddlesDart = async (t, s, min, max) => JSON.stringify(engineBuildStraddles(await fetchYahooChainAllExpirations(t, min, max), s));

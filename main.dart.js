/**
 * main.dart.js — Options Probabilistic Superstructure Engine
 * Licensed under the Apache License, Version 2.0 (see NOTICE).
 */
(function dartProgram() {
  'use strict';

  const WORKER_URL = 'https://yfina.julian-883.workers.dev';
  const memCache = new Map();
  const CACHE_TTL_MS = 5 * 60 * 1000;

  const MONTHS = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  function formatIsoDate(dt) {
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatHumanDate(dt) {
    return `${dt.getUTCDate()} ${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  }

  function buildOptionStratUrl(ticker, legs) {
    const clean = (sym) => {
      const m = /^(.*[CP])(\d{8})$/.exec(sym);
      if (!m) return sym;
      return `${m[1]}${Number(m[2]) / 1000}`;
    };
    const parts = legs.map((l) => {
      if (l.isUnderlying) return `${ticker}x${Math.round(l.qty)}`;
      return `.${clean(l.symbol)}x${Math.round(l.qty)}`;
    });
    return `https://optionstrat.com/build/custom/${ticker}/${parts.join(',')}`;
  }

  function buildDeribitOptionUrl(coin, expStr, instrumentName) {
    return `https://www.deribit.com/options/${coin}/${coin}-${expStr}/${instrumentName}`;
  }

  async function fetchCachedJson(url) {
    const now = Date.now();
    const hit = memCache.get(url);
    if (hit && now - hit.ts < CACHE_TTL_MS) {
      return hit.data;
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const data = await res.json();
    memCache.set(url, { ts: now, data });
    return data;
  }

  async function fetchDeribitChain(ticker, minDTE, maxDTE) {
    const currency = ['BTC', 'ETH'].includes(ticker) ? ticker : 'USDC';
    const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
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
      const expStr = `${m[2]}${mmm}${m[4]}`;
      const strike = Number(m[5]);
      const type = m[6];

      const expDate = new Date(Date.UTC(2000 + yy, MONTHS[mmm], dd, 8, 0, 0));
      const dte = Math.floor((expDate.getTime() - now) / 86400000);
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
        underlyingUrl: `https://www.deribit.com/spot/${asset}_USDT`,
      });
    }
    return contracts;
  }

  async function fetchYahooChainAllExpirations(ticker, minDTE, maxDTE) {
    const cleanTicker = ticker.trim().toUpperCase();
    const firstUrl = `${WORKER_URL}/?symbol=${encodeURIComponent(cleanTicker)}`;
    const rootJson = await fetchCachedJson(firstUrl);
    const firstResult = rootJson?.optionChain?.result?.[0];
    if (!firstResult) throw new Error(`No Yahoo option chain for ${cleanTicker}`);

    const quote = firstResult.quote || {};
    const spot = Number(
      quote.regularMarketPrice ||
      quote.postMarketPrice ||
      quote.regularMarketPreviousClose ||
      0
    );
    if (spot <= 0) throw new Error(`Could not determine spot price for ${cleanTicker}`);

    const currency = quote.currency || 'USD';
    const allEpochs = firstResult.expirationDates || [];
    const now = Date.now();

    const targetEpochs = allEpochs.filter((ep) => {
      const dte = Math.floor((ep * 1000 - now) / 86400000);
      return dte >= minDTE && dte <= maxDTE;
    });

    const chainBlocks = [];
    if (firstResult.options?.[0]) {
      const firstEp = firstResult.options[0].expirationDate;
      const firstDte = Math.floor((firstEp * 1000 - now) / 86400000);
      if (firstDte >= minDTE && firstDte <= maxDTE) {
        chainBlocks.push(firstResult.options[0]);
      }
    }

    const remainingEpochs = targetEpochs
      .filter((ep) => !chainBlocks.some((b) => b.expirationDate === ep))
      .slice(0, 5);

    const extraResponses = await Promise.all(
      remainingEpochs.map((ep) =>
        fetchCachedJson(`${WORKER_URL}/?symbol=${encodeURIComponent(cleanTicker)}&date=${ep}`)
          .catch(() => null)
      )
    );

    for (const extra of extraResponses) {
      const block = extra?.optionChain?.result?.[0]?.options?.[0];
      if (block) chainBlocks.push(block);
    }

    const contracts = [];
    for (const block of chainBlocks) {
      const expEpoch = block.expirationDate;
      const expDate = new Date(expEpoch * 1000);
      const dte = Math.max(1, Math.floor((expDate.getTime() - now) / 86400000));
      const expStr = formatIsoDate(expDate);

      const parseSide = (items, isCall) => {
        for (const c of items || []) {
          const last = Number(c.lastPrice || 0);
          const rawBid = Number(c.bid || 0);
          const rawAsk = Number(c.ask || 0);

          let bid = 0;
          let ask = 0;
          if (rawBid > 0 && rawAsk >= rawBid) {
            bid = rawBid;
            ask = rawAsk;
          } else if (last > 0.01 && rawAsk > 0.01) {
            bid = last * 0.96;
            ask = Math.max(rawAsk, last * 1.04);
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
            optionUrl: `https://finance.yahoo.com/quote/${c.contractSymbol}/`,
            underlyingUrl: `https://finance.yahoo.com/quote/${cleanTicker}/`,
          });
        }
      };

      parseSide(block.calls, true);
      parseSide(block.puts, false);
    }

    return contracts;
  }

  function buildVerticalSpreads(contracts, slippageRatio) {
    const byExp = new Map();
    for (const c of contracts) {
      const key = `${c.expStr}_${c.isCall ? 'C' : 'P'}`;
      if (!byExp.has(key)) byExp.set(key, []);
      byExp.get(key).push(c);
    }

    const spreads = [];
    for (const [, legs] of byExp.entries()) {
      legs.sort((a, b) => a.strike - b.strike);
      for (let i = 0; i < legs.length - 1; i++) {
        const k1 = legs[i];
        const k2 = legs[i + 1];
        const width = k2.strike - k1.strike;
        if (width <= 0) continue;

        const isCall = k1.isCall;
        const midTarget = (k1.strike + k2.strike) / 2;
        if (isCall && midTarget < k1.spot) continue;
        if (!isCall && midTarget >= k1.spot) continue;

        const buyLeg = isCall ? k1 : k2;
        const sellLeg = isCall ? k2 : k1;

        const buyCost = buyLeg.bid + (buyLeg.ask - buyLeg.bid) * (0.5 + 0.5 * slippageRatio);
        const sellCredit = sellLeg.ask - (sellLeg.ask - sellLeg.bid) * (0.5 + 0.5 * slippageRatio);
        const netDebit = buyCost - sellCredit;
        const midDebit = Math.abs(k1.mid - k2.mid);

        if (netDebit <= 0 || netDebit >= width) continue;

        const maxProfit = width - netDebit;
        const maxYield = 1 + maxProfit / netDebit;
        const probExpire = Math.min(1, Math.max(0, midDebit / width));
        const probTouch = Math.min(1, Math.max(0, midDebit / (0.5 * width)));
        const touchExitValue = 0.5 * width;
        const touchMultiple = touchExitValue / netDebit;
        const breakEven = isCall ? k1.strike + netDebit : k2.strike - netDebit;

        const stratUrl = k1.venue === 'OptionStrat'
          ? buildOptionStratUrl(k1.asset, [
              { symbol: buyLeg.symbol, qty: 1 },
              { symbol: sellLeg.symbol, qty: -1 },
            ])
          : buyLeg.optionUrl;

        spreads.push({
          id: `${k1.expStr}~${k1.strike}~${k2.strike}~${isCall ? 'call' : 'put'}`,
          strategyType: 'verticalSpread',
          strategyURL: stratUrl,
          underlying: k1.asset,
          underlyingURL: k1.underlyingUrl,
          money: k1.money,
          moneySize: netDebit * k1.lotSize,
          spotPrice: k1.spot,
          shortLeg: sellLeg.symbol,
          shortLegURL: sellLeg.optionUrl,
          longLeg: buyLeg.symbol,
          longLegURL: buyLeg.optionUrl,
          type: isCall ? 'over' : 'under',
          DTE: k1.dte,
          formattedDate: formatHumanDate(k1.expDate),
          targetMidpoint: midTarget,
          spreadWidth: width,
          breakEvenVsFullMoneyAbsolute: breakEven,
          breakEvenVsFullMoneyRelative: breakEven / k1.spot,
          maxYield,
          maxRisk: netDebit * k1.lotSize,
          maxProbAbove: isCall ? probExpire : 1 - probExpire,
          maxProbBelow: isCall ? 1 - probExpire : probExpire,
          probTouchBeforeExpiry: probTouch,
          probNoTouchBeforeExpiry: 1 - probTouch,
          touchReturnMultiple: touchMultiple,
        });
      }
    }
    return spreads;
  }

  function buildCoveredCalls(contracts, slippageRatio) {
    // Μόνο OTM / ATM strikes (c.strike >= c.spot)
    const calls = contracts.filter((c) => c.isCall && c.strike >= c.spot);
    const spreads = buildVerticalSpreads(contracts, slippageRatio);
    const results = [];

    for (const c of calls) {
      const callPremium = c.ask - (c.ask - c.bid) * (0.5 + 0.5 * slippageRatio);
      if (callPremium <= 0 || callPremium >= c.spot) continue;

      const netOutlayPerUnit = c.spot - callPremium;
      const maxValuePerUnit = c.strike;
      const moneyProfit = (maxValuePerUnit - netOutlayPerUnit) * c.minSize * c.lotSize;
      const moneyYield = maxValuePerUnit / netOutlayPerUnit;
      const underlyingYield = c.spot / netOutlayPerUnit;
      const breakEvenMoney = netOutlayPerUnit;

      const sameExpSpreads = spreads.filter((s) => s.DTE === c.dte);
      let moneyProb = null;
      if (sameExpSpreads.length > 0) {
        let closest = sameExpSpreads[0];
        for (const s of sameExpSpreads) {
          if (Math.abs(s.targetMidpoint - c.strike) < Math.abs(closest.targetMidpoint - c.strike)) {
            closest = s;
          }
        }
        moneyProb = closest.maxProbAbove;
      }

      const stratUrl = c.venue === 'OptionStrat'
        ? buildOptionStratUrl(c.asset, [
            { isUnderlying: true, qty: 100 },
            { symbol: c.symbol, qty: -1 },
          ])
        : c.optionUrl;

      results.push({
        id: `${c.expStr}~${c.strike}`,
        strategyType: 'coveredCall',
        strategyURL: stratUrl,
        moneyYield,
        underlyingYield,
        underlying: c.asset,
        underlyingURL: c.underlyingUrl,
        underlyingToBuy: c.minSize * (1 - callPremium / c.spot),
        premiumToReceive: (callPremium / c.spot) * c.minSize,
        money: c.money,
        moneySize: netOutlayPerUnit * c.minSize * c.lotSize,
        moneyProfit,
        spotPrice: c.spot,
        call: c.symbol,
        callURL: c.optionUrl,
        callSize: -c.minSize,
        DTE: c.dte,
        formattedDate: formatHumanDate(c.expDate),
        strikeAbsolute: c.strike,
        strikeRelative: c.strike / c.spot,
        breakEvenVsFullMoneyAbsolute: breakEvenMoney,
        breakEvenVsFullMoneyRelative: breakEvenMoney / c.spot,
        moneyProbability: moneyProb,
        underlyingProbability: moneyProb !== null ? 1 - moneyProb : null,
      });
    }
    return results;
  }

  function buildLongOptions(contracts, slippageRatio) {
    const results = [];
    for (const c of contracts) {
      if (c.isCall && c.strike < c.spot) continue;
      if (c.isPut && c.strike > c.spot) continue;

      const cost = c.bid + (c.ask - c.bid) * (0.5 + 0.5 * slippageRatio);
      if (cost <= 0) continue;

      const breakEven = c.isCall ? c.strike + cost : c.strike - cost;
      const stratUrl = c.venue === 'OptionStrat'
        ? buildOptionStratUrl(c.asset, [{ symbol: c.symbol, qty: 1 }])
        : c.optionUrl;

      results.push({
        id: `${c.expStr}~${c.strike}~${c.isCall ? 'C' : 'P'}`,
        strategyType: c.isCall ? 'longCall' : 'longPut',
        strategyURL: stratUrl,
        maxLeverage: c.spot / cost,
        underlying: c.asset,
        underlyingURL: c.underlyingUrl,
        costInUnderlying: (cost / c.spot) * c.minSize,
        moneySize: cost * c.minSize * c.lotSize,
        money: c.money,
        spotPrice: c.spot,
        option: c.symbol,
        optionURL: c.optionUrl,
        DTE: c.dte,
        formattedDate: formatHumanDate(c.expDate),
        strikeAbsolute: c.strike,
        strikeRelative: c.strike / c.spot,
        breakEvenVsFullMoneyAbsolute: breakEven,
        breakEvenVsFullMoneyRelative: breakEven / c.spot,
      });
    }
    return results;
  }

  function buildStraddles(contracts, slippageRatio) {
    const byExp = new Map();
    for (const c of contracts) {
      if (!byExp.has(c.expStr)) byExp.set(c.expStr, []);
      byExp.get(c.expStr).push(c);
    }

    const results = [];
    for (const [, list] of byExp.entries()) {
      const calls = list.filter((c) => c.isCall);
      const puts = new Map(list.filter((c) => c.isPut).map((p) => [p.strike, p]));

      let bestPair = null;
      let bestDist = Infinity;
      for (const c of calls) {
        const p = puts.get(c.strike);
        if (!p) continue;
        const dist = Math.abs(c.strike - c.spot);
        if (dist < bestDist) {
          bestDist = dist;
          bestPair = { c, p };
        }
      }
      if (!bestPair) continue;

      const { c, p } = bestPair;
      const callCost = c.bid + (c.ask - c.bid) * (0.5 + 0.5 * slippageRatio);
      const putCost = p.bid + (p.ask - p.bid) * (0.5 + 0.5 * slippageRatio);
      const totalCost = callCost + putCost;
      const beDown = c.strike - totalCost;
      const beUp = c.strike + totalCost;

      const stratUrl = c.venue === 'OptionStrat'
        ? buildOptionStratUrl(c.asset, [
            { symbol: c.symbol, qty: 1 },
            { symbol: p.symbol, qty: 1 },
          ])
        : c.optionUrl;

      results.push({
        id: `${c.expStr}~${c.strike}`,
        strategyType: 'straddle',
        strategyURL: stratUrl,
        underlying: c.asset,
        spotPrice: c.spot,
        DTE: c.dte,
        formattedDate: formatHumanDate(c.expDate),
        strikeAbsolute: c.strike,
        strikeRelative: c.strike / c.spot,
        moneySize: totalCost * c.minSize * c.lotSize,
        callCostInMoney: callCost * c.minSize * c.lotSize,
        putCostInMoney: putCost * c.minSize * c.lotSize,
        breakEvenVsFullMoneyDownAbsolute: beDown,
        breakEvenVsFullMoneyDownRelative: beDown / c.spot,
        breakEvenVsFullMoneyUpAbsolute: beUp,
        breakEvenVsFullMoneyUpRelative: beUp / c.spot,
        distanceBetweenBreakEvensAbsolute: beUp - beDown,
        distanceBetweenBreakEvensRelative: (beUp - beDown) / c.spot,
      });
    }
    return results;
  }

  window.deribitCoveredCallsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchDeribitChain(ticker, minDTE, maxDTE);
    return JSON.stringify(buildCoveredCalls(chain, slippage));
  };

  window.deribitVerticalSpreadsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchDeribitChain(ticker, minDTE, maxDTE);
    return JSON.stringify(buildVerticalSpreads(chain, slippage));
  };

  window.deribitLongOptionsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchDeribitChain(ticker, minDTE, maxDTE);
    return JSON.stringify(buildLongOptions(chain, slippage));
  };

  window.deribitStraddlesDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchDeribitChain(ticker, minDTE, maxDTE);
    return JSON.stringify(buildStraddles(chain, slippage));
  };

  window.yfinanceCoveredCallsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchYahooChainAllExpirations(ticker, minDTE, maxDTE);
    return JSON.stringify(buildCoveredCalls(chain, slippage));
  };

  window.yfinanceVerticalSpreadsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchYahooChainAllExpirations(ticker, minDTE, maxDTE);
    return JSON.stringify(buildVerticalSpreads(chain, slippage));
  };

  window.yfinanceLongOptionsDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchYahooChainAllExpirations(ticker, minDTE, maxDTE);
    return JSON.stringify(buildLongOptions(chain, slippage));
  };

  window.yfinanceStraddlesDart = async function(ticker, slippage, minDTE, maxDTE) {
    const chain = await fetchYahooChainAllExpirations(ticker, minDTE, maxDTE);
    return JSON.stringify(buildStraddles(chain, slippage));
  };

  if (typeof window.jsMain === 'function') {
    window.jsMain();
  }
})();

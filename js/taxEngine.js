/**
 * Options Probabilistic Superstructure — Tax & Cost Basis Engine
 * Implements Praxeological Capital Asset Accounting & Assignment Tax Cliff Mechanics.
 *
 * Core Principles (adapted from Dimitris Andreou's algebraic Position/Market model):
 * 1. Capital Assets (Stock / Crypto) carry a Cost Basis (B).
 * 2. Settlement Money is the tax-reporting numeraire (USD / EUR).
 * 3. Fresh Buy-Write: Cost Basis = Spot (S0), initial cash outlay = S0 - C.
 * 4. Pre-Existing Position: Cost Basis = B < S0, no cash outlay today.
 *    - OTM Expiry (ST < K): Stock gain (ST - B) remains UNREALIZED (0% tax). Premium C is realized.
 *    - Assignment (ST >= K): Forced liquidation triggers tax on full gain from B to K: tau * (K - B + C).
 * 5. Rebuy Price: Equivalent underlying price required to repurchase the same physical unit count.
 * 6. Tax-Neutral Strike: Minimum K + C required to cover 100% of historical embedded tax.
 */

const TaxEngine = {
  /**
   * Parse cost basis safely. If empty, null, or <= 0, defaults to spot (Fresh Buy-Write mode).
   */
  resolveCostBasis(rawBasis, spot) {
    if (rawBasis !== '' && rawBasis != null) {
      const num = Number(rawBasis);
      if (!isNaN(num) && num > 0) return num;
    }
    return spot || 100;
  },

  /**
   * Normalize tax percentage to [0, 0.99]
   */
  resolveTaxRate(taxPct) {
    const rate = Number(taxPct || 0) / 100.0;
    return Math.min(0.99, Math.max(0, rate));
  },

  /**
   * Calculate embedded unrealized tax currently sitting in the position before the trade.
   */
  calcEmbeddedTax(spot, costBasis, taxRate) {
    return Math.max(0, (spot - costBasis) * taxRate);
  },

  /**
   * Calculate the Tax-Neutral Strike Threshold:
   * Minimum K + C such that Net Cash at Assignment >= today's Spot S0.
   * (1 - tau)(K + C) + tau * B >= S0  ==>  K + C >= (S0 - tau * B) / (1 - tau)
   */
  calcTaxNeutralTarget(spot, costBasis, taxRate) {
    if (taxRate >= 0.99) return spot;
    return Math.max(spot, (spot - taxRate * costBasis) / (1 - taxRate));
  },

  /**
   * Net Cash after tax received if assigned at strike K:
   * V_assigned = K + C - tau * max(0, K - B + C)
   */
  calcNetCashAtAssignment(strike, premium, costBasis, taxRate) {
    const taxableGain = Math.max(0, (strike - costBasis) + premium);
    const taxPaid = taxableGain * taxRate;
    return {
      taxableGain,
      taxPaid,
      netCash: strike + premium - taxPaid
    };
  },

  /**
   * Rebuy Price: The underlying price required to buy back the exact same number of shares
   * using the after-tax cash remaining after assignment.
   * S_rebuy = Net Cash = (1 - tau)(K + C) + tau * B
   */
  calcRebuyPrice(strike, premium, costBasis, taxRate) {
    const res = this.calcNetCashAtAssignment(strike, premium, costBasis, taxRate);
    return res.netCash;
  },

  /**
   * Tax Cliff: The instantaneous loss of capital at K due to forced realization of stock gain:
   * Delta_cliff = tau * max(0, K - B)
   */
  calcTaxCliffLoss(strike, costBasis, taxRate) {
    return Math.max(0, (strike - costBasis) * taxRate);
  },

  /**
   * Comprehensive tax evaluation for a single Covered Call contract
   */
  evaluateContract({ spot, strike, premium, costBasis, taxRate, dte }) {
    const S0 = spot;
    const K = strike;
    const C = Math.max(0, premium);
    const B = costBasis;
    const tau = taxRate;

    const embeddedTaxNow = this.calcEmbeddedTax(S0, B, tau);
    const taxNeutralTarget = this.calcTaxNeutralTarget(S0, B, tau);
    const assignment = this.calcNetCashAtAssignment(K, C, B, tau);
    const netCash = assignment.netCash;
    const taxPaid = assignment.taxPaid;
    const rebuyPrice = netCash;
    const cliffLoss = this.calcTaxCliffLoss(K, B, tau);

    // Net cash vs today's spot ($ and %)
    const deltaVsSpot = netCash - S0;
    const deltaVsSpotPct = S0 > 0 ? (deltaVsSpot / S0) * 100 : 0;
    const isTaxSafe = netCash >= S0;

    // Net cash vs selling today and paying today's tax
    const cashIfSellToday = S0 - embeddedTaxNow;
    const deltaVsSellToday = netCash - cashIfSellToday;
    const deltaVsSellTodayPct = cashIfSellToday > 0 ? (deltaVsSellToday / cashIfSellToday) * 100 : 0;

    // After-tax APR if assigned
    const holdingDays = Math.max(1, dte);
    const returnOnCapital = deltaVsSpot / S0;
    const afterTaxAprPct = returnOnCapital * (365 / holdingDays) * 100;

    // Unit retention yield if unassigned (OTM expiry)
    // You keep the stock (worth ST) + after-tax option premium C * (1 - tau)
    const afterTaxPremium = C * (1 - tau);
    const unitYieldPct = S0 > 0 ? (afterTaxPremium / S0) * 100 : 0;

    return {
      spot: S0,
      strike: K,
      premium: C,
      costBasis: B,
      taxRate: tau,
      embeddedTaxNow,
      taxNeutralTarget,
      taxPaid,
      netCash,
      rebuyPrice,
      cliffLoss,
      deltaVsSpot,
      deltaVsSpotPct,
      isTaxSafe,
      cashIfSellToday,
      deltaVsSellToday,
      deltaVsSellTodayPct,
      afterTaxAprPct,
      afterTaxPremium,
      unitYieldPct
    };
  }
};

/**
 * Options Probability & Strategy Analyzer — Tax & Cost Basis Engine
 * Υπολογισμός Φορολογικών Επιπτώσεων, Βάσης Κόστους & Αποφυγής Φόρου (Tax Shield / Roll Defense)
 *
 * Βασικές Χρηματοοικονομικές Αρχές:
 * 1. Περιουσιακά Στοιχεία (Capital Assets: Μετοχές, Crypto, Options) φέρουν Τιμή Κτήσης (Cost Basis B).
 * 2. Μετρητά Διακανονισμού (Settlement Cash): USD ή EUR — η κατοχή μετρητών δεν παράγει υπεραξία.
 * 3. Νέα Θέση (Fresh Buy-Write): Cost Basis = Spot (S0), αρχική εκροή = S0 - C.
 * 4. Προϋπάρχουσα Θέση (Pre-Existing Position): Cost Basis = B < S0, μηδενική σημερινή εκροή ($0.00).
 *    - Λήξη εκτός χρημάτων (OTM, ST < K): Η υπεραξία μετοχής (ST - B) παραμένει ΑΦΟΡΟΛΟΓΗΤΗ (0% φόρος, unrealized).
 *    - Εκχώρηση (Assignment, ST >= K): Υποχρεωτική πώληση μετοχής -> Βίαιη φορολόγηση ιστορικής υπεραξίας: tau * (K - B + C).
 * 5. Φορολογικό Άλμα (Tax Cliff Drop): Κατακόρυφη απώλεια στο K: Delta_cliff = tau * max(0, K - B).
 * 6. Λόγος Φόρου προς Ασφάλιστρο (Tax-to-Premium Ratio / T2P): Delta_cliff / C. Όταν > 1.0x, πρόκειται για φορολογική παγίδα.
 * 7. Φόρμουλα Δημήτρη Ανδρέου για Καθαρά Μετρητά: Gross = X / (1 - (tau * u)), όπου u = (S0 - B) / S0.
 * 8. Αποφυγή Φόρου μέσω Κύλισης (Roll Up & Out): Επαναγορά Call & πώληση νέου -> Αποφυγή πώλησης μετοχής -> 0% φόρος!
 */

const TaxEngine = {
  // Pre-configured Tax Regimes
  REGIMES: {
    GR_STOCKS: {
      key: 'GR_STOCKS',
      name: '🇬🇷 US/Ξένες Μετοχές (15%)',
      rate: 15,
      law: 'Ν. 4172/2013 άρθρα 42 & 43 (15% υπεραξία)',
      badge: '15% Φόρος'
    },
    GR_UCITS: {
      key: 'GR_UCITS',
      name: '🛡️ UCITS ETFs (0% Αφορολόγητο)',
      rate: 0,
      law: 'Ν. 4099/2012 άρθρο 103 (0% αφορολόγητο υπεραξίας & μερισμάτων)',
      badge: '0% Αφορολόγητο'
    },
    GR_ATHEX: {
      key: 'GR_ATHEX',
      name: '🏛️ Ελληνικές Μετοχές ΧΑΑ (0%)',
      rate: 0,
      law: 'Ν. 4172/2013 (0% για <0.5%, 0.20% φόρος συναλλαγής πώλησης)',
      badge: '0% Υπεραξία'
    },
    DERIBIT_CRYPTO: {
      key: 'DERIBIT_CRYPTO',
      name: '₿ Crypto / Deribit (15%)',
      rate: 15,
      law: 'Πρόταση επιτροπής ΚΦΕ (15% αυτοτελής φορολόγηση υπεραξίας)',
      badge: '15% Crypto'
    },
    DE_ABGELTUNG: {
      key: 'DE_ABGELTUNG',
      name: '🇩🇪 Γερμανία (26.38%)',
      rate: 26.375,
      law: 'Abgeltungsteuer 25% + Soli (26.375%)',
      badge: '26.38% DE'
    },
    US_CAP_GAINS: {
      key: 'US_CAP_GAINS',
      name: '🇺🇸 US Capital Gains (15%)',
      rate: 15,
      law: 'US Long-Term Capital Gains (IRC Section 1(h))',
      badge: '15% US'
    },
    ZERO_TAX: {
      key: 'ZERO_TAX',
      name: '🌐 Μηδενική Φορολογία (0%)',
      rate: 0,
      law: 'UAE / Cyprus Non-Dom / Sovereign Wealth',
      badge: '0% Tax-Free'
    }
  },

  /**
   * Resolve trading mode: 'FRESH' (Fresh Buy-Write) vs 'PRE_EXISTING' (Existing Portfolio Holding)
   */
  resolveMode(mode) {
    return mode === 'FRESH' ? 'FRESH' : 'PRE_EXISTING';
  },

  /**
   * Parse cost basis safely. In FRESH mode, it always equals spot.
   */
  resolveCostBasis(rawBasis, spot, mode = 'PRE_EXISTING') {
    if (mode === 'FRESH') return spot || 100;
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
   * Tax_embedded = tau * max(0, spot - costBasis)
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
   * Tax Cliff: The instantaneous loss of capital at K due to forced realization of stock gain:
   * Delta_cliff = tau * max(0, K - B)
   */
  calcTaxCliffLoss(strike, costBasis, taxRate) {
    return Math.max(0, (strike - costBasis) * taxRate);
  },

  /**
   * Tax-to-Premium Ratio (T2P): Delta_cliff / C
   * Compares the tax risk incurred upon assignment against the premium received today.
   */
  calcTaxToPremiumRatio(strike, premium, costBasis, taxRate) {
    if (premium <= 0) return { ratio: 0, status: 'SAFE', label: '0.0x', cliff: 0, isTrap: false };
    const cliff = this.calcTaxCliffLoss(strike, costBasis, taxRate);
    const ratio = cliff / premium;

    let status = 'SAFE'; // < 0.5x
    if (ratio > 1.0) {
      status = 'TRAP'; // Red flag: Tax > Premium!
    } else if (ratio >= 0.5) {
      status = 'MODERATE'; // Orange: Tax is 50-100% of premium
    }

    return {
      ratio,
      status,
      label: ratio.toFixed(2) + 'x',
      cliff,
      isTrap: status === 'TRAP'
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
   * Unit Destruction Risk:
   * If assigned at K and price moves to targetPrice >= K, how many units can you rebuy?
   * Units Rebuyable = Net Cash / targetPrice
   * Unit Dilution % = max(0, (1 - Units Rebuyable) * 100)
   */
  calcUnitDestruction(netCash, targetPrice) {
    if (!targetPrice || targetPrice <= 0) return { units: 1.0, dilutionPct: 0, label: '100% διατήρηση' };
    const units = netCash / targetPrice;
    const dilutionPct = Math.max(0, (1 - units) * 100);
    return {
      units,
      dilutionPct,
      label: units < 1 ? `-${dilutionPct.toFixed(1)}% τεμάχια` : 'Πλήρης επαναγορά'
    };
  },

  /**
   * Tax Loss Shield / Carryforward (Greek Law N. 4172/2013 art. 42 par. 7):
   * If assignment occurs at a loss (K + C < B), a tax shield is created that
   * can be carried forward for 5 years to offset future capital gains.
   */
  calcTaxShield(strike, premium, costBasis) {
    const totalProceeds = strike + premium;
    if (totalProceeds < costBasis) {
      const loss = costBasis - totalProceeds;
      return {
        hasLoss: true,
        lossAmount: loss,
        carryforwardYears: 5,
        description: `Φορολογική ζημιά ${loss.toFixed(2)}€ (μεταφορά 5ετίας βάσει Ν. 4172/2013)`
      };
    }
    return { hasLoss: false, lossAmount: 0, carryforwardYears: 0, description: '' };
  },

  /**
   * Dimitris Andreou's Net-to-Gross Capital Withdrawal Formula:
   * Gross = X / (1 - (tau * u))
   * Where u = (S0 - B) / S0 (Unrealized gain percentage)
   */
  calcGrossRequired(netCashDesired, spot, costBasis, taxRate) {
    if (!spot || spot <= 0 || !netCashDesired || netCashDesired <= 0) {
      return { gross: netCashDesired || 0, taxDue: 0, effectiveRatePct: 0 };
    }
    const unrealizedGain = Math.max(0, spot - costBasis);
    const u = unrealizedGain / spot; // Unrealized gain fraction
    const effectiveRate = taxRate * u; // Effective tax on gross liquidation
    const denominator = Math.max(0.01, 1 - effectiveRate);
    const gross = netCashDesired / denominator;
    const taxDue = gross - netCashDesired;
    return {
      gross,
      taxDue,
      effectiveRatePct: effectiveRate * 100,
      unrealizedPct: u * 100
    };
  },

  /**
   * Roll Defense & Tax Avoidance Calculator:
   * Evaluate rolling a threatened Covered Call (Strike K_old -> K_new) to prevent assignment.
   * By buying back the call (BTC) and selling a further/higher call (STO), the stock is NEVER sold,
   * completely deferring and avoiding the (K - B) stock capital gains tax!
   */
  calcRollDefense({ currentStrike, currentCallPrice, newStrike, newCallPrice, spot, costBasis, taxRate }) {
    const buyToCloseCost = Math.max(0, currentCallPrice || 0);
    const sellToOpenCredit = Math.max(0, newCallPrice || 0);
    const netRollCredit = sellToOpenCredit - buyToCloseCost; // positive = net credit, negative = debit
    
    // If assigned on old contract, tax triggered on stock:
    const taxAvoidedOnStock = Math.max(0, (currentStrike - costBasis) * taxRate);
    
    // Additional upside unlocked:
    const upsideUnlocked = Math.max(0, newStrike - currentStrike);

    return {
      buyToCloseCost,
      sellToOpenCredit,
      netRollCredit,
      taxAvoidedOnStock,
      upsideUnlocked,
      stockSaleTriggered: false, // Stock remains 100% untouched
      effectiveTaxOnStock: 0.00 // 0% tax!
    };
  },

  /**
   * Comprehensive tax evaluation for a single Covered Call contract
   */
  evaluateContract({ spot, strike, premium, costBasis, taxRate, dte, mode = 'PRE_EXISTING', simPrice = null }) {
    const S0 = spot;
    const K = strike;
    const C = Math.max(0, premium);
    const B = mode === 'FRESH' ? S0 : costBasis;
    const tau = taxRate;
    const isPreExisting = mode === 'PRE_EXISTING' && B !== S0 && tau > 0;

    const embeddedTaxNow = this.calcEmbeddedTax(S0, B, tau);
    const taxNeutralTarget = this.calcTaxNeutralTarget(S0, B, tau);
    const assignment = this.calcNetCashAtAssignment(K, C, B, tau);
    const netCash = assignment.netCash;
    const taxPaid = assignment.taxPaid;
    const rebuyPrice = netCash;
    const cliffLoss = this.calcTaxCliffLoss(K, B, tau);
    const t2p = this.calcTaxToPremiumRatio(K, C, B, tau);
    const taxShield = this.calcTaxShield(K, C, B);

    // Unit destruction at simulated price (or Strike * 1.05 default)
    const refSimPrice = simPrice || Math.max(K, S0 * 1.05);
    const unitDestruction = this.calcUnitDestruction(netCash, refSimPrice);

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

    // Initial Cash Outlay today
    // Fresh: S0 - C (money surrendered)
    // Pre-existing: 0 (or -C inflow, no stock outlay today)
    const initialCashOutlay = mode === 'FRESH' ? (S0 - C) : 0;

    return {
      mode,
      spot: S0,
      strike: K,
      premium: C,
      costBasis: B,
      taxRate: tau,
      isPreExisting,
      initialCashOutlay,
      embeddedTaxNow,
      taxNeutralTarget,
      taxPaid,
      netCash,
      rebuyPrice,
      cliffLoss,
      t2p,
      isTaxTrap: t2p.isTrap,
      unitDestruction,
      taxShield,
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

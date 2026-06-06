'use strict';

/**
 * STRATEGY ENGINE — SSOT router
 *
 * All signal evaluation now routes through /engine/signal_engine.ts via
 * the ssot-bridge adapter. Legacy strategy files are retained as comments
 * for reference but are no longer called.
 */

const { evaluateForScanner } = require('./engine/ssot-bridge');

// LEGACY — retained for reference, replaced by SSOT
// const mnqIntraday = require('./strategies/mnq-intraday-v2');
// const mgcScalp    = require('./strategies/mgc-scalp-v2');
// const nqNyOpen    = require('./strategies/nq-ny-open-v3');
// const mnqFire     = require('./strategies/mnq-fire');

// Keep shared-indicators and THRESHOLDS exports for backward compatibility
const {
  aggregate1mTo5m, aggregate5mTo15m, aggregate5mTo30m, aggregate5mTo45m,
  aggregate5mTo1h, aggregate1hTo4h, aggregate1hToDaily, aggregate15mTo1h,
  aggregateBars,
} = require('./strategies/shared-indicators');

const { THRESHOLDS } = require('./strategies/confidence-scorer');
module.exports.THRESHOLDS = THRESHOLDS;

// Also re-export aggregation utilities (still used by scanner-core for bar prep)
module.exports.aggregate1mTo5m   = aggregate1mTo5m;
module.exports.aggregate5mTo15m  = aggregate5mTo15m;
module.exports.aggregate5mTo30m  = aggregate5mTo30m;
module.exports.aggregate5mTo45m  = aggregate5mTo45m;
module.exports.aggregate5mTo1h   = aggregate5mTo1h;
module.exports.aggregate1hTo4h   = aggregate1hTo4h;
module.exports.aggregate1hToDaily = aggregate1hToDaily;
module.exports.aggregate15mTo1h  = aggregate15mTo1h;
module.exports.aggregateBars     = aggregateBars;

/**
 * STRATEGY_META — kept for backward compatibility with UI and DB queries.
 */
const STRATEGY_META = {
  MNQ_INTRADAY: { displayName: 'MNQ Intraday (SSOT)',  instrument: 'MNQ', version: '5.0' },
  MGC_SCALP:    { displayName: 'MGC Scalp (SSOT)',     instrument: 'MGC', version: '5.0' },
};
module.exports.STRATEGY_META = STRATEGY_META;

/**
 * evaluateAll — routes all signals through the SSOT engine.
 *
 * barSets shape:
 *   bars5m, bars15m, bars1h, bars4h, barsDly  — MNQ bars
 *   bars5mMgc, bars15mMgc, bars30mMgc, bars45mMgc, bars1hMgc  — MGC bars
 *   esBars5m   — ES 5m bars (required for MNQ)
 *   nqBars5m   — NQ 5m bars (optional, breadth bonus)
 *
 * @param {object} barSets
 * @param {object} cfg
 * @returns {object[]} array of signal objects in legacy format
 */
function evaluateAll(barSets, cfg = {}) {
  const signals   = [];
  const instrument = cfg.instrument ?? null;

  // ── MNQ ─────────────────────────────────────────────────────────────────────
  if (instrument === 'MNQ' || instrument == null) {
    try {
      const sig = evaluateForScanner(
        'MNQ',
        barSets,
        barSets.esBars5m  ?? [],
        barSets.nqBars5m  ?? [],
        cfg.learningWeights ?? {},
      );
      if (sig) signals.push(sig);
    } catch (err) {
      console.error('[SSOT-BRIDGE] MNQ evaluate error:', err.message);
    }
  }

  // ── MGC ─────────────────────────────────────────────────────────────────────
  if (instrument === 'MGC' || instrument == null) {
    try {
      const sig = evaluateForScanner(
        'MGC',
        barSets,
        [],
        [],
        cfg.learningWeights ?? {},
      );
      if (sig) signals.push(sig);
    } catch (err) {
      console.error('[SSOT-BRIDGE] MGC evaluate error:', err.message);
    }
  }

  return signals;
}

module.exports.evaluateAll = evaluateAll;

// ── Legacy helper functions — still used by backtest-engine.js ────────────────

function buildBarSetsFrom5m(bars5m) {
  const bars15m = aggregate5mTo15m(bars5m);
  const bars1h  = aggregate5mTo1h(bars5m);
  const bars4h  = aggregate1hTo4h(bars1h);
  const barsDly = aggregate1hToDaily(bars1h);
  return { bars5m, bars15m, bars1h, bars4h, barsDly };
}

function buildBarSetsFrom1m(bars1m) {
  const bars5m  = aggregate1mTo5m(bars1m);
  const bars15m = aggregate5mTo15m(bars5m);
  const bars1h  = aggregate5mTo1h(bars5m);
  const bars4h  = aggregate1hTo4h(bars1h);
  const barsDly = aggregate1hToDaily(bars1h);
  return { bars5m, bars15m, bars1h, bars4h, barsDly };
}

function buildBarSetsFrom15m(bars15m) {
  const bars5m  = bars15m;
  const bars1h  = aggregate15mTo1h(bars15m);
  const bars4h  = aggregate1hTo4h(bars1h);
  const barsDly = aggregate1hToDaily(bars1h);
  return { bars5m, bars15m, bars1h, bars4h, barsDly };
}

// LEGACY — resetAllStrategies kept for backtest-engine.js backward compat
// In SSOT mode, strategy state is stateless; this is a no-op.
function resetAllStrategies() {
  // no-op — SSOT engine is stateless
}

// LEGACY — refreshNyOpenBlacklist kept for server.js backward compat
// The SSOT engine reads macro blackout dates from the DB directly.
function refreshNyOpenBlacklist(db) {
  // no-op in SSOT mode — signal_engine.ts manages its own blackout handling
}

module.exports.buildBarSetsFrom5m      = buildBarSetsFrom5m;
module.exports.buildBarSetsFrom1m      = buildBarSetsFrom1m;
module.exports.buildBarSetsFrom15m     = buildBarSetsFrom15m;
module.exports.resetAllStrategies      = resetAllStrategies;
module.exports.refreshNyOpenBlacklist  = refreshNyOpenBlacklist;

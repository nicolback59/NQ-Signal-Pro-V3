'use strict';

/**
 * SSOT Bridge — adapts engine/signal_engine evaluate() to scanner's legacy format.
 *
 * All signal generation flows: scanner → ssot-bridge → evaluate() → signal_engine.ts
 * No other code should call strategy files directly.
 */

const { evaluate } = require('./signal_engine');

// ── Grade / tier mapping ──────────────────────────────────────────────────────

const GRADE_TO_LEGACY = { 'A+': 'A+', A: 'A', B: 'BE', C: 'A', REJECT: null };
const GRADE_TO_TIER   = { 'A+': 'S', A: 'A', B: 'B', C: 'B', REJECT: 'IGNORE' };
const SIGNAL_TYPE_TO_SETUP = {
  CONTINUATION_PULLBACK: 'CONT_PB',
  VWAP_RECLAIM:          'VWAP_RCL',
  SWEEP_REVERSAL:        'SWEEP_REV',
  COMPRESSION_BREAKOUT:  'COMP_BRK',
};

// ── Win probability heuristic (score → prob) ─────────────────────────────────

function scoreToWinProb(score) {
  // Linear interpolation: score 70 → 45%, score 85 → 68%, score 100 → 88%
  return Math.min(92, Math.max(35, Math.round(35 + (score - 70) * 1.8)));
}

// ── Map SSOT Signal → scanner-compatible legacy format ────────────────────────

function mapSignalToLegacy(signal) {
  const wp1 = scoreToWinProb(signal.score);
  return {
    ticker:          signal.ticker,
    timeframe:       '5',
    direction:       signal.direction,
    grade:           GRADE_TO_LEGACY[signal.grade] ?? 'A',
    setup:           SIGNAL_TYPE_TO_SETUP[signal.signalType] ?? signal.signalType,
    strategy_name:   signal.instrument === 'MNQ' ? 'MNQ_INTRADAY' : 'MGC_SCALP',
    entry:           signal.entry,
    sl:              signal.sl,
    tp1:             signal.tp1,
    tp2:             signal.tp2,
    tp3:             signal.tp3,
    score:           signal.score,
    confidence:      signal.confidence,
    tier:            GRADE_TO_TIER[signal.grade] ?? 'B',
    win_prob_tp1:    wp1,
    win_prob_tp2:    Math.round(wp1 * 0.72),
    win_prob_tp3:    Math.round(wp1 * 0.50),
    htf_bias:        signal.htfBias,
    session:         signal.session,
    trade_style:     signal.instrument === 'MGC' ? 'scalp' : 'intraday',
    instrument:      signal.instrument,
    rr:              signal.rr,
    quant_score:     signal.score,
    quant_grade:     signal.grade,
    ssot_signal:     signal,          // full SSOT signal — used for signal_features logging
    ssot_indicators: signal.indicators,
    ssot_es_confirm: signal.esConfirm ?? null,
  };
}

/**
 * Evaluate one instrument using the SSOT engine and return a legacy-format signal.
 *
 * @param {string} instrument  'MNQ' | 'MGC'
 * @param {object} barSets     same barSets object scanner-core builds
 * @param {Array}  esBars5m    ES 5m bars (required for MNQ; ignored for MGC)
 * @param {Array}  nqBars5m    NQ 5m bars (optional breadth confirmation)
 * @param {object} [learningWeights]  AI-tuned weights from strategy_params
 * @returns {object|null} legacy signal object or null
 */
function evaluateForScanner(instrument, barSets, esBars5m = [], nqBars5m = [], learningWeights = {}) {
  const bars5m = instrument === 'MGC' ? barSets.bars5mMgc : barSets.bars5m;
  if (!bars5m || bars5m.length < 50) return null;

  const params = {
    instrument,
    bars:      bars5m,
    bars5m:    bars5m,
    timestamp: new Date(),
  };

  if (instrument === 'MNQ') {
    params.esBars  = esBars5m;
    params.nqBars  = nqBars5m.length ? nqBars5m : undefined;
  }

  if (Object.keys(learningWeights).length > 0) {
    params.learningWeights = learningWeights;
  }

  const result = evaluate(params);
  if (!result.signal) return null;

  return mapSignalToLegacy(result.signal);
}

/**
 * Evaluate one instrument for backtesting (same logic, explicit timestamp).
 *
 * @param {string} instrument
 * @param {Array}  bars5m     bars up to and including the bar being evaluated
 * @param {Array}  esBars5m   ES bars (required for MNQ)
 * @param {Date}   timestamp  bar timestamp (no Date.now() lookahead)
 * @param {object} [learningWeights]
 * @returns {object|null}
 */
function evaluateForBacktest(instrument, bars5m, esBars5m = [], timestamp, learningWeights = {}) {
  if (!bars5m || bars5m.length < 50) return null;

  const params = {
    instrument,
    bars:      bars5m,
    bars5m:    bars5m,
    timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp),
  };

  if (instrument === 'MNQ') {
    params.esBars = esBars5m;
  }

  if (Object.keys(learningWeights).length > 0) {
    params.learningWeights = learningWeights;
  }

  const result = evaluate(params);
  if (!result.signal) return null;

  return mapSignalToLegacy(result.signal);
}

module.exports = { evaluateForScanner, evaluateForBacktest, mapSignalToLegacy };

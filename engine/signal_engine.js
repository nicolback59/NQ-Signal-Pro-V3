/**
 * AurumSignals — Single Source of Truth (SSOT) Signal Engine
 *
 * Every signal evaluation flows through evaluate() in this file.
 * All other components call evaluate(); nothing else implements signal logic.
 *
 * Instruments: MNQ (Micro NQ futures), MGC (Micro Gold futures)
 * Timezone: America/New_York (ET) for all market-hours logic
 */
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LEARNING_WEIGHTS = void 0;
exports.getEtHhmm = getEtHhmm;
exports.isMarketOpen = isMarketOpen;
exports.ema = ema;
exports.rma = rma;
exports.calcAtr = calcAtr;
exports.calcVwap = calcVwap;
exports.calcRsi = calcRsi;
exports.calcAdx = calcAdx;
exports.calcMacd = calcMacd;
exports.computeIndicators = computeIndicators;
exports.computeHTFBias = computeHTFBias;
exports.computeESIndicators = computeESIndicators;
exports.checkESConfirmation = checkESConfirmation;
exports.detectSignalType = detectSignalType;
exports.scoreMNQ = scoreMNQ;
exports.scoreMGC = scoreMGC;
exports.computeTargetsMNQ = computeTargetsMNQ;
exports.computeTargetsMGC = computeTargetsMGC;
exports.gradeSignal = gradeSignal;
exports.shouldNotify = shouldNotify;
exports.fingerprint = fingerprint;
exports.evaluate = evaluate;
// ── Default Learning Weights ──────────────────────────────────────────────────
exports.DEFAULT_LEARNING_WEIGHTS = {
    mnqMinScore: 70,
    mgcMinScore: 70,
    trendWeight: 25,
    htfWeight: 20,
    vwapWeight: 15,
    momentumWeight: 10,
    atrWeight: 5,
    adxWeight: 5,
    esWeight: 20,
};
// ── Volatility Minimums ───────────────────────────────────────────────────────
const ATR_MIN = {
    MNQ: 18,
    MGC: 2.0,
};
// ── Utility: resolve a bar's timestamp to epoch ms ───────────────────────────
function toMs(ts) {
    if (typeof ts === 'number')
        return ts;
    if (ts instanceof Date)
        return ts.getTime();
    return new Date(ts).getTime();
}
// ── Market Hours ──────────────────────────────────────────────────────────────
/**
 * Returns ET time as an integer hhmm (e.g., 1430 = 2:30 PM ET).
 */
function getEtHhmm(ts) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(ts);
    const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
    return h * 100 + m;
}
/**
 * Returns ET weekday: 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat, 7=Sun.
 */
function getEtWeekday(ts) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
    }).formatToParts(ts);
    const day = parts.find(p => p.type === 'weekday').value;
    const map = {
        Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
    };
    return map[day] ?? 1;
}
/**
 * Returns ET session name based on hhmm.
 */
function getSessionName(hhmm) {
    if (hhmm >= 930 && hhmm < 1130)
        return 'NY Open';
    if (hhmm >= 200 && hhmm < 730)
        return 'London';
    if (hhmm >= 730 && hhmm < 930)
        return 'London/NY Overlap';
    if (hhmm >= 1130 && hhmm < 1300)
        return 'Midday';
    if (hhmm >= 1300 && hhmm < 1600)
        return 'Afternoon';
    if (hhmm >= 1600)
        return 'After Hours';
    return 'Overnight';
}
/**
 * Determines whether the market is open for trading at the given timestamp.
 *
 * BLOCKED windows (all ET):
 *   - Friday 12:59 PM ET onward (weekend close begins)
 *   - All Saturday
 *   - Sunday before 6:00 PM ET (Globex not yet open)
 *   - Mon–Fri 1:00 PM–2:59 PM ET (daily lunch + CME maintenance)
 *
 * Note: daily lunch block applies Mon–Thu. Friday 1:00 PM+ is already
 * covered by the weekend close rule.
 */
function isMarketOpen(ts) {
    const weekday = getEtWeekday(ts);
    const hhmm = getEtHhmm(ts);
    // Friday 12:59 PM ET onward → weekend close begins
    if (weekday === 5 && hhmm >= 1259) {
        return { open: false, reason: 'EXPIRED_MARKET_HOURS' };
    }
    // All Saturday
    if (weekday === 6) {
        return { open: false, reason: 'EXPIRED_MARKET_HOURS' };
    }
    // Sunday before 6:00 PM ET
    if (weekday === 7 && hhmm < 1800) {
        return { open: false, reason: 'EXPIRED_MARKET_HOURS' };
    }
    // Daily lunch block: Mon–Thu 1:00 PM–2:59 PM ET
    // (Friday 1:00+ is covered by the Fri rule above)
    if (weekday >= 1 && weekday <= 4 && hhmm >= 1300 && hhmm < 1500) {
        return { open: false, reason: 'EXPIRED_MARKET_HOURS' };
    }
    return { open: true };
}
// ── Indicator Math ────────────────────────────────────────────────────────────
/**
 * Exponential Moving Average using standard 2/(period+1) multiplier.
 */
function ema(values, period) {
    const k = 2 / (period + 1);
    let prev = values[0];
    return values.map(v => (prev = v * k + prev * (1 - k)));
}
/**
 * Wilder's RMA (Wilder Smoothing) — matches Pine Script ta.rma() / ta.atr() smoothing.
 * Seed = SMA of first `period` values; then: rma[i] = alpha * val[i] + (1-alpha) * rma[i-1].
 */
function rma(values, period) {
    const alpha = 1 / period;
    const result = new Array(values.length).fill(null);
    let prev = null;
    for (let i = 0; i < values.length; i++) {
        if (prev === null) {
            if (i === period - 1) {
                let s = 0;
                for (let j = 0; j < period; j++)
                    s += values[j] ?? 0;
                prev = s / period;
                result[i] = prev;
            }
        }
        else {
            prev = alpha * (values[i] ?? 0) + (1 - alpha) * prev;
            result[i] = prev;
        }
    }
    return result;
}
/**
 * ATR(14) using Wilder's RMA of True Range.
 */
function calcAtr(bars, period = 14) {
    const tr = bars.map((b, i) => i === 0
        ? b.high - b.low
        : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close)));
    return rma(tr, period);
}
/**
 * VWAP with daily reset (UTC date boundary, matches standard VWAP calc).
 */
function calcVwap(bars) {
    let cumPV = 0;
    let cumV = 0;
    let lastDate = '';
    return bars.map(b => {
        const date = new Date(toMs(b.timestamp)).toISOString().slice(0, 10);
        if (date !== lastDate) {
            cumPV = 0;
            cumV = 0;
            lastDate = date;
        }
        const hlc3 = (b.high + b.low + b.close) / 3;
        const v = b.volume ?? 1;
        cumPV += hlc3 * v;
        cumV += v;
        return cumPV / cumV;
    });
}
/**
 * RSI(14) using Wilder's smoothing (matches Pine Script ta.rsi()).
 */
function calcRsi(closes, period = 14) {
    const result = new Array(closes.length).fill(null);
    if (closes.length < period + 1)
        return result;
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0)
            avgGain += diff;
        else
            avgLoss -= diff;
    }
    avgGain /= period;
    avgLoss /= period;
    result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
    for (let i = period + 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        const gain = diff > 0 ? diff : 0;
        const loss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
    }
    return result;
}
/**
 * ADX(14) with Wilder's smoothing of DM+ and DM-.
 * Returns arrays for adx, diPlus, diMinus (all length = bars.length).
 */
function calcAdx(bars, period = 14) {
    const n = bars.length;
    const nullArr = () => new Array(n).fill(null);
    if (n < period * 2)
        return { adx: nullArr(), diPlus: nullArr(), diMinus: nullArr() };
    const trArr = new Array(n).fill(0);
    const dmPlus = new Array(n).fill(0);
    const dmMinus = new Array(n).fill(0);
    for (let i = 1; i < n; i++) {
        const upMove = bars[i].high - bars[i - 1].high;
        const downMove = bars[i - 1].low - bars[i].low;
        trArr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - bars[i - 1].close), Math.abs(bars[i].low - bars[i - 1].close));
        dmPlus[i] = upMove > downMove && upMove > 0 ? upMove : 0;
        dmMinus[i] = downMove > upMove && downMove > 0 ? downMove : 0;
    }
    const atrSmooth = rma(trArr, period);
    const rDmPlus = rma(dmPlus, period);
    const rDmMinus = rma(dmMinus, period);
    const diPlusArr = rDmPlus.map((v, i) => atrSmooth[i] != null && atrSmooth[i] > 0 ? (v / atrSmooth[i]) * 100 : null);
    const diMinusArr = rDmMinus.map((v, i) => atrSmooth[i] != null && atrSmooth[i] > 0 ? (v / atrSmooth[i]) * 100 : null);
    const dx = diPlusArr.map((v, i) => {
        const dm = diMinusArr[i];
        if (v == null || dm == null)
            return null;
        const sum = v + dm;
        return sum > 0 ? (Math.abs(v - dm) / sum) * 100 : 0;
    });
    const adx = rma(dx.map(v => v ?? 0), period);
    return { adx, diPlus: diPlusArr, diMinus: diMinusArr };
}
/**
 * MACD(12, 26, 9): standard EMA-based MACD.
 */
function calcMacd(closes) {
    const emaFast = ema(closes, 12);
    const emaSlow = ema(closes, 26);
    const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
    const signal = ema(macdLine, 9);
    const histogram = macdLine.map((v, i) => v - signal[i]);
    return { macdLine, signal, histogram };
}
// ── Aggregation Helpers ───────────────────────────────────────────────────────
function aggregateBars(bars, factor) {
    const out = [];
    const start = bars.length % factor;
    for (let i = start; i + factor - 1 < bars.length; i += factor) {
        const s = bars.slice(i, i + factor);
        out.push({
            timestamp: s[0].timestamp,
            open: s[0].open,
            high: Math.max(...s.map(b => b.high)),
            low: Math.min(...s.map(b => b.low)),
            close: s[s.length - 1].close,
            volume: s.reduce((sum, b) => sum + (b.volume ?? 0), 0),
        });
    }
    return out;
}
// ── High-Level Indicator Computation ─────────────────────────────────────────
/**
 * Computes all primary indicators from the provided bars (1m or 5m).
 * Returns the latest (most recent) value of each indicator.
 */
function computeIndicators(bars) {
    const closes = bars.map(b => b.close);
    const n = closes.length - 1;
    const ema9Arr = ema(closes, 9);
    const ema21Arr = ema(closes, 21);
    const atrArr = calcAtr(bars, 14);
    const adxResult = calcAdx(bars, 14);
    const rsiArr = calcRsi(closes, 14);
    const vwapArr = calcVwap(bars);
    const macdResult = calcMacd(closes);
    const ema9Val = ema9Arr[n];
    const ema21Val = ema21Arr[n];
    const atrVal = atrArr[n] ?? 0;
    const adxVal = adxResult.adx[n] ?? 0;
    const rsiVal = rsiArr[n] ?? 50;
    const vwapVal = vwapArr[n];
    const macdHistVal = macdResult.histogram[n];
    const currentClose = closes[n];
    return {
        ema9: ema9Val,
        ema21: ema21Val,
        atr: atrVal,
        adx: adxVal,
        rsi: rsiVal,
        vwap: vwapVal,
        macdHist: macdHistVal,
        aboveVwap: currentClose > vwapVal,
        ema9AboveEma21: ema9Val > ema21Val,
    };
}
// ── HTF Bias Computation ──────────────────────────────────────────────────────
/**
 * Computes multi-timeframe bias from 5-minute bars.
 * Aggregates to 15m, 30m, 45m, 1h and scores each timeframe:
 *   +1 if EMA9 > EMA21 AND close > EMA21 (bullish)
 *   -1 if EMA9 < EMA21 AND close < EMA21 (bearish)
 *    0 otherwise (neutral)
 */
function computeHTFBias(bars5m) {
    function scoreTF(tfBars) {
        if (tfBars.length < 21)
            return 0;
        const closes = tfBars.map(b => b.close);
        const n = closes.length - 1;
        const ema9Arr = ema(closes, 9);
        const ema21Arr = ema(closes, 21);
        const e9 = ema9Arr[n];
        const e21 = ema21Arr[n];
        const c = closes[n];
        if (e9 > e21 && c > e21)
            return 1;
        if (e9 < e21 && c < e21)
            return -1;
        return 0;
    }
    const bars15m = aggregateBars(bars5m, 3);
    const bars30m = aggregateBars(bars5m, 6);
    const bars45m = aggregateBars(bars5m, 9);
    const bars1h = aggregateBars(bars5m, 12);
    const score15m = scoreTF(bars15m);
    const score30m = scoreTF(bars30m);
    const score45m = scoreTF(bars45m);
    const score1h = scoreTF(bars1h);
    const totalScore = score15m + score30m + score45m + score1h;
    return {
        score15m,
        score30m,
        score45m,
        score1h,
        totalScore,
        bullish: totalScore >= 2,
        bearish: totalScore <= -2,
    };
}
// ── ES Indicators ─────────────────────────────────────────────────────────────
/**
 * Computes ES (E-mini S&P 500) derived indicators needed for MNQ confirmation.
 * esBars: primary ES 5m bars for EMA/VWAP/momentum
 * es5m: optional separate 5m bars for HTF aggregation (can be same as esBars)
 */
function computeESIndicators(esBars, es5m) {
    const htfBars = es5m ?? esBars;
    const closes = esBars.map(b => b.close);
    const n = esBars.length - 1;
    const ema9Arr = ema(closes, 9);
    const ema21Arr = ema(closes, 21);
    const vwapArr = calcVwap(esBars);
    const macdResult = calcMacd(closes);
    const e9 = ema9Arr[n];
    const e21 = ema21Arr[n];
    const vwapVal = vwapArr[n];
    const currentClose = closes[n];
    // HTF bias for ES
    const htf = computeHTFBias(htfBars);
    // Market structure for HH/HL and LH/LL over recent 20 bars
    const recentBars = esBars.slice(-20);
    const recentHighs = recentBars.map(b => b.high);
    const recentLows = recentBars.map(b => b.low);
    // HH/HL: last 3 pivot highs ascending, last 3 pivot lows ascending
    // Simplified check: compare second-half highs/lows vs first-half
    const halfLen = Math.floor(recentBars.length / 2);
    const firstHalfHigh = Math.max(...recentHighs.slice(0, halfLen));
    const secondHalfHigh = Math.max(...recentHighs.slice(halfLen));
    const firstHalfLow = Math.min(...recentLows.slice(0, halfLen));
    const secondHalfLow = Math.min(...recentLows.slice(halfLen));
    const makingHHHL = secondHalfHigh > firstHalfHigh && secondHalfLow > firstHalfLow;
    const makingLHLL = secondHalfHigh < firstHalfHigh && secondHalfLow < firstHalfLow;
    // Momentum: MACD histogram direction
    const hist = macdResult.histogram;
    const histN = hist[n];
    const histPrev = hist[n - 1] ?? 0;
    const momentumBullish = histN > 0 && histN > histPrev;
    const momentumBearish = histN < 0 && histN < histPrev;
    // ES leadership: HTF bias is considered to have flipped before MNQ
    // We mark this true if HTF total score is strongly aligned (≥3 or ≤-3)
    const htfFlippedBeforeMNQ = Math.abs(htf.totalScore) >= 3;
    return {
        aboveVwap: currentClose > vwapVal,
        ema9AboveEma21: e9 > e21,
        htfBullish: htf.bullish,
        htfBearish: htf.bearish,
        makingHHHL,
        makingLHLL,
        momentumBullish,
        momentumBearish,
        htfFlippedBeforeMNQ,
        ema9: e9,
        ema21: e21,
        vwap: vwapVal,
    };
}
// ── ES Confirmation Check ─────────────────────────────────────────────────────
/**
 * Validates ES confirmation for the given MNQ direction.
 *
 * LONG requires ALL of: above VWAP, EMA9>EMA21, HTF bullish, HH/HL, momentum aligned.
 * SHORT requires ALL of: below VWAP, EMA9<EMA21, HTF bearish, LH/LL, momentum aligned.
 *
 * Reject conditions (reject the MNQ signal):
 *   - ES trend is opposite to MNQ direction
 *   - ES HTF is opposite to MNQ direction
 *   - ES lost VWAP while MNQ attempts LONG
 *   - ES reclaimed VWAP while MNQ attempts SHORT
 */
function checkESConfirmation(esInd, direction, htfBias) {
    const isLong = direction === 'LONG';
    // Hard rejection conditions
    if (isLong) {
        if (!esInd.ema9AboveEma21) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_TREND_OPPOSITE',
            };
        }
        if (esInd.htfBearish) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_HTF_OPPOSITE',
            };
        }
        if (!esInd.aboveVwap) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_LOST_VWAP',
            };
        }
    }
    else {
        if (esInd.ema9AboveEma21) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_TREND_OPPOSITE',
            };
        }
        if (esInd.htfBullish) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_HTF_OPPOSITE',
            };
        }
        if (esInd.aboveVwap) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: 'ES_RECLAIMED_VWAP',
            };
        }
    }
    // Check full confirmation
    const longConfirmed = esInd.aboveVwap &&
        esInd.ema9AboveEma21 &&
        esInd.htfBullish &&
        esInd.makingHHHL &&
        esInd.momentumBullish;
    const shortConfirmed = !esInd.aboveVwap &&
        !esInd.ema9AboveEma21 &&
        esInd.htfBearish &&
        esInd.makingLHLL &&
        esInd.momentumBearish;
    const confirmed = isLong ? longConfirmed : shortConfirmed;
    if (!confirmed) {
        const missing = [];
        if (isLong) {
            if (!esInd.makingHHHL)
                missing.push('NO_HHHLS');
            if (!esInd.momentumBullish)
                missing.push('ES_MOMENTUM_NOT_BULL');
        }
        else {
            if (!esInd.makingLHLL)
                missing.push('NO_LHLLS');
            if (!esInd.momentumBearish)
                missing.push('ES_MOMENTUM_NOT_BEAR');
        }
        if (missing.length > 0) {
            return {
                confirmed: false,
                direction,
                confidenceBonus: 0,
                esLeadership: false,
                rejectReason: missing.join('+'),
            };
        }
    }
    // ES leadership: ES HTF flipped before MNQ
    const esLeadership = esInd.htfFlippedBeforeMNQ;
    const confidenceBonus = esLeadership ? 5 : 0;
    return {
        confirmed,
        direction,
        confidenceBonus,
        esLeadership,
    };
}
// ── Signal Type Detection ─────────────────────────────────────────────────────
/**
 * Detects the most appropriate signal type from recent bar action.
 * Returns null if no valid signal type is detected.
 *
 * Priority order: CONTINUATION_PULLBACK, VWAP_RECLAIM, SWEEP_REVERSAL, COMPRESSION_BREAKOUT
 */
function detectSignalType(bars, ind, htf, direction) {
    if (bars.length < 15)
        return null;
    const isLong = direction === 'LONG';
    const atr = ind.atr;
    const vwap = ind.vwap;
    const ema9 = ind.ema9;
    const ema21 = ind.ema21;
    const last = bars[bars.length - 1];
    const recent5 = bars.slice(-5);
    const recent10 = bars.slice(-10);
    // ── CONTINUATION_PULLBACK ─────────────────────────────────────────────────
    // Trend aligned, price pulled back to EMA9 or EMA21, VWAP on correct side
    const tolerance = atr * 0.5;
    const priceNearEma9 = Math.abs(last.close - ema9) <= tolerance ||
        Math.abs(last.low - ema9) <= tolerance || Math.abs(last.high - ema9) <= tolerance;
    const priceNearEma21 = Math.abs(last.close - ema21) <= tolerance ||
        Math.abs(last.low - ema21) <= tolerance || Math.abs(last.high - ema21) <= tolerance;
    const nearEma = priceNearEma9 || priceNearEma21;
    const vwapAlignedCont = isLong ? ind.aboveVwap : !ind.aboveVwap;
    const trendAligned = isLong ? ind.ema9AboveEma21 : !ind.ema9AboveEma21;
    if (trendAligned && nearEma && vwapAlignedCont) {
        return 'CONTINUATION_PULLBACK';
    }
    // ── VWAP_RECLAIM ──────────────────────────────────────────────────────────
    // In last 5 bars: had a cross below/above VWAP, now closed back above/below
    const vwapArr = calcVwap(bars);
    const last5Vwap = vwapArr.slice(-5);
    let hadVwapCross = false;
    for (let i = 0; i < recent5.length - 1; i++) {
        const barClose = recent5[i].close;
        const barVwap = last5Vwap[i];
        if (isLong && barClose < barVwap && last.close > vwap) {
            hadVwapCross = true;
            break;
        }
        if (!isLong && barClose > barVwap && last.close < vwap) {
            hadVwapCross = true;
            break;
        }
    }
    if (hadVwapCross) {
        // Momentum aligned: MACD histogram direction matches
        const macdAligned = isLong ? ind.macdHist > 0 : ind.macdHist < 0;
        if (macdAligned) {
            return 'VWAP_RECLAIM';
        }
    }
    // ── SWEEP_REVERSAL ────────────────────────────────────────────────────────
    // In last 5 bars: spike below recent swing low (LONG) or above swing high (SHORT), then reversed
    const recentHighs = recent10.map(b => b.high);
    const recentLows = recent10.map(b => b.low);
    const swingHigh = Math.max(...recentHighs.slice(0, recentHighs.length - 1));
    const swingLow = Math.min(...recentLows.slice(0, recentLows.length - 1));
    let hadSweep = false;
    for (let i = 0; i < recent5.length - 1; i++) {
        if (isLong && recent5[i].low < swingLow) {
            hadSweep = true;
            break;
        }
        if (!isLong && recent5[i].high > swingHigh) {
            hadSweep = true;
            break;
        }
    }
    if (hadSweep) {
        // RSI was extreme (< 30 for LONG sweep, > 70 for SHORT sweep)
        const rsiArr = calcRsi(bars.map(b => b.close), 14);
        const rsiAt = rsiArr.slice(-5).find(r => r != null) ?? 50;
        const rsiExtreme = isLong ? rsiAt < 30 : rsiAt > 70;
        if (rsiExtreme) {
            return 'SWEEP_REVERSAL';
        }
    }
    // ── COMPRESSION_BREAKOUT ──────────────────────────────────────────────────
    // Last 10 bars range < 0.6 × (ATR × 10), current bar breaks out with volume spike
    const r10High = Math.max(...recent10.map(b => b.high));
    const r10Low = Math.min(...recent10.map(b => b.low));
    const range10 = r10High - r10Low;
    const compressionThreshold = atr * 0.6;
    const isCompressed = range10 < compressionThreshold * 10;
    if (isCompressed) {
        // Breakout: close above compression range (LONG) or below (SHORT)
        const breakoutLong = isLong && last.close > r10High;
        const breakoutShort = !isLong && last.close < r10Low;
        // Volume spike: current volume > 1.5x average of prior bars
        const priorVolumes = recent10.slice(0, -1).map(b => b.volume ?? 0);
        const avgVol = priorVolumes.reduce((s, v) => s + v, 0) / priorVolumes.length;
        const hasVolumeSpike = (last.volume ?? 0) > avgVol * 1.5;
        if ((breakoutLong || breakoutShort) && hasVolumeSpike) {
            return 'COMPRESSION_BREAKOUT';
        }
    }
    return null;
}
// ── Scoring ───────────────────────────────────────────────────────────────────
/**
 * Scores an MNQ signal on the 100-point weighted scale:
 *   Trend (EMA alignment)  25%
 *   HTF Confluence         20%
 *   VWAP position/reclaim  15%
 *   Momentum (RSI+MACD)    10%
 *   ATR/volatility          5%
 *   ADX/trend strength      5%
 *   ES Confirmation        20%
 * Plus bonuses for ES leadership and market breadth.
 */
function scoreMNQ(params) {
    const { direction, ind, htf, esConfirm, nqAligned, weights } = params;
    const isLong = direction === 'LONG';
    const W = weights;
    // ── Trend score (0–25) ──────────────────────────────────────────────────
    // Scaling: full alignment=25, partial=15, weak=8
    const trendMax = W.trendWeight;
    let trendRaw = 0;
    if (isLong) {
        if (ind.ema9AboveEma21 && ind.aboveVwap)
            trendRaw = 1.0;
        else if (ind.ema9AboveEma21 || ind.aboveVwap)
            trendRaw = 0.6;
        else
            trendRaw = 0.32;
    }
    else {
        if (!ind.ema9AboveEma21 && !ind.aboveVwap)
            trendRaw = 1.0;
        else if (!ind.ema9AboveEma21 || !ind.aboveVwap)
            trendRaw = 0.6;
        else
            trendRaw = 0.32;
    }
    const trendScore = Math.round(trendMax * trendRaw);
    // ── HTF score (0–20) ────────────────────────────────────────────────────
    const htfMax = W.htfWeight;
    const absHtf = Math.abs(htf.totalScore);
    let htfRatio = 0;
    if (absHtf >= 3)
        htfRatio = 1.0;
    else if (absHtf === 2)
        htfRatio = 0.75;
    else if (absHtf === 1)
        htfRatio = 0.4;
    else
        htfRatio = 0;
    const htfScore = Math.round(htfMax * htfRatio);
    // ── VWAP score (0–15) ───────────────────────────────────────────────────
    const vwapMax = W.vwapWeight;
    let vwapScore = 0;
    if (isLong) {
        if (ind.aboveVwap && ind.ema9AboveEma21)
            vwapScore = vwapMax;
        else if (ind.aboveVwap)
            vwapScore = Math.round(vwapMax * 0.53);
        else
            vwapScore = 0;
    }
    else {
        if (!ind.aboveVwap && !ind.ema9AboveEma21)
            vwapScore = vwapMax;
        else if (!ind.aboveVwap)
            vwapScore = Math.round(vwapMax * 0.53);
        else
            vwapScore = 0;
    }
    // ── Momentum score (0–10) ───────────────────────────────────────────────
    const momMax = W.momentumWeight;
    let momScore = 0;
    const rsi = ind.rsi;
    if (isLong) {
        if (rsi >= 50 && rsi <= 65 && ind.macdHist > 0)
            momScore = momMax;
        else if ((rsi >= 50 && rsi < 70) || ind.macdHist > 0)
            momScore = Math.round(momMax * 0.5);
        else if (rsi >= 45)
            momScore = Math.round(momMax * 0.2);
    }
    else {
        if (rsi <= 50 && rsi >= 35 && ind.macdHist < 0)
            momScore = momMax;
        else if ((rsi <= 50 && rsi > 30) || ind.macdHist < 0)
            momScore = Math.round(momMax * 0.5);
        else if (rsi <= 55)
            momScore = Math.round(momMax * 0.2);
    }
    // ── ATR score (0–5) ─────────────────────────────────────────────────────
    const atrMax = W.atrWeight;
    const atrMin = ATR_MIN[params.instrument];
    let atrScore = 0;
    if (ind.atr >= atrMin * 1.5)
        atrScore = atrMax;
    else if (ind.atr >= atrMin * 1.15)
        atrScore = Math.round(atrMax * 0.6);
    else if (ind.atr >= atrMin)
        atrScore = Math.round(atrMax * 0.2);
    // ── ADX score (0–5) ─────────────────────────────────────────────────────
    const adxMax = W.adxWeight;
    let adxScore = 0;
    if (ind.adx > 25)
        adxScore = adxMax;
    else if (ind.adx > 20)
        adxScore = Math.round(adxMax * 0.8);
    else if (ind.adx > 16)
        adxScore = Math.round(adxMax * 0.4);
    // ── ES Confirmation score (0–20) ────────────────────────────────────────
    const esMax = W.esWeight;
    let esScore = 0;
    if (esConfirm != null) {
        if (esConfirm.confirmed)
            esScore = esMax;
        else
            esScore = Math.round(esMax * 0.5);
    }
    else {
        // No ES data — not applicable (MNQ always requires ES; this path shouldn't be reached
        // in normal MNQ flow, but handle gracefully)
        esScore = Math.round(esMax * 0.25);
    }
    // ── ES leadership bonus/penalty ─────────────────────────────────────────
    let esLeadershipBonus = 0;
    if (esConfirm != null) {
        if (esConfirm.esLeadership)
            esLeadershipBonus = 5;
        else
            esLeadershipBonus = -10; // ES confirmed but lagged — MNQ moved without ES leading
    }
    // ── Market breadth bonus (+5 to +10) ────────────────────────────────────
    let breadthBonus = 0;
    if (nqAligned) {
        // ES + MNQ + NQ + VWAP + HTF all aligned
        const fullyAligned = ind.aboveVwap === isLong &&
            ind.ema9AboveEma21 === isLong &&
            (isLong ? htf.bullish : htf.bearish) &&
            (esConfirm?.confirmed ?? false);
        breadthBonus = fullyAligned ? 10 : 5;
    }
    const total = Math.min(100, trendScore + htfScore + vwapScore + momScore + atrScore + adxScore + esScore +
        esLeadershipBonus + breadthBonus);
    return {
        total,
        trendScore,
        htfScore,
        vwapScore,
        momentumScore: momScore,
        atrScore,
        adxScore,
        esScore,
        breadthBonus,
        esLeadershipBonus,
    };
}
/**
 * Scores an MGC signal on the same 100-point weighted scale.
 * MGC has no mandatory ES confirmation requirement; ES data is optional.
 */
function scoreMGC(params) {
    const { direction, ind, htf, esConfirm, nqAligned, weights } = params;
    const isLong = direction === 'LONG';
    const W = weights;
    // Trend score (0–25)
    const trendMax = W.trendWeight;
    let trendRaw = 0;
    if (isLong) {
        if (ind.ema9AboveEma21 && ind.aboveVwap)
            trendRaw = 1.0;
        else if (ind.ema9AboveEma21 || ind.aboveVwap)
            trendRaw = 0.6;
        else
            trendRaw = 0.32;
    }
    else {
        if (!ind.ema9AboveEma21 && !ind.aboveVwap)
            trendRaw = 1.0;
        else if (!ind.ema9AboveEma21 || !ind.aboveVwap)
            trendRaw = 0.6;
        else
            trendRaw = 0.32;
    }
    const trendScore = Math.round(trendMax * trendRaw);
    // HTF score (0–20)
    const htfMax = W.htfWeight;
    const absHtf = Math.abs(htf.totalScore);
    let htfRatio = 0;
    if (absHtf >= 3)
        htfRatio = 1.0;
    else if (absHtf === 2)
        htfRatio = 0.75;
    else if (absHtf === 1)
        htfRatio = 0.4;
    const htfScore = Math.round(htfMax * htfRatio);
    // VWAP score (0–15)
    const vwapMax = W.vwapWeight;
    let vwapScore = 0;
    if (isLong) {
        if (ind.aboveVwap && ind.ema9AboveEma21)
            vwapScore = vwapMax;
        else if (ind.aboveVwap)
            vwapScore = Math.round(vwapMax * 0.53);
    }
    else {
        if (!ind.aboveVwap && !ind.ema9AboveEma21)
            vwapScore = vwapMax;
        else if (!ind.aboveVwap)
            vwapScore = Math.round(vwapMax * 0.53);
    }
    // Momentum score (0–10)
    const momMax = W.momentumWeight;
    let momScore = 0;
    const rsi = ind.rsi;
    if (isLong) {
        if (rsi >= 50 && rsi <= 65 && ind.macdHist > 0)
            momScore = momMax;
        else if ((rsi >= 50 && rsi < 70) || ind.macdHist > 0)
            momScore = Math.round(momMax * 0.5);
        else if (rsi >= 45)
            momScore = Math.round(momMax * 0.2);
    }
    else {
        if (rsi <= 50 && rsi >= 35 && ind.macdHist < 0)
            momScore = momMax;
        else if ((rsi <= 50 && rsi > 30) || ind.macdHist < 0)
            momScore = Math.round(momMax * 0.5);
        else if (rsi <= 55)
            momScore = Math.round(momMax * 0.2);
    }
    // ATR score (0–5)
    const atrMax = W.atrWeight;
    const atrMin = ATR_MIN[params.instrument];
    let atrScore = 0;
    if (ind.atr >= atrMin * 1.5)
        atrScore = atrMax;
    else if (ind.atr >= atrMin * 1.15)
        atrScore = Math.round(atrMax * 0.6);
    else if (ind.atr >= atrMin)
        atrScore = Math.round(atrMax * 0.2);
    // ADX score (0–5)
    const adxMax = W.adxWeight;
    let adxScore = 0;
    if (ind.adx > 25)
        adxScore = adxMax;
    else if (ind.adx > 20)
        adxScore = Math.round(adxMax * 0.8);
    else if (ind.adx > 16)
        adxScore = Math.round(adxMax * 0.4);
    // ES score for MGC: optional but provides confirmation bonus
    // MGC spec says no ES confirmation mandatory; treat as optional
    const esMax = W.esWeight;
    let esScore = Math.round(esMax * 0.25); // base: no ES data
    if (esConfirm != null) {
        esScore = esConfirm.confirmed ? esMax : Math.round(esMax * 0.5);
    }
    // ES leadership bonus/penalty
    let esLeadershipBonus = 0;
    if (esConfirm?.esLeadership)
        esLeadershipBonus = 5;
    // Market breadth bonus
    let breadthBonus = 0;
    if (nqAligned) {
        const fullyAligned = ind.aboveVwap === isLong &&
            ind.ema9AboveEma21 === isLong &&
            (isLong ? htf.bullish : htf.bearish);
        breadthBonus = fullyAligned ? 10 : 5;
    }
    const total = Math.min(100, trendScore + htfScore + vwapScore + momScore + atrScore + adxScore + esScore +
        esLeadershipBonus + breadthBonus);
    return {
        total,
        trendScore,
        htfScore,
        vwapScore,
        momentumScore: momScore,
        atrScore,
        adxScore,
        esScore,
        breadthBonus,
        esLeadershipBonus,
    };
}
// ── Risk / Target Computation ─────────────────────────────────────────────────
/**
 * Computes MNQ targets:
 *   stopDistance = MAX(1.5 × ATR, |entry - recentSwing|)
 *   SL = entry ∓ stopDistance
 *   TP1 = entry ± 20 pts
 *   TP2 = entry ± 35 pts
 *   TP3 = entry ± 50 pts
 *   RR = 20 / stopDistance
 */
function computeTargetsMNQ(entry, direction, atr, recentSwing) {
    const dir = direction === 'LONG' ? 1 : -1;
    const swingDist = Math.abs(entry - recentSwing);
    const stopDistance = Math.max(1.5 * atr, swingDist);
    return {
        sl: entry - dir * stopDistance,
        tp1: entry + dir * 20,
        tp2: entry + dir * 35,
        tp3: entry + dir * 50,
        rr: 20 / stopDistance,
        stopDistance,
    };
}
/**
 * Computes MGC scalp targets:
 *   stopDistance = MAX(1.0 × ATR, |entry - recentSwing|)
 *   SL = entry ∓ stopDistance
 *   TP1 = entry ± 1.5 × stopDistance (1.5R)
 *   TP2 = entry ± 2.5 × stopDistance (2.5R)
 *   TP3 = entry ± 4.0 × stopDistance (4R)
 *   RR = 1.5
 */
function computeTargetsMGC(entry, direction, atr, recentSwing) {
    const dir = direction === 'LONG' ? 1 : -1;
    const swingDist = Math.abs(entry - recentSwing);
    const stopDistance = Math.max(1.0 * atr, swingDist);
    return {
        sl: entry - dir * stopDistance,
        tp1: entry + dir * 1.5 * stopDistance,
        tp2: entry + dir * 2.5 * stopDistance,
        tp3: entry + dir * 4.0 * stopDistance,
        rr: 1.5,
        stopDistance,
    };
}
// ── Grading ───────────────────────────────────────────────────────────────────
/**
 * Maps a 0–100 score to an A+/A/B/C/REJECT grade.
 */
function gradeSignal(score) {
    if (score >= 85)
        return 'A+';
    if (score >= 80)
        return 'A';
    if (score >= 75)
        return 'B';
    if (score >= 70)
        return 'C';
    return 'REJECT';
}
/**
 * Returns true if the grade warrants a push notification.
 * A+, A, B → NOTIFY; C → LOG ONLY; REJECT → silenced.
 */
function shouldNotify(grade) {
    return grade === 'A+' || grade === 'A' || grade === 'B';
}
// ── Anti-Duplicate Fingerprint ────────────────────────────────────────────────
/**
 * Generates a deduplication fingerprint for a signal.
 * Signals with the same instrument + direction + signalType + sessionDate
 * are treated as duplicates.
 */
function fingerprint(instrument, direction, signalType, sessionDate) {
    return `${instrument}:${direction}:${signalType}:${sessionDate}`;
}
// ── NQ Breadth Helper ─────────────────────────────────────────────────────────
/**
 * Checks whether NQ is aligned with the given direction for breadth confirmation.
 * NQ aligned = EMA9 > EMA21 and above VWAP for LONG, opposite for SHORT.
 */
function isNQAligned(nqBars, direction) {
    if (nqBars.length < 22)
        return false;
    const closes = nqBars.map(b => b.close);
    const n = closes.length - 1;
    const ema9Arr = ema(closes, 9);
    const ema21Arr = ema(closes, 21);
    const vwapArr = calcVwap(nqBars);
    const e9 = ema9Arr[n];
    const e21 = ema21Arr[n];
    const vwapVal = vwapArr[n];
    const close = closes[n];
    if (direction === 'LONG')
        return e9 > e21 && close > vwapVal;
    return e9 < e21 && close < vwapVal;
}
// ── Recent Swing Helpers ──────────────────────────────────────────────────────
function recentSwingLow(bars, lookback = 10) {
    const slice = bars.slice(-lookback - 1, -1);
    return Math.min(...slice.map(b => b.low));
}
function recentSwingHigh(bars, lookback = 10) {
    const slice = bars.slice(-lookback - 1, -1);
    return Math.max(...slice.map(b => b.high));
}
// ── Main Evaluate Function ────────────────────────────────────────────────────
/**
 * Full signal evaluation pipeline — the SSOT entry point.
 *
 * Steps (strict order):
 *  1. Market hours check
 *  2. Minimum bars check (≥50)
 *  3. Compute indicators
 *  4. Compute HTF bias
 *  5. Trend engine check (EMA9/EMA21 + VWAP + HTF)
 *  6. Volatility filter (ATR)
 *  7. ADX filter
 *  8. Determine direction
 *  9. RSI filter (direction-aware + extreme rejection)
 * 10. Detect signal type
 * 11. ES confirmation (MNQ only — MANDATORY)
 * 12. Score the signal
 * 13. Apply market breadth bonus
 * 14. Grade the signal
 * 15. Minimum score check
 * 16. Compute targets
 * 17. Build full Signal object
 * 18. Return EvaluationResult
 */
function evaluate(params) {
    const { instrument, bars, bars5m, esBars, es5mBars, nqBars, timestamp, learningWeights, } = params;
    const weights = {
        ...exports.DEFAULT_LEARNING_WEIGHTS,
        ...learningWeights,
    };
    const rejectReasons = [];
    // ── Step 1: Market Hours ──────────────────────────────────────────────────
    const marketStatus = isMarketOpen(timestamp);
    if (!marketStatus.open) {
        return {
            signal: null,
            blocked: true,
            blockReason: marketStatus.reason ?? 'MARKET_HOURS',
            rejectReasons: ['BLOCKED_MARKET_HOURS'],
        };
    }
    // ── Step 2: Minimum Bars Check ────────────────────────────────────────────
    if (bars.length < 50) {
        return {
            signal: null,
            blocked: false,
            rejectReasons: ['INSUFFICIENT_BARS'],
        };
    }
    // ── Step 3: Compute Indicators ────────────────────────────────────────────
    const ind = computeIndicators(bars);
    // ── Step 4: Compute HTF Bias ──────────────────────────────────────────────
    const htfInputBars = bars5m ?? bars;
    const htf = computeHTFBias(htfInputBars);
    // ── Step 5: Trend Engine ──────────────────────────────────────────────────
    // Both EMA alignment AND HTF confluence must support the same direction.
    // Determine which direction (if any) has trend + HTF alignment.
    const longTrend = ind.ema9AboveEma21 && ind.aboveVwap && htf.bullish;
    const shortTrend = !ind.ema9AboveEma21 && !ind.aboveVwap && htf.bearish;
    if (!longTrend && !shortTrend) {
        rejectReasons.push('TREND_ENGINE_FAIL');
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // ── Step 6: Volatility Filter ─────────────────────────────────────────────
    if (ind.atr < ATR_MIN[instrument]) {
        rejectReasons.push(`ATR_TOO_LOW: ${ind.atr.toFixed(3)} < ${ATR_MIN[instrument]}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // ── Step 7: ADX Filter ────────────────────────────────────────────────────
    if (ind.adx <= 16) {
        rejectReasons.push(`ADX_TOO_LOW: ${ind.adx.toFixed(2)}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // ── Step 8: Determine Direction ───────────────────────────────────────────
    const direction = longTrend ? 'LONG' : 'SHORT';
    const isLong = direction === 'LONG';
    // ── Step 9: RSI Filter ────────────────────────────────────────────────────
    const rsi = ind.rsi;
    // Direction-based RSI check
    if (isLong && rsi <= 50) {
        rejectReasons.push(`RSI_DIRECTION_FAIL: LONG requires RSI > 50, got ${rsi.toFixed(1)}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    if (!isLong && rsi >= 50) {
        rejectReasons.push(`RSI_DIRECTION_FAIL: SHORT requires RSI < 50, got ${rsi.toFixed(1)}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // Extreme RSI rejection (will be overridden for SWEEP_REVERSAL after type detection)
    const rsiExtreme = rsi > 76 || rsi < 24;
    // ── Step 10: Detect Signal Type ───────────────────────────────────────────
    const signalType = detectSignalType(bars, ind, htf, direction);
    if (signalType === null) {
        rejectReasons.push('NO_SIGNAL_TYPE_DETECTED');
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // Apply extreme RSI rejection — EXCEPT for SWEEP_REVERSAL (RSI extreme is expected)
    if (rsiExtreme && signalType !== 'SWEEP_REVERSAL') {
        rejectReasons.push(`RSI_EXTREME: ${rsi.toFixed(1)} (only SWEEP_REVERSAL exempt)`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
        };
    }
    // ── Step 11: ES Confirmation (MNQ only — MANDATORY) ───────────────────────
    let esConfirm = null;
    if (instrument === 'MNQ') {
        if (!esBars || esBars.length < 22) {
            rejectReasons.push('ES_BARS_MISSING');
            return {
                signal: null,
                blocked: false,
                rejectReasons,
                indicators: ind,
                htfBias: htf,
            };
        }
        const esInd = computeESIndicators(esBars, es5mBars);
        esConfirm = checkESConfirmation(esInd, direction, htf);
        if (!esConfirm.confirmed) {
            rejectReasons.push(`ES_CONFIRM_FAIL: ${esConfirm.rejectReason ?? 'ES_NOT_ALIGNED'}`);
            return {
                signal: null,
                blocked: false,
                rejectReasons,
                indicators: ind,
                htfBias: htf,
                esConfirm,
            };
        }
    }
    // ── Step 12: Score the Signal ─────────────────────────────────────────────
    const nqAligned = nqBars ? isNQAligned(nqBars, direction) : false;
    const scoreParams = {
        instrument,
        direction,
        ind,
        htf,
        esConfirm,
        nqAligned,
        weights,
    };
    const signalScoreObj = instrument === 'MNQ' ? scoreMNQ(scoreParams) : scoreMGC(scoreParams);
    const score = signalScoreObj.total;
    // ── Step 13: Minimum Score Check ──────────────────────────────────────────
    const minScore = instrument === 'MNQ' ? weights.mnqMinScore : weights.mgcMinScore;
    if (score < minScore) {
        rejectReasons.push(`SCORE_TOO_LOW: ${score} < ${minScore}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
            esConfirm: esConfirm ?? undefined,
        };
    }
    // ── Step 14: Grade the Signal ─────────────────────────────────────────────
    const grade = gradeSignal(score);
    if (grade === 'REJECT') {
        rejectReasons.push(`GRADE_REJECT: score=${score}`);
        return {
            signal: null,
            blocked: false,
            rejectReasons,
            indicators: ind,
            htfBias: htf,
            esConfirm: esConfirm ?? undefined,
        };
    }
    // ── Step 15: Compute Targets ──────────────────────────────────────────────
    const entry = bars[bars.length - 1].close;
    const swingRef = direction === 'LONG' ? recentSwingLow(bars, 10) : recentSwingHigh(bars, 10);
    const targets = instrument === 'MNQ'
        ? computeTargetsMNQ(entry, direction, ind.atr, swingRef)
        : computeTargetsMGC(entry, direction, ind.atr, swingRef);
    // ── Step 16: Session and fingerprint ─────────────────────────────────────
    const hhmm = getEtHhmm(timestamp);
    const session = getSessionName(hhmm);
    const sessionDate = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(timestamp);
    const fp = fingerprint(instrument, direction, signalType, sessionDate);
    const htfBiasLabel = htf.bullish ? 'BULL ▲' : htf.bearish ? 'BEAR ▼' : 'NEUTRAL';
    const ticker = instrument === 'MNQ' ? 'MNQ1!' : 'MGC1!';
    // ── Step 17: Build Signal Object ──────────────────────────────────────────
    const signal = {
        instrument,
        ticker,
        direction,
        signalType,
        grade,
        score,
        confidence: score,
        entry,
        sl: targets.sl,
        tp1: targets.tp1,
        tp2: targets.tp2,
        tp3: targets.tp3,
        rr: targets.rr,
        stopDistance: targets.stopDistance,
        htfBias: htfBiasLabel,
        htfScore: htf.totalScore,
        session,
        shouldNotify: shouldNotify(grade),
        fingerprint: fp,
        timestamp,
        indicators: {
            ema9: ind.ema9,
            ema21: ind.ema21,
            atr: ind.atr,
            adx: ind.adx,
            rsi: ind.rsi,
            vwap: ind.vwap,
            macdHist: ind.macdHist,
            aboveVwap: ind.aboveVwap,
            ema9AboveEma21: ind.ema9AboveEma21,
        },
        ...(esConfirm != null ? { esConfirm } : {}),
    };
    // ── Step 18: Return Result ────────────────────────────────────────────────
    return {
        signal,
        blocked: false,
        rejectReasons,
        indicators: ind,
        htfBias: htf,
        ...(esConfirm != null ? { esConfirm } : {}),
    };
}

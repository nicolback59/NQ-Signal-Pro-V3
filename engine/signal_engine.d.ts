/**
 * AurumSignals — Single Source of Truth (SSOT) Signal Engine
 *
 * Every signal evaluation flows through evaluate() in this file.
 * All other components call evaluate(); nothing else implements signal logic.
 *
 * Instruments: MNQ (Micro NQ futures), MGC (Micro Gold futures)
 * Timezone: America/New_York (ET) for all market-hours logic
 */
export type Direction = 'LONG' | 'SHORT';
export type Instrument = 'MNQ' | 'MGC';
export type SignalType = 'CONTINUATION_PULLBACK' | 'VWAP_RECLAIM' | 'SWEEP_REVERSAL' | 'COMPRESSION_BREAKOUT';
export type Grade = 'A+' | 'A' | 'B' | 'C' | 'REJECT';
export type TradeStatus = 'ACTIVE' | 'WIN' | 'LOSS' | 'BE' | 'EXPIRED' | 'INVALIDATED';
export type ExpirationReason = 'EXPIRED_MARKET_HOURS' | 'EXPIRED_MARKET_CLOSE' | 'EXPIRED_WEEKEND_CLOSE' | 'EXPIRED_MAX_HOLD' | 'EXPIRED_STUCK_TRADE';
export interface OHLCV {
    timestamp: number | string | Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}
export interface Indicators {
    ema9: number;
    ema21: number;
    atr: number;
    adx: number;
    rsi: number;
    vwap: number;
    macdHist: number;
    aboveVwap: boolean;
    ema9AboveEma21: boolean;
}
export interface HTFBiasResult {
    score15m: number;
    score30m: number;
    score45m: number;
    score1h: number;
    totalScore: number;
    bullish: boolean;
    bearish: boolean;
}
export interface ESIndicators {
    aboveVwap: boolean;
    ema9AboveEma21: boolean;
    htfBullish: boolean;
    htfBearish: boolean;
    makingHHHL: boolean;
    makingLHLL: boolean;
    momentumBullish: boolean;
    momentumBearish: boolean;
    htfFlippedBeforeMNQ: boolean;
    ema9: number;
    ema21: number;
    vwap: number;
}
export interface ESConfirmResult {
    confirmed: boolean;
    direction: Direction;
    confidenceBonus: number;
    esLeadership: boolean;
    rejectReason?: string;
}
export interface SignalScore {
    total: number;
    trendScore: number;
    htfScore: number;
    vwapScore: number;
    momentumScore: number;
    atrScore: number;
    adxScore: number;
    esScore: number;
    breadthBonus: number;
    esLeadershipBonus: number;
}
export interface Targets {
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    rr: number;
    stopDistance: number;
}
export interface Signal {
    instrument: Instrument;
    ticker: 'MNQ1!' | 'MGC1!';
    direction: Direction;
    signalType: SignalType;
    grade: Grade;
    score: number;
    confidence: number;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    rr: number;
    stopDistance: number;
    htfBias: 'BULL ▲' | 'BEAR ▼' | 'NEUTRAL';
    htfScore: number;
    session: string;
    shouldNotify: boolean;
    fingerprint: string;
    timestamp: Date;
    indicators: {
        ema9: number;
        ema21: number;
        atr: number;
        adx: number;
        rsi: number;
        vwap: number;
        macdHist: number;
        aboveVwap: boolean;
        ema9AboveEma21: boolean;
    };
    esConfirm?: ESConfirmResult;
}
export interface EvaluationParams {
    instrument: Instrument;
    bars: OHLCV[];
    bars5m?: OHLCV[];
    esBars?: OHLCV[];
    es5mBars?: OHLCV[];
    nqBars?: OHLCV[];
    timestamp: Date;
    learningWeights?: LearningWeights;
}
export interface EvaluationResult {
    signal: Signal | null;
    blocked: boolean;
    blockReason?: string;
    rejectReasons: string[];
    indicators?: Indicators;
    htfBias?: HTFBiasResult;
    esConfirm?: ESConfirmResult;
}
export interface LearningWeights {
    mnqMinScore?: number;
    mgcMinScore?: number;
    trendWeight?: number;
    htfWeight?: number;
    vwapWeight?: number;
    momentumWeight?: number;
    atrWeight?: number;
    adxWeight?: number;
    esWeight?: number;
}
interface ScoreParams {
    instrument: Instrument;
    direction: Direction;
    ind: Indicators;
    htf: HTFBiasResult;
    esConfirm: ESConfirmResult | null;
    nqAligned: boolean;
    weights: Required<LearningWeights>;
}
export declare const DEFAULT_LEARNING_WEIGHTS: Required<LearningWeights>;
/**
 * Returns ET time as an integer hhmm (e.g., 1430 = 2:30 PM ET).
 */
export declare function getEtHhmm(ts: Date): number;
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
export declare function isMarketOpen(ts: Date): {
    open: boolean;
    reason?: string;
};
/**
 * Exponential Moving Average using standard 2/(period+1) multiplier.
 */
export declare function ema(values: number[], period: number): number[];
/**
 * Wilder's RMA (Wilder Smoothing) — matches Pine Script ta.rma() / ta.atr() smoothing.
 * Seed = SMA of first `period` values; then: rma[i] = alpha * val[i] + (1-alpha) * rma[i-1].
 */
export declare function rma(values: number[], period: number): (number | null)[];
/**
 * ATR(14) using Wilder's RMA of True Range.
 */
export declare function calcAtr(bars: OHLCV[], period?: number): (number | null)[];
/**
 * VWAP with daily reset (UTC date boundary, matches standard VWAP calc).
 */
export declare function calcVwap(bars: OHLCV[]): number[];
/**
 * RSI(14) using Wilder's smoothing (matches Pine Script ta.rsi()).
 */
export declare function calcRsi(closes: number[], period?: number): (number | null)[];
/**
 * ADX(14) with Wilder's smoothing of DM+ and DM-.
 * Returns arrays for adx, diPlus, diMinus (all length = bars.length).
 */
export declare function calcAdx(bars: OHLCV[], period?: number): {
    adx: (number | null)[];
    diPlus: (number | null)[];
    diMinus: (number | null)[];
};
/**
 * MACD(12, 26, 9): standard EMA-based MACD.
 */
export declare function calcMacd(closes: number[]): {
    macdLine: number[];
    signal: number[];
    histogram: number[];
};
/**
 * Computes all primary indicators from the provided bars (1m or 5m).
 * Returns the latest (most recent) value of each indicator.
 */
export declare function computeIndicators(bars: OHLCV[]): Indicators;
/**
 * Computes multi-timeframe bias from 5-minute bars.
 * Aggregates to 15m, 30m, 45m, 1h and scores each timeframe:
 *   +1 if EMA9 > EMA21 AND close > EMA21 (bullish)
 *   -1 if EMA9 < EMA21 AND close < EMA21 (bearish)
 *    0 otherwise (neutral)
 */
export declare function computeHTFBias(bars5m: OHLCV[]): HTFBiasResult;
/**
 * Computes ES (E-mini S&P 500) derived indicators needed for MNQ confirmation.
 * esBars: primary ES 5m bars for EMA/VWAP/momentum
 * es5m: optional separate 5m bars for HTF aggregation (can be same as esBars)
 */
export declare function computeESIndicators(esBars: OHLCV[], es5m?: OHLCV[]): ESIndicators;
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
export declare function checkESConfirmation(esInd: ESIndicators, direction: Direction, htfBias: HTFBiasResult): ESConfirmResult;
/**
 * Detects the most appropriate signal type from recent bar action.
 * Returns null if no valid signal type is detected.
 *
 * Priority order: CONTINUATION_PULLBACK, VWAP_RECLAIM, SWEEP_REVERSAL, COMPRESSION_BREAKOUT
 */
export declare function detectSignalType(bars: OHLCV[], ind: Indicators, htf: HTFBiasResult, direction: Direction): SignalType | null;
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
export declare function scoreMNQ(params: ScoreParams): SignalScore;
/**
 * Scores an MGC signal on the same 100-point weighted scale.
 * MGC has no mandatory ES confirmation requirement; ES data is optional.
 */
export declare function scoreMGC(params: ScoreParams): SignalScore;
/**
 * Computes MNQ targets:
 *   stopDistance = MAX(1.5 × ATR, |entry - recentSwing|)
 *   SL = entry ∓ stopDistance
 *   TP1 = entry ± 20 pts
 *   TP2 = entry ± 35 pts
 *   TP3 = entry ± 50 pts
 *   RR = 20 / stopDistance
 */
export declare function computeTargetsMNQ(entry: number, direction: Direction, atr: number, recentSwing: number): Targets;
/**
 * Computes MGC scalp targets:
 *   stopDistance = MAX(1.0 × ATR, |entry - recentSwing|)
 *   SL = entry ∓ stopDistance
 *   TP1 = entry ± 1.5 × stopDistance (1.5R)
 *   TP2 = entry ± 2.5 × stopDistance (2.5R)
 *   TP3 = entry ± 4.0 × stopDistance (4R)
 *   RR = 1.5
 */
export declare function computeTargetsMGC(entry: number, direction: Direction, atr: number, recentSwing: number): Targets;
/**
 * Maps a 0–100 score to an A+/A/B/C/REJECT grade.
 */
export declare function gradeSignal(score: number): Grade;
/**
 * Returns true if the grade warrants a push notification.
 * A+, A, B → NOTIFY; C → LOG ONLY; REJECT → silenced.
 */
export declare function shouldNotify(grade: Grade): boolean;
/**
 * Generates a deduplication fingerprint for a signal.
 * Signals with the same instrument + direction + signalType + sessionDate
 * are treated as duplicates.
 */
export declare function fingerprint(instrument: Instrument, direction: Direction, signalType: SignalType, sessionDate: string): string;
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
export declare function evaluate(params: EvaluationParams): EvaluationResult;
export {};

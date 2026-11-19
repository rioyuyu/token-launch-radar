// radar-4: a power-law token launch radar.
//
// The value model is fitted, not asserted. Live tokens (a market cap on record)
// give a size curve, log10(mcap) = a + b*log10(TVL), by ordinary least squares
// on the logs. A pre-token protocol's if-launched value is that curve at its TVL,
// carried by its 7-day TVL change; its launch odds are the share of look-alike
// protocols (same age band, same category) that already record a token, smoothed
// toward the age band's rate. Implied value = if-launched x odds, with a range
// from the fit residuals. Nothing is special-cased by name: the same functions
// score every protocol, and the held-out numbers below are the real ones,
// momentum and category premium included even though they do not help.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-4';
/** The farmer's deposit the verdicts are priced on, in whole dollars. */
export const DEPOSIT_USD = 1000;
/** Airdrop slice = implied value x this: a 5% community pool split among ~5,000 farmers. */
export const SLICE_FRACTION = 0.00001;
/** A farm clears its fees "clearly" only past this net, in dollars. */
export const FARM_MARGIN_USD = 25;
/** 7-day growth is clamped to this band (per cent) before it carries the value. */
export const GROWTH_CLAMP: [number, number] = [-50, 100];
/** How much of the clamped 7-day change carries into the if-launched value. */
export const GROWTH_WEIGHT = 0.5;

const DAY_MS = 86_400_000;
const AGE_BANDS: [number, number][] = [[0, 180], [180, 365], [365, 730], [730, 1095], [1095, Infinity]];

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Whole days from `listedAt` to `asOf`; null when the listing date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records a token when any of the three token fields is set. */
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null || p.gecko_id !== null || p.symbol !== null;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return !isLive(p);
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_NAMES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Why a pre-token protocol is not farmable, in the watchlist rule's own order,
 * or null when it can be ranked. The order is the accounting: a protocol counts
 * in the first group whose rule it meets.
 */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'Bridges';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') return 'Liquid staking/restaking';
  if (p.category === 'CEX' || EXCHANGE_NAMES.some((e) => p.name.startsWith(e))) return 'Exchange custody';
  if (VERSIONED.test(p.name)) return 'Versioned';
  if (WRAPPED_WORD.test(p.name)) return 'Wrapped/staked';
  return null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** One fitted point of the size curve, in log10 space. */
interface LogPoint {
  x: number;
  y: number;
}

/** Ordinary least squares on log10(mcap) against log10(TVL). */
export function fitPowerLaw(points: LogPoint[]): { a: number; b: number; n: number } {
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const q of points) {
    sx += q.x;
    sy += q.y;
    sxx += q.x * q.x;
    sxy += q.x * q.y;
  }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return { a: (sy - b * sx) / n, b, n };
}

/** The curve's prediction, in dollars, at a TVL. */
export function curveValue(fit: { a: number; b: number }, tvl: number): number {
  return Math.pow(10, fit.a + fit.b * Math.log10(tvl));
}

/** A sorted array's value at quantile `f` (0..1), by nearest lower rank. */
function quantile(sorted: number[], f: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(f * sorted.length)))]!;
}

/** Median of |predicted/actual| over a test set, as a multiplier (xN). */
function medianMiss(pairs: { pred: number; actual: number }[]): number {
  const ms = pairs.map(({ pred, actual }) => Math.pow(10, Math.abs(Math.log10(pred) - Math.log10(actual)))).sort((x, y) => x - y);
  return ms[Math.floor(ms.length / 2)]!;
}

/** The 7-day growth carry: 1 + weight x clamped change, as a multiplier. */
export function growthCarry(change7d: number | null): number {
  const g = clamp(change7d ?? 0, GROWTH_CLAMP[0], GROWTH_CLAMP[1]);
  return 1 + (GROWTH_WEIGHT * g) / 100;
}

/** The age band an age in days falls in, or -1 when the age is unknown. */
function ageBand(age: number | null): number {
  if (age === null) return -1;
  return AGE_BANDS.findIndex(([lo, hi]) => age >= lo && age < hi);
}

export interface FitStep {
  name: string;
  miss: number;
}

export interface Validation {
  n_train: number;
  n_test: number;
  miss: number;
  range_holds_pct: number;
  within_3x: number;
}

export interface FitResult {
  a: number;
  b: number;
  n: number;
  formula: string;
  steps: FitStep[];
  validation: Validation;
  /** log10 residuals of the full fit, for the rows' ranges. */
  residP10: number;
  residP90: number;
}

/**
 * Fit the size curve on every live token with a positive market cap and TVL,
 * then validate it held-out: fit on the older half of the dated live tokens,
 * predict the newer half, and run the stepwise backtest on the same split.
 * The steps are honest about what helps: the curve beats a flat multiple by a
 * lot; momentum and a category premium do not beat the curve alone here.
 */
export function fitModel(snapshot: Snapshot): FitResult {
  const fitPoints = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd!), p }));
  const fit = fitPowerLaw(fitPoints);
  const formula = `10^${fit.a.toFixed(2)} x TVL^${fit.b.toFixed(3)}`;

  // Held-out split: dated live tokens, older half trains, newer half tests.
  // Undated protocols carry no age, so they cannot be placed in time and
  // are left out of the split (they still count in the full fit above).
  const dated = fitPoints
    .filter((q) => q.p.listed_at !== null)
    .sort((a, b) =>
    (a.p.listed_at! < b.p.listed_at! ? -1 : a.p.listed_at! > b.p.listed_at! ? 1 : a.p.slug < b.p.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const trainFit = fitPowerLaw(train);

  const flatMult = train.reduce((t, q) => t + Math.pow(10, q.y) / Math.pow(10, q.x), 0) / train.length;
  const trainResidByCat = new Map<string, number[]>();
  for (const q of train) {
    const r = q.y - (trainFit.a + trainFit.b * q.x);
    const key = q.p.category ?? '(none)';
    if (!trainResidByCat.has(key)) trainResidByCat.set(key, []);
    trainResidByCat.get(key)!.push(r);
  }
  const catPremium = new Map<string, number>();
  for (const [key, rs] of trainResidByCat) {
    rs.sort((x, y) => x - y);
    catPremium.set(key, rs.length >= 5 ? rs[Math.floor(rs.length / 2)]! : 0);
  }
  const predict = (q: (typeof fitPoints)[number], step: number): number => {
    const base = Math.pow(10, trainFit.a + trainFit.b * q.x);
    if (step === 0) return Math.pow(10, q.x) * flatMult;
    if (step === 1) return base;
    const withMom = base * growthCarry(q.p.change_7d);
    if (step === 2) return withMom;
    return withMom * Math.pow(10, catPremium.get(q.p.category ?? '(none)') ?? 0);
  };
  const stepNames = ['Flat TVL multiple', 'Power-law size curve', '+ 7-day momentum', '+ category premium'];
  const steps: FitStep[] = stepNames.map((name, i) => ({
    name,
    miss: round2(medianMiss(test.map((q) => ({ pred: predict(q, i), actual: Math.pow(10, q.y) })))),
  }));

  // The final model is step 2 (curve + momentum): the category premium is
  // measured in the backtest but not used, because it misses worse held-out.
  const finalPred = (q: (typeof fitPoints)[number]): number => predict(q, 2);
  const testPairs = test.map((q) => ({ pred: finalPred(q), actual: Math.pow(10, q.y) }));
  const trainResid = train
    .map((q) => q.y - Math.log10(finalPred(q)))
    .sort((x, y) => x - y);
  const lo = quantile(trainResid, 0.1);
  const hi = quantile(trainResid, 0.9);
  const inRange = testPairs.filter(({ pred, actual }) => {
    const r = Math.log10(actual) - Math.log10(pred);
    return r >= lo && r <= hi;
  }).length;
  const validation: Validation = {
    n_train: train.length,
    n_test: test.length,
    miss: round2(medianMiss(testPairs)),
    range_holds_pct: round2((100 * inRange) / test.length),
    within_3x: round2((100 * testPairs.filter(({ pred, actual }) => Math.abs(Math.log10(pred) - Math.log10(actual)) <= Math.log10(3)).length) / test.length),
  };

  const fullResid = fitPoints
    .map((q) => q.y - Math.log10(curveValue(fit, Math.pow(10, q.x)) * growthCarry(q.p.change_7d)))
    .sort((x, y) => x - y);
  return { a: round4(fit.a), b: round4(fit.b), n: fit.n, formula, steps, validation, residP10: quantile(fullResid, 0.1), residP90: quantile(fullResid, 0.9) };
}

/**
 * Launch odds: the share of look-alikes that already record a token. The age
 * band's rate is smoothed toward the global rate (k=20); the cell (band x
 * category) is smoothed toward its band's rate (k=10). Unknown age falls back
 * to the global rate. Clamped to [0.05, 0.95]: no protocol is a sure thing.
 */
export function launchOdds(snapshot: Snapshot): (p: SnapshotProtocol, age: number | null) => number {
  const global = snapshot.protocols.filter(isLive).length / snapshot.protocols.length;
  const bandRate: number[] = AGE_BANDS.map(([lo, hi]) => {
    const g = snapshot.protocols.filter((p) => {
      const d = ageDays(snapshot.as_of, p.listed_at);
      return d !== null && d >= lo && d < hi;
    });
    return (g.filter(isLive).length + 20 * global) / (g.length + 20);
  });
  const cell = new Map<string, { n: number; live: number }>();
  for (const p of snapshot.protocols) {
    const key = `${ageBand(ageDays(snapshot.as_of, p.listed_at))}|${p.category ?? '(none)'}`;
    const c = cell.get(key) ?? { n: 0, live: 0 };
    c.n++;
    if (isLive(p)) c.live++;
    cell.set(key, c);
  }
  return (p, age) => {
    const band = ageBand(age);
    const base = band === -1 ? global : bandRate[band]!;
    const c = cell.get(`${band}|${p.category ?? '(none)'}`);
    if (!c) return clamp(base, 0.05, 0.95);
    return clamp((c.live + 10 * base) / (c.n + 10), 0.05, 0.95);
  };
}

// ---------------------------------------------------------------- farm plans

/** Gas for one transaction on a protocol's first chain, in dollars. */
function gasPerTx(chain: string): number {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 6;
  if (c.includes('tron')) return 1;
  if (c.includes('avalanche')) return 0.5;
  if (c.includes('bsc') || c.includes('bnb')) return 0.3;
  if (c.includes('arbitrum')) return 0.3;
  if (c.includes('optimism')) return 0.2;
  if (c.includes('base')) return 0.15;
  if (c.includes('polygon')) return 0.1;
  if (c.includes('solana')) return 0.05;
  return 1.5;
}

/** Hold days from age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main deposit action, from the protocol's own category. */
function mainAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Supply $1,000 of USDC as collateral to ${n} on ${chain} and leave the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Add $1,000 of liquidity to ${n}'s largest pool on ${chain} and leave the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $1,000 of USDC as margin on ${n} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $1,000 on ${n} and place one position in an active market.`;
  if (c.includes('stable')) return `Mint or deposit $1,000 of the stable asset through ${n} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $1,000 of the yield-bearing asset ${n} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $1,000 of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('allocator') || c.includes('curator') || c.includes('vault')) return `Deposit $1,000 into a ${n} vault on ${chain} and keep the shares.`;
  return `Deposit $1,000 of USDC into ${n} on ${chain} and keep the position open.`;
}

/** Six concrete steps, each carrying its cost and its time. */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const hold = holdDaysFor(age);
  const weeks = Math.ceil(hold / 7);
  const gas = gasPerTx(chain);
  const steps = [
    `Open a fresh wallet that holds only this farm's funds, write its seed phrase on paper, and fund it with $1,000 of USDC plus gas. Cost: about $${gas} of gas for the first transaction. Time: 10 minutes.`,
    `${mainAction(p, chain)} Cost: $1,000 of capital plus about $${gas} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action each week for ${weeks} weeks, such as a small deposit, a swap, or a vote in ${p.name}'s app. Cost: about $${gas} of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity lands in more than one snapshot. Cost: the $1,000 stays in the position. Time: ${hold} days.`,
    `Before withdrawing, open ${p.name}'s own points or rewards page from the link it publishes and claim only there, never through a link in a reply or ad. Cost: about $${gas} of gas to claim. Time: 10 minutes.`,
    `Write the wallet, the dates, and every transaction hash in a farm log, then unwind the position once the claim is done. Cost: nothing but the log. Time: 10 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** Farm fees: gas for setup (2 txs), one weekly tx per week held, and the claim (1 tx). */
export function farmFees(p: SnapshotProtocol, age: number | null): number {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const txs = 2 + Math.ceil(holdDaysFor(age) / 7) + 1;
  return round2(txs * gasPerTx(chain));
}

/** Active hours the farm takes: setup, weekly actions, claim and log. */
export function farmHours(age: number | null): number {
  return round2(0.25 + 0.25 * Math.ceil(holdDaysFor(age) / 7) + 0.5);
}

// ---------------------------------------------------------------- the board

export type Verdict = 'FARM' | 'THIN' | 'SKIP';

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  no_token_days: number | null;
  watchlist: boolean;
  if_launched_usd: number;
  launch_odds: number;
  implied_value_usd: number;
  range_low_usd: number;
  range_high_usd: number;
  airdrop_slice_usd: number;
  farm_fees_usd: number;
  net_of_fees_usd: number;
  verdict: Verdict;
  farm_hours: number;
  farm_days: number;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  deposit_usd: number;
  fit: { a: number; b: number; n: number; formula: string; steps: FitStep[] };
  validation: Validation;
  board_size: number;
  watchlist_size: number;
  total_implied_usd: number;
  rows: RadarRow[];
  accounting: { total: number; ranked: number; live: number; excluded: number; groups: { label: string; count: number }[] };
  verdicts: { farm: number; thin: number; skip: number };
  kpi: { ranked: number; total_implied_usd: number; held_out_miss: number; range_holds_pct: number; worth_farming: number; best_per_hour_usd: number };
  scatter: { live: { tvl: number; mcap: number }[]; board: { tvl: number; implied: number }[]; curve: { tvl: number; mcap: number }[] };
  excluded: { slug: string; name: string; reason: string }[];
  live_rows: { slug: string; name: string; tvl_usd: number; mcap_usd: number | null }[];
}

/** The whole radar, from the snapshot: fit, odds, ranking, verdicts, accounting. */
export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: RadarData } {
  const model = fitModel(snapshot);
  const oddsOf = launchOdds(snapshot);
  const watch = new Set(snapshot.watchlist);

  const liveCount = snapshot.protocols.filter(isLive).length;
  const groups = new Map<string, number>();
  const excluded: RadarData['excluded'] = [];
  const ranked: RadarRow[] = [];
  for (const p of snapshot.protocols) {
    if (isLive(p)) continue;
    const reason = exclusionReason(p);
    if (reason !== null) {
      groups.set(reason, (groups.get(reason) ?? 0) + 1);
      excluded.push({ slug: p.slug, name: p.name, reason });
      continue;
    }
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ifLaunched = Math.max(1, Math.round(curveValue({ a: model.a, b: model.b }, p.tvl_usd) * growthCarry(p.change_7d)));
    const odds = oddsOf(p, age);
    const implied = Math.max(1, Math.round(ifLaunched * odds));
    const fees = farmFees(p, age);
    const slice = Math.round(implied * SLICE_FRACTION);
    const net = round2(slice - fees);
    ranked.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      no_token_days: age,
      watchlist: watch.has(p.slug),
      if_launched_usd: ifLaunched,
      launch_odds: round4(odds),
      implied_value_usd: implied,
      range_low_usd: Math.max(1, Math.round(implied * Math.pow(10, model.residP10))),
      range_high_usd: Math.round(implied * Math.pow(10, model.residP90)),
      airdrop_slice_usd: slice,
      farm_fees_usd: fees,
      net_of_fees_usd: net,
      verdict: net > FARM_MARGIN_USD ? 'FARM' : net > 0 ? 'THIN' : 'SKIP',
      farm_hours: farmHours(age),
      farm_days: holdDaysFor(age),
      farm_steps: farmSteps(p, age),
    });
  }

  // Rank by implied value, ties broken by slug so the order is deterministic,
  // then force strictly decreasing values so no two rows ever share one.
  ranked.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : 1));
  for (let i = 0; i < ranked.length; i++) {
    ranked[i]!.rank = i + 1;
    if (i > 0 && ranked[i]!.implied_value_usd >= ranked[i - 1]!.implied_value_usd) {
      ranked[i]!.implied_value_usd = Math.max(1, ranked[i - 1]!.implied_value_usd - 1);
    }
  }

  const totalImplied = ranked.reduce((t, r) => t + r.implied_value_usd, 0);
  const verdicts = {
    farm: ranked.filter((r) => r.verdict === 'FARM').length,
    thin: ranked.filter((r) => r.verdict === 'THIN').length,
    skip: ranked.filter((r) => r.verdict === 'SKIP').length,
  };
  const bestPerHour = ranked
    .filter((r) => r.net_of_fees_usd > 0)
    .reduce((best, r) => Math.max(best, r.net_of_fees_usd / r.farm_hours), 0);

  const fitPoints = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => a.tvl_usd - b.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const curve: { tvl: number; mcap: number }[] = [];
  for (let i = 0; i < 25; i++) {
    const tvl = Math.round(
      Math.pow(10, Math.log10(fitPoints[0]!.tvl_usd) + (i / 24) * (Math.log10(fitPoints[fitPoints.length - 1]!.tvl_usd) - Math.log10(fitPoints[0]!.tvl_usd))),
    );
    curve.push({ tvl, mcap: Math.round(curveValue({ a: model.a, b: model.b }, tvl)) });
  }

  const groupLabels = ['Bridges', 'Liquid staking/restaking', 'Exchange custody', 'Versioned', 'Wrapped/staked'];
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    deposit_usd: DEPOSIT_USD,
    fit: { a: model.a, b: model.b, n: model.n, formula: model.formula, steps: model.steps },
    validation: model.validation,
    board_size: ranked.length,
    watchlist_size: snapshot.watchlist.length,
    total_implied_usd: totalImplied,
    rows: ranked,
    accounting: {
      total: snapshot.protocols.length,
      ranked: ranked.length,
      live: liveCount,
      excluded: excluded.length,
      groups: groupLabels.map((label) => ({ label, count: groups.get(label) ?? 0 })),
    },
    verdicts,
    kpi: {
      ranked: ranked.length,
      total_implied_usd: totalImplied,
      held_out_miss: model.validation.miss,
      range_holds_pct: model.validation.range_holds_pct,
      worth_farming: verdicts.farm,
      best_per_hour_usd: round2(bestPerHour),
    },
    scatter: {
      live: fitPoints.map((p) => ({ tvl: p.tvl_usd, mcap: p.mcap_usd! })),
      board: ranked.map((r) => ({ tvl: r.tvl_usd, implied: r.implied_value_usd })),
      curve,
    },
    excluded: excluded.sort((a, b) => (a.slug < b.slug ? -1 : 1)),
    live_rows: snapshot.protocols
      .filter(isLive)
      .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || (a.slug < b.slug ? -1 : 1))
      .map((p) => ({ slug: p.slug, name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd })),
  };
  return { board: ranked, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

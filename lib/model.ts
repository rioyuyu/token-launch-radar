// The token radar's value model: one sealed snapshot in, one ranked board out.
//
// The board ranks EVERY rankable pre-token protocol in the snapshot (the
// watchlist is the floor, never the ceiling): a protocol is rankable when its
// record carries no token at all (no market cap, no CoinGecko id, no symbol),
// it is not a wrapped, staked or bridged product of a token that already
// trades (by category, by a whole word in its name, or by an exchange prefix),
// and its name does not end in a version marker. Pre-token protocols that
// fail that rule are listed in `excluded` with a reason, and live-token
// protocols are kept apart and shown with the market's own values, never
// mixed into the ranked board, so all 758 protocols are accounted for.
//
// Implied value is FITTED from the snapshot's own live-token protocols, not
// a hardcoded constant:
//
//   fitted multiple = median(mcap_usd / tvl_usd) per category, over the
//                     live-token protocols with a positive market cap
//                     (a $0 market cap is no market value); categories with
//                     fewer than 5 live samples fall back to the global
//                     median over the same set
//   base          = tvl_usd x fitted multiple
//   growthMult    = 1 + clamp(change_7d, -60, 120) / 100 x 0.5   (null -> 0)
//   maturityMult  = 0.6 + min(age_days, 1095) / 1095 x 0.4       (age null -> 365)
//   implied       = max(1, round(base x growthMult x maturityMult))
//
// The fit is validated walk-forward: the live-token protocols with a listing
// date are split by listed_at (older half trains the multiples, newer half
// tests them), each test protocol's market cap is predicted from its TVL x
// fitted multiple, and the median absolute percentage error plus the count
// within 2x are reported in `validation`. No protocol name is ever
// special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The base multiple is not one of them: it is fitted (see `fitMultiples`). */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  min_category_samples: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  min_category_samples: 5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  watchlist: boolean;
  is_watchlist: boolean;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One fitted multiple: the category's median mcap/TVL and how many live protocols fitted it. */
export interface FittedCategory {
  multiple: number;
  n: number;
}

/** The fitted value model, derived from the snapshot's own live-token protocols. */
export interface Fit {
  method: string;
  global_multiple: number;
  by_category: Record<string, FittedCategory>;
  n_live_fitted: number;
}

  /** The walk-forward check of the fitted model on newer live-token protocols. `median_abs_pct_error` is in percent (87.4 means the typical prediction is 87.4% off the actual market cap). */
export interface Validation {
  method: string;
  n_train: number;
  n_test: number;
  median_abs_pct_error: number;
  within_2x: number;
}

/** A pre-token protocol the board does not rank, and why. */
export interface ExcludedRow {
  slug: string;
  name: string;
  reason: string;
}

/** Everything the dashboard needs: the board, the live set, the fit, its validation, and the excluded set. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  live_total: number;
  fit: Fit;
  validation: Validation;
  excluded: { count: number; items: ExcludedRow[] };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list (the mean of the two middle values when even); NaN when empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol can fit a multiple: it trades, with a positive market cap and TVL. A $0 market cap is no market value. */
export function isFittable(p: SnapshotProtocol): boolean {
  return !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/**
 * Fit the value model from the snapshot's own live-token protocols: the
 * median mcap/TVL per category (categories with fewer than
 * `min_category_samples` live samples have no entry and fall back to the
 * global median), and the global median over the same set.
 */
export function fitMultiples(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Fit {
  const fittable = protocols.filter(isFittable);
  const global = median(fittable.map((p) => p.mcap_usd! / p.tvl_usd));
  const byCategoryRaw = new Map<string, number[]>();
  for (const p of fittable) {
    if (p.category === null) continue;
    const list = byCategoryRaw.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategoryRaw.set(p.category, list);
  }
  const by_category: Record<string, FittedCategory> = {};
  for (const category of [...byCategoryRaw.keys()].sort()) {
    const list = byCategoryRaw.get(category)!;
    if (list.length >= model.min_category_samples) {
      by_category[category] = { multiple: round4(median(list)), n: list.length };
    }
  }
  return {
    method: `median mcap/TVL per category over live-token protocols with a positive market cap (n>=${model.min_category_samples} per category, else the global median)`,
    global_multiple: round4(global),
    by_category,
    n_live_fitted: fittable.length,
  };
}

/** The fitted multiple one protocol gets: its category's median, else the global median. */
export function fittedMultipleFor(category: string | null, fit: Fit): number {
  if (category !== null && fit.by_category[category] !== undefined) return fit.by_category[category]!.multiple;
  return fit.global_multiple;
}

/** The multipliers and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: Fit,
  model: ModelConstants = MODEL,
): { implied: number; fittedMultiple: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const fittedMultiple = fittedMultipleFor(protocol.category, fit);
  const base = protocol.tvl_usd * fittedMultiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, fittedMultiple, growthPct, growthMult, maturityMult, age };
}

/**
 * Walk-forward validation: the fittable protocols with a listing date,
 * split by listed_at (older half trains the multiples, newer half tests
 * them). Each test protocol's market cap is predicted from its TVL x the
 * train-fitted multiple; the report is the median absolute percentage error
 * and how many predictions land within 2x of the actual market cap (half to
 * twice). Protocols with no listing date take no part: their age is unknown,
 * so no split can place them.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const dated = snapshot.protocols
    .filter((p) => isFittable(p) && p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : 1));
  const half = Math.floor(dated.length / 2);
  const train = dated.slice(0, half);
  const test = dated.slice(half);
  const trainFit = fitMultiples(train, model);
  const errors = test.map((p) => {
    const predicted = p.tvl_usd * fittedMultipleFor(p.category, trainFit);
    return Math.abs(predicted - p.mcap_usd!) / p.mcap_usd!;
  });
  const within2x = test.filter((p) => {
    const predicted = p.tvl_usd * fittedMultipleFor(p.category, trainFit);
    return predicted >= 0.5 * p.mcap_usd! && predicted <= 2 * p.mcap_usd!;
  }).length;
  return {
    method: 'walk-forward: older half of dated live-token protocols trains the multiples, newer half is predicted from TVL x fitted multiple',
    n_train: train.length,
    n_test: test.length,
    median_abs_pct_error: round4(median(errors) * 100),
    within_2x: within2x,
  };
}

/**
 * DefiLlama's version-marker rule, extended to hyphen and underscore
 * separators: a name ending in a release (V2, v2, 2.0, and the like) is a
 * versioned pool of another protocol, not a launch of its own.
 */
const VERSIONED = /[\s\-_](V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The watchlist rule's wrapped/staked/bridged limbs (input/README.md): a
 * wrapped or staked product of a token that already trades is not a token
 * that does not exist yet. A protocol is excluded when its category is a
 * bridge, a liquid staking/restaking product or an exchange, when its name
 * carries a whole word `wrapped`, `staked` or `staking`, or when its name
 * begins with an exchange's name. The rule's `parentProtocol` limb is
 * inapplicable here: the snapshot carries no such field.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, not a wrapped,
 * staked or bridged product of a token that already trades, not an exchange,
 * and not a versioned pool.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/** Why a pre-token protocol is not rankable: the first exclusion rule it trips, in the watchlist rule's own order. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return null;
  if (p.category === 'CEX') return 'CEX: an exchange, not a farmable protocol launch';
  if (p.category === 'Bridge' || p.category === 'Canonical Bridge') return 'bridge: a bridged product of a token that already trades';
  if (p.category === 'Liquid Staking' || p.category === 'Liquid Restaking' || p.category === 'Restaked BTC') {
    return 'liquid staking/restaking: a staked product of a token that already trades';
  }
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked product: its name marks it as a wrapped or staked product of a token that already trades';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange product: its name begins with an exchange name';
  if (VERSIONED.test(p.name)) return 'versioned pool: its name ends in a version marker, so it is a pool of another protocol';
  return null;
}

/** Every pre-token protocol the board does not rank, with its reason. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .map((p) => ({ slug: p.slug, name: p.name, reason: exclusionReason(p) ?? 'not rankable' }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, fit?: Fit): BoardRow[] {
  const fitted = fit ?? fitMultiples(snapshot.protocols, model);
  const scored = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => {
      const { implied, fittedMultiple, growthPct, growthMult, maturityMult, age } = impliedValue(p, snapshot.as_of, fitted, model);
      return { p, implied, fittedMultiple, growthPct, growthMult, maturityMult, age };
    });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      fitted_multiple: s.fittedMultiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The second chain a protocol names, or null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** The TVL tier's label, for steps that vary by size. */
function tvlTier(p: SnapshotProtocol): 'large' | 'mid' | 'small' {
  if (p.tvl_usd >= 1_000_000_000) return 'large';
  if (p.tvl_usd >= 100_000_000) return 'mid';
  return 'small';
}

/** The age band's label, for steps that vary by how long the protocol has run. */
function ageBand(age: number | null): 'young' | 'mid' | 'old' | 'unknown' {
  if (age === null) return 'unknown';
  if (age < 180) return 'young';
  if (age < 365) return 'mid';
  return 'old';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly rhythm, varied by category and by how long the protocol has run. */
function weeklyActionFor(p: SnapshotProtocol, age: number | null): string {
  const band = ageBand(age);
  const c = (p.category ?? '').toLowerCase();
  if (band === 'young') {
    return `Try the protocol's newest feature each week, such as a new pool, market or vault, and keep a note of what you used.`;
  }
  if (band === 'old') {
    if (c.includes('lend') || c.includes('dex') || c.includes('yield') || c.includes('curator') || c.includes('allocator')) {
      return `Each week, vote in governance when a proposal is live, or rebalance the position if the pool's rewards shift.`;
    }
    return `Each week, check the protocol's announcements for a points update and make one qualifying action.`;
  }
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/** The second position, varied by TVL tier and by whether the protocol runs on more than one chain. */
function secondPositionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const second = secondChainOf(p);
  if (second !== null) {
    return `Open a second, smaller position of $${Math.max(25, Math.round(capital / 2))} on ${second} through ${p.name}, so the farm covers two chains instead of one.`;
  }
  if (tvlTier(p) === 'large') {
    return `Split the position across a second wallet with $${Math.max(25, Math.round(capital / 2))}, so one wallet's history is never the whole farm.`;
  }
  if (tvlTier(p) === 'mid') {
    return `Add a second, smaller position of $${Math.max(25, Math.round(capital / 2))} in the protocol's other main pool on ${chain}.`;
  }
  return `Keep the single position open and add $${Math.max(25, Math.round(capital / 2))} to it after the first month, rather than opening a new one.`;
}

/** The claim step, varied by how long the protocol has run. */
function claimStepFor(p: SnapshotProtocol, age: number | null): string {
  const band = ageBand(age);
  if (band === 'young' || band === 'unknown') {
    return `Join the protocol's own community channel and watch for its points page; claim only from the link the protocol itself publishes.`;
  }
  return `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`;
}

/** The wallet setup step, varied by chain: Ethereum gas bites, other chains usually do not. */
function walletStepFor(p: SnapshotProtocol): FarmStep {
  const chain = chainOf(p);
  if (chain === 'Ethereum') {
    return {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Gas on Ethereum runs higher than on most other chains, so expect a few dollars per transaction and avoid busy hours.`,
      cost: 'under $5 of gas for the first transaction',
      time: '5 minutes',
    };
  }
  if (chain === 'Solana') {
    return {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with a little SOL for fees first, since every Solana transaction needs it.`,
      cost: 'under $1 of SOL for fees, plus the funds you plan to farm',
      time: '5 minutes',
    };
  }
  return {
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Gas on ${chain} is usually low, often under a dollar per transaction.`,
    cost: 'under $3 of gas for the first transaction',
    time: '5 minutes',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names: the wallet step varies by
 * chain, the main action by category, the weekly rhythm and the claim step by
 * age band, and the second position by TVL tier and by a second chain, so
 * protocols with different records get different plans.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  return [
    walletStepFor(p),
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyActionFor(p, age),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: secondPositionFor(p, capital, chain),
      cost: `about $${Math.max(25, Math.round(capital / 2))} of extra capital and a few dollars of gas`,
      time: '15 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: claimStepFor(p, age),
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view.
 *  Exchanges are excluded (Ruling 5), matching the starter and `isRankable`'s
 *  own CEX exclusion: the live view shows protocols whose token trades. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    )
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. `watchlist` / `is_watchlist` mark membership in the snapshot's watchlist, so the dashboard's toggles can select exactly those 40 slugs (Ruling 6). */
export function radarRow(row: BoardRow, watchlist: boolean): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    watchlist,
    is_watchlist: watchlist,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_multiple: row.model.fitted_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const fit = fitMultiples(snapshot.protocols, model);
  const validation = validateModel(snapshot, model);
  const board = buildBoard(snapshot, model, fit);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    live_total: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    fit,
    validation,
    excluded: { count: excluded.length, items: excluded },
    rows: board.map((r) => radarRow(r, watchlist.has(r.slug))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string' || s.trim().length === 0)) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const seenSlugs = new Set<string>();
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || p.slug.trim().length === 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a non-empty slug`);
    }
    if (typeof p.name !== 'string' || p.name.trim().length === 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a non-empty name`);
    }
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd) || p.tvl_usd <= 0) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a positive TVL`);
    }
    if (p.category !== null && typeof p.category !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a category that is neither a string nor null`);
    }
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string')) {
      throw new SnapshotError(`snapshot.json's protocol ${i} has chains that are not all strings`);
    }
    if (p.change_7d !== null && (typeof p.change_7d !== 'number' || !Number.isFinite(p.change_7d))) {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a change_7d that is neither a finite number nor null`);
    }
    if (p.mcap_usd !== null && (typeof p.mcap_usd !== 'number' || !Number.isFinite(p.mcap_usd))) {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a mcap_usd that is neither a finite number nor null`);
    }
    if (
      p.listed_at !== null &&
      (typeof p.listed_at !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.listed_at) ||
        !Number.isFinite(Date.parse(`${p.listed_at}T00:00:00Z`)))
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a listed_at that is neither a YYYY-MM-DD date nor null`);
    }
    if (p.gecko_id !== null && typeof p.gecko_id !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a gecko_id that is neither a string nor null`);
    }
    if (p.symbol !== null && typeof p.symbol !== 'string') {
      throw new SnapshotError(`snapshot.json's protocol ${i} has a symbol that is neither a string nor null`);
    }
    if (seenSlugs.has(p.slug)) {
      throw new SnapshotError(`snapshot.json repeats the slug ${p.slug}`);
    }
    seenSlugs.add(p.slug);
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains as string[],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
    };
  });
  const watchlist = o.watchlist as string[];
  const missingWatchlist = watchlist.filter((s) => !seenSlugs.has(s));
  if (missingWatchlist.length > 0) {
    throw new SnapshotError(
      `snapshot.json's watchlist names ${missingWatchlist.length} slug${missingWatchlist.length === 1 ? '' : 's'} with no protocol: ${missingWatchlist.slice(0, 5).join(', ')}`,
    );
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist,
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, slug membership, names, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `the board has ${board.length} rows, outside the gate's 100..4000`;
  }
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const protocolSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.find((r) => !protocolSlugs.has(r.slug));
  if (invented !== undefined) return `${invented.slug} is not one of the snapshot's protocols`;
  const unnamed = board.find((r) => typeof r.name !== 'string' || r.name.trim().length === 0);
  if (unnamed !== undefined) return `${unnamed.slug} has an empty name`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.trim().length < 20 || s.trim().length > 600) {
        return `${r.slug} has a farm step of ${s.trim().length} characters`;
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

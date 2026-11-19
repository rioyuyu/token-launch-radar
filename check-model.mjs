// TDD test for Task 1 (committed LOCALLY per Ruling 4, never pushed to GitHub).
// Loads the sealed snapshot, imports the model, and asserts the brief's
// Step 1 checks. Run: node --experimental-strip-types check-model.mjs
import { readFileSync } from 'node:fs';
import { buildRadar, boardIssue, dataScript, isRankable, parseSnapshot } from './lib/model.ts';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const snapshot = parseSnapshot(readFileSync('snapshot.json', 'utf8'));
const { board, radar } = buildRadar(snapshot);

check('board length is 198', board.length === 198, `got ${board.length}`);

const boardSlugs = new Set(board.map((r) => r.slug));
const missingWatchlist = snapshot.watchlist.filter((s) => !boardSlugs.has(s));
check('all 40 watchlist slugs present', snapshot.watchlist.length === 40 && missingWatchlist.length === 0,
  `watchlist=${snapshot.watchlist.length} missing=${missingWatchlist.join(',') || 'none'}`);

const ranksOk = board.every((r, i) => r.rank === i + 1);
check('ranks exactly 1..N in row order', ranksOk);

let nonIncreasing = true;
for (let i = 1; i < board.length; i++) {
  if (board[i].implied_value_usd > board[i - 1].implied_value_usd) nonIncreasing = false;
}
check('implied values non-increasing with rank', nonIncreasing);
check('implied values not all equal', board[0].implied_value_usd !== board[board.length - 1].implied_value_usd,
  `top=${board[0].implied_value_usd} bottom=${board[board.length - 1].implied_value_usd}`);

let stepsOk = true;
let badStep = '';
for (const r of board) {
  if (r.farm_steps.length !== 7) { stepsOk = false; badStep = `${r.slug}: ${r.farm_steps.length} steps`; break; }
  for (const s of r.farm_steps) {
    const t = s.trim();
    if (t.length < 20 || t.length > 600) { stepsOk = false; badStep = `${r.slug}: step ${t.length} chars`; break; }
  }
  if (!stepsOk) break;
}
check('every farm step 20-600 chars (7 steps per row)', stepsOk, badStep);

// Farm plans must vary by category, chain, TVL tier and age: dozens of distinct plan shapes, not one template.
const distinctPlans = new Set(board.map((r) => JSON.stringify(r.farm_steps))).size;
check('at least 20 distinct farm plan shapes', distinctPlans >= 20, `${distinctPlans} distinct plans`);

check('aave-v3 NOT on the board', !boardSlugs.has('aave-v3'));
check('layerzero-v2 NOT on the board', !boardSlugs.has('layerzero-v2'));
check('wbtc NOT on the board (wrapped product)', !boardSlugs.has('wbtc'));
check('binance-staked-eth NOT on the board (staked product)', !boardSlugs.has('binance-staked-eth'));
check('coinbase-bridge NOT on the board (bridged product)', !boardSlugs.has('coinbase-bridge'));

// Top-50 must differ from a pure-TVL top-50 in at least 10 positions:
// the model must reorder, not just re-label TVL. The comparison set is the
// same rankable set the board ranks, via the model's own isRankable.
const rankable = snapshot.protocols.filter(isRankable);
const tvlTop50 = [...rankable].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)).slice(0, 50).map((p) => p.slug);
const modelTop50 = board.slice(0, 50).map((r) => r.slug);
const differing = modelTop50.filter((s, i) => s !== tvlTop50[i]).length;
check('top-50 differs from pure-TVL top-50 in >= 10 positions', differing >= 10, `${differing} positions differ`);

check('boardIssue(board, snapshot) === null', boardIssue(board, snapshot) === null, String(boardIssue(board, snapshot)));

const top = board[0].implied_value_usd;
check('top implied value between $100M and $5B', top >= 100_000_000 && top <= 5_000_000_000, `top=$${top}`);
check('top row is steakhouse-financial at $464,917,576',
  board[0].slug === 'steakhouse-financial' && top === 464_917_576,
  `top=${board[0].slug} $${top}`);

// Extra sanity: live view is 24 rows, CEX-free, disjoint from the board, and data.js parses.
check('live view has 24 rows', radar.live.length === 24, `got ${radar.live.length}`);
check('live view has no CEX protocols', radar.live.every((r) => r.category !== 'CEX'));
const liveSlugs = new Set(radar.live.map((r) => r.slug));
check('live rows are not on the board', [...liveSlugs].every((s) => !boardSlugs.has(s)));
check('radar row count matches board', radar.rows.length === board.length && radar.board_size === board.length);
const script = dataScript(radar);
check('data.js starts with window.RADAR=', script.startsWith('window.RADAR='));
const parsed = JSON.parse(script.slice('window.RADAR='.length).replace(/;\n$/, ''));
check('data.js JSON parses with 198 rows', parsed.rows.length === 198);

// Ruling 6: per-row watchlist flag for the dashboard toggles — the flags must
// match the snapshot watchlist exactly: 40 true, 158 false, same slug set.
check('every data.js row carries a boolean watchlist flag',
  parsed.rows.every((r) => typeof r.watchlist === 'boolean'));
const flagged = parsed.rows.filter((r) => r.watchlist === true);
const flaggedSlugs = new Set(flagged.map((r) => r.slug));
check('data.js flags exactly 40 watchlist rows', flagged.length === 40, `got ${flagged.length}`);
check('data.js watchlist flags match the snapshot watchlist set',
  flagged.length === snapshot.watchlist.length && snapshot.watchlist.every((s) => flaggedSlugs.has(s)),
  `flagged=${[...flaggedSlugs].sort().slice(0, 3).join(',')}…`);
check('data.js flags 158 rows false',
  parsed.rows.filter((r) => r.watchlist === false).length === 158,
  `got ${parsed.rows.filter((r) => r.watchlist === false).length}`);

// radar-3: the fitted model, its walk-forward validation, the excluded set, and per-row fitted multiples.
check('fit is derived from 128 live protocols with a positive market cap',
  parsed.fit.n_live_fitted === 128, `got ${parsed.fit.n_live_fitted}`);
check('fit global multiple is 0.2138', parsed.fit.global_multiple === 0.2138, `got ${parsed.fit.global_multiple}`);
check('fit has 9 fitted categories', Object.keys(parsed.fit.by_category).length === 9,
  `got ${Object.keys(parsed.fit.by_category).length}`);
for (const [cat, multiple] of [['Lending', 0.1324], ['Dexs', 0.3424], ['Canonical Bridge', 0.7464], ['Bridge', 0.5567], ['RWA', 0.2748]]) {
  check(`fit ${cat} multiple is ${multiple}`, parsed.fit.by_category[cat]?.multiple === multiple,
    `got ${parsed.fit.by_category[cat]?.multiple}`);
}
check('validation is walk-forward on 47 train / 48 test',
  parsed.validation.n_train === 47 && parsed.validation.n_test === 48,
  `got ${parsed.validation.n_train}/${parsed.validation.n_test}`);
check('validation median abs pct error is 87.3578', parsed.validation.median_abs_pct_error === 87.3578,
  `got ${parsed.validation.median_abs_pct_error}`);
check('validation within-2x is 11 of 48', parsed.validation.within_2x === 11,
  `got ${parsed.validation.within_2x}`);
check('excluded lists 144 pre-token protocols', parsed.excluded.count === 144 && parsed.excluded.items.length === 144,
  `got ${parsed.excluded.count}`);
check('all 758 protocols are accounted for (board + excluded + live)',
  parsed.board_size + parsed.excluded.count + parsed.live_total === 758,
  `${parsed.board_size}+${parsed.excluded.count}+${parsed.live_total}`);
check('every excluded item has a reason', parsed.excluded.items.every((e) => typeof e.reason === 'string' && e.reason.length > 10));
check('every data.js row carries a fitted_multiple and is_watchlist',
  parsed.rows.every((r) => typeof r.fitted_multiple === 'number' && r.fitted_multiple > 0 && typeof r.is_watchlist === 'boolean'));
check('is_watchlist matches watchlist on every row',
  parsed.rows.every((r) => r.is_watchlist === r.watchlist));
check('fitted_multiple matches the board row model',
  board.every((r, i) => parsed.rows[i].fitted_multiple === r.model.fitted_multiple));

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks PASSED');

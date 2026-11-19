// TDD test for Task 2 (dashboard). Run from the repo root: node check-dashboard.mjs
// Reads dashboard/index.html, dashboard/app.css, dashboard/app.js and asserts
// the brief's Step 1 checks: byte cap, no URL strings, structure, named functions.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = ['dashboard/index.html', 'dashboard/app.css', 'dashboard/app.js'];
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

const missing = files.filter((f) => !existsSync(f));
check('all three dashboard files exist', missing.length === 0, missing.join(', ') || 'all present');
if (missing.length > 0) {
  console.log(`\n${failures.length} check(s) FAILED (files missing — expected before implementation)`);
  process.exit(1);
}

const contents = Object.fromEntries(files.map((f) => [f, readFileSync(f, 'utf8')]));
const totalBytes = files.reduce((n, f) => n + statSync(f).size, 0);
check('total of the three files is at most 60,000 bytes', totalBytes <= 60000, `${totalBytes} bytes`);

for (const f of files) {
  check(`${f} has no http:// or https:// string`,
    !contents[f].includes('http://') && !contents[f].includes('https://'));
}

const html = contents['dashboard/index.html'];
check('index.html loads data.js', html.includes('data.js'), 'needs a data.js script reference');
check('index.html has a board table', html.includes('<table'), 'needs a <table>');
check('index.html has a detail container id', html.includes('id="detail"'), 'needs id="detail"');
check('index.html has a live section labelled Already trading',
  html.includes('Already trading'), 'live view must be labelled "Already trading"');
check('index.html has search, chain and category controls',
  html.includes('id="search"') && html.includes('id="chain"') && html.includes('id="category"'));
check('index.html has watchlist-only and early-only toggles',
  html.includes('id="watchlist-only"') && html.includes('id="early-only"'));
// I-2 (Ruling 6): "Early" is watchlist membership, not the TVL floor — 20 of
// the 158 early rows are at or above the $50M floor, so no "below the floor"
// wording may describe the early count (or the watchlist) anywhere in the page.
const htmlLower = html.toLowerCase();
check('index.html has no "below the floor" wording',
  !htmlLower.includes('below the floor') && !htmlLower.includes('below floor'),
  'early rows are membership-based, not floor-based (Ruling 6)');
check('index.html early fact names the watchlist, not the floor',
  html.includes('Early rows (not on the watchlist)'),
  'needs the corrected "Early rows (not on the watchlist)" label');
check('index.html has no watchlist-is-the-floor wording',
  !htmlLower.includes('watchlist is the floor'),
  'the watchlist is not the floor (Ruling 6)');

const js = contents['dashboard/app.js'];
for (const name of ['sortRows', 'filterRows', 'renderDetail', 'renderBoard', 'renderLive', 'farmSteps']) {
  check(`app.js defines ${name}`, new RegExp(`function ${name}\\b`).test(js), `needs function ${name}`);
}
check('app.js reads window.RADAR', js.includes('window.RADAR'));
check('filterRows uses the per-row watchlist flag for Watchlist-only',
  js.includes('r.watchlist !== true'));
check('filterRows uses the per-row watchlist flag for Early-only',
  js.includes('r.watchlist !== false'));
check('floor-based toggle logic is gone (no TVL-vs-floor toggle test)',
  !js.includes('r.tvl_usd < floor') && !js.includes('r.tvl_usd >= floor'));
check('app.js no longer claims data.js carries no watchlist membership',
  !js.includes('carries no watchlist membership'));
check('app.js makes no network calls', !js.includes('fetch(') && !js.includes('XMLHttpRequest'),
  'no fetch/XHR: the page must work from local files');

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks PASSED');

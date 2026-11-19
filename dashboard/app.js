// Launch Radar dashboard. Reads window.RADAR from data.js beside the page and
// renders the board, model audit, scatter, filters and detail views. No network,
// no fetch: every value shown comes from data.js or is derived from a row's figures.
(function () {
  'use strict';
  var R = window.RADAR || {};
  var rows = (R.rows || []).slice().sort(function (a, b) { return a.rank - b.rank; });
  var boardJsonText = JSON.stringify({ rows: rows }) + '\n';
  var excluded = Array.isArray(R.excluded) ? R.excluded : [];
  var liveRows = R.live_rows || [];
  var $ = function (id) { return document.getElementById(id); };
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  var nf = new Intl.NumberFormat('en-US');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function c1(n) { var s = n >= 100 ? n.toFixed(0) : n.toFixed(1); return s.replace(/\.0$/, ''); }
  function money(v) { if (v == null || !isFinite(v)) return '—'; var a = Math.abs(v), u = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]; for (var i = 0; i < u.length; i++) if (a >= u[i][0]) return '$' + c1(v / u[i][0]) + u[i][1]; return '$' + Math.round(v); }
  function full(v) { return v == null || !isFinite(v) ? '—' : '$' + nf.format(Math.round(v)); }
  function pct(v) { return v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function mult(v) { return v == null || !isFinite(v) ? '—' : '×' + v.toFixed(2); }
  function days(v) { return v == null ? '—' : nf.format(v) + 'd'; }
  function round2(n) { return Math.round(n * 100) / 100; }
  function ageFmt(v) { if (v == null) return '—'; return v >= 365 ? (v / 365).toFixed(1) + 'y' : nf.format(v) + 'd'; }

  // Per-row accessors; band label, median wait, growth carry, signed $.
  function age(r) { return r.no_token_days; }
  function odds(r) { return r.launch_odds; }
  function ifL(r) { return r.if_launched_usd; }
  function lo(r) { return r.range_low_usd; }
  function hi(r) { return r.range_high_usd; }
  function fees(r) { return r.farm_fees_usd; }
  function isWl(r) { return !!r.watchlist; }
  function hours(r) { return r.farm_hours; }
  function fd(r) { return r.farm_days; }
  function totalImplied() { return R.total_implied_usd != null ? R.total_implied_usd : rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0); }
  function bandLabel(a) { return a == null ? 'unknown age' : a < 180 ? 'under 6 months' : a < 365 ? '6–12 months' : a < 730 ? '1–2 years' : a < 1095 ? '2–3 years' : 'over 3 years'; }
  function waitY(p) { var q = Math.min(0.95, Math.max(0.01, p)); return Math.log(2) / (-Math.log(1 - q) / 2); }
  function waitTxt(y) { return y < 1 ? '~' + Math.max(1, Math.round(y * 12)) + ' months' : '~' + y.toFixed(1) + ' years'; }
  function carryOf(r) { var g = r.change_7d == null ? 0 : Math.min(100, Math.max(-50, r.change_7d)); return 1 + 0.5 * g / 100; }
  function signed(n) { return (n >= 0 ? '+' : '−') + '$' + nf.format(Math.round(Math.abs(n))); }

  // ---- What-if: deposit and drop share ------------------------------------
  // The board's slice is implied x drop share x deposit / $5.0M of farmed
  // deposits. Fees are gas only, so they do not move with the deposit.
  // Default $1,000 / 5% reproduces the board's own slice, net and verdicts.
  var FARM_MARGIN = 25;
  var FARMED_DEPOSITS = 5000000;
  var state = { q: '', seg: 'ALL', v: 'ALL', cat: 'all', chain: 'all', sortKey: 'rank', dir: 1, deposit: 1000, drop: 5, hideSummary: false };
  function sliceFor(r) { return Math.round(r.implied_value_usd * (state.drop / 100) * state.deposit / FARMED_DEPOSITS); }
  function netFor(r) { return round2(sliceFor(r) - (fees(r) || 0)); }
  function verdictFor(r) { var n = netFor(r); return n > FARM_MARGIN ? 'FARM' : n > 0 ? 'THIN' : 'SKIP'; }
  function perHourFor(r) { return hours(r) ? netFor(r) / hours(r) : null; }
  function paysFromFor(r) {
    if (!fees(r) || !r.implied_value_usd || !state.drop) return null;
    return Math.round(fees(r) * FARMED_DEPOSITS * 100 / (r.implied_value_usd * state.drop));
  }

  // ---- Rank range ----------------------------------------------------------
  // The ranks a row could take if its value sat at either end of its printed
  // range, holding every other row at its point value.
  (function rankRanges() {
    var imp = rows.map(function (r) { return r.implied_value_usd; });
    rows.forEach(function (r, i) {
      var best = 1, worst = 1;
      for (var j = 0; j < rows.length; j++) {
        if (j === i) continue;
        if (imp[j] > hi(r)) best++;
        if (imp[j] > lo(r)) worst++;
      }
      r._rlo = best;
      r._rhi = worst;
    });
  })();
  var marketChg = R.market_change_7d != null ? R.market_change_7d : null;
  function vsMarket(r) { return r.change_7d == null || marketChg == null ? null : r.change_7d - marketChg; }

  if (!rows.length) { $('verify').textContent = 'No board data loaded — data.js is missing or empty.'; $('verify').className = 'verify bad'; return; }

  // ---- Header + KPIs -------------------------------------------------------
  var acct = R.accounting || null;
  var totalProtocols = acct ? acct.total : (rows.length + (R.live_total || liveRows.length) + excluded.length);
  var wlCount = rows.filter(isWl).length;
  var floor = R.floor_usd != null ? R.floor_usd : 0;
  var segCounts = { ALL: rows.length, WL: 0, OFF: 0, BELOW: 0 };
  rows.forEach(function (r) { if (isWl(r)) segCounts.WL++; else if (r.tvl_usd >= floor) segCounts.OFF++; else segCounts.BELOW++; });
  $('h-date').textContent = R.as_of || '—';
  $('h-cover').textContent = nf.format(totalProtocols) + ' protocols read · ' + wlCount + '/' + (R.watchlist_size || wlCount) + ' watchlist';
  $('h-model').textContent = R.model_version || '—';
  var kpi = R.kpi || {};
  var val = R.validation || {};
  var fit = R.fit || {};
  var miss = kpi.held_out_miss != null ? kpi.held_out_miss : (val.miss != null ? val.miss : null);
  var holds = kpi.range_holds_pct != null ? kpi.range_holds_pct : val.range_holds_pct;
  $('k-ranked').textContent = nf.format(kpi.ranked != null ? kpi.ranked : rows.length);
  $('k-ranked-s').textContent = 'record no token · ' + wlCount + ' of ' + (R.watchlist_size || wlCount) + ' watchlist, ' + segCounts.OFF + ' off list, ' + segCounts.BELOW + ' below the ' + money(floor) + ' floor';
  $('k-implied').textContent = money(totalImplied());
  $('k-implied').title = full(totalImplied());
  $('k-implied-s').textContent = 'summed over the board · rank 1 ' + rows[0].name + ' ' + money(rows[0].implied_value_usd);
  $('k-miss').textContent = mult(miss);
  var steps = fit.steps || [];
  $('k-miss-s').textContent = 'flat TVL multiple ' + mult(steps.length ? steps[0].miss : null) + ' · ' + (val.n_test != null ? val.n_test + ' newer tokens priced from a fit on the older ' + val.n_train : 'held-out, median');
  $('k-holds').textContent = holds != null ? holds + '%' : '—';
  $('k-holds-s').textContent = 'of held-out caps inside the printed P25–P75 range · ' + (holds != null ? holds + '%' : '—') + ' inside P10–P90';
  var oddsAcc = val.odds_accuracy_pct;
  $('k-odds').textContent = oddsAcc != null ? oddsAcc + '%' : '—';
  $('k-odds-s').textContent = val.odds_correct != null
    ? 'called right, ' + val.odds_correct + ' of ' + val.odds_total + ' protocols each predicted from the rest · base rate alone ' + val.odds_base_pct + '%'
    : 'share of look-alikes that already record a token';
  $('k-farm').textContent = nf.format(kpi.worth_farming != null ? kpi.worth_farming : rows.filter(function (r) { return r.verdict === 'FARM'; }).length);

  // ---- Accounting bar ----------------------------
  var groups = acct && acct.groups ? acct.groups : null;
  if (!groups) { // fallback: group the excluded rows by their reason head
    var g = {}; excluded.forEach(function (e) { var k = String(e.reason || 'other').split(':')[0]; g[k] = (g[k] || 0) + 1; });
    groups = Object.keys(g).sort().map(function (k) { return { label: k, count: g[k] }; });
  }
  var segs = [{ label: 'Ranked', count: acct ? acct.ranked : rows.length, color: '#5aa9ff' }];
  var liveN = acct ? acct.live : (R.live_total || 0);
  if (liveN && !groups.some(function (g2) { return /live|already/i.test(g2.label); })) segs.push({ label: 'Already record a token', count: liveN, color: '#7d8ea6' });
  segs = segs.concat(groups.map(function (g2, i) {
    return { label: g2.label, count: g2.count, color: ['#f5b942', '#2dd4a7', '#b07fe8', '#f26d6d', '#4ade80', '#e88bb1'][i % 6] };
  }));
  var segTotal = segs.reduce(function (s, g2) { return s + g2.count; }, 0) || 1;
  $('segbar').innerHTML = segs.map(function (g2) { return '<i style="width:' + (g2.count / segTotal * 100).toFixed(2) + '%;background:' + g2.color + '" title="' + esc(g2.label) + ' ' + g2.count + '"></i>'; }).join('');
  $('segbar').setAttribute('aria-label', segs.map(function (g2) { return g2.label + ' ' + g2.count; }).join(', '));
  var why = { 'Ranked': 'record no token and stand alone', 'Already record a token': 'a market cap on record', 'Bridges': 'another token carried across', 'Liquid staking/restaking': 'a staked form of a token', 'Exchange custody': 'balances held by an exchange', 'Versioned': 'a versioned release', 'Wrapped/staked': 'a wrapped or staked token' };
  $('acct-legend').innerHTML = segs.map(function (g2) { return '<li><i style="background:' + g2.color + '"></i>' + esc(g2.label) + ' <b>' + nf.format(g2.count) + '</b>' + (why[g2.label] ? ' <span class="why">— ' + why[g2.label] + '</span>' : '') + '</li>'; }).join('');

  // ---- Model audit (right panel) -------------------------------------------
  $('m-formula').textContent = fit.formula || 'implied = if-launched × launch odds';
  // Backtest, five steps, two held-out sets: each token left out in turn
  // (n=128) and the newer half priced from the older half (n=48). Each cell:
  // typical miss · far (P90) miss. The last step is highlighted: the premium
  // is measured, not applied — it misses worse on both sets.
  var looSteps = fit.looSteps || [];
  var loo = fit.loo || {};
  function missCell(m, p) { return m == null ? '—' : mult(m) + ' · ' + mult(p); }
  $('audit-steps').innerHTML = steps.length ? steps.map(function (s, i) {
    var l = looSteps[i] || {};
    return '<tr' + (i === steps.length - 1 ? ' class="hl"' : '') + '><td>' + esc(s.name) + '</td><td class="num">' + missCell(l.miss, l.p90) + '</td><td class="num">' + missCell(s.miss, s.p90) + '</td></tr>';
  }).join('') : '<tr><td colspan="3">No backtest in this data file.</td></tr>';
  // Range honesty for both held-out sets, even under 50% / 80%.
  var rangeSets = [['Left out', loo.n, loo.within_3x, loo.p25_p75_pct, loo.p10_p90_pct], ['Newer', val.n_test, val.within_3x, val.range_holds_p25_p75_pct, val.range_holds_pct]];
  $('audit-range').innerHTML = rangeSets.map(function (s) {
    function c(p) { return p == null || s[1] == null ? '—' : Math.round(p / 100 * s[1]) + '/' + s[1] + ' · ' + p + '%'; }
    return '<li class="grp">' + s[0] + ', n=' + (s[1] != null ? s[1] : '—') + '</li>' +
      '<li>Within ×3 <b>' + c(s[2]) + '</b></li>' +
      '<li>In P25–P75, stated 50% <b>' + c(s[3]) + '</b></li>' +
      '<li>In P10–P90, stated 80% <b>' + c(s[4]) + '</b></li>';
  }).join('');
  $('audit-note').textContent = 'Left out, the P25–P75 range holds ' + (loo.p25_p75_pct != null ? loo.p25_p75_pct + '%' : '—') + ' (50% if exact) and P10–P90 holds ' + (loo.p10_p90_pct != null ? loo.p10_p90_pct + '%' : '—') + ' (80% if exact); on the newer half ' + (val.range_holds_p25_p75_pct != null ? val.range_holds_p25_p75_pct + '%' : '—') + ' and ' + (holds != null ? holds + '%' : '—') + '.';
  var cats = R.category_table || [];
  var premMin = cats.length ? Math.min.apply(null, cats.map(function (c) { return c.premium; })) : null;
  var premMax = cats.length ? Math.max.apply(null, cats.map(function (c) { return c.premium; })) : null;
  $('price-steps').innerHTML = [
    'Size curve — ' + $('m-formula').textContent + ', fitted on ' + fit.n + ' live tokens, prices the TVL.',
    'Momentum — the 7-day change carries the value, clamped −50…+100% at half weight.',
    'Category premium — the median gap for the category, 1.00 when fewer than 5 live tokens; premiums run ' + mult(premMin) + '–' + mult(premMax) + '. Measured, not applied.',
    'Launch odds — the age band × category ever-rate, smoothed; the base rate alone is ' + val.odds_base_pct + '%.',
    'Implied value = if-launched × odds; the verdict is the drop share of it against the plan’s fees at the deposit and drop share set above.'
  ].map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
  $('m-verdict').textContent = 'FARM clears $25 net of fees · THIN clears $0 · SKIP does not — at the deposit and drop share set above.';
  $('cat-rows').innerHTML = cats.slice(0, 8).map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + nf.format(c.live) + '</td><td class="num">' + c.ever_pct + '%</td><td class="num">' + mult(c.premium) + '</td></tr>';
  }).join('') || '<tr><td colspan="4">No category table in this data file.</td></tr>';

  // ---- Scatter --------------------------------------
  function drawScatter() {
    var sc = R.scatter || {};
    var livePts = (sc.live || []).map(function (p) { return { x: p.tvl, y: p.mcap }; });
    var boardPts = (sc.board || []).map(function (p) { return { x: p.tvl, y: p.implied != null ? p.implied : p.mcap }; });
    if (!boardPts.length) boardPts = rows.map(function (r) { return { x: r.tvl_usd, y: r.implied_value_usd }; });
    if (!livePts.length) livePts = liveRows.filter(function (p) { return p.mcap_usd; }).map(function (p) { return { x: p.tvl_usd, y: p.mcap_usd }; });
    var curve = (sc.curve || []).slice().sort(function (a, b) { return a.tvl - b.tvl; });
    if (!curve.length && fit.a != null && fit.b != null) {
      curve = [0.1, 1, 10, 100, 1000].map(function (m) { var t = 1e8 * m; return { tvl: t, mcap: Math.pow(10, fit.a) * Math.pow(t, fit.b) }; });
    }
    var xs = livePts.concat(boardPts).concat(curve.map(function (p) { return { x: p.tvl, y: p.mcap }; }));
    if (!xs.length) return;
    var x0 = Math.floor(Math.min.apply(null, xs.map(function (p) { return Math.log10(p.x); })));
    var x1 = Math.ceil(Math.max.apply(null, xs.map(function (p) { return Math.log10(p.x); })));
    var y0 = Math.floor(Math.min.apply(null, xs.map(function (p) { return Math.log10(p.y); })));
    var y1 = Math.ceil(Math.max.apply(null, xs.map(function (p) { return Math.log10(p.y); })));
    var W = 720, H = 420, L = 66, Rm = 16, T = 14, B = 44;
    var X = function (v) { return L + (Math.log10(v) - x0) / (x1 - x0) * (W - L - Rm); };
    var Y = function (v) { return T + (1 - (Math.log10(v) - y0) / (y1 - y0)) * (H - T - B); };
    var s = '';
    for (var gx = x0; gx <= x1; gx++) { var px = X(Math.pow(10, gx)); s += '<line x1="' + px + '" y1="' + T + '" x2="' + px + '" y2="' + (H - B) + '" stroke="#1e2c44"/><text x="' + px + '" y="' + (H - B + 18) + '" fill="#8494a9" font-size="11" text-anchor="middle">' + money(Math.pow(10, gx)) + '</text>'; }
    for (var gy = y0; gy <= y1; gy++) { var py = Y(Math.pow(10, gy)); s += '<line x1="' + L + '" y1="' + py + '" x2="' + (W - Rm) + '" y2="' + py + '" stroke="#1e2c44"/><text x="' + (L - 8) + '" y="' + (py + 4) + '" fill="#8494a9" font-size="11" text-anchor="end">' + money(Math.pow(10, gy)) + '</text>'; }
    livePts.forEach(function (p) { s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="3" fill="#7d8ea6" opacity="0.75"/>'; });
    if (curve.length > 1) s += '<polyline points="' + curve.map(function (p) { return X(p.tvl).toFixed(1) + ',' + Y(p.mcap).toFixed(1); }).join(' ') + '" fill="none" stroke="#f5b942" stroke-width="2"/>';
    boardPts.forEach(function (p) { s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="4" fill="#5aa9ff" opacity="0.9"/>'; });
    s += '<text x="' + ((W + L) / 2) + '" y="' + (H - 6) + '" fill="#8494a9" font-size="12" text-anchor="middle">TVL ($) — log scale</text>';
    s += '<text x="16" y="' + ((H + T) / 2) + '" fill="#8494a9" font-size="12" text-anchor="middle" transform="rotate(-90 16 ' + ((H + T) / 2) + ')">Market cap / implied value ($) — log scale</text>';
    $('scatter').innerHTML = s;
  }
  drawScatter();

  // ---- Board table ---------------------------------------------------------
  var maxHi = Math.max.apply(null, rows.map(hi));
  var tbody = $('rows');
  function planAction(r) {
    var c = (r.category || '').toLowerCase();
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1) return 'Supply collateral';
    if (c.indexOf('dex') !== -1 || c.indexOf('yield') !== -1 || c.indexOf('leveraged farm') !== -1) return 'Add liquidity';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1) return 'Margin trade';
    if (c.indexOf('prediction') !== -1) return 'Prediction market';
    if (c.indexOf('stable') !== -1) return 'Mint stable asset';
    if (c.indexOf('rwa') !== -1) return 'Mint yield asset';
    if (c.indexOf('insurance') !== -1) return 'Buy cover';
    if (c.indexOf('allocator') !== -1 || c.indexOf('curator') !== -1 || c.indexOf('vault') !== -1) return 'Vault deposit';
    return 'Deposit';
  }
  // One-liner farm plan, for the CSV export; the 8-step plan is in detail.
  function planOneLiner(r) {
    var chain = (r.chains || [])[0] || 'main chain';
    return planAction(r) + ' · ' + chain + ', ' + (fees(r) != null ? money(fees(r)) : '—') + ' fees · ' + (hours(r) != null ? hours(r) + 'h' : '—') + ' · ' + (fd(r) != null ? fd(r) + 'd' : '—');
  }
  function planMeta(r) {
    var bits = [(r.chains || []).slice(0, 2).join(' + ') || '—'];
    if (hours(r) != null) bits.push(hours(r) + 'h');
    if (fd(r) != null) bits.push('over ' + fd(r) + 'd');
    bits.push(fees(r) != null ? 'fees ~' + money(fees(r)) : 'fees n/a');
    return bits.join(' · ');
  }
  function perHourTxt(r) {
    var h = perHourFor(r);
    if (h == null) return '—';
    var v = Math.abs(h);
    return (h >= 0 ? '+' : '−') + '$' + (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + '/h';
  }
  // The net cell: pill + net, then per-hour, pays-from, deposit.
  function netCellHTML(r) {
    var v = verdictFor(r);
    var pf = paysFromFor(r);
    var dep = state.deposit >= 1000 ? '$' + (state.deposit / 1000) + 'K' : '$' + state.deposit;
    var second = perHourTxt(r) + (v === 'SKIP' ? '' : ' · pays ' + (pf != null ? full(pf) : '—')) + ' · on ' + dep;
    return '<span class="pill ' + v + '">' + v + '</span> <span class="netval">' + money(netFor(r)) + '</span>' +
      '<span class="sub1">' + second + '</span>';
  }
  var rowEls = rows.map(function (r) {
    var tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.dataset.slug = r.slug;
    var ch7 = r.change_7d;
    var vm = vsMarket(r);
    var rangeW = maxHi ? Math.max(0, (hi(r) - lo(r)) / maxHi * 100) : 0;
    var rangeL = maxHi ? lo(r) / maxHi * 100 : 0;
    var rangeM = maxHi ? r.implied_value_usd / maxHi * 100 : 0;
    tr.innerHTML =
      '<td class="num" data-value="' + r.rank + '">' + r.rank + '<span class="sub2">' + r._rlo + '–' + r._rhi + '</span></td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + (isWl(r) ? '<span class="wl">WL</span>' : '') + '<span class="sub2">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + '</span></td>' +
      '<td class="num" data-value="' + r.tvl_usd + '" title="' + full(r.tvl_usd) + '">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + (ch7 == null ? '' : ch7 >= 0 ? 'up' : 'down') + '" data-value="' + (ch7 == null ? '' : ch7) + '">' + pct(ch7) + (vm == null ? '' : '<span class="sub1">' + (vm > 0 ? '+' : '') + vm.toFixed(1) + '% vs market</span>') + '</td>' +
      '<td class="num" data-value="' + (age(r) == null ? '' : age(r)) + '">' + ageFmt(age(r)) + '</td>' +
      '<td class="num" data-value="' + (odds(r) == null ? '' : odds(r)) + '">' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + '</td>' +
      '<td class="num" data-value="' + r.implied_value_usd + '"><span title="' + full(r.implied_value_usd) + '">' + money(r.implied_value_usd) + '</span> <span class="range-txt">' + money(lo(r)) + '–' + money(hi(r)) + '</span><span class="rbar"><i style="left:' + rangeL.toFixed(1) + '%;width:' + rangeW.toFixed(1) + '%"></i><b style="left:' + rangeM.toFixed(1) + '%"></b></span></td>' +
      '<td class="num netcell" data-value="' + netFor(r) + '">' + netCellHTML(r) + '</td>';
    tr.addEventListener('click', function () { openDetail(r); });
    tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r); } });
    return tr;
  });
  rowEls.forEach(function (tr) { tbody.appendChild(tr); });
  var rowBySlug = {};
  rows.forEach(function (r, i) { rowBySlug[r.slug] = { row: r, el: rowEls[i] }; });

  // ---- Filters, segments, what-if ------------------------------------------
  function fillSelect(el, values) {
    values.sort(collator.compare).forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); });
  }
  fillSelect($('cat'), Array.from(new Set(rows.map(function (r) { return r.category || 'uncategorised'; }))));
  fillSelect($('chain'), Array.from(new Set(rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))));
  $('s-all').textContent = segCounts.ALL; $('s-wl').textContent = segCounts.WL; $('s-off').textContent = segCounts.OFF; $('s-below').textContent = segCounts.BELOW;
  function segOf(r) { return isWl(r) ? 'WL' : (r.tvl_usd >= floor ? 'OFF' : 'BELOW'); }
  function visible(r) {
    if (state.seg !== 'ALL' && segOf(r) !== state.seg) return false;
    if (state.v !== 'ALL' && verdictFor(r) !== state.v) return false;
    if (state.cat !== 'all' && (r.category || 'uncategorised') !== state.cat) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (state.q) { var q = state.q.toLowerCase(); if ((r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false; }
    return true;
  }
  var sortLabels = { rank: 'rank', tvl: 'TVL', ch7: '7-day change', age: 'tracked time', odds: 'launch odds', implied: 'implied value', net: 'net of fees' };
  function renderStatus(n) {
    var shown = rows.filter(visible);
    var sum = shown.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var dirWord = state.dir === 1 ? 'low to high' : 'high to low';
    $('count').textContent = 'No token recorded ' + nf.format(rows.length) + ' · Token trades ' + nf.format(fit.n != null ? fit.n : liveRows.length) +
      ' · ' + (n != null ? n : shown.length) + ' of ' + rows.length + ' protocols · ' + money(sum) + ' implied in view · sorted by ' + (sortLabels[state.sortKey] || state.sortKey) + ', ' + dirWord;
  }
  function applyFilters() {
    var n = 0;
    rowEls.forEach(function (tr, i) { var show = visible(rows[i]); tr.style.display = show ? '' : 'none'; if (show) n++; });
    renderStatus(n);
  }
  // Recompute everything the what-if controls move, in place: the net cells
  // (and their sort values), the verdict counts, the farm KPI, the note.
  function updateDynamics() {
    rowEls.forEach(function (tr, i) {
      var cell = tr.cells[7];
      cell.setAttribute('data-value', String(netFor(rows[i])));
      cell.innerHTML = netCellHTML(rows[i]);
    });
    var counts = { ALL: rows.length, FARM: 0, THIN: 0, SKIP: 0 };
    rows.forEach(function (r) { counts[verdictFor(r)]++; });
    $('c-all').textContent = counts.ALL; $('c-farm').textContent = counts.FARM; $('c-thin').textContent = counts.THIN; $('c-skip').textContent = counts.SKIP;
    $('k-farm').textContent = nf.format(counts.FARM);
    $('k-farm-s').textContent = counts.THIN + ' thin · ' + counts.SKIP + ' skip · at ' + full(state.deposit) + ' and a ' + state.drop + '% drop share';
    $('net-note').textContent = 'Net of fees is the farmer\u2019s take-home on the ' + full(state.deposit) + ' deposit at a ' + state.drop + '% drop share.';
    if (state.v === 'FARM') setSort('net', -1); // the FARM view sorts by net, so re-sort after the nets move
    if (detailRow) openDetail(detailRow, { scroll: false });
  }
  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); applyFilters(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; applyFilters(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; applyFilters(); });
  document.querySelectorAll('.segs button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.seg = b.dataset.seg;
      document.querySelectorAll('.segs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      applyFilters();
    });
  });
  document.querySelectorAll('.verdicts button').forEach(function (b) {
    b.addEventListener('click', function () { applyVerdict(b.dataset.v); });
  });
  document.querySelectorAll('[data-dep]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.deposit = Number(b.dataset.dep);
      document.querySelectorAll('[data-dep]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      updateDynamics();
      applyFilters();
    });
  });
  document.querySelectorAll('[data-drop]').forEach(function (b) {
    b.addEventListener('click', function () {
      state.drop = Number(b.dataset.drop);
      document.querySelectorAll('[data-drop]').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      updateDynamics();
      applyFilters();
    });
  });
  $('reset').addEventListener('click', function () {
    state.q = ''; state.seg = 'ALL'; state.v = 'ALL'; state.cat = 'all'; state.chain = 'all';
    state.deposit = 1000; state.drop = 5; state.hideSummary = false;
    $('q').value = ''; $('cat').value = 'all'; $('chain').value = 'all';
    document.querySelectorAll('.segs button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.seg === 'ALL' ? 'true' : 'false'); });
    document.querySelectorAll('.verdicts button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.v === 'ALL' ? 'true' : 'false'); });
    document.querySelectorAll('[data-dep]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.dep === '1000' ? 'true' : 'false'); });
    document.querySelectorAll('[data-drop]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.drop === '5' ? 'true' : 'false'); });
    setSort('rank', 1);
    $('count').hidden = false;
    $('hide-summary').setAttribute('aria-pressed', 'false');
    $('hide-summary').textContent = 'Hide summary';
    updateDynamics();
    applyFilters();
  });
  $('hide-summary').addEventListener('click', function () {
    state.hideSummary = !state.hideSummary;
    $('count').hidden = state.hideSummary;
    $('hide-summary').setAttribute('aria-pressed', state.hideSummary ? 'true' : 'false');
    $('hide-summary').textContent = state.hideSummary ? 'Show summary' : 'Hide summary';
  });

  // ---- CSV export -----------
  function csvField(v) {
    var s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $('csv').addEventListener('click', function () {
    var lines = [['rank', 'protocol', 'slug', 'tvl_usd', 'change_7d_pct', 'no_token_days', 'if_launched_usd', 'launch_odds', 'implied_value_usd', 'range_low_usd', 'range_high_usd', 'net_of_fees_usd', 'verdict', 'farm_plan'].join(',')];
    Array.prototype.forEach.call(tbody.rows, function (tr) {
      if (tr.style.display === 'none') return;
      var r = rowBySlug[tr.dataset.slug].row;
      lines.push([
        r.rank, r.name, r.slug, r.tvl_usd, r.change_7d, age(r), ifL(r), odds(r),
        r.implied_value_usd, lo(r), hi(r), netFor(r), verdictFor(r), planOneLiner(r)
      ].map(csvField).join(','));
    });
    var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'launch-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // Sorting: buttons in th, aria-sort on the th only, and the existing tr
  // elements are moved — never rebuilt. A verdict pill can set the sort too:
  // FARM sorts by net of fees, high to low; All returns to rank order.
  function setSort(key, dir) {
    state.sortKey = key; state.dir = dir;
    document.querySelectorAll('#board thead th').forEach(function (h) { h.removeAttribute('aria-sort'); });
    var th = document.querySelector('#board thead th[data-key="' + key + '"]');
    if (th) th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    var col = th ? th.cellIndex : 0;
    var ordered = rowEls.slice().sort(function (a, b) {
      var va = a.cells[col].dataset.value, vb = b.cells[col].dataset.value;
      if (va === '' && vb === '') return 0;
      if (va === '') return 1; if (vb === '') return -1; // nulls last, either way
      var na = Number(va), nb = Number(vb);
      return dir * (isFinite(na) && isFinite(nb) ? na - nb : collator.compare(va, vb));
    });
    var move = tbody.moveBefore ? function (el) { tbody.moveBefore(el, null); } : function (el) { tbody.appendChild(el); };
    ordered.forEach(move);
    renderStatus();
  }
  function sortBy(th) {
    var key = th.dataset.key;
    setSort(key, state.sortKey === key ? -state.dir : 1); // first activation ascends, repeats toggle
  }
  function applyVerdict(v) {
    state.v = v;
    document.querySelectorAll('.verdicts button').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.v === v ? 'true' : 'false'); });
    if (v === 'FARM') setSort('net', -1);
    else if (v === 'ALL') setSort('rank', 1);
    applyFilters();
  }
  document.querySelectorAll('#board thead th[data-key] button').forEach(function (btn) {
    btn.addEventListener('click', function () { sortBy(btn.closest('th')); });
  });
  document.querySelector('#board thead th[data-key="rank"]').setAttribute('aria-sort', 'ascending');
  updateDynamics();
  applyFilters();

  // ---- Verification strip --------------
  (function verify() {
    var drawn = tbody.rows.length;
    var ranks = rows.map(function (r) { return r.rank; }).sort(function (a, b) { return a - b; });
    var ranksOk = ranks.length === rows.length && ranks.every(function (r, i) { return r === i + 1; });
    var mono = rows.every(function (r, i) { return i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd; });
    var sum = rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var totalOk = sum === totalImplied();
    var ok = drawn === rows.length && ranksOk && mono && totalOk;
    var el = $('verify');
    el.className = 'verify ' + (ok ? 'ok' : 'bad');
    el.textContent = (ok ? '✓ Verified against the board: ' : '✗ Mismatch — check the board: ') +
      drawn + ' rows drawn = ' + rows.length + ' written · ranks 1–' + rows.length + (ranksOk ? ' in order' : ' OUT OF ORDER') +
      ' · implied value ' + (mono ? 'never rises' : 'RISES') + ' · total ' + money(sum) + (totalOk ? ' = ' + money(totalImplied()) : ' ≠ ' + money(totalImplied()));
    // The seal: the program hashed board.json; the page re-hashes its rows.
    var sealStored = R.board_seal || null;
    function sealDone(c) { el.textContent += ' · seal ' + (c || sealStored || '—') + ' = ' + (sealStored || c || '—'); }
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(boardJsonText)).then(function (buf) {
        var h = '', u = new Uint8Array(buf);
        for (var i = 0; i < 4; i++) h += ('0' + u[i].toString(16)).slice(-2);
        sealDone(h);
      }).catch(function () { sealDone(null); });
    } else sealDone(null);
  })();

  // ---- Detail view ---------------------------------------------------------
  var detailRow = null;
  function openDetail(r, opts) {
    detailRow = r;
    opts = opts || {};
    rowEls.forEach(function (tr) { tr.setAttribute('aria-selected', tr.dataset.slug === r.slug ? 'true' : 'false'); });
    $('d-empty').hidden = true;
    $('d-body').hidden = false;
    $('d-name').textContent = '#' + r.rank + ' ' + r.name + '  ·  ' + verdictFor(r);
    $('d-sub').textContent = r.slug + ' · ' + (r.category || 'uncategorised') + ' · ' + (r.chains || []).join(', ') + (isWl(r) ? ' · on the watchlist' : '') + ' · ' + days(age(r)) + ' with no token on record';
    var vm = vsMarket(r);
    // Quick facts; curve, slice, fees, net, deposit live below.
    $('d-breakdown').innerHTML =
      '<dt>TVL</dt><dd>' + full(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + pct(r.change_7d) + (vm == null ? '' : ' · ' + (vm > 0 ? '+' : '') + vm.toFixed(1) + '% vs market') + '</dd>' +
      '<dt>If launched</dt><dd>' + full(ifL(r)) + '</dd>' +
      '<dt>Launch odds</dt><dd>' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + '</dd>' +
      '<dt>Implied value</dt><dd>' + full(r.implied_value_usd) + '</dd>' +
      '<dt>Range</dt><dd>' + full(lo(r)) + ' – ' + full(hi(r)) + '</dd>' +
      '<dt>Rank range</dt><dd>' + r._rlo + '–' + r._rhi + '</dd>';
    // Nearest traded comparables: the 3 live tokens closest by TVL.
    var comp = liveRows.filter(function (p) { return p.mcap_usd && p.tvl_usd > 0; })
      .map(function (p) { return { p: p, d: Math.abs(Math.log10(p.tvl_usd) - Math.log10(r.tvl_usd)) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 3);
    $('d-comp-rows').innerHTML = comp.map(function (c) {
      return '<tr><td><span class="name">' + esc(c.p.name) + '</span><span class="sub2">' + esc(c.p.slug) + '</span></td><td class="num">' + money(c.p.tvl_usd) + '</td><td class="num">' + money(c.p.mcap_usd) + '</td></tr>';
    }).join('') || '<tr><td colspan="3">—</td></tr>';
    // How the figure is made: each step with its number and its derivation.
    var carry = carryOf(r);
    var curveVal = fit.a != null && fit.b != null ? Math.pow(10, fit.a) * Math.pow(r.tvl_usd, fit.b) : null;
    var catRow = null;
    cats.forEach(function (c) { if (c.category === (r.category || 'uncategorised')) catRow = c; });
    var catName = esc(r.category || 'uncategorised');
    $('d-how').innerHTML = [
      'TVL in the snapshot — <b>' + full(r.tvl_usd) + '</b> · ' + pct(r.change_7d) + ' in 7 days · tracked ' + days(age(r)) + '.',
      'Forward TVL — <b>' + full(Math.round(r.tvl_usd * carry)) + '</b> · the 7-day change carried, clamped −50…+100% at half weight (×' + carry.toFixed(2) + ').',
      'Size curve — <b>' + full(curveVal) + '</b> · 10^' + fit.a + ' × TVL^' + fit.b + ', fitted on ' + fit.n + ' live tokens.',
      'Category premium — <b>' + mult(catRow ? catRow.premium : null) + '</b> · ' + catName + ', median of ' + (catRow ? catRow.live : 0) + (catRow && catRow.live === 1 ? ' live token' : ' live tokens') + ', 1.00 when fewer than 5; measured, not applied.',
      'Value if it launches — <b>' + full(ifL(r)) + '</b> · size curve × growth carry.',
      'Launch odds — <b>' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + '</b> · the ' + bandLabel(age(r)) + ' band ever-rate is ' + Math.round((r.odds_band || 0) * 100) + '% and ' + catName + ' in that band is ' + (r.odds_cell == null ? '—' : Math.round(r.odds_cell * 100) + '%') + ' (n=' + (r.odds_cell_n || 0) + '), smoothed toward the band.',
      'Implied value — <b>' + full(r.implied_value_usd) + '</b> · if-launched × odds.'
    ].map(function (s) { return '<li>' + s + '</li>'; }).join('');
    // Farm plan: the 6-number strip, the drop × deposit matrix, the lines.
    $('d-strip').innerHTML = [
      ['At risk', full(state.deposit)], ['Fees', fees(r) == null ? '—' : full(fees(r))], ['Model’s drop', full(sliceFor(r))],
      ['Net', full(netFor(r))], ['Your time', hours(r) == null ? '—' : hours(r) + 'h'], ['Net per hour', perHourTxt(r)]
    ].map(function (kv) { return '<div><span>' + kv[0] + '</span><b>' + kv[1] + '</b></div>'; }).join('');
    var depCols = [];
    [state.deposit, 1000, 10000].forEach(function (d) { if (depCols.indexOf(d) === -1) depCols.push(d); });
    depCols.sort(function (a, b) { return a - b; });
    var mHead = '<thead><tr><th scope="col">Drop \\ deposit</th>' + depCols.map(function (d) { return '<th scope="col" class="num">' + full(d) + (d === state.deposit ? ' · plan' : '') + '</th>'; }).join('') + '</tr></thead>';
    var mDrops = [3.5, 7, 14, state.drop].filter(function (d, i, a) { return a.indexOf(d) === i; }).sort(function (a, b) { return a - b; });
    var mRows = mDrops.map(function (drop) {
      return '<tr><th scope="row">' + drop + '%</th>' + depCols.map(function (d) {
        var s = Math.round(r.implied_value_usd * (drop / 100) * d / FARMED_DEPOSITS);
        var n = round2(s - (fees(r) || 0));
        var v = n > FARM_MARGIN ? 'FARM' : n > 0 ? 'THIN' : 'SKIP';
        var isModel = drop === state.drop && d === state.deposit;
        return '<td class="num' + (isModel ? ' model' : '') + '"><span class="pill ' + v + '">' + v + '</span> ' + signed(n) + (isModel ? ' <span class="sub2">model</span>' : '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    $('d-matrix').innerHTML = '<caption>Drop share × deposit — verdict and net for each combination</caption>' + mHead + '<tbody>' + mRows + '</tbody>';
    var slice1k = Math.round(r.implied_value_usd * (state.drop / 100) * 1000 / FARMED_DEPOSITS);
    var weeks = (fd(r) || 0) / 7;
    var tbill = state.deposit * 0.04 * (fd(r) || 0) / 365;
    $('d-lines').innerHTML =
      '<p class="dline">Drop per $1,000 held <b>' + full(slice1k) + '</b> at a ' + state.drop + '% drop share.</p>' +
      '<p class="dline">T-bill at 4% pays <b>$' + tbill.toFixed(2) + '</b> on ' + full(state.deposit) + ' over ' + weeks.toFixed(1) + ' weeks — the farm must beat that.</p>' +
      '<p class="dline">Typical wait if it launches <b>' + (odds(r) == null ? '—' : waitTxt(waitY(odds(r)))) + '</b> — the 2-year ever-rate of ' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + ' read as a steady hazard.</p>';
    $('d-plan-meta').textContent = planMeta(r) + ' · ' + (r.farm_steps || []).length + ' steps';
    $('d-steps').innerHTML = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') || '<li>—</li>';
    var wrong = [];
    if (r.change_7d != null && r.change_7d < 0) wrong.push('TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in 7 days — if the slide continues, the if-launched value falls with it.');
    if (odds(r) != null && odds(r) < 0.3) wrong.push('Launch odds are only ' + Math.round(odds(r) * 100) + '% — the likeliest outcome is no launch at all, and the farm returns fees, not a token.');
    if (age(r) != null && age(r) < 365) wrong.push('Only ' + age(r) + ' days with no token on record — a young protocol has less history behind its odds.');
    wrong.push('The DefiLlama record may miss a token: this protocol records no token, it may still have one.');
    wrong.push('The fit is a median — half of live tokens sit more than ' + mult(miss) + ' from the curve, so trust the range, not the point value.');
    $('d-wrong').innerHTML = wrong.slice(0, 4).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('');
    showTab('detail');
    if (opts.scroll !== false) document.querySelector('.detail').scrollIntoView({ behavior: opts.scroll === 'auto' ? 'auto' : 'smooth', block: 'start' });
  }
  function closeDetail() {
    detailRow = null;
    $('d-empty').hidden = false;
    $('d-body').hidden = true;
    rowEls.forEach(function (tr) { tr.removeAttribute('aria-selected'); });
  }

  function showAuditTab(which) {
    [['check', 'tab-check', 'panel-check'], ['price', 'tab-price', 'panel-price']].forEach(function (t) {
      $(t[1]).setAttribute('aria-selected', t[0] === which ? 'true' : 'false');
      $(t[2]).hidden = t[0] !== which;
    });
  }
  function showTab(which) {
    [['detail', 'tab-detail', 'panel-detail'], ['live', 'tab-live', 'panel-live'], ['excluded', 'tab-excluded', 'panel-excluded']].forEach(function (t) {
      $(t[1]).setAttribute('aria-selected', t[0] === which ? 'true' : 'false');
      $(t[2]).hidden = t[0] !== which;
    });
  }
  $('tab-check').addEventListener('click', function () { showAuditTab('check'); });
  $('tab-price').addEventListener('click', function () { showAuditTab('price'); });
  $('tab-detail').addEventListener('click', function () { showTab('detail'); });
  $('tab-live').addEventListener('click', function () { showTab('live'); });
  $('tab-excluded').addEventListener('click', function () { showTab('excluded'); });

  // Live + excluded tables
  $('live-count').textContent = liveRows.length ? '(' + nf.format(liveRows.length) + ' protocols)' : '';
  $('live-rows').innerHTML = liveRows.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><span class="sub2">' + esc(p.slug) + '</span></td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td></tr>';
  }).join('') || '<tr><td colspan="3">No live-token list in this data file.</td></tr>';
  $('ex-count').textContent = excluded.length ? '(' + nf.format(excluded.length) + ' protocols)' : '';
  $('ex-rows').innerHTML = excluded.map(function (e) {
    return '<tr><td><span class="name">' + esc(e.name) + '</span><span class="sub2">' + esc(e.slug) + '</span></td><td>' + esc(e.reason) + '</td></tr>';
  }).join('') || '<tr><td colspan="2">Nothing excluded.</td></tr>';

  // ---- Keyboard ------------
  var selIdx = -1;
  function visibleEls() { return rowEls.filter(function (tr) { return tr.style.display !== 'none'; }); }
  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement ? document.activeElement.tagName : '';
    var typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (e.key === 'Escape') {
      if (detailRow) { closeDetail(); e.preventDefault(); }
      return;
    }
    if (typing) return;
    if (e.key === '/') { $('q').focus(); e.preventDefault(); return; }
    if (e.key !== 'j' && e.key !== 'k') return;
    var vis = visibleEls();
    if (!vis.length) return;
    if (selIdx < 0 || selIdx >= vis.length) selIdx = e.key === 'j' ? 0 : vis.length - 1;
    else selIdx = e.key === 'j' ? Math.min(vis.length - 1, selIdx + 1) : Math.max(0, selIdx - 1);
    vis[selIdx].focus();
    e.preventDefault();
  });

  // ---- Deep links ------
  (function hashInit() {
    var h = (window.location.hash || '').slice(1);
    if (!h) return;
    if (h === 'farm') {
      applyVerdict('FARM');
      return;
    }
    var m = /^detail=(.+)$/.exec(h);
    if (m && rowBySlug[m[1]]) openDetail(rowBySlug[m[1]].row, { scroll: 'auto' });
  })();

  // Footer
  $('foot-source').textContent = 'Source: ' + (R.source || 'DefiLlama snapshot') + ' · snapshot ' + (R.as_of || '—') + ' · floor ' + full(R.floor_usd) + ' · model ' + (R.model_version || '—') + '.';
})();

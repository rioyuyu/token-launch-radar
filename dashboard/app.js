// Launch Radar dashboard. Reads window.RADAR from data.js beside the page and
// renders the board, model, scatter, filters and detail views. No network, no
// fetch: every value shown comes from data.js or is derived from a row's figures.
// Written against the radar-4 schema; the few `??` fallbacks only let the page
// still render on the older radar-3 data.js while the model is rebuilt.
(function () {
  'use strict';
  var R = window.RADAR || {};
  var rows = (R.rows || []).slice().sort(function (a, b) { return a.rank - b.rank; });
  var excluded = Array.isArray(R.excluded) ? R.excluded : ((R.excluded && R.excluded.items) || []);
  var liveRows = R.live_rows || R.live || [];
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

  // Per-row accessors: radar-4 fields first, radar-3 names as fallback.
  function age(r) { return r.no_token_days != null ? r.no_token_days : (r.age_days != null ? r.age_days : null); }
  function odds(r) { return r.launch_odds != null ? r.launch_odds : null; }
  function ifL(r) { return r.if_launched_usd != null ? r.if_launched_usd : (odds(r) ? r.implied_value_usd / odds(r) : r.implied_value_usd); }
  function lo(r) { return r.range_low_usd != null ? r.range_low_usd : r.implied_value_usd; }
  function hi(r) { return r.range_high_usd != null ? r.range_high_usd : r.implied_value_usd; }
  function fees(r) { return r.farm_fees_usd != null ? r.farm_fees_usd : null; }
  function net(r) { return r.net_of_fees_usd != null ? r.net_of_fees_usd : r.implied_value_usd; }
  function verdict(r) { return r.verdict || (r.implied_value_usd >= 1e7 ? 'FARM' : r.implied_value_usd >= 1e6 ? 'THIN' : 'SKIP'); }
  function isWl(r) { return !!(r.watchlist != null ? r.watchlist : r.is_watchlist); }
  function hours(r) { return r.farm_hours != null ? r.farm_hours : null; }
  function fd(r) { return r.farm_days != null ? r.farm_days : null; }
  function slice(r) { return r.airdrop_slice_usd != null ? r.airdrop_slice_usd : null; }
  function totalImplied() { return R.total_implied_usd != null ? R.total_implied_usd : rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0); }

  if (!rows.length) { $('verify').textContent = 'No board data loaded — data.js is missing or empty.'; $('verify').className = 'verify bad'; return; }

  // ---- Header + KPIs -------------------------------------------------------
  var acct = R.accounting || null;
  var totalProtocols = acct ? acct.total : (rows.length + (R.live_total || liveRows.length) + excluded.length);
  var wlCount = rows.filter(isWl).length;
  $('h-date').textContent = R.as_of || '—';
  $('h-cover').textContent = nf.format(totalProtocols) + ' protocols read · ' + wlCount + '/' + (R.watchlist_size || wlCount) + ' watchlist';
  $('h-model').textContent = R.model_version || '—';
  var kpi = R.kpi || {};
  var val = R.validation || {};
  var miss = kpi.held_out_miss != null ? kpi.held_out_miss : (val.miss != null ? val.miss : (val.median_abs_pct_error != null ? 1 + val.median_abs_pct_error / 100 : null));
  var holds = kpi.range_holds_pct != null ? kpi.range_holds_pct : val.range_holds_pct;
  var farmN = kpi.worth_farming != null ? kpi.worth_farming : (R.verdicts ? R.verdicts.farm : rows.filter(function (r) { return verdict(r) === 'FARM'; }).length);
  var best = kpi.best_per_hour_usd;
  if (best == null) { best = 0; rows.forEach(function (r) { if (hours(r)) best = Math.max(best, net(r) / hours(r)); }); }
  $('k-ranked').textContent = nf.format(kpi.ranked != null ? kpi.ranked : rows.length);
  $('k-implied').textContent = money(totalImplied());
  $('k-implied').title = full(totalImplied());
  $('k-miss').textContent = mult(miss);
  $('k-holds').textContent = holds != null ? holds + '%' : '—';
  $('k-farm').textContent = nf.format(farmN);
  $('k-best').textContent = best ? '+$' + nf.format(Math.round(best)) : '—';

  // ---- Accounting bar ------------------------------------------------------
  var groups = acct && acct.groups ? acct.groups : null;
  if (!groups) { // fallback: group the excluded rows by the head of their reason
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
  $('acct-legend').innerHTML = segs.map(function (g2) { return '<li><i style="background:' + g2.color + '"></i>' + esc(g2.label) + ' <b>' + nf.format(g2.count) + '</b></li>'; }).join('');

  // ---- Model panel ---------------------------------------------------------
  var fit = R.fit || {};
  $('m-formula').textContent = fit.formula || (fit.global_multiple != null ? 'mcap ≈ ' + fit.global_multiple + ' × TVL' : 'implied = if-launched × launch odds');
  var steps = fit.steps || [];
  $('m-steps').innerHTML = steps.length ? steps.map(function (s) { return '<li>' + esc(s.name) + ' — median miss <b>' + mult(s.miss) + '</b></li>'; }).join('')
    : '<li>' + esc(fit.method || 'Fitted on live tokens that already trade.') + '</li>';
  // radar-4 stores within_3x as a percent of the held-out set (24 of 48 = 50),
  // so it needs a % sign; the radar-3 within_2x fallback was a bare count.
  var withinKey = val.within_3x != null ? ['Within 3×', val.within_3x + '%'] : (val.within_2x != null ? ['Within 2×', val.within_2x + ' of ' + (val.n_test != null ? val.n_test : '')] : null);
  $('m-valid').innerHTML =
    '<dt>Train / test</dt><dd>' + (val.n_train != null ? val.n_train + ' / ' + val.n_test : '—') + '</dd>' +
    '<dt>Held-out miss</dt><dd>' + mult(miss) + '</dd>' +
    '<dt>Range holds</dt><dd>' + (holds != null ? holds + '%' : '—') + '</dd>' +
    (withinKey ? '<dt>' + withinKey[0] + '</dt><dd>' + withinKey[1] + '</dd>' : '') +
    '<dt>Live tokens fitted</dt><dd>' + (fit.n != null ? fit.n : (fit.n_live_fitted != null ? fit.n_live_fitted : '—')) + '</dd>';
  var deposit = R.deposit_usd != null ? R.deposit_usd : 1000;
  var farmNets = rows.filter(function (r) { return verdict(r) === 'FARM'; }).map(net);
  var skipNets = rows.filter(function (r) { return verdict(r) === 'SKIP'; }).map(net);
  var band = farmNets.length && skipNets.length
    ? 'On this board every FARM row nets at least ' + money(Math.min.apply(null, farmNets)) + ' after fees, and every SKIP row nets at most ' + money(Math.max.apply(null, skipNets)) + ' — THIN sits between. '
    : '';
  $('m-verdict').textContent = 'Deposit ' + full(deposit) + '. ' + band + 'A verdict is the model\u2019s call from the implied value net of farm fees against that deposit — FARM clears it by a wide margin, THIN narrowly, SKIP does not. It is not a promise a token launches.';

  // ---- Scatter (inline SVG, log axes) --------------------------------------
  function drawScatter() {
    var sc = R.scatter || {};
    var livePts = (sc.live || []).map(function (p) { return { x: p.tvl, y: p.mcap }; });
    var boardPts = (sc.board || []).map(function (p) { return { x: p.tvl, y: p.implied != null ? p.implied : p.mcap }; });
    if (!boardPts.length) boardPts = rows.map(function (r) { return { x: r.tvl_usd, y: r.implied_value_usd }; });
    if (!livePts.length) livePts = liveRows.filter(function (p) { return p.mcap_usd; }).map(function (p) { return { x: p.tvl_usd, y: p.mcap_usd }; });
    var curve = (sc.curve || []).slice().sort(function (a, b) { return a.tvl - b.tvl; });
    if (!curve.length && fit.a != null && fit.b != null) {
      curve = [0.1, 1, 10, 100, 1000].map(function (m) { var t = 1e8 * m; return { tvl: t, mcap: Math.pow(10, fit.a) * Math.pow(t, fit.b) }; });
    } else if (!curve.length && fit.global_multiple) {
      curve = [1e7, 1e11].map(function (t) { return { tvl: t, mcap: t * fit.global_multiple }; });
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
  function planMeta(r) {
    var bits = [(r.chains || []).slice(0, 2).join(' + ') || '—'];
    if (hours(r) != null) bits.push(hours(r) + 'h');
    if (fd(r) != null) bits.push('over ' + fd(r) + 'd');
    bits.push(fees(r) != null ? 'fees ~' + money(fees(r)) : 'fees n/a');
    return bits.join(' · ');
  }
  function planText(r) {
    var steps2 = r.farm_steps || [];
    return steps2.length ? String(steps2[0]).replace(/\s+/g, ' ').slice(0, 110) : '—';
  }
  var rowEls = rows.map(function (r) {
    var tr = document.createElement('tr');
    tr.tabIndex = 0;
    tr.dataset.slug = r.slug;
    var ch7 = r.change_7d;
    var rangeW = maxHi ? Math.max(0, (hi(r) - lo(r)) / maxHi * 100) : 0;
    var rangeL = maxHi ? lo(r) / maxHi * 100 : 0;
    var rangeM = maxHi ? r.implied_value_usd / maxHi * 100 : 0;
    tr.innerHTML =
      '<td class="num" data-value="' + r.rank + '">' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + (isWl(r) ? '<span class="wl">WL</span>' : '') + '<span class="sub2">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + '</span><span class="sub2">' + esc((r.chains || []).join(', ')) + '</span></td>' +
      '<td class="num" data-value="' + r.tvl_usd + '" title="' + full(r.tvl_usd) + '">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + (ch7 == null ? '' : ch7 >= 0 ? 'up' : 'down') + '" data-value="' + (ch7 == null ? '' : ch7) + '">' + pct(ch7) + '</td>' +
      '<td class="num" data-value="' + (age(r) == null ? '' : age(r)) + '">' + days(age(r)) + '</td>' +
      '<td class="num" data-value="' + ifL(r) + '" title="' + full(ifL(r)) + '">' + money(ifL(r)) + '</td>' +
      '<td class="num" data-value="' + (odds(r) == null ? '' : odds(r)) + '">' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + '</td>' +
      '<td class="num" data-value="' + r.implied_value_usd + '"><span title="' + full(r.implied_value_usd) + '">' + money(r.implied_value_usd) + '</span><span class="rbar"><i style="left:' + rangeL.toFixed(1) + '%;width:' + rangeW.toFixed(1) + '%"></i><b style="left:' + rangeM.toFixed(1) + '%"></b></span><span class="range-txt">' + money(lo(r)) + ' – ' + money(hi(r)) + '</span></td>' +
      '<td class="num" data-value="' + net(r) + '" title="' + full(net(r)) + '">' + money(net(r)) + '</td>' +
      '<td><span class="pill ' + verdict(r) + '">' + verdict(r) + '</span></td>' +
      '<td><span class="plan">' + esc(planText(r)) + '</span><span class="plan-meta">' + esc(planMeta(r)) + '</span></td>';
    tr.addEventListener('click', function () { openDetail(r); });
    tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r); } });
    return tr;
  });
  rowEls.forEach(function (tr) { tbody.appendChild(tr); });

  // Filters
  var state = { q: '', v: 'ALL', wl: false, cat: 'all', chain: 'all', sortKey: 'rank', dir: 1 };
  function fillSelect(el, values) {
    values.sort(collator.compare).forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; el.appendChild(o); });
  }
  fillSelect($('cat'), Array.from(new Set(rows.map(function (r) { return r.category || 'uncategorised'; }))));
  fillSelect($('chain'), Array.from(new Set(rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))));
  var counts = { ALL: rows.length, FARM: 0, THIN: 0, SKIP: 0 };
  rows.forEach(function (r) { counts[verdict(r)]++; });
  $('c-all').textContent = counts.ALL; $('c-farm').textContent = counts.FARM; $('c-thin').textContent = counts.THIN; $('c-skip').textContent = counts.SKIP;
  function visible(r) {
    if (state.v !== 'ALL' && verdict(r) !== state.v) return false;
    if (state.wl && !isWl(r)) return false;
    if (state.cat !== 'all' && (r.category || 'uncategorised') !== state.cat) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (state.q) { var q = state.q.toLowerCase(); if ((r.name + ' ' + r.slug).toLowerCase().indexOf(q) === -1) return false; }
    return true;
  }
  function applyFilters(announce) {
    var n = 0;
    rowEls.forEach(function (tr, i) { var show = visible(rows[i]); tr.style.display = show ? '' : 'none'; if (show) n++; });
    $('count').textContent = 'Showing ' + n + ' of ' + rows.length + ' rows' + (announce ? ' — ' + announce : '');
  }
  $('q').addEventListener('input', function (e) { state.q = e.target.value.trim(); applyFilters(); });
  $('wl-only').addEventListener('change', function (e) { state.wl = e.target.checked; applyFilters(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; applyFilters(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; applyFilters(); });
  document.querySelectorAll('.verdicts button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.v = b.dataset.v;
      document.querySelectorAll('.verdicts button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      applyFilters();
    });
  });

  // Sorting: buttons in th, aria-sort on the th only, Intl.Collator for text,
  // raw numbers from data-value, and the existing tr elements are moved —
  // never rebuilt — so focus and state inside rows survive.
  var keyOf = { rank: function (r) { return r.rank; }, tvl: function (r) { return r.tvl_usd; }, ch7: function (r) { return r.change_7d; }, age: function (r) { return age(r); }, 'if': function (r) { return ifL(r); }, odds: function (r) { return odds(r); }, implied: function (r) { return r.implied_value_usd; }, net: function (r) { return net(r); } };
  function sortBy(th) {
    var key = th.dataset.key;
    var dir = state.sortKey === key ? -state.dir : 1; // first activation ascends, repeats toggle
    state.sortKey = key; state.dir = dir;
    document.querySelectorAll('#board thead th').forEach(function (h) { h.removeAttribute('aria-sort'); });
    th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
    var col = th.cellIndex;
    var ordered = rowEls.slice().sort(function (a, b) {
      var va = a.cells[col].dataset.value, vb = b.cells[col].dataset.value;
      if (va === '' && vb === '') return 0;
      if (va === '') return 1; if (vb === '') return -1; // nulls last, either way
      var na = Number(va), nb = Number(vb);
      return dir * (isFinite(na) && isFinite(nb) ? na - nb : collator.compare(va, vb));
    });
    var move = tbody.moveBefore ? function (el) { tbody.moveBefore(el, null); } : function (el) { tbody.appendChild(el); };
    ordered.forEach(move);
    var label = th.textContent.trim();
    $('count').textContent = 'Sorted by ' + label + ', ' + (dir === 1 ? 'ascending' : 'descending') + ', ' + rows.length + ' rows';
  }
  document.querySelectorAll('#board thead th[data-key] button').forEach(function (btn) {
    btn.addEventListener('click', function () { sortBy(btn.closest('th')); });
  });
  // Default view: rank order (1 first), which is the board's own order.
  document.querySelector('#board thead th[data-key="rank"]').setAttribute('aria-sort', 'ascending');
  applyFilters();

  // ---- Verification strip (computed from the data at runtime) --------------
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
      drawn + ' rows drawn = ' + rows.length + ' rows written · ranks 1–' + rows.length + (ranksOk ? ' in order' : ' OUT OF ORDER') +
      ' · implied value ' + (mono ? 'never rises' : 'RISES') + ' down the board · total implied ' + money(sum) + (totalOk ? ' = ' + money(totalImplied()) : ' ≠ ' + money(totalImplied()));
  })();

  // ---- Detail view ---------------------------------------------------------
  function openDetail(r) {
    rowEls.forEach(function (tr) { tr.setAttribute('aria-selected', tr.dataset.slug === r.slug ? 'true' : 'false'); });
    $('d-empty').hidden = true;
    $('d-body').hidden = false;
    $('d-name').textContent = '#' + r.rank + ' ' + r.name + '  ·  ' + verdict(r);
    $('d-sub').textContent = r.slug + ' · ' + (r.category || 'uncategorised') + ' · ' + (r.chains || []).join(', ') + (isWl(r) ? ' · on the watchlist' : '') + ' · ' + days(age(r)) + ' with no token on record';
    var curve = ifL(r) / r.tvl_usd;
    $('d-breakdown').innerHTML =
      '<dt>TVL</dt><dd>' + full(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + pct(r.change_7d) + '</dd>' +
      '<dt>Size curve</dt><dd>' + mult(curve) + ' of TVL</dd>' +
      '<dt>If launched</dt><dd>' + full(ifL(r)) + '</dd>' +
      '<dt>Launch odds</dt><dd>' + (odds(r) == null ? '—' : Math.round(odds(r) * 100) + '%') + '</dd>' +
      '<dt>Implied value</dt><dd>' + full(r.implied_value_usd) + '</dd>' +
      '<dt>Range</dt><dd>' + full(lo(r)) + ' – ' + full(hi(r)) + '</dd>' +
      '<dt>Airdrop slice</dt><dd>' + (slice(r) == null ? '—' : full(slice(r))) + '</dd>' +
      '<dt>Farm fees</dt><dd>' + (fees(r) == null ? '—' : full(fees(r))) + '</dd>' +
      '<dt>Net of fees</dt><dd>' + full(net(r)) + '</dd>' +
      '<dt>Deposit</dt><dd>' + full(deposit) + '</dd>';
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
    document.querySelector('.detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Tabs
  function showTab(which) {
    [['detail', 'tab-detail', 'panel-detail'], ['live', 'tab-live', 'panel-live'], ['excluded', 'tab-excluded', 'panel-excluded']].forEach(function (t) {
      $(t[1]).setAttribute('aria-selected', t[0] === which ? 'true' : 'false');
      $(t[2]).hidden = t[0] !== which;
    });
  }
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

  // Footer
  $('foot-source').textContent = 'Source: ' + (R.source || 'DefiLlama snapshot') + ' · snapshot ' + (R.as_of || '—') + ' · floor ' + full(R.floor_usd) + ' · model ' + (R.model_version || '—') + '.';
})();

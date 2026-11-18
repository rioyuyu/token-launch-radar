// Token Radar dashboard. Reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, filters, the live-token view and a
// per-protocol detail panel. Static page: no network, no fetch, every value
// shown comes from data.js or is derived from a row's own figures.
//
// The farm plan is generated in-page from the row's own category, chains,
// TVL and age, by the same rules the board program uses in lib/model.ts.
// data.js carries no farm steps, so the plan is derived here instead of
// fetched. Each row does carry a boolean `watchlist` flag (the named
// watchlist membership), and the two toggles below use that flag directly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var state = {
    q: '', chain: 'all', category: 'all',
    watchlistOnly: false, earlyOnly: false,
    tab: 'board', sort: 'implied', dir: -1, selected: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var boardBody = $('board-body');
  var liveBody = $('live-body');
  var detail = $('detail');

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function chainsText(row, max) {
    if (!row.chains || row.chains.length === 0) return 'an unnamed chain';
    return row.chains.slice(0, max || 2).join(', ');
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The model's arithmetic, recomputed from the row's own figures so the
  // detail panel can show the breakdown and check the board's number.
  function recomputeImplied(row, model) {
    var rawGrowth = (row.change_7d === null || row.change_7d === undefined) ? 0 : row.change_7d;
    var growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    var growthMult = 1 + (growthPct / 100) * model.growth_weight;
    var age = (row.age_days === null || row.age_days === undefined) ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor +
      (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var base = Math.pow(row.tvl_usd, model.base_exponent) * model.base_scale;
    return {
      base: base, growthPct: growthPct, growthMult: growthMult,
      maturityMult: maturityMult, implied: Math.max(1, Math.round(base * growthMult * maturityMult))
    };
  }

  // The farm plan: the same derivation the board program writes to board.json.
  // Category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('liquidity manager') >= 0) {
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    }
    if (c.indexOf('bridge') >= 0) {
      return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) {
      return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    }
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) {
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position.';
    }
    if (c.indexOf('stable') >= 0) {
      return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    }
    if (c.indexOf('prediction') >= 0) {
      return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) {
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    }
    if (c.indexOf('insurance') >= 0) {
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    }
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gasNote = chain === 'Ethereum'
      ? 'Gas on Ethereum runs higher than on most other chains, so expect a few dollars per transaction and avoid busy hours.'
      : 'Gas on ' + chain + ' is usually low, often under a dollar per transaction.';
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' + gasNote, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function filterRows(rows) {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.watchlistOnly && r.watchlist !== true) return false;
      if (state.earlyOnly && r.watchlist !== false) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    function cmp(a, b) {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a < b) return -dir;
      if (a > b) return dir;
      return 0;
    }
    return list.slice().sort(function (a, b) {
      var r = 0;
      if (key === 'rank') r = cmp(a.rank, b.rank);
      else if (key === 'name') r = cmp(a.name.toLowerCase(), b.name.toLowerCase());
      else if (key === 'category') r = cmp((a.category || 'Other').toLowerCase(), (b.category || 'Other').toLowerCase());
      else if (key === 'chains') r = cmp((a.chains && a.chains[0]) || '', (b.chains && b.chains[0]) || '');
      else if (key === 'tvl') r = cmp(a.tvl_usd, b.tvl_usd);
      else if (key === 'change') r = cmp(a.change_7d, b.change_7d);
      else if (key === 'age') r = cmp(a.age_days, b.age_days);
      else r = cmp(a.implied_value_usd, b.implied_value_usd);
      if (r !== 0) return r;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderBoard() {
    var list = sortRows(filterRows(DATA.rows));
    var max = DATA.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    boardBody.textContent = '';
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { renderDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); renderDetail(r.slug); }
        }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: r.slug })
        )),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: chainsText(r) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied-cell' },
          el('div', { class: 'bar', 'aria-hidden': 'true' },
            el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num implied', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      boardBody.appendChild(tr);
    });
    $('board-empty').hidden = list.length !== 0;
    $('result-count').textContent = list.length + ' of ' + DATA.rows.length + ' rows shown';
    document.querySelectorAll('#board-table th button').forEach(function (btn) {
      var arrow = btn.querySelector('.arrow');
      if (arrow) arrow.remove();
      var th = btn.closest('th');
      if (th) th.removeAttribute('aria-sort');
      if (btn.getAttribute('data-sort') === state.sort) {
        btn.appendChild(el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }));
        if (th) th.setAttribute('aria-sort', state.dir < 0 ? 'descending' : 'ascending');
      }
    });
  }

  function renderLive() {
    liveBody.textContent = '';
    DATA.live.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      liveBody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: r.slug })
        )),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: chainsText(r) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    $('result-count').textContent = DATA.live.length + ' live-token protocols — already trading, not ranked';
  }

  function closeDetail() {
    state.selected = null;
    detail.textContent = '';
    detail.appendChild(el('p', { class: 'detail-empty', text: 'Select a protocol on the board to see its facts, model breakdown and farm plan.' }));
    document.querySelectorAll('#board-body tr').forEach(function (tr) { tr.setAttribute('data-selected', 'false'); });
  }

  function renderDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    var m = DATA.model;
    var calc = recomputeImplied(row, m);
    var steps = farmSteps(row);
    detail.textContent = '';
    detail.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'rank-line', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · pre-token' }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainsText(row, 10) })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Protocol facts' }),
      el('div', { class: 'kv' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: '7-day change' }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'First listed' }), el('b', { text: row.listed_at || 'unknown' })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Market cap' }), el('b', { text: 'none — no token on record' }))
      )
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Model breakdown · ' + DATA.model_version }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'base = TVL ^ ' + m.base_exponent + ' × ' + m.base_scale }), el('b', { text: fmtUsd(calc.base) })),
        el('div', null, el('span', { text: 'growth = 1 + ' + calc.growthPct.toFixed(2) + '% × ' + m.growth_weight }), el('b', { text: calc.growthMult.toFixed(4) })),
        el('div', null, el('span', { text: 'maturity (age ' + (row.age_days === null ? m.unknown_age_days + 'd assumed' : fmtAge(row.age_days)) + ')' }), el('b', { text: calc.maturityMult.toFixed(4) })),
        el('div', { class: 'total' }, el('span', { text: 'implied = base × growth × maturity' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { text: 'Recomputed from this row: ' + fmtUsd(calc.implied) +
        (calc.implied === row.implied_value_usd ? ' — the same number the board carries.' : ' — differs from the board; the data would be stale.') +
        ' The stored multipliers are growth ' + row.growth_multiplier + ' and maturity ' + row.maturity_multiplier + '.' })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      })),
      el('p', { text: 'Generated in-page from this protocol’s own category, chains, TVL and age — the same rules the board program uses. A plan is not a promise of a token.' })
    ));
    // renderBoard rebuilds the rows and marks the selected one from state.
    renderBoard();
    // In the stacked (narrow) layout the detail panel sits below the whole
    // board, so bring it into view when a row is opened there.
    if (window.matchMedia('(max-width: 1100px)').matches) detail.scrollIntoView({ block: 'start' });
  }

  function setTab(tab) {
    state.tab = tab;
    $('tab-board').setAttribute('aria-selected', tab === 'board' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    $('board-section').hidden = tab !== 'board';
    $('live-section').hidden = tab !== 'live';
    if (tab === 'live') renderLive();
    else renderBoard();
  }

  function fillSelects() {
    var chains = {};
    var categories = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) { chains[c] = true; });
      categories[r.category || 'Other'] = true;
    });
    Object.keys(chains).sort().forEach(function (c) {
      $('chain').appendChild(el('option', { value: c, text: c }));
    });
    Object.keys(categories).sort().forEach(function (c) {
      $('category').appendChild(el('option', { value: c, text: c }));
    });
  }

  function renderHeader() {
    $('snapshot-date').textContent = DATA.as_of;
    $('model-version').textContent = DATA.model_version;
    $('count-ranked').textContent = String(DATA.board_size);
    $('count-watchlist').textContent = String(DATA.watchlist_size);
    $('count-live').textContent = String(DATA.live_size);
    $('fact-ranked').textContent = String(DATA.board_size);
    $('fact-watchlist').textContent = String(DATA.watchlist_size);
    $('fact-early').textContent = String(DATA.early_size);
    $('fact-live').textContent = String(DATA.live_size);
    $('fact-floor').textContent = fmtUsd(DATA.floor_usd);
  }

  function render() {
    if (state.tab === 'live') renderLive();
    else renderBoard();
  }

  if (!DATA) {
    $('result-count').textContent = 'No data loaded — data.js is missing or empty.';
  } else {
    renderHeader();
    fillSelects();
    $('search').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    $('chain').addEventListener('change', function (e) { state.chain = e.target.value; render(); });
    $('category').addEventListener('change', function (e) { state.category = e.target.value; render(); });
    $('watchlist-only').addEventListener('change', function (e) { state.watchlistOnly = e.target.checked; render(); });
    $('early-only').addEventListener('change', function (e) { state.earlyOnly = e.target.checked; render(); });
    $('tab-board').addEventListener('click', function () { setTab('board'); });
    $('tab-live').addEventListener('click', function () { setTab('live'); });
    document.querySelectorAll('#board-table th button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' || key === 'category' || key === 'chains' ? 1 : -1; }
        renderBoard();
      });
    });
    render();
  }
})();

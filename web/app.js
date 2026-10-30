/* Family Week: kitchen-display week planner for the Family. Plain JS, no dependencies.
   Data: /api/week (live server) or window.__FW_SNAPSHOT__ (offline snapshot).
   Rules: never invent events; unassigned drive legs say "needs a driver?"; calendar outages show honestly. */
'use strict';
const Q = new URLSearchParams(location.search);
const SNAP = window.__FW_SNAPSHOT__ || null;
const TZ = 'America/New_York';
const T0 = performance.now();
const FIXED_NOW = Q.get('now') ? Date.parse(Q.get('now')) : 0;
const S = {
  data: null, view: (() => { const v = Q.get('view') || localStorage.getItem('fw.view') || '7'; return v === 'tl' || v === 'timeline' ? 'tl' : +v === 14 ? 14 : 7; })(),
  kiosk: Q.has('kiosk') || location.pathname === '/kiosk', ambient: Q.get('mode') === 'ambient' || location.pathname === '/ambient',
  ambientAuto: Q.get('ambient') === 'auto', cfPage: 0, fetchErr: null, lastOk: 0, sig: '',
  now: () => (FIXED_NOW ? FIXED_NOW + (performance.now() - T0) : Date.now()),
};
if (S.kiosk && !Q.has('ambient')) S.ambientAuto = true;

// ------------------------------------------------------------------ helpers
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = (o) => new Intl.DateTimeFormat('en-US', {timeZone: TZ, ...o});
const F = {
  hm: fmt({hour: 'numeric', minute: '2-digit'}), wd: fmt({weekday: 'short'}), wdl: fmt({weekday: 'long'}),
  full: fmt({weekday: 'long', month: 'long', day: 'numeric'}), md: fmt({month: 'short', day: 'numeric'}),
  ymd: fmt({year: 'numeric', month: '2-digit', day: '2-digit'}), h24: fmt({hour: 'numeric', hour12: false}),
};
const iso = (t) => { const [m, d, y] = F.ymd.format(t).split('/'); return `${y}-${m}-${d}`; };
const pt = (s) => Date.parse(s);
const hm = (t) => F.hm.format(t);                       // "7:45 PM"
const hmShort = (t) => hm(t).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
function tr(e) {
  const a = hm(pt(e.start)), b = hm(pt(e.end));
  const [ta, ma] = a.split(' '), [tb, mb] = b.split(' ');
  return ma === mb ? `${ta}–${tb} ${mb}` : `${a}–${b}`;
}
function setHTML(el, html) { if (el && el.__h !== html) { el.innerHTML = html; el.__h = html; } }  // no re-render = no restarted animations
const P = () => Object.fromEntries((S.data?.people || []).map((p) => [p.key, p]));
const color = (k) => (P()[k] || {}).color || '#94a3c4';
const name = (k) => (P()[k] || {}).name || k;
function icon(e) {
  const t = e.title.toLowerCase();
  if (e.cal === 'alpha' || e.cal === 'club') return '⚽';
  if (/^api 11u/i.test(e.title)) return '⚾';
  if (/integrity/i.test(e.title)) return '🥍';
  if (e.cal === 'ravens') return '🏈';
  if (e.cal === 'work') return '💼';
  if (e.cal === 'holidays') return '🗓️';
  if (/conference|orlando/.test(t)) return '✈️';
  if (/hspt/.test(t)) return '📚';
  if (/pill/.test(t)) return '💊';
  if (/zoom/.test(t)) return '💻';
  return '•';
}
function cdShort(ms) {
  const m = Math.round(ms / 6e4);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}
const sevOf = {};
function relDay(t) {
  const n = S.now();
  if (iso(t) === iso(n)) return +F.h24.format(t) >= 17 ? 'tonight' : 'today';
  if (iso(t) === iso(n + 864e5)) return 'tomorrow';
  return F.wd.format(t);
}

// ------------------------------------------------------------------ data
async function load() {
  try {
    let d;
    if (SNAP) d = SNAP;
    else {
      const qs = new URLSearchParams();
      for (const k of ['now', 'simulate']) if (Q.get(k)) qs.set(k, Q.get(k));
      const r = await fetch('/api/week?' + qs, {cache: 'no-store'});
      if (!r.ok) throw new Error('HTTP ' + r.status);
      d = await r.json();
    }
    S.data = d; S.fetchErr = null; S.lastOk = Date.now();
  } catch (e) {
    S.fetchErr = String(e.message || e);
    if (!S.data) S.data = {calendar: {status: 'unavailable', error: 'Family Week server unreachable (' + S.fetchErr + ')', calendars: [], stats: {}},
      people: [], days: [], events: [], conflicts: [], games: [], tonight: [], weather: {state: 'unavailable'}, rules: []};
  }
  render();
}

// ------------------------------------------------------------------ render
function render() {
  const d = S.data; if (!d) return;
  document.body.classList.toggle('v14', S.view === 14);
  document.body.classList.toggle('vtl', S.view === 'tl');
  document.querySelectorAll('#viewToggle button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(S.view)));
  for (const k in sevOf) delete sevOf[k];
  const rank = {hard: 2, warn: 1};
  for (const c of d.conflicts) if (rank[c.severity]) for (const id of c.events) if ((rank[sevOf[id]] || 0) < rank[c.severity]) sevOf[id] = c.severity;
  renderChips(); renderPulse(); if (S.view === 'tl') renderTimeline(); else renderBoard(); renderTonight(); renderConflicts(); renderGames(); renderLegend(); renderAmbient();
}

function viewDays() { return (S.data.days || []).slice(0, S.view === 14 ? 14 : 7); }
const NDAYS = () => (S.view === 14 ? 14 : 7);
const EV = () => Object.fromEntries((S.data.events || []).map((e) => [e.id, e]));

function renderChips() {
  const c = S.data.calendar, w = S.data.weather || {};
  const chips = [];
  if (c.status === 'ok' || c.status === 'stale') {
    const when = c.fetchedAt ? `${F.md.format(pt(c.fetchedAt))} ${hm(pt(c.fetchedAt))}` : '?';
    const cls = c.status === 'stale' || (c.ageMin ?? 0) > 12 * 60 ? 'stale' : 'live';
    chips.push(`<span class="chip ${cls}" title="Calendar is a read-only snapshot">CALENDAR · READ ${esc(when)}</span>`);
    chips.push(`<span class="chip">${c.stats.unique} EVENTS · ${c.calendars.length} CALENDARS</span>`);
  } else if (c.status === 'empty') chips.push(`<span class="chip empty">CALENDAR · EMPTY</span>`);
  else chips.push(`<span class="chip unavailable">CALENDAR · UNAVAILABLE</span>`);
  const ws = w.state === 'live' ? 'live' : w.state === 'stale' ? 'stale' : 'unavailable';
  chips.push(`<span class="chip ${ws}">WEATHER · ${ws === 'unavailable' ? 'UNAVAILABLE' : (ws === 'stale' ? 'CACHED' : 'LIVE')}</span>`);
  if (SNAP) chips.unshift(`<span class="chip stale">OFFLINE SNAPSHOT · ${esc(F.md.format(pt(SNAP.now)))} ${esc(hm(pt(SNAP.now)))}</span>`);
  if (S.fetchErr && S.data.days.length) chips.push(`<span class="chip stale">SERVER · RETRYING</span>`);
  setHTML($('chips'), chips.join(''));
}

function legsIn(days) {
  const set = new Set(days.map((x) => x.date)), out = [];
  for (const e of S.data.events) if (!e.canceled) for (const l of e.legs) if (set.has(l.date)) out.push({e, l});
  return out;
}
function renderPulse() {
  const days = viewDays(), set = new Set(days.map((x) => x.date));
  const cf = S.data.conflicts.filter((c) => set.has(c.date));
  const hard = cf.filter((c) => c.severity === 'hard').length, warn = cf.filter((c) => c.severity === 'warn').length;
  const L = legsIn(days);
  const needs = L.filter((x) => x.l.driver == null).length, family = L.filter((x) => x.l.driver === 'Family').length;
  const games = S.data.games.filter((g) => set.has(g.date)).length;
    const box = (cls, k, v, sm) => `<div class="pstat ${cls}"><div class="k">${k}</div><div class="v">${v}<small>${sm}</small></div></div>`;
  const ok = S.data.calendar.status === 'ok' || S.data.calendar.status === 'stale';
  setHTML($('pulse'), ok ? [
    box(hard ? 'red' : warn ? 'amber' : 'green', 'CONFLICTS', hard + warn, (hard ? `${hard} hard · ${warn} ride${warn === 1 ? '' : 's'}` : warn ? `ride overlap${warn === 1 ? '' : 's'}` : 'all clear') + ` · ${NDAYS()}d`),
    box(needs ? 'amber' : 'green', 'NEEDS A DRIVER?', needs, `open legs · ${NDAYS()}d`),
    box('green', 'FAMILY DRIVE', family, `rule legs · ${NDAYS()}d`),
    box('cyan', 'GAMES', games, `${games === 1 ? 'game' : 'games'} · ${NDAYS()}d`),
  ].join('') : box('red', 'CALENDAR', '—', esc(S.data.calendar.status)));
}

function legHTML(l, mode) {
  const ar = l.type === 'drop' ? '↓' : l.type === 'pickup' ? '↑' : '🚗';
  const t = l.time ? (mode === 'tn' ? hm(pt(l.time)).replace(' ', '\u202f') : hmShort(pt(l.time))) : '';
  const who = l.driver == null ? (mode === 'full' || mode === 'tn' || mode === 'compact' ? S.data.unassignedLabel : 'driver?') : l.driver;
  const cls = l.driver == null ? 'needs' : l.driver === 'Family' ? 'family' : 'carpool';
  const lab = l.type === 'trip' ? esc(l.label) + ' · ' : '';
  const verb = mode === 'tn' && l.type !== 'trip' ? (l.type === 'drop' ? 'drop ' : 'pick up ') : '';
  return `<span class="leg ${cls}"><span class="ar">${ar}</span>${verb}${t ? esc(t) + ' ' : ''}${lab}${esc(who)}</span>`;
}

function card(e, ds, mode, now) {
  const c = color(e.person);
  const cls = ['ev', mode];
  if (e.allDay) cls.push('allday');
  if (e.kind === 'tv') cls.push('tv');
  if (e.canceled) cls.push('canceled');
  if (e.kind === 'placeholder') cls.push('placeholder');
  if (!e.allDay && pt(e.end) < now) cls.push('past');
  const sev = sevOf[e.id]; if (sev && !e.canceled) cls.push('c-' + sev);
  let time;
  if (e.allDay) {
    const i = e.dates.indexOf(ds), n = e.dates.length;
    time = n > 1 ? `DAY ${i + 1}/${n}` : 'ALL DAY';
  } else time = mode === 'full' ? tr(e) : hmShort(pt(e.start));
  const flags = [];
  if (e.canceled) flags.push('<span class="flag cx">CANCELED</span>');
  if (e.kind === 'placeholder') flags.push('<span class="flag ph">PLACEHOLDER</span>');
  if (sev && !e.canceled) flags.push(`<span class="flag ${sev}">⚠</span>`);
  const place = e.venue || e.town ? [e.venue, e.town].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ') : (e.allDay || e.kind === 'tv' ? '' : e.kind === 'placeholder' ? 'time & place TBD' : 'place not on calendar');
  const legs = e.legs.filter((l) => l.date === ds);
  return `<div class="${cls.join(' ')}" style="--c:${c}" data-id="${e.id}">
    <div class="et"><span class="ic">${icon(e)}</span>${esc(time)}${flags.join('')}</div>
    <div class="tt">${esc(e.short)}</div>
    ${place && (mode === 'full' || mode === 'compact') ? `<div class="pl">${esc(place)}</div>` : ''}
    ${legs.length && !e.canceled && mode !== 'mini' ? `<div class="legs">${legs.map((l) => legHTML(l, mode)).join('')}</div>` : ''}
  </div>`;
}

const LANES = ['kidb', 'kida', 'parenta', 'randi', 'family'];
const LANE_SUB = {kidb: '8th · Club ⚽ · Delta 🥍', kida: '6th · Alpha ⚽ · Bravo ⚾', parenta: 'work · travel', randi: '', family: 'house · holidays · TV'};
function renderBoard() {
  const d = S.data, days = viewDays(), ev = EV(), now = S.now();
  const b = $('board');
  b.style.setProperty('--n', Math.max(days.length, 1));
  const st = d.calendar.status;
  const parts = [`<div class="corner">${NDAYS()} DAYS<br>${days[0] ? esc(F.md.format(pt(days[0].date + 'T12:00:00-04:00')).toUpperCase()) : ''}–${days.length ? esc(F.md.format(pt(days[days.length - 1].date + 'T12:00:00-04:00')).toUpperCase()) : ''}</div>`];
  for (const day of days) {
    const w = day.weather;
    const wx = w ? `<div class="wx"><div class="ic">${w.icon || ''}</div><div class="t"><b>${Math.round(w.hi)}°</b> ${Math.round(w.lo)}°</div>${w.pop ? `<div class="pp">${Math.round(w.pop)}%☂</div>` : ''}</div>`
      : `<div class="wx na">no<br>forecast</div>`;
    const cfs = day.conflicts.map((id) => d.conflicts.find((c) => c.id === id));
    const hard = cfs.filter((c) => c.severity === 'hard').length, warn = cfs.filter((c) => c.severity === 'warn').length;
    const badges = [];
    if (hard) badges.push(`<span class="badge hard">⚠ ${hard}</span>`);
    if (warn) badges.push(`<span class="badge warn">🚗 ${warn}</span>`);
    for (const p of [...new Set(day.gameDay)]) badges.push(`<span class="badge game" style="background:${color(p)}">${S.view === 14 ? name(p)[0] : name(p).toUpperCase()}</span>`);
    if (day.away) badges.push(`<span class="badge away">✈${S.view === 14 ? '' : ' AWAY'}</span>`);
    const we = day.dow === 'Sat' || day.dow === 'Sun';
    parts.push(`<div class="dayh${day.isToday ? ' today' : ''}${we ? ' weekend' : ''}"><div class="row1"><span class="dw">${day.isToday ? 'TODAY' : day.dow.toUpperCase()}</span></div>
      <div class="row1"><span class="dd">${day.dom}</span><span class="mo">${esc(day.month.toUpperCase())}</span></div>${wx}<div class="badges">${badges.join('')}</div></div>`);
  }
  if (st !== 'ok' && st !== 'stale') {
    const bad = st === 'unavailable';
    parts.push(`<div class="board-msg${bad ? ' bad' : ''}"><div><div class="big">${bad ? 'Calendar unavailable' : 'Nothing on the calendar'}</div>
      <div class="small">${bad ? esc(d.calendar.error || 'The calendar snapshot could not be read.') + '<br>Nothing is shown rather than guessed.' : 'No events were found on any connected calendar for these days. Nothing has been made up to fill the space.'}</div></div></div>`);
    setHTML(b, parts.join('')); return;
  }
  const randiAny = days.some((day) => day.events.some((id) => ev[id].person === 'randi'));
  for (const lane of LANES) {
    parts.push(`<div class="lane-h" style="--c:${color(lane)}"><div class="nm">${esc(name(lane))}</div>${LANE_SUB[lane] ? `<div class="sub">${esc(LANE_SUB[lane])}</div>` : ''}</div>`);
    if (lane === 'randi' && !randiAny) {
      parts.push(`<div class="randi-note"><b>Randi</b>no calendar of hers is connected, so nothing is shown here. Shared “Family” drive legs sit on the kids’ cards.</div>`);
      continue;
    }
    for (const day of days) {
      const list = day.events.map((id) => ev[id]).filter((e) => e.person === lane)
        .sort((a, b2) => (b2.allDay - a.allDay) || ((a.kind === 'placeholder') - (b2.kind === 'placeholder')) || (pt(a.start) - pt(b2.start)));
      const timed = list.filter((e) => !e.allDay).length;
      let mode;
      if (lane === 'parenta' || lane === 'family') mode = 'mini';
      else if (S.view === 14) mode = 'compact';
      else mode = timed <= 1 ? 'full' : timed === 2 ? 'compact' : 'tight';
      const cls = ['cell']; if (day.isToday) cls.push('today'); if (day.away && lane === 'parenta') cls.push('away');
      parts.push(`<div class="${cls.join(' ')}" data-lane="${lane}" data-date="${day.date}">${list.map((e) => card(e, day.date, (e.allDay && !e.legs.some((l) => l.date === day.date)) || (e.kind === 'placeholder' && mode !== 'full') ? 'mini' : (e.allDay ? 'tight' : mode), now)).join('') || (S.view === 7 && (lane === 'kidb' || lane === 'kida') ? '<div class="empty-day">·</div>' : '')}</div>`);
    }
  }
  if (b.__h !== parts.join('')) { setHTML(b, parts.join('')); requestAnimationFrame(clampCells); }
}
function clampCells() {
  document.querySelectorAll('#board .cell').forEach((cell) => {
    cell.querySelectorAll('.more').forEach((m) => m.remove());
    const cards = [...cell.querySelectorAll('.ev')]; cards.forEach((c) => (c.style.display = ''));
    if (cell.scrollHeight <= cell.clientHeight + 1) return;
    let hidden = 0;
    for (let i = cards.length - 1; i > 0 && cell.scrollHeight > cell.clientHeight; i--) { cards[i].style.display = 'none'; hidden++; cell.dataset.more = hidden; if (!cell.querySelector('.more')) cell.insertAdjacentHTML('beforeend', '<div class="more"></div>'); cell.querySelector('.more').textContent = `+${hidden} more`; }
  });
}


// ------------------------------------------------------------------ timeline view (drive plan on a clock)
const TL0 = 7, TL1 = 23;  // 7 AM – 11 PM
function xPct(t, ds) {
  const base = pt(ds + 'T00:00:00-04:00');  // ET midnight (EDT through Nov 1)
  const h = (t - base) / 36e5;
  return Math.max(0, Math.min(100, ((h - TL0) / (TL1 - TL0)) * 100));
}
function renderTimeline() {
  const d = S.data, days = viewDays(), ev = EV(), now = S.now();
  const b = $('board');
  const st = d.calendar.status;
  const hours = [];
  for (let h = TL0; h <= TL1; h += 1) hours.push(`<div class="tl-hr${h % 3 ? ' minor' : ''}" style="left:${((h - TL0) / (TL1 - TL0)) * 100}%"><span>${h % 3 ? '' : (h % 12 || 12) + (h < 12 ? 'a' : 'p')}</span></div>`);
  const parts = [`<div class="tl-corner mono">${days.length} DAYS<br><span style="color:${color('kidb')}">■</span> KID B <span style="color:${color('kida')}">■</span> KID A<br>▪ ADULTS</div><div class="tl-ad-h mono">ALL DAY</div><div class="tl-axis">${hours.join('')}</div>`];
  if (st !== 'ok' && st !== 'stale') {
    parts.push(`<div class="board-msg${st === 'unavailable' ? ' bad' : ''}" style="grid-row:2/-1"><div><div class="big">${st === 'unavailable' ? 'Calendar unavailable' : 'Nothing on the calendar'}</div><div class="small">${esc(d.calendar.error || 'Nothing is shown rather than guessed.')}</div></div></div>`);
    setHTML(b, `<div class="tl">${parts.join('')}</div>`); return;
  }
  const subl = ['kidb', 'kida', 'adult'];
  for (const day of days) {
    const list = day.events.map((id) => ev[id]);
    const allDay = list.filter((e) => e.allDay);
    const timed = list.filter((e) => !e.allDay);
    const we = day.dow === 'Sat' || day.dow === 'Sun';
    parts.push(`<div class="tl-day${day.isToday ? ' today' : ''}${we ? ' weekend' : ''}"><div class="dw">${day.isToday ? 'TODAY' : day.dow.toUpperCase()}</div><div class="dd">${day.dom}</div>
      <div class="wx">${day.weather ? `${day.weather.icon || ''} ${Math.round(day.weather.hi)}°` : ''}</div></div>`);
    parts.push(`<div class="tl-ad">${allDay.map((e) => `<div class="tl-pill${e.canceled ? ' canceled' : ''}" style="--c:${color(e.person)}">${icon(e)} ${esc(e.short)}${e.legs.some((l) => l.date === day.date) ? ' ' + e.legs.filter((l) => l.date === day.date).map((l) => legDot(l)).join('') : ''}</div>`).join('')}</div>`);
    // conflict bands
    const bands = day.conflicts.map((id) => d.conflicts.find((c) => c.id === id)).filter((c) => c.severity !== 'info').map((c) => {
      const es = c.events.map((id) => ev[id]).filter((e) => e && !e.allDay);
      if (!es.length) return '';
      const s0 = Math.min(...es.map((e) => pt(e.start))), s1 = Math.max(...es.map((e) => pt(e.end)));
      const a = xPct(s0, day.date), z = xPct(s1, day.date);
      return `<div class="tl-band ${c.severity}" style="left:${a}%;width:${Math.max(z - a, 1.2)}%"><span>${c.severity === 'hard' ? '⚠' : '🚗'} ${esc(c.title)}</span></div>`;
    }).join('');
    const lanes = subl.map((ln) => {
      const es = timed.filter((e) => (ln === 'adult' ? !['kidb', 'kida'].includes(e.person) : e.person === ln));
      return `<div class="tl-sub ${ln}">${es.map((e) => {
        const a = xPct(pt(e.start), day.date), z = xPct(pt(e.end), day.date);
        const cls = ['tl-bar']; if (e.canceled) cls.push('canceled'); if (e.kind === 'placeholder') cls.push('placeholder'); if (pt(e.end) < now) cls.push('past');
        const sev = sevOf[e.id]; if (sev && !e.canceled) cls.push('c-' + sev);
        if (ln === 'adult') cls.push('thin');
        const legs = e.legs.filter((l) => l.date === day.date && l.time);
        const drop = legs.find((l) => l.type === 'drop'), pick = legs.find((l) => l.type === 'pickup');
        return `<div class="${cls.join(' ')}" style="--c:${color(e.person)};left:${a}%;width:${Math.max(z - a, .8)}%"><span class="tx">${icon(e)} ${esc(e.short)}</span></div>`
          + (drop && !e.canceled ? `<span class="tl-leg l" style="left:${a}%">${legDot(drop)}</span>` : '')
          + (pick && !e.canceled ? `<span class="tl-leg r" style="left:${z}%">${legDot(pick)}</span>` : '');
      }).join('')}</div>`;
    }).join('');
    const nowLine = day.isToday && now >= pt(day.date + 'T07:00:00-04:00') && now <= pt(day.date + 'T23:00:00-04:00') ? `<div class="tl-now" style="left:${xPct(now, day.date)}%"></div>` : '';
    parts.push(`<div class="tl-row${day.isToday ? ' today' : ''}">${hours.map((h) => h.replace('tl-hr', 'tl-grid')).join('')}${bands}${lanes}${nowLine}</div>`);
  }
  setHTML(b, `<div class="tl" style="--rows:${days.length}">${parts.join('')}</div>`);
}
function legDot(l) {
  const cls = l.driver == null ? 'needs' : l.driver === 'Family' ? 'family' : 'carpool';
  const ar = l.type === 'drop' ? '↓' : l.type === 'pickup' ? '↑' : '🚗';
  const who = l.driver == null ? '?' : l.driver === 'Family' ? 'B' : 'C';
  return `<span class="ld ${cls}" title="${esc(l.type)} · ${esc(l.driver || 'needs a driver?')}">${ar}${who}</span>`;
}

function nextLegs(now) {
  const out = [];
  for (const e of S.data.events) if (!e.canceled) for (const l of e.legs) if (l.time && pt(l.time) > now && l.driver !== 'Carpool') out.push({e, l, t: pt(l.time)});
  return out.sort((a, b) => a.t - b.t);
}
function renderTonight() {
  const d = S.data, now = S.now(), ev = EV();
  const w = d.weather || {}, today = d.days[0];
  const cur = w.current, wd = today && today.weather;
  const sunset = wd && wd.sunset ? hm(pt(wd.sunset)) : null;
  const hr = (w.hourly || []).filter((h) => pt(h.time) >= now - 36e5 && +F.h24.format(pt(h.time)) >= 17 && +F.h24.format(pt(h.time)) <= 22);
  const wxLine = cur ? `<div class="big">${cur.icon || ''} ${Math.round(cur.temp)}°</div>${sunset ? `sunset ${esc(sunset)}` : ''}${hr.length ? `<br>${hr.filter((_, i) => i % 2 === 0).slice(0, 2).map((h) => `${hmShort(pt(h.time))} ${Math.round(h.temp)}°`).join(' · ')}` : ''}`
    : (wd ? `<div class="big">${wd.icon || ''} ${Math.round(wd.hi)}°</div>low ${Math.round(wd.lo)}°` : 'weather unavailable');
  const late = +F.h24.format(now) >= 21;
  const head = `<div class="tn-head"><div class="tn-title"><small>${late ? 'TONIGHT · THEN TOMORROW' : 'TONIGHT'} · ${esc(F.full.format(now).toUpperCase())}</small>${late ? 'Tonight & tomorrow' : 'Tonight'}</div><div class="tn-wx">${wxLine}</div></div>`;
  const ok = d.calendar.status === 'ok' || d.calendar.status === 'stale';
  if (!ok) { setHTML($('tonight'), head + `<div class="tn-none">${d.calendar.status === 'empty' ? 'Nothing on the calendar tonight.' : 'Calendar unavailable, so there is no plan to show. Nothing is guessed.'}</div>`); return; }
  let ids = d.tonight.slice();
  let label = '';
  if (late || !ids.length) {
    const tm = d.days[1];
    if (tm) { const add = tm.events.filter((id) => !ev[id].allDay && ev[id].kind !== 'meeting' && !ev[id].canceled); if (!ids.length) label = 'tomorrow'; ids = ids.concat(add); }
  }
  ids = ids.filter((id) => ev[id].kind !== 'meeting' || ev[id].dates[0] === today.date);
  const items = ids.slice(0, 2).map((id) => {
    const e = ev[id], c = color(e.person);
    const legs = e.legs.filter((l) => !e.canceled);
    const tomorrow = e.dates[0] !== today.date;
    return `<div class="tn-item${pt(e.end) < now ? ' past' : ''}" style="--c:${c}"><div><div class="tt0">${esc(hm(pt(e.start)).replace(' ', '\u202f'))}</div><div class="tt1">${tomorrow ? 'TOMORROW' : 'to ' + esc(hm(pt(e.end)))}</div></div>
      <div><div class="what"><span class="who">${esc(name(e.person))}</span> · ${esc(e.short)}</div><div class="where">${esc([e.venue, e.town].filter(Boolean).join(' · ') || 'place not on calendar')}</div>
      ${legs.length ? `<div class="legs">${legs.map((l) => legHTML(l, 'tn')).join('')}</div>` : ''}</div></div>`;
  });
  const nl = nextLegs(now)[0];
  const next = nl ? `<div class="tn-next">NEXT DRIVE · <b>${esc(relDay(nl.t).toUpperCase())} ${esc(hm(nl.t))}</b> ${nl.l.type === 'drop' ? 'drop' : 'pick up'} ${esc(name(nl.e.person))} · ${esc(nl.l.driver || S.data.unassignedLabel)} · <span data-cd="${nl.t}"></span></div>` : '';
  const done = today ? today.events.map((id) => ev[id]).filter((e) => !e.allDay && !e.canceled && e.kind !== 'meeting' && pt(e.end) > pt(today.date + 'T15:00:00-04:00') && pt(e.end) <= now) : [];
  const doneTxt = done.length ? `Tonight is wrapped up (${done.map((e) => esc(name(e.person)) + '’s ' + esc(e.short)).join(', ')} done).` : 'Nothing on the calendar tonight.';
  const none = !items.length ? `<div class="tn-none">${doneTxt} Nothing on the calendar tomorrow either.</div>` : (label ? `<div class="tn-next">${doneTxt} Tomorrow:</div>` : '');
  setHTML($('tonight'), head + none + `<div class="tn-list">${items.join('')}</div>` + next);
}

function dlabel(ds) { const t = pt(ds + 'T12:00:00-04:00'); return `${F.wd.format(t).toUpperCase()} ${F.md.format(t).toUpperCase()}`; }
function renderConflicts() {
  const d = S.data, all = d.conflicts;
  const n = (s) => all.filter((c) => c.severity === s).length;
  const head = `<div class="ph"><div class="ph-t"><span class="dot" style="background:var(--red);color:var(--red)"></span>CONFLICTS · NEXT 14 DAYS</div>
    <div class="cf-counts"><span class="badge hard">${n('hard')} HARD</span><span class="badge warn">${n('warn')} RIDES</span><span class="badge">${n('info')} NOTES</span></div></div>`;
  const ok = d.calendar.status === 'ok' || d.calendar.status === 'stale';
  if (!ok) { setHTML($('conflicts'), head + `<div class="tn-none">No calendar data, so no conflicts can be checked.</div>`); return; }
  if (!all.length) { setHTML($('conflicts'), head + `<div class="tn-none">No overlaps found in the next 14 days.</div>`); return; }
  const today = d.days[0]?.date || '';
  const order = {hard: 0, warn: 1, info: 2};
  const list = all.filter((c) => c.date >= today).slice().sort((a, b) => (order[a.severity] > 1) - (order[b.severity] > 1) || a.date.localeCompare(b.date) || order[a.severity] - order[b.severity]);
  const html = list.map((c) => `<div class="cf ${c.severity}" data-c="${c.id}"><div class="h"><span class="d">${esc(dlabel(c.date))}</span><span class="t">${esc(c.title)}</span></div>
    <ul>${c.items.slice(0, 4).map((i) => `<li>${esc(i)}</li>`).join('')}</ul><div class="n">${esc(c.note)}</div></div>`).join('');
  setHTML($('conflicts'), head + `<div class="cf-list" id="cfList">${html}</div>`);
  requestAnimationFrame(pageConflicts);
}
function pageConflicts() {
  const box = $('conflicts'), list = $('cfList'); if (!list) return;
  const items = [...list.children]; items.forEach((x) => (x.style.display = ''));
  const avail = box.clientHeight - list.offsetTop - 18;
  const pages = []; let cur = [], h = 0;
  for (const it of items) { const ih = it.offsetHeight + 9; if (cur.length && h + ih > avail) { pages.push(cur); cur = []; h = 0; } cur.push(it); h += ih; }
  if (cur.length) pages.push(cur);
  S.cfPages = pages.length;
  const p = pages[S.cfPage % pages.length] || [];
  items.forEach((x) => (x.style.display = p.includes(x) ? '' : 'none'));
  let pg = box.querySelector('.cf-page');
  if (pages.length > 1) { if (!pg) { box.querySelector('.ph-t').insertAdjacentHTML('beforeend', '<span class="cf-page"></span>'); pg = box.querySelector('.cf-page'); } pg.textContent = `${(S.cfPage % pages.length) + 1}/${pages.length}`; }
}

function renderGames() {
  const d = S.data, now = S.now();
  const head = `<div class="ph"><div class="ph-t"><span class="dot" style="background:var(--pink);color:var(--pink)"></span>GAME DAYS</div><span class="cf-page">${d.games.length} in 14 days</span></div>`;
  const ok = d.calendar.status === 'ok' || d.calendar.status === 'stale';
  if (!ok || !d.games.length) { setHTML($('games'), head + `<div class="tn-none">${ok ? 'No games on the calendar in the next 14 days.' : 'No calendar data.'}</div>`); return; }
  const ev = EV();
  const html = d.games.slice(0, 3).map((g, i) => {
    const e = ev[g.id], t = g.allDay ? pt(g.date + 'T00:00:00-04:00') : pt(g.start);
    const when = g.allDay ? `${F.wd.format(t)} ${F.md.format(t)} · all day` : `${F.wd.format(t)} ${F.md.format(t)} · ${hm(t)}`;
    return `<div class="gm${i === 0 ? ' first' : ''}" style="--c:${color(g.person)}"><div class="ic">${icon(e)}</div>
      <div style="min-width:0"><div class="nm"><span class="who">${esc(name(g.person))}</span> · ${esc(g.short)}</div><div class="sub">${esc(when)} · ${esc(g.town || g.venue || 'place TBD')}</div></div>
      <div class="cd"><span data-cd="${t}" data-allday="${g.allDay ? 1 : 0}" data-end="${pt(e.end)}"></span><small>${g.allDay ? 'STARTS' : 'KICKOFF'}</small></div></div>`;
  }).join('');
  setHTML($('games'), head + `<div class="gm-list">${html}</div>`);
}

function renderLegend() {
  const d = S.data, c = d.calendar;
  const sw = LANES.map((k) => `<span class="sw" style="--c:${color(k)}"><span class="sq"></span>${esc(name(k))}</span>`).join('');
  const legs = `<span class="leg carpool"><span class="ar">↓</span>drop · Carpool</span><span class="leg family"><span class="ar">↑</span>pick up · Family</span><span class="leg needs">${esc(d.unassignedLabel || 'needs a driver?')}</span>`;
  const src = c.calendars && c.calendars.length ? `Google Calendar (read-only) · ${c.calendars.length} calendars · ${c.stats.raw} events read, ${c.stats.duplicates} duplicates merged, ${c.stats.canceled} canceled · weather via Parent A Wall (${esc((d.weather || {}).source || 'n/a')})` : 'calendar: no data';
  setHTML($('legend'), sw + '<span class="sep"></span>' + legs + `<span class="sep"></span><span>Rules: Kid A practices carpool ↓ Family ↑ · Tue Kid B carpools ↓ · Thu Family drive Kid B ↓ · nobody else is auto-assigned</span><span class="src">${src}</span>`);
}

function renderAmbient() {
  const d = S.data; if (!d) return;
  const now = S.now(), nl = nextLegs(now)[0];
  const set = new Set(viewDays().slice(0, 7).map((x) => x.date));
  const hard = d.conflicts.filter((c) => set.has(c.date) && c.severity !== 'info').length;
  setHTML($('ambNext'), nl ? `Next drive · <span class="who" style="color:${color(nl.e.person)}">${esc(name(nl.e.person))}</span> ${nl.l.type === 'drop' ? 'drop-off' : 'pickup'} ${esc(relDay(nl.t))} at ${esc(hm(nl.t))} · ${esc(nl.l.driver || d.unassignedLabel)}` : (d.calendar.status === 'ok' ? 'No drives on the calendar' : 'Calendar unavailable'));
  setHTML($('ambSub'), nl ? `${esc(nl.e.short)} · ${esc([nl.e.venue, nl.e.town].filter(Boolean).join(' · ') || 'place not on calendar')} · ${hard} conflict${hard === 1 ? '' : 's'} this week` : '');
}

// ------------------------------------------------------------------ clock + countdowns
function tick() {
  const n = S.now();
  const [t, ap] = hm(n).split(' ');
  $('clkHM').textContent = t; $('clkAP').textContent = ap;
  $('clkDate').textContent = F.full.format(n);
  $('ambClock').textContent = t; $('ambDate').textContent = F.full.format(n);
  document.querySelectorAll('[data-cd]').forEach((el) => {
    const ms = +el.dataset.cd - n, end = +el.dataset.end || 0;
    let s;
    if (ms > 0) s = cdShort(ms);
    else if (end && n < end) s = el.dataset.allday === '1' ? 'today' : 'LIVE';
    else s = 'now';
    if (el.textContent !== s) el.textContent = s;
  });
  if (S.ambientAuto) { const h = +F.h24.format(n) % 24; setAmbient(h >= 23 || h < 6); }
}
function setAmbient(on) { if (S.ambient === on && document.body.classList.contains('ambient') === on) return; S.ambient = on; document.body.classList.toggle('ambient', on); }
function setView(v) { S.view = v; try { localStorage.setItem('fw.view', v); } catch (e) {} S.cfPage = 0; render(); }

// ------------------------------------------------------------------ stage + sky
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080), st = $('stage');
  st.style.transform = `scale(${s})`; st.style.left = `${(innerWidth - 1920 * s) / 2}px`; st.style.top = `${(innerHeight - 1080 * s) / 2}px`;
  const c = $('sky'); c.width = innerWidth; c.height = innerHeight;
}
function shift() { const a = Math.random() * Math.PI * 2, r = 3; $('stage').style.translate = `${(Math.cos(a) * r).toFixed(1)}px ${(Math.sin(a) * r).toFixed(1)}px`; }
const stars = [];
function sky() {
  const c = $('sky'), g = c.getContext('2d');
  if (!stars.length) for (let i = 0; i < 180; i++) stars.push({x: Math.random(), y: Math.random(), z: Math.random() * .8 + .2, tw: Math.random() * 6.28});
  let last = 0;
  const frame = (t) => {
    requestAnimationFrame(frame);
    if (t - last < 50) return; last = t;
    const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    const drift = t * 0.000003;
    for (const s of stars) {
      const a = (0.2 + 0.5 * s.z) * (0.75 + 0.25 * Math.sin(t * 0.001 * s.z + s.tw)) * (S.ambient ? 1 : 0.55);
      g.fillStyle = `rgba(210,220,255,${a.toFixed(3)})`; g.fillRect(((s.x + drift * s.z) % 1) * W, s.y * H, s.z * 1.6, s.z * 1.6);
    }
  };
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ boot
function boot() {
  if (S.kiosk) document.body.classList.add('kiosk');
  if (S.ambient) document.body.classList.add('ambient');
  if (Q.has('still')) document.body.classList.add('noanim');
  fit(); addEventListener('resize', () => { fit(); clampCells(); pageConflicts(); });
  sky(); tick(); load();
  setInterval(tick, 1000);
  if (!SNAP) setInterval(load, 60e3); else setInterval(render, 60e3);
  if (!Q.has('still')) {
    setInterval(() => { if ((S.cfPages || 1) > 1) { S.cfPage++; pageConflicts(); } }, 12e3);
    setInterval(shift, 60e3);
    if (Q.has('cycle')) setInterval(() => setView(S.view === 7 ? 'tl' : S.view === 'tl' ? 14 : 7), 45e3);
  }
  if (S.kiosk && !SNAP) setTimeout(() => location.reload(), 6 * 36e5);
  if (!S.kiosk && !Q.has('still')) { $('hint').classList.add('show'); setTimeout(() => $('hint').classList.remove('show'), 8000); }
  document.querySelectorAll('#viewToggle button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.v === 'tl' ? 'tl' : +b.dataset.v)));
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === '7' || k === '1') setView(k === '7' ? 7 : k === '1' ? 14 : (S.view === 7 ? 14 : 7));
    else if (k === 't') setView(S.view === 'tl' ? 7 : 'tl');
    else if (k === 'a') { S.ambientAuto = false; setAmbient(!S.ambient); }
    else if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
    else if (k === 'r') load();
  });
  window.FW = S;  // for tests
}
boot();

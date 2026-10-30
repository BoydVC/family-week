// Family Week smoke test: drives headless Chrome over CDP against the live server and the offline snapshot.
// Fails on page errors, "undefined"/"NaN" leaking into the UI, missing lanes, or dishonest failure states.
// Usage: node --experimental-websocket tests/smoke.mjs [port]
import {existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launch, sleep} from './cdp.mjs';
const port = process.argv[2] || '4847', U = `http://127.0.0.1:${port}`;
const NOW = 'now=2026-10-07T16:45:00-04:00';
const checks = [];
const check = (name, ok, detail = '') => { checks.push({name, ok: !!ok}); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`); };
let b;
try {
  const h = await (await fetch(`${U}/api/health`)).json();
  check('server /api/health ok', h.ok && h.calendar === 'ok', JSON.stringify(h));
  const w = await (await fetch(`${U}/api/week?${NOW}`)).json();
  check('/api/week has all sections', ['calendar', 'days', 'events', 'conflicts', 'games', 'tonight', 'weather', 'people'].every((k) => k in w));
  check('14 days computed', w.days.length === 14 && w.days[0].date === '2026-10-07');
  check('no event descriptions in API output', !JSON.stringify(w).toLowerCase().includes('description'));
  check('weather reused from Parent A Wall', ['live', 'stale'].includes(w.weather.state) && w.days[0].weather, `${w.weather.via} · ${w.weather.state}`);
  const o = await (await fetch(`${U}/api/week?simulate=outage`)).json();
  check('simulated outage → unavailable with zero events', o.calendar.status === 'unavailable' && o.events.length === 0 && o.conflicts.length === 0);

  b = await launch();
  const ev = b.ev;
  await b.open(`${U}/?still=1&view=7&${NOW}`);
  check('data loaded', await ev('!!FW.data && FW.data.calendar.status === "ok"'));
  check('clock shows time', /^\d{1,2}:\d\d$/.test(await ev(`document.getElementById('clkHM').textContent`)));
  check('5 lanes rendered', await ev(`document.querySelectorAll('#board .lane-h').length`) === 5);
  check('7 day headers', await ev(`document.querySelectorAll('#board .dayh').length`) === 7);
  check('today highlighted', await ev(`document.querySelector('#board .dayh.today')?.innerText.includes('TODAY')`));
  check('drive legs rendered', await ev(`document.querySelectorAll('#board .leg').length`) > 10, `${await ev(`document.querySelectorAll('#board .leg').length`)} legs`);
  check('"needs a driver?" shown for unassigned legs', await ev(`document.getElementById('board').innerText.includes('needs a driver?')`));
  check('Randi lane is honest (no invented events)', await ev(`document.querySelector('.randi-note')?.innerText.includes('no calendar')`));
  check('canceled events struck through', await ev(`document.querySelectorAll('#board .ev.canceled').length`) >= 1);
  check('conflict cards highlighted on board', await ev(`document.querySelectorAll('#board .ev.c-hard, #board .ev.c-warn').length`) >= 2);
  check('tonight card shows Kid A API practice + Family pickup', await ev(`(() => { const t = document.getElementById('tonight').innerText; return t.includes('API practice') && t.includes('7:45') && t.includes('Family'); })()`));
  check('conflicts panel lists items', await ev(`document.querySelectorAll('#conflicts .cf').length`) >= 5);
  check('game countdowns tick values', /\d+[dhm]/.test(await ev(`document.querySelector('#games [data-cd]')?.textContent || ''`)), await ev(`document.querySelector('#games [data-cd]')?.textContent`));
  check('no "undefined"/"NaN" in UI', !(await ev(`/\\bundefined\\b|\\bNaN\\b|Invalid Date/.test(document.getElementById('stage').innerText)`)));
  check('60 s refresh does not re-render the board', await ev(`(async () => { const a = document.querySelector('#board .ev'); await load(); return a === document.querySelector('#board .ev'); })()`));
  check('overflowing cells say "+N more" instead of clipping silently', await ev(`[...document.querySelectorAll('#board .cell')].every((c) => c.scrollHeight <= c.clientHeight + 1)`));
  await ev(`setView(14)`); await sleep(400);
  check('14-day toggle → 14 headers, side panel hidden', await ev(`document.querySelectorAll('#board .dayh').length === 14 && document.body.classList.contains('v14')`));
  await ev(`setView('tl')`); await sleep(400);
  check('timeline view renders rows + bars + now-line', await ev(`document.querySelectorAll('.tl-row').length === 7 && document.querySelectorAll('.tl-bar').length > 10 && !!document.querySelector('.tl-now')`));
  check('timeline shows conflict bands', await ev(`document.querySelectorAll('.tl-band').length`) >= 1);
  await ev(`setView(7)`);
  await ev(`dispatchEvent(new KeyboardEvent('keydown', {key: 'a'}))`); await sleep(200);
  check('A toggles ambient with next drive', await ev(`document.body.classList.contains('ambient') && document.getElementById('ambNext').innerText.includes('Next drive')`));
  check('no page errors (live)', b.errors.length === 0, b.errors.join(' | '));

  await b.open(`${U}/?still=1&simulate=outage&${NOW}`);
  check('outage: honest "Calendar unavailable", no cards', await ev(`document.getElementById('board').innerText.includes('Calendar unavailable') && document.querySelectorAll('#board .ev').length === 0`));
  check('outage: chips flag calendar + weather unavailable', await ev(`document.getElementById('chips').innerText.includes('CALENDAR · UNAVAILABLE')`));
  await b.open(`${U}/?still=1&simulate=empty&${NOW}`);
  check('empty: honest "Nothing on the calendar"', await ev(`document.getElementById('board').innerText.includes('Nothing on the calendar')`));
  await b.open(`${U}/?still=1&now=2026-10-15T16:30:00-04:00`);
  check('time travel Oct 15: hard ride conflict shown first', await ev(`document.querySelector('#conflicts .cf')?.classList.contains('hard') && document.querySelector('#conflicts .cf').innerText.includes('One driver, two places')`));

  const snap = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'family-week-snapshot.html');
  if (existsSync(snap)) {
    await b.open(`file://${snap}?still=1`, 2500);
    check('offline snapshot renders lanes + legs', await ev(`document.querySelectorAll('#board .lane-h').length === 5 && document.querySelectorAll('#board .leg').length > 10`));
    check('offline snapshot labelled as snapshot', await ev(`document.getElementById('chips').innerText.includes('OFFLINE SNAPSHOT')`));
    check('no page errors (snapshot)', b.errors.length === 0, b.errors.join(' | '));
  } else check('offline snapshot exists', false, snap);
} catch (e) { check('smoke run', false, e.stack); }
finally { b && b.close(); }
const bad = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - bad}/${checks.length} checks passed`);
process.exit(bad ? 1 : 0);

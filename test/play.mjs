import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const E = require('../src/engine.cjs'); E.setMap(require('../src/map.json'));
const URL = process.env.URL || 'ws://localhost:8799/ws?room=' + (process.env.ROOM || 't' + Date.now());
const MODE = process.env.MODE || 'focus';
function client(name, role, token) {
  const ws = new WebSocket(URL); const c = { name, ws, log: [], handlers: {}, last: {} };
  c.send = (o) => ws.send(JSON.stringify(o));
  ws.onopen = () => c.send(role === 'teacher' ? { t: 'hello', role: 'teacher', pin: '1945' } : { t: 'hello', role: 'student', token });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); c.last[m.t] = m; (c.handlers[m.t] || (() => {}))(m); (c.handlers['*'] || (() => {}))(m); };
  c.on = (t, f) => { c.handlers[t] = f; };
  return c;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T = client('teacher', 'teacher');
const A = client('A', 'student', 'tokA' + Math.random()), B = client('B', 'student', 'tokB' + Math.random());
const result = { acts: 0, turns: 0, bounds: 0, errors: [] };
function play(c, side) {
  c.side = side;
  c.on('turn', async (m) => {
    result.turns++;
    let S = m.state;
    for (let i = 0; i < 12 && S.ap[side] > 0; i++) {
      const ids = E.REG_IDS.filter((id) => E.canAct(S, side, 'spread', id) === null);
      const nd = E.canAct(S, side, 'doctrine') === null ? 'doctrine' : null;
      const type = nd || 'spread'; const id = nd ? undefined : ids[Math.floor(Math.random() * ids.length)];
      if (!nd && !ids.length) break;
      const rid = Math.random();
      const res = await new Promise((resolve) => { c.on('actRes', resolve); c.send({ t: 'act', type, id, rid }); });
      result.acts++; S = res.state;
      if (!res.r.ok) result.errors.push(type + ' ' + res.r.msg);
      c.on('actRes', () => {});
    }
    c.send({ t: 'ready' });
  });
  c.on('resolved', (m) => { if (!m.resume) setTimeout(() => c.send({ t: 'ack' }), 20); });
  c.on('bplan', (m) => { if (m.submitted) return; const b = m.state.berlin; setTimeout(() => c.send({ t: 'bplan', plan: side === 'W' ? { alloc: [2, 1, b.flights - 3], card: 'hold' } : { lane: 1, card: 'hold' } }), 20); });
  c.on('bround', (m) => { result.bounds++; setTimeout(() => c.send({ t: 'back' }), 20); });
  c.on('over', (m) => { c.over = m; });
}
await sleep(500);
play(A, 'W'); play(B, 'E');
A.send({ t: 'sit', table: 1, side: 'W' }); B.send({ t: 'sit', table: 1, side: 'E' });
await sleep(300);
T.send({ t: 'tcmd', cmd: 'cfg', cfg: { mode: MODE, timer: 0, pace: 'teacher' } });
T.send({ t: 'tcmd', cmd: 'start', table: 1 });
T.on('lobby', (m) => { const t = m.tables[0]; if (t.stage === 'gate') T.send({ t: 'tcmd', cmd: 'next' }); });
const t0 = Date.now();
while (!(A.over && B.over) && Date.now() - t0 < 60000) await sleep(100);
console.log(MODE, 'over:', !!A.over, 'turns', result.turns, 'acts', result.acts, 'berlinRounds', result.bounds, 'errors', result.errors.slice(0, 3));
if (A.over) {
  const f = A.over.final; console.log('winner', f.winner, 'alt', f.alt);
  const sA = A.over.state, sB = B.over.state;
  console.log('enemy inf leaked to A?', E.REG_IDS.some((id) => sA.inf[id].E > 0), '| to B?', E.REG_IDS.some((id) => sB.inf[id].W > 0));
}
process.exit(0);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const URL = 'ws://localhost:8799/ws?room=rc' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(role, token) { const c = { got: [] }; c.ws = new WebSocket(URL); c.send = (o) => c.ws.send(JSON.stringify(o)); c.ws.onopen = () => c.send(role === 'teacher' ? { t: 'hello', role, pin: '1945' } : { t: 'hello', role, token }); c.ws.onmessage = (e) => { const m = JSON.parse(e.data); c.got.push(m.t + (m.resume ? '*' : '')); c.last = m; }; return c; }
const T = mk('teacher'); let A = mk('student', 'ta'); const B = mk('student', 'tb');
await sleep(400);
A.send({ t: 'sit', table: 1, side: 'W' }); B.send({ t: 'sit', table: 1, side: 'E' });
T.send({ t: 'tcmd', cmd: 'cfg', cfg: { mode: 'focus', timer: 4, pace: 'auto' } });
await sleep(300); T.send({ t: 'tcmd', cmd: 'start', table: 1 });
await sleep(800);
A.ws.close(); await sleep(300);
A = mk('student', 'ta'); await sleep(600);
console.log('A after reconnect:', A.got.join(','));
console.log('timer: waiting 5s for auto resolve...'); await sleep(5000);
console.log('B got resolved via alarm:', B.got.includes('resolved'), '| A:', A.got.includes('resolved'));
// wrong pin
const X = mk('teacher'); X.ws.onopen = () => X.send({ t: 'hello', role: 'teacher', pin: 'bad' }); await sleep(500); console.log('bad pin ->', X.got.join(','));
// student cannot use teacher cmd
A.send({ t: 'tcmd', cmd: 'reset', table: 'all' }); await sleep(300);
const T2 = mk('teacher'); await sleep(400); const tb = T2.last.tables[0]; console.log('table 1 still running after student tcmd attempt:', tb.stage);
process.exit(0);

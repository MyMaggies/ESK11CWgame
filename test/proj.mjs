const URL = 'ws://localhost:8799/ws?room=pj' + Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function mk(role, token) { const c = { got: [] }; c.ws = new WebSocket(URL); c.send = (o) => c.ws.send(JSON.stringify(o)); c.ws.onopen = () => c.send(role === 'teacher' ? { t: 'hello', role, pin: '1945' } : { t: 'hello', role, token }); c.ws.onmessage = (e) => { const m = JSON.parse(e.data); c.got.push(m.t); c.last = m; }; return c; }
const T = mk('teacher'), P = mk('projector'), A = mk('student', 'a'), B = mk('student', 'b');
await sleep(500); A.send({ t: 'sit', table: 1, side: 'W' }); B.send({ t: 'sit', table: 1, side: 'E' });
await sleep(300); T.send({ t: 'tcmd', cmd: 'start', table: 1 }); await sleep(1500);
const t = P.last.tables[0]; console.log('projector got:', P.got.filter((x) => x === 'proj').length, 'msgs; table1', t.stage, t.score, Object.keys(t.ctrl).length, 'regions', 'leaks?', JSON.stringify(P.last).includes('"inf"'));
T.send({ t: 'tcmd', cmd: 'spot', table: 1 }); await sleep(400); console.log('spot ->', P.last.spot);
process.exit(0);

// Iron Curtain 1945-49: classroom server.
// One Durable Object ("ClassRoom") holds every council table for a class. Each table is a 1v1 match
// (West seat vs East seat). The engine runs here, so students only ever receive their own side's view.
import { DurableObject } from 'cloudflare:workers';
import E from './engine.cjs';
import MAP from './map.json';

E.setMap(MAP);
E.seed((Date.now() ^ 0x9e3779b9) >>> 0);

const SIDES = ['W', 'E'];
const BERLIN_TURN = 7;
const DEFAULT_CFG = { mode: 'focus', timer: 240, pace: 'teacher', tables: 6 };
const clone = (x) => JSON.parse(JSON.stringify(x));

function newTable(id) {
  return {
    id, name: 'COUNCIL ' + id, stage: 'lobby', // lobby | acting | between | gate | berlin | over
    seats: { W: null, E: null }, bot: { W: false, E: false },
    S: null, ready: { W: false, E: false }, ack: { W: false, E: false },
    lines: [], disp: { W: [], E: [] }, notes: { W: [], E: [] }, recs: [], date: '',
    deadline: 0, bp: { W: null, E: null }, bphase: 'plan', final: null, mode: 'focus'
  };
}

// What a student is allowed to see: their own influence, public control results, and what they have scouted.
function redact(s, side) {
  const en = E.other(side);
  const ctrlPub = {};
  for (const id of E.REG_IDS) ctrlPub[id] = E.ctrl(s, id);
  const c = clone(s);
  c.ctrlPub = ctrlPub;
  for (const id of E.REG_IDS) c.inf[id][en] = 0;
  c.know[en] = {}; c.acts[en] = []; c.lastActs[en] = []; c.notes[en] = []; c.curNotes[en] = [];
  c.guard[en] = {}; c.dispReg[en] = []; c.freeRecon[en] = false; c.freeGuard[en] = false;
  if (en === 'E') c.freeCoupReady = Object.assign({}, c.freeCoupReady, { E: false });
  delete c.over;
  return c;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const room = (url.searchParams.get('room') || 'main').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'main';
      const stub = env.CLASS.get(env.CLASS.idFromName('class-' + room));
      return stub.fetch(request);
    }
    if (url.pathname === '/ping') return new Response('ok');
    return env.ASSETS.fetch(request);
  }
};

export class ClassRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.cfg = clone(DEFAULT_CFG);
    this.tables = [];
    ctx.blockConcurrencyWhile(async () => {
      const cfg = await ctx.storage.get('cfg');
      if (cfg) this.cfg = Object.assign(clone(DEFAULT_CFG), cfg);
      const n = this.cfg.tables;
      for (let i = 1; i <= n; i++) this.tables.push((await ctx.storage.get('t' + i)) || newTable(i));
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /* ---------- plumbing ---------- */
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ role: null, token: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  att(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* closed */ } }
  socketsFor(token) { return this.ctx.getWebSockets().filter((w) => this.att(w).token === token); }
  teachers() { return this.ctx.getWebSockets().filter((w) => this.att(w).role === 'teacher'); }
  toSeat(t, side, obj) { const seat = t.seats[side]; if (!seat) return; for (const w of this.socketsFor(seat.token)) this.send(w, obj); }
  toTeachers(obj) { for (const w of this.teachers()) this.send(w, obj); }
  async saveTable(t) { await this.ctx.storage.put('t' + t.id, t); }
  async saveCfg() { await this.ctx.storage.put('cfg', this.cfg); }
  table(id) { return this.tables.find((t) => t.id === id); }
  seatOf(token) {
    for (const t of this.tables) for (const s of SIDES) if (t.seats[s] && t.seats[s].token === token) return { t, side: s };
    return null;
  }
  isConn(token) { return this.socketsFor(token).length > 0; }

  lobbyFor(forTeacher, token) {
    const you = token ? this.seatOf(token) : null;
    return {
      t: 'lobby', cfg: this.cfg, teacher: !!forTeacher,
      you: you ? { table: you.t.id, side: you.side } : null,
      tables: this.tables.map((t) => {
        const o = {
          id: t.id, name: t.name, stage: t.stage, turn: t.S ? t.S.turn : null, mode: t.mode,
          seats: {
            W: t.seats.W ? { conn: this.isConn(t.seats.W.token) } : null,
            E: t.seats.E ? { conn: this.isConn(t.seats.E.token) } : null
          },
          bot: t.bot, ready: t.ready, ack: t.ack
        };
        if (t.S) { const sc = E.score(t.S); o.score = { W: sc.W.total, E: sc.E.total }; o.title = E.TURNS[t.S.turn].title; o.docs = { W: t.S.doc.W, E: t.S.doc.E }; o.alt = t.S.alt; }
        if (t.deadline) o.deadlineIn = Math.max(0, t.deadline - Date.now());
        return o;
      })
    };
  }
  pushLobby() {
    for (const w of this.ctx.getWebSockets()) {
      const a = this.att(w);
      if (a.role === 'teacher') this.send(w, this.lobbyFor(true, null));
      else if (a.role === 'student') this.send(w, this.lobbyFor(false, a.token));
    }
    this.pushProj();
  }
  // Public information only: this is what goes on the classroom projector.
  projFor() {
    const tables = this.tables.map((t) => {
      const o = {
        id: t.id, name: t.name, stage: t.stage, mode: t.mode, bot: t.bot, ready: t.ready,
        seats: { W: t.seats.W ? { conn: this.isConn(t.seats.W.token) } : null, E: t.seats.E ? { conn: this.isConn(t.seats.E.token) } : null }
      };
      const s = t.S;
      if (s) {
        const sc = E.score(s);
        o.turn = s.turn; o.date = E.TURNS[s.turn].date; o.title = E.TURNS[s.turn].title; o.body = E.TURNS[s.turn].body;
        o.score = { W: sc.W.total, E: sc.E.total, regW: sc.W.reg, regE: sc.E.reg, vpW: sc.W.vp, vpE: sc.E.vp };
        o.ctrl = {}; for (const id of E.REG_IDS) o.ctrl[id] = E.ctrl(s, id);
        o.docs = { W: E.ladder(s, 'W').slice(0, s.doc.W).map((d) => d.name), E: E.ladder(s, 'E').slice(0, s.doc.E).map((d) => d.name) };
        o.anchors = (s.anchors || []).map((a) => ({ title: a.title, ok: a.ok, date: a.date, core: a.core }));
        o.chron = (s.chron || []).slice(-5).map((c) => c.text);
        o.alt = s.alt;
        if (t.final) o.winner = t.final.winner;
      }
      return o;
    });
    let W = 0, Ew = 0;
    for (const o of tables) if (o.score) { W += o.score.W; Ew += o.score.E; }
    return { t: 'proj', cfg: { mode: this.cfg.mode }, spot: this.spot || null, totals: { W, E: Ew }, tables };
  }
  pushProj(force) {
    const now = Date.now();
    if (!force && now - (this.lastProj || 0) < 1000) { if (!this.projTimer) this.projTimer = setTimeout(() => { this.projTimer = null; this.pushProj(true); }, 1100); return; }
    this.lastProj = now;
    const ws = this.ctx.getWebSockets().filter((w) => this.att(w).role === 'projector');
    if (!ws.length) return;
    const m = this.projFor();
    for (const w of ws) this.send(w, m);
  }
  status(t) { const m = { t: 'status', table: t.id, ready: t.ready, ack: t.ack, stage: t.stage }; for (const s of SIDES) this.toSeat(t, s, m); }

  async scheduleAlarm() {
    let next = 0;
    for (const t of this.tables) if (t.stage === 'acting' && t.deadline) next = next ? Math.min(next, t.deadline) : t.deadline;
    if (next) await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 500)); else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const now = Date.now();
    for (const t of this.tables) {
      if (t.stage === 'acting' && t.deadline && t.deadline <= now) { await this.force(t); }
    }
    await this.scheduleAlarm();
  }

  /* ---------- websocket events ---------- */
  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch (e) {} this.pushLobby(); }
  async webSocketError() { this.pushLobby(); }

  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const a = this.att(ws);
    if (m.t === 'hello') return this.onHello(ws, m);
    if (!a.role) return;
    if (a.role === 'teacher') return this.onTeacher(ws, m);
    return this.onStudent(ws, a, m);
  }

  onHello(ws, m) {
    if (m.role === 'projector') {
      ws.serializeAttachment({ role: 'projector', token: null });
      this.send(ws, this.projFor());
      return;
    }
    if (m.role === 'teacher') {
      const pin = String(this.env.TEACHER_PIN || '1945');
      if (String(m.pin || '') !== pin) { this.send(ws, { t: 'denied', msg: 'Wrong PIN.' }); return; }
      ws.serializeAttachment({ role: 'teacher', token: null });
      this.send(ws, this.lobbyFor(true, null));
      return;
    }
    const token = String(m.token || '').slice(0, 64);
    if (!token) return;
    ws.serializeAttachment({ role: 'student', token });
    this.send(ws, this.lobbyFor(false, token));
    const seat = this.seatOf(token);
    if (seat) this.sync(seat.t, seat.side, ws);
    this.pushLobby();
  }

  /* ---------- student messages ---------- */
  async onStudent(ws, a, m) {
    const token = a.token;
    if (m.t === 'sit') {
      const t = this.table(+m.table); const side = m.side;
      if (!t || !SIDES.includes(side) || t.stage !== 'lobby') return;
      const cur = this.seatOf(token);
      if (cur && !(cur.t === t && cur.side === side)) { if (cur.t.stage !== 'lobby') return; cur.t.seats[cur.side] = null; await this.saveTable(cur.t); }
      if (t.seats[side] && t.seats[side].token !== token) { this.send(ws, { t: 'notice', msg: 'That seat is taken.' }); return; }
      t.seats[side] = { token }; t.bot[side] = false;
      await this.saveTable(t); this.pushLobby(); return;
    }
    if (m.t === 'leave') {
      const cur = this.seatOf(token);
      if (cur && cur.t.stage === 'lobby') { cur.t.seats[cur.side] = null; await this.saveTable(cur.t); this.pushLobby(); }
      return;
    }
    const cur = this.seatOf(token); if (!cur) return;
    const { t, side } = cur; const s = t.S;
    switch (m.t) {
      case 'act': {
        if (t.stage !== 'acting' || t.ready[side] || !s) return;
        let r;
        if (m.type === 'freecoup') r = side === 'E' ? E.freeCoup(s, m.id) : { ok: false, msg: 'Not available.' };
        else r = E.act(s, side, String(m.type), m.id);
        const en = E.other(side);
        const nn = s.notes[en].splice(0);
        const pub = [];
        if (r.ok && r.type === 'doctrine' && r.doctrine) pub.push(E.SIDE[side].name + ' enacts ' + r.doctrine.name + '.');
        if (nn.length) { t.notes[en].push(...nn); s.curNotes[en] = t.notes[en]; }
        if (nn.length || pub.length) this.toSeat(t, en, { t: 'notice', table: t.id, notes: nn, pub, state: redact(s, en) });
        this.send(ws, { t: 'actRes', rid: m.rid, r, state: redact(s, side) });
        this.pushProj();
        await this.saveTable(t); return;
      }
      case 'ready': {
        if (t.stage !== 'acting') return;
        t.ready[side] = true; this.status(t); this.pushProj(); await this.saveTable(t);
        if (t.ready.W && t.ready.E) await this.resolveTurn(t);
        return;
      }
      case 'ack': {
        if (t.stage !== 'between') return;
        t.ack[side] = true; this.status(t); await this.saveTable(t);
        if (t.ack.W && t.ack.E) await this.afterResolved(t);
        return;
      }
      case 'bplan': {
        if (t.stage !== 'berlin' || t.bphase !== 'plan' || t.bp[side]) return;
        t.bp[side] = this.cleanPlan(s, side, m.plan); this.status(t); await this.saveTable(t);
        await this.maybeRound(t); return;
      }
      case 'back': {
        if (t.stage !== 'berlin' || t.bphase !== 'round') return;
        t.ack[side] = true; this.status(t); await this.saveTable(t);
        await this.maybeNextBerlin(t); return;
      }
    }
  }

  /* ---------- teacher commands ---------- */
  async onTeacher(ws, m) {
    if (m.t !== 'tcmd') return;
    const targets = () => (m.table === 'all' || m.table == null ? this.tables : [this.table(+m.table)].filter(Boolean));
    switch (m.cmd) {
      case 'cfg': {
        const c = m.cfg || {};
        if (c.mode === 'focus' || c.mode === 'full') this.cfg.mode = c.mode;
        if (Number.isFinite(+c.timer)) this.cfg.timer = Math.max(0, Math.min(1800, +c.timer));
        if (c.pace === 'teacher' || c.pace === 'auto') this.cfg.pace = c.pace;
        if (Number.isFinite(+c.tables)) {
          const n = Math.max(1, Math.min(12, Math.round(+c.tables)));
          if (this.tables.every((t) => t.stage === 'lobby') && n !== this.cfg.tables) {
            this.cfg.tables = n;
            while (this.tables.length < n) this.tables.push(newTable(this.tables.length + 1));
            while (this.tables.length > n) { const t = this.tables.pop(); await this.ctx.storage.delete('t' + t.id); }
          }
        }
        await this.saveCfg(); break;
      }
      case 'start': for (const t of targets()) await this.startTable(t); break;
      case 'next': for (const t of this.tables) if (t.stage === 'gate') await this.startTurn(t); break;
      case 'force': for (const t of targets()) await this.force(t); break;
      case 'reset': for (const t of targets()) await this.resetTable(t); break;
      case 'kick': { const t = this.table(+m.table); if (t && SIDES.includes(m.side)) { const seat = t.seats[m.side]; t.seats[m.side] = null; if (t.stage === 'lobby') t.bot[m.side] = false; await this.saveTable(t); if (seat) for (const w of this.socketsFor(seat.token)) this.send(w, { t: 'kicked' }); } break; }
      case 'botfill': { const t = this.table(+m.table); if (t && t.stage === 'lobby' && SIDES.includes(m.side) && !t.seats[m.side]) { t.bot[m.side] = !!m.on; await this.saveTable(t); } break; }
      case 'spot': this.spot = m.table == null ? null : +m.table; break;
      case 'rename': { const t = this.table(+m.table); if (t) { t.name = String(m.name || t.name).slice(0, 24); await this.saveTable(t); } break; }
    }
    await this.scheduleAlarm();
    this.pushLobby();
  }

  async resetTable(t) {
    const keep = { W: t.seats.W, E: t.seats.E };
    const n = newTable(t.id); n.name = t.name; n.seats = keep;
    Object.assign(t, n); await this.saveTable(t);
    for (const s of SIDES) this.toSeat(t, s, { t: 'reset' });
  }

  /* ---------- game flow ---------- */
  async startTable(t) {
    if (t.stage !== 'lobby') return;
    const humans = SIDES.filter((s) => t.seats[s]);
    if (!humans.length) return;
    for (const s of SIDES) t.bot[s] = !t.seats[s];
    t.mode = this.cfg.mode;
    t.S = E.newGame(); t.S.focus = t.mode === 'focus';
    await this.startTurn(t);
  }

  async startTurn(t) {
    const s = t.S;
    t.lines = E.startTurn(s);
    t.notes = { W: [], E: [] };
    for (const side of SIDES) t.notes[side] = E.startSide(s, side).slice();
    for (const side of SIDES) t.disp[side] = E.prepDispatches(s, side);
    for (const side of SIDES) if (t.bot[side]) E.botTurn(s, side, 1);
    for (const side of SIDES) if (!t.bot[side]) { t.notes[side].push(...s.notes[side].splice(0)); s.curNotes[side] = t.notes[side]; }
    t.ready = { W: t.bot.W, E: t.bot.E }; t.ack = { W: false, E: false };
    t.stage = 'acting'; t.final = null;
    t.deadline = this.cfg.timer > 0 ? Date.now() + this.cfg.timer * 1000 : 0;
    for (const side of SIDES) this.sendTurn(t, side, false);
    await this.saveTable(t); await this.scheduleAlarm(); this.pushLobby();
  }
  turnMsg(t, side, resume) {
    return {
      t: 'turn', table: t.id, side, resume, mode: t.mode, state: redact(t.S, side), lines: t.lines,
      dispatches: t.disp[side], notes: t.notes[side], ready: t.ready,
      deadlineIn: t.deadline ? Math.max(0, t.deadline - Date.now()) : 0
    };
  }
  sendTurn(t, side, resume, ws) { const m = this.turnMsg(t, side, resume); if (ws) this.send(ws, m); else this.toSeat(t, side, m); }

  async force(t) {
    if (t.stage === 'acting') { t.ready = { W: true, E: true }; await this.saveTable(t); await this.resolveTurn(t); }
    else if (t.stage === 'between') { t.ack = { W: true, E: true }; await this.afterResolved(t); }
    else if (t.stage === 'berlin') {
      if (t.bphase === 'plan') { for (const s of SIDES) if (!t.bp[s]) t.bp[s] = this.botPlan(t.S, s); await this.maybeRound(t); }
      else { t.ack = { W: true, E: true }; await this.maybeNextBerlin(t); }
    } else if (t.stage === 'gate') await this.startTurn(t);
  }

  async resolveTurn(t) {
    t.deadline = 0;
    if (!t.S.focus && t.S.turn === BERLIN_TURN) return this.startBerlin(t);
    return this.finishTurn(t, []);
  }

  async finishTurn(t, extra) {
    const s = t.S;
    t.recs = extra.concat(E.endTurn(s));
    t.date = E.TURNS[s.turn].date;
    t.stage = 'between'; t.ack = { W: t.bot.W, E: t.bot.E };
    for (const side of SIDES) this.toSeat(t, side, { t: 'resolved', table: t.id, recs: t.recs, date: t.date, state: redact(s, side), resume: false });
    await this.saveTable(t); this.pushLobby();
  }

  async afterResolved(t) {
    const s = t.S;
    const over = E.advance(s);
    if (over) {
      t.stage = 'over'; t.final = clone(s.over);
      for (const side of SIDES) this.toSeat(t, side, { t: 'over', table: t.id, final: t.final, state: redact(s, side) });
    } else if (this.cfg.pace === 'teacher') {
      t.stage = 'gate';
      for (const side of SIDES) this.toSeat(t, side, { t: 'gate', table: t.id, turn: s.turn, title: E.TURNS[s.turn].title, date: E.TURNS[s.turn].date, state: redact(s, side) });
      await this.saveTable(t); this.pushLobby(); return;
    } else { await this.startTurn(t); return; }
    await this.saveTable(t); this.pushLobby();
  }

  /* ---------- Berlin boss ---------- */
  async startBerlin(t) {
    const s = t.S; E.berlinInit(s);
    t.stage = 'berlin'; t.bphase = 'plan'; t.bp = { W: null, E: null };
    for (const side of SIDES) this.toSeat(t, side, { t: 'bplan', table: t.id, intro: true, state: redact(s, side) });
    await this.saveTable(t); this.pushLobby();
  }
  botPlan(s, side) { return side === 'W' ? E.botBerlinW(s) : E.botBerlinE(s); }
  cleanPlan(s, side, p) {
    p = p || {}; const b = s.berlin;
    if (side === 'W') {
      const al = Array.isArray(p.alloc) ? p.alloc.map((x) => Math.max(0, Math.floor(+x) || 0)) : [];
      if (al.length !== 3 || al.reduce((x, y) => x + y, 0) !== b.flights) return this.botPlan(s, 'W');
      return { alloc: al, card: E.WCARDS[p.card] ? p.card : 'hold' };
    }
    const lane = Math.max(0, Math.min(2, Math.floor(+p.lane) || 0));
    return { lane, card: E.ECARDS[p.card] ? p.card : 'hold' };
  }
  async maybeRound(t) {
    const s = t.S;
    for (const side of SIDES) if (t.bot[side] && !t.bp[side]) t.bp[side] = this.botPlan(s, side);
    if (!(t.bp.W && t.bp.E)) return;
    const rec = E.berlinResolve(s, t.bp.W, t.bp.E);
    t.bphase = 'round'; t.bp = { W: null, E: null }; t.ack = { W: t.bot.W, E: t.bot.E };
    for (const side of SIDES) this.toSeat(t, side, { t: 'bround', table: t.id, rec, done: s.berlin.done, state: redact(s, side) });
    await this.saveTable(t);
  }
  async maybeNextBerlin(t) {
    if (!(t.ack.W && t.ack.E)) return;
    const s = t.S;
    if (s.berlin.done) { const rec = E.berlinFinish(s); await this.finishTurn(t, [rec]); return; }
    t.bphase = 'plan'; t.bp = { W: null, E: null };
    for (const side of SIDES) this.toSeat(t, side, { t: 'bplan', table: t.id, intro: false, state: redact(s, side) });
    await this.saveTable(t);
  }

  /* ---------- reconnect ---------- */
  sync(t, side, ws) {
    const s = t.S;
    if (!s || t.stage === 'lobby') return;
    if (t.stage === 'acting') return this.sendTurn(t, side, true, ws);
    if (t.stage === 'between') return this.send(ws, { t: 'resolved', table: t.id, recs: t.ack[side] ? [] : t.recs, date: t.date, state: redact(s, side), resume: true });
    if (t.stage === 'gate') return this.send(ws, { t: 'gate', table: t.id, turn: s.turn, title: E.TURNS[s.turn].title, date: E.TURNS[s.turn].date, state: redact(s, side), resume: true });
    if (t.stage === 'over') return this.send(ws, { t: 'over', table: t.id, final: t.final, state: redact(s, side), resume: true });
    if (t.stage === 'berlin') {
      if (t.bphase === 'plan') return this.send(ws, { t: 'bplan', table: t.id, intro: false, resume: true, submitted: !!t.bp[side], state: redact(s, side) });
      return this.send(ws, { t: 'bwait', table: t.id, state: redact(s, side) });
    }
  }
}

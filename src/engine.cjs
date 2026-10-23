/* IRON CURTAIN 1945-49 : pure game engine (no DOM).
   Designed so the same file can later run inside a Cloudflare Worker / Durable Object:
   all state lives in one JSON-able object, and viewFor(state, side) is the only thing a client should see. */
(function (root) {
'use strict';

/* ---------- tiny seeded RNG ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = mulberry32(Date.now() & 0xffffffff);
function seed(n) { rng = mulberry32(n); }
const rnd = () => rng();
const ri = (n) => Math.floor(rnd() * n);
const pick = (a) => a[ri(a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const other = (s) => (s === 'W' ? 'E' : 'W');
const SIDE = { W: { id: 'W', name: 'WESTERN ALLIES', short: 'WEST', adj: 'Western' }, E: { id: 'E', name: 'SOVIET UNION', short: 'EAST', adj: 'Soviet' } };

/* ---------- map ---------- */
let MAP = [], ADJ = {}, TILES = {};
const SEA_LINKS = [['B', 'R'], ['B', 'L'], ['B', 'N'], ['T', 'D']];
function setMap(rows) {
  MAP = rows; ADJ = {}; TILES = {};
  const H = rows.length, W = rows[0].length;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = rows[y][x];
    if (a === '.' || a === 'z') continue;
    (TILES[a] = TILES[a] || []).push([x, y]);
    ADJ[a] = ADJ[a] || new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const yy = y + dy, xx = x + dx;
      if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
      const b = rows[yy][xx];
      if (b === '.' || b === 'z' || b === a) continue;
      ADJ[a].add(b);
    }
  }
  for (const [a, b] of SEA_LINKS) { ADJ[a].add(b); ADJ[b].add(a); }
  // Berlin is only reachable through the East German zone (and by air)
  for (const k of Object.keys(ADJ)) ADJ[k] = Array.from(ADJ[k]);
}

/* ---------- regions ---------- */
const REG = {
  N: { name: 'Nordic States', code: 'NOR', val: 1, w: 2, e: 0, ax: 19.5, ay: 4, note: 'Norway and Denmark are freed from German occupation. Sweden stayed neutral. All three want to stay out of the great-power quarrel.' },
  F: { name: 'Finland', code: 'FIN', val: 0, w: 0, e: 0, locked: true, buffer: true, ax: 28.5, ay: 3, note: 'Fought alongside Germany, then against it. Lost land to the USSR. Stalin does not annex it, and the Finns stay neutral and careful. A buffer nobody can control.' },
  B: { name: 'Britain', code: 'UK', val: 2, w: 5, e: 0, home: 'W', ax: 6, ay: 7, note: 'Victorious, but after six years of war almost bankrupt (a key term). In 1947 it will tell the USA it can no longer afford to support Greece.' },
  X: { name: 'Iberia', code: 'IBE', val: 1, w: 1, e: 0, ax: 5.5, ay: 24, note: 'Franco\'s Spain and Salazar\'s Portugal stayed out of the war. Spain is shunned by the UN but is fiercely anti-communist.' },
  R: { name: 'France', code: 'FRA', val: 3, w: 3, e: 1, ax: 9.5, ay: 17, note: 'Liberated in 1944. The Communist Party won more votes than any other party in 1945 and sits in the government.' },
  L: { name: 'Benelux', code: 'BEN', val: 2, w: 3, e: 0, ax: 11.5, ay: 11, note: 'Belgium, the Netherlands and Luxembourg: liberated, rebuilding, and already economically close to each other and to Britain.' },
  G: { name: 'West Germany', code: 'WGR', val: 3, w: 3, e: 0, ax: 15.5, ay: 12, note: 'The British, American and French occupation zones. Cities are rubble and millions are hungry.' },
  E: { name: 'East Germany', code: 'EGR', val: 3, w: 0, e: 3, ax: 20, ay: 14, py: 11, note: 'The Soviet occupation zone. Factories are dismantled and shipped east as reparations.' },
  W: { name: 'Berlin', code: 'BER', val: 3, w: 2, e: 2, locked: true, ax: 20.5, ay: 12, note: 'Deep inside the Soviet zone, but divided into four sectors. The Western sectors depend on roads, rail and air corridors Stalin can squeeze.' },
  P: { name: 'Poland', code: 'POL', val: 2, w: 1, e: 2, ax: 26.5, ay: 12, note: 'Moved westward on the map by the Big Three. Soviet-backed Lublin communists share power with the London-backed peasant party.' },
  C: { name: 'Czechoslovakia', code: 'CZE', val: 3, w: 2, e: 2, ax: 25, ay: 15, note: 'Liberated by both armies. A democratic coalition under Benes, but the Communists are the biggest party.' },
  A: { name: 'Austria', code: 'AUT', val: 1, w: 1, e: 1, ax: 21.5, ay: 17, note: 'Occupied by all four powers and split into zones. Vienna is split into four sectors, like Berlin.' },
  H: { name: 'Hungary', code: 'HUN', val: 2, w: 1, e: 2, ax: 27.5, ay: 17, note: 'Occupied by the Red Army. The Smallholders won the free election of November 1945.' },
  O: { name: 'Romania', code: 'ROM', val: 2, w: 0, e: 3, ax: 34, ay: 18, note: 'The Red Army forced the king to accept a communist-led government in March 1945.' },
  U: { name: 'Bulgaria', code: 'BUL', val: 2, w: 0, e: 3, ax: 34, ay: 21, note: 'Occupied by the Soviets in 1944. The communist-led Fatherland Front runs the government.' },
  Y: { name: 'Yugoslavia', code: 'YUG', val: 2, w: 0, e: 3, ax: 26, ay: 20, note: 'Tito\'s partisans freed the country mostly on their own. Loyal to Stalin... but proud and independent-minded.' },
  T: { name: 'Italy', code: 'ITA', val: 3, w: 3, e: 2, ax: 17, ay: 21, note: 'Shattered by war. The Communist and Socialist parties are huge. Americans are very worried about the next election.' },
  D: { name: 'Greece', code: 'GRE', val: 2, w: 2, e: 1, ax: 28, ay: 25, note: 'British troops back the royalist government against communist guerrillas. The Greek Civil War resumes in 1946 and lasts until 1949.' },
  K: { name: 'Turkey', code: 'TUR', val: 2, w: 2, e: 0, ax: 37, ay: 25, note: 'Neutral in the war. Stalin wants a say over the Straits that lead out of the Black Sea. In April 1946 the USA sends the battleship USS Missouri to Istanbul.' },
  S: { name: 'Soviet Union', code: 'USSR', val: 0, w: 0, e: 5, home: 'E', fixed: true, ax: 37, ay: 5, note: 'Twenty-seven million dead, but the largest army on the continent and a government that can do whatever it likes.' }
};
const REG_IDS = Object.keys(REG);
const isTarget = (id) => !REG[id].fixed && !REG[id].locked;

/* ---------- sources (how far to trust each one) ---------- */
const SOURCES = [
  { name: 'Embassy cable', acc: 0.86, tip: `Written by diplomats for their own government, to inform. Careful, but they only see what is near the embassy.` },
  { name: 'Radio intercept', acc: 0.80, tip: `Heard directly, so hard to fake. But it is only a fragment, and could be a deliberate trick.` },
  { name: 'Local informer', acc: 0.68, tip: `Someone on the spot, but paid, so may tell you what you want to hear.` },
  { name: 'Newspaper', acc: 0.58, tip: `Has an owner and a political line, and wants to sell copies. May exaggerate.` },
  { name: 'Defector', acc: 0.50, tip: `Changed sides and needs to be believed and rewarded, so has a reason to exaggerate.` }
];

/* ---------- doctrines (the ordered ladder). core = taught in Lessons 1-2; core:false = bonus history ---------- */
const DOC = {
  W: [
    { id: 'W1', core: true, name: `Long Telegram`, date: `Feb 1946`, avail: 1, desc: `Kennan's warning. A free RECON every turn.`, terms: `containment`,
      hist: `In February 1946 the US diplomat George Kennan sent the Long Telegram from Moscow. It warned that the USSR intended to spread communism across Europe. It gave Truman the idea of stopping that spread: containment.` },
    { id: 'W2', core: true, name: `Truman Doctrine`, date: `12 Mar 1947`, avail: 2, desc: `+2 influence in Greece, +1 in Turkey.`, terms: `bankrupt, guerrillas, aid, isolationism, containment`,
      hist: `Britain was nearly bankrupt and could no longer support Greece against communist guerrillas. Truman asked Congress for $400 million of aid for Greece and Turkey. He described two ways of life and promised to support "free peoples" resisting "armed minorities" and "outside pressures". The USA dropped isolationism for containment.`,
      exam: `Effect 1 for "Explain TWO effects of the Truman Doctrine on superpower relations": it ended isolationism and set the USA in direct opposition to the USSR. The Grand Alliance was gone.` },
    { id: 'W3', core: true, name: `Marshall Plan`, date: `5 Jun 1947`, avail: 3, desc: `+1 AP every turn, +1 in your Western regions. Unlocks AID PACKAGE.`, terms: `aid, Marshall Plan`,
      hist: `Secretary of State George Marshall offered economic aid to rebuild Europe. In 1948-52 Western Europe received about $13.7 billion, and Britain got the biggest share. Marshall said the plan was directed against "hunger, poverty, desperation and chaos", not against any country. Eastern Europe did not benefit.`,
      exam: `Effect 2: the Marshall Plan tied Western Europe to the USA. Stalin answered with dollar imperialism, Cominform and Comecon, so Europe divided into two camps.` },
    { id: 'W4', core: false, name: `Currency Reform`, date: `Jun 1948`, avail: 7, desc: `+1 West Germany. Berlin: +2 starting morale, +2 supplies.`, terms: ``,
      hist: `The new Deutsche Mark was introduced in the western zones on 20 June 1948. It helped trigger the Berlin Blockade four days later.` },
    { id: 'W5', core: false, name: `NATO`, date: `4 Apr 1949`, avail: 8, desc: `+1 in UK, France, Benelux, Nordic, Italy. +3 VP.`, terms: ``,
      hist: `The North Atlantic Treaty was signed on 4 April 1949 by twelve countries: an attack on one is an attack on all.` }
  ],
  E: [
    { id: 'E1', core: true, name: `Satellite States`, date: `1945-47`, avail: 1, desc: `+1 in Poland, Hungary, Romania, Bulgaria. Secret police give a free GUARD each turn.`, terms: `satellite state, communism`,
      hist: `The Red Army occupied Eastern Europe and Stalin backed communist governments there. These satellite states were officially independent but took orders from Moscow. Stalin did not need a war to spread communism: he only had to keep supporting these governments.` },
    { id: 'E2', core: true, name: `Dollar Imperialism`, date: `Jul 1947`, avail: 3, desc: `Moscow forces a boycott: West -1 in Poland and Czechoslovakia.`, terms: `dollar imperialism, Molotov Plan`,
      hist: `Stalin called the Marshall Plan "dollar imperialism": American money used to divide Europe and build an economic empire. At the Paris talks (27 June to 2 July 1947) Molotov walked out. Poland and Czechoslovakia wanted to attend but were pressed to withdraw. The USSR offered its own trade deals, the Molotov Plan.` },
    { id: 'E3', core: true, name: `Cominform`, date: `22 Sep 1947`, avail: 4, desc: `+1 AP every turn. Unlocks COMINFORM ORDERS.`, terms: `Cominform, two camps`,
      hist: `The Communist Information Bureau was an association of communist parties from across Europe. It let Stalin direct and control the satellite governments. At its first meeting Zhdanov said the world had split into two camps, and the Marshall Plan was rejected. Memory hook: Cominform for control.` },
    { id: 'E4', core: false, name: `Prague Coup`, date: `Feb 1948`, avail: 5, desc: `A free COUP in any region where you have 2+.`, terms: ``,
      hist: `On 25 February 1948 Gottwald's Communists took over Czechoslovakia after non-communist ministers resigned and workers' militias took the streets.` },
    { id: 'E5', core: true, name: `Comecon`, date: `25 Jan 1949`, avail: 8, desc: `+1 in your Eastern bloc regions. +2 VP.`, terms: `Comecon, superpowers`,
      hist: `The Council for Mutual Economic Assistance linked the USSR, Bulgaria, Czechoslovakia, Hungary, Poland and Romania. It competed directly with the Marshall Plan and discouraged trade with the West. Memory hook: Comecon for cash. The first Soviet atomic test followed in August 1949.` }
  ]
};

/* ---------- turns ---------- */
const TURNS = [
  { core: true, date: 'JUL 1945', title: 'POTSDAM', body: `Germany lies in ruins. At Potsdam the Big Three divide it into four occupation zones, and Berlin into four sectors. The Grand Alliance still holds on paper. Weeks earlier British planners secretly drew up Operation Unthinkable, a plan to attack the USSR, then shelved it as too risky. Stalin has the biggest army in Europe. Nobody has won the peace yet.`, fx: `The positions of summer 1945. You have limited Action Points (AP): choose carefully.` },
  { core: true, date: 'MAR 1946', title: 'THE IRON CURTAIN', body: `Churchill tells an audience in Fulton, Missouri that an "iron curtain" has descended across Europe. Weeks earlier Kennan's Long Telegram warned Washington about Soviet intentions. In April the USA sends the battleship USS Missouri to Istanbul after Stalin demands a share of control over the Turkish Straits.`, fx: `Both sides can now enact their first Doctrine step.` },
  { core: true, date: 'MAR 1947', title: 'BRITAIN CANNOT PAY', body: `After six years of war Britain is nearly bankrupt. It announces that it can no longer support the Greek government against communist guerrillas, and asks the USA to take over. This is the trigger. On 12 March Truman asks Congress for $400 million of aid for Greece and Turkey.`, fx: `British withdrawal: West -1 in Greece. The guerrillas press on: East +1 in Greece (if present).`,
    start: (s) => { const l = []; if (s.inf.D.W > 0) { s.inf.D.W--; l.push('West influence in Greece falls by 1.'); } if (s.inf.D.E > 0 && s.inf.D.E < 5) { s.inf.D.E++; l.push('Communist influence in Greece rises by 1.'); } return l; } },
  { core: true, date: 'JUN 1947', title: 'THE MARSHALL PLAN', body: `On 5 June Secretary of State George Marshall offers American aid to rebuild Europe. Britain and France invite the USSR to talks in Paris (27 June to 2 July). Molotov walks out on 2 July. Will Eastern Europe be allowed to accept?`, fx: `Hungary's coalition crumbles: East +1 in Hungary. Whether Poland and Czechoslovakia refuse Marshall aid depends on the Soviet Doctrine step. History will check at the end of this turn.`,
    start: (s) => { const l = []; if (s.inf.H.E < 5) { s.inf.H.E++; l.push('Hungary: Soviet influence +1.'); } return l; } },
  { core: true, date: 'SEP 1947', title: 'COMINFORM', body: `On 22 September communist parties from nine countries meet in Poland. Zhdanov tells them the world is split into two camps. At the UN, Vyshinsky condemns the Marshall Plan. In France and Italy, communist-led strikes shake the governments.`, fx: `Strikes: East +1 in France and Italy.`,
    start: (s) => { const l = []; for (const r of ['R', 'T']) if (s.inf[r].E < 5) { s.inf[r].E++; l.push(REG[r].name + ': Soviet influence +1.'); } return l; } },
  { core: false, date: 'FEB 1948', title: 'PRAGUE', body: `Non-communist ministers resign in protest in Czechoslovakia. Gottwald asks the President to appoint a communist-dominated cabinet. Workers' militias fill the streets while the Red Army waits on the border.`, fx: `At the end of this turn: is Czechoslovakia communist, as it really was?` },
  { core: false, date: 'APR 1948', title: 'ITALIAN ELECTION', body: `Italy votes on 18 April. The USA pours in money, radio broadcasts and letters from Italian-Americans. Western Europe's first Marshall Plan funds begin to arrive.`, fx: `At the end of this turn: Italy is checked against history.` },
  { core: false, date: 'JUN 1948', title: 'BERLIN BLOCKADE', body: `The Western powers introduce a new currency. Tito and Stalin split. And on 24 June, Soviet forces cut every road, rail and canal route into West Berlin. Two million people have about 36 days of food. Your textbook signposts this stand-off as the next chapter.`, fx: `Yugoslavia leaves the Soviet camp. After your actions, the BERLIN AIRLIFT begins.`,
    start: (s) => { const l = []; const y = s.inf.Y; l.push('Tito is expelled from the Cominform. Yugoslavia stays communist but turns non-aligned.'); y.W = 0; y.E = 0; s.neutral.Y = true; return l; } },
  { core: true, date: 'APR 1949', title: 'NATO AND COMECON', body: `Comecon, founded in January, now competes with the Marshall Plan. On 4 April twelve nations sign the North Atlantic Treaty. The Berlin Blockade ends on 12 May and the Federal Republic of Germany is proclaimed on 23 May.`, fx: `At the end of this turn: West Germany is checked against history.` },
  { core: true, date: 'OCT 1949', title: 'TWO CAMPS', body: `The Soviets test an atomic bomb in August. The German Democratic Republic is declared on 7 October. In Greece the communist guerrillas are defeated. Europe is split into two camps and the superpowers will rival each other for about 50 years.`, fx: `Final checks. Then the scores.` }
];

/* ---------- anchors (historical checks). core = from Lessons 1-2 ---------- */
const ANCH = [
  { id: 'france', core: true, turn: 3, reg: 'R', expect: 'W', title: 'France stays Western', date: 'May 1947', real: `French Communist ministers were dismissed in May 1947. France accepted Marshall aid and stayed in the Western camp.`, alt: `France drifts out of the Western camp. In reality the Communists were pushed out of government in May 1947.` },
  { id: 'marshall', core: true, turn: 3, test: (s) => s.inf.C.E >= s.inf.C.W && s.inf.P.E >= s.inf.P.W, upsetTo: 'W', title: 'Eastern Europe refuses Marshall aid', date: 'Jul 1947', real: `Poland and Czechoslovakia wanted to join the Paris talks, but Soviet pressure made them withdraw. Eastern Europe did not benefit from the Marshall Plan.`, alt: `Eastern European governments accept American aid. In reality Soviet pressure forced Poland and Czechoslovakia to refuse.` },
  { id: 'hungary', core: false, turn: 3, reg: 'H', expect: 'E', title: 'Hungary swings east', date: 'May-Aug 1947', real: `Soviet pressure and communist "salami tactics" forced out the Smallholders. After rigged elections in August 1947, communists took control.`, alt: `Hungary resists Soviet pressure. In reality the communists squeezed out their rivals by 1947.` },
  { id: 'czech', core: true, turn: 5, reg: 'C', expect: 'E', title: 'Czechoslovakia becomes communist', date: 'Feb 1948', real: `Czechoslovakia became a communist state in February 1948. Low's cartoon of March 1948 shows Czecho as one of the "buttons" Stalin could press.`, alt: `Czechoslovakia stays democratic. In reality the Communists took power in February 1948.` },
  { id: 'italy', core: false, turn: 6, reg: 'T', expect: 'W', title: 'Italian election', date: '18 Apr 1948', real: `The Christian Democrats won about 48 percent of the vote. The Communist-Socialist alliance lost badly. US support helped.`, alt: `Italy falls under communist influence. In reality the Christian Democrats won in April 1948.` },
  { id: 'berlin', core: false, turn: 7, reg: 'W', expect: 'W', title: 'Berlin holds out', date: '24 Jun 1948 to 12 May 1949', real: `The Western Allies flew in about 2.3 million tons of supplies. The Soviets lifted the blockade in May 1949. West Berlin stayed free.`, alt: `Berlin does not remain free. In reality the airlift succeeded.`, special: true },
  { id: 'frg', core: false, turn: 8, reg: 'G', expect: 'W', title: 'West Germany founded', date: '23 May 1949', real: `The Federal Republic of Germany was founded with its capital at Bonn.`, alt: `West Germany drifts. In reality the western zones merged into a Western-aligned state.` },
  { id: 'poland', core: true, turn: 9, reg: 'P', expect: 'E', title: 'Poland in the Eastern bloc', date: 'By 1949', real: `Poland became a Soviet satellite state. It joined Comecon at its founding in January 1949.`, alt: `Poland escapes the Soviet bloc. In reality it became a satellite state and a founder member of Comecon.` },
  { id: 'gdr', core: false, turn: 9, reg: 'E', expect: 'E', title: 'East Germany founded', date: '7 Oct 1949', real: `The German Democratic Republic was proclaimed in the Soviet zone.`, alt: `The Soviet zone is not secure. In reality the GDR was founded in October 1949.` },
  { id: 'greece', core: true, turn: 9, reg: 'D', expect: 'W', title: 'Greek Civil War ends', date: 'Oct 1949', real: `The communist guerrillas were defeated in 1949 and fled to Albania. Greece stayed in the Western camp.`, alt: `Greece falls to communism. In reality the government won the civil war.` },
  { id: 'turkey', core: true, turn: 9, reg: 'K', expect: 'W', title: 'Turkey stays Western', date: '1952', real: `Turkey received Truman Doctrine aid and later joined NATO in 1952.`, alt: `Turkey leaves the Western camp. In reality it received US aid and joined NATO.` }
];

/* ---------- game state ---------- */
function newGame(opts) {
  opts = opts || {};
  const s = {
    v: 1, turn: 0, phase: 'start', // start | acting | berlin | over
    inf: {}, neutral: {}, ap: { W: 0, E: 0 }, apMax: { W: 4, E: 4 },
    doc: { W: 0, E: 0 }, onTime: { W: 0, E: 0 }, vp: { W: 0, E: 0 },
    guard: { W: {}, E: {} }, freeRecon: { W: false, E: false }, freeGuard: { W: false, E: false },
    know: { W: {}, E: {} }, acts: { W: [], E: [] }, lastActs: { W: [], E: [] },
    notes: { W: [], E: [] }, curNotes: { W: [], E: [] }, dispReg: { W: [], E: [] }, freeCoupReady: { E: false },
    chron: [], anchors: [], alt: 0, berlin: null, over: null,
    stats: { subHit: { W: 0, E: 0 }, subMiss: { W: 0, E: 0 } }
  };
  for (const id of REG_IDS) { s.inf[id] = { W: REG[id].w, E: REG[id].e }; s.neutral[id] = !!REG[id].buffer; }
  return s;
}

function ctrl(s, id) {
  if (s.ctrlPub) return s.ctrlPub[id]; // online clients get the public result only
  if (s.neutral[id]) return 'N';
  const r = s.inf[id];
  if (REG[id].fixed) return REG[id].home;
  if (r.W >= 3 && r.W - r.E >= 2) return 'W';
  if (r.E >= 3 && r.E - r.W >= 2) return 'E';
  return null;
}

/* ---------- turn start ---------- */
function startTurn(s) {
  const t = TURNS[s.turn];
  const lines = [];
  s.phase = 'acting';
  for (const side of ['W', 'E']) { s.ap[side] = s.apMax[side]; s.acts[side] = []; }
  if (t.start) for (const l of t.start(s)) lines.push(l);
  chron(s, t.date + ': ' + t.title);
  return lines;
}
/* Called when a side begins its action window. Its own guards from last turn expire (they protected
   it during the enemy's window), and it receives the private notes the enemy's actions generated. */
function startSide(s, side) {
  s.guard[side] = {};
  s.freeRecon[side] = side === 'W' && s.doc.W >= 1;
  s.freeGuard[side] = side === 'E' && s.doc.E >= 1;
  const notes = s.notes[side]; s.notes[side] = [];
  s.curNotes[side] = notes;
  return notes;
}
function chron(s, text) { s.chron.push({ turn: s.turn, text }); }

/* ---------- reach / legal ---------- */
function hasPresence(s, side, id) { return REG[id].home === side || s.inf[id][side] >= 1; }
function inReach(s, side, id) {
  if (!isTarget(id)) return false;
  if (s.neutral[id]) return false;
  if (hasPresence(s, side, id)) return true;
  return (ADJ[id] || []).some((n) => hasPresence(s, side, n));
}
function costOf(s, side, type, id) {
  switch (type) {
    case 'spread': return 1 + (ctrl(s, id) === other(side) ? 1 : 0);
    case 'recon': return s.freeRecon[side] ? 0 : 1;
    case 'subvert': return 2;
    case 'guard': return s.freeGuard[side] ? 0 : 1;
    case 'doctrine': return 2;
    case 'special': return 3;
  }
  return 99;
}
function specialUnlocked(s, side) { return side === 'W' ? s.doc.W >= 3 : s.doc.E >= 3; }
const FOCUS_SKIP = [6, 7, 8]; // bonus-only turns left out of the focused game
const ladder = (s, side) => (s.focus ? DOC[side].filter((d) => d.core !== false) : DOC[side]);
function nextDoctrine(s, side) { return ladder(s, side)[s.doc[side]] || null; }
function doctrineReady(s, side) { const d = nextDoctrine(s, side); return !!d && s.turn >= d.avail; }

function canAct(s, side, type, id) {
  if (s.phase !== 'acting') return 'Not in the action phase.';
  if (s.focus && (type === 'subvert' || type === 'guard' || type === 'special')) return 'Not in the focused game.';
  const c = costOf(s, side, type, id);
  if (c > s.ap[side]) return 'Not enough action points.';
  if (type === 'doctrine') return doctrineReady(s, side) ? null : (nextDoctrine(s, side) ? 'Not yet available.' : 'Ladder complete.');
  if (!id || !REG[id]) return 'Pick a region.';
  if (type === 'recon') return REG[id].fixed || REG[id].locked ? 'Cannot recon that.' : null;
  if (!isTarget(id)) return 'That region is off limits.';
  if (s.neutral[id]) return 'That region has gone non-aligned.';
  if (type === 'spread') { if (s.inf[id][side] >= 5) return 'Already at maximum.'; return inReach(s, side, id) ? null : 'Out of reach.'; }
  if (type === 'subvert') return inReach(s, side, id) ? null : 'Out of reach.';
  if (type === 'guard') return hasPresence(s, side, id) ? null : 'You need a presence there.';
  if (type === 'special') {
    if (!specialUnlocked(s, side)) return 'Not unlocked yet.';
    if (s.inf[id][side] < 2) return 'Needs 2+ influence there.';
    return null;
  }
  return 'Unknown action.';
}

/* ---------- acting (resolves immediately; result is private to the actor) ---------- */
function act(s, side, type, id) {
  const err = canAct(s, side, type, id);
  if (err) return { ok: false, msg: err };
  const en = other(side);
  const cost = costOf(s, side, type, id);
  if (type === 'recon' && s.freeRecon[side]) s.freeRecon[side] = false;
  else if (type === 'guard' && s.freeGuard[side]) s.freeGuard[side] = false;
  else s.ap[side] -= cost;
  const res = { ok: true, type, region: id, cost, msg: '' };
  const nm = id ? REG[id].name : '';
  if (type === 'spread') {
    s.inf[id][side] = Math.min(5, s.inf[id][side] + 1);
    res.msg = 'Influence in ' + nm + ' grows to ' + s.inf[id][side] + '.';
    s.acts[side].push({ type, region: id });
  } else if (type === 'recon') {
    const v = s.inf[id][en];
    s.know[side][id] = { v, t: s.turn };
    res.msg = 'Recon ' + nm + ': ' + SIDE[en].adj + ' influence is ' + v + '.';
    res.reveal = v;
    s.acts[side].push({ type, region: id });
  } else if (type === 'guard') {
    s.guard[side][id] = true;
    res.msg = 'Counter-intelligence is watching ' + nm + '.';
    s.acts[side].push({ type, region: id });
  } else if (type === 'subvert') {
    s.acts[side].push({ type, region: id });
    if (s.guard[en][id]) {
      delete s.guard[en][id];
      s.inf[id][side] = Math.max(0, s.inf[id][side] - 1);
      s.know[side][id] = { v: s.inf[id][en], t: s.turn };
      res.blocked = true;
      res.msg = 'BLOCKED. Counter-intelligence was waiting in ' + nm + ' and rolled up one of your agents (-1). Enemy influence there is ' + s.inf[id][en] + '.';
      s.notes[en].push({ kind: 'foiled', region: id, text: 'Foiled! Your counter-intelligence in ' + nm + ' caught enemy agents.' });
      s.stats.subMiss[side]++;
    } else if (s.inf[id][en] > 0) {
      s.inf[id][en] = Math.max(0, s.inf[id][en] - 2);
      s.know[side][id] = { v: s.inf[id][en], t: s.turn };
      res.hit = true;
      res.msg = 'HIT! Enemy network in ' + nm + ' damaged. Their influence is now ' + s.inf[id][en] + '.';
      s.notes[en].push({ kind: 'hit', region: id, text: 'Your network in ' + nm + ' was hit by enemy subversion (-2).' });
      s.stats.subHit[side]++;
    } else {
      s.know[side][id] = { v: 0, t: s.turn };
      res.miss = true;
      res.msg = 'MISS. There was no enemy network in ' + nm + ' to strike.';
      s.stats.subMiss[side]++;
    }
  } else if (type === 'special') {
    s.acts[side].push({ type, region: id });
    if (s.guard[en][id]) {
      delete s.guard[en][id];
      s.inf[id][side] = Math.max(0, s.inf[id][side] - 1);
      res.blocked = true;
      res.msg = 'BLOCKED. The operation in ' + nm + ' was exposed (-1 influence).';
      s.notes[en].push({ kind: 'foiled', region: id, text: 'Foiled! You exposed a major enemy operation in ' + nm + '.' });
    } else {
      s.inf[id][side] = Math.min(5, s.inf[id][side] + 2);
      s.inf[id][en] = Math.max(0, s.inf[id][en] - 2);
      s.know[side][id] = { v: s.inf[id][en], t: s.turn };
      res.hit = true;
      res.msg = (side === 'E' ? 'COMINFORM ORDERS in ' : 'AID PACKAGE in ') + nm + ': you now hold ' + s.inf[id][side] + ', the enemy is down to ' + s.inf[id][en] + '.';
      chron(s, (side === 'E' ? 'Moscow\'s orders reshape ' : 'A Marshall aid package lands in ') + nm + '.');
      s.notes[en].push({ kind: 'big', region: id, text: 'ALERT: a major enemy operation hit ' + nm + '. Your influence there fell.' });
    }
  } else if (type === 'doctrine') {
    const d = nextDoctrine(s, side);
    const on = s.turn === d.avail;
    s.doc[side]++;
    if (on) { s.onTime[side]++; s.vp[side]++; }
    const eff = applyDoctrine(s, side, d);
    res.msg = d.name.toUpperCase() + ' enacted' + (on ? ' on time (+1 VP)' : ' late (no bonus)') + '. ' + eff;
    res.doctrine = d;
    chron(s, SIDE[side].short + ' enacts ' + d.name + (on ? '' : ' (late)') + '.');
  }
  return res;
}

function addInf(s, side, id, n, onlyIfPresent) {
  if (s.neutral[id]) return false;
  if (onlyIfPresent && s.inf[id][side] < 1) return false;
  const before = s.inf[id][side];
  s.inf[id][side] = Math.min(5, before + n);
  return s.inf[id][side] !== before;
}
function applyDoctrine(s, side, d) {
  const gained = [];
  const add = (id, n, only) => { if (addInf(s, side, id, n, only)) gained.push(REG[id].code); };
  switch (d.id) {
    case 'W1': add('B', 0); return 'You now get one free RECON each turn.';
    case 'W2': add('D', 2); add('K', 1); return 'Aid flows to ' + gained.join(', ') + '.';
    case 'W3': s.apMax.W++; if (s.focus) s.vp.W += 1; for (const r of ['R', 'L', 'G', 'T', 'A', 'N']) add(r, 1, true); return '+1 AP every turn. Aid in ' + gained.join(', ') + '. AID PACKAGE unlocked.';
    case 'W4': add('G', 1); return 'The Deutsche Mark is born. Berlin will be better prepared.';
    case 'W5': for (const r of ['B', 'R', 'L', 'N', 'T']) add(r, 1, true); s.vp.W += 3; return 'Alliance signed (+3 VP). Support in ' + gained.join(', ') + '.';
    case 'E1': for (const r of ['P', 'H', 'O', 'U']) add(r, 1, true); return 'Communists seize key ministries in ' + gained.join(', ') + '. Your secret police give you one free GUARD each turn.';
    case 'E2': {
      const cut = [];
      for (const r of ['P', 'C']) if (!s.neutral[r] && s.inf[r].W > 0) { s.inf[r].W--; cut.push(REG[r].code); }
      return 'Moscow forces a boycott: Western influence -1 in ' + (cut.join(', ') || 'nowhere') + '. The Molotov Plan trade deals tie them closer.';
    }
    case 'E3': s.apMax.E++; return '+1 AP every turn. COMINFORM ORDERS unlocked.';
    case 'E4': s.freeCoupReady.E = true; return 'You may now spend one free COUP (no AP) in a region where you hold 2+.';
    case 'E5': for (const r of ['P', 'C', 'H', 'O', 'U', 'E']) add(r, 1, true); s.vp.E += 2; return 'Eastern bloc tightens (+2 VP). Support in ' + gained.join(', ') + '.';
  }
  return '';
}
/* Prague free coup (E3) */
function freeCoup(s, id) {
  const side = 'E';
  if (!s.freeCoupReady.E) return { ok: false, msg: 'No free coup available.' };
  if (s.inf[id].E < 2 || !isTarget(id) || s.neutral[id]) return { ok: false, msg: 'Needs 2+ Soviet influence there.' };
  const en = 'W';
  s.freeCoupReady.E = false;
  if (s.guard.W[id]) { delete s.guard.W[id]; s.inf[id].E = Math.max(0, s.inf[id].E - 1); s.notes.W.push({ kind: 'foiled', region: id, text: 'Foiled! You exposed a Soviet coup attempt in ' + REG[id].name + '.' }); return { ok: true, blocked: true, msg: 'BLOCKED. The coup in ' + REG[id].name + ' was exposed.' }; }
  s.inf[id].E = Math.min(5, s.inf[id].E + 2); s.inf[id].W = Math.max(0, s.inf[id].W - 2);
  s.know.E[id] = { v: s.inf[id].W, t: s.turn };
  s.acts.E.push({ type: 'special', region: id });
  chron(s, 'A coup shakes ' + REG[id].name + '.');
  s.notes.W.push({ kind: 'big', region: id, text: 'ALERT: a Soviet coup hit ' + REG[id].name + '.' });
  return { ok: true, hit: true, msg: 'COUP in ' + REG[id].name + ': Soviet influence ' + s.inf[id].E + ', Western ' + s.inf[id].W + '.' };
}

/* ---------- dispatches (indirect intel on what the other side did last turn) ---------- */
const DET = { spread: 0.55, subvert: 0.85, guard: 0.35, recon: 0.25, special: 1.0 };
function dispatchText(en, type, region) {
  const who = SIDE[en].adj, nm = REG[region].name;
  switch (type) {
    case 'spread': return pick([who + ' delegations and party organisers busy in ' + nm, 'Growing ' + who + ' presence reported around ' + nm, who + ' money and newsprint arriving in ' + nm]);
    case 'subvert': return pick(['Sabotage and arrests reported in ' + nm, 'A ' + who + ' network was shaken in ' + nm + ' (or someone shook it)', 'Mysterious fires and resignations in ' + nm]);
    case 'guard': return pick(['Security services tighten checks in ' + nm, 'New border and telephone controls in ' + nm]);
    case 'recon': return pick(['A ' + who + ' observer was seen photographing ' + nm, 'Questions about ' + nm + ' passed through a ' + who + ' intermediary']);
    case 'special': return 'Major ' + who + ' operation under way in ' + nm;
  }
  return '';
}
function genDispatches(s, side) {
  const en = other(side);
  const out = [];
  for (const a of s.lastActs[en]) {
    if (rnd() > (DET[a.type] || 0.4)) continue;
    const src = pick(SOURCES);
    const truth = rnd() < src.acc;
    let region = a.region;
    if (!truth) { const opts = (ADJ[a.region] || []).filter(isTarget); region = opts.length && rnd() < 0.7 ? pick(opts) : pick(REG_IDS.filter(isTarget)); }
    out.push({ region, type: a.type, text: dispatchText(en, a.type, region), src: src.name, tip: src.tip, acc: src.acc, truth });
  }
  if (rnd() < (s.focus ? 0.3 : 0.7)) { // chaff
    const r = pick(REG_IDS.filter(isTarget));
    const src = pick([SOURCES[3], SOURCES[4], SOURCES[2]]);
    out.push({ region: r, type: 'spread', text: dispatchText(en, pick(['spread', 'guard']), r), src: src.name, tip: src.tip, acc: src.acc, truth: false });
  }
  return shuffle(out).slice(0, s.focus ? 3 : 4);
}

function prepDispatches(s, side) {
  const d = genDispatches(s, side);
  s.dispReg[side] = d.map((x) => x.region);
  return d;
}

/* ---------- end of turn: anchors ---------- */
function endTurn(s) {
  const t = s.turn;
  const log = [];
  s.lastActs = { W: s.acts.W.slice(), E: s.acts.E.slice() };
  // anchors tied to this turn (Berlin is judged by the boss fight)
  for (const a of ANCH) if (a.turn === t && !a.special && (!s.focus || a.core)) log.push(judge(s, a));
  return log;
}
function judge(s, a) {
  const c = a.reg ? ctrl(s, a.reg) : null;
  let ok;
  if (a.test) ok = !!a.test(s);
  else { ok = c === a.expect; if (a.expect === 'N') ok = c === null || c === 'N'; }
  const rec = { id: a.id, turn: s.turn, core: a.core, title: a.title, date: a.date, ok, real: a.real, alt: a.alt, actual: c, expect: a.expect };
  if (!ok) {
    s.alt++;
    const beneficiary = a.test ? a.upsetTo : (c === 'W' || c === 'E' ? c : null);
    if (beneficiary) { s.vp[beneficiary]++; rec.upset = beneficiary; }
  }
  s.anchors.push(rec);
  if (a.expect === 'N' && ok) s.neutral[a.reg] = true;
  chron(s, (ok ? 'History holds: ' : 'TIMELINE DIVERGES: ') + a.title);
  return rec;
}
function advance(s) {
  if (s.turn >= TURNS.length - 1) { s.phase = 'over'; s.over = finalScore(s); return true; }
  s.turn++; s.phase = 'start';
  while (s.focus && FOCUS_SKIP.includes(s.turn) && s.turn < TURNS.length - 1) s.turn++;
  return false;
}

/* ---------- scoring ---------- */
function score(s) {
  const out = { W: { reg: 0, vp: s.vp.W, list: [] }, E: { reg: 0, vp: s.vp.E, list: [] } };
  for (const id of REG_IDS) {
    const c = ctrl(s, id);
    if ((c === 'W' || c === 'E') && REG[id].val > 0) { out[c].reg += REG[id].val; out[c].list.push(id); }
  }
  out.W.total = out.W.reg + out.W.vp; out.E.total = out.E.reg + out.E.vp;
  return out;
}
function finalScore(s) {
  const sc = score(s);
  let winner = sc.W.total > sc.E.total ? 'W' : sc.E.total > sc.W.total ? 'E' : null;
  return { sc, winner, alt: s.alt, anchors: s.anchors };
}

/* ---------- fog-of-war view ---------- */
function viewFor(s, side) {
  const en = other(side);
  const reg = {};
  for (const id of REG_IDS) {
    const c = ctrl(s, id);
    const k = s.know[side][id];
    reg[id] = {
      mine: s.inf[id][side], control: c,
      known: k ? { v: k.v, age: s.turn - k.t } : null,
      guarded: !!s.guard[side][id],
      neutral: s.neutral[id]
    };
  }
  return { turn: s.turn, ap: s.ap[side], reg, doc: s.doc[side], enemyDoc: s.doc[en], vp: s.vp[side], alt: s.alt };
}

/* ---------- Berlin boss ---------- */
const BROUNDS = [
  { label: 'JUL 1948', cons: 9, cap: 2, note: 'Operation Vittles starts. Only a few C-47s are available.' },
  { label: 'AUG-SEP 1948', cons: 9, cap: 3, note: 'Bigger C-54 Skymasters arrive. West Berliners rally in front of the Reichstag.' },
  { label: 'OCT-NOV 1948', cons: 10, cap: 3, note: 'General Tunner reorganises the airlift: planes land every 3 minutes.' },
  { label: 'DEC 1948-JAN 1949', cons: 13, cap: 4, note: 'Winter. Coal and fog. Berlin needs more than ever.' },
  { label: 'FEB-MAR 1949', cons: 13, cap: 4, note: 'Quiet talks begin between Washington and Moscow.' },
  { label: 'APR-MAY 1949', cons: 10, cap: 5, note: '"Easter Parade": 1,398 flights in one day.' }
];
const LANES = ['NORTH (Hamburg)', 'CENTRE (Hanover)', 'SOUTH (Frankfurt)'];
const WCARDS = {
  surge: { name: 'AIRLIFT SURGE', desc: '+1 capacity per plane this round. Tension +1.', uses: 3 },
  candy: { name: 'CANDY DROP', desc: '+2 morale. Pilots drop sweets for the children.', uses: 2 },
  force: { name: 'SHOW OF FORCE', desc: 'B-29 bombers fly to Britain. Harassment is weaker this round. Tension +1.', uses: 2 },
  talks: { name: 'BACK-CHANNEL TALKS', desc: 'Tension -2. From round 4.', uses: 1 },
  hold: { name: 'HOLD STEADY', desc: 'No special action.', uses: 99 }
};
const ECARDS = {
  power: { name: 'CUT THE POWER', desc: 'Stock -1, morale -1.', uses: 3 },
  riots: { name: 'STIRRED-UP RIOTS', desc: 'Morale -2. Tension +1.', uses: 2 },
  split: { name: 'SPLIT THE CITY HALL', desc: 'Morale -2. From round 3.', uses: 1 },
  hold: { name: 'WAIT AND SQUEEZE', desc: 'No special action.', uses: 99 }
};
function berlinInit(s) {
  const w4 = s.doc.W >= 4, e4 = s.doc.E >= 4;
  const g = s.inf.G.W;
  const b = {
    round: 0, stock: 11 + (w4 ? 2 : 0), morale: 5 + (w4 ? 2 : 0) + (g >= 4 ? 1 : 0), tension: 0,
    flights: 4,
    capBonus: 0,
    harassMult: s.inf.E.E >= 4 ? 0.4 : 0.5,
    wc: {}, ec: {}, hist: [], fog: [], done: false, outcome: null, last: null
  };
  for (const k in WCARDS) b.wc[k] = WCARDS[k].uses;
  for (const k in ECARDS) b.ec[k] = ECARDS[k].uses + (e4 && k !== 'hold' ? 1 : 0);
  b.fog = [];
  for (let i = 0; i < BROUNDS.length; i++) b.fog.push(i === 3 || i === 4 ? ri(3) : (rnd() < 0.7 ? ri(3) : -1));
  s.berlin = b; s.phase = 'berlin';
  return b;
}
function berlinCanW(b, card) { if (card === 'talks' && b.round < 3) return false; return b.wc[card] > 0; }
function berlinCanE(b, card) { if (card === 'split' && b.round < 2) return false; return b.ec[card] > 0; }
function berlinResolve(s, wch, ech) {
  const b = s.berlin, R = BROUNDS[b.round];
  const wc = berlinCanW(b, wch.card) ? wch.card : 'hold';
  const ecard = berlinCanE(b, ech.card) ? ech.card : 'hold';
  const alloc = wch.alloc.slice();
  // sanitise allocation: exactly `flights` planes
  let sum = alloc.reduce((a, x) => a + x, 0);
  while (sum > b.flights) { const i = alloc.indexOf(Math.max(...alloc)); alloc[i]--; sum--; }
  while (sum < b.flights) { alloc[ri(3)]++; sum++; }
  const lane = ech.lane;
  b.wc[wc]--; b.ec[ecard]--;
  const cap = R.cap + (wc === 'surge' ? 1 : 0);
  const fog = b.fog[b.round];
  const per = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let m = 1;
    if (c === lane) m *= wc === 'force' ? 0.75 : b.harassMult;
    if (c === fog) m *= 0.75;
    per[c] = Math.floor(alloc[c] * cap * m);
  }
  const delivered = per[0] + per[1] + per[2];
  b.stock = Math.max(0, b.stock + delivered - R.cons - (ecard === 'power' ? 1 : 0));
  let dm = 0;
  if (b.stock <= 3) dm -= 2; else if (b.stock < R.cons) dm -= 1; else if (b.stock >= R.cons * 1.4) dm += 1;
  if (ecard === 'power') dm -= 1;
  if (ecard === 'riots') dm -= 2;
  if (ecard === 'split') dm -= 2;
  if (wc === 'candy') dm += 2;
  b.morale = Math.max(0, Math.min(10, b.morale + dm));
  let dt = 1; // harassment itself
  if (wc === 'surge' || wc === 'force') dt++;
  if (ecard === 'riots') dt++;
  if (wc === 'talks') dt -= 3; // net -2 together with the +1
  b.tension = Math.max(0, Math.min(10, b.tension + dt));
  const rec = { round: b.round, label: R.label, alloc, lane, wc, ec: ecard, per, delivered, cons: R.cons, stock: b.stock, morale: b.morale, tension: b.tension, fog, cap, dm, dt };
  b.hist.push(rec); b.last = rec;
  b.round++;
  if (b.stock <= 0 || b.morale <= 0) { b.done = true; b.outcome = 'E'; }
  else if (b.tension >= 10) { b.done = true; b.outcome = 'scare'; }
  else if (b.round >= BROUNDS.length) { b.done = true; b.outcome = 'W'; }
  return rec;
}
function berlinFinish(s) {
  const b = s.berlin; const o = b.outcome;
  const a = ANCH.find((x) => x.special);
  const rec = { id: a.id, turn: s.turn, core: a.core, title: a.title, date: a.date, real: a.real, alt: a.alt, expect: 'W' };
  if (o === 'W') { s.inf.W.W = 5; s.inf.W.E = 0; rec.ok = true; rec.actual = 'W'; chron(s, 'History holds: the airlift saves West Berlin.'); }
  else {
    rec.ok = false; s.alt++;
    if (o === 'E') { s.inf.W.W = 0; s.inf.W.E = 5; rec.actual = 'E'; rec.upset = 'E'; s.vp.E++; rec.alt = 'West Berlin falls. In reality the airlift succeeded and the blockade was lifted in May 1949.'; chron(s, 'TIMELINE DIVERGES: West Berlin falls.'); }
    else { s.inf.W.W = 0; s.inf.W.E = 0; rec.actual = null; s.vp.W = Math.max(0, s.vp.W - 1); s.vp.E = Math.max(0, s.vp.E - 1); rec.alt = 'Tension reaches breaking point and both sides pull back to the brink. In reality neither side let it get close to war and the airlift simply worked.'; chron(s, 'TIMELINE DIVERGES: a war scare over Berlin.'); }
  }
  s.anchors.push(rec);
  s.phase = 'acting';
  return rec;
}

/* ---------- bots ---------- */
function botBelief(s, side, id) {
  const en = other(side);
  const k = s.know[side][id];
  if (k) return k.v + (s.turn - k.t) * 0.3;
  // unknown: noisy guess around truth (what a decent analyst would estimate)
  return Math.max(0, s.inf[id][en] + (ri(3) - 1));
}
function regionWant(s, side, id) {
  // how much the bot wants this region
  const r = REG[id], en = other(side);
  const me = s.inf[id][side], they = botBelief(s, side, id);
  if (s.neutral[id]) return -1;
  let w = r.val;
  const c = ctrl(s, id);
  const ctrlMe = c === side;
  if (ctrlMe && me - they >= 3) w *= 0.15; // safe
  else if (ctrlMe) w *= 0.6;
  if (me < 3 && they >= me + 2) w *= 0.5; // probably lost
  if (me >= 2 && me <= 4 && Math.abs(me - they) <= 2) w *= 1.5; // contested & winnable
  // upcoming anchors the bot cannot know about, but real players may: bots just play to win
  return w + rnd() * 0.5;
}
function botTurn(s, side, level) {
  level = level == null ? 1 : level;
  const en = other(side);
  const log = [];
  const tryAct = (type, id) => { const r = act(s, side, type, id); if (r.ok) log.push(r); return r; };
  // notes from enemy last phase are visible to bots too (they learned about hits/foils)
  // 1) doctrine
  for (let k = 0; k < 2 && doctrineReady(s, side) && s.ap[side] >= 2; k++) {
    const d = nextDoctrine(s, side);
    if (s.turn === d.avail || rnd() < 0.8) tryAct('doctrine'); else break;
  }
  // 1b) free coup
  if (side === 'E' && s.freeCoupReady.E) {
    const cands = REG_IDS.filter((id) => isTarget(id) && !s.neutral[id] && s.inf[id].E >= 2 && ctrl(s, id) !== 'E').sort((a, b) => regionWant(s, 'E', b) - regionWant(s, 'E', a));
    if (cands.length) { const r = freeCoup(s, cands[0]); log.push(Object.assign({ ok: true, type: 'special', region: cands[0], cost: 0 }, r)); }
    s.freeCoupReady.E = false;
  }
  // 2) loop spending AP
  let guardCount = 0, safety = 20;
  while (s.ap[side] > 0 && safety-- > 0) {
    const ap = s.ap[side];
    // free recon
    if (s.freeRecon[side]) {
      const c = REG_IDS.filter((id) => isTarget(id) && !s.neutral[id] && ctrl(s, id) !== en).sort((a, b) => regionWant(s, side, b) - regionWant(s, side, a));
      if (c.length) { tryAct('recon', c[0]); continue; }
      s.freeRecon[side] = false;
    }
    if (s.freeGuard[side] && !s.focus) {
      const g = REG_IDS.filter((id) => isTarget(id) && !s.neutral[id] && s.inf[id][side] >= 2 && !s.guard[side][id]).sort((a, b) => REG[b].val * (s.curNotes[side].some((n) => n.region === b) ? 2 : 1) + rnd() - REG[a].val * (s.curNotes[side].some((n) => n.region === a) ? 2 : 1) - rnd());
      if (g.length) { tryAct('guard', g[0]); guardCount++; continue; }
      s.freeGuard[side] = false;
    }
    const options = [];
    for (const id of REG_IDS) {
      if (!isTarget(id) || s.neutral[id]) continue;
      const want = regionWant(s, side, id);
      const me = s.inf[id][side], they = botBelief(s, side, id);
      if (canAct(s, side, 'spread', id) === null) {
        let v = want * (me < 5 ? 1 : 0);
        if (me + 1 >= 3 && me < 3) v *= 1.6; // crossing control threshold
        if (they >= me + 2) v *= 0.7;
        options.push({ type: 'spread', id, v: v / costOf(s, side, 'spread', id) });
      }
      if (ap >= 2 && canAct(s, side, 'subvert', id) === null) {
        const like = Math.min(1, they / 2);
        const k = s.know[side][id];
        let v = want * like * 1.15 * (they >= 2 ? 1.2 : 0.7) * (ctrl(s, id) === en ? 1.3 : 1);
        if (k && k.v === 0 && k.t >= s.turn - 1) v *= 0.1;
        options.push({ type: 'subvert', id, v: v / 2 });
      }
      if (ap >= 3 && canAct(s, side, 'special', id) === null && !(ctrl(s, id) === side)) {
        const v = want * 1.7 * Math.min(1, (they + 1) / 3);
        options.push({ type: 'special', id, v: v / 3 });
      }
      if (canAct(s, side, 'guard', id) === null && guardCount < 2 && me >= 2) {
        const threat = s.curNotes[side].some((n) => n.region === id) ? 1.5 : 0.4 + (s.dispReg[side].indexOf(id) >= 0 ? 0.8 : 0);
        const v = REG[id].val * 0.45 * threat * (me >= 3 ? 1.2 : 0.9);
        options.push({ type: 'guard', id, v });
      }
      if (canAct(s, side, 'recon', id) === null && level >= 1) {
        const k = s.know[side][id];
        const stale = !k ? 1 : Math.min(1, (s.turn - k.t) / 3);
        const v = REG[id].val * 0.22 * stale * (ctrl(s, id) === en ? 0.5 : 1);
        options.push({ type: 'recon', id, v });
      }
    }
    if (!options.length) break;
    options.sort((a, b) => b.v - a.v);
    const top = options.slice(0, 3);
    const choice = level >= 1 ? (rnd() < 0.7 ? top[0] : pick(top)) : pick(options);
    const r = tryAct(choice.type, choice.id);
    if (!r.ok) { s.ap[side]--; }
    if (choice.type === 'guard') guardCount++;
  }
  return log;
}

/* Bot play for Berlin */
function botBerlinW(s) {
  const b = s.berlin;
  const R = BROUNDS[b.round];
  const w = [1, 1, 1];
  const fog = b.fog[b.round];
  if (fog >= 0) w[fog] *= 0.55;
  // slight bias: East tends to repeat, so avoid last-harassed lane a bit
  const last = b.hist[b.hist.length - 1];
  if (last) w[last.lane] *= 0.8;
  for (let i = 0; i < 3; i++) w[i] *= 0.6 + rnd() * 0.8;
  const alloc = [0, 0, 0];
  for (let k = 0; k < b.flights; k++) {
    const tot = w[0] + w[1] + w[2]; let x = rnd() * tot, i = 0;
    while (i < 2 && x > w[i]) { x -= w[i]; i++; }
    alloc[i]++; w[i] *= 0.6;
  }
  let card = 'hold';
  if (b.tension >= 7 && berlinCanW(b, 'talks')) card = 'talks';
  else if (b.morale <= 4 && berlinCanW(b, 'candy')) card = 'candy';
  else if (b.stock < R.cons && berlinCanW(b, 'surge')) card = 'surge';
  else if (b.tension <= 4 && b.morale <= 6 && berlinCanW(b, 'candy') && rnd() < 0.5) card = 'candy';
  else if (b.round >= 3 && berlinCanW(b, 'force') && rnd() < 0.3) card = 'force';
  else if (berlinCanW(b, 'surge') && rnd() < 0.35) card = 'surge';
  return { alloc, card };
}
function botBerlinE(s) {
  const b = s.berlin;
  const w = [1, 1, 1];
  const last = b.hist[b.hist.length - 1];
  if (last) for (let i = 0; i < 3; i++) w[i] += last.alloc[i] * 0.9;
  const fog = b.fog[b.round];
  if (fog >= 0) w[fog] *= 0.6;
  for (let i = 0; i < 3; i++) w[i] *= 0.7 + rnd() * 0.6;
  let lane = 0; for (let i = 1; i < 3; i++) if (w[i] > w[lane]) lane = i;
  let card = 'hold';
  if (b.round >= 2 && berlinCanE(b, 'split') && rnd() < 0.7) card = 'split';
  else if (b.tension <= 6 && berlinCanE(b, 'riots') && b.morale <= 7 && rnd() < 0.5) card = 'riots';
  else if (berlinCanE(b, 'power') && rnd() < 0.7) card = 'power';
  return { lane, card };
}

/* ---------- helpers for the UI ---------- */
function runBotRounds(s) { while (!s.berlin.done) berlinResolve(s, botBerlinW(s), botBerlinE(s)); }

const API = {
  seed, rnd, ri, pick, shuffle, other, SIDE, setMap, get MAP() { return MAP; }, get ADJ() { return ADJ; }, get TILES() { return TILES; },
  REG, REG_IDS, FOCUS_SKIP, ladder, isTarget, SOURCES, DOC, TURNS, ANCH, BROUNDS, LANES, WCARDS, ECARDS,
  newGame, ctrl, startTurn, endTurn, advance, act, canAct, costOf, inReach, hasPresence, nextDoctrine, doctrineReady, specialUnlocked, freeCoup,
  genDispatches, prepDispatches, startSide, score, finalScore, viewFor, chron,
  berlinInit, berlinResolve, berlinFinish, berlinCanW, berlinCanE, botBerlinW, botBerlinE, runBotRounds,
  botTurn
};
if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Engine = API;
})(typeof window !== 'undefined' ? window : globalThis);

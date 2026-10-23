# Iron Curtain 1945-49: classroom server

One Cloudflare Worker serves the game page and runs every council table for a class in a single Durable Object.
Each table is a 1v1 match: one iPad takes the West seat, another takes the East seat. Two students share each iPad.
Tables with only one iPad seated play against the bot.

## Deploy (about 10 minutes)

1. Create a **private** GitHub repository and upload the contents of this folder (not `node_modules`).
2. Cloudflare dashboard > **Workers & Pages** > **Create** > **Import a repository**. Pick the repo.
   - Build command: leave empty
   - Deploy command: `npx wrangler deploy`
3. After the first deploy, open the Worker > **Settings** > **Variables and Secrets** > add a **Secret** named `TEACHER_PIN` with a PIN only you know.
   (If you skip this step the PIN is `1945`, so change it.)
4. Open `https://<your-worker>.workers.dev/` on the iPads. Open `https://<your-worker>.workers.dev/teacher.html` on your own device.

Or from a laptop: `npm install`, `npx wrangler login`, `npx wrangler deploy`, then `npx wrangler secret put TEACHER_PIN`.

## Running a lesson

- Students tap **JOIN CLASS GAME**, then tap a free West or East seat at a table.
- Teacher page: choose the version (Focused = lesson content, 7 turns; Full = bonus history + Berlin boss), the turn timer and the pacing, then **START ALL TABLES**.
- Pacing "Teacher starts each turn": after every turn each table waits on a "turn complete" screen so you can debrief, then you press **NEXT TURN (ALL)**.
- **FORCE STEP** on a table (or all) finishes whatever step it is waiting on, for example when one iPad has gone to sleep. A student who refreshes or reconnects returns to their seat automatically.
- For another class on another day, add `?room=periodtwo` to both URLs (student and teacher). Each room is separate.
- **Projector:** open `/projector.html` (add `?room=...` for another room) on the classroom screen. It shows every table's map, score and timeline status, plus a West vs East bloc bar for the whole class. On the teacher page, **PROJECT** on a table spotlights it (big map, doctrines, history check); **PROJECTOR: SHOW ALL** returns to the grid. It only ever shows public information, never anyone's hidden influence.
- **RESET ALL TABLES** sends everyone back to the lobby with their seats kept.

## Free tier usage

Static pages cost no Worker requests. Each iPad holds one WebSocket. The Durable Object uses WebSocket hibernation, so it only bills for the moments it is handling a message or timer.
A full class of 11 iPads over a 40 minute lesson is a few thousand messages at most, a small fraction of the free allowance (100,000 requests per day for Workers and for Durable Objects; incoming WebSocket messages count 1 request per 20 messages).
The free plan requires SQLite-backed Durable Objects, which is what `wrangler.jsonc` already sets up.

## What is in here

- `src/worker.js`: Worker + the ClassRoom Durable Object (lobby, tables, timers, Berlin boss, reconnect)
- `src/engine.cjs`, `src/map.json`: the same game engine and map as the single-player page
- `public/index.html`: the game (single-player and online); `public/teacher.html`: the teacher dashboard
- `test/`: scripts that play simulated students against a local server (`npx wrangler dev`, then `node test/play.mjs`)

Fog of war is enforced on the server: each iPad only receives its own influence numbers, public control results and what it has scouted.

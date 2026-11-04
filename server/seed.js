// Seeds characters from a capture (the user's own characters) so server twins start identical to the real ones.
// CLI: node server/seed.js --db server/data.sqlite --account <name> [--token <t>] capture.jsonl…  (prints the token)
// Takes, per path, the last 200 GET reply: /api/characters/:id (view), /api/characters/:id/party, /api/kill-event,
// /api/storage. Chat is never imported; party members are limited to the seeded characters.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';

/** Imports capture lines (JSONL strings) into `game` under `account`; returns the account token. */
export function seedCapture(game, lines, { account, token = randomBytes(16).toString('hex') }) {
  const last = {};
  for (const line of lines) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.kind !== 'http' || r.method !== 'GET' || r.status !== 200 || !r.resp) continue;
    last[r.path.split('?')[0]] = typeof r.resp === 'string' ? JSON.parse(r.resp) : r.resp;
  }
  game.accounts.set(account, { name: account, token: game.accounts.get(account)?.token ?? token });
  for (const [path, body] of Object.entries(last)) {
    const m = path.match(/^\/api\/characters\/(\d+)(\/party)?$/);
    if (!m) continue;
    if (!m[2]) { game.addCharacter(body, account); continue; }
    const C = game.chars.get(+m[1]);
    const p = body.party;
    if (!p) continue;
    const { members, ...rest } = p;
    game.parties.set(p.id, rest);
    if (C) C.partyId = p.id;
  }
  // members whose own view was seeded later still join their party
  for (const [path, body] of Object.entries(last)) {
    const m = path.match(/^\/api\/characters\/(\d+)\/party$/);
    if (m && body.party) for (const mem of body.party.members) if (game.chars.has(mem.id)) game.chars.get(mem.id).partyId = body.party.id;
  }
  if (last['/api/kill-event']?.event) game.killEvent = last['/api/kill-event'].event;
  if (last['/api/storage']?.storage) game.storage.set(account, last['/api/storage'].storage);
  return game.accounts.get(account).token;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values, positionals } = parseArgs({ allowPositionals: true,
    options: { db: { type: 'string', default: 'server/data.sqlite' }, account: { type: 'string' }, token: { type: 'string' } } });
  if (!values.account || !positionals.length) {
    console.error('usage: node server/seed.js --db server/data.sqlite --account <name> [--token <t>] capture.jsonl…');
    process.exit(2);
  }
  const { openStore } = await import('./index.js');
  const { createGame } = await import('./game.js');
  const store = openStore(values.db);
  const game = createGame();
  game.restore(store.load());
  const lines = positionals.flatMap((p) => readFileSync(p, 'utf8').split('\n'));
  const token = seedCapture(game, lines, { account: values.account, token: values.token });
  store.save(game);
  console.log(JSON.stringify({ account: values.account, token, characters: game.charsOf(values.account).map((C) => [C.id, C.name]) }));
}

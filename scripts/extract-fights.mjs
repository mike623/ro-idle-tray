// L2 fight corpus (#23): `node scripts/extract-fights.mjs <capture.jsonl...> --out tests/fixtures/fights/`.
// Fights are `found` → `kill` (or player death) per character; format in docs/offline-backend/fight-corpus.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

// Combat event types kept in a fight; everything else (chat, exp/drop with player names, loot) is dropped.
const COMBAT = new Set(['found', 'targetSwitch', 'playerAttack', 'skillHit', 'skillCast', 'skillInterrupt', 'skillHeal', 'monsterAttack',
  'mobSkill', 'mobSkillCast', 'statusStart', 'statusResist', 'ailmentStart', 'ailmentEnd', 'useItem', 'buffStart', 'buffEnd', 'kill', 'death']);
const KEEP = ['damage', 'result', 'hits', 'skill', 'lv', 'hpLeft', 'castMs', 'status', 'ailment', 'durationMs', 'itemId', 'buffId', 'approachMs', 'reason'];

// A fight opens when the character picks a target: its own `found`, or a `targetSwitch` (party assist / retarget).
const OPENS = new Set(['found', 'targetSwitch']);
const OWN_HITS = new Set(['playerAttack', 'skillHit']), MOB_HITS = new Set(['monsterAttack', 'mobSkill']);
const charIdOf = r => Number(r.path?.match(/\/api\/characters\/(\d+)/)?.[1]);
const json = s => (typeof s === 'string' ? JSON.parse(s) : s);

function trim(e, start, uid) {
  const b = e.body, out = {type: b.type, t: e.simTime - start};
  for (const k of KEEP) if (b[k] !== undefined && typeof b[k] !== 'object') out[k] = b[k];
  if (b.uid !== undefined && b.uid !== uid) out.otherMob = b.monsterId ?? true; // add from a second aggressor
  return out;
}

function charSnapshot(s, start) {
  const inv = new Map((s.inventory ?? []).map(i => [i.uid, i]));
  const equipment = Object.fromEntries(Object.entries(s.equipment ?? {}).map(([slot, uid]) => {
    const {itemId, refine, cards} = inv.get(uid) ?? {};
    return [slot, {itemId, refine, cards}];
  }));
  const {skills, name, ...character} = s.character; // charId identifies; name not needed
  return {character, derived: s.derived, equipment, skills, mapId: s.mapId, snapshotAgeMs: start - s.time};
}

// Buffs at fight start: nearest earlier snapshot's buffs aged forward, then buffStart/buffEnd events up to the start.
function buffsAt(s, events, start) {
  const buffs = new Map(), lvs = new Map(); // lvs: last cast/support level per skill (buffStart carries none)
  for (const b of s.buffs ?? []) if (b.remainingMs > start - s.time) buffs.set(b.id, {id: b.id, lv: b.lv, until: s.time + b.remainingMs});
  for (const e of events) {
    if (e.simTime <= s.time || e.simTime > start) continue;
    if (e.body.type === 'skillCast' || e.body.type === 'support') lvs.set(e.body.skill, e.body.lv);
    if (e.body.type === 'buffStart') buffs.set(e.body.buffId, {id: e.body.buffId, lv: lvs.get(e.body.buffId) ?? buffs.get(e.body.buffId)?.lv, until: e.simTime + e.body.durationMs});
    if (e.body.type === 'buffEnd') buffs.delete(e.body.buffId);
  }
  return [...buffs.values()].filter(b => b.until > start).map(({id, lv, until}) => ({id, lv, remainingMs: until - start}));
}

export function extractFights(records) {
  const events = new Map(), snaps = new Map(); // charId → Map(seq → event) / [snapshot]
  const add = (m, id, v) => (m.get(id) ?? m.set(id, v()).get(id));
  for (const r of records) {
    const id = charIdOf(r);
    if (!id) continue;
    let list = null, snap = null;
    if (r.kind === 'sse' && r.name === 'events') list = json(r.data);
    else if (r.kind === 'sse' && r.name === 'snapshot') snap = json(r.data).snapshot;
    else if (r.kind === 'http' && r.status === 200 && /\/events(\?|$)/.test(r.path)) list = json(r.resp).events;
    else if (r.kind === 'http' && r.status === 200 && /^\/api\/characters\/\d+(\?|$)/.test(r.path)) snap = json(r.resp).snapshot;
    if (list) { const m = add(events, id, () => new Map()); for (const e of list) m.set(e.seq, e); }
    if (snap?.character) add(snaps, id, () => []).push(snap);
  }
  const fights = [], stats = {opened: 0, kill: 0, death: 0, abandoned: 0, noSnapshot: 0};
  const latest = (id, t) => (snaps.get(id) ?? []).findLast(x => x.time <= t);
  for (const ss of snaps.values()) ss.sort((a, b) => a.time - b.time);
  for (const [charId, m] of events) {
    const evs = [...m.values()].sort((a, b) => a.seq - b.seq);
    let open = null, map = null; // map: last mapChange target, overrides an older snapshot's mapId
    const close = outcome => {
      stats[outcome]++;
      if (outcome !== 'abandoned') {
        const {s, start, uid, mapId, startedBy, ...f} = open;
        const partyIds = [...snaps.keys()].filter(id => id !== charId && latest(id, start)?.mapId === mapId);
        // Mob HP when we first hit it; below the mob's max HP means the party had already damaged it.
        const first = f.events.find(e => OWN_HITS.has(e.type) && e.otherMob === undefined && e.hpLeft !== undefined);
        fights.push({...f, start: startedBy, startSimTime: start, mobHpStart: first ? first.hpLeft + first.damage : null, mapId, partyIds, outcome, charSnapshot: charSnapshot(s, start), buffs: buffsAt(s, evs, start)});
      }
      open = null;
    };
    for (const e of evs) {
      const b = e.body;
      if (b.type === 'mapChange' || b.type === 'teleport') map = {t: e.simTime, id: b.to ?? b.mapId};
      if (OPENS.has(b.type) && b.uid === open?.uid) continue; // re-picking the current target
      if (open && (OPENS.has(b.type) || ['mapChange', 'teleport', 'stop', 'halting'].includes(b.type))) close('abandoned');
      if (OPENS.has(b.type) && b.uid !== undefined) {
        stats.opened++;
        const s = latest(charId, e.simTime);
        if (!s) { stats.noSnapshot++; continue; }
        const mapId = map && map.t >= s.time ? map.id : s.mapId;
        open = {id: `${charId}:${b.uid}`, charId, uid: b.uid, mobId: b.monsterId, start: e.simTime, startedBy: b.type === 'found' ? 'found' : b.assist ? 'assist' : 'switch', s, mapId, events: []};
      }
      if (!open || !COMBAT.has(b.type)) continue;
      open.events.push(trim(e, open.start, open.uid));
      const dead = b.type === 'death' || (MOB_HITS.has(b.type) && (b.me?.[0] === 0 || b.hpLeft === 0));
      if (dead) close('death');
      else if (b.type === 'kill' && b.uid === open.uid) close('kill');
    }
    if (open) close('abandoned');
  }
  return {fights, stats};
}

// Per-fight observables L2 compares against engine runs. Landed/received count events; `hits` (multi-hit) is ignored.
export function observe(f) {
  const mine = f.events.filter(e => OWN_HITS.has(e.type) && e.otherMob === undefined);
  const theirs = f.events.filter(e => MOB_HITS.has(e.type));
  const landed = e => e.damage > 0;
  return {id: f.id, charId: f.charId, job: f.charSnapshot.character.job, mapId: f.mapId, mobId: f.mobId, start: f.start, outcome: f.outcome,
    durationMs: f.events.at(-1).t, damageTaken: theirs.reduce((n, e) => n + (e.damage ?? 0), 0),
    hitsLanded: mine.filter(landed).length, attacksMade: mine.length, hitsReceived: theirs.filter(landed).length, attacksReceived: theirs.length,
    ownDamage: mine.reduce((n, e) => n + (e.damage ?? 0), 0), mobHpStart: f.mobHpStart};
}

export const stratumOf = f => [`${f.charId}/${f.charSnapshot.character.job}`, f.mapId, f.mobId, f.outcome].join('|');

// Round-robin over char/job|map|mob|outcome strata (fixed hash order inside each) so rare strata are always kept.
export function stratify(fights, n) {
  const order = f => crypto.createHash('sha1').update(f.id).digest('hex');
  const groups = Map.groupBy([...fights].sort((a, b) => order(a).localeCompare(order(b))), stratumOf);
  const queues = [...groups.keys()].sort().map(k => groups.get(k));
  const out = [];
  for (let i = 0; out.length < n && queues.some(q => q.length > i); i++)
    for (const q of queues) if (q[i] && out.length < n) out.push(q[i]);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), at = args.indexOf('--out');
  const mi = args.indexOf('--max'), max = mi < 0 ? 400 : Number(args[mi + 1]);
  if (at < 0 || !args[at + 1] || !(max > 0)) { console.error('usage: extract-fights.mjs <capture.jsonl...> --out <dir> [--max 400]'); process.exit(2); }
  const out = args[at + 1];
  const files = args.filter((a, i) => a.endsWith('.jsonl') && i !== at + 1);
  const records = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)));
  const {fights, stats} = extractFights(records);
  const kept = stratify(fights, max).sort((a, b) => a.charId - b.charId || a.startSimTime - b.startSimTime);
  const strata = {};
  for (const f of fights) (strata[stratumOf(f)] ??= {extracted: 0, kept: 0}).extracted++;
  for (const f of kept) strata[stratumOf(f)].kept++;
  fs.mkdirSync(out, {recursive: true});
  fs.writeFileSync(path.join(out, 'fights.jsonl'), kept.map(f => JSON.stringify(f)).join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({
    captures: files.map(f => path.basename(f)), totals: {...stats, extracted: fights.length, kept: kept.length},
    strata: Object.fromEntries(Object.entries(strata).sort()), fights: kept.map(observe)}, null, 1) + '\n');
  const bytes = fs.statSync(path.join(out, 'fights.jsonl')).size;
  console.log(`${kept.length} fights kept of ${fights.length} extracted (${stats.opened} opened, ${stats.abandoned} abandoned, ${stats.noSnapshot} before any snapshot); fights.jsonl ${(bytes / 1e6).toFixed(2)} MB`);
}

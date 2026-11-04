import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from './formulas.js';

// Trimmed from the user's own merchant (capture profile-6, 2026-11-04) plus bundle job/item rows.
const merchantJob = {
  id: 'merchant', baseWeight: 2800,
  baseHp: Object.assign(Array(48).fill(0), { 47: 745 }),
  baseSp: Object.assign(Array(48).fill(0), { 47: 154 }),
  baseAspd: { fist: 400, dagger: 600, '1hAxe': 700 },
  jobBonus: [
    { lv: 2, stats: { vit: 1 } }, { lv: 6, stats: { dex: 1 } }, { lv: 10, stats: { str: 1 } },
    { lv: 14, stats: { dex: 1 } }, { lv: 18, stats: { vit: 1 } }, { lv: 22, stats: { str: 1 } },
    { lv: 26, stats: { int: 1 } }, { lv: 30, stats: { vit: 1 } }, { lv: 33, stats: { agi: 1 } },
    { lv: 36, stats: { luk: 1 } }, { lv: 38, stats: { dex: 1 } }, { lv: 40, stats: { str: 1 } },
  ],
};
const items = {
  1201: { id: 1201, slots: ['weapon'], weaponType: 'dagger', weaponLevel: 1, atk: 17 },
  2301: { id: 2301, slots: ['armor'], def: 1 },
};
const merchant = {
  character: {
    job: 'merchant', baseLv: 48, jobLv: 38,
    stats: { agi: 1, dex: 40, int: 1, luk: 1, str: 32, vit: 30 },
    skills: { MC_LOUD: 1, NV_BASIC: 9, MC_IDENTIFY: 1, NV_FIRSTAID: 1 },
  },
  inventory: [{ uid: 1, itemId: 1201, refine: 0 }, { uid: 2, itemId: 2301, refine: 0 }],
  equipment: { weapon: 1, armor: 2 },
  buffs: [{ id: 'MC_LOUD', lv: 1 }, { id: 'AL_ANGELUS', lv: 10 }, { id: 'AL_INCAGI', lv: 2 }],
};

test('derive reproduces the captured merchant panel', () => {
  const d = f.derive(merchant, { job: merchantJob, items });
  assert.deepEqual(d.total, { agi: 6, dex: 43, int: 2, luk: 2, str: 38, vit: 33 });
  assert.deepEqual(
    { maxHp: d.maxHp, maxSp: d.maxSp, statusAtk: d.statusAtk, refineAtk: d.refineAtk, matkMin: d.matkMin, matkMax: d.matkMax,
      hardDef: d.hardDef, vitDef: d.vitDef, hardMdef: d.hardMdef, softMdef: d.softMdef, hit: d.hit, flee: d.flee,
      perfectDodge: d.perfectDodge, crit: d.crit, aspd: d.aspd, attackIntervalMs: d.attackIntervalMs,
      weightMax: d.weightMax, hpRegen: d.hpRegen, spRegen: d.spRegen },
    { maxHp: 990, maxSp: 157, statusAtk: 55, refineAtk: 0, matkMin: 2, matkMax: 2, hardDef: 1, vitDef: 33, hardMdef: 0,
      softMdef: 2, hit: 91, flee: 54, perfectDodge: 1, crit: 1, aspd: 144, attackIntervalMs: 1120, weightMax: 3940,
      hpRegen: 11, spRegen: 2 });
});

test('player physical damage follows the fitted order (formulas.md worked example)', () => {
  // statATK33 + floor(17×75%)=45; floor(45×90%)−28+14 refine = 26; double hit = 52.
  assert.equal(f.playerDamage({ statAtk: 33, weaponRoll: 17, wt: 'dagger', size: 'medium', refineAtk: 14,
    monsterDef: 10, monsterSoftDef: 28, hits: 2 }), 52);
});

test('player damage envelope: merchant knife vs Coco is a single value', () => {
  const coco = { def: 0, size: 'small', stats: { vit: 34 } };
  assert.deepEqual(f.playerDamageRange({ statAtk: 55, dex: 43, weapon: items[1201], monster: coco }), { min: 38, max: 38 });
  assert.equal(f.rollPlayerDamage({ statAtk: 55, dex: 43, weapon: items[1201], monster: coco }), 38);
});

test('monster damage to player: Angelus scales def2 before the soft-DEF roll', () => {
  // VIT33, Angelus10 → def2 49 → soft 24..34; Coco ATK 56..67 vs hard DEF1 → raw 55..66.
  assert.deepEqual(f.monsterDamageRange({ atk: [56, 67], hardDef: 1, vit: 33, vitDefRate: 50 }), { min: 21, max: 42 });
  assert.deepEqual(f.monsterDamageRange({ atk: [56, 67], hardDef: 1, vit: 33 }), { min: 37, max: 50 }); // def2 33 → soft 16..18
  assert.equal(f.monsterDamageRange({ atk: [5, 5], hardDef: 50, vit: 80 }).max, 1); // minimum damage 1
});

test('element and size tables', () => {
  assert.equal(f.elementMod('fire', 'earth', 1), 150);
  assert.equal(f.elementMod('neutral', 'ghost', 1), 25);
  assert.equal(f.elementMod('holy', 'undead', 4), 200);
  assert.equal(f.sizeMod('dagger', 'large'), 50);
});

test('cast time scales with DEX; delay is a level lookup', () => {
  const bolt = { castMs: [700, 1400, 2100], delayMs: [1000, 1200, 1400] };
  assert.equal(f.castMs(bolt, 3, 43), 1498);
  assert.equal(f.castMs(bolt, 3, 150), 0);
  assert.equal(f.skillDelayMs(bolt, 5), 1400); // clamps to last level
  assert.equal(f.castMs({ castMs: [] }, 1, 1), 0);
});

test('magic bolt damage subtracts monster INT + VIT/2 after hard MDEF', () => {
  // MATK100 − (20 + 17) = 63; wind vs earth 50% → 31; 3 bolts → 93.
  assert.equal(f.magicDamage({ matkRoll: 100, monster: { mdef: 0, stats: { int: 20, vit: 34 } }, elementMod: 50, hits: 3 }), 93);
});

test('party EXP share: bonus +20% per extra member, capped +100%, split evenly', () => {
  assert.deepEqual(f.partyExpShare({ baseExp: 120, jobExp: 78 }, 8), { base: 30, job: 19 });
  assert.deepEqual(f.partyExpShare({ baseExp: 120, jobExp: 78 }, 1), { base: 120, job: 78 });
  assert.deepEqual(f.partyExpShare({ baseExp: 120, jobExp: 78 }, 3), { base: 56, job: 36 });
});

test('death penalty: 1% of next-level EXP, never below zero, none for novices', () => {
  assert.equal(f.deathPenalty({ baseExp: 5000, baseExpNext: 75973 }), 759);
  assert.equal(f.deathPenalty({ baseExp: 100, baseExpNext: 75973 }), 100);
  assert.equal(f.deathPenalty({ baseExp: 500, baseExpNext: 75973, job: 'novice' }), 0);
});

// ---- Capture check: replay the user's SSE captures through this module and compare with the Python oracle.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const CAPTURE = process.env.RO_CAPTURE_DIR ?? join(homedir(), 'Library/Application Support/com.mikewong.ro-idle-tray/capture');
const BUNDLE = process.env.RO_BUNDLE ?? '.scratch/bundle.js';
const haveInputs = existsSync(CAPTURE) && existsSync(BUNDLE);

// Static bundle data via the oracle's non-evaluating parser (no bundle JS is executed).
const bundleData = () => JSON.parse(execFileSync('python3', ['-I', '-c', `
import json, runpy, sys
from pathlib import Path
d = runpy.run_path('scripts/formula-check.py')['static_data'](Path(sys.argv[1]).read_text())
print(json.dumps({k: d[k] for k in ('items', 'jobs', 'skills', 'monsters', 'summons', 'refine')}))`, BUNDLE], { maxBuffer: 1 << 28 }));

function oracleCounts() {
  let out;
  try { out = execFileSync('python3', ['-I', 'scripts/formula-check.py', CAPTURE, BUNDLE], { maxBuffer: 1 << 26 }); }
  catch (e) { if (e.status !== 1) throw e; out = e.stdout; } // exit 1 = some MISS rows, by design
  const rows = {};
  for (const m of String(out).matchAll(/^(\w+)\s+(\d+)\s+(\d+)\s+(\d+)$/gm)) rows[m[1]] = { OK: +m[2], MISS: +m[3], SKIP: +m[4] };
  return rows;
}

function captureRecords() {
  const out = [];
  for (const file of readdirSync(CAPTURE).filter((n) => n.endsWith('.jsonl')).sort()) {
    const seen = new Set();
    for (const line of readFileSync(join(CAPTURE, file), 'utf8').split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.kind !== 'sse' || (r.name !== 'snapshot' && r.name !== 'events')) continue;
      const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      if (r.name === 'snapshot') out.push([file, 'snapshot', data.snapshot]);
      else for (const e of data) if (!seen.has(e.seq)) { seen.add(e.seq); out.push([file, 'event', e]); }
    }
  }
  const key = ([file, kind, x]) => [file, kind === 'snapshot' ? x.time : x.simTime, kind === 'snapshot' ? 0 : 1, x.seq ?? 0];
  return out.map((r) => [key(r), r]).sort(([a], [b]) => {
    for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
  }).map(([, r]) => r);
}

const DERIVED = ['statusAtk', 'hit', 'flee', 'crit', 'perfectDodge', 'matkMin', 'matkMax', 'maxHp', 'maxSp', 'weightMax',
  'aspd', 'attackIntervalMs', 'hardDef', 'vitDef', 'softMdef', 'hardMdef', 'hpRegen', 'spRegen', 'refineAtk'];

function jsCounts(data) {
  const items = Object.fromEntries(data.items.map((x) => [x.id, x]));
  const jobs = Object.fromEntries(data.jobs.map((x) => [x.id, x]));
  const skills = Object.fromEntries(data.skills.map((x) => [x.id, x]));
  const monsters = Object.fromEntries([...data.monsters, ...data.summons].map((x) => [x.id, x]));
  const res = {}, examples = {};
  const bump = (name, k) => { (res[name] ??= { OK: 0, MISS: 0, SKIP: 0 })[k]++; };
  const check = (name, ok, ex) => { bump(name, ok ? 'OK' : 'MISS'); if (!ok && (examples[name] ??= []).length < 3) examples[name].push(ex); };
  const envelope = (name, { min, max }, v) => check(name, min <= v && v <= max, `envelope=[${min},${max}], observed=${v}`);
  const records = captureRecords();
  const changed = new Set(records.filter(([, k, e]) => k === 'event' && e.body.type === 'statusStart' && 'monsterId' in e.body).map(([, , e]) => e.body.uid));
  const state = {}, groups = new Map();
  const derive = (s) => { try { return f.derive(s, { job: jobs[s.character.job], items, refine: data.refine }); } catch { return null; } };

  for (const [stream, kind, s] of records) {
    if (kind === 'snapshot') {
      state[stream] = s;
      const d = derive(s);
      if (!d) { bump('unsupported_snapshot', 'SKIP'); continue; }
      check('total_stats', isDeepStrictEqual(d.total, s.derived.total), 'total');
      for (const k of DERIVED) check(k, d[k] === s.derived[k], `expected=${d[k]}, observed=${s.derived[k]}`);
      continue;
    }
    const body = s.body;
    if (!groups.has(s.wallMs)) groups.set(s.wallMs, []);
    groups.get(s.wallMs).push([stream, body]);
    const snap = state[stream];
    if (!snap) continue;
    const c = snap.character;
    snap.buffs = snap.buffs.filter((b) => snap.time + b.remainingMs > s.simTime);
    const typ = body.type;
    if (typ === 'buffEnd') snap.buffs = snap.buffs.filter((b) => b.id !== body.buffId);
    if (typ === 'buffStart') {
      const lv = (skills[body.buffId]?.durationMs ?? []).indexOf(body.durationMs) + 1;
      snap.buffs = snap.buffs.filter((b) => b.id !== body.buffId);
      if (lv) snap.buffs.push({ id: body.buffId, lv, remainingMs: s.simTime + body.durationMs - snap.time });
    }
    if (typ === 'statUp') c.stats[body.stat] = body.value;
    if (typ === 'baseLevelUp') c.baseLv = body.lv;
    const d = derive(snap);
    if (!d) continue;
    const t = d.total;
    if (typ === 'skillCast') {
      check('castMs_DEX', f.castMs(skills[body.skill], body.lv, t.dex) === body.castMs, `${body.skill}`);
      check('skill_delayMs', f.skillDelayMs(skills[body.skill], body.lv) === body.delayMs, `${body.skill}`);
    }
    const mon = monsters[body.monsterId];
    const fresh = !changed.has(body.uid);
    if ((typ === 'playerAttack' || typ === 'skillHit') && body.elementMod != null && fresh) {
      let el = typ === 'skillHit' ? skills[body.skill].element ?? 'neutral' : 'neutral';
      if (el === 'weapon') el = 'neutral';
      check('element_table', f.elementMod(el, mon.element, mon.elementLv) === body.elementMod, `${el}→${mon.element}`);
    }
    if (typ === 'playerAttack' && (body.result === 'hit' || body.result === 'crit') && fresh) {
      const eq = f.equipped(snap, items);
      const weapon = eq.find((e) => e.slot === 'weapon')?.item ?? {};
      envelope('player_damage_candidate', f.playerDamageRange({ statAtk: d.statusAtk, dex: t.dex, weapon,
        arrowAtk: eq.find((e) => e.slot === 'ammo')?.item.atk ?? 0, atkBonus: d.atkBonus, refineAtk: d.refineAtk,
        monster: mon, elementMod: body.elementMod ?? 100, hits: body.hits ?? 1, crit: body.result === 'crit' }), body.damage);
    }
    if (typ === 'monsterAttack' && body.result === 'hit' && fresh)
      envelope('monster_def2_softdef_angelus', f.monsterDamageRange({ atk: mon.atk, hardDef: d.hardDef, vit: t.vit, vitDefRate: d.vitDefRate }), body.damage);
    if (typ === 'skillHit' && ['MG_LIGHTNINGBOLT', 'MG_FIREBOLT', 'MG_COLDBOLT'].includes(body.skill) && body.result === 'hit' && fresh) {
      const m = f.matk(t.int, f.bonuses(snap, items));
      const o = { monster: mon, elementMod: body.elementMod ?? 100, hits: body.hits };
      envelope('magic_bolt_damage', { min: f.magicDamage({ ...o, matkRoll: m.min }), max: f.magicDamage({ ...o, matkRoll: m.max }) }, body.damage);
    }
  }
  for (const group of groups.values()) {
    const ks = group.filter(([, b]) => b.type === 'kill'), xp = group.filter(([, b]) => b.type === 'exp');
    if (ks.length === 1 && xp.length === 8 && new Set(xp.map(([st]) => st)).size === 8) {
      const share = f.partyExpShare(monsters[ks[0][1].monsterId], 8);
      for (const [, x] of xp) { check('party_exp_base', share.base === x.base, ''); check('party_exp_job', share.job === x.job, ''); }
    }
  }
  return { res, examples };
}

test('capture check: JS module matches captures at least as well as the Python oracle', { skip: !haveInputs && 'capture dir or bundle absent' }, () => {
  const { res, examples } = jsCounts(bundleData());
  const py = oracleCounts();
  const rows = Object.keys(res).filter((k) => res[k].OK + res[k].MISS).sort();
  const md = ['| Formula | JS OK | JS MISS | Python OK | Python MISS | JS miss examples |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((k) => `| ${k} | ${res[k].OK} | ${res[k].MISS} | ${py[k]?.OK ?? '—'} | ${py[k]?.MISS ?? '—'} | ${(examples[k] ?? []).join('; ')} |`)].join('\n');
  if (process.env.FORMULAS_REPORT) writeFileSync(process.env.FORMULAS_REPORT, md + '\n');
  for (const k of rows) {
    assert.ok(py[k], `oracle has no row ${k}`);
    assert.ok(res[k].OK >= py[k].OK && res[k].MISS <= py[k].MISS, `${k}: JS ${res[k].OK}/${res[k].MISS} worse than Python ${py[k].OK}/${py[k].MISS}`);
  }
});

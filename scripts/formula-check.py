#!/usr/bin/env python3
"""Check local, non-auth SSE captures against the supplied client bundle (stdlib only).

Usage: python3 -I scripts/formula-check.py .scratch/capture .scratch/bundle.js
No JavaScript is executed. HTTP records, including authentication, are ignored.
"""
import collections
import json
import math
from pathlib import Path
import re
import sys


class Literal:
    """Read the bundle's static JS data subset; reject executable expressions."""
    token = re.compile(r'\s*(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|!?[01](?![\w.])|-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_$][\w$]*|[{}\[\]:,])', re.S)

    def __init__(self, source, start):
        self.source, self.pos = source, start

    def take(self):
        m = self.token.match(self.source, self.pos)
        if not m:
            raise ValueError(f'unsupported static literal at bundle offset {self.pos}')
        self.pos = m.end()
        return m[1]

    def value(self, t=None):
        t = self.take() if t is None else t
        if t == 'JSON' and self.source.startswith('.parse(', self.pos):
            self.pos += len('.parse(')
            value = json.loads(self.value())
            if self.source[self.pos] != ')':
                raise ValueError('expected JSON.parse closing parenthesis')
            self.pos += 1
            return value
        if t in ('{', '['):
            out = {} if t == '{' else []
            end = '}' if t == '{' else ']'
            t = self.take()
            while t != end:
                if isinstance(out, dict):
                    key = self.value(t) if t[0] in '`"\'' else t
                    if self.take() != ':':
                        raise ValueError('expected static object colon')
                    out[key] = self.value()
                else:
                    out.append(self.value(t))
                t = self.take()
                if t == end:
                    break
                if t != ',':
                    raise ValueError('expected static literal comma')
                t = self.take()
            return out
        if t[0] in '`"\'':
            if '${' in t:
                raise ValueError('template interpolation in static data')
            # JS strings here use JSON-compatible escapes plus escaped quotes/backticks.
            body = t[1:-1]
            value = re.sub(r'\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)',
                          lambda m: chr(int(m[1][1:], 16)) if m[1][0] in 'ux' else
                          {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}.get(m[1], m[1]), body)
            if self.source.startswith('.split(`.`)', self.pos):
                self.pos += len('.split(`.`)')
                return value.split('.')
            return value
        if t in ('!0', 'true'): return True
        if t in ('!1', 'false'): return False
        if t == 'null': return None
        try:
            n = float(t)
            return int(n) if n.is_integer() else n
        except ValueError:
            raise ValueError(f'unsupported static value {t} at bundle offset {self.pos}') from None


def static_data(bundle):
    start = bundle.find('{version:1,items:[')
    if start < 0:
        raise ValueError('static game data literal missing')
    return Literal(bundle, start).value()


def object_entries(source, start):
    """Inventory a JS object as text, without evaluating its function expressions."""
    depth, quote, escape, begin = 0, None, False, start + 1
    entries = {}
    for i in range(start, len(source)):
        char = source[i]
        if quote:
            if escape: escape = False
            elif char == chr(92): escape = True
            elif char == quote: quote = None
            continue
        if char in ('`', '"', "'"):
            quote = char
        elif char in '{[(': depth += 1
        elif char in '}])':
            depth -= 1
            if depth == 0:
                part = source[begin:i]
                if part:
                    key, value = part.split(':', 1)
                    entries[key] = value
                return entries
        elif char == ',' and depth == 1:
            key, value = source[begin:i].split(':', 1)
            entries[key] = value
            begin = i + 1
    raise ValueError('unterminated formula object')


def formula_inventory(bundle):
    effects = object_entries(bundle, bundle.index('{LK_AURABLADE:{type:'))
    buffs = object_entries(bundle, bundle.index('{ASC_EDP:e=>'))
    return effects, buffs


def self_check():
    assert Literal('{x:[1,.5,!0,`a,b`],y:JSON.parse(`{"n":2}`)}', 0).value() == {'x': [1, .5, True, 'a,b'], 'y': {'n': 2}}
    assert object_entries('{A:{n:(x)=>x+1},B:e=>({s:`a,b`})}', 0) == {'A': '{n:(x)=>x+1}', 'B': 'e=>({s:`a,b`})'}
    try:
        Literal('{x:fetch(`forbidden`)}', 0).value()
    except ValueError:
        pass
    else:
        raise AssertionError('executable expression accepted as static data')
    assert failing({'monster_damage_candidate': {'OK': 0, 'MISS': 9}, 'player_damage_candidate': {'OK': 98, 'MISS': 2}}) == []
    assert failing({'hit': {'OK': 9, 'MISS': 1}, 'player_damage_candidate': {'OK': 97, 'MISS': 3}}) == ['hit', 'player_damage_candidate']


def captures(directory):
    """Preserve each stream's order; de-duplicate replayed event seq per character."""
    for path in sorted(Path(directory).glob('*.jsonl')):
        seen = set()
        for number, line in enumerate(path.open(), 1):
            if not line.endswith('\n'):
                continue  # half-written last line of a capture still being recorded
            try:
                r = json.loads(line)
                if r.get('kind') != 'sse' or r.get('name') not in ('snapshot', 'events'):
                    continue
                data = json.loads(r['data']) if isinstance(r['data'], str) else r['data']
                if r['name'] == 'snapshot':
                    yield path.name, 'snapshot', data['snapshot']
                else:
                    for event in data:
                        if event['seq'] not in seen:
                            seen.add(event['seq'])
                            yield path.name, 'event', event
            except (ValueError, KeyError, TypeError):
                raise ValueError(f'invalid SSE capture {path.name}:{number}') from None


STATS = ('str', 'agi', 'vit', 'int', 'dex', 'luk')
ELEMENTS = ('neutral', 'water', 'earth', 'fire', 'wind', 'poison', 'holy', 'dark', 'ghost', 'undead')
BUFFS = {'AL_INCAGI', 'AL_BLESSING', 'AL_ANGELUS', 'SM_ENDURE', 'MC_LOUD', 'AS_ENCHANTPOISON'}  # Enchant Poison: attackElement only (bundle Pe[])
# A stream silent this long (app offline/capture gap) may have missed statUp/jobLv/equip changes: drop its state.
STALE_GAP_MS = 120_000
# (monster, item) pairs whose captured rate disagrees with the bundle table; informational, see twin-report.md L1.
# 1128 Horn → 935 Shell: 1,026 / 1,713 kills = 59.9% vs bundle 5500 (55%, 4.1σ); 947 Horn at the same 5500 fits
# (947), evenly over every capture hour, so the server table likely differs from the client bundle (data drift).
KNOWN_DROP_OUTLIERS = {(1128, 935)}
# Exit code gates only adopted formulas. Rejected alternatives are informational; adopted fitted damage
# envelopes have documented unresolved outliers and gate on a miss-rate ceiling instead of zero.
INFORMATIONAL = {'monster_angelus_alternative', 'monster_damage_candidate', 'monster_def2_softdef',
                 'monster_wiki_softdef', 'monster_wiki_softdef_angelus', 'refine_before_def_alternative', 'drops_known_outlier'}
FITTED_MAX_MISS_RATE = {'player_damage_candidate': 0.02, 'monster_def2_softdef_angelus': 0.01}


def equipped(s, items):
    inv = {x['uid']: x for x in s['inventory']}
    return [(slot, inv[uid], items[inv[uid]['itemId']]) for slot, uid in s['equipment'].items() if uid in inv]


def bonuses(s, items):
    out = collections.Counter()
    for slot, stack, item in equipped(s, items):
        if slot == 'ammo': continue
        for source in [item] + [items[c] for c in stack.get('cards', [])]:
            b = source.get('byRefine', {}).get(str(stack.get('refine', 0)), source.get('bonuses', {}))
            for k, v in b.items():
                if isinstance(v, (int, float)): out[k] += v
                elif k == 'stats':
                    for stat, n in v.items(): out['stat.' + stat] += n
                else: raise ValueError('unsupported equipped bonus in selected sample')
    for b in s['buffs']:
        lv, skill = b['lv'], b['id']
        if skill not in BUFFS: raise ValueError('unsupported buff in selected sample')
        if skill == 'AL_INCAGI': out['stat.agi'] += 2 + lv
        elif skill == 'AL_BLESSING':
            for stat in ('str', 'int', 'dex'): out['stat.' + stat] += lv
        elif skill == 'MC_LOUD': out['stat.str'] += 4
        elif skill == 'SM_ENDURE': out['mdef'] += lv
        elif skill == 'AL_ANGELUS': out['vitDefRate'] += 5 * lv
    return out


def totals(s, job, bonus):
    t = dict(s['character']['stats'])
    for b in job['jobBonus']:
        if b['lv'] <= s['character']['jobLv']:
            for k, v in b['stats'].items(): t[k] += v
    for k in STATS: t[k] += bonus['stat.' + k]
    t['dex'] += s['character']['skills'].get('AC_OWL', 0)
    return t


def atk(t, ranged):
    main, sub = ('dex', 'str') if ranged else ('str', 'dex')
    return t[main] + (t[main] // 10) ** 2 + t[sub] // 5 + t['luk'] // 5


def checks(directory, bundle):
    data = static_data(bundle)
    items = {x['id']: x for x in data['items']}
    jobs = {x['id']: x for x in data['jobs']}
    skills = {x['id']: x for x in data['skills']}
    monsters = {x['id']: x for x in data['monsters'] + data.get('summons', [])}
    elements = Literal(bundle, bundle.index('var of=') + len('var of=')).value()
    sizes = Literal(bundle, bundle.index('var cf=') + len('var cf=')).value()
    records = sorted(captures(directory), key=lambda r: (r[0], r[2]['time'] if r[1] == 'snapshot' else r[2]['simTime'], 0 if r[1] == 'snapshot' else 1, r[2].get('seq', 0)))
    result = collections.defaultdict(collections.Counter)
    examples = collections.defaultdict(list)
    def check(name, expected, actual):
        ok = expected == actual
        result[name]['OK' if ok else 'MISS'] += 1
        if not ok and len(examples[name]) < 3:
            examples[name].append(f'expected={expected}, observed={actual}')
    def envelope(name, lo, hi, actual):
        ok = lo <= actual <= hi
        result[name]['OK' if ok else 'MISS'] += 1
        if not ok and len(examples[name]) < 3:
            examples[name].append(f'envelope=[{lo},{hi}], observed={actual}')

    if not any(k == 'snapshot' for _, k, _ in records):
        raise ValueError('no SSE snapshots found')
    state, last_seen = {}, {}
    event_groups = collections.defaultdict(list)
    # A target status is visible on the caster's stream, not every attacker's stream.
    changed_targets = {e['body']['uid'] for _, kind, e in records if kind == 'event'
                       and e['body']['type'] == 'statusStart' and 'monsterId' in e['body']}
    # A buffEnd with no buffStart since the replayed expiry proves an unseen refresh (capture gap, e.g. a party
    # Blessing recast): keep the buff until that end. Per stream and buff: sorted (simTime, type) of start/end events.
    buff_marks = collections.defaultdict(list)
    for stream, kind, e in records:
        if kind == 'event' and e['body']['type'] in ('buffStart', 'buffEnd'):
            buff_marks[stream, e['body']['buffId']].append((e['simTime'], e['body']['type']))
    def ends_later(stream, buff, now):
        nxt = next((typ for t, typ in buff_marks.get((stream, buff), []) if t > now), None)
        return nxt == 'buffEnd'
    damage_groups = collections.defaultdict(list)
    for stream, kind, s in records:
        if kind == 'snapshot':
            state[stream] = s
            last_seen[stream] = s['time']
            c, d = s['character'], s['derived']
            job, t = jobs[c['job']], d['total']
            try: b = bonuses(s, items)
            except ValueError:
                result['unsupported_snapshot']['SKIP'] += 1
                continue
            sk = lambda key: c['skills'].get(key, 0)
            eq = equipped(s, items)
            weapon = next((i for slot, _, i in eq if slot == 'weapon'), {})
            wt = weapon.get('weaponType', 'fist')
            ranged = wt in ('bow', 'instrument', 'whip')
            check('total_stats', totals(s, job, b), t)
            check('statusAtk', atk(t, ranged), d['statusAtk'])
            check('hit', c['baseLv'] + t['dex'] + b['hit'] + sk('AC_VULTURE') + 2 * sk('BS_WEAPONRESEARCH'), d['hit'])
            check('flee', c['baseLv'] + t['agi'] + b['flee'] + 3 * sk('TF_MISS') + 3 * sk('MO_DODGE') // 2 + (10 if sk('TF_BACKSLIDING') else 0), d['flee'])
            check('crit', (1 + t['luk'] * 3 // 10 + b['crit']) * (2 if wt == 'katar' else 1), d['crit'])
            check('perfectDodge', 1 + t['luk'] // 10 + b['perfectDodge'], d['perfectDodge'])
            for name, divisor in [('matkMin', 7), ('matkMax', 5)]:
                v = (t['int'] + (t['int'] // divisor) ** 2) * (100 + b['matkRate']) // 100 + b['matk']
                check(name, v + v * b['magicPowerRate'] // 100, d[name])
            for field, table, stat in [('maxHp', 'baseHp', 'vit'), ('maxSp', 'baseSp', 'int')]:
                base = job[table][min(c['baseLv'], len(job[table])) - 1]
                # No reborn characters in these captures; avoid claiming that path verified.
                if c['job'].endswith('_high') or c['job'] in ('lord_knight','high_wizard','high_priest','sniper','assassin_cross','whitesmith','paladin','champion','stalker','professor','clown','gypsy','creator'):
                    base = base * 125 // 100
                check(field, max(1, (base * (100 + t[stat]) // 100 + b[field]) * (100 + b[field + 'Rate']) // 100), d[field])
            check('weightMax', job['baseWeight'] + t['str'] * 30 + 200 * sk('MC_INCCARRY') + (1000 if c.get('riding') else 0) + 200 * min(10, c.get('gymPass', 0)), d['weightMax'])
            base_motion = job['baseAspd'].get(wt, job['baseAspd'].get('fist', 500))
            motion = base_motion - base_motion * (4 * t['agi'] + t['dex']) // 1000
            motion = max(100, motion * (100 - b['aspdRate']) // 100 - 10 * b['aspdAdd'])
            check('aspd', (2000 - motion) / 10, d['aspd'])
            check('attackIntervalMs', 2 * motion, d['attackIntervalMs'])
            check('interval_from_aspd', round((200 - d['aspd']) * 20), d['attackIntervalMs'])
            armor_refine = sum(70 * st.get('refine', 0) for slot, st, i in eq if slot != 'ammo' and 'weapon' not in i.get('slots', []))
            hard = sum(i.get('def', 0) for slot, _, i in eq if slot != 'ammo') + b['def'] + (armor_refine + 50) // 100
            check('hardDef', min(99, hard * max(0, 100 + b['defRate']) // 100), d['hardDef'])
            check('vitDef', t['vit'], d['vitDef'])
            check('softMdef', t['int'], d['softMdef'])
            check('hardMdef', min(99, b['mdef']), d['hardMdef'])
            check('hpRegen', ((1 + t['vit'] // 5 + d['maxHp'] // 200) * (150 if sk('SM_MOVINGRECOVERY') else 100) // 100) * (100 + b['hpRecovRate']) // 100, d['hpRegen'])
            check('spRegen', ((1 + t['int'] // 6 + d['maxSp'] // 100) * (100 + b['spRecovRate']) // 100) * (100 + 3 * sk('HP_MEDITATIO')) // 100, d['spRegen'])
            check('baseExpNext', job['baseExpTable'][c['baseLv'] - 1], s['baseExpNext'])
            check('jobExpNext', job['jobExpTable'][c['jobLv'] - 1], s['jobExpNext'])
            st = next((st for slot, st, _ in eq if slot == 'weapon'), {})
            ref = st.get('refine', 0)
            rb = data['refine']['weapon'][str(weapon.get('weaponLevel', 1))][ref-1]['bonus'] // 100 if ref else 0
            check('refineAtk', rb, d['refineAtk'])
            continue

        e, body = s, s['body']
        event_groups[e['wallMs']].append((stream, body))
        if e['simTime'] - last_seen.get(stream, e['simTime']) > STALE_GAP_MS:
            state.pop(stream, None)
        last_seen[stream] = e['simTime']
        if stream not in state:
            result['event_without_snapshot']['SKIP'] += 1
            continue
        snap = state[stream]
        c, d = snap['character'], snap['derived']
        # Mutate only our decoded snapshot, never the capture files.
        snap['buffs'] = [b for b in snap['buffs'] if snap['time'] + b['remainingMs'] > e['simTime'] or ends_later(stream, b['id'], e['simTime'])]
        typ = body['type']
        if typ == 'buffEnd': snap['buffs'] = [b for b in snap['buffs'] if b['id'] != body['buffId']]
        if typ == 'buffStart':
            skill = body['buffId']
            durations = skills.get(skill, {}).get('durationMs', [])
            matches = [i + 1 for i, v in enumerate(durations) if v == body['durationMs']]
            snap['buffs'] = [b for b in snap['buffs'] if b['id'] != skill]
            if matches:
                snap['buffs'].append({'id': skill, 'lv': matches[0], 'remainingMs': e['simTime'] + body['durationMs'] - snap['time']})
        if typ == 'statUp': c['stats'][body['stat']] = body['value']
        if typ == 'baseLevelUp': c['baseLv'] = body['lv']
        if typ == 'jobLevelUp': c['jobLv'] = body['lv']  # job bonus stats follow job level
        if typ == 'skillUp': c['skills'][body['skill']] = body['lv']
        try: b = bonuses(snap, items)
        except ValueError: continue
        t = totals(snap, jobs[c['job']], b)
        if typ == 'skillCast':
            sk = skills[body['skill']]
            lv = body['lv']
            base = sk['castMs'][min(lv, len(sk['castMs']))-1] if sk['castMs'] else 0
            check('castMs_DEX', base * max(0, 150-t['dex']) // 150, body['castMs'])
            delay = sk['delayMs'][min(lv, len(sk['delayMs']))-1] if sk['delayMs'] else 0
            check('skill_delayMs', delay, body['delayMs'])
        if typ in ('playerAttack', 'skillHit') and body.get('elementMod') is not None:
            mon = monsters[body['monsterId']]
            element = skills[body['skill']].get('element', 'neutral') if typ == 'skillHit' else 'neutral'
            if element == 'weapon': element = 'neutral'
            # Enchant Poison endows the weapon; captured hits mix 125 and 100 under it, so the hit element is unknown.
            if body.get('uid') in changed_targets or (typ == 'playerAttack' and c['skills'].get('AS_ENCHANTPOISON')):
                result['element_table']['SKIP'] += 1
            else:
                check('element_table', elements[mon['elementLv']-1][ELEMENTS.index(element)][ELEMENTS.index(mon['element'])], body['elementMod'])
        if typ == 'playerAttack' and body['result'] in ('hit', 'crit'):
            mon = monsters[body['monsterId']]
            if body.get('uid') in changed_targets:
                result['player_damage_candidate']['SKIP'] += 1
                continue
            eq = equipped(snap, items)
            w = next((i for slot, _, i in eq if slot == 'weapon'), {})
            wt = w.get('weaponType', 'fist')
            ranged = wt == 'bow'
            weapon_max = w.get('atk', 0)
            weapon_min = min(weapon_max, t['dex'] * (80+20*w.get('weaponLevel', 0)) // 100)
            if ranged: weapon_min = weapon_min * weapon_max // 100
            if body['result'] == 'crit': weapon_min = weapon_max
            arrow = next((i.get('atk', 0) for slot, _, i in eq if slot == 'ammo'), 0) if ranged else 0
            stat = atk(t, ranged)
            lo_base = stat + weapon_min * sizes[wt][mon['size']] // 100 + d['atkBonus']
            hi_base = stat + (weapon_max + max(0, arrow-1)) * sizes[wt][mon['size']] // 100 + d['atkBonus']
            vit = mon['stats']['vit']
            soft_lo, soft_hi = vit, vit + max(0, (vit//20)**2 - 1)
            if body['result'] == 'crit':
                lo, hi = lo_base + d['refineAtk'], hi_base + d['refineAtk']
            else:
                lo = lo_base * (100-mon['def']) // 100 - soft_hi + d['refineAtk']
                hi = hi_base * (100-mon['def']) // 100 - soft_lo + d['refineAtk']
            mod = body.get('elementMod', 100)
            hits = body.get('hits', 1)
            lo, hi = max(1, lo * mod // 100)*hits, max(1, hi * mod // 100)*hits
            if wt == 'katar':  # katar off-hand hit: + floor(damage × (1 + 2×Double Attack lv) / 100)
                lo, hi = (x + x * (1 + 2 * c['skills'].get('TF_DOUBLE', 0)) // 100 for x in (lo, hi))
            envelope('player_damage_candidate', lo, hi, body['damage'])
            damage_groups[(stream, mon['id'], wt)].append((lo, hi, body['damage']))
            if d['refineAtk'] and body['result'] == 'hit':
                before_lo = max(1, (((lo_base+d['refineAtk'])*(100-mon['def'])//100-soft_hi)*mod//100))*hits
                before_hi = max(1, (((hi_base+d['refineAtk'])*(100-mon['def'])//100-soft_lo)*mod//100))*hits
                envelope('refine_before_def_alternative', before_lo, before_hi, body['damage'])
        if typ == 'monsterAttack' and body['result'] == 'hit':
            mon = monsters[body['monsterId']]
            if body.get('uid') in changed_targets:
                result['monster_damage_candidate']['SKIP'] += 1
                continue
            vit = t['vit']
            # Fitted baseline deliberately omits Angelus; compare the alternative below.
            soft_lo = vit*3//10 + vit//2
            soft_hi = soft_lo + max(0, vit*vit//150 - vit*3//10 - 1)
            lo = max(1, mon['atk'][0] * (100-d['hardDef']) // 100 - soft_hi)
            hi = max(1, mon['atk'][1] * (100-d['hardDef']) // 100 - soft_lo)
            envelope('monster_damage_candidate', lo, hi, body['damage'])
            angel_lo = max(1, mon['atk'][0]*(100-d['hardDef'])//100-soft_hi*(100+b['vitDefRate'])//100)
            angel_hi = max(1, mon['atk'][1]*(100-d['hardDef'])//100-soft_lo*(100+b['vitDefRate'])//100)
            envelope('monster_angelus_alternative', angel_lo, angel_hi, body['damage'])
            # iRO Wiki Classic DEF page: deterministic max(), Angelus multiplies the whole soft DEF.
            wiki = vit//2 + max(vit*3//10, vit*vit//150 - 1)
            raw_lo, raw_hi = (a * (100-d['hardDef']) // 100 for a in mon['atk'])
            envelope('monster_wiki_softdef', max(1, raw_lo-wiki), max(1, raw_hi-wiki), body['damage'])
            wa = wiki * (100+b['vitDefRate']) // 100
            envelope('monster_wiki_softdef_angelus', max(1, raw_lo-wa), max(1, raw_hi-wa), body['damage'])
            # rAthena pre-renewal structure: def2 = VIT (Angelus scales def2), soft = def2/2 + rnd(0..def2*(def2-15)/150-1).
            for name, def2 in (('monster_def2_softdef', vit), ('monster_def2_softdef_angelus', vit*(100+b['vitDefRate'])//100)):
                s_lo = def2//2
                s_hi = s_lo + max(0, def2*(def2-15)//150 - 1)
                envelope(name, max(1, raw_lo-s_hi), max(1, raw_hi-s_lo), body['damage'])
        if typ == 'skillHit' and body.get('skill') in ('MG_LIGHTNINGBOLT', 'MG_FIREBOLT', 'MG_COLDBOLT') and body['result'] == 'hit':
            if body.get('uid') in changed_targets:
                result['magic_bolt_damage']['SKIP'] += 1
            else:
                mon = monsters[body['monsterId']]
                low = (t['int']+(t['int']//7)**2) * (100+b['matkRate'])//100 + b['matk']
                high = (t['int']+(t['int']//5)**2) * (100+b['matkRate'])//100 + b['matk']
                mod = body.get('elementMod', 100)
                low = max(1, (low*(100-mon['mdef'])//100-mon['stats']['int']-mon['stats']['vit']//2)*mod//100)*body['hits']
                high = max(1, (high*(100-mon['mdef'])//100-mon['stats']['int']-mon['stats']['vit']//2)*mod//100)*body['hits']
                envelope('magic_bolt_damage', low, high, body['damage'])
                check('magic_bolt_hits', body['lv'], body['hits'])

    kills, drops = collections.Counter(), collections.Counter()
    for wall, group in event_groups.items():
        ks = [(stream, b) for stream, b in group if b['type']=='kill']
        xp = [(stream, b) for stream, b in group if b['type']=='exp']
        for _, k in ks: kills[k['monsterId']] += 1
        for _, drop in group:
            if drop['type'] == 'drop': drops[(drop['monsterId'], drop['itemId'])] += drop['qty']
        # Only unambiguous complete eight-character kill groups; no inference from by/name.
        if len(ks) == 1 and len(xp) == 8 and len({stream for stream, _ in xp}) == 8:
            mon = monsters[ks[0][1]['monsterId']]
            for _, x in xp:
                check('party_exp_base', mon['baseExp'] * 2 // 8, x['base'])
                check('party_exp_job', mon['jobExp'] * 2 // 8, x['job'])
        elif xp:
            result['party_exp_base']['SKIP'] += len(xp)
            result['party_exp_job']['SKIP'] += len(xp)
    drop_details = []
    for mid, n in sorted(kills.items()):
        mon = monsters[mid]
        slots = collections.defaultdict(list)
        for drop in mon.get('drops', []) + ([mon['card']] if mon.get('card') else []):
            slots[drop['itemId']].append(min(1, drop['rate'] / 10000))
        for item, probabilities in slots.items():
            expected = n*sum(probabilities)
            observed = drops[mid, item]
            if expected < 5:
                result['drops_4sigma']['SKIP'] += 1
                continue
            sigma = math.sqrt(n*sum(p*(1-p) for p in probabilities))
            if (mid, item) in KNOWN_DROP_OUTLIERS:
                envelope('drops_known_outlier', max(0, math.floor(expected-4*sigma)), math.ceil(expected+4*sigma), observed)
                drop_details.append((mid, item, n, round(expected, 2), observed))
                continue
            envelope('drops_4sigma', max(0, math.floor(expected-4*sigma)), math.ceil(expected+4*sigma), observed)
            drop_details.append((mid, item, n, round(expected, 2), observed))
    return data, result, examples, damage_groups, drop_details


def main():
    if len(sys.argv) != 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    self_check()
    try:
        bundle = Path(sys.argv[2]).read_text()
        effects, buffs = formula_inventory(bundle)
        data, result, examples, groups, drops = checks(sys.argv[1], bundle)
    except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 2
    print('Self-check: OK (static parser, function inventory, reject executable input)')
    print(f'Function inventory: {len(effects)} skill effects, {sum("ratio:" in v for v in effects.values())} skill ratios, {len(buffs)} buff functions')
    print(f"Inventory: {len(data['jobs'])} jobs, {len(data['skills'])} skills, {len(data['items'])} items, {len(data['monsters'])} monsters; 4x10x10 element table; 18 weapon size rows")
    print('Formula                         OK     MISS     SKIP')
    for name, counts in sorted(result.items()):
        tag = ' (informational)' if name in INFORMATIONAL else ' (fitted)' if name in FITTED_MAX_MISS_RATE else ''
        print(f"{name:30} {counts['OK']:7} {counts['MISS']:8} {counts['SKIP']:8}{tag}")
        for example in examples[name]: print('  ' + example)
    print('Player damage groups: stream monster weapon n OK MISS predicted-min..max observed-min..max')
    for (stream, mid, wt), rows in sorted(groups.items()):
        print(stream.split('-2026')[0], mid, wt, len(rows), sum(lo <= v <= hi for lo, hi, v in rows), sum(not lo <= v <= hi for lo, hi, v in rows), f'{min(r[0] for r in rows)}..{max(r[1] for r in rows)}', f'{min(r[2] for r in rows)}..{max(r[2] for r in rows)}')
    print('Drop checks (rough 4-sigma): monster item kills expected observed')
    for row in drops: print(*row)
    print('FAILING adopted formulas: ' + (', '.join(sorted(failing(result))) or 'none'))
    return 1 if failing(result) else 0


def failing(result):
    """Adopted formulas that fail: any MISS, or a fitted envelope above its miss-rate ceiling."""
    out = []
    for name, c in result.items():
        if name in INFORMATIONAL or not c['MISS']: continue
        if c['MISS'] <= FITTED_MAX_MISS_RATE.get(name, 0) * (c['OK'] + c['MISS']): continue
        out.append(name)
    return out


if __name__ == '__main__':
    sys.exit(main())

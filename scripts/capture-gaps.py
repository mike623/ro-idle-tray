# Gap analysis over capture/*.jsonl. Usage: python3 -I scripts/capture-gaps.py .scratch/capture .scratch/bundle.js
import json, re, sys, glob, collections as C

cap, bundle = sys.argv[1], open(sys.argv[2]).read()
norm = lambda p: re.sub(r'/\d+(?=/|$)', '/:n', re.sub(r'/characters/[^/?]+', '/characters/:id', p.split('?')[0]))
B_PATHS = {norm(re.sub(r'\$\{[^}]+\}', '0', m)) for m in re.findall(r'`(/api/[^`]*)`', bundle)}
B_CMDS = set(re.findall(r'G\(\{(?:type|kind):`([a-zA-Z_]+)`', bundle))
B_SSE = {'message', 'snapshot', 'events', 'chat', 'chatCursor', 'gap', 'idle', 'arena', 'arenaNotice',
         'lounge', 'trade', 'restart', 'superseded', 'watchLimit'}

paths, cmds, sse, ev_types, ev_fields, snap_keys, derived = C.Counter(), C.Counter(), C.Counter(), C.Counter(), C.defaultdict(set), set(), []
cmd_examples, errors, lines = {}, C.Counter(), 0
for f in sorted(glob.glob(f'{cap}/*.jsonl')):
    for l in open(f):
        lines += 1
        try: r = json.loads(l)
        except Exception: errors['bad line'] += 1; continue
        if r['kind'] == 'http':
            paths[f"{r['method']} {norm(r['path'])}"] += 1
            if r.get('status', 200) >= 400: errors[f"{r['status']} {norm(r['path'])}"] += 1
            if r['path'].endswith('/commands') and r.get('body'):
                t = json.loads(r['body']).get('command', {}).get('type', '?')
                cmds[t] += 1; cmd_examples.setdefault(t, r)
            evs = []
            try: evs = json.loads(r.get('resp') or '{}').get('events', [])
            except Exception: pass
        elif r['kind'] == 'sse':
            sse[r['name']] += 1
            evs = []
            if r['name'] == 'events':
                try: evs = json.loads(r['data'])
                except Exception: pass
            if r['name'] == 'snapshot':
                s = json.loads(r['data']).get('snapshot', {})
                snap_keys |= set(s)
                derived.append(s)
        else: continue
        for e in evs if isinstance(evs, list) else []:
            b = e.get('body', {}); t = b.get('type', '?')
            ev_types[t] += 1; ev_fields[t] |= set(b)

print(f'lines {lines}  files {len(glob.glob(cap + "/*.jsonl"))}\n')
print('== HTTP paths seen'); [print(f'  {v:5} {k}') for k, v in paths.most_common()]
seen_p = {k.split(' ', 1)[1] for k in paths}
print(f'\n== bundle paths never seen: {len(B_PATHS - seen_p)}/{len(B_PATHS)}')
print('  ' + ' '.join(sorted(B_PATHS - seen_p)))
print(f'\n== commands seen {len(cmds)}/{len(B_CMDS)}:', dict(cmds))
print('  missing:', ' '.join(sorted(B_CMDS - set(cmds))))
print(f'\n== SSE names seen:', dict(sse), '\n  missing:', ' '.join(sorted(B_SSE - set(sse))))
print(f'\n== event body types ({len(ev_types)})')
for t, v in ev_types.most_common(): print(f'  {v:6} {t:22} {",".join(sorted(ev_fields[t] - {"type"}))}')
print(f'\n== snapshot keys ({len(snap_keys)})'); print('  ' + ' '.join(sorted(snap_keys)))
print('\n== errors', dict(errors))

# Formula checks from /info/mechanics against server-derived values.
print('\n== formula checks (mechanics page vs snapshot.derived)')
res = C.Counter(); bad = []
for s in derived:
    c, d = s.get('character', {}), s.get('derived', {})
    t = d.get('total'); lv = c.get('baseLv')
    if not t or lv is None: continue
    def chk(name, want, got):
        if got is None: return
        ok = want == got; res[(name, ok)] += 1
        if not ok and len(bad) < 15: bad.append(f'{c.get("name")} {c.get("job")} {name}: formula {want} vs server {got}')
    chk('hit=lv+dex (base)', lv + t['dex'], d.get('hit'))
    chk('flee=lv+agi (base)', lv + t['agi'], d.get('flee'))
    chk('matkMin=int+(int//7)^2', t['int'] + (t['int'] // 7) ** 2, d.get('matkMin'))
    chk('matkMax=int+(int//5)^2', t['int'] + (t['int'] // 5) ** 2, d.get('matkMax'))
    for main, sub in (('str', 'dex'), ('dex', 'str')):
        want = t[main] + (t[main] // 10) ** 2 + t[sub] // 5 + t['luk'] // 5
        if want == d.get('statusAtk'): res[(f'statusAtk main={main}', True)] += 1; break
    else: res[('statusAtk', False)] += 1; bad.append(f'{c.get("name")} statusAtk {d.get("statusAtk")} t={t}')
    if 'crit' in d: chk('crit=1+floor(luk*0.3)', 1 + int(t['luk'] * 0.3), d.get('crit'))
for (n, ok), v in sorted(res.items()): print(f'  {"OK  " if ok else "MISS"} {v:4} {n}')
for b in bad: print('   ', b)
print('\n== derived keys:', ' '.join(sorted(derived[-1].get('derived', {}))) if derived else '-')

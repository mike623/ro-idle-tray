# Owned rules server (#16)

`server/index.js` — node:http + `ws`, state in memory (`server/game.js`), SQLite checkpoints (`node:sqlite`).
Rules: `server/rules/engine.js`. Static rules data the repo lacked (job EXP/HP tables, item combat/trade fields,
refine, shops) is in `server/data/rules.json`, regenerated from the public bundle with `node server/extract-data.mjs`.

## Run

```sh
npm install                                   # ws
# seed the user's own characters from a capture (one account per capture profile); prints the token
node server/seed.js --db server/data.sqlite --account mike --token <t> \
  ~/Library/Application\ Support/com.mikewong.ro-idle-tray/capture/profile-1-2026-11-04.jsonl
node server/index.js --port 8787 --db server/data.sqlite [--checkpoint 30] [--max-drivers 8]
node server/demo.mjs <characterId> <t> [fights] [http://127.0.0.1:8787]   # scripted brain (below)
node --test tests/*.test.mjs server/*.test.mjs server/rules/*.test.mjs   # tests
```

Seed with the server stopped: seeding rewrites the whole DB row and a running server's next checkpoint would overwrite it.
Seeding takes, per path, the last `200` GET reply in the capture: `/api/characters/:id` (the view: the twin's
snapshot is byte-identical to it), `/party` (party record; members = seeded characters only), `/api/kill-event`,
`/api/storage`. Chat is never imported. `tests/fixtures/server/capture-72397.jsonl` is a 4-record trimmed capture of
one own character.

## Auth

Local token per account (fine for now): `Authorization: Bearer <t>`, cookie `ro_token=<t>` or `?token=<t>`.
For the official client: `GET /api/auth/config` → `{authMode:"dev", google:false}` makes it show its dev login;
`POST /api/auth/dev-login {username}` sets the cookie; `GET /api/auth/me` → `{provider:"dev", googleLinked, sponsor}`.
No token → `401 {error:{code:"UNAUTHENTICATED"}}` (the client's login screen).

## REST (captured shapes, docs/offline-backend/api.md)

| Path | Notes |
|---|---|
| `GET /api/characters` | account's characters |
| `GET /api/characters/:id[?deferCatchup=1]` | view: `characterId, name, revision, commandRevision, lastSeq, running, backlogMs:0, settledAtMs, clockFrozen, deleteAfterMs, snapshot` |
| `GET /api/characters/:id/stream?after=` | SSE: `snapshot` (`{snapshot, revision, commandRevision, lastSeq, running, backlogMs, settledAtMs}`), `chatCursor {cursor:0}`, `gap` if `after` is older than the log, backlog `events`, then live `events` / `snapshot` |
| `GET /api/characters/:id/events?after=&limit=` | `{events, gap, retainedFrom}`; last 10 000 events kept |
| `GET /api/characters/:id/summary?after=` | away summary, all captured keys; `estimatedMs/Zeny` stay 0 (rate checkout is #18) |
| `GET /api/characters/:id/party` | `{party:{…, members:[{id,name,mapId,running,baseLv,job,look,vitals,buffs}]}, invites:[], own:[…]}` |
| `GET /api/maps/population` | `{at, maps:{mapId:[characters on map, 0]}}` for every map (second count's meaning unknown) |
| `GET /api/kill-event` | `{event, nowMs}`; `progress` counts kills of `event.monsterId` |
| `GET /api/storage` | account storage |
| `POST /api/presence` | `{ok:true}` |
| `POST /api/characters/:id/commands` | `{commandId, command}` → `200 {ok:true, view}` / `422 {error:{code:"GAME_RULE", message}, view}`; storage commands add `storage`; same `commandId` returns the stored reply; a failing command changes nothing |

Commands: `start`, `stop`, `selectMap`, `updateConfig` (whole config), `allocateStats` (RO raise cost
`floor((x−1)/10)+2`, max 99), `learnSkills` (job skill tree, `maxLv`, `requires`), `equip`/`unequip` (slot from item
`slots`, `equipLevel`, `jobs`), `useItem`, `sell`/`buy` (town only; `buy` from that town's shops), `storageDeposit`,
`storageWithdraw`, `storageZeny` (40 Zeny fee per item move). Stats/gear changes re-run `formulas.derive`, which
reproduces the captured `derived` panel exactly for all 8 captured characters. Any other command type → 422 GAME_RULE.

Stubs (captured shapes, empty): `/api/costumes`, `/api/shared-configs`, `/api/vending`, `/api/rankings`,
`/api/world-mvp`, `/api/bans`, `/:id/{guild,mail,trade,nearby,shared-configs,arena,duels,lounge,world-mvp}`; other
`POST /:id/<social>/…` (lounge heartbeat etc.) → `{ok:true}`. Anything else → `404 NOT_FOUND`.

## WebSocket `/ws?character=<id>&token=<t>` — brain actions

One driver per character: a second connection gets the character and the first receives `{type:"superseded"}` and
close `4000`. Per-account cap on driven characters (default 8): `{type:"error", error:"DRIVER_LIMIT"}`, close `4001`.
Bad token / other account's character: close `4401`. Disconnect checkpoints to SQLite.

Server → client: `{type:"snapshot", …}` on connect and on every state change (SSE `snapshot` data), `{type:"events",
events:[…]}` (SSE `events` data, `{seq, body, wallMs, simTime}`), and `{type:"result", id, ok, error?, retryAt?, uid?,
events?}` per action. Client → server: `{id, type, …}`:

| `type` | Fields | Server checks (wall clock, never a client time) | Errors |
|---|---|---|---|
| `search` | — | not in a fight; map has spawns; HP > 0. Rolls the encounter (spawn-weighted, 300 ms + Exp(500 ms)); `found` arrives when due | `IN_FIGHT`, `NO_MONSTERS`, `DEAD` |
| `attack` | uid | the uid is this character's live encounter; search + approach time has passed; ASPD interval since the last swing | `NO_TARGET`, `NOT_YOURS`, `TOO_EARLY` + `retryAt` |
| `cast` | uid, skill, lv | learned level, SP, cooldown, not already casting; lands at `castMs`, next action after `max(delay, ASPD)` | `NOT_LEARNED`, `NO_SP`, `COOLDOWN`, `CASTING`, `TOO_EARLY` |
| `useItem` | uid (inventory) | consumable with healHp/healSp in inventory | `NO_ITEM` |
| `pickup` | itemId | dropped by this character's last kill, not yet picked | `NO_LOOT` |
| `sit` | — | not in a fight; regen tick 3 s instead of 6 s | `IN_FIGHT` |
| `teleport` | — | Fly Wing (601) or AL_TELEPORT; map allows teleport; ends the encounter | `NO_ITEM`, `NO_TELEPORT` |
| `return` | — | Butterfly Wing (602) → `mapChange` to `saveMap` | `NO_ITEM` |

Monster swings and cast completions run on a 250 ms server tick (and before every action), so the log fills in real
time even when the brain is idle. Kill: EXP to the killer and (party share, `party:true`, `by`) to party members on the
same map — one world per party; drops roll for the killer only (× kill-event `dropMult`) and wait for `pickup`.
Death: 1 % base EXP penalty, respawn at `saveMap` with 50 % HP/SP.

## Scripted session (seed → connect → search → fight → kill → loot)

Real clock, 2026-11-04, character 72397 (assassin Lv51, mjolnir_09) seeded from the fixture:

```sh
node server/seed.js --db /tmp/demo.sqlite --account mike --token demo-token tests/fixtures/server/capture-72397.jsonl
node server/index.js --port 8799 --db /tmp/demo.sqlite &
node server/demo.mjs 72397 demo-token 1 http://127.0.0.1:8799
curl -H 'authorization: Bearer demo-token' 'http://127.0.0.1:8799/api/characters/72397/summary?after=387281'
```

```text
{"account":"mike","token":"demo-token","characters":[[72397,"嘈嘈嘈"]]}
$ node server/index.js --port 8799 --db /tmp/demo.sqlite
ro-idle server on http://127.0.0.1:8799 (db /tmp/demo.sqlite)
$ node server/demo.mjs 72397 demo-token 1 http://127.0.0.1:8799
19:09:13.466 > {"id":1,"type":"search"}
19:09:13.467 < {"type":"snapshot","lastSeq":387281,"mapId":"mjolnir_09","hp":1152}
19:09:13.468 < {"seq":387282,"body":{"type":"searching"},"wallMs":1793819353467,"simTime":233870690}
19:09:13.468 < {"type":"result","id":1,"ok":true,"uid":1}
19:09:13.468 > {"id":2,"type":"attack","uid":1}
19:09:13.469 < {"type":"result","id":2,"ok":false,"error":"TOO_EARLY","retryAt":1793819355358}
19:09:14.470 < {"seq":387283,"body":{"type":"found","uid":1,"monsterId":1128,"approachMs":1120},"wallMs":1793819354238,"simTime":233871461}
19:09:15.360 > {"id":3,"type":"attack","uid":1}
19:09:15.361 < {"seq":387284,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":71,"hpLeft":588,"result":"hit","elementMod":100},"wallMs":1793819355361,"simTime":233872584}
19:09:15.362 < {"type":"result","id":3,"ok":true}
19:09:15.477 < {"seq":387285,"body":{"type":"mobSkill","uid":1,"monsterId":1128,"skill":"NPC_GROUNDATTACK","lv":1,"damage":0,"result":"miss"},"wallMs":1793819355441,"simTime":233872664}
19:09:16.010 > {"id":4,"type":"attack","uid":1}
19:09:16.012 < {"seq":387286,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":80,"hpLeft":508,"result":"hit","elementMod":100},"wallMs":1793819356011,"simTime":233873234}
19:09:16.012 < {"type":"result","id":4,"ok":true}
19:09:16.659 > {"id":5,"type":"attack","uid":1}
19:09:16.660 < {"seq":387287,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":508,"result":"miss","elementMod":100},"wallMs":1793819356660,"simTime":233873883}
19:09:16.661 < {"type":"result","id":5,"ok":true}
19:09:16.984 < {"seq":387288,"body":{"type":"monsterAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":1152,"maxHp":1767,"result":"miss"},"wallMs":1793819356969,"simTime":233874192}
19:09:17.309 > {"id":6,"type":"attack","uid":1}
19:09:17.310 < {"seq":387289,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":67,"hpLeft":441,"result":"hit","elementMod":100},"wallMs":1793819357310,"simTime":233874533}
19:09:17.311 < {"type":"result","id":6,"ok":true}
19:09:17.958 > {"id":7,"type":"attack","uid":1}
19:09:17.959 < {"seq":387290,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":41,"hpLeft":400,"result":"hit","elementMod":100},"wallMs":1793819357959,"simTime":233875182}
19:09:17.959 < {"type":"result","id":7,"ok":true}
19:09:18.607 > {"id":8,"type":"attack","uid":1}
19:09:18.608 < {"seq":387291,"body":{"type":"monsterAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":1152,"maxHp":1767,"result":"miss"},"wallMs":1793819358497,"simTime":233875720}
19:09:18.608 < {"seq":387292,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":57,"hpLeft":343,"result":"hit","elementMod":100},"wallMs":1793819358608,"simTime":233875831}
19:09:18.608 < {"type":"result","id":8,"ok":true}
19:09:19.257 > {"id":9,"type":"attack","uid":1}
19:09:19.258 < {"seq":387293,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":343,"result":"miss","elementMod":100},"wallMs":1793819359257,"simTime":233876480}
19:09:19.258 < {"type":"result","id":9,"ok":true}
19:09:19.905 > {"id":10,"type":"attack","uid":1}
19:09:20.171 < {"seq":387294,"body":{"type":"monsterAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":1152,"maxHp":1767,"result":"miss"},"wallMs":1793819360025,"simTime":233877248}
19:09:20.171 < {"seq":387295,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":73,"hpLeft":270,"result":"hit","elementMod":100},"wallMs":1793819360171,"simTime":233877394}
19:09:20.171 < {"type":"result","id":10,"ok":true}
19:09:20.819 > {"id":11,"type":"attack","uid":1}
19:09:20.819 < {"seq":387296,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":93,"hpLeft":177,"result":"hit","elementMod":100},"wallMs":1793819360819,"simTime":233878042}
19:09:20.820 < {"type":"result","id":11,"ok":true}
19:09:21.465 > {"id":12,"type":"attack","uid":1}
19:09:21.466 < {"seq":387297,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":68,"hpLeft":109,"result":"hit","elementMod":100},"wallMs":1793819361465,"simTime":233878688}
19:09:21.466 < {"type":"result","id":12,"ok":true}
19:09:21.761 < {"seq":387298,"body":{"type":"monsterAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":0,"hpLeft":1152,"maxHp":1767,"result":"miss"},"wallMs":1793819361553,"simTime":233878776}
19:09:22.113 > {"id":13,"type":"attack","uid":1}
19:09:22.114 < {"seq":387299,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":75,"hpLeft":34,"result":"hit","elementMod":100},"wallMs":1793819362113,"simTime":233879336}
19:09:22.114 < {"type":"result","id":13,"ok":true}
19:09:22.761 > {"id":14,"type":"attack","uid":1}
19:09:22.762 < {"seq":387300,"body":{"type":"playerAttack","uid":1,"monsterId":1128,"me":[1152,221],"damage":77,"hpLeft":0,"result":"hit","elementMod":100},"wallMs":1793819362762,"simTime":233879985}
19:09:22.762 < {"seq":387301,"body":{"type":"kill","uid":1,"monsterId":1128},"wallMs":1793819362762,"simTime":233879985}
19:09:22.765 < {"seq":387302,"body":{"type":"exp","base":134,"job":86,"basePct":0.0010412457650825226,"jobPct":0.3028169014084507},"wallMs":1793819362762,"simTime":233879985}
19:09:22.765 < {"seq":387303,"body":{"type":"drop","itemId":935,"qty":1,"monsterId":1128,"rare":false,"isCard":false},"wallMs":1793819362762,"simTime":233879985}
19:09:22.766 < {"type":"snapshot","lastSeq":387303,"mapId":"mjolnir_09","hp":1152}
19:09:22.766 < {"type":"result","id":14,"ok":true}
19:09:22.817 > {"id":15,"type":"pickup","itemId":935}
19:09:22.818 < {"seq":387304,"body":{"type":"pickup","itemId":935,"qty":1,"rare":false},"wallMs":1793819362818,"simTime":233880041}
19:09:22.819 < {"type":"snapshot","lastSeq":387304,"mapId":"mjolnir_09","hp":1152}
19:09:22.819 < {"type":"result","id":15,"ok":true}
$ curl …/summary?after=387281
{"summary":{"events":23,"fromSeq":387282,"toSeq":387304,"fromWallMs":1793819353467,"toWallMs":1793819362818,"gap":false,"truncated":false,"estimatedMs":0,"estimatedZeny":0,"kills":1,"killsByMonster":{"1128":1},"baseExp":134,"jobExp":86,"baseLevelUps":0,"jobLevelUps":0,"deaths":0,"deathLog":[],"stopped":null,"looted":{"935":1},"autoSold":{},"autoSellZeny":0,"used":{},"autoBuyZeny":0,"unpicked":0,"noPotion":0,"rareDrops":[],"noIncome":[],"noIncomeKills":0}}
```

The first `attack` is rejected `TOO_EARLY` until the rolled search (771 ms) + melee approach (1 120 ms) pass; every
later swing waits out the 646 ms ASPD interval. The kill's `exp` and `drop` share the kill's `wallMs`.

## Tests

`server/server.test.mjs` (node:test, server on port 0, injected clock, seeded RNG): seeded twin = captured view and
boot reads; auth/dev-login; commands incl. 422 rule errors, idempotent `commandId`; buy/sell/useItem; the scripted
session over WS with SSE/events/summary checks; **cheat: attack faster than ASPD → `TOO_EARLY` with `retryAt` = last
swing + 646 ms, no damage rolled**; SP/items/unlearned/unknown actions; superseded driver + account cap; party EXP share
and `NOT_YOURS`; SQLite checkpoint survives a restart.

## Client brain (#19) and Beta tray

`brain/brain.js` — pure OpenKore-style loop, `observe(state, wsMessage, nowMs)` + `tick(state, nowMs) → actions[]`
(one action in flight, paced by the wall time passed in, never by timers). Per tick, first match wins: `stopAtLv` /
death without `autoResumeAfterDeath` → `stop`; `escape.lowHp` fly → `teleport`; `hpPotion`/`spPotion` and `use:"heal"`
skills (`recovery.order`); pick up drops (`autoLoot`); in a fight: wait for `found`, then `skip` (monsterRules `defend`
unless the mob hit us, `targets.blacklist/whitelist`, `escape.dangerMonsters`, lv/MVP/aggressive filters when monster
data is passed), `use:"buff"` skills missing or within `cond.refreshBeforeSec`, `use:"attack"` skills (`repeat:"once"`
per target), then `attack`; `combat.skillOnly` never melees. Out of a fight: `sit` (`hpBelow`→`hpUntil`), `statsAddAuto`,
town supply (any `townBuy` under `below`, weight ≥ 90 % or ≥ `autoStorage.abovePercent`): `selectMap saveMap` → `sell`
`autoSell` stacks (not equipped, not `autoSellHeld`) → `storageDeposit` `autoStorage.items` minus `keep` → `buy`
`townBuy` → `selectMap lockMap`; then `search`. Skill `cond`: `hpAbove/hpBelow/spAbove/spBelow` (%), `selfLacks`,
`allyLacks`, `targetAggro`, `or`. Attack/buff `percent` is read as an SP floor (%), heal `percent` as the HP trigger.

`brain/client.js` — `drive({base, characterId, token})` (Node 22) or `boot({profile})` (browser: dev-login as the
profile's account, reload, drive every character of it). WS for actions, REST for commands.

Server additions: `skip {uid, reason}` → `targetSkip` (only after `found`; `ENGAGED` once an aggressive mob is on you);
`snapshot.target.uid` so a reconnecting brain resumes; `GET /brain/*.js`; any other non-`/api` GET serves the official
client from `server/client-cache/` (gitignored; filled by one public, credential-less GET per file from ro-idle.app,
query dropped; never commit or redistribute it); 4xx are logged by the CLI.

Beta tray (side by side with the release app; different identifier, own WebKit stores and app-support dir):

```sh
node server/seed.js --db server/data.sqlite --account profile-1 --token t1 <capture profile-1.jsonl>   # account = tray profile
node server/index.js --port 8797 --db server/data.sqlite
CARGO_TARGET_DIR=$PWD/src-tauri/target-beta RO_IDLE_SERVER=http://127.0.0.1:8797 \
  npx tauri build --debug --config src-tauri/tauri.beta.conf.json
open "src-tauri/target-beta/debug/bundle/macos/RO Idle Tray Beta.app"
```

`RO_IDLE_SERVER` is read at build time: game windows load it instead of ro-idle.app and import `/brain/client.js`;
the updater check, auto-offline and API capture are off; game windows open visible and are never background-throttled
by WebKit (a hidden, throttled page stalled the brain for ~25 s at a time). Port 8787 may be taken on this machine (a local proxy).

Brain gaps: `buffPotion`, `restock` (storage withdraw), `autoBuy` wings/arrows, `partySupport`/`partyAssist` and
`target:"allies"` buffs (no ally data on the WS), `lureCount`, `missStreak`/`bigHit`/`noTarget`/`searchTimeoutSec`
escapes, `recovery.hysteresis`, `stopOnNoIncome`, homunculus. Lv/MVP filters need monster data (`createBrain({monsters})`);
the browser driver does not load it.

## Gaps (defaults picked, not verified against ro-idle.app)

- Party assist (`targetSwitch`): only the encounter's owner can hit it. Party drops: killer only (`itemShare` ignored).
  EXP share goes to `running` members on the killer's map. Party writes (`POST /:id/party/*`) → 422 GAME_RULE.
- Self buffs/support (`cast` of a `self` skill, Heal) need a live encounter; buffs are not timed down outside fights.
- `useItem`/`teleport` have no delay check; AL_TELEPORT costs no SP. No two-hand/shield exclusion on `equip`.
- SSE never sends `idle`, `superseded` (many viewers allowed) or `restart` (no notice on shutdown).
- No server-side idle brain: auto sell/buy/storage/stat-up/potion are the client brain's job; `running` is only a flag.
- Weight warnings (`weight` events), overweight stop, `heldItems`, card/refine bonuses beyond `formulas.derive`.
- `sessionBase`/`stats` counters: only `stats.kills`, `stats.itemsLooted`, deaths updated.
- Regen ticks (6 s standing / 3 s sitting) are RO defaults, not fitted to captures.
- Population second count = 0 (meaning unknown). Chat/lounge/trade/arena are stubs.
- Undriven characters do not simulate; the rate-based delta checkout is #18.

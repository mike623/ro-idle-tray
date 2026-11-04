# ro-idle.app API schemas (#13)

Inferred from 2026-11-04 captures (8 own characters, one party; ~60 MB, 23 commands, ~190k battle events) plus
the public bundle `index-DTiwW5_a.js` for events that never arrived. Regenerate the full shape tree:

```sh
node scripts/api-shapes.mjs ~/Library/Application\ Support/com.mikewong.ro-idle-tray/capture/*.jsonl > .scratch/shapes.txt
```

It prints one section per `METHOD path` (ids → `:id`), SSE event name, command `type` and battle event `body.type`;
`key?` = missing in some samples, id-keyed maps collapse to `*`. Examples below are real but trimmed (`…`).
Error/transport rules (codes, retries, timeouts, headers) are in [gaps.md](gaps.md#missing).

Conventions: times are epoch ms (`*Ms`, `t`, `at`) except `simTime`/`snapshot.time` (server sim clock, ms).
Item ids / monster ids / skill ids match `src/game-data.json` / `src/item-info.json`. Inventory items carry a
per-character `uid`; storage items a per-account `sid`.

## GET /api/characters

```json
{"characters":[{"id":72397,"name":"嘈嘈嘈","running":true,"deleteAfterMs":null,"frozen":false,
  "job":"thief","baseLv":50,"jobLv":41,"mapId":"mjolnir_09"}, …]}
```

## GET /api/characters/:id?deferCatchup=1 — character view

The "view": envelope + `snapshot`. Same object is the command reply `view` and (minus `characterId`, `name`,
`clockFrozen`, `deleteAfterMs`) the SSE `snapshot` event. 503 → `{error:{code:"SERVER_BUSY",message}}`.

| Key | Type | Meaning |
|---|---|---|
| `characterId`, `name` | number, string | |
| `revision` | number | bumps on every state change |
| `commandRevision` | number | bumps per accepted command; client sends it back as `expectedCommandRevision` on guarded commands |
| `lastSeq` | number | last battle-event `seq`; client opens `/stream?after=lastSeq` |
| `running` | boolean | idle loop on |
| `backlogMs` | number | sim time not yet settled (catch-up pending; `deferCatchup=1` returns before settling) |
| `settledAtMs` | number | wall time the sim was settled to |
| `clockFrozen` | boolean | |
| `deleteAfterMs` | number\|null | pending deletion |
| `snapshot` | object | 42 keys, below |

`snapshot` (trimmed real example, thief 72397):

```json
{"time":218308158,
 "character":{"hp":952,"sp":123,"job":"thief","name":"嘈嘈嘈","zeny":174639,"baseLv":50,"jobLv":41,
   "baseExp":59803,"jobExp":43188,"statPoints":7,"skillPoints":24,
   "stats":{"agi":71,"dex":20,"int":1,"luk":1,"str":9,"vit":1},
   "skills":{"TF_MISS":6,"NV_BASIC":9,"TF_DOUBLE":10,"NV_FIRSTAID":1}},
 "derived":{"total":{"agi":78,…},"bonus":{"agi":7,…},"maxHp":952,"maxSp":123,"statusAtk":33,"weaponAtk":17,
   "atkBonus":0,"refineAtk":14,"matkMin":13,"matkMax":16,"hardDef":5,"hardDefShown":5,"vitDef":2,"vitDefShown":1,
   "hardMdef":5,"softMdef":12,"hit":82,"flee":146,"perfectDodge":1,"crit":2,"aspd":167.2,"attackIntervalMs":656,
   "attackRange":1,"moveSpeedMs":112,"weightMax":3060,"hpRegen":5,"spRegen":4,
   "grantedSkills":{},"activeItemCombos":[],"physicalBonuses":{"masteryAtk":0,"weaponResearchDamage":0,
   "hitRatePercent":0,"demonbaneAtk":0,"beastbaneAtk":0}},
 "baseExpNext":115254,"jobExpNext":153941,"mapId":"mjolnir_09","saveMap":"prontera",
 "activity":"attacking","engaged":true,"besieged":false,"pendingStop":null,"restSit":false,"escapeReadyInMs":0,
 "target":{"name":"鍬形蟲","lv":18,"hp":299,"maxHp":659},"aggressors":1,
 "inventory":[{"qty":1,"uid":1,"cards":[],"itemId":1201,"refine":0},{"qty":1,"uid":190,"cards":[],"itemId":2306,"refine":0}, …],
 "equipment":{"armor":190,"weapon":194,"headTop":221,"accessory1":283},   // slot → inventory uid
 "weight":648,"weightPercent":21.176470588235293,
 "config":{…},                       // idle config, same object as updateConfig.config
 "autoRules":["HP 未低於 50%"],"autoSellHeld":{"194":{"reason":"穿在身上"},"221":{"reason":"穿在身上"}},
 "profiles":[],"activeProfile":null,
 "appearance":{"sex":"m","hair":1,"hairColor":0},"appearanceLocked":false,"showLevel":false,"showSavedLook":false,
 "sharedConfig":{"at":1793572651085,"id":64,"version":1},"gachaShards":0,"titles":[],
 "sessionBase":{"t":174367055,"kills":13237,"deaths":18,"jobExp":713802,"zenyIn":140041,"baseExp":493459,
   "zenyOut":32750,"activeMs":169718681,"itemsUsed":432,"teleports":42,"skillCasts":2813,"deathExpLost":442},
 "noIncome":false,"entitled":true,"cart":null,"vend":null,
 "stats":{"since":4425511,"deaths":18,"kills":{"<monsterId>":n,…},"baseExp":…,"jobExp":…,"activeMs":…,
   "stops":{"DEATH":6,"MANUAL":17,"DEATH_LIMIT":2},"zenyIn":{"autoSell":202316,"shopSell":3313},
   "zenyOut":{"trade":1000,"refine":350,"autoBuy":760,"shopBuy":30400,"storageFee":480},
   "byConfig":{"（自訂設定）":{"kills":15195,"jobExp":929993,"baseExp":844369,"zenyNet":172639,"activeMs":213659784}},
   "deathLog":[{"t":7098005,"mapId":"prt_fild08","damage":7,"monsterId":1063}],
   "rareDrops":[{"t":38448084,"itemId":1202,"monsterId":1002}],"itemsUsed":{…},"itemsLooted":{…},
   "teleports":{"fly":…,"skill":…,"butterfly":…},"skillCasts":{"<skill>":n},"noIncomeMs":…,"noIncomeKills":…,
   "deathExpLost":…},
 "rates":{"exp":1,"drop":1},
 "buffs":[{"id":"AL_ANGELUS","remainingMs":88291,"lv":10},{"id":"AL_BLESSING","remainingMs":46545,"lv":10}],
 "ailments":[],"heldItems":[],
 "supply":{"spent":0,"warned":false,"retryAt":{"gems":0,"wing":0,"arrows":0,"potion":0},"startZeny":109291}}
```

`activity` ∈ `attacking|searching|approaching|looting|casting|idle|stopped`. `stats.stops` keys are stop reasons
(`MANUAL`, `DEATH`, `DEATH_LIMIT`, `RETURNED_TOWN`, `CRITICAL_SUPPLY`, `OVERWEIGHT`). Full field list incl. every
`config` key: run the script.

## GET /api/characters/:id/stream?after=<seq>&chatAfter=now|<chatId> — SSE

Plain `EventSource`, unnamed `id` (never set). Client reconnect: on `error` it waits (randomised within the last
`restart.windowMs`, else exponential 1 s → 30 s), re-GETs the view, then reopens with `after=lastSeq`.

| Event | `data` | Seen (by 18:20 on 2026-11-04) | Client action (bundle) |
|---|---|---|---|
| `snapshot` | `{snapshot, revision, commandRevision, lastSeq, running, backlogMs, settledAtMs}` — full snapshot, not a diff | ~970 | replace state |
| `events` | `[event…]` (1–20+ per message) | ~7,300 | append to log |
| `chat` | `[{id, channel, senderId, senderName, text, atMs}]` (only `channel:"announce"` seen) | ~1,100 | chat pane |
| `chatCursor` | `{cursor: 337678}` — latest chat id, sent at open | 113 | resume point for `chatAfter` |
| `restart` | `{windowMs: 5790}` | 16 | server restarting; reconnect within `min(windowMs, 60s)` |
| `lounge` | `{room, capacity, members:[{id, name, seat, idle, sit, job, look}]}` | 11 | social, out of phase 1 |
| `gap` | none read | 0 | sets `logGap` (log has a hole → show notice) |
| `idle` | none read | 0 | close stream, `connection:"idle"` (viewer idle; reopens on activity) |
| `superseded` | none read | 0 | close, `connection:"superseded"` (stream opened elsewhere) |
| `watchLimit` | `{limit, others}` | 0 | "too many viewers" banner |
| `trade`, `arena`, `arenaNotice` | — | 0 | social, out of phase 1 |

## Battle event — `{seq, body, wallMs, simTime}`

```json
{"seq":351344,"body":{"me":[952,123],"uid":51748,"hits":2,"type":"playerAttack","damage":52,"hpLeft":215,
  "result":"hit","monsterId":1128,"elementMod":100},"wallMs":1793803062949,"simTime":218308309}
```

`seq` strictly increasing per character; `uid` = monster instance; `me` = `[hp, sp]` after the hit;
`by`/`from`/`to`/`ally` = party member names. 45 body types seen:

| `type` | Fields (`?` optional) | Values seen |
|---|---|---|
| `searching` | — | |
| `found` | uid, monsterId, approachMs, distance? | |
| `targetSkip` | monsterId, reason | `defend` |
| `targetSwitch` | uid, monsterId, ally, assist | |
| `luring` | goal, count | |
| `playerAttack` | uid, monsterId, me, damage, hpLeft, result, elementMod, hits? | result `hit\|miss\|crit` |
| `monsterAttack` | uid, monsterId, me, damage, hpLeft, maxHp, result | `hit\|miss\|perfectDodge` |
| `skillCast` | skill, lv, castMs, delayMs, monsterId?, reason? `{k, leftSec?, pct?, below?, target?}` | k `buff\|hp` |
| `skillHit` | uid, monsterId, skill, lv, me, damage, hpLeft, hits, result, elementMod | `hit` |
| `skillHeal` | skill, lv, hp | |
| `skillInterrupt` | skill, reason | `target` |
| `support` | skill, lv, from?, to?, hp? | party buff/heal given or received |
| `mobSkillCast` | uid, monsterId, skill, lv, castMs | |
| `mobSkill` | uid, monsterId, skill, lv, damage, result | `hit\|miss` |
| `statusStart` | uid, monsterId, status, durationMs | `provoke` |
| `statusResist` | uid, monsterId, skill, status | |
| `ailmentStart` / `ailmentEnd` | ailment, durationMs (start only) | `silence` |
| `buffStart` / `buffEnd` | buffId, durationMs (start only) | AL_INCAGI, AL_BLESSING, AL_ANGELUS, MC_LOUD, SM_ENDURE |
| `kill` | uid, monsterId | |
| `exp` | base, job, basePct, jobPct, by?, party? | party share when `party` |
| `drop` | itemId, qty, monsterId, rare, isCard, by?, party? | |
| `pickup` | itemId, qty, rare | |
| `baseLevelUp` | lv, statPoints | |
| `jobLevelUp` | lv, skillPoints | |
| `statUp` | stat, value | auto stat allocation |
| `skillUp` | skill, lv, skillPoints | |
| `useItem` | itemId, hp, sp, auto | |
| `autoSell` | itemId, qty, zeny | |
| `autoBuy` | itemId, qty, zeny, use | |
| `shopBuy` / `shopSell` | itemId, qty, zeny, shop? (buy) | |
| `storage` | action, items `[{itemId, qty}]`, fee, zeny? | `deposit\|withdraw` |
| `identify` | itemId, method | `item` |
| `equip` / `unequip` | slot, itemId | `armor\|ammo` |
| `weight` | percent, threshold | |
| `mapChange` | from, to, cause | `manual\|auto\|return` |
| `teleport` | mapId | |
| `start` | mapId | |
| `halting` / `stop` | reason | `MANUAL` |
| `config` | message | "掛機設定已更新" |
| `system` | level, message | `warn` |

Expected but never seen: death, MVP, card drop (`isCard:true`), overweight stop.

## GET /api/characters/:id/events?after=<seq>&limit=1000

```json
{"events":[{"seq":350344,"body":{"by":"牙暉","job":21,"base":33,"type":"exp","party":true,
  "jobPct":0.0136,"basePct":0.0286},"wallMs":1793802675792,"simTime":217921152}, …],
 "gap":false,"retainedFrom":340846}
```

`retainedFrom` = oldest seq still stored (~8–10k events back); `gap` presumably true when `after < retainedFrom`
(never true in captures). Client pages until fewer than `limit` come back.

## GET /api/characters/:id/summary?after=<seq> — away summary

```json
{"summary":{"events":5081,"fromSeq":351138,"toSeq":356218,"fromWallMs":1793802978683,"toWallMs":1793805000647,
  "gap":false,"truncated":false,"estimatedMs":0,"estimatedZeny":0,
  "kills":31,"killsByMonster":{"1013":4,"1031":6,"1104":4,"1128":10,"1174":7},
  "baseExp":8783,"jobExp":5440,"baseLevelUps":0,"jobLevelUps":0,"deaths":0,"deathLog":[],"stopped":null,
  "looted":{"511":1,"920":4,"947":8,…},"autoSold":{},"autoSellZeny":0,"used":{},"autoBuyZeny":0,
  "unpicked":0,"noPotion":0,"rareDrops":[],"noIncome":[],"noIncomeKills":0}}
```

`estimatedMs`/`estimatedZeny` = rate-based offline estimate (0 here: party never fully offline).

## POST /api/characters/:id/commands

Request `{commandId: uuid, command: {type, …}, expectedCommandRevision?}`. `expectedCommandRevision` is sent only
for guarded commands (bundle: `refine`, `refineSafe`, `insertCard`, `npcReset`, `broadcast`); none captured.
Retries reuse `commandId` (idempotency key).

Reply 200: `{ok:true, view, storage?}` — `view` = full character view (above); `storage` only for storage commands.
Reply 422: `{error:{code:"GAME_RULE", message}, view, storage?}`:

```json
{"commandId":"8231b8a4-…","command":{"type":"storageWithdraw","items":[{"sid":8,"qty":654}]}}
→ 422 {"error":{"code":"GAME_RULE","message":"Zeny 不足（倉庫費 40 Zeny）"},"view":{…},"storage":{…}}
```

**14 command types captured:**

| `type` | Body fields | Example |
|---|---|---|
| `start` | — | `{"type":"start"}` |
| `stop` | — | `{"type":"stop"}` |
| `selectMap` | mapId | `{"type":"selectMap","mapId":"prontera"}` |
| `updateConfig` | config (entire idle config, ~2.3 KB) | `{"type":"updateConfig","config":{"sit":{…},"targets":{…},…}}` |
| `allocateStats` | stats `{stat: increment}` | `{"type":"allocateStats","stats":{"luk":1}}` |
| `learnSkills` | skills `[skillId]`, one entry per level | `{"type":"learnSkills","skills":["TF_MISS"]}` |
| `equip` | uid | `{"type":"equip","uid":190}` |
| `unequip` | slot | `{"type":"unequip","slot":"armor"}` |
| `useItem` | uid | `{"type":"useItem","uid":229}` |
| `sell` | uid, qty | `{"type":"sell","uid":477,"qty":1}` |
| `buy` | itemId, qty | `{"type":"buy","itemId":501,"qty":1}` |
| `storageDeposit` | items `[{uid, qty}]` | `{"type":"storageDeposit","items":[{"uid":193,"qty":1}]}` |
| `storageWithdraw` | items `[{sid, qty}]` | `{"type":"storageWithdraw","items":[{"sid":8,"qty":654}]}` |
| `storageZeny` | action `deposit\|withdraw`, amount | `{"type":"storageZeny","action":"withdraw","amount":1000}` |

`updateConfig.config` top-level keys: sit, homun, combat, escape, skills, autoBuy, lockMap, restock, targets, townBuy,
autoLoot, autoSell, hpPotion, recovery, spPotion, stopAtLv, lureCount, autoRepair, buffPotion, autoStorage,
partyAssist, partyAssistNames?, autoIdentify, lootPriority, monsterRules, partySupport, statsAddAuto,
siegeThreshold, stopOnNoIncome, stopOnOverweight, autoReturnAfterWing, autoResumeAfterDeath.

Bundle-only (not captured, outside phase 1): `repair`, `refine`, `refineSafe`, `identify`,
`allowAutoSell`, `insertCard`, `discard`, `lockItem`, `sellBatch`, `storageSell`, `castSupport`, `jobChange`,
`rebirth`, `npcReset`, `setSavePoint`, homun*, vend*, mail*, sponsor*, gacha, craft*, make*, cosmetic setters, ….

## GET /api/storage

```json
{"storage":{"items":[{"qty":6,"sid":3,"itemId":1010},{"qty":654,"sid":8,"itemId":507},…],"zeny":0,"capacity":600,
  "revision":52,"fees":{"prontera":40,"geffen":30,"payon":60,"niflheim":150,…},"heldItems":[]}}
```

Command replies carry the inner object (`storage:{items,…}`). Fee is per town (`fees[saveMap]`?); 40 at prontera.

## GET /api/characters/:id/party

```json
{"party":{"id":21747,"name":"askern","leaderId":72444,"expShare":"even","itemShare":"random","maxMembers":12,
  "members":[{"id":72397,"name":"嘈嘈嘈","mapId":"mjolnir_09","running":true,"baseLv":50,"job":"thief",
    "look":{"appearance":{"sex":"m","hair":1,"hairColor":0},"headgear":{"top":2220},"gear":{}},
    "vitals":{"hp":100,"sp":100},"buffs":[{"id":"AL_ANGELUS","lv":10},{"id":"AL_INCAGI","lv":3}]}, …]},
 "invites":[],
 "own":[{"id":72688,"name":"嘈嘈嘈2","partyId":21747,"running":true,"vending":false,"mapId":"mjolnir_09",
   "baseLv":48,"job":"swordman","invites":[]}, …]}
```

`vitals` are percents; `own` = the account's other characters (for "我的其他角色" joins); `party` is `null` when not
in a party.

Party writes — **bundle only, never captured**: `POST /api/characters/:id/party/<action>`; the client applies the
reply as the new party view and toasts `reply.notice` if present. Actions and bodies:

| Action | Body |
|---|---|
| `create` | `{name}` |
| `invite` | `{name}` (character name) |
| `respond` | `{partyId, accept}` |
| `leave` | `{}` |
| `kick` | `{memberId}` |
| `leader` | `{memberId}` |
| `rename` | `{name}` |
| `settings` | `{expShare, itemShare}` (seen values `even`, `random`) |
| `recruit` | `{recruit: …\|null}` (lobby listing; `null` ends it) |
| `application` | `{characterId, accept}` (leader reviews a lobby application) |
| `withdraw` | `{partyId}` (cancel own application) |
Other reads seen once, no shape needed for phase 1: `/guild` (`{guild, invites, skills, directory}` — directory
is other players, not reproduced), `/mail` (`{inbox, sent, fee:1000, maxItems:5, maxNote:60, ttlDays:14}`),
`/api/costumes`, `/api/rankings`, `/api/shared-configs`, `/lounge/*`.

## GET /api/maps/population

```json
{"at":1793810157758,"maps":{"prontera":[623,260],"mjolnir_09":[52,13],"pay_fild02":[1891,88],…}}
```

`maps[mapId] = [a, b]`, ~200 maps, two non-negative counts per map (meaning of each count not verified;
towns have a high second value, e.g. prontera 260).

## GET /api/kill-event — server-wide event

```json
{"event":{"id":1,"name":"全服擊殺波利","monsterId":1002,"target":20000000,"startsMs":1793646158084,
  "endsMs":1794250958084,"dropMult":1.5,"bonusMs":259200000,"reachedMs":null,"missMult":1.2,"missedMs":null,
  "progress":11022211},"nowMs":1793804998873}
```

Polled ~1/min. 503 → `SERVER_BUSY`.

## POST /api/presence

Body `{}` → `{ok:true}`. Sent at most once a minute on user activity.

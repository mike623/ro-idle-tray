# Capture gap report (#12)

2026-11-04: ~85 min passive capture (8 characters, one party, idling) + #12 command checklist on one character.
7,181 records / 40 MB. Reproduce:

```sh
cp ~/Library/Application\ Support/com.mikewong.ro-idle-tray/capture/*.jsonl .scratch/capture/
python3 -I scripts/capture-gaps.py .scratch/capture .scratch/bundle.js
```

Formulas are covered separately in [formulas.md](formulas.md) (`scripts/formula-check.py`).

## Covered

| Area | Seen | Notes |
|---|---|---|
| Character read | `GET /api/characters`, `GET /api/characters/:id?deferCatchup=1` | Character GET adds `revision`, `commandRevision`, `lastSeq`, `backlogMs`, `settledAtMs`, `clockFrozen` around `snapshot` |
| Snapshot | 42 top-level keys, `derived` 30 keys | `sessionBase` = cumulative counters (kills, exp, zeny, `activeMs`) → offline rates |
| Battle log | 36 event body types, ~180k events | Each event: `{seq, body:{type,…}, wallMs, simTime}`; replay by `simTime` |
| Event backfill | `GET /api/characters/:id/events?after=&limit=1000` | Same event shape |
| Away summary | `GET /api/characters/:id/summary?after=` | kills/exp/looted/autoSold/deaths + `estimatedMs`, `estimatedZeny` |
| Stream | `snapshot`, `events`, `chat`, `chatCursor`, `restart` | `restart` = `{windowMs}`; `chatCursor` = `{cursor}` |
| Server event | `GET /api/kill-event` | Global kill counter, drop multiplier when reached |
| Presence | `POST /api/presence` (body `{}`) | ≤1/min on user activity. **All 22 failed in the tray** (`TypeError: Load failed`) — investigate separately |
| Server-side auto actions | `autoSell`, `autoBuy`, `shopBuy`, `storage`, `identify`, `equip`, `statUp`, `teleport`, `mapChange` events | Done by the server's idle brain, not by client commands |

## Commands (#12 checklist, one character)

`POST /api/characters/:id/commands`, body `{commandId, command}` — no `expectedCommandRevision` on any of these.
Reply is always `{ok:true, view}` where `view` **is the full character GET body** (whole snapshot, not a diff);
`storageDeposit` adds `storage` (same shape as `GET /api/storage`: `{items:[{sid, itemId, qty}]}`).

| Command | Captured args |
|---|---|
| `stop` / `start` | — |
| `selectMap` | `mapId` (town = `prontera`) |
| `updateConfig` | `config` = **entire** idle config (~2.3 KB), not a patch |
| `allocateStats` | `stats: {luk: 1}` (increments) |
| `unequip` / `equip` | `slot: "armor"` / `uid` (inventory uid) |
| `useItem` | `uid` |
| `storageDeposit` | `items: [{uid, qty}]` |
| `sell` / `buy` | `uid, qty` / `itemId, qty` (no `shop` given in town) |
| `learnSkills` | `skills: ["TF_MISS"]` (one entry per level point) |

UI reads triggered by the session: `GET /api/storage`, `/api/maps/population`, `/api/characters/:id/{party,guild,mail}`,
`/api/costumes`, `/api/shared-configs[/:n]`.

## Missing

**Commands:** `storageWithdraw` not captured (withdraw step did not send it), and **no error reply** yet
(bonus step 11). The other 50 kinds are outside phase 1.

**Stream events never seen:** `gap`, `idle`, `superseded`, `watchLimit` (edge cases: reconnect, idle viewer,
too many viewers) and `arena`, `arenaNotice`, `lounge`, `trade` (social features, out of phase 1).

**Endpoints never called:** 64 of 69 bundle paths — auth (deliberately not recorded), party/guild/trade/mail/
vending/arena/duels/lounge/chat-send, shared-configs, rankings, storage, profile, nearby, world-mvp, delete/merge.
Phase 1 needs none of them except party read (`/party`) and storage.

**Event types expected but not seen:** death, job level up, skill learn, rare/card drop, MVP, overweight stop.

**Offline catch-up:** party was never fully offline, so `estimatedMs`/`estimatedZeny` stayed 0 and no `gap`/`idle`
arrived. Needed for phase 2 (#18): close all windows of one party ≥10 min, reopen.

## Next captures (targeted, short)

1. #12 command checklist on one character (~5 min).
2. One full-party offline/return cycle (phase 2).
3. A character death and a job level up, if they happen naturally.

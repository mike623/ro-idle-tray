# L2 fight corpus (#23)

Regression suite for the rules engine (#17) and input to the L2 fight-replay check: each recorded fight is
re-run by our engine with the same character, mob and buffs, and the real outcome must land inside our p5–p95.

```sh
node scripts/extract-fights.mjs ~/Library/Application\ Support/com.mikewong.ro-idle-tray/capture/*.jsonl --out tests/fixtures/fights/ [--max 400]
node --test tests/extract-fights.test.mjs
```

Captures are read-only input; the script only writes `--out`.

## What is a fight

Per character (`/api/characters/<id>/...` in the record path), events from SSE `events` and `GET .../events`
are merged and deduped by `seq`, then walked in `seq` order:

- **opens** on `found` (own search, `start: "found"`) or `targetSwitch` (`start: "assist"` when `assist: true`, else `"switch"`).
  Re-picking the current target is ignored.
- **closes** with `outcome: "kill"` on `kill` of the same `uid`, or `outcome: "death"` on `death` or a
  `monsterAttack`/`mobSkill` that leaves the player at 0 HP (`me[0] === 0` or `hpLeft === 0`).
- **abandoned** (counted, not emitted) when another target is opened, or on `mapChange`/`teleport`/`stop`/`halting`.
  Most are assist churn or mobs finished by a party member: the stream only emits `kill` for our own last hit.
- fights whose start precedes the character's first snapshot are dropped (`noSnapshot`).

## `fights.jsonl` (one fight per line)

| field | meaning |
|---|---|
| `id` | `"<charId>:<mob uid>"`, unique per fight |
| `charId`, `mobId`, `mapId` | our character, monster id (`src/game-data.json`), map at fight start (snapshot `mapId`, overridden by a later `mapChange`/`teleport`) |
| `start`, `outcome` | see above |
| `partyIds` | the user's other captured characters whose latest snapshot at fight start is on the same map |
| `buffs` | `[{id, lv, remainingMs}]` at fight start: snapshot buffs aged to the start, then `buffStart`/`buffEnd` up to it (`lv` unknown for buffs started after the snapshot) |
| `charSnapshot` | latest snapshot at or before the start: `character` (minus `skills`), `derived`, `equipment` (`slot → {itemId, refine, cards}` resolved from inventory), `skills`, `mapId`, `snapshotAgeMs` |
| `events[]` | combat events only, `t` = ms since fight start (sim time) |

Kept event types: `found targetSwitch playerAttack skillHit skillCast skillInterrupt skillHeal monsterAttack mobSkill
mobSkillCast statusStart statusResist ailmentStart ailmentEnd useItem buffStart buffEnd kill death`.
Kept scalar fields: `damage result hits skill lv hpLeft castMs status ailment durationMs itemId buffId approachMs reason`.
`result` is `hit|miss|crit|perfectDodge|...` as recorded. `hpLeft` is the **mob's** HP after `playerAttack`/`skillHit`
and the **player's** after `monsterAttack`/`mobSkill`. `otherMob: <monsterId>` marks an event against a second aggressor.
Chat, exp/drop/support events, ally names and config (which holds other players' names) are never copied.

## `summary.json`

- `captures`, `totals` (`opened kill death abandoned noSnapshot extracted kept`), `strata` (`job|map|mob|outcome → {extracted, kept}`).
- `fights[]`: L2 observables per kept fight: `durationMs` (start → last event, includes approach),
  `damageTaken` (sum over `monsterAttack`/`mobSkill`, all aggressors), `hitsLanded`/`attacksMade`
  (own `playerAttack`/`skillHit` on the target, damage > 0 / all), `hitsReceived`/`attacksReceived` (damage > 0 / all).
  Counts are events; multi-hit (`hits`) is not expanded.

## Sampling

At most `--max` (400) fights, round-robin over `job|map|mob|outcome` strata in a fixed sha1(id) order, so every
stratum is kept before any gets a second fight. Deterministic for the same captures.

## Known limits (2026-11-04 captures)

- 0 deaths in the 2-hour capture window (historical deaths exist only as `stats.deathLog` summaries without events).
- Maps: almost all `mjolnir_09`, 3 fights on `pay_fild01`. More maps/mobs need new captures.
- Snapshots are sparse (median age ~28 s, p95 ~23 min); stats/equipment rarely change mid-session, buffs are rebuilt from events.

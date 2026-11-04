# Twin report (#23)

Generated 2026-11-04 by `node scripts/twin-diff.mjs <capture dir>` from 11 local capture files
(the user's own 8-character party; read-only). Character ids and jobs only; no names or chat.

## L1 formulas (`scripts/formula-check.py`)

Failing adopted formulas: **none** (exit 0).

| Formula | OK | MISS | SKIP | |
|---|---|---|---|---|
| aspd | 1322 | 0 | 0 |  |
| attackIntervalMs | 1322 | 0 | 0 |  |
| baseExpNext | 1322 | 0 | 0 |  |
| castMs_DEX | 6317 | 0 | 0 |  |
| crit | 1322 | 0 | 0 |  |
| drops_4sigma | 26 | 0 | 31 |  |
| drops_known_outlier | 1 | 0 | 0 | (informational) |
| element_table | 40454 | 0 | 4608 |  |
| event_without_snapshot | 0 | 0 | 24182 |  |
| flee | 1322 | 0 | 0 |  |
| hardDef | 1322 | 0 | 0 |  |
| hardMdef | 1322 | 0 | 0 |  |
| hit | 1322 | 0 | 0 |  |
| hpRegen | 1322 | 0 | 0 |  |
| interval_from_aspd | 1322 | 0 | 0 |  |
| jobExpNext | 1322 | 0 | 0 |  |
| magic_bolt_damage | 1220 | 0 | 236 |  |
| magic_bolt_hits | 1220 | 0 | 0 |  |
| matkMax | 1322 | 0 | 0 |  |
| matkMin | 1322 | 0 | 0 |  |
| maxHp | 1322 | 0 | 0 |  |
| maxSp | 1322 | 0 | 0 |  |
| monster_angelus_alternative | 1673 | 477 | 0 | (informational) |
| monster_damage_candidate | 2105 | 45 | 306 | (informational) |
| monster_def2_softdef | 1404 | 746 | 0 | (informational) |
| monster_def2_softdef_angelus | 2132 | 18 | 0 | (fitted) |
| monster_wiki_softdef | 1911 | 239 | 0 | (informational) |
| monster_wiki_softdef_angelus | 1671 | 479 | 0 | (informational) |
| party_exp_base | 28232 | 0 | 4368 |  |
| party_exp_job | 28232 | 0 | 4368 |  |
| perfectDodge | 1322 | 0 | 0 |  |
| player_damage_candidate | 37150 | 250 | 4155 | (fitted) |
| refineAtk | 1322 | 0 | 0 |  |
| refine_before_def_alternative | 2070 | 3965 | 0 | (informational) |
| skill_delayMs | 6317 | 0 | 0 |  |
| softMdef | 1322 | 0 | 0 |  |
| spRegen | 1322 | 0 | 0 |  |
| statusAtk | 1322 | 0 | 0 |  |
| total_stats | 1322 | 0 | 0 |  |
| unsupported_snapshot | 0 | 0 | 20 |  |
| vitDef | 1322 | 0 | 0 |  |
| weightMax | 1322 | 0 | 0 |  |

## L2 fight replay (engine, 1000 seeds per fight, real within simulated p5–p95 on duration, damage taken, hits)

| Set | Pass |
|---|---|
| own-finish (bar ≥ 90%) | 141/153 = 92.2% ✅ |
| solo from `found` | 21/25 = 84.0% |
| party-helped (not judged: a solo replay cannot reproduce party damage) | 2/247 = 0.8% |
| all | 143/400 = 35.8% |

Worst own-finish fights: `72468:52844` mage vs 1104 (durationMs real 1978 vs p5–p95 5556–5556; hitsLanded real 1 vs p5–p95 2–2) · `72472:52437` merchant vs 1128 (durationMs real 0 vs p5–p95 1172–2344; hitsLanded real 1 vs p5–p95 2–2) · `72688:52157` swordman vs 1085 (durationMs real 12406 vs p5–p95 12424–29428; hitsLanded real 3 vs p5–p95 4–15) · `74435:51903` merchant vs 1013 (durationMs real 2607 vs p5–p95 1116–2232; hitsLanded real 1 vs p5–p95 2–2) · `74435:53008` merchant vs 1013 (durationMs real 2314 vs p5–p95 1116–2232; hitsLanded real 1 vs p5–p95 2–2) · `72472:51858` merchant vs 1031 (durationMs real 0 vs p5–p95 1168–2336) · `72472:53052` merchant vs 1128 (durationMs real 1620 vs p5–p95 0–1168) · `72688:52642` swordman vs 1085 (hitsLanded real 3 vs p5–p95 4–15)

## L3 session rates (twins: our brain + server)

8 twins seeded from their first captured view (T0), one party, driven by `brain/client.js` over WebSocket
for 4.97 simulated hours (median real farming time; clock ×60, 5.0 min wall).
Real farming time = sum of gaps < 60 s between the character's events after T0. Each cell: real/h → twin/h
(deaths, potions, drops are per hour too). ✅ = inside the two-sample Poisson 95% CI or within ±10%; EXP and zeny use
the relative error of the exp / zeny event counts behind them. 25/48 cells pass.

| Char | Job Lv | Map | Real h | Kills/h | Base EXP/h | Zeny/h | Deaths/h | Potions/h | Drops/h |
|---|---|---|---|---|---|---|---|---|---|
| 72397 | thief 50 | mjolnir_09 | 6.27 | ❌ 208 → 0.0 | ❌ 28,317 → 2,946 | ✅ -7,481 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.2 → 0.0 | ❌ 125 → 0.0 |
| 72444 | acolyte 48 | mjolnir_09 | 4.94 | ✅ 0.0 → 0.0 | ❌ 28,696 → 2,946 | ✅ 3,319 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 126 → 0.0 |
| 72468 | mage 49 | mjolnir_09 | 4.97 | ❌ 225 → 0.0 | ❌ 28,803 → 2,946 | ✅ 4,733 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 127 → 0.0 |
| 72472 | merchant 48 | mjolnir_09 | 4.90 | ❌ 57.9 → 0.0 | ❌ 28,589 → 2,946 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 133 → 0.0 |
| 72688 | swordman 48 | mjolnir_09 | 5.32 | ✅ 65.0 → 74.1 | ❌ 29,704 → 2,946 | ✅ 4,571 → 2,337 | ✅ 0.0 → 0.0 | ❌ 0.2 → 14.1 | ❌ 128 → 94.8 |
| 74435 | merchant 48 | mjolnir_09 | 4.95 | ❌ 59.3 → 0.0 | ❌ 28,078 → 2,946 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 124 → 0.0 |
| 74496 | archer 48 | mjolnir_09 | 4.94 | ❌ 162 → 0.0 | ❌ 28,472 → 2,946 | ✅ -68.2 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 122 → 0.0 |
| 74917 | acolyte 47 | mjolnir_09 | 4.90 | ❌ 1.6 → 0.0 | ❌ 28,752 → 2,946 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ✅ 0.0 → 0.0 | ❌ 130 → 0.0 |

Worst outliers: 72397 thief kills 208 → 0.0 (×0.00) · 72397 thief drops 125 → 0.0 (×0.00) · 72444 acolyte drops 126 → 0.0 (×0.00) · 72468 mage kills 225 → 0.0 (×0.00) · 72468 mage drops 127 → 0.0 (×0.00) · 72472 merchant kills 57.9 → 0.0 (×0.00) · 72472 merchant drops 133 → 0.0 (×0.00) · 74435 merchant kills 59.3 → 0.0 (×0.00)

## L4 offline checkout

Skipped: no capture of a full-party offline/return cycle on ro-idle.app exists yet (needed: party offline ≥ 1 h, then
return, with the catch-up summary recorded).

## Triage (hand-written, 2026-11-04)

### L1: four adopted formulas failed on the latest captures; all four resolved

The capture kept growing after formulas.md was written (the thief became an assassin with a katar and Enchant Poison;
the party's priest refreshes Blessing). `python3 -I scripts/formula-check.py <capture dir> .scratch/bundle.js` failed
`castMs_DEX` (16 MISS), `element_table` (7), `player_damage_candidate` (4.2% > 2% ceiling) and `drops_4sigma` (1).

| Formula | Cause | Kind | Fix |
|---|---|---|---|
| `player_damage_candidate` | Katar hits carry an off-hand hit: + floor(damage × (1 + 2 × Double Attack lv) / 100). Predicted max 178 / 141 → observed 215 / 170 exactly | **formula gap** (real) | `formulas.playerDamage` + engine (`doubleLv` = TF_DOUBLE); checker envelope. Katar misses 1,255 → 4; overall 4.2% → 0.7% |
| `castMs_DEX` | 16 Increase AGI casts by the acolyte in one 210 s window: the snapshot shows Blessing, the stream later sends its `buffEnd` but never the refresh's `buffStart` (lost party recast) | capture gap | Replay keeps a buff whose later `buffEnd` comes before any `buffStart` (Python and JS replays) |
| `element_table` | Enchant Poison endows the assassin's weapon; under it captured hits mix 125 and 100 vs earth, and one refresh came without a `buffStart` | replay gap | Skip normal-attack element checks for characters with AS_ENCHANTPOISON learned (damage check already uses the observed `elementMod`) |
| `player_damage_candidate`, `monster_def2_softdef_angelus` (re-failed at 23:07: 2.2% / 1.2%) | The merchant gained job levels after 22:33; the replay applied `baseLevelUp` but not `jobLevelUp` / `skillUp`, so its job-bonus stats stayed stale until the next snapshot | replay gap | Both replays apply `jobLevelUp` (jobLv) and `skillUp`; back to 0.5% / 0.5% |
| `drops_4sigma` | 1128 Horn → 935 Shell: 1,026 / 1,713 kills = 59.9% vs bundle 5500 (55%, 4.1σ), even across every capture hour; Horn → 947 at the same rate fits (947) | data drift (server table ≠ client bundle, likely) | Listed in `KNOWN_DROP_OUTLIERS`, reported as `drops_known_outlier` (informational). Engine keeps the bundle rate |

Also fixed: the JS capture-check test (server/rules/formulas.test.mjs) read the live, still-growing capture dir
while the Python oracle read it a few seconds later, so counts differed by a few events (the flaky test). It now copies
the dir once and both read the copy; both readers skip a half-written last line.

### L2: passes (92.2% ≥ 90%)

The 12 failing own-finish fights are mostly ones where the real fight took one hit fewer than every simulated run,
or 0 ms from `found` to `kill`. Likely an extraction edge (a mob already hit before `found`), not investigated.
Party-helped fights (247) are reported only.

### L3: fails, as expected from the known brain gaps

- **Party assist is the party's whole strategy.** 7 of 8 configs have `monsterRules: defend` for every mob on
  mjolnir_09 plus `partyAssist: true`; the swordman (`lure` rules) pulls and the others switch to its target
  (`targetSwitch`, 3,175 events for one merchant). Our brain has no `partyAssist`, and the server lets only the
  encounter's owner hit a monster, so those 7 twins skip every monster: 0 kills, 0 drops.
- The one twin that plays like its real character, the swordman, matches: **65 → 74 kills/h ✅**, zeny ✅. It drinks 14
  potions/h against 0.2 real, because in the real party the priests heal and buff it (`partySupport`, `allyLacks`
  buffs: no ally data on the WS yet).
- EXP/h is a party share of the swordman's kills only (2,946/h each vs ~28,500/h real), so it is ❌ everywhere.
- Drops/h: real members pick up ~125 items/h each because the real party uses `itemShare` (other members' kills drop
  to them); our server drops to the killer only.
- Fixed on the way: the run crashed the whole server once (acolyte twin cast AL_INCAGI, a `support` skill with no
  element, at its target; `elementMod(undefined)` threw inside the WebSocket handler). Engine now treats support casts
  in a fight as a self buff, element-less attack skills as neutral, and the WS handler answers `INVARIANT` instead of
  dying.

Next for L3 to mean anything: brain `partyAssist` (switch to a party member's engaged target) + server party-assist
hits on another member's encounter, `partySupport` / ally buffs, and party `itemShare`. Raw run:
`docs/offline-backend/runs/twin-2026-11-04.json`.

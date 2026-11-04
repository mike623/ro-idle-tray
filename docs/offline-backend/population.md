# Player population (load-test input)

2026-11-04, from captured `GET /api/maps/population`, `/api/shared-configs` (hot tab, all jobs, pages 1–10 plus 29 full
configs opened read-only) and `/api/rankings`. Aggregates only: raw configs are other players' work and stay in the
local capture folder (`<app config>/capture/*.jsonl`), not in this repo.

Used by the load test's bot population generator: each bot = our client brain + a real shared config + a character
built for that job/level + a map drawn from this distribution.

## Where players are (`/api/maps/population`)

Each map returns `[a, b]`. `a` sums to **42,875 over 202 maps**: presumably characters on that map (unconfirmed); `b`
is smaller (e.g. 144) and unconfirmed, possibly "active now". 676 are in towns. Long tail: 39 maps have ≤10.

| Map | Name | a | b | Monster Lv |
|---|---|---|---|---|
| `ein_fild04` | 艾音布羅克原野 04 | 4,975 | 144 | 1–56 |
| `pay_dun01` | 斐揚洞穴 2樓 | 2,992 | 47 | 1–24 |
| `yuno_fild08` | 朱諾 啟 海伊洛學院 | 2,369 | 24 | 1–58 |
| `pay_fild02` | 斐揚森林 02 | 1,903 | 41 | 14–25 |
| `prt_fild08` | 普隆德拉原野 08 | 1,795 | 22 | 1–3 |
| `gef_fild14` | 西邊 獸人村 | 1,528 | 37 | 24–52 |
| `iz_dun03` | 依斯魯得島 海盜地洞密穴 4樓 | 1,494 | 27 | 14–36 |
| `in_sphinx4` | 夢羅克人面獅身像 地下 4樓 | 1,236 | 41 | 52–75 |
| `pay_dun03` | 斐揚洞穴 4樓(廢村) | 1,215 | 21 | 1–51 |
| `mjolnir_05` | 妙勒妙勒尼山脈北區 05 | 1,025 | 24 | 1–41 |

Level spread, by each field map's median monster level, weighted by `a` (42,091 field characters):

| Monster Lv | 0–9 | 10–19 | 20–29 | 30–39 | 40–49 | 50–59 | 60–69 | 70+ |
|---|---|---|---|---|---|---|---|---|
| Share | 13.6% | 25.5% | **29.2%** | 8.2% | 7.2% | 8.2% | 7.4% | 0.7% |

## Which jobs (`/api/shared-configs`, weighted by `using`)

209 configs, 4,175 users (611 configs exist; the top 200 cover most use).

| Job | Share | Job | Share |
|---|---|---|---|
| novice | 28.1% | thief | 3.0% |
| bard | 10.2% | swordman | 1.5% |
| dancer | 9.9% | novice_high | 1.3% |
| priest | 9.2% | rogue | 1.3% |
| wizard | 7.1% | crusader | 1.2% |
| hunter | 4.4% | gypsy / clown | 1.2% each |
| archer | 4.4% | assassin / blacksmith | 1.1% each |
| mage | 4.0% | knight | 0.6% |
| merchant | 3.8% | rebirth 2nd jobs | <0.5% each |
| acolyte | 3.2% | sage / monk / alchemist | ≤0.1% each |

Performers and priests are a large share, so party buffs and songs are a big part of the load, not just melee.

`/api/rankings` lists only the top 50 per family, all level 99 rebirths (e.g. high_wizard 48/50 of mages,
whitesmith 43/50 of merchants). It shows an endgame tier exists, not its size; give it a few percent of bots so the
expensive AoE paths get exercised.

## What a config contains (29 full configs, one per job)

Present in nearly all: `skills` (per-skill rules: level, use = attack/buff, conditions like `spAbove`,
`allyLacks`, `refreshBeforeSec`), `targets`, `recovery`, `sit`, `hpPotion`/`spPotion`/`buffPotion`, `escape`,
`autoLoot`/`autoSell`/`autoBuy`/`autoStorage`/`autoIdentify`, `partyAssist`/`partySupport`, `homun`, `lockMap`,
`siegeThreshold`, `autoReturnAfterWing`. Most: `combat`, `statsAddAuto`, `stopOnOverweight`, `stopOnNoIncome`,
`autoResumeAfterDeath`, `monsterRules`. Few: `townBuy`, `lootPriority`, `deathLimit`, `lureCount`, `restock`,
`macros`, `autoRepair`, `duel`, `lootFilter`, `stopAtLv`. Some shared configs carry only a subset (e.g. skills).

## Per-character load (captures, 8 characters, 20.8 character-hours)

| Per driven character | Rate |
|---|---|
| Fights (`found` → `kill`) | 62/h ≈ 0.017/s |
| Events streamed | 2.15/s |
| Player attacks | 760/h |

At 1,000 driven characters: ≈17 fight resolutions/s and ≈2,150 events/s out.

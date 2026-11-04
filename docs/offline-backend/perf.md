# Load test (#24): first local run

**Caveat: this is a laptop run, not the target box.** Apple M4 (10 cores), 24 GB, Node v22.23.4, macOS. The server
ran in its own process (one core), and the load generator (1,000 real brains + WebSocket clients) ran on the same
machine. The target is a 2 vCPU / 4 GB box with the load generator elsewhere. One M4 core is roughly 1.5–2× a cloud
vCPU (estimate, not measured), so read the CPU column as a lower bound. Clock ×1 (real time) for every run below.

```sh
node server/loadtest/run.mjs --scenario s1 --bots 100..1000 --minutes 2.5 --out docs/offline-backend/runs/load-s1.json
node server/loadtest/run.mjs --scenario s2 --bots 1000 --out docs/offline-backend/runs/load-s2.json
node server/loadtest/run.mjs --scenario s6 --bots 500 --minutes 2 --out docs/offline-backend/runs/load-s6.json
node server/loadtest/run.mjs --scenario s1 --bots 1000 --minutes 1.5 --checkpoint 3600   # checkpoint A/B
npm run smoke        # 100 bots, 2 min; exits 1 on INVARIANT, fight p99 > 50 ms, RTT p99 > 100 ms or no fights
```

## Bot population (server/loadtest/population.mjs, seed 1)

Each bot is `brain/brain.js` + `brain/client.js` (the same driver as the Beta tray) over a WebSocket, and REST for
commands. The characters come from [population.md](population.md):

- **Map:** player count for the top-10 maps; the long tail is weighted by the level-spread table.
- **Job:** config usage share (novice 25%, priest/dancer/bard ~9% each, …). Level-99 rebirths make up 2.2%.
- **Level:** fits the map's median monster level, within the job tier's window.
- **Stats:** allocated by job-family archetype with the RO raise cost.
- **Skills:** the job's skill tree in tree order, prerequisites first.
- **Gear:** the best weapon and armour the job can wear at its level, some refines, a few weapon cards. Items with
  bonuses `formulas.derive` does not support yet (`attackElement`, …) are excluded.
- **Brain config:** a real shared config of that job when the local capture has one (read at runtime from
  `<app support>/capture`, never written to the repo). For 1,000 bots this was 988 shared and 12 archetype configs.
- **Parties:** solo 49%, 2–4 32%, full 8 19% of characters, one account per party.

## S1 ramp: 100 → 250 → 500 → 1,000 driven characters, 2.5 min steady each (20 s warm-up excluded)

`WS B/s per char` is both directions. Server → client alone is 99% of it.

These runs counted WebSocket traffic as string length (UTF-16 code units). Chinese text, such as item names in
events, is 3 bytes per character in UTF-8, so the byte figures here are a lower bound. `run.mjs` now counts real
bytes (`Buffer.byteLength`).

| Bots | Fights | Fight p50 / p99 ms | Action RTT p50 / p99 ms | REST cmd p99 ms | Server CPU % (1 core) | RSS MB | RSS / char KB | Events/s | WS B/s per char | Checkpoint max ms (DB MB) | Tick p99 ms | INVARIANT |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 100 | 8,857 | 0.047 / 1.09 | 0.64 / 10.6 | 21.7 | 3.6 | 83 | 364 | 200 | 3,789 | 146 (16) | 14 | 0 |
| 250 | 19,437 | 0.036 / 1.11 | 0.98 / **72.5** | 154 | 6.4 | 95 | 196 | 445 | 3,506 | 981 (37) | 49 | 0 |
| 500 | 36,477 | 0.030 / 0.86 | 1.38 / **67.1** | 94 | 11.0 | 131 | 172 | 863 | 3,652 | 666 (77) | 36 | 0 |
| 1,000 | 68,362 | 0.028 / 1.25 | 2.62 / **755** | 630 | 20.6 | 187 | 143 | 1,662 | 3,776 | **2,389 (158)** | 143 | 0 |

- **Fight resolution:** p99 ≤ 1.3 ms at every step, against a target of < 50 ms. ✅
- **CPU:** 20.6% of one core at 1,000, against a target of < 50% of 2 vCPU. ✅ on this laptop. Even at 2× slower
  vCPUs it is about 20% of the box.
- **Memory:** RSS 187 MB at 1,000 (baseline 45 MB with 1,000 seeded characters and nobody driving), so about 143 KB
  per driven character. ✅
- **DB writes:** 0.033/s at every step. That is one whole-state row per 30 s; its size is in the checkpoint column.
- **Events:** 1.66 events/s per driven character, close to the captured 2.15/s (population.md).
- **Command round-trip:** ❌ above 250 bots. p99 is 72 ms at 250, 67 ms at 500 and 755 ms at 1,000, against a target
  of < 100 ms. The cause is the SQLite checkpoint (next section), not the rules.
- **INVARIANT errors:** zero.

### The tail: whole-state checkpoints

`openStore().save` writes one row: `JSON.stringify(game.dump())` of all characters, including each character's event
log (up to 10,000 events). That runs synchronously on the event loop every 30 s, so the dump grows as logs fill. In
this run it reached 158 MB, which took 2.4 s, and every WebSocket reply waited behind it (event-loop delay p99 was
1.9 s at 1,000).

A/B at 1,000 bots, fresh logs, 90 s:

| Checkpoint | Checkpoint max | Event-loop p99 | Action RTT p99 | REST cmd p99 | CPU % |
|---|---|---|---|---|---|
| every 30 s (63 MB) | 509 ms | 165 ms | 92 ms | 124 ms | 17.8 |
| off | — | 49 ms | **24.7 ms** ✅ | 29 ms ✅ | 16.2 |

**Fix (not done here; it is a server design change):**
- Persist per character, and only the characters that changed.
- Persist only a log tail (the summary and offline rates do not need 10,000 events).
- Or move the serialisation off the main thread.

The rest of the tail (tick p99 36–143 ms) is the 250 ms tick. Regen timers start in step, so at that moment every
character emits a full snapshot. Staggering them is another small fix.

## S2 login storm: 1,000 characters, 30% driven, 200 offline characters return within 10 s

Returning characters were away 1–24 h with no driven history. That is the cold case: rates come from engine
sampling, 30 simulated minutes of fights, cached per character, map and level. Each return is a plain GET of the view
(which settles the offline checkout) and then a brain connects.

| Phase | Bots | View p50 / p99 ms | Checkout p50 / p99 ms | Action RTT p99 ms | Errors | INVARIANT |
|---|---|---|---|---|---|---|
| 300 driven (before) | 300 | — | 0.003 / 0.023 | 16.4 | — | 0 |
| **storm: 200 returns in 9.96 s** | 500 | **3.6 / 333** | 0.015 / 5.5 | 55.0 | **0** | 0 |
| 500 driven (after) | 500 | — | 0.003 / 0.033 | 26.8 | — | 0 |

- No errors, and the checkout stays cheap: p99 5.5 ms, cold engine-sampled. ✅ The 24 h checkout target is p99 < 20 ms.
- The 333 ms view p99 is one checkpoint stall landing inside the storm. It is the same issue as S1.
- The `stillFrozen: 199` field in the raw JSON is a measurement artefact. The view is computed a millisecond after the
  checkout, so `backlogMs` is a few ms and `clockFrozen` reads true. The checkout did run: 670 checkouts in the window.

## S6 cheating bots: 500 bots (475 honest + 25 cheaters, 5%) + one account boxing 12 characters

The cheaters are raw WebSocket clients:
- **`speed`:** spams search/attack every 50 ms, ignoring ASPD.
- **`forge`:** attacks random encounter uids.

| Check | Result |
|---|---|
| Faster than ASPD | 30,240 attacks rejected `TOO_EARLY`; 1,538 accepted. The smallest gap between accepted swings is 0.986 × the attack interval, measured on the client. The 1.4% under is client receive jitter: the server checks against its own clock ✅ |
| Forged targets | 34,081 `NO_TARGET` + 126 `NOT_YOURS` (someone else's live encounter); 0 accepted ✅ |
| Too many characters | Account with 12 characters: 8 drive, 4 closed `4001 DRIVER_LIMIT` ✅. There is **no per-IP limit**, only per account (gap). |
| Others not slowed | Honest action RTT p99 26.8 ms, fight p99 0.42 ms, CPU 12.1%. S1 at 500 was 67 / 0.86 / 11.0 ✅ |
| INVARIANT | 0 |

## Projected hosting cost per 1,000 driven characters (from the S1 1,000 step)

| Resource | Measured | Per month |
|---|---|---|
| CPU | 20.6% of one M4 core | about 0.3–0.4 vCPU. A 2 vCPU box has room |
| RAM | 187 MB RSS | well inside 4 GB |
| WebSocket out (server → client) | 3.74 KB/s per character | 3.7 MB/s ≈ 30 Mbit/s ≈ **9.8 TB/month** |
| DB writes | 0.033 checkpoints/s × up to 158 MB. The dump grows with the event logs: 16 MB at the 100-bot step | up to 5.2 MB/s of disk writes (≈ 13.6 TB/month), until checkpoints are incremental |

Bandwidth decides the bill, not CPU. The server pushes the full ~3.6 KB snapshot to the driver on every state change
(about once a second while fighting).

Approximate 2026 list prices from memory, not checked today:

| Provider | Price per 1,000 characters |
|---|---|
| Hetzner CX22 (2 vCPU / 4 GB, 20 TB traffic included) | ≈ €5/month |
| DigitalOcean 2 vCPU / 4 GB ($24, 4 TB included, ≈ $0.01/GB over) | ≈ $85/month |
| AWS t3.medium (≈ $30) + 9.8 TB egress at ≈ $0.09/GB | ≈ $910/month |

Sending snapshot deltas, or only the fields the brain reads (HP/SP, buffs, target, inventory counts), should cut
traffic by about 10×. That would put every provider near the box price.

## Not run / gaps

- **Scenarios not run:**
  - S1 at 10 min steady per step: run at 2.5 min to cap machine time.
  - S3 (everyone driven).
  - S4 (A/B vs a server-side brain).
  - S5 (2 h soak).
  - The 24 h-away p99 with history-based rates: the S2 returns were 1–24 h away and cold.
- **Single machine:** the load generator shared the machine. It used 18.9% of one core at 1,000 bots.
- **Twin rates at 1,000 vs 100:** not compared. The L3 twin test fails for brain reasons first
  ([twin-report.md](twin-report.md)).
- **No breakdown by map, job or skill yet:** the raw JSON has per-action counts only.
- **Brain behaviour visible in the counts:**
  - Many `cast:TOO_EARLY`: the brain retries a cast before ASPD allows it.
  - Many `skip:ENGAGED`: aggressive mobs are on the bot before the skip.
  - About 40 potions/s per 1,000 characters (≈ 144 per character-hour): shared configs on bots whose gear is weaker than their authors'.

  These are brain and population effects, not server errors.

Raw runs:
- `docs/offline-backend/runs/load-s1.json`
- `docs/offline-backend/runs/load-s2.json`
- `docs/offline-backend/runs/load-s6.json`
- `docs/offline-backend/runs/load-1000-checkpoint30.json`
- `docs/offline-backend/runs/load-1000-checkpoint-off.json`

The raw files hold aggregates only. They contain no configs and no player data.

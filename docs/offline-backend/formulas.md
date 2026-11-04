# Formula evidence for the offline backend

Checked 2026-11-04 against the supplied local client bundle and eight local SSE capture streams. Run from the repository root:

```sh
python3 -I scripts/formula-check.py .scratch/capture .scratch/bundle.js
```

The checker uses only the Python standard library and never executes bundle JavaScript. It ignores every HTTP record, including authentication. Exit code gates only **adopted** formulas: 0 = all adopted formulas pass, 1 = an adopted formula failed, 2 = input/shape error. Rejected alternatives (`monster_angelus_alternative`, `monster_damage_candidate`, `monster_def2_softdef`, `monster_wiki_softdef*`, `refine_before_def_alternative`) print as `(informational)` and never fail the run. The adopted fitted damage envelopes (`player_damage_candidate`, `monster_def2_softdef_angelus`) print as `(fitted)` and fail only above a 2% / 1% miss rate, because their outliers are documented and unresolved (see JS module section). Every other adopted formula must have 0 MISS. Events after a >120 s silent gap in a stream drop that stream's replay state until its next snapshot, so stat changes missed during capture gaps are not replayed. Its internal parser/inventory assertions run first.

The strongest result is the derived-stat calculator: all 310 snapshots match for each reported field. Captures cover first-job characters at Base 47–50, with plain gear, a +7 Lv1 dagger, party buffs, and an eight-character party. A snapshot check validates the displayed amount, not the scheduler or every unexercised branch. The bundle contains 330 skill definitions, **231 effect handlers (69 with ratio functions), 97 buff functions**, 41 job records, 1,440 items and 429 monsters. All effect/buff definitions are inventoried verbatim below; a handler type such as `turnUndead` delegates to server code that is absent from the client.

Event replay is sorted by **simulation time**, then sequence within each character stream, interleaving snapshots at their simulation time. Arrival/sequence order alone produces false formula failures: some SSE batches contain earlier simulation events after later buff expirations. Replayed sequence IDs are deduplicated within each capture file. 15,875 events precede a usable snapshot and are ineligible for state-dependent checks. For target-dependent damage, any monster UID with a captured `statusStart` is conservatively excluded for its whole lifetime; this does not guarantee that every hidden monster modifier was observed. No names, auth payloads or account identifiers are included in this report.

The fitted physical order is: **roll weapon ATK → apply weapon size (not to stat ATK) → add stat/flat ATK → hard DEF percentage, floor → subtract randomized monster VIT defense → add refine ATK → element, floor → minimum damage → hit count**. In the captured no-card/no-mastery case this contains 5,238 hits and misses five, all against monster 1104. For example, thief status ATK33 + floor(17×75%)=45; floor(45×90%)−28+14 refine=26, or 52 for a double hit. Putting refine before hard DEF predicts25 and fails. Bow arrow ATK uses a 0..24 candidate range for ordinary arrows (ATK25); the observed Beetle and Snake ranges reach the fitted envelope endpoints. Envelopes demonstrate compatibility, not the random distribution, inclusive endpoints in every branch, or equality of every possible output. Cards and mastery are not exercised: a provisional extension can add eligible mastery/bane before element and multiply card groups afterward, following rust-ro's structure, but their exact placement is **unverified**.

The magic-bolt fit needs monster soft MDEF **INT+floor(VIT/2)**, after hard MDEF and before element. All 159 eligible Lightning Bolt hits fall inside that envelope. Monster physical damage is less settled: the ordinary pre-renewal soft-defense baseline fits269 and misses8; multiplying the entire soft value by Angelus fits215 and misses62. That comparison rejects this naive Angelus placement, not Angelus itself.

Read-only external structure references: [rAthena battle.cpp](https://github.com/rathena/rathena/blob/d4b8e7b8f16061cc2496d377ac8f777ce72a4f39/src/map/battle.cpp) (`battle_calc_base_damage`, `battle_calc_defense_reduction`, card/element stages), [rAthena status.cpp](https://github.com/rathena/rathena/blob/d4b8e7b8f16061cc2496d377ac8f777ce72a4f39/src/map/status.cpp) (pre-renewal MATK/ATK/ASPD structure), and [rust-ro battle_service.rs](https://github.com/nmeylan/rust-ro/blob/14193fcd2a285a9690cf28c923d9af56fe9587a5/server/src/server/service/battle_service.rs) (`physical_damage_character_attack_monster`, `weapon_atk`, `mob_vitdef`, `player_vitdef`). rAthena is GPL-3.0; no source code was copied. rust-ro is MIT, copyright its contributors; consulted for structure/formulas, with no code adapted. Neither emulator overrides captured ro-idle behavior.

Bundle SHA-256: `78788be29e9266d0dcea9558a5e41697f5c10f973fa06c1c3e313a9bbf99cef6`. Minified selectors (`hd`, `Oe`, `Pe`, `of`, `cf`) refer to this build. Exact large static arrays are preserved in that input rather than duplicated as thousands of integers here. To inspect them without evaluating JavaScript:

```python
import runpy
from pathlib import Path
checker = runpy.run_path("scripts/formula-check.py")
data = checker["static_data"](Path(".scratch/bundle.js").read_text())
# e.g. data["jobs"][0]["baseHp"], data["jobs"][0]["baseExpTable"]
```

OK/MISS are individual observations unless the row explicitly says rough drop checks. SKIP is excluded evidence, never a success. An unverified row means the bundle supplies the rule/table but captures cannot independently establish it. Source definitions below use minified parameter names: `e` is commonly skill level, while additional parameters and delegated handler types depend on the caller; do not assume their meanings without tracing the handler. JavaScript floors/truncations and integer table units must be preserved.

| Formula / table | Source | Verified OK / MISS | Notes / exact bundle definition |
| --- | --- | --- | --- |
| <code>aspd</code>: motion₀=base−floor(base×(4×AGI+DEX)/1000); motion=max(100,floor(motion₀×speedFactor/1000)−10×aspdAdd); ASPD=(2000−motion)/10 | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | speedFactor=1000−10×aspdRate+10×ridingPenalty−bookBonus; ridingPenalty=50−10×CavalierMastery; bookBonus=5×AdvancedBook. Dual weapons base=floor((rightBase+leftBase)×0.7). Only single-weapon/no-riding path tested. |
| <code>attackIntervalMs</code>: 2×motion | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP |  |
| <code>baseExpNext</code>: job.baseExpTable[baseLv−1] | Bundle jobs[] | 310 OK / 0 MISS; 0 SKIP | Lookup, not a fitted polynomial. |
| <code>castMs_DEX</code>: floor(baseCastMs×max(0,150−totalDEX)/150) | Mechanics fw(), skill tables | 1006 OK / 0 MISS; 0 SKIP | Replay active buffs by simulation time. General later stages: equipment cast rate → slowcast → Suffragium, floor each; unexercised. |
| <code>crit</code>: (1 + floor(0.3×LUK) + bonus + bow-only long crit) × (katar ? 2 : 1) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Captured weapons do not exercise katar/long-crit bonuses. |
| <code>drops_4sigma</code>: expected=killCount×Σ(slotRate/10000), variance=killCount×Σ(p×(1−p)); compare ±4σ | Bundle drops/cards; rough fitted check | 17 OK / 0 MISS; 27 SKIP | Aggregate duplicate item slots before comparing! 27 monster/item pairs have expectation <5 and are skipped. Pickup/loot settings, boundary events and party allocation prevent interpreting this as an exact drop-rate proof. |
| <code>element_table</code>: element[level−1][attackElement][defenseElement] | Bundle of[]/sf() | 5639 OK / 0 MISS; 928 SKIP | Only observed combinations verified; any UID with a captured target status is conservatively excluded. |
| <code>event_without_snapshot</code>: events older than the first usable snapshot | Capture eligibility | 0 OK / 0 MISS; 15875 SKIP | Skipped for state-dependent checks; EXP/drop aggregation can still use them. |
| <code>flee</code>: Lv + AGI + equipment FLEE + 3×ImproveDodge + floor(3×Dodge/2) + (Backsliding learned ? 10 : 0) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Berserk halves, blind subtracts floor(value/4), spiderweb subtracts floor(value/2), sequentially; status paths unverified. |
| <code>hardDef</code>: min(99, floor((ΣequipmentDEF+bonusDEF+floor((ΣrefineHundredths+50)/100))×max(0,100+DEF%)/100)) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Armor refine contributes 70 hundredths/level. Stone/freeze halve; SteelBody=90; Berserk=0, unverified. |
| <code>hardMdef</code>: min(99, equipment/buff MDEF) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Stone/freeze add floor(MDEF×25/100); SteelBody=90; Berserk=0, unverified. |
| <code>hit</code>: Lv + DEX + equipment HIT + Vulture + 2×WeaponResearch | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Blind subtracts floor(HIT/4); blind path unverified. |
| <code>hpRegen</code>: floor(floor((1+floor(VIT/5)+floor(maxHP/200))×(MovingRecovery?150:100)/100)×(100+hpRecovRate)/100) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | TensionRelax multiplies by 3 (not exercised); amount verified, scheduling not verified. |
| <code>interval_from_aspd</code>: (200−ASPD)×20 | Mechanics | 310 OK / 0 MISS; 0 SKIP | Independent cross-field check; max ASPD 190. |
| <code>jobExpNext</code>: job.jobExpTable[jobLv−1] | Bundle jobs[] | 310 OK / 0 MISS; 0 SKIP | Lookup, not a fitted polynomial. |
| <code>magic_bolt_damage</code>: max(1,floor((floor(MATKroll×(100−monsterMDEF)/100)−monsterINT−floor(monsterVIT/2))×element/100))×hits | Fitted; bundle ratio=100 | 159 OK / 0 MISS; 44 SKIP | All eligible hits are Lightning Bolt. Envelope inclusion does not establish RNG distribution or per-hit versus shared rolls. |
| <code>magic_bolt_hits</code>: hits=skill level | Bundle MG_LIGHTNINGBOLT / skills[] | 159 OK / 0 MISS; 0 SKIP | Observed Lightning Bolt only. |
| <code>matkMax</code>: floor((INT + floor(INT/5)²)×(100+MATK%)/100) + flat MATK; then +floor(value×MagicPower%/100) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP |  |
| <code>matkMin</code>: floor((INT + floor(INT/7)²)×(100+MATK%)/100) + flat MATK; then +floor(value×MagicPower%/100) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP |  |
| <code>maxHp</code>: max(1, floor((floor(jobHP[Lv−1]×(100+VIT)/100)+flatHP)×(100+HP%)/100)) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Job HP array clamps to its last entry; reborn base first ×1.25, floored (reborn unverified). |
| <code>maxSp</code>: same nested floors as HP, with jobSP and INT | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | SoulDrain adds 2% SP/level; Meditatio adds 1%/level; those passives unverified. |
| <code>monster_def2_softdef_angelus</code>: def2=floor(VIT×(100+5×AngelusLv)/100); playerSoftDEF=floor(def2/2)+uniformInt(0,max(0,floor(def2×(def2−15)/150)−1)); damage=max(1,floor(monsterAtkRoll×(100−hardDEF)/100)−playerSoftDEF) | rAthena pre-renewal structure (read only); fitted | 839 OK / 4 MISS (2026-11-04 full capture) | **Best fit; supersedes monster_damage_candidate** (828/15 on same data). Envelopes only 1.4 wider on average. All 4 misses: VIT63, Angelus Lv10, observed 1 above max: floor order of the Angelus step unresolved. Without Angelus scaling: 539/304. iRO Wiki Classic DEF page (deterministic max(), Angelus × whole soft DEF) fits worse: 743/100, with Angelus 663/180. |
| <code>monster_angelus_alternative</code>: multiply complete playerSoftDEF by (100+5×AngelusLv)/100, floor | Rejected fitted alternative | 215 OK / 62 MISS; 0 SKIP | Same eligible samples as monster baseline. Worse fit; do not ship this as established behavior. |
| <code>monster_damage_candidate</code>: max(1, floor(monsterAtkRoll×(100−playerHardDEF)/100)−playerSoftDEF) | Fitted baseline; rAthena/rust-ro structure | 269 OK / 8 MISS; 34 SKIP | playerSoftDEF=floor(VIT/2)+floor(0.3×VIT)+uniformInt(0,max(0,floor(VIT²/150)−floor(0.3×VIT)−1)). Omits Angelus; eight misses mean this is not established as complete. |
| <code>party_exp_base</code>: floor(monsterBaseExp×2/8) | Mechanics + fitted | 4784 OK / 0 MISS; 112 SKIP | Only unambiguous same-wallMs groups with one kill and eight distinct EXP recipients; 112 EXP records skipped at ambiguous/boundary groups. |
| <code>party_exp_job</code>: floor(monsterJobExp×2/8) | Mechanics + fitted | 4784 OK / 0 MISS; 112 SKIP | Bonus reaches +100% with eight members; rate=1 in capture. Other party sizes/share modes not verified. |
| <code>perfectDodge</code>: 1 + floor(LUK/10) + bonus | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP |  |
| <code>player_damage_candidate</code>: max(1, floor((floor((statATK+floor(weaponRoll×size/100)+flatATK)×(100−hardDEF)/100)−monsterSoftDEF+refineATK)×element/100))×hits | Fitted; rust-ro structure; bundle tables | 5238 OK / 5 MISS; 852 SKIP | 5238 envelope matches, five unresolved higher hits against Coco (1104). No attack cards or mastery bonuses equipped. See fitted order and per-group envelopes below. |
| <code>refineAtk</code>: floor(refine.weapon[weaponLevel][refine−1].bonus/100) | Bundle qu()/hd() | 310 OK / 0 MISS; 0 SKIP | Zero when unrefined; only Lv1 +7 among captured refined weapons. |
| <code>refine_before_def_alternative</code>: put refineATK inside the hard-DEF multiplication instead | Rejected fitted alternative | 422 OK / 877 MISS; 0 SKIP | Only refined-weapon hits; unlike the chosen order, this misses 877 observations. |
| <code>skill_delayMs</code>: skill.delayMs[min(level,array.length)−1], empty→0 | Bundle skills[] | 1006 OK / 0 MISS; 0 SKIP | Independent of DEX. Verified raw delay fields, not subsequent scheduling. |
| <code>softMdef</code>: total INT | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Player panel input; monster soft MDEF uses INT+floor(VIT/2) in fitted bolt path. |
| <code>spRegen</code>: floor(floor((1+floor(INT/6)+floor(maxSP/100))×(100+spRecovRate)/100)×(100+3×Meditatio)/100) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Amount verified; Magnificat doubles natural tick externally, unverified. |
| <code>statusAtk</code>: main + floor(main/10)² + floor(sub/5) + floor(LUK/5) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | DEX main for bow/instrument/whip; STR main otherwise. |
| <code>total_stats</code>: base stats + current job-level bonuses + equipped stats + active buffs + Owl DEX | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Rebuilt independently from character/job/equipment/buff inputs; does not reuse derived.total. |
| <code>vitDef</code>: total VIT | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | This is the raw input to combat soft defense, not flat damage reduction. |
| <code>weightMax</code>: jobWeight + 30×total STR + 200×IncreaseCarry + riding×1000 + 200×min(10,gymPass) | Bundle hd()/mechanics | 310 OK / 0 MISS; 0 SKIP | Total STR, including buffs. Riding/gym not exercised. |
| Hit probability: <code>clamp(5,95,(80+attackerHIT−targetFLEE) with relative HIT modifiers)</code> | Mechanics | unverified | Unverified probability distribution; snapshot HIT checks are separate. |
| Crit probability: <code>panelCrit−0.2×targetLUK; skill modifiers/exceptions</code> | Mechanics | unverified | Unverified probability distribution; katar doubles panel crit. No general 1.4× crit rule established. |
| Natural regen schedule: <code>HP every 6000ms; SP every 8000ms; sitting halves intervals</code> | Mechanics rd/id | unverified | No regen events in capture; combat HP/SP changes confound snapshot deltas. Death/poison/weight≥50% block; SlowPoison exemption. |
| Skill/sitting regen: <code>SM_RECOVERY: 5L+floor(L×maxHP/500); MG_SRECOVERY: 3L+floor(L×maxSP/500); MO_SPIRITSRECOVERY sitting: HP 4L+floor(L×maxHP/500), SP 2L+floor(L×maxSP/500)</code> | Bundle hd() | unverified | Independent 10-second skill regen; no direct tick evidence. |
| Potion: <code>fixed HP base random range ×(100+2×VIT)/100; SP uses INT; then recovery modifiers and max cap</code> | Mechanics, items[].effect | unverified | No useItem events; potion scaling/rounding and shared 600ms cooldown unverified. Percentage effects have separate rules. |
| Derived passive modifiers | Bundle hd()/cd() | unverified outside sampled base paths | Trust adds 200 HP/level and holy resistance 5%/level; HiltBinding adds 1 STR and 4 flat ATK; Dragonology adds floor((L+1)/2) INT, 4L physical dragon%, 2L magic dragon%, 4L dragon resistance%; ManaRecharge changes SP use by −4L%; ASC_KATAR adds (10+2L)% katar damage. Provoke: L10 has +0 ATK% / −100 softDEF%; otherwise +(2+3L) ATK% / −(5+5L) softDEF%. AutoBerserk at HP≤floor(maxHP/4) adds32 ATK% and −55 VIT-defense%. Poison/deadly poison scale VIT-defense by75%; combine provoke with a floor. |
| Stat cost: <code>floor((currentStat−1)/10)+2; cap99; initial48 points</code> | Mechanics pd()/gd() | unverified | Two statUp events omit points spent; cannot verify costs. |
| Level point grants: <code>base Lv L→L+1 gives floor(L/5)+3; job level gives1 skill point</code> | Mechanics | unverified | One baseLevelUp, no paired before/after point balance independent of auto-allocation. |
| Death: <code>min(currentBaseExp,floor(baseExpNext×0.01)); non-novice; no job penalty or delevel; respawn after5000ms with50% HP/SP ordinarily</code> | Mechanics | unverified | No deaths in current event capture; floor is candidate rounding, not specified by page text. |
| Party general: <code>bonus=1+min(1,0.2×(eligibleMembers−1)); even share divides by eligible count; max base-level gap15; max party12</code> | Mechanics party UI | unverified | Eight-member even-share case checked above; caps, eligibility changes, each/damage share, remainder allocation and random loot unverified. |
| Card groups: <code>same-group bonuses add; different race/element/size/monster/boss/range groups multiply with floors</code> | Mechanics / item bonuses | unverified | No equipped cards in capture; exact ordering relative to element/refine/DEF remains unknown. |
| Masteries: <code>sword/dagger4L; twohand4L; spear4L (riding5L); katar3L; axe3L; mace3L; fist/knuckle3L; book/instrument/whip3L</code> | Bundle dd() | unverified | No active captured weapon mastery; targets/weapon-hand eligibility matters. |
| Banes/research/dual: <code>Demonbane=floor(L×(baseLv/20+3)); Beastbane=4L; WeaponResearch damage=2L; katar offhand=(1+2×TF_DOUBLE)% of primary hit; dagger double attack chance5×TF_DOUBLE</code> | Bundle hd()/mechanics | unverified | Double-hit damage scaling covered by damage envelopes; trigger probabilities/dual-hand reduction not verified. |
| Forging stars: <code>stars≥3→40 ATK, otherwise5×stars</code> | Bundle fd() | unverified | No forged weapons captured. |
| Refine smith bonus: <code>clamp(0,100,baseChance+trunc((jobLv−50)/2))</code> | Bundle Wu() | unverified | No refine attempts; success probabilities, break/destruction and overrefine RNG unverified. |
| Move speed: <code>150ms base; trunc(base×max(40,100−riding25+slow−haste)/100), clamp20..1000; cart and SteelBody/Defender special cases</code> | Bundle nd() | unverified | Encounter approach abstracts distance; no coordinate simulation. Full slow/haste priority and approach scheduling unverified. |
| Physical weapon variance: <code>minRoll=min(weaponATK,floor(DEX×(80+20×weaponLv)/100)); normal inclusive integer min..weaponATK; bow min=floor(minRoll×weaponATK/100), arrow0..arrowATK−1</code> | Fitted, rAthena/rust-ro structure | unverified | Envelope bounds support this; RNG support/distribution not proved, especially small-sample extrema. Critical uses weapon maximum in tested axe cases. |
| Monster soft DEF: <code>VIT+uniformInt(0,max(0,floor(VIT/20)²−1))</code> | rAthena/rust-ro; fitted | unverified | Used in primary physical envelope; statuses and Coco outliers unresolved. |
| Combat pacing: <code>after skill completion next attack waits max(skill delay,normal attack interval); separate cooldown</code> | Mechanics | unverified | Field values checked; scheduler timings not inferred from wall time. |
| Refine/repair/produce/arrow recipes: <code>Static refineServices, repairServices, produce and arrows arrays</code> | Bundle static data | unverified | 81 produce recipes and 114 arrow source recipes; crafting success formulas not verified. |
| Homunculus growth: <code>homunculi[].base/growth/skills and homunExp[]</code> | Bundle static data | unverified | 4 types; 98 EXP entries; no homunculus traffic. |
| Skill timings/costs/requirements: <code>skills[].sp/hp/zeny/ammo/castMs/delayMs/cooldownMs/hits/durationMs/duration2Ms/weapons/requires</code> | Bundle static data | unverified | 330 definitions; level arrays use last available value for higher levels, empty time arrays→0. Only cast/delay/bolt hits sampled above. |
| Item/combo conditional formulas: <code>items[].bonuses/byRefine/cond/scaled; itemCombos[].bonuses; expression evaluator $u()/ed()/td()</code> | Bundle static data and evaluator | unverified | 44 combos; integer division truncates toward zero; conditions include job/weapon/equipped/refine/base/job/skill/stat. No active captured combos or conditional effects. |
| Refine weapon Lv1 | Bundle refine.weapon Lv1 | unverified | Levels1..10: chance%=<code>[100, 100, 100, 100, 100, 100, 100, 60, 40, 20]</code>; cumulative bonus hundredths=<code>[200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000]</code>; randomBonus hundredths=<code>[0, 0, 0, 0, 0, 0, 0, 300, 600, 900]</code>. Material 1010, 50 zeny/attempt; breaks beyond safe levels. |
| Refine weapon Lv2 | Bundle refine.weapon Lv2 | unverified | Levels1..10: chance%=<code>[100, 100, 100, 100, 100, 100, 60, 40, 20, 20]</code>; cumulative bonus hundredths=<code>[300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000]</code>; randomBonus hundredths=<code>[0, 0, 0, 0, 0, 0, 500, 1000, 1500, 2000]</code>. Material 1011, 200 zeny/attempt; breaks beyond safe levels. |
| Refine weapon Lv3 | Bundle refine.weapon Lv3 | unverified | Levels1..10: chance%=<code>[100, 100, 100, 100, 100, 60, 50, 20, 20, 20]</code>; cumulative bonus hundredths=<code>[500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000]</code>; randomBonus hundredths=<code>[0, 0, 0, 0, 0, 800, 1600, 2400, 3200, 4000]</code>. Material 984, 5000 zeny/attempt; breaks beyond safe levels. |
| Refine weapon Lv4 | Bundle refine.weapon Lv4 | unverified | Levels1..10: chance%=<code>[100, 100, 100, 100, 60, 40, 40, 20, 20, 10]</code>; cumulative bonus hundredths=<code>[700, 1400, 2100, 2800, 3500, 4200, 4900, 5600, 6300, 7000]</code>; randomBonus hundredths=<code>[0, 0, 0, 0, 1300, 2600, 3900, 5200, 6500, 7800]</code>. Material 984, 20000 zeny/attempt; breaks beyond safe levels. |
| Refine armor | Bundle refine.armor | unverified | Levels1..10: chance%=<code>[100, 100, 100, 100, 60, 40, 40, 20, 20, 10]</code>; cumulative bonus hundredths=<code>[70, 140, 210, 280, 350, 420, 490, 560, 630, 700]</code>; randomBonus hundredths=<code>[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]</code>. Material 985, 2000 zeny/attempt; breaks beyond safe levels. |
| Job tables <code>acolyte</code> | Bundle jobs[id=acolyte] | sampled via aggregate checks above | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 600, &#x27;2hMace&#x27;: 600, &#x27;staff&#x27;: 600, &#x27;2hStaff&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>acolyte_high</code> | Bundle jobs[id=acolyte_high] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 600, &#x27;2hMace&#x27;: 600, &#x27;staff&#x27;: 600, &#x27;2hStaff&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>alchemist</code> | Bundle jobs[id=alchemist] | unverified | baseWeight=3000; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;1hSword&#x27;: 575, &#x27;1hAxe&#x27;: 675, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>archer</code> | Bundle jobs[id=archer] | sampled via aggregate checks above | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;bow&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>archer_high</code> | Bundle jobs[id=archer_high] | unverified | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;bow&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>assassin</code> | Bundle jobs[id=assassin] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 800, &#x27;katar&#x27;: 500}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>assassin_cross</code> | Bundle jobs[id=assassin_cross] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 800, &#x27;katar&#x27;: 500}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>bard</code> | Bundle jobs[id=bard] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;bow&#x27;: 650, &#x27;instrument&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>blacksmith</code> | Bundle jobs[id=blacksmith] | unverified | baseWeight=3000; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 650, &#x27;2hAxe&#x27;: 650, &#x27;mace&#x27;: 675, &#x27;2hMace&#x27;: 675}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>champion</code> | Bundle jobs[id=champion] | unverified | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 575, &#x27;2hMace&#x27;: 575, &#x27;staff&#x27;: 575, &#x27;knuckle&#x27;: 475, &#x27;2hStaff&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>clown</code> | Bundle jobs[id=clown] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;bow&#x27;: 650, &#x27;instrument&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>creator</code> | Bundle jobs[id=creator] | unverified | baseWeight=3000; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;1hSword&#x27;: 575, &#x27;1hAxe&#x27;: 675, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>crusader</code> | Bundle jobs[id=crusader] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 500, &#x27;2hSword&#x27;: 550, &#x27;1hSpear&#x27;: 600, &#x27;2hSpear&#x27;: 600, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>dancer</code> | Bundle jobs[id=dancer] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;bow&#x27;: 650, &#x27;whip&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>gypsy</code> | Bundle jobs[id=gypsy] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 550, &#x27;bow&#x27;: 650, &#x27;whip&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>high_priest</code> | Bundle jobs[id=high_priest] | unverified | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 600, &#x27;2hMace&#x27;: 600, &#x27;staff&#x27;: 600, &#x27;book&#x27;: 600, &#x27;2hStaff&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>high_wizard</code> | Bundle jobs[id=high_wizard] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 575, &#x27;staff&#x27;: 625, &#x27;2hStaff&#x27;: 625}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>hunter</code> | Bundle jobs[id=hunter] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;bow&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>knight</code> | Bundle jobs[id=knight] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 500, &#x27;2hSword&#x27;: 550, &#x27;1hSpear&#x27;: 600, &#x27;2hSpear&#x27;: 600, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>lord_knight</code> | Bundle jobs[id=lord_knight] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 500, &#x27;2hSword&#x27;: 550, &#x27;1hSpear&#x27;: 600, &#x27;2hSpear&#x27;: 600, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>mage</code> | Bundle jobs[id=mage] | sampled via aggregate checks above | baseWeight=2200; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 600, &#x27;staff&#x27;: 700, &#x27;2hStaff&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>mage_high</code> | Bundle jobs[id=mage_high] | unverified | baseWeight=2200; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 600, &#x27;staff&#x27;: 700, &#x27;2hStaff&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>merchant</code> | Bundle jobs[id=merchant] | sampled via aggregate checks above | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;1hSword&#x27;: 700, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 750, &#x27;mace&#x27;: 700, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>merchant_high</code> | Bundle jobs[id=merchant_high] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;1hSword&#x27;: 700, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 750, &#x27;mace&#x27;: 700, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>monk</code> | Bundle jobs[id=monk] | unverified | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 575, &#x27;2hMace&#x27;: 575, &#x27;staff&#x27;: 575, &#x27;knuckle&#x27;: 475, &#x27;2hStaff&#x27;: 575}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>novice</code> | Bundle jobs[id=novice] | unverified | baseWeight=2000; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 650, &#x27;1hSword&#x27;: 700, &#x27;1hAxe&#x27;: 800, &#x27;mace&#x27;: 700, &#x27;2hMace&#x27;: 700, &#x27;staff&#x27;: 650, &#x27;2hStaff&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[9]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>novice_high</code> | Bundle jobs[id=novice_high] | unverified | baseWeight=2000; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 650, &#x27;1hSword&#x27;: 700, &#x27;1hAxe&#x27;: 800, &#x27;mace&#x27;: 700, &#x27;2hMace&#x27;: 700, &#x27;staff&#x27;: 650, &#x27;2hStaff&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[9]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>paladin</code> | Bundle jobs[id=paladin] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 500, &#x27;2hSword&#x27;: 550, &#x27;1hSpear&#x27;: 600, &#x27;2hSpear&#x27;: 600, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 700, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>priest</code> | Bundle jobs[id=priest] | unverified | baseWeight=2600; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;mace&#x27;: 600, &#x27;2hMace&#x27;: 600, &#x27;staff&#x27;: 600, &#x27;book&#x27;: 600, &#x27;2hStaff&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>professor</code> | Bundle jobs[id=professor] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 450, &#x27;dagger&#x27;: 525, &#x27;staff&#x27;: 625, &#x27;book&#x27;: 550, &#x27;2hStaff&#x27;: 625}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>rogue</code> | Bundle jobs[id=rogue] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 550, &#x27;bow&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>sage</code> | Bundle jobs[id=sage] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 450, &#x27;dagger&#x27;: 525, &#x27;staff&#x27;: 625, &#x27;book&#x27;: 550, &#x27;2hStaff&#x27;: 625}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>sniper</code> | Bundle jobs[id=sniper] | unverified | baseWeight=2700; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;bow&#x27;: 600}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>stalker</code> | Bundle jobs[id=stalker] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 550, &#x27;bow&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>supernovice</code> | Bundle jobs[id=supernovice] | unverified | baseWeight=2000; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 650, &#x27;1hSword&#x27;: 700, &#x27;1hAxe&#x27;: 800, &#x27;mace&#x27;: 700, &#x27;2hMace&#x27;: 700, &#x27;staff&#x27;: 650, &#x27;2hStaff&#x27;: 650}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[98]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>swordman</code> | Bundle jobs[id=swordman] | sampled via aggregate checks above | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 550, &#x27;2hSword&#x27;: 600, &#x27;1hSpear&#x27;: 650, &#x27;2hSpear&#x27;: 700, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 750, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>swordman_high</code> | Bundle jobs[id=swordman_high] | unverified | baseWeight=2800; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 550, &#x27;2hSword&#x27;: 600, &#x27;1hSpear&#x27;: 650, &#x27;2hSpear&#x27;: 700, &#x27;1hAxe&#x27;: 700, &#x27;2hAxe&#x27;: 750, &#x27;mace&#x27;: 650, &#x27;2hMace&#x27;: 700}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>thief</code> | Bundle jobs[id=thief] | sampled via aggregate checks above | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 800, &#x27;bow&#x27;: 800}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>thief_high</code> | Bundle jobs[id=thief_high] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 500, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 800, &#x27;bow&#x27;: 800}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>whitesmith</code> | Bundle jobs[id=whitesmith] | unverified | baseWeight=3000; baseAspd=<code>{&#x27;fist&#x27;: 400, &#x27;dagger&#x27;: 600, &#x27;1hSword&#x27;: 650, &#x27;1hAxe&#x27;: 650, &#x27;2hAxe&#x27;: 650, &#x27;mace&#x27;: 675, &#x27;2hMace&#x27;: 675}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[69]; jobBonus[] also present. Exact values readable through static_data(). |
| Job tables <code>wizard</code> | Bundle jobs[id=wizard] | unverified | baseWeight=2400; baseAspd=<code>{&#x27;fist&#x27;: 500, &#x27;dagger&#x27;: 575, &#x27;staff&#x27;: 625, &#x27;2hStaff&#x27;: 625}</code>; arrays baseHp[99], baseSp[99], baseExpTable[98], jobExpTable[49]; jobBonus[] also present. Exact values readable through static_data(). |
| Element Lv1, attack neutral | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, 100, 100, 25, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack water | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 25, 100, 150, 50, 100, 75, 100, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack earth | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 50, 150, 100, 75, 100, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack fire | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 50, 150, 25, 100, 100, 75, 100, 100, 125]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack wind | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 175, 50, 100, 25, 100, 75, 100, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack poison | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 125, 125, 125, 0, 75, 50, 100, -25]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack holy | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, 0, 125, 100, 150]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack dark | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 50, 125, 0, 100, -25]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack ghost | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[25, 100, 100, 100, 100, 100, 75, 75, 125, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv1, attack undead | Bundle of[0] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 50, 100, 0, 100, 0]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack neutral | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, 100, 100, 25, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack water | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 0, 100, 175, 25, 100, 50, 75, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack earth | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 100, 50, 25, 175, 100, 50, 75, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack fire | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 25, 175, 0, 100, 100, 50, 75, 100, 150]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack wind | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 175, 25, 100, 0, 100, 50, 75, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack poison | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 75, 125, 125, 125, 0, 50, 25, 75, -50]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack holy | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, -25, 150, 100, 175]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack dark | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 25, 150, -25, 100, -50]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack ghost | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[0, 75, 75, 75, 75, 75, 50, 50, 150, 125]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv2, attack undead | Bundle of[1] / sf() | sampled via element_table aggregate | <code>[100, 75, 75, 75, 75, 25, 125, 0, 100, 0]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack neutral | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, 100, 100, 0, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack water | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, -25, 100, 200, 0, 100, 25, 50, 100, 125]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack earth | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 100, 0, 0, 200, 100, 25, 50, 100, 75]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack fire | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 0, 200, -25, 100, 100, 25, 50, 100, 175]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack wind | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 200, 0, 100, -25, 100, 25, 50, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack poison | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 50, 100, 100, 100, 0, 25, 0, 50, -75]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack holy | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 125, -50, 175, 100, 200]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack dark | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 0, 175, -50, 100, -75]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack ghost | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[0, 50, 50, 50, 50, 50, 25, 25, 175, 150]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv3, attack undead | Bundle of[2] / sf() | sampled via element_table aggregate | <code>[100, 50, 50, 50, 50, 0, 150, 0, 100, 0]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack neutral | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 100, 100, 100, 100, 100, 100, 100, 0, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack water | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, -50, 100, 200, 0, 75, 0, 25, 100, 150]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack earth | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 100, -25, 0, 200, 75, 0, 25, 100, 50]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack fire | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 0, 200, -50, 100, 75, 0, 25, 100, 200]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack wind | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 200, 0, 100, -50, 75, 0, 25, 100, 100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack poison | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 25, 75, 75, 75, 0, 0, -25, 25, -100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack holy | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 75, 75, 75, 75, 125, -100, 200, 100, 200]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack dark | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 75, 75, 75, 75, -25, 200, -100, 100, -100]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack ghost | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[0, 25, 25, 25, 25, 25, 0, 0, 200, 175]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Element Lv4, attack undead | Bundle of[3] / sf() | sampled via element_table aggregate | <code>[100, 25, 25, 25, 25, -25, 175, 0, 100, 0]</code>; defense columns: neutral, water, earth, fire, wind, poison, holy, dark, ghost, undead. Negative multipliers exist; healing/clamping behavior unverified. |
| Size <code>fist</code> | Bundle cf[] | sampled via damage envelopes | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>dagger</code> | Bundle cf[] | sampled via damage envelopes | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 50}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>1hSword</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 75}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>2hSword</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>1hSpear</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>2hSpear</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>1hAxe</code> | Bundle cf[] | sampled via damage envelopes | <code>{&#x27;small&#x27;: 50, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>2hAxe</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 50, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>mace</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>2hMace</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>staff</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>2hStaff</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 100}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>bow</code> | Bundle cf[] | sampled via damage envelopes | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 75}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>knuckle</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 75, &#x27;large&#x27;: 50}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>instrument</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 75}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>whip</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 50}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>book</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 100, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 50}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Size <code>katar</code> | Bundle cf[] | unverified | <code>{&#x27;small&#x27;: 75, &#x27;medium&#x27;: 100, &#x27;large&#x27;: 75}</code>; noSizePenalty/WeaponPerfection bypass and mounted spear medium→large multiplier unverified. |
| Skill effect <code>LK_AURABLADE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>LK_PARRYING</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>LK_CONCENTRATION</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>LK_TENSIONRELAX</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>WS_CARTBOOST</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>LK_BERSERK</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>HP_BASILICA</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PA_GOSPEL</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>LK_SPIRALPIERCE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;100,def:`ignore`,ranged:!0}</code> |
| Skill effect <code>LK_HEADCRUSH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+40*e,status:{id:`bleeding`,rate:(e,t,n)=&gt;n.element===`undead`&#124;&#124;n.race===`undead`&#124;&#124;n.race===`demon`?0:50,duration:`d2`}}</code> |
| Skill effect <code>LK_JOINTBEAT</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;50+10*e}</code> |
| Skill effect <code>PA_PRESSURE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,castAtRange:!0,ratio:()=&gt;100,ignoreFlee:!0,def:`ignore`,noCards:!0}</code> |
| Skill effect <code>PA_SACRIFICE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_FLAMELAUNCHER</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_FROSTWEAPON</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_LIGHTNINGLOADER</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_SEISMICWEAPON</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_AUTOGUARD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_SHIELDCHARGE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+20*e,status:{id:`stun`,rate:e=&gt;15+5*e,duration:`d2`},knockback:e=&gt;4+e}</code> |
| Skill effect <code>CR_SHIELDBOOMERANG</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+30*e,shieldBase:!0,ranged:!0}</code> |
| Skill effect <code>HW_GRAVITATION</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;100,misc:e=&gt;200+200*e,area:!0,gem:717}</code> |
| Skill effect <code>CR_ACIDDEMONSTRATION</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,castAtRange:!0,ratio:()=&gt;100,element:`neutral`,misc:(e,t,n)=&gt;n.stats.vit+t&gt;0?Math.floor(7*n.stats.vit*t*t/(10*(n.stats.vit+t))):0}</code> |
| Skill effect <code>WS_CARTTERMINATION</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;0,cartTermination:!0,noCards:!0,status:{id:`stun`,rate:e=&gt;5*e,duration:`d2`}}</code> |
| Skill effect <code>PA_SHIELDCHAIN</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+30*e,shieldBase:!0,shieldChainAdd:!0,ranged:!0,hitAfterCap:20}</code> |
| Skill effect <code>CR_HOLYCROSS</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+35*e,status:{id:`blind`,rate:e=&gt;3*e,duration:`d2`}}</code> |
| Skill effect <code>CR_GRANDCROSS</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;100+40*e,waves:()=&gt;3,area:!0,grandCross:!0,status:{id:`blind`,rate:(e,t,n)=&gt;n.element===`undead`&#124;&#124;n.race===`demon`?100:0,duration:`d2`}}</code> |
| Skill effect <code>CR_PROVIDENCE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AM_CP_WEAPON</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AM_CP_SHIELD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AM_CP_ARMOR</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AM_CP_HELM</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_DEVOTION</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CG_MARIONETTE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PF_FOGWALL</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_REFLECTSHIELD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_DEFENDER</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_SPEARQUICKEN</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>MO_CALLSPIRITS</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CH_SOULCOLLECT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CH_PALMSTRIKE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;200+100*e,knockback:()=&gt;3}</code> |
| Skill effect <code>CH_TIGERFIST</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;40+100*e,status:{id:`tigerRoot`,rate:e=&gt;10+10*e,duration:`d1`}}</code> |
| Skill effect <code>CH_CHAINCRUSH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;400+100*e}</code> |
| Skill effect <code>PF_HPCONVERSION</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PF_SOULCHANGE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PF_MEMORIZE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CG_ARROWVULCAN</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;200+100*e,ranged:!0}</code> |
| Skill effect <code>MO_TRIPLEATTACK</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+20*e}</code> |
| Skill effect <code>MO_CHAINCOMBO</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;150+50*e}</code> |
| Skill effect <code>MO_COMBOFINISH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;240+60*e,noSplash:!0}</code> |
| Skill effect <code>MO_FINGEROFFENSIVE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+50*e,ranged:!0,hitsBySpheres:!0}</code> |
| Skill effect <code>AM_ACIDTERROR</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;50+50*e,def:`acid`,ignoreFlee:!0,noCards:!0,element:`neutral`,status:{id:`bleeding`,rate:e=&gt;3*e,duration:`d2`}}</code> |
| Skill effect <code>MO_INVESTIGATE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+75*e,def:`pierce2`,ignoreFlee:!0,element:`neutral`}</code> |
| Skill effect <code>MO_EXTREMITYFIST</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;800,spRatio:!0,flatAdd:e=&gt;250+150*e,def:`ignore`,ignoreFlee:!0,element:`neutral`}</code> |
| Skill effect <code>MO_ABSORBSPIRITS</code> | Bundle Oe[] | unverified | <code>{type:`absorb`}</code> |
| Skill effect <code>RG_STEALCOIN</code> | Bundle Oe[] | unverified | <code>{type:`stealCoin`}</code> |
| Skill effect <code>BA_WHISTLE</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BA_ASSASSINCROSS</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BA_POEMBRAGI</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BA_APPLEIDUN</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>DC_HUMMING</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>DC_FORTUNEKISS</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>DC_SERVICEFORYOU</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BA_DISSONANCE</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>DC_DONTFORGETME</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_ADAPTATION</code> | Bundle Oe[] | unverified | <code>{type:`adapt`}</code> |
| Skill effect <code>BD_ENCORE</code> | Bundle Oe[] | unverified | <code>{type:`encore`}</code> |
| Skill effect <code>BD_LULLABY</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_RICHMANKIM</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_ETERNALCHAOS</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_DRUMBATTLEFIELD</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_RINGNIBELUNGEN</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_ROKISWEIL</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_INTOABYSS</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BD_SIEGFRIED</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>CG_MOONLIT</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>CG_HERMODE</code> | Bundle Oe[] | unverified | <code>{type:`song`}</code> |
| Skill effect <code>BA_FROSTJOKER</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,area:!0,screen:!0,party:!0,status:{id:`freeze`,rate:e=&gt;15+5*e,duration:`d2`}}</code> |
| Skill effect <code>DC_SCREAM</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,area:!0,screen:!0,party:!0,status:{id:`stun`,rate:e=&gt;25+5*e,duration:`d2`}}</code> |
| Skill effect <code>BA_MUSICALSTRIKE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;125+25*e}</code> |
| Skill effect <code>DC_THROWARROW</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;125+25*e}</code> |
| Skill effect <code>SA_MAGICROD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_AUTOSPELL</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_VOLCANO</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_DELUGE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_VIOLENTGALE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_LANDPROTECTOR</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SA_SPELLBREAKER</code> | Bundle Oe[] | unverified | <code>{type:`spellBreak`}</code> |
| Skill effect <code>SA_DISPELL</code> | Bundle Oe[] | unverified | <code>{type:`dispel`}</code> |
| Skill effect <code>HW_GANBANTEIN</code> | Bundle Oe[] | unverified | <code>{type:`groundClear`}</code> |
| Skill effect <code>CG_TAROTCARD</code> | Bundle Oe[] | unverified | <code>{type:`tarot`}</code> |
| Skill effect <code>SA_ABRACADABRA</code> | Bundle Oe[] | unverified | <code>{type:`abra`}</code> |
| Skill effect <code>AC_MAKINGARROW</code> | Bundle Oe[] | unverified | <code>{type:`craftArrow`}</code> |
| Skill effect <code>AM_PHARMACY</code> | Bundle Oe[] | unverified | <code>{type:`craftPotion`}</code> |
| Skill effect <code>RG_STRIPWEAPON</code> | Bundle Oe[] | unverified | <code>{type:`strip`,status:`stripWeapon`}</code> |
| Skill effect <code>ST_FULLSTRIP</code> | Bundle Oe[] | unverified | <code>{type:`strip`,status:`stripWeapon`,all:!0}</code> |
| Skill effect <code>RG_STRIPSHIELD</code> | Bundle Oe[] | unverified | <code>{type:`strip`,status:`stripShield`}</code> |
| Skill effect <code>RG_STRIPARMOR</code> | Bundle Oe[] | unverified | <code>{type:`strip`,status:`stripArmor`}</code> |
| Skill effect <code>RG_STRIPHELM</code> | Bundle Oe[] | unverified | <code>{type:`strip`,status:`stripHelm`}</code> |
| Skill effect <code>RG_BACKSTAP</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;300+40*e,ignoreFlee:!0,allowHidden:!0,endsHiding:!0,bowHalf:!0}</code> |
| Skill effect <code>RG_RAID</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+40*e,requiresHiding:!0,endsHiding:!0,area:!0,status:{id:`stun`,rate:e=&gt;10+3*e,duration:`d1`},status2:{id:`blind`,rate:e=&gt;10+3*e,duration:`d2`}}</code> |
| Skill effect <code>MO_BLADESTOP</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>MO_EXPLOSIONSPIRITS</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>MO_STEELBODY</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>RG_INTIMIDATE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+30*e,intimidate:!0}</code> |
| Skill effect <code>NPC_WIDESILENCE</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,area:!0,status:{id:`silence`,rate:()=&gt;100,duration:`d2`}}</code> |
| Skill effect <code>SM_BASH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+30*e,hitBonus:e=&gt;5*e,status:{id:`stun`,rate:(e,t)=&gt;e&gt;5&amp;&amp;t.skill(`SM_FATALBLOW`)&gt;0?(e-5)*t.baseLv/10:0,duration:`d2`}}</code> |
| Skill effect <code>PF_MINDBREAKER</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`mindBreaker`,rate:e=&gt;55+5*e,duration:`d1`},aggro:!0}</code> |
| Skill effect <code>PF_SPIDERWEB</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`spiderweb`,rate:()=&gt;100,duration:`d2`},aggro:!0}</code> |
| Skill effect <code>SM_PROVOKE</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`provoke`,rate:(e,t,n)=&gt;70+3*e+t.baseLv-n.lv,duration:`d1`},aggro:!0}</code> |
| Skill effect <code>AL_DECAGI</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`decagi`,rate:(e,t)=&gt;50+3*e+Math.floor((t.baseLv+t.int)/5),duration:`d1`},aggro:!0}</code> |
| Skill effect <code>AL_CRUCIS</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,undeadDemonArea:!0,status:{id:`crucis`,rate:(e,t,n)=&gt;25+4*e+t.baseLv-n.lv,duration:`d1`},aggro:!0}</code> |
| Skill effect <code>MG_STONECURSE</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,gem:716,status:{id:`stoneWait`,rate:e=&gt;20+4*e,duration:`d1`},aggro:!0}</code> |
| Skill effect <code>MG_FROSTDIVER</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;100+10*e,status:{id:`freeze`,rate:e=&gt;Math.min(3*e+35,e+60),duration:`d2`}}</code> |
| Skill effect <code>TF_POISON</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;100,flatAdd:e=&gt;15*e,status:{id:`poison`,rate:e=&gt;10+4*e,duration:`d2`}}</code> |
| Skill effect <code>TF_SPRINKLESAND</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;130,status:{id:`blind`,rate:()=&gt;20,duration:`d2`}}</code> |
| Skill effect <code>TF_STEAL</code> | Bundle Oe[] | unverified | <code>{type:`steal`}</code> |
| Skill effect <code>TF_PICKSTONE</code> | Bundle Oe[] | unverified | <code>{type:`pickStone`}</code> |
| Skill effect <code>TF_THROWSTONE</code> | Bundle Oe[] | unverified | <code>{type:`stone`}</code> |
| Skill effect <code>MC_CARTREVOLUTION</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;150,cart:!0}</code> |
| Skill effect <code>AC_DOUBLE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+10*(e-1)}</code> |
| Skill effect <code>AC_SHOWER</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;75+5*e}</code> |
| Skill effect <code>AC_CHARGEARROW</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;150,noSplash:!0}</code> |
| Skill effect <code>MG_ENERGYCOAT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SM_MAGNUM</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+20*e,hitBonus:e=&gt;10*e,buff:`SM_MAGNUM`}</code> |
| Skill effect <code>MC_MAMMONITE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+50*e}</code> |
| Skill effect <code>MG_NAPALMBEAT</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;70+10*e}</code> |
| Skill effect <code>MG_SOULSTRIKE</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:(e,t)=&gt;100+(t.element===`undead`?5*e:0)}</code> |
| Skill effect <code>MG_FIREBOLT</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100}</code> |
| Skill effect <code>MG_COLDBOLT</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100}</code> |
| Skill effect <code>MG_LIGHTNINGBOLT</code> | Bundle Oe[] | sampled via magic_bolt_damage/hits | <code>{type:`magic`,ratio:()=&gt;100}</code> |
| Skill effect <code>MG_FIREBALL</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;70+10*e}</code> |
| Skill effect <code>MG_THUNDERSTORM</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;80}</code> |
| Skill effect <code>AL_HOLYLIGHT</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;125}</code> |
| Skill effect <code>AL_HEAL</code> | Bundle Oe[] | unverified | <code>{type:`heal`,amount:(e,t,n)=&gt;Math.floor((t+n)/8)*(4+8*e)}</code> |
| Skill effect <code>AM_POTIONPITCHER</code> | Bundle Oe[] | unverified | <code>{type:`heal`,amount:()=&gt;0,potion:!0}</code> |
| Skill effect <code>CR_SLIMPITCHER</code> | Bundle Oe[] | unverified | <code>{type:`heal`,amount:()=&gt;0,potion:!0,slim:!0}</code> |
| Skill effect <code>NV_FIRSTAID</code> | Bundle Oe[] | unverified | <code>{type:`heal`,amount:()=&gt;5}</code> |
| Skill effect <code>AL_BLESSING</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AL_INCAGI</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AL_ANGELUS</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SM_ENDURE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AC_CONCENTRATION</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>MC_LOUD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AL_TELEPORT</code> | Bundle Oe[] | unverified | <code>{type:`teleport`}</code> |
| Skill effect <code>KN_PIERCE</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+10*e,hitBonus:e=&gt;5*e,hitsBySize:!0}</code> |
| Skill effect <code>KN_SPEARSTAB</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+20*e,area:!0}</code> |
| Skill effect <code>KN_SPEARBOOMERANG</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+50*e,castAtRange:!0}</code> |
| Skill effect <code>KN_BOWLINGBASH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+40*e}</code> |
| Skill effect <code>KN_BRANDISHSPEAR</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,requiresRiding:!0,area:!0,ratio:e=&gt;100+20*e,primaryRatio:e=&gt;{let t=100+20*e;return t+(e&gt;3?Math.floor(t/2):0)+(e&gt;6?Math.floor(t/4):0)+(e&gt;9?Math.floor(t/8):0)}}</code> |
| Skill effect <code>KN_TWOHANDQUICKEN</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>KN_AUTOCOUNTER</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AS_SONICBLOW</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;300+50*e,status:{id:`stun`,rate:e=&gt;2*e+10,duration:`d2`}}</code> |
| Skill effect <code>AS_ENCHANTPOISON</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AS_POISONREACT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AS_VENOMDUST</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,gem:716,status:{id:`poison`,rate:()=&gt;100,duration:`d2`},area:!0}</code> |
| Skill effect <code>AS_SPLASHER</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;500+50*e,gem:716,targetHpBelow:75,status:{id:`poison`,rate:()=&gt;100,duration:`d2`},area:!0,ratioBonusSkill:{id:`AS_POISONREACT`,perLv:20}}</code> |
| Skill effect <code>TF_HIDING</code> | Bundle Oe[] | unverified | <code>{type:`hide`}</code> |
| Skill effect <code>AS_CLOAKING</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AS_GRIMTOOTH</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100+20*e,requiresHiding:!0}</code> |
| Skill effect <code>HT_SKIDTRAP</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`wall`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_LANDMINE</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_ANKLESNARE</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`wall`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_SANDMAN</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_FLASHER</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_FREEZINGTRAP</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_BLASTMINE</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:1}]}</code> |
| Skill effect <code>HT_CLAYMORETRAP</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:Te,qty:2}]}</code> |
| Skill effect <code>HT_BLITZBEAT</code> | Bundle Oe[] | unverified | <code>{type:`falcon`}</code> |
| Skill effect <code>ASC_EDP</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>WS_MELTDOWN</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>ST_REJECTSWORD</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>ST_CHASEWALK</code> | Bundle Oe[] | unverified | <code>{type:`hide`}</code> |
| Skill effect <code>ASC_BREAKER</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;100*e,ranged:!0,noCards:!0}</code> |
| Skill effect <code>ASC_METEORASSAULT</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;40+40*e,area:!0,noCards:!0}</code> |
| Skill effect <code>HW_MAGICPOWER</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>HW_MAGICCRASHER</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:()=&gt;100,matkBase:!0,element:`neutral`,ranged:!0,castAtRange:!0}</code> |
| Skill effect <code>HW_NAPALMVULCAN</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;70+10*e,status:{id:`curse`,rate:e=&gt;5*e,duration:`d2`}}</code> |
| Skill effect <code>SN_SIGHT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SN_WINDWALK</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>SN_FALCONASSAULT</code> | Bundle Oe[] | unverified | <code>{type:`falcon`,assault:!0}</code> |
| Skill effect <code>SN_SHARPSHOOTING</code> | Bundle Oe[] | unverified | <code>{type:`weapon`,ratio:e=&gt;200+50*e,critBonus:20,area:!0,ranged:!0}</code> |
| Skill effect <code>HT_DETECTING</code> | Bundle Oe[] | unverified | <code>{type:`reveal`}</code> |
| Skill effect <code>MG_SIGHT</code> | Bundle Oe[] | unverified | <code>{type:`reveal`,aura:!0}</code> |
| Skill effect <code>AL_RUWACH</code> | Bundle Oe[] | unverified | <code>{type:`reveal`,aura:!0,damageRatio:145}</code> |
| Skill effect <code>AL_CURE</code> | Bundle Oe[] | unverified | <code>{type:`cure`,ailments:[`silence`,`blind`,`confusion`]}</code> |
| Skill effect <code>TF_DETOXIFY</code> | Bundle Oe[] | unverified | <code>{type:`cure`,ailments:[`poison`]}</code> |
| Skill effect <code>PR_STRECOVERY</code> | Bundle Oe[] | unverified | <code>{type:`cure`,ailments:[`stone`,`freeze`,`stun`,`sleep`,`stoneWait`]}</code> |
| Skill effect <code>PR_SLOWPOISON</code> | Bundle Oe[] | unverified | <code>{type:`cure`,ailments:[`poison`],slow:!0}</code> |
| Skill effect <code>PR_IMPOSITIO</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_SUFFRAGIUM</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_ASPERSIO</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_BENEDICTIO</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_SANCTUARY</code> | Bundle Oe[] | unverified | <code>{type:`heal`,amount:e=&gt;Ne(e)}</code> |
| Skill effect <code>PR_KYRIE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>HP_ASSUMPTIO</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_MAGNIFICAT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_GLORIA</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PR_LEXDIVINA</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`silence`,rate:()=&gt;100,duration:`d2`},aggro:!0}</code> |
| Skill effect <code>PR_LEXAETERNA</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,status:{id:`aeterna`,rate:()=&gt;100,duration:`d1`},aggro:!0}</code> |
| Skill effect <code>PR_TURNUNDEAD</code> | Bundle Oe[] | unverified | <code>{type:`turnUndead`}</code> |
| Skill effect <code>PR_MAGNUS</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;130,undeadDemonOnly:!0,waves:e=&gt;Math.ceil((4e3+1e3*e)/3e3)}</code> |
| Skill effect <code>ALL_RESURRECTION</code> | Bundle Oe[] | unverified | <code>{type:`resurrect`}</code> |
| Skill effect <code>BS_HAMMERFALL</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,area:!0,status:{id:`stun`,rate:e=&gt;Math.min(20+10*e,50+5*e),duration:`d2`},aggro:!0}</code> |
| Skill effect <code>BS_ADRENALINE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>BS_WEAPONPERFECT</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>BS_OVERTHRUST</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>WS_OVERTHRUSTMAX</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>CR_FULLPROTECTION</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>PF_DOUBLECASTING</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>BS_MAXIMIZE</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>MG_FIREWALL</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`wall`}</code> |
| Skill effect <code>MG_SAFETYWALL</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>AL_PNEUMA</code> | Bundle Oe[] | unverified | <code>{type:`buff`}</code> |
| Skill effect <code>WZ_FIREPILLAR</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`trap`,items:[{itemId:717,qty:1,fromLv:6}]}</code> |
| Skill effect <code>WZ_SIGHTRASHER</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;100+20*e}</code> |
| Skill effect <code>WZ_METEOR</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100,waves:e=&gt;Math.ceil(ke(e)/2),status:{id:`stun`,rate:e=&gt;3*e,duration:`d2`}}</code> |
| Skill effect <code>WZ_JUPITEL</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100,knockback:e=&gt;Math.floor(e/2)+2}</code> |
| Skill effect <code>WZ_VERMILION</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;80+20*e,waves:()=&gt;4,hits:()=&gt;1,status:{id:`blind`,rate:e=&gt;Math.min(4*e,40),duration:`d2`}}</code> |
| Skill effect <code>WZ_WATERBALL</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;100+30*e,hits:e=&gt;e}</code> |
| Skill effect <code>WZ_ICEWALL</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`wall`}</code> |
| Skill effect <code>AM_DEMONSTRATION</code> | Bundle Oe[] | unverified | <code>{type:`place`,trigger:`zone`}</code> |
| Skill effect <code>AM_CANNIBALIZE</code> | Bundle Oe[] | unverified | <code>{type:`summon`,kind:`flora`}</code> |
| Skill effect <code>AM_CALLHOMUN</code> | Bundle Oe[] | unverified | <code>{type:`homun`,action:`call`}</code> |
| Skill effect <code>AM_REST</code> | Bundle Oe[] | unverified | <code>{type:`homun`,action:`rest`}</code> |
| Skill effect <code>AM_RESURRECTHOMUN</code> | Bundle Oe[] | unverified | <code>{type:`homun`,action:`revive`}</code> |
| Skill effect <code>AM_SPHEREMINE</code> | Bundle Oe[] | unverified | <code>{type:`summon`,kind:`sphere`}</code> |
| Skill effect <code>WZ_FROSTNOVA</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;Math.floor((100+10*e)*2/3),skipFrozen:!0,status:{id:`freeze`,rate:e=&gt;5*e+33,duration:`d2`}}</code> |
| Skill effect <code>WZ_STORMGUST</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:e=&gt;100+40*e,waves:()=&gt;3,skipFrozen:!0,status:{id:`freeze`,rate:()=&gt;150,duration:`d2`}}</code> |
| Skill effect <code>WZ_EARTHSPIKE</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100}</code> |
| Skill effect <code>WZ_HEAVENDRIVE</code> | Bundle Oe[] | unverified | <code>{type:`magic`,ratio:()=&gt;100}</code> |
| Skill effect <code>WZ_QUAGMIRE</code> | Bundle Oe[] | unverified | <code>{type:`debuff`,area:!0,status:{id:`quagmire`,rate:()=&gt;100,duration:`d2`}}</code> |
| Buff <code>ASC_EDP</code> | Bundle Pe[] | unverified | <code>e=&gt;({deadlyPoisonRate:50*(e+1),poisonAddPercent:25})</code> |
| Buff <code>LK_AURABLADE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>LK_PARRYING</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>LK_CONCENTRATION</code> | Bundle Pe[] | unverified | <code>e=&gt;({hit:10*e,atkRate:5*e,defRate:-5*e,vitDefRate:-5*e,mdef:1})</code> |
| Buff <code>LK_TENSIONRELAX</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>HP_BASILICA</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>WS_CARTBOOST</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>LK_BERSERK</code> | Bundle Pe[] | unverified | <code>()=&gt;({maxHpRate:200,aspdRate:30,atkRate:100})</code> |
| Buff <code>PA_SACRIFICE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>WS_MELTDOWN</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>ST_REJECTSWORD</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>ST_CHASEWALK</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>HW_MAGICPOWER</code> | Bundle Pe[] | unverified | <code>e=&gt;({magicPowerRate:5*e})</code> |
| Buff <code>SN_SIGHT</code> | Bundle Pe[] | unverified | <code>e=&gt;({stats:{str:5,agi:5,vit:5,int:5,dex:5,luk:5},atkRate:2*e,hit:3*e,crit:e})</code> |
| Buff <code>SN_WINDWALK</code> | Bundle Pe[] | unverified | <code>e=&gt;({flee:Math.ceil(e/2)})</code> |
| Buff <code>AL_BLESSING</code> | Bundle Pe[] | sampled via snapshot formulas | <code>e=&gt;({stats:{str:e,int:e,dex:e}})</code> |
| Buff <code>MG_SIGHT</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>AL_RUWACH</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>HAMI_DEFENCE</code> | Bundle Pe[] | unverified | <code>e=&gt;({stats:{vit:2*e}})</code> |
| Buff <code>AM_CP_WEAPON</code> | Bundle Pe[] | unverified | <code>()=&gt;({unbreakable:{weapon:1},unstrippable:{weapon:1}})</code> |
| Buff <code>AM_CP_SHIELD</code> | Bundle Pe[] | unverified | <code>()=&gt;({unbreakable:{shield:1},unstrippable:{shield:1}})</code> |
| Buff <code>AM_CP_ARMOR</code> | Bundle Pe[] | unverified | <code>()=&gt;({unbreakable:{armor:1},unstrippable:{armor:1}})</code> |
| Buff <code>AM_CP_HELM</code> | Bundle Pe[] | unverified | <code>()=&gt;({unbreakable:{helm:1},unstrippable:{helm:1}})</code> |
| Buff <code>AL_INCAGI</code> | Bundle Pe[] | sampled via snapshot formulas | <code>e=&gt;({stats:{agi:2+e}})</code> |
| Buff <code>AL_ANGELUS</code> | Bundle Pe[] | unverified combat placement | <code>e=&gt;({vitDefRate:5*e})</code> |
| Buff <code>SM_ENDURE</code> | Bundle Pe[] | sampled via snapshot formulas | <code>e=&gt;({mdef:e})</code> |
| Buff <code>AC_CONCENTRATION</code> | Bundle Pe[] | unverified | <code>e=&gt;({statRate:{agi:2+e,dex:2+e}})</code> |
| Buff <code>MC_LOUD</code> | Bundle Pe[] | sampled via snapshot formulas | <code>()=&gt;({stats:{str:4}})</code> |
| Buff <code>MG_ENERGYCOAT</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>SM_MAGNUM</code> | Bundle Pe[] | unverified | <code>()=&gt;({fireAddPercent:20})</code> |
| Buff <code>KN_TWOHANDQUICKEN</code> | Bundle Pe[] | unverified | <code>()=&gt;({aspdRate:30})</code> |
| Buff <code>KN_AUTOCOUNTER</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>AS_ENCHANTPOISON</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`poison`})</code> |
| Buff <code>AS_POISONREACT</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>MG_SAFETYWALL</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>AL_PNEUMA</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>TF_HIDING</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>AS_CLOAKING</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PR_IMPOSITIO</code> | Bundle Pe[] | unverified | <code>e=&gt;({atk:5*e})</code> |
| Buff <code>PR_SUFFRAGIUM</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PR_ASPERSIO</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`holy`})</code> |
| Buff <code>PR_BENEDICTIO</code> | Bundle Pe[] | unverified | <code>()=&gt;({defElement:`holy`})</code> |
| Buff <code>PR_SANCTUARY</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PR_KYRIE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>HP_ASSUMPTIO</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PR_MAGNIFICAT</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PR_GLORIA</code> | Bundle Pe[] | unverified | <code>()=&gt;({stats:{luk:30}})</code> |
| Buff <code>PR_SLOWPOISON</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BS_ADRENALINE</code> | Bundle Pe[] | unverified | <code>(e,t)=&gt;({aspdRate:t?20:30})</code> |
| Buff <code>BS_WEAPONPERFECT</code> | Bundle Pe[] | unverified | <code>()=&gt;({noSizePenalty:!0})</code> |
| Buff <code>BS_OVERTHRUST</code> | Bundle Pe[] | unverified | <code>(e,t)=&gt;({atkRate:t?5:5*e})</code> |
| Buff <code>WS_OVERTHRUSTMAX</code> | Bundle Pe[] | unverified | <code>e=&gt;({atkRate:20*e})</code> |
| Buff <code>CR_FULLPROTECTION</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PF_DOUBLECASTING</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BS_MAXIMIZE</code> | Bundle Pe[] | unverified | <code>()=&gt;({maximize:!0})</code> |
| Buff <code>SA_FLAMELAUNCHER</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`fire`})</code> |
| Buff <code>SA_FROSTWEAPON</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`water`})</code> |
| Buff <code>SA_LIGHTNINGLOADER</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`wind`})</code> |
| Buff <code>SA_SEISMICWEAPON</code> | Bundle Pe[] | unverified | <code>()=&gt;({attackElement:`earth`})</code> |
| Buff <code>CR_AUTOGUARD</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>CR_PROVIDENCE</code> | Bundle Pe[] | unverified | <code>e=&gt;({subElement:{holy:5*e},subRace:{demon:5*e}})</code> |
| Buff <code>CR_DEVOTION</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>CG_MARIONETTE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>PF_FOGWALL</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>CR_REFLECTSHIELD</code> | Bundle Pe[] | unverified | <code>e=&gt;({shortWeaponDamageReturn:10+3*e})</code> |
| Buff <code>CR_DEFENDER</code> | Bundle Pe[] | unverified | <code>e=&gt;({defenderLongRate:5+15*e,aspdRate:-(25-5*e)})</code> |
| Buff <code>CR_SPEARQUICKEN</code> | Bundle Pe[] | unverified | <code>e=&gt;({aspdRate:20+e})</code> |
| Buff <code>PF_MEMORIZE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>MO_CALLSPIRITS</code> | Bundle Pe[] | unverified | <code>e=&gt;({masteryAtk:3*e})</code> |
| Buff <code>MO_EXPLOSIONSPIRITS</code> | Bundle Pe[] | unverified | <code>e=&gt;({crit:(75+25*e)/10})</code> |
| Buff <code>SA_MAGICROD</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BA_WHISTLE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BA_ASSASSINCROSS</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BA_POEMBRAGI</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BA_APPLEIDUN</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>DC_HUMMING</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>DC_FORTUNEKISS</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>DC_SERVICEFORYOU</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_LULLABY</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_RICHMANKIM</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_ETERNALCHAOS</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_DRUMBATTLEFIELD</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_RINGNIBELUNGEN</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_ROKISWEIL</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_INTOABYSS</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>BD_SIEGFRIED</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>CG_MOONLIT</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>CG_HERMODE</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>SA_AUTOSPELL</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>SA_VOLCANO</code> | Bundle Pe[] | unverified | <code>e=&gt;({elementAtkRate:{fire:Ee[e-1]??20},atk:10*e})</code> |
| Buff <code>SA_DELUGE</code> | Bundle Pe[] | unverified | <code>e=&gt;({elementAtkRate:{water:Ee[e-1]??20},maxHpRate:[5,9,12,14,15][e-1]??15})</code> |
| Buff <code>SA_VIOLENTGALE</code> | Bundle Pe[] | unverified | <code>e=&gt;({elementAtkRate:{wind:Ee[e-1]??20},flee:3*e})</code> |
| Buff <code>SA_LANDPROTECTOR</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>MO_STEELBODY</code> | Bundle Pe[] | unverified | <code>()=&gt;({steelBody:!0,aspdRate:-25})</code> |
| Buff <code>MO_EXTREMITYFIST</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>HW_GRAVITATION</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Buff <code>MO_BLADESTOP</code> | Bundle Pe[] | unverified | <code>()=&gt;({})</code> |
| Damage envelope <code>profile-1/1013/dagger</code> | Fitted primary candidate | 247 OK / 0 MISS | predicted 16..62; observed 16..62. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-1/1031/dagger</code> | Fitted primary candidate | 75 OK / 0 MISS | predicted 45..90; observed 45..90. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-1/1104/dagger</code> | Fitted primary candidate | 100 OK / 0 MISS | predicted 30..60; observed 30..60. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-1/1128/dagger</code> | Fitted primary candidate | 698 OK / 0 MISS | predicted 13..52; observed 13..52. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-1/1174/dagger</code> | Fitted primary candidate | 179 OK / 0 MISS | predicted 29..86; observed 29..86. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-4/1013/1hAxe</code> | Fitted primary candidate | 159 OK / 0 MISS | predicted 38..49; observed 38..49. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-4/1031/1hAxe</code> | Fitted primary candidate | 54 OK / 0 MISS | predicted 52..63; observed 52..63. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-4/1104/1hAxe</code> | Fitted primary candidate | 67 OK / 2 MISS | predicted 26..34; observed 26..37. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-4/1128/1hAxe</code> | Fitted primary candidate | 421 OK / 0 MISS | predicted 31..41; observed 31..41. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-4/1174/1hAxe</code> | Fitted primary candidate | 125 OK / 0 MISS | predicted 38..45; observed 38..45. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1013/1hAxe</code> | Fitted primary candidate | 109 OK / 0 MISS | predicted 29..50; observed 29..50. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1031/1hAxe</code> | Fitted primary candidate | 27 OK / 0 MISS | predicted 43..64; observed 44..64. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1085/1hAxe</code> | Fitted primary candidate | 217 OK / 0 MISS | predicted 1..69; observed 1..69. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1104/1hAxe</code> | Fitted primary candidate | 41 OK / 0 MISS | predicted 15..35; observed 15..35. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1128/1hAxe</code> | Fitted primary candidate | 285 OK / 0 MISS | predicted 23..42; observed 23..42. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-5/1174/1hAxe</code> | Fitted primary candidate | 81 OK / 0 MISS | predicted 28..46; observed 28..46. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-6/1013/dagger</code> | Fitted primary candidate | 90 OK / 0 MISS | predicted 39..39; observed 39..39. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-6/1031/dagger</code> | Fitted primary candidate | 31 OK / 0 MISS | predicted 53..53; observed 53..53. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-6/1104/dagger</code> | Fitted primary candidate | 37 OK / 3 MISS | predicted 38..38; observed 38..42. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-6/1128/dagger</code> | Fitted primary candidate | 267 OK / 0 MISS | predicted 32..32; observed 32..32. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-6/1174/dagger</code> | Fitted primary candidate | 67 OK / 0 MISS | predicted 48..48; observed 48..48. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-7/1013/bow</code> | Fitted primary candidate | 160 OK / 0 MISS | predicted 98..135; observed 98..135. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-7/1031/bow</code> | Fitted primary candidate | 49 OK / 0 MISS | predicted 112..149; observed 113..145. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-7/1104/bow</code> | Fitted primary candidate | 74 OK / 0 MISS | predicted 92..129; observed 97..127. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-7/1128/bow</code> | Fitted primary candidate | 434 OK / 0 MISS | predicted 85..118; observed 85..118. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-7/1174/bow</code> | Fitted primary candidate | 127 OK / 0 MISS | predicted 97..130; observed 98..128. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-8/1013/fist</code> | Fitted primary candidate | 199 OK / 0 MISS | predicted 1..1; observed 1..1. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-8/1031/fist</code> | Fitted primary candidate | 65 OK / 0 MISS | predicted 1..9; observed 1..9. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-8/1104/fist</code> | Fitted primary candidate | 80 OK / 0 MISS | predicted 1..1; observed 1..1. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-8/1128/fist</code> | Fitted primary candidate | 532 OK / 0 MISS | predicted 1..1; observed 1..1. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |
| Damage envelope <code>profile-8/1174/fist</code> | Fitted primary candidate | 141 OK / 0 MISS | predicted 1..4; observed 1..4. Aggregated over changing buffs and hit counts; checker tests each individual envelope. |

Still unknown:

- The five physical Coco outliers and eight monster-attack outliers; hidden monster modes/statuses, player VIT-defense modifiers, siege penalties and Angelus placement need isolated captures.
- Physical card/mastery/bane/ATK-rate ordering, dual wield, crit RNG and bonuses, overrefine RNG, most target elements/levels and armor-element damage paths. Bolt envelopes do not prove the shared/per-hit random-roll policy.
- General party sizes, capped bonus versus eligibility, unequal/damage-based shares, remainder allocation and loot ownership. The eight-recipient equal-share case is established; rare-card/drop probabilities are not.
- Regen timing/blocking, potion rolls/cooldowns, death rounding/respawn, cast-rate/slowcast/Suffragium sequencing, NPC crafting/refine probabilities, and reborn/advanced-job branches. No direct captured events establish these rules.
- Specialized skill handlers (including turn-undead, traps, songs, homunculi and most advanced skills) have client declarations, not a complete server damage implementation. Their unverified definitions above are an inventory, not an executable server specification.
## JS module (`server/rules/formulas.js`)

The server's formula module is a port of this checker; the Python script stays the oracle. `server/rules/formulas.test.mjs` has unit cases (literals from a captured merchant snapshot and the worked example above) plus a capture check. The capture check replays the SSE captures through the JS functions (bundle static data comes from the oracle's non-evaluating parser, so no bundle JS runs). It then fails if any formula has fewer OK or more MISS results than the Python oracle on the same input. It is skipped when the capture dir or `.scratch/bundle.js` is missing (override with `RO_CAPTURE_DIR` / `RO_BUNDLE`; `FORMULAS_REPORT=<path>` writes this table).

```sh
node --test 'server/**/*.test.mjs'
```

Counts from 2026-11-04, after the stale-gap rule, on the capture as it stood (it is still growing, so totals exceed the table above). `python3 -I scripts/formula-check.py` exits 0 on this data:

| Formula | JS OK | JS MISS | Python OK | Python MISS | JS miss examples |
| --- | --- | --- | --- | --- | --- |
| aspd | 987 | 0 | 987 | 0 |  |
| attackIntervalMs | 987 | 0 | 987 | 0 |  |
| castMs_DEX | 3009 | 0 | 3009 | 0 |  |
| crit | 987 | 0 | 987 | 0 |  |
| element_table | 18159 | 0 | 18159 | 0 |  |
| flee | 987 | 0 | 987 | 0 |  |
| hardDef | 987 | 0 | 987 | 0 |  |
| hardMdef | 987 | 0 | 987 | 0 |  |
| hit | 987 | 0 | 987 | 0 |  |
| hpRegen | 987 | 0 | 987 | 0 |  |
| magic_bolt_damage | 567 | 0 | 567 | 0 |  |
| matkMax | 987 | 0 | 987 | 0 |  |
| matkMin | 987 | 0 | 987 | 0 |  |
| maxHp | 987 | 0 | 987 | 0 |  |
| maxSp | 987 | 0 | 987 | 0 |  |
| monster_def2_softdef_angelus | 995 | 5 | 995 | 5 | envelope=[1,13], observed=14; envelope=[1,15], observed=16; envelope=[1,13], observed=14 |
| party_exp_base | 11544 | 0 | 11544 | 0 |  |
| party_exp_job | 11544 | 0 | 11544 | 0 |  |
| perfectDodge | 987 | 0 | 987 | 0 |  |
| player_damage_candidate | 16591 | 157 | 16591 | 157 | envelope=[52,52], observed=58; envelope=[86,86], observed=90; envelope=[43,43], observed=45 |
| refineAtk | 987 | 0 | 987 | 0 |  |
| skill_delayMs | 3009 | 0 | 3009 | 0 |  |
| softMdef | 987 | 0 | 987 | 0 |  |
| spRegen | 987 | 0 | 987 | 0 |  |
| statusAtk | 987 | 0 | 987 | 0 |  |
| total_stats | 987 | 0 | 987 | 0 |  |
| vitDef | 987 | 0 | 987 | 0 |  |
| weightMax | 987 | 0 | 987 | 0 |  |

JS equals Python on every row: same OK and MISS counts. Not in the JS module: `baseExpNext`/`jobExpNext` (plain table lookups), drop sampling, and the rejected alternatives. Party EXP is generalised as `floor(exp × (100 + min(100, 20×(n−1))) / (100×n))`, and only n=8 is verified. Death penalty `min(baseExp, floor(baseExpNext/100))` (0 for novice) is still unverified because no deaths are captured.

### Investigation: player-damage misses (163, not only Coco)

On the larger capture, `player_damage_candidate` misses about 160 times (157 here), not 5. About 148 of the misses are profile-1 (Thief, dagger +7, Double Attack): it always lands above a single-value envelope, +2..+4 per hit. Findings:

- The replayed attacker state is correct: derived stats at each miss equal the next real snapshot.
- On every profile-1 miss, the implied monster soft DEF is exactly `floor(0.9 × VIT)`: VIT 28→25, 34→30 (Coco), 16→14, 14→12. The bundle's Provoke table `cd(lv)` gives Lv1 `def2 −10%`, and this is that exact factor. None of these 82 target UIDs has a captured `provoke` statusStart, so captured Provoke is not the explanation.
- A miss happens only when profile-1 is the **sole attacker** (no other party member hit the UID within ±1–5 s) **and** the target has not attacked anyone yet. Those conditions give 147 misses / ~1,950 hits. With 2+ attackers or after the monster's first attack there are 0 misses in ~3,000 hits. HP% and time since first hit do not correlate.
- Hypothesis (unverified): the server has a hidden state that cuts monster def2 by 10% for an un-aggroed monster engaged by a single attacker, or a hidden Provoke Lv1-like status. To settle it, capture with a solo character and log the monster status list. Not modelled; the remaining 15 misses (profiles 4/5/6) are scattered at +1..+4.

### Investigation: monster→player Angelus off-by-one misses (4, now 5)

The 4 analysed misses are all on profile-5 (Swordman, VIT63, hard DEF 9, Angelus 10 active with ≥78 s remaining, Endure 10). They are observed 1 above the envelope max (14 vs 13, 16 vs 15), so the cause is not buff expiry. Each hit lands within ~1.5 s of the swordman first engaging the monster (`found` → first hit), and the UIDs have no Provoke status. This is unresolved: either the Angelus floor order is wrong (def2 93 instead of 94 would fit) or a monster ATK modifier applies on first engagement. 

### Investigation: the `castMs_DEX` miss (resolved: capture gap)

AL_INCAGI Lv3 cast in 713 ms; the replay predicted 726 ms with DEX 41. The stream had only 14 events in the 2,369 s after its last snapshot, so the app was offline or the capture had a gap. The next snapshot shows DEX 43, and `floor(1000×(150−43)/150) = 713` is exact. The formula is right and the replay state was stale. Both the oracle and the JS capture test now drop a stream's state after a >120 s gap (15 such gaps in the capture), and `castMs_DEX` is 3,009 OK / 0 MISS.

Known JS vs. oracle differences that no capture exercises: the JS player-damage path uses the panel `statusAtk` (DEX main for bow, instrument and whip; the oracle's damage path uses bow only). JS bolt MATK includes `magicPowerRate`, which is 0 in every capture. The JS check reads hard DEF and refine ATK from the replayed state, while the oracle reads them from the last snapshot.

## Rules engine (`server/rules/engine.js`, #17)

Pure and deterministic: callers inject time (`at`/`now`) and a seeded RNG (`mulberry32`). It sequences the formulas
above and emits battle event bodies in the captured shapes ([api.md](api.md#battle-event--seq-body-wallms-simtime)).

| Piece | Rule | Evidence |
|---|---|---|
| Encounter | monster drawn by spawn `count` (mechanics page: no coordinates); search 300 ms + Exp(mean 500 ms) | captured searching→found: min 300, p50 ~500, mean ~800, p95 ~2.2 s (profiles 1, 5) |
| Approach | melee: walk 10 cells × `moveSpeedMs` (1120 = 10×112, 1500 = 10×150); ranged opener (bow, Provoke, magic attack rule): `found` at 9 cells, 500 ms, then the mob closes `(9 − range) × walkSpeed` (2100 = 500 + 8×200; mushrooms 8500 = 500 + 8×1000) | 1,129 + 588 captured `found` |
| Player hit / crit | hit% = clamp(5, 95, 80 + HIT − (mobLv + mobAGI)); crit% = panel crit − mobLUK/5, crit always hits; dagger double attack 5%×TF_DOUBLE Lv on non-crit swings | mechanics page; distribution not verified per roll |
| Monster swing | passive mobs start after the first hit (aggressive on arrival), first swing uniform in [0, attackDelay], then every attackDelay; hit% = clamp(5, 95, 80 + mobLv + mobDEX − FLEE) after perfect dodge | captured Spore 1872 ms, Horn 1528 ms cadence |
| Mob skills | attack-state `NPC_*ATTACK` skills fire at `rate`/10000 per swing with `delayMs` cooldown; damage = normal swing × element | ailments/DEF bypass not modelled |
| Casts | SP paid at cast start, DEX cast time, damage at completion, next action after max(delay, ASPD interval); self buffs recast when missing (`buffStart` with level duration) | castMs 1978 captured for LB Lv4 / DEX 44; Endure 37 s |
| Timing | `resolveAction` rejects actions before the ASPD interval (`TOO_EARLY`), unlearned levels, short SP, cooldowns | |
| Not modelled | buff stat effects other than Angelus soft DEF (panel values kept), arrow/weapon/armor elements (attacks neutral), weight ≥50% regen stop and ≥90% attack stop (events only), `applyDeath` is the caller's job after `death` | |
| Rewards | solo EXP or `partyExpShare`; `basePct` = gain / level requirement; base level-up stat points floor((Lv−1)/5)+3 (fits captured 48/49/51 → 12/12/13); drops roll each slot per 10000 × kill-event `dropMult` (event monster, inside its window); weight warnings at 50/90% | |

### L2 replay (`node tests/l2-fights.mjs 1000`, test `tests/engine-l2.test.mjs`)

Each of the 400 fixture fights runs 1,000 seeds from its snapshot (`derived` panel, buffs, mob HP at our first hit);
a fight passes when the real duration, damage taken and hits landed all lie in the simulated p5–p95. 2026-11-04 fixtures:

| Stratum | Pass | Duration ok | Damage taken ok | Hits ok |
|---|---|---|---|---|
| **Own-finish** (all damage from `mobHpStart` is ours) | **141/153 = 92.2%** | 144 | 153 | 145 |
| of which solo `found` at full HP | 21/25 = 84.0% | 23 | 25 | 22 |
| Party-helped (allies hit the mob after we engaged) | 2/247 = 0.8% | 5 | 99 | 5 |
| All | 143/400 = 35.8% | 149 | 252 | 150 |

The #23 bar (≥90%) is met on own-finish fights; the 25 solo `found` fights alone are at 84% (all 4 misses are the
swordman/Red Mushroom case below). Party-helped fights cannot be replayed solo (the stream only has our own hits), so they are reported, not judged.
Most "solo found" fights in the corpus (42/67) also took party damage; `ownDamage ≥ mobHpStart` is the solo filter.

The 12 own-finish failures:

- **Merchant one-hit kills of assist targets (5)**: real damage at or above our max (63 vs 52–63, 44 vs 31–41,
  35 vs 32, 42 vs 39 twice; two of these also start late, see next item). Every case fits the open player-damage outlier: monster soft DEF = floor(0.9 × VIT)
  (see the investigation above). Applying that cut whenever the mob has not swung yet lifts own-finish only to 142/153,
  so it is not adopted; the trigger condition is still unknown.
- **Melee assist delay (2 more)**: the first own hit after a `targetSwitch` comes 1.4–2.6 s late in ~15% of melee assist
  switches (0 ms in the rest; never for mage/archer). Probably walking to the ally's target; no distance is captured.
- **Swordman vs Red Mushroom (DEF 100) (4)**: 3 fights deal 6 per hit instead of 1 (unrefined axe), killing in 3
  hits; one ran 32 s against our 29 s p95 (an extra Endure/idle gap). Suspect stale snapshot gear or a flat ATK outside the DEF step; needs a capture with a fresh snapshot.
- **Mage bolt max roll (1)**: one Lightning Bolt killed 392 HP = exactly the max MATK roll ×4; a real <2% event.

### Kill / EXP per hour (`node tests/l2-rates.mjs`)

Each fixture character farms `mjolnir_09` alone for 3 simulated hours (search + approach + fight; HP/SP reset per
fight). Captured 2026-11-04 rates (8 own characters, one party, 2.9–4.1 active hours each; gaps >120 s excluded):

| Char (capture) | Job | Sim kills/h (solo) | Real own kills/h | Real `found`/h | Real base EXP/h (party share) |
|---|---|---|---|---|---|
| 72397 (profile-1) | thief | 319 | 84 | 91 | 20,844 |
| 72444 (profile-2) | not in fixtures | – | 0 | 0 | 18,842 |
| 72468 (profile-3) | mage | 318 | 203 | 0 | 18,762 |
| 72472 (profile-4) | merchant | 162 | 38 | 0 | 18,706 |
| 72688 (profile-5) | swordman | 158 | 67 | 488 | 18,742 |
| 74435 (profile-6) | merchant | 163 | 41 | 0 | 18,689 |
| 74496 (profile-7) | archer | 425 | 108 | 0 | 18,793 |
| 74917 (profile-8) | acolyte | 20 (209 deaths/h) | 1 | 0 | 18,640 |
| **Party** | | **1,565** (66,278 base EXP/h each) | **541** | | **~18,700 each** |

Profile ↔ character from the request paths in each capture file. The acolyte is a support build (fists,
no attack rules, 398/767 HP at its last snapshot) and never fights alone in the captures, so its solo deaths are expected. Per-character rates are not comparable
one-to-one: only the thief and swordman search (the swordman pulls 488 mobs/h for the party), the others assist. At party level the
solo sum is ~2.9× the real kill rate, while each fight's duration matches (L2 above). The gap is session time the engine does not
model: party assist overlap (several members on one mob), looting, sitting/regen, buff upkeep by the acolyte, town trips.
That belongs to the brain/session layer (#23), not the per-fight rules. population.md's (branch `re-implement-server-backend-offline`) ~62 fights/h per character
(all 8 averaged) is consistent with 541 party kills/h ÷ 8 ≈ 68.

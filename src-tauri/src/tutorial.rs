//! Small, deterministic lessons matched to real log problems. Progress lives in player.md.
use serde::Serialize;
use serde_json::{Value, json};
use std::path::Path;
const MODE: &str = "[教學模式] 開啟";
#[derive(Serialize)]
struct Lesson {
    id: &'static str,
    title: &'static str,
    path: &'static str,
    text: &'static str,
}
// Setting labels and behavior verified against the live game bundle on 2026-11-02.
static LESSONS: [Lesson; 5] = [
    Lesson {
        id: "party-share",
        title: "隊伍經驗與等級限制",
        path: "組隊 → 經驗分配 → 均分",
        text: "同地圖一起掛機每多一人經驗 +20%，最多 +100%。均分需要隊員 Base Level 差距不超過 15；超過時先拆成合適等級的小隊，再選「均分」。停止或死亡中的隊員不參與一起打怪。",
    },
    Lesson {
        id: "skill-order",
        title: "詠唱中斷與技能順序",
        path: "掛機設定 → 掛機技能 → 套用設定",
        text: "紀錄出現多次被攻擊打斷詠唱；已消耗的 SP 不退還。規則依順序選可用技能，檢查各條件與 SP，把適合受攻擊時使用的短詠唱技能移到前面；調整後按「套用設定」，再比較中斷次數。",
    },
    Lesson {
        id: "monster-control",
        title: "怪物控制與被打才還手",
        path: "掛機設定 → 怪物控制（每隻怪物的打法）→ 動作 → 被打才還手 → 套用設定",
        text: "「被打才還手」會在搜尋目標時略過該怪物，並不會阻止主動怪攻擊你。想主動打才改「主動打」；想避開危險怪要同時檢查該列的「逃生」和逃生設定。按「套用設定」才生效。",
    },
    Lesson {
        id: "skills-only",
        title: "只用技能時的退路",
        path: "掛機設定 → 攻擊方式 → 技能無法施放時的處理 → 套用設定",
        text: "「只用技能（不使用普通攻擊）」不會自動改成普通攻擊。短暫冷卻會先等待，其他無法施放情況依這個選單處理；可選「安全時回復，受威脅或無法回復時回城」，並備好補品／逃生用品。逃生回城後會停止掛機，避免反覆耗翅膀。",
    },
    Lesson {
        id: "potion-economy",
        title: "藥水與補給預算",
        path: "掛機設定 → 藥水與補給 → 回城購買 → 套用設定",
        text: "缺藥或購買失敗時，檢查回城購買的道具、補給下限／目標數量，以及保留 Zeny 與預算；保留量和負重也可能限制補給。不要只拉高喝藥門檻。套用後比較紀錄中的用藥量、補給支出與死亡數，再調整。",
    },
];
fn marker(id: &str) -> String {
    format!("[已學會:{id}]")
}
fn choose(events: &[Value], memory: &str) -> Option<&'static Lesson> {
    let interruptions = events
        .iter()
        .filter(|e| e["body"]["type"] == "skillInterrupt" && e["body"]["reason"] == "damage")
        .count();
    LESSONS.iter().find(|lesson| {
        if memory.contains(&marker(lesson.id)) {
            return false;
        }
        events.iter().any(|e| {
            let b = &e["body"];
            let text = b.to_string();
            let kind = b["type"].as_str().unwrap_or("");
            match lesson.id {
                "party-share" => {
                    kind == "system"
                        && (text.contains("均分")
                            || text.contains("經驗分配")
                            || text.contains("levelGap"))
                }
                "skill-order" => interruptions >= 3,
                "monster-control" => {
                    kind == "targetSkip"
                        && matches!(
                            b["reason"].as_str(),
                            Some("defend" | "aggressive" | "danger")
                        )
                }
                "skills-only" => {
                    text.contains("skillUnavailable")
                        || (kind == "system" && text.contains("只用技能"))
                }
                "potion-economy" => {
                    kind == "noPotion"
                        || kind == "autoBuyFail"
                        || (kind == "stop"
                            && (text.contains("SUPPL")
                                || text.contains("POTION")
                                || text.contains("補給")))
                }
                _ => false,
            }
        })
    })
}
fn apply(dir: &Path, operation: &str, note: &str) -> Result<(), String> {
    let result = crate::memory::edit(dir, "player", operation, &json!({"note":note}));
    if let Some(error) = result["error"].as_str() {
        Err(error.into())
    } else {
        Ok(())
    }
}
pub fn status(
    dir: &Path,
    scope: Option<&str>,
    enabled: Option<bool>,
    learned: Option<&str>,
    now: u64,
) -> Result<Value, String> {
    let lesson = learned
        .map(|id| {
            LESSONS
                .iter()
                .find(|l| l.id == id)
                .ok_or("Unknown tutorial mechanic")
        })
        .transpose()?;
    let previous = crate::memory::read(dir, "player")?;
    if let Some(enabled) = enabled {
        if enabled {
            apply(dir, "remember", MODE)?
        } else if previous.lines().any(|line| line == format!("- {MODE}")) {
            apply(dir, "forget", MODE)?
        }
    }
    if let Some(lesson) = lesson {
        apply(
            dir,
            "remember",
            &format!("{} {}", marker(lesson.id), lesson.title),
        )?;
    }
    let memory = crate::memory::read(dir, "player")?;
    let enabled = memory.lines().any(|l| l == format!("- {MODE}"));
    let count = LESSONS
        .iter()
        .filter(|l| memory.contains(&marker(l.id)))
        .count();
    let mut offer = Value::Null;
    if enabled {
        let names = if let Some(name) = scope {
            vec![name.to_string()]
        } else {
            let (_, characters) = crate::api::respond(
                "GET",
                "/characters",
                Some("Bearer internal"),
                "internal",
                dir,
                now,
            );
            characters
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|c| c["name"].as_str().map(str::to_string))
                .collect()
        };
        for name in names {
            let events = crate::api::character_events(dir, &name, now.saturating_sub(600_000))
                .unwrap_or_default();
            let start = events.len().saturating_sub(100);
            if let Some(lesson) = choose(&events[start..], &memory) {
                offer = json!({"character":name,"lesson":lesson});
                break;
            }
        }
    }
    Ok(json!({"enabled":enabled,"learned":count,"total":LESSONS.len(),"offer":offer}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_cast_interruptions_offer_exact_path_and_learned_mechanics_are_skipped() {
        let events = vec![json!({"body":{"type":"skillInterrupt","reason":"damage"}}); 3];
        let lesson = choose(&events, "").unwrap();
        assert_eq!(lesson.id, "skill-order");
        assert!(lesson.path.contains("掛機設定 → 掛機技能"));
        assert!(choose(&events, "- [已學會:skill-order] 學會了").is_none());
        for (event, id) in [
            (json!({"type":"system","message":"不能均分"}), "party-share"),
            (
                json!({"type":"targetSkip","reason":"defend"}),
                "monster-control",
            ),
            (
                json!({"type":"useItem","reason":{"k":"skillUnavailable"}}),
                "skills-only",
            ),
            (json!({"type":"noPotion"}), "potion-economy"),
        ] {
            assert_eq!(choose(&[json!({"body":event})], "").unwrap().id, id);
        }
    }
    #[test]
    fn tutorial_progress_survives_reopening_and_mode_is_shared() {
        let dir = std::env::temp_dir().join(format!("ro-tutorial-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(status(&dir, None, None, None, 0).unwrap()["enabled"], false);
        assert_eq!(
            status(&dir, None, Some(true), None, 0).unwrap()["enabled"],
            true
        );
        assert_eq!(
            status(&dir, None, None, Some("skill-order"), 0).unwrap()["learned"],
            1
        );
        assert_eq!(status(&dir, None, None, None, 0).unwrap()["learned"], 1);
        assert!(
            crate::memory::read(&dir, "player")
                .unwrap()
                .contains("[已學會:skill-order]")
        );
        assert!(status(&dir, None, None, Some("unknown"), 0).is_err());
        assert_eq!(
            status(&dir, None, Some(false), None, 0).unwrap()["enabled"],
            false
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}

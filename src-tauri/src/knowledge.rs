//! Read-only tools over game data refreshed by scripts/extract-maps.mjs.
use serde_json::{Value, json};
use std::sync::LazyLock;
static DATA: LazyLock<Result<Value, String>> = LazyLock::new(|| {
    let mut data: Value = serde_json::from_str(include_str!("../../src/game-data.json")).map_err(|e| e.to_string())?;
    // Items come from the item editor's file (same extraction run), keyed by ID.
    let items: serde_json::Map<String, Value> = serde_json::from_str(include_str!("../../src/item-info.json")).map_err(|e| e.to_string())?;
    data["items"] = items.into_iter().filter_map(|(id, mut item)| {
        item["id"] = json!(id.parse::<u64>().ok()?);
        Some(item)
    }).collect();
    Ok(data)
});

/// {mapId: [monsterId]} of every map's regular and timed spawns (the game's own "這張地圖" list).
pub fn map_monsters() -> Value {
    let Ok(data) = &*DATA else { return json!({}) };
    let maps = data["maps"].as_array().into_iter().flatten();
    maps.map(|m| {
        let mut ids: Vec<u64> = ["spawns", "timed"].iter()
            .flat_map(|k| m[*k].as_array().into_iter().flatten())
            .filter_map(|s| s["monsterId"].as_u64()).collect();
        ids.sort();
        ids.dedup();
        (m["id"].as_str().unwrap_or_default().to_string(), json!(ids))
    }).collect::<serde_json::Map<_, _>>().into()
}

pub fn lookup(kind: &str, query: &str) -> Value {
    let data = match &*DATA {
        Ok(d) => d,
        Err(e) => return json!({"error":e}),
    };
    lookup_in(data, kind, query)
}
fn lookup_in(data: &Value, kind: &str, query: &str) -> Value {
    if query.trim().is_empty() || query.len() > 200 {
        return json!({"error":"Provide a name or ID, at most 200 UTF-8 bytes"});
    }
    let Some(records) = data[kind].as_array() else {
        return json!({"error":"kind must be monsters, maps, skills or items"});
    };
    let key = query.trim().to_lowercase();
    let matches = |r: &&Value| {
        r["name"]
            .as_str()
            .is_some_and(|s| s.to_lowercase().contains(&key))
            || r["id"].as_str().is_some_and(|s| s.to_lowercase() == key)
            || r["id"].as_u64().is_some_and(|n| n.to_string() == key)
    };
    let exact = records.iter().find(|r| {
        r["name"].as_str().is_some_and(|s| s.to_lowercase() == key)
            || r["id"].as_str().is_some_and(|s| s.to_lowercase() == key)
            || r["id"].as_u64().is_some_and(|n| n.to_string() == key)
    });
    if let Some(record) = exact {
        return json!({"source":data["source"],"record":record});
    }
    json!({"source":data["source"],"matches":records.iter().filter(matches).take(10).map(|r| json!({"id":r["id"],"name":r["name"]})).collect::<Vec<_>>()})
}
pub fn rank(members: &[Value]) -> Value {
    match &*DATA {
        Ok(data) => rank_in(data, members),
        Err(e) => json!({"error":e}),
    }
}
fn rank_in(data: &Value, members: &[Value]) -> Value {
    if members.is_empty()
        || members.len() > 12
        || members.iter().any(|m| {
            m["base"].as_u64().unwrap_or(0) == 0 || m["maxHp"].as_f64().unwrap_or(0.0) <= 0.0
        })
    {
        return json!({"error":"Choose 1–12 known characters with current level and max HP"});
    }
    let active: Vec<_> = members
        .iter()
        .filter(|m| m["running"] == true && m["hp"].as_f64().unwrap_or(0.0) > 0.0)
        .collect();
    let min_level = members
        .iter()
        .filter_map(|m| m["base"].as_u64())
        .min()
        .unwrap();
    let max_level = members
        .iter()
        .filter_map(|m| m["base"].as_u64())
        .max()
        .unwrap();
    let rules = &data["partyRules"];
    let eligible = max_level - min_level <= rules["evenShareLevelLimit"].as_u64().unwrap_or(15);
    let bonus = ((members.len() - 1) as f64 * rules["bonusPerMember"].as_f64().unwrap_or(0.2))
        .min(rules["maxBonus"].as_f64().unwrap_or(1.0));
    let weakest_hp = members
        .iter()
        .filter_map(|m| m["maxHp"].as_f64())
        .fold(f64::INFINITY, f64::min);
    let mut maps = vec![];
    let Some(monsters) = data["monsters"].as_array() else {
        return json!({"error":"No monster data"});
    };
    for map in data["maps"].as_array().into_iter().flatten() {
        let mut total = 0.0;
        let mut exp_hp = 0.0;
        let mut damage_ratio = 0.0;
        let mut warnings = vec![];
        let mut aggressive = 0.0;
        // Timed boss spawns are hazards, not a dependable farming yield.
        for spawn in map["spawns"]
            .as_array()
            .into_iter()
            .flatten()
            .chain(map["timed"].as_array().into_iter().flatten())
        {
            let Some(monster) = monsters.iter().find(|m| m["id"] == spawn["monsterId"]) else {
                continue;
            };
            let hp = monster["hp"].as_f64().unwrap_or(0.0);
            let count = spawn["count"].as_f64().unwrap_or(0.0);
            if hp <= 0.0 || count <= 0.0 {
                continue;
            }
            let atk = monster["atk"][1].as_f64().unwrap_or(0.0);
            let is_aggressive = monster["behavior"] == "aggressive";
            if is_aggressive && atk >= weakest_hp {
                warnings.push(json!({"monster":monster["name"],"rawMaxAttack":atk,"weakestMaxHp":weakest_hp,"warning":"Aggressive monster raw attack reaches/exceeds a member's max HP; defense and skills not modeled"}));
            }
            if spawn.get("respawnMs").is_some() {
                continue;
            }
            total += count;
            exp_hp += monster["baseExp"].as_f64().unwrap_or(0.0) / hp * count;
            damage_ratio += atk / weakest_hp * count;
            if is_aggressive {
                aggressive += count;
            }
        }
        if total == 0.0 {
            continue;
        }
        let efficiency = exp_hp / total;
        let ratio = damage_ratio / total;
        // The game has no coordinates: each search draws a monster by its share of the
        // map's spawn count, so map area does not change encounter rate.
        let score = efficiency * (1.0 + bonus)
            / (1.0 + ratio + aggressive / total)
            / (1.0 + warnings.len() as f64 * 10.0);
        maps.push(json!({"id":map["id"],"name":map["name"],"score":score,"baseExpPerMonsterHp":efficiency,"rawAttackToWeakestHp":ratio,"aggressiveFraction":aggressive/total,"travelSeconds":map["travelFromTownMs"].as_f64().unwrap_or(0.0)/1000.0,"warnings":warnings}));
    }
    maps.sort_by(|a, b| {
        b["score"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["score"].as_f64().unwrap_or(0.0))
    });
    maps.truncate(5);
    json!({"source":data["source"],"assumption":"Proposed plan: all selected members resume alive and idle together on the same map. The bonus shown is prospective, not their current live bonus. Score is a heuristic, not EXP/hour. Raw attack is before defense/resistance; skills, player DPS, travel downtime and respawn competition are not simulated.","party":{"selectedMembers":members.iter().map(|m| &m["name"]).collect::<Vec<_>>(),"currentlyInactive":members.len()-active.len(),"levelSpread":max_level-min_level,"evenShareLevelLimit":rules["evenShareLevelLimit"],"evenShareEligible":eligible,"sameMapExpBonus":bonus,"warning":if eligible {Value::Null} else {json!("Level gap exceeds the even-share limit; experience cannot be evenly shared. Split the party or use damage-proportional sharing.")}},"maps":maps})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranking_flags_aggressive_damage_and_respects_level_limit_and_bonus() {
        let data = json!({"partyRules":{"evenShareLevelLimit":15,"bonusPerMember":0.2,"maxBonus":1.0},"monsters":[{"id":1,"name":"Safe","hp":100,"baseExp":20,"atk":[5,10],"behavior":"passive"},{"id":2,"name":"Danger","hp":100,"baseExp":100,"atk":[80,120],"behavior":"aggressive"}],"maps":[{"id":"safe","spawns":[{"monsterId":1,"count":10}],"area":1000},{"id":"danger","spawns":[{"monsterId":2,"count":10}],"area":1000}]});
        let members = [
            json!({"name":"Alice","base":10,"maxHp":100,"hp":100,"running":true}),
            json!({"name":"Bob","base":26,"maxHp":200,"hp":100,"running":true}),
        ];
        let result = rank_in(&data, &members);
        assert_eq!(result["party"]["evenShareEligible"], false);
        assert_eq!(result["party"]["sameMapExpBonus"], 0.2);
        assert_eq!(result["maps"][0]["id"], "safe");
        // Area must not matter: encounters are drawn by spawn share, not position.
        let mut wide = data.clone();
        wide["maps"][0]["area"] = json!(129600);
        assert_eq!(rank_in(&wide, &members)["maps"][0]["score"], result["maps"][0]["score"]);
        assert_eq!(result["maps"][1]["warnings"][0]["monster"], "Danger");
        let mut eligible = members.to_vec();
        eligible[1]["base"] = json!(25);
        assert_eq!(
            rank_in(&data, &eligible)["party"]["evenShareEligible"],
            true
        );
        eligible[1]["running"] = json!(false);
        assert_eq!(rank_in(&data, &eligible)["party"]["sameMapExpBonus"], 0.2);
        eligible[1]["base"] = json!(26);
        assert_eq!(
            rank_in(&data, &eligible)["party"]["evenShareEligible"],
            false
        );
        assert!(
            !rank_in(&data, &eligible[1..])["maps"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    fn live_game_lookup_contains_spore_sleep_water_and_attack() {
        let result = lookup("monsters", "魔菇");
        assert_eq!(result["record"]["element"], "water");
        assert_eq!(result["record"]["atk"], json!([24, 48]));
        let skills = result["record"]["skills"].as_array().unwrap();
        assert!(skills.iter().any(|s| s["skill"] == "NPC_SLEEPATTACK"));
        assert!(skills.iter().any(|s| s["skill"] == "NPC_WATERATTACK"));
        let potion = lookup("items", "501");
        assert_eq!(potion["record"]["name"], "紅色藥水");
        assert_eq!(potion["record"]["sell"], 25);
        assert!(lookup("cards", "x")["error"].is_string());
    }
}

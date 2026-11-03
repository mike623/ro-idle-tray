//! Player guides fetched live from ned-lin-9527.github.io/Ragnarok and cached
//! on disk for a day. A failed refresh falls back to the stale copy.
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

const BASE: &str = "https://ned-lin-9527.github.io/Ragnarok/";
const MAX_AGE: Duration = Duration::from_secs(86_400);
const BUDGET: usize = 6_000; // characters returned per call

/// Every guide page title, from the cached (or freshly fetched) index.
pub async fn titles(dir: &Path) -> Result<Vec<String>, String> {
    let titles = cached(&dir.join("guide/index.json"), BASE, |html| Ok(serde_json::to_string(&parse_index(html))?))
        .await
        .map_err(|e| format!("Guide site unavailable: {e}"))
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).map_err(|e| e.to_string()))?;
    if titles.is_empty() {
        return Err("Guide index is empty".into());
    }
    Ok(titles)
}

pub async fn lookup(dir: &Path, page: Option<&str>, query: Option<&str>) -> Value {
    let cache = dir.join("guide");
    let titles = match titles(dir).await {
        Ok(t) => t,
        Err(e) => return json!({"error":e}),
    };
    let query = query.map(str::trim).filter(|q| !q.is_empty());
    let Some(page) = page.map(str::trim).filter(|p| !p.is_empty()) else {
        return search_titles(&titles, query);
    };
    let found: Vec<&String> = match titles.iter().find(|t| *t == page) {
        Some(t) => vec![t],
        None => titles.iter().filter(|t| t.contains(page)).collect(),
    };
    let [title] = found[..] else {
        return json!({"error":"Page not found; pick one exact title","candidates":if found.is_empty() { titles.iter().collect() } else { found }});
    };
    let url = format!("{BASE}guides/{}.html", encode(title));
    let text = match cached(&cache.join(format!("{title}.txt")), &url, |html| Ok(article_text(html))).await {
        Ok(t) => t,
        Err(e) => return json!({"error":format!("Guide page unavailable: {e}")}),
    };
    json!({"source":url, "title":title, "content":excerpt(&text, query)})
}

fn search_titles(titles: &[String], query: Option<&str>) -> Value {
    let hits: Vec<&String> = match query {
        Some(q) => titles.iter().filter(|t| q.split_whitespace().any(|w| t.contains(w))).collect(),
        None => vec![],
    };
    if hits.is_empty() {
        json!({"source":BASE, "note":"No title matched; all guide pages listed", "pages":titles})
    } else {
        json!({"source":BASE, "pages":hits})
    }
}

/// Whole page when it fits; otherwise the lines matching the query, each with
/// its section heading, or the start of the page plus its outline.
fn excerpt(text: &str, query: Option<&str>) -> String {
    if text.chars().count() <= BUDGET {
        return text.to_string();
    }
    let mut out = String::new();
    if let Some(q) = query {
        let words: Vec<&str> = q.split_whitespace().collect();
        let mut heading = "";
        let mut shown = "";
        for line in text.lines() {
            if line.starts_with("## ") {
                heading = line;
            } else if words.iter().any(|w| line.contains(w)) {
                if heading != shown {
                    out.push_str(heading);
                    out.push('\n');
                    shown = heading;
                }
                out.push_str(line);
                out.push('\n');
            }
            if out.chars().count() > BUDGET {
                break;
            }
        }
        if !out.is_empty() {
            return truncate(&out);
        }
        out.push_str("(No line matched the query.)\n");
    }
    let outline: Vec<&str> = text.lines().filter(|l| l.starts_with("## ")).collect();
    out.push_str(&format!("Sections: {}\n(Page truncated; pass query to read a section.)\n\n", outline.join(" / ")));
    out.push_str(text);
    truncate(&out)
}

fn truncate(s: &str) -> String {
    s.chars().take(BUDGET).collect()
}

async fn cached(file: &PathBuf, url: &str, convert: impl Fn(&str) -> Result<String, Box<dyn std::error::Error>>) -> Result<String, String> {
    let fresh = std::fs::metadata(file)
        .and_then(|m| m.modified())
        .is_ok_and(|t| SystemTime::now().duration_since(t).unwrap_or_default() < MAX_AGE);
    if fresh && let Ok(s) = std::fs::read_to_string(file) {
        return Ok(s);
    }
    match fetch(url).await.and_then(|html| convert(&html).map_err(|e| e.to_string())) {
        Ok(text) => {
            if let Some(parent) = file.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(file, &text);
            Ok(text)
        }
        Err(e) => std::fs::read_to_string(file).map_err(|_| e),
    }
}

async fn fetch(url: &str) -> Result<String, String> {
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    let body = response.text().await.map_err(|e| e.to_string())?;
    if body.len() > 2_000_000 {
        return Err("page too large".into());
    }
    Ok(body)
}

/// Page titles from the index's `guides/<name>.html` links, in page order.
fn parse_index(html: &str) -> Vec<String> {
    let mut titles = Vec::new();
    for part in html.split("href=\"guides/").skip(1) {
        let Some(name) = part.split('"').next().and_then(|h| h.strip_suffix(".html")) else { continue };
        let Some(title) = decode(name) else { continue };
        // The title becomes a cache file name: refuse anything path-like.
        if title.is_empty() || title.starts_with('.') || title.contains(['/', '\\', '\0']) || titles.contains(&title) {
            continue;
        }
        titles.push(title);
    }
    titles
}

fn decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            out.push(u8::from_str_radix(s.get(i + 1..i + 3)?, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

/// Plain text of the page's `<article>`: headings as `## `, table cells joined by ` | `.
fn article_text(html: &str) -> String {
    let start = html.find("<article").unwrap_or(0);
    let end = html[start..].find("</article>").map_or(html.len(), |e| start + e);
    let html = &html[start..end];
    let mut out = String::new();
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&rest[..lt]);
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = &rest[lt + 1..lt + gt];
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect::<String>().to_ascii_lowercase();
        let closing = tag.starts_with('/');
        match (name.as_str(), closing) {
            ("h1" | "h2" | "h3" | "h4", false) => out.push_str("\n## "),
            ("p" | "div" | "tr" | "li" | "br" | "h1" | "h2" | "h3" | "h4" | "table" | "ul" | "ol", _) => out.push('\n'),
            ("td" | "th", true) => out.push_str(" | "),
            _ => {}
        }
        rest = &rest[lt + gt + 1..];
    }
    out.push_str(rest);
    let text = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    text.lines()
        .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
        // Headings end in a "#" permalink anchor.
        .map(|l| if l.starts_with("## ") { l.trim_end_matches('#').trim_end().to_string() } else { l.trim_end_matches(" |").to_string() })
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_titles_are_decoded_deduped_and_path_safe() {
        let html = r#"<a href="guides/%E5%88%BA%E5%AE%A2%E6%8A%80%E8%83%BD%E8%AA%AA%E6%98%8E.html">x</a>
            <a href="guides/%E5%88%BA%E5%AE%A2%E6%8A%80%E8%83%BD%E8%AA%AA%E6%98%8E.html">dup</a>
            <a href="guides/..%2Fetc.html">evil</a><a href="guides/.hidden.html">h</a><a href="guides/bad%ZZ.html">b</a>"#;
        assert_eq!(parse_index(html), vec!["刺客技能說明"]);
        assert_eq!(encode("刺客技能說明"), "%E5%88%BA%E5%AE%A2%E6%8A%80%E8%83%BD%E8%AA%AA%E6%98%8E");
    }

    #[test]
    fn article_text_keeps_headings_and_table_rows() {
        let html = r##"<nav>menu</nav><article class="a"><p>依 <a href="x">資料</a> &amp; 說明</p>
            <h2 id="s1">技能清單<a class="heading-anchor" href="#s1">#</a></h2>
            <table><tr><th>技能</th><th>Lv</th></tr><tr><td>右手修練</td><td>5</td></tr></table></article><footer>f</footer>"##;
        assert_eq!(article_text(html), "依 資料 & 說明\n## 技能清單\n技能 | Lv\n右手修練 | 5");
    }

    #[test]
    fn long_pages_return_matching_lines_under_their_heading() {
        let filler = "填充".repeat(4_000);
        let text = format!("## 技能\n{filler}\n## 配點\nSTR 90 AGI 70\n## 裝備\n短劍");
        let hit = excerpt(&text, Some("AGI"));
        assert_eq!(hit, "## 配點\nSTR 90 AGI 70\n");
        let miss = excerpt(&text, Some("不存在"));
        assert!(miss.starts_with("(No line matched the query.)\nSections: ## 技能 / ## 配點 / ## 裝備"));
        assert_eq!(miss.chars().count(), BUDGET);
        assert_eq!(excerpt("短頁", Some("x")), "短頁");
    }

    #[test]
    fn title_search_falls_back_to_full_list() {
        let titles = vec!["刺客技能說明".to_string(), "爆刺刺客培養攻略".into(), "祭司技能說明".into()];
        assert_eq!(search_titles(&titles, Some("刺客"))["pages"], json!(["刺客技能說明", "爆刺刺客培養攻略"]));
        assert_eq!(search_titles(&titles, Some("騎士"))["pages"].as_array().unwrap().len(), 3);
    }

    #[test]
    #[ignore = "network: cargo test -- --ignored live_guide"]
    fn live_guide_fetches_index_and_a_page() {
        let dir = std::env::temp_dir().join(format!("guide-live-{}", std::process::id()));
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let index = rt.block_on(lookup(&dir, None, Some("刺客")));
        assert!(index["pages"].as_array().unwrap().iter().any(|t| t == "刺客技能說明"), "{index}");
        let page = rt.block_on(lookup(&dir, Some("刺客技能說明"), None));
        assert!(page["content"].as_str().unwrap().contains("右手修練"), "{page}");
        assert!(dir.join("guide/刺客技能說明.txt").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}

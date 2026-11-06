// Records one demo GIF per feature for the landing page (site/), by driving the app's own
// windows in Chromium with a mocked Tauri bridge (e2e/mock-tauri.js). Needs ffmpeg.
//   node e2e/record.mjs            all scenes
//   node e2e/record.mjs atlas      one scene
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, rm, readdir, rename } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "site/media");
const TMP = join(ROOT, ".scratch/video");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2" };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    // The demo stage and tray icon live outside src/.
    const file = /^[/\\](e2e|src-tauri[/\\]icons)[/\\]/.test(path) ? join(ROOT, path) : join(ROOT, "src", path);
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// A visible pointer, since headless video has none. Follows real mouse events.
const CURSOR = () => window === top && addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.style.cssText = "position:fixed;left:-40px;top:-40px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;"
    + "background:rgba(79,114,196,.45);border:2px solid #fff;box-shadow:0 0 0 1px #4f72c4;z-index:2147483647;pointer-events:none;transition:transform .12s";
  document.documentElement.append(c);
  addEventListener("mousemove", (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
  addEventListener("mousedown", () => { c.style.transform = "scale(.7)"; }, true);
  addEventListener("mouseup", () => { c.style.transform = ""; }, true);
});

const pause = (page, ms) => page.waitForTimeout(ms);
async function point(page, locator) {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await pause(page, 250);
}
async function click(page, locator) { await point(page, locator); await locator.click(); }
async function type(page, locator, text) { await click(page, locator); await locator.pressSequentially(text, { delay: 90 }); }

const SCENES = {
  tray: { file: "e2e/tray.html", size: [640, 720], dark: true, async run(p) {
    await pause(p, 900);
    await click(p, p.locator("#tray"));
    await pause(p, 1600);
    const panel = p.frameLocator("#panel");
    await point(p, panel.locator('[data-n="1"]').first());
    await pause(p, 2000);
    await click(p, panel.locator('[data-filter="attention"]'));
    await pause(p, 2200);
  } },
  assist: { file: "e2e/tray.html", size: [640, 720], dark: true, async run(p) {
    await p.locator("#tray").click();
    await pause(p, 1000);
    const panel = p.frameLocator("#panel");
    const row = (n) => panel.locator(`.sec-body [data-n="${n}"] .name`).first();
    for (const [n, label] of [[3, "輔助模式"], [4, "拉怪模式"]]) {
      await point(p, row(n));
      await row(n).click({ button: "right" });
      await pause(p, 900);
      await click(p, p.getByRole("menuitemcheckbox", { name: new RegExp(label) }));
      await pause(p, 1500);
    }
    await p.mouse.move(120, 400, { steps: 18 });
    await pause(p, 2000);
  } },
  upkeep: { file: "index.html?update", size: [360, 640], async run(p) {
    await pause(p, 1000);
    await point(p, p.locator(".offline").first()); // offline row: last data kept, greyed out
    await pause(p, 1600);
    await click(p, p.locator("#refresh"));
    await pause(p, 1000);
    await point(p, p.locator("#update"));
    await pause(p, 1400);
    await click(p, p.locator("#more > summary"));
    await pause(p, 2200);
  } },
  plan: { file: "assistant.html?guide", size: [1000, 640], async run(p) {
    const a = p;
    await pause(p, 1200);
    const input = a.locator('[aria-label="詢問助理"]');
    await type(p, input, "@米亞 ");
    await pause(p, 600);
    await click(p, a.locator("#plan-btn"));
    await pause(p, 900);
    await click(p, a.getByText("ID巫師培養攻略"));
    await pause(p, 300);
    await click(p, a.getByText("巫師技能說明", { exact: true }));
    await pause(p, 400);
    await type(p, a.locator("#plan-note"), "走 INT/DEX，先練到超魔");
    await pause(p, 500);
    await click(p, a.getByRole("button", { name: "在攻略視窗開啟：ID巫師培養攻略" }));
    await pause(p, 2600);
    await click(p, a.locator("#plan-save"));
    await pause(p, 2000);
  } },
  api: { file: "e2e/api.html", size: [960, 620], async run(p) {
    await p.waitForFunction(() => window.done, null, { timeout: 30000 });
    await pause(p, 2200);
  } },
  panel: { file: "index.html", size: [360, 640], async run(p) {
    await pause(p, 1400);
    await point(p, p.locator('[data-n="1"]').first()); // hover opens the detail popup
    await pause(p, 2000);
    await click(p, p.locator('[data-filter="attention"]'));
    await pause(p, 1800);
    await click(p, p.locator('[data-filter="attention"]'));
    await pause(p, 600);
    await click(p, p.locator('.attn-sec [data-n="3"] .idle, [data-n="3"] .idle').first());
    await pause(p, 2600);
  } },
  bulk: { file: "index.html", size: [360, 640], async run(p) {
    await pause(p, 1200);
    await click(p, p.locator("#idle-all"));
    await pause(p, 2200);
    await click(p, p.locator("#recall"));
    await pause(p, 900);
    await click(p, p.locator("#recall"));
    await pause(p, 2200);
  } },
  settings: { file: "index.html", size: [360, 640], async run(p) {
    await pause(p, 900);
    await click(p, p.locator("#ai-open"));
    await pause(p, 1400);
    await click(p, p.locator("#ai-model-trigger"));
    await pause(p, 900);
    await click(p, p.locator('#ai-model-list [data-value="gpt-5.4"]'));
    await pause(p, 700);
    await click(p, p.locator("#ai-test"));
    await pause(p, 1500);
    await p.locator("#ai-result").evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "end" }));
    await pause(p, 2200);
  } },
  assistant: { file: "assistant.html", size: [420, 640], async run(p) {
    await pause(p, 1600);
    const input = p.locator('[aria-label="詢問助理"]');
    await type(p, input, "@米亞 為什麼一直倒地？");
    await pause(p, 400);
    await input.press("Enter");
    await pause(p, 4200);
    const apply = p.getByRole("button", { name: "套用到自動配點" });
    await click(p, apply);
    await pause(p, 900);
    await click(p, p.getByRole("button", { name: /確定/ }));
    await pause(p, 2600);
  } },
  atlas: { file: "atlas.html", size: [960, 620], async run(p) {
    await pause(p, 1200);
    await type(p, p.locator("#q"), "狼");
    await pause(p, 1600);
    await click(p, p.locator(".move-all").first());
    await pause(p, 2600);
  } },
  items: { file: "items.html", size: [960, 560], async run(p) {
    await pause(p, 1500);
    await click(p, p.locator("#rows input[type=checkbox]").nth(4));
    await pause(p, 800);
    await click(p, p.locator("#apply"));
    await pause(p, 800);
    await click(p, p.locator("#apply"));
    await pause(p, 2600);
  } },
  classes: { file: "classes.html", size: [960, 600], async run(p) {
    await pause(p, 1200);
    await p.mouse.move(560, 300, { steps: 18 });
    for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, -160); await pause(p, 300); }
    await pause(p, 600);
    await p.mouse.down();
    await p.mouse.move(420, 230, { steps: 24 });
    await p.mouse.up();
    await pause(p, 1200);
  } },
};

const only = process.argv.slice(2);
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
for (const [name, scene] of Object.entries(SCENES)) {
  if (only.length && !only.includes(name)) continue;
  const [width, height] = scene.size;
  const dir = join(TMP, name);
  await rm(dir, { recursive: true, force: true });
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 1, locale: "zh-TW", colorScheme: scene.dark ? "dark" : "light",
    recordVideo: { dir, size: { width, height } },
  });
  await ctx.addInitScript({ path: join(ROOT, "e2e/mock-tauri.js") });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${scene.file}`);
  page.on("pageerror", (e) => console.error(`${name}: ${e.message}`));
  try { await scene.run(page); } catch (e) { await page.screenshot({ path: join(TMP, `${name}-failed.png`) }); throw e; }
  // Last frame for checking the run; the tray one is also the page's social preview image.
  await page.screenshot({ path: join(name === "tray" ? OUT : TMP, `${name}.png`) });
  await ctx.close();
  const [video] = (await readdir(dir)).filter((f) => f.endsWith(".webm"));
  // Skip the blank first frames. The headless video is lossy, so denoise and drop
  // near-duplicate frames before the palette pass; this keeps each GIF about 5x smaller.
  const filter = "hqdn3d=4:4:6:6,mpdecimate=hi=512:lo=256:frac=0.5,fps=10,split[a][b];"
    + "[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "0.6", "-i", join(dir, video), "-vf", filter, join(OUT, `${name}.tmp.gif`)]);
  await rename(join(OUT, `${name}.tmp.gif`), join(OUT, `${name}.gif`));
  console.log(`✓ ${name}`);
}
await browser.close();
server.close();

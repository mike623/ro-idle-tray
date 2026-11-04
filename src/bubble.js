// Injected into each game window as a floating bubble; the panel mounts the same chat
// for one character (window.roIdleCharacterChat). Secrets and model calls belong to Rust.
(() => {
  if (window !== window.top) return;
  // The panel loads this file with data-embed and mounts it itself.
  const embedOnly = document.currentScript?.hasAttribute('data-embed');
  const TOOL_LABELS = {list_characters:'角色列表',get_character:'角色狀態',get_log_summary:'讀取紀錄',game_lookup:'查詢資料',rank_maps:'地圖排名',guide_lookup:'查詢攻略',remember:'記住',update_memory:'更新記憶',forget:'忘記',recall:'回想'};
  const STARTERS = ['為什麼剛才死亡？','最近效率如何？','下一步怎麼升級？'];
  const boot = (opts = {}) => {
    const embed = !!opts.mount;
    if (!embed && document.getElementById('ro-idle-assistant')) return;
    const host = document.createElement('div');
    if (embed) { host.className = 'embed'; host.style.cssText = 'all:initial;display:block;height:100%;'; }
    else { host.id = 'ro-idle-assistant'; host.style.cssText = 'all:initial;position:fixed;right:14px;bottom:14px;z-index:2147483647;'; }
    const root = host.attachShadow({mode:'closed'});
    // Embedded: the panel names the character; a game window's own character comes from Rust.
    const who = embed ? {character: opts.character} : {};
    root.innerHTML = `<style>
      :host{all:initial;--bg:#fff;--fg:#09090b;--muted:#f4f4f5;--mf:#71717a;--line:#e4e4e7;--pri:#18181b;--prf:#fafafa;--warn:#b45309}
      #box,.dock{font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;color:var(--fg);text-align:left}
      @media(prefers-color-scheme:dark){:host{--bg:#111114;--fg:#fafafa;--muted:#27272a;--mf:#a1a1aa;--line:#2e2e33;--pri:#fafafa;--prf:#18181b;--warn:#fbbf24}}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,input,textarea{font:inherit;color:inherit} button{cursor:pointer;border:0;background:none;padding:0}
      button:focus-visible,input:focus-visible{outline:2px solid #6b8cff;outline-offset:2px} button:disabled{opacity:.5;cursor:default}
      .dock{display:flex;flex-direction:column;align-items:flex-end;gap:8px}
      #nudge{max-width:230px;text-align:left;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px 12px;font-size:12px;box-shadow:0 4px 14px #0002}
      #pill{display:flex;align-items:center;gap:8px;height:44px;padding:0 16px 0 8px;border-radius:22px;background:var(--pri);color:var(--prf);box-shadow:0 6px 20px #0004;max-width:calc(100vw - 28px)}
      #pill .av{background:#ffffff26;color:inherit}
      #pill-label{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #badge{border-radius:9px;background:#fbbf24;color:#18181b;font-size:10px;font-weight:600;padding:1px 6px}
      .av{flex:none;width:28px;height:28px;border-radius:50%;background:var(--muted);display:flex;align-items:center;justify-content:center;font-size:13px}
      #box{width:min(340px,calc(100vw - 28px));height:min(520px,calc(100vh - 28px));display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px #0005;overflow:hidden}
      header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
      .who{flex:1;min-width:0;line-height:1.3} #title{font-weight:600} #sub,#state{color:var(--mf)} #state{font-size:11px}
      .chip{flex:none;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:10px;color:var(--mf);max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .icon{flex:none;width:28px;height:28px;border-radius:6px;color:var(--mf)} .icon:hover{background:var(--muted)}
      #tutorial{padding:5px 12px!important;border:0!important;border-bottom:1px solid var(--line)!important;border-radius:0!important;font-size:11px;color:var(--mf);max-height:140px!important}
      #tutorial button{border:1px solid var(--line);border-radius:12px;padding:1px 8px;font-size:11px} #tutorial p{margin:4px 0}
      #messages{flex:1;min-height:0;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:12px}
      .me{align-self:flex-end;max-width:80%;background:var(--pri);color:var(--prf);border-radius:8px;padding:7px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
      .ai{display:flex;gap:8px} .ai .av{width:24px;height:24px;font-size:11px} .col{min-width:0;flex:1;display:flex;flex-direction:column;gap:6px}
      .text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
      .tools summary{font-size:10px;color:var(--mf);cursor:pointer} .tools div{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
      .tools span{overflow-wrap:anywhere;background:var(--muted);color:var(--mf);border-radius:6px;padding:1px 6px;font-size:10px}
      .alert{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:3px}
      .alert b{font-size:11px;color:var(--warn);font-weight:600} .alert .at{font-size:12px;overflow-wrap:anywhere} .alert .as{font-size:11px;color:var(--mf)}
      .alert summary{font-size:11px;color:var(--mf);cursor:pointer} .alert pre{margin:4px 0 0;font:10px/1.5 ui-monospace,Menlo,monospace;color:var(--mf);white-space:pre-wrap;overflow-wrap:anywhere}
      .tip button{align-self:flex-start;margin-top:4px;border:1px solid var(--pri);background:var(--pri);color:var(--prf);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer} .tip button.warn{background:var(--warn);border-color:var(--warn)} .tip button:disabled{opacity:.6;cursor:default}
      .tip{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:4px;margin:2px 0}
      .tt{font-size:11px;font-weight:500;color:var(--mf)} .text code{background:var(--muted);border-radius:4px;padding:0 4px;font:11px ui-monospace,Menlo,monospace} .text code{cursor:pointer} .text code:hover{outline:1px solid var(--mf)} .text code.copied{outline:1px solid #4ade80} .gap{height:6px}
      .starters{display:flex;flex-wrap:wrap;gap:6px;padding-left:32px}
      .starters button{border:1px solid var(--line);border-radius:14px;padding:3px 10px;font-size:11px} .starters button:hover{background:var(--muted)}
      #error{margin:0 12px 8px;color:#dc2626;font-size:12px;white-space:pre-wrap}
      form{border-top:1px solid var(--line);padding:10px}
      .field{display:flex;align-items:center;gap:8px;height:40px;border:1px solid var(--line);border-radius:8px;padding:0 6px 0 12px}
      .field:focus-within{border-color:var(--mf)}
      input{flex:1;min-width:0;border:0;background:none;outline:none!important} input::placeholder{color:var(--mf)}
      #send{width:28px;height:28px;border-radius:6px;background:var(--pri);color:var(--prf);font-size:14px}
      #plan-btn{display:block;width:100%;margin:0 0 6px;padding:2px 4px;border-radius:6px;font-size:11px;color:var(--mf);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #plan-btn:hover{background:var(--muted);color:var(--fg)}
      #plan{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;padding:12px}
      #plan .hint{font-size:11px;color:var(--mf);margin:0}
      #plan-q{flex:none;height:32px} #plan-q,#plan-note{width:100%;border:1px solid var(--line);border-radius:8px;background:none;padding:6px 10px;outline:none} #plan-q:focus,#plan-note:focus{border-color:var(--mf)}
      #plan-list{flex:1;min-height:80px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px}
      #plan-list h4{margin:6px 6px 2px;font-size:10px;font-weight:500;color:var(--mf)}
      #plan-list label{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:6px;font-size:12px;cursor:pointer} #plan-list label:hover{background:var(--muted)}
      #plan-list input{flex:none;accent-color:var(--pri)}
      #plan .lbl{font-size:11px;font-weight:500;color:var(--mf)}
      #plan-note{resize:none;font:inherit;font-size:12px;height:76px}
      .pa{display:flex;align-items:center;gap:8px} #plan-count{flex:1;font-size:11px;color:var(--mf)}
      .pa button{border:1px solid var(--line);border-radius:6px;padding:4px 12px;font-size:12px} .pa .primary{background:var(--pri);color:var(--prf);border-color:var(--pri)}
      :host(.embed) #box{width:100%;height:100%;border:0;border-radius:0;box-shadow:none} :host(.embed) .dock,:host(.embed) #tutorial{display:none!important}
      #memory{margin-top:6px;padding:0 4px;font-size:10px;color:var(--mf);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #memory:empty{display:none}
    </style><section id="box" hidden aria-label="角色助理"><header><div class="av" aria-hidden="true">✦</div><div class="who"><div><span id="title">助理</span> <span id="sub"></span></div><div id="state"></div></div><span id="model" class="chip" hidden></span><button id="new" class="icon" type="button" title="新對話" aria-label="新對話">↺</button><button id="close" class="icon" type="button" title="收起" aria-label="收起助理">—</button></header><div id="plan" hidden><p class="hint">勾選的攻略與指示會帶進這隻角色的每次對話。</p><input id="plan-q" type="search" placeholder="搜尋攻略…" aria-label="搜尋攻略"/><div id="plan-list" role="group" aria-label="攻略清單"></div><label class="lbl" for="plan-note">我的指示</label><textarea id="plan-note" maxlength="1000" placeholder="例：走 AGI 爆擊路線；不買超過 5 萬 zeny 的裝備"></textarea><div class="pa"><span id="plan-count"></span><button id="plan-cancel" type="button">取消</button><button id="plan-save" class="primary" type="button">儲存</button></div></div><div id="tutorial"></div><div id="messages" role="log" aria-label="角色對話"></div><div id="error" role="alert" hidden></div><form><button id="plan-btn" type="button" aria-expanded="false"></button><div class="field"><input aria-label="詢問角色" placeholder="問這隻角色的事…" maxlength="2000" required/><button id="send" type="submit" aria-label="送出">↑</button></div><div id="memory" aria-live="polite"></div></form></section><div class="dock"><button id="nudge" type="button" hidden></button><button id="pill" type="button" aria-expanded="false"><span class="av" aria-hidden="true">✦</span><span id="pill-label">助理</span><span id="badge" hidden></span></button></div>`;
    if (embed) opts.mount.replaceChildren(host); else document.body.append(host);
    const $ = (id) => root.getElementById(id);
    const invoke = (cmd,args={}) => window.__TAURI__.core.invoke(cmd,args);
    const el = (tag,cls='',text='') => { const n = document.createElement(tag); if(cls) n.className = cls; if(text) n.textContent = text; return n; };
    let name = null, busy = false, generation = 0, restored = false;
    const tutorial = embed ? {refresh: async () => {}} : window.roIdleTutorial($('tutorial'),invoke,()=>name);
    let unread = 0, nudge = '', alertAt = 0;
    const pill = () => {
      $('pill-label').textContent = `問 ${name}`;
      $('badge').textContent = String(unread); $('badge').hidden = !unread;
      $('pill').setAttribute('aria-label',`問 ${name}${unread ? ` · ${unread} 則未讀` : ''}`);
      $('nudge').textContent = nudge; $('nudge').hidden = !unread || !nudge || !$('box').hidden;
    };
    const alerts = async () => {
      const current = generation;
      try { const info = await invoke('chat_alerts',{character:name}); if(current === generation) {unread = info.unread; nudge = info.nudge; pill();} } catch {}
    };
    const showError = (e='') => { $('error').textContent = String(e); $('error').hidden = !e; };
    const scroll = () => { $('messages').scrollTop = $('messages').scrollHeight; };
    // Tool calls fold into one line ("⌕ 3 次查詢：角色狀態、查詢攻略"); open it for the full calls.
    const toolCalls = new WeakMap();
    const toolBox = () => {
      const box = el('details','tools'), sum = el('summary'), list = el('div');
      box.hidden = true; box.append(sum,list); toolCalls.set(box,{calls:[],sum,list}); return box;
    };
    const addTool = (box,call) => {
      const {calls,sum,list} = toolCalls.get(box); calls.push(call);
      list.append(el('span','',call));
      const counts = new Map();
      for (const c of calls) { const n = c.split(/\s/)[0]; counts.set(n,(counts.get(n) ?? 0) + 1); }
      sum.textContent = `⌕ ${calls.length} 次查詢：${[...counts].map(([n,k]) => `${TOOL_LABELS[n] ?? n}${k > 1 ? ` ×${k}` : ''}`).join('、')}`;
      box.hidden = false;
    };
    // "> DEX 40" / "> DEX +10" tip lines → one button that writes them into the game's 自動配點.
    // Two clicks: stat points can't be taken back in game.
    const STAT = /^\s*(STR|AGI|VIT|INT|DEX|LUK)\s*[:：]?\s*([+＋])?\s*(\d{1,2})\b/i;
    const statButton = (tip,rows) => {
      if (!rows.length) return;
      // Game window: its own hook. Panel: Rust runs the same hook in that character's window.
      const apply = typeof window.__roIdleStatsAuto === 'function' ? window.__roIdleStatsAuto : (r) => invoke('apply_stats',{character:name,rows:r});
      const b = el('button','','套用到自動配點'); b.type = 'button'; let armed = false;
      b.onclick = async () => {
        if (!armed) { armed = true; b.className = 'warn'; b.textContent = '確定？加下去不能退回'; setTimeout(() => { if (armed && !b.disabled) { armed = false; b.className = ''; b.textContent = '套用到自動配點'; } },4000); return; }
        b.disabled = true; b.textContent = typeof window.__roIdleStatsAuto === 'function' ? '套用中…' : '上線並套用中…';
        try { const list = await apply(rows); b.className = ''; b.textContent = `✓ 已套用：${list.map(r => `${r.stat.toUpperCase()} ${r.target}`).join('、')}`; }
        catch (e) { b.disabled = false; armed = false; b.className = ''; b.textContent = `失敗：${e.message || e}，再試一次`; }
      };
      tip.append(b);
    };
    // Replies use a plain-text convention (see chat.rs preamble): **bold**, `code`, "> " tip lines, final "追問：a｜b".
    const FOLLOW = /^追問[:：]/;
    const inline = (parent,line) => {
      for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
        if (!part) continue;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) parent.append(el('b','',part.slice(2,-2)));
        else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
          // Click a `code` span (map id, item name…) to copy it.
          const c = el('code','',part.slice(1,-1)); c.title = '點擊複製';
          c.onclick = () => navigator.clipboard?.writeText(c.textContent).then(() => { c.classList.add('copied'); setTimeout(() => c.classList.remove('copied'), 900); });
          parent.append(c);
        }
        else parent.append(el('span','',part));
      }
    };
    const format = (body,text) => {
      body.replaceChildren();
      const lines = text.split('\n'); let follow = [], tip = null, stats = [];
      const close = () => { if (tip) statButton(tip,stats); tip = null; stats = []; };
      if (FOLLOW.test((lines[lines.length - 1] ?? '').trim())) follow = lines.pop().trim().replace(FOLLOW,'').split(/[｜|]/).map((q)=>q.trim()).filter(Boolean).slice(0,2);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      for (const line of lines) {
        if (line.startsWith('>')) {
          const t = line.replace(/^>\s?/,'');
          if (!tip) { tip = el('div','tip'); body.append(tip); if (t.trim() === '建議改法') { tip.append(el('div','tt',t.trim())); continue; } }
          const d = el('div'); inline(d,t); tip.append(d);
          const m = STAT.exec(t.replace(/\*\*|`/g,''));
          if (m) stats.push({stat: m[1].toLowerCase(), n: Number(m[3]), add: !!m[2]});
        } else { close(); const d = el('div',line.trim() ? '' : 'gap'); inline(d,line); body.append(d); }
      }
      close();
      return follow;
    };
    const card = (role,text,tools=[]) => {
      if (role === 'user') { const body = el('div','me',text); $('messages').append(body); scroll(); return {body}; }
      const row = el('div','ai'), col = el('div','col'), chips = toolBox(), body = el('div','text');
      for (const t of tools) addTool(chips,t);
      const follow = format(body,text);
      col.append(chips,body); row.append(el('div','av','✦'),col); $('messages').append(row); scroll(); return {body,chips,follow};
    };
    // Alert rows hold a headline, a one-line summary and the raw log lines before the event; fold the raw lines.
    const alertCard = (text) => {
      const [head, rest=''] = text.split('\n\n');
      const lines = head.split('\n'), ms = /(\d{12,})/.exec(lines[0]);
      const box = el('div','alert');
      box.append(el('b','',ms ? `⚠ 紀錄事件 · ${new Date(Number(ms[1])).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})}` : lines[0]));
      if (lines.length > 1) box.append(el('div','at',lines.slice(1).join(' ')));
      const [summary='', ...context] = rest.split('\n');
      if (summary) box.append(el('div','as',summary));
      if (context.length) { const d = el('details'); d.append(el('summary','',`最近 ${context.length} 筆紀錄`),el('pre','',context.join('\n'))); box.append(d); }
      const row = el('div','ai'), col = el('div','col'); col.append(box); row.append(el('div','av','✦'),col); $('messages').append(row);
    };
    const starters = (questions) => {
      const wrap = el('div','starters');
      for (const q of questions) { const b = el('button','',q); b.type = 'button'; b.addEventListener('click',()=>{ root.querySelector('form input').value = q; root.querySelector('form').requestSubmit(); }); wrap.append(b); }
      $('messages').append(wrap);
    };
    const render = (rows) => {
      $('messages').replaceChildren();
      let last = null;
      for (const r of rows) if (!r.message && r.role !== 'summary' && r.text) {
        if (r.event_id) { alertCard(r.text); last = null; } else { const c = card(r.role,r.text,r.tools); last = r.role === 'user' ? null : c; }
      }
      if (!$('messages').childElementCount) { card('assistant',`想了解 ${name} 的狀態或戰鬥紀錄嗎？`); starters(STARTERS); }
      else if (last?.follow?.length) starters(last.follow);
      scroll();
    };
    const memory = async () => {
      const current = generation;
      const info = await invoke('chat_memory',{character:name});
      if(current === generation) $('memory').textContent = info.fact ? `記得：${info.fact} · 記憶 ${info.count} 則` : `記憶 ${info.count} 則`;
    };
    const restore = async () => {
      if (!name) return;
      const current = generation;
      try { const rows = await invoke('chat_history',{character:name}); if (current === generation) { render(rows); restored = true; await memory(); const saved = await invoke('chat_plan',{character:name}); if (current === generation) { plan = {...plan, ...saved}; followLine(); } } }
      catch(e) { if (current === generation) showError(e); }
    };
    const state = (info) => {
      if (typeof info?.name !== 'string') return;
      if (name !== info.name) {
        name = info.name; generation++; restored = false; busy = false; unread = 0; nudge = ''; alertAt = 0;
        $('send').disabled = false; $('new').disabled = false; $('messages').replaceChildren(); $('memory').textContent = ''; showError(); tutorial.refresh();
        plan = {pages:[],suggested:[],selected:[],note:''}; followLine(); if (!$('plan').hidden) showPlan(false);
      }
      pill();
      if(Date.now() - alertAt > 3000) {alertAt = Date.now(); alerts();}
      $('title').textContent = name;
      $('sub').textContent = `· ${info.class ?? ''} Lv${info.base ?? '?'}`;
      if (typeof info.model === 'string') { $('model').textContent = info.model; $('model').hidden = !info.model; }
      if (!$('box').hidden && !restored && !busy) restore();
      $('state').textContent = `${info.map ?? '?'} · ${info.running ? '掛機中' : '已停止'} · HP ${info.hp ?? '?'}/${info.maxHp ?? '?'}`;
    };
    const open = async (value) => {
      $('box').hidden = !value; $('pill').hidden = value; $('pill').setAttribute('aria-expanded',String(value)); pill();
      if (value) {
        try { state(await invoke('chat_character',who)); } catch(e) { showError(e); }
        if (!restored) await restore();
        await tutorial.refresh();
        root.querySelector('form input').focus();
      } else $('pill').focus();
    };
    const onPill = async()=>{
      if(unread && !busy) {
        const current = generation, character = name;
        await open(true);
        if(current !== generation) return;
        try {const view = await invoke('chat_alert_open',{character});if(current === generation && !$('box').hidden) {render(view.rows); for(let start = 0; start < view.ids.length; start += 1000) {if(current !== generation) break; const info = await invoke('chat_alert_ack',{character,ids:view.ids.slice(start,start+1000)}); if(current === generation){unread = info.unread; nudge = info.nudge; pill();}}}}
        catch(e){if(current === generation) showError(e);}
      } else await open($('box').hidden);
    };
    // Guides and a free-text note the player pins to this character's chat context.
    const MAX_PAGES = 3; let plan = {pages:[],suggested:[],selected:[],note:''};
    const followLine = () => {
      const parts = [...plan.selected, plan.note ? '我的指示' : ''].filter(Boolean);
      $('plan-btn').textContent = parts.length ? `📖 跟隨：${parts.join('、')}` : '📖 選擇要跟隨的攻略…';
    };
    let chosen = new Set(), boxes = [];
    const planList = () => {
      const q = $('plan-q').value.trim(), show = (t) => !q || t.includes(q);
      $('plan-list').replaceChildren(); boxes = [];
      const group = (title,items) => {
        if (!items.length) return; $('plan-list').append(el('h4','',title));
        for (const t of items) { const l = el('label'), c = el('input'); c.type = 'checkbox'; c.value = t; c.checked = chosen.has(t); boxes.push(c); l.append(c,el('span','',t)); $('plan-list').append(l); }
      };
      group('本職業',plan.suggested.filter(show)); group('全部攻略',plan.pages.filter((t)=>!plan.suggested.includes(t) && show(t)));
      if (!$('plan-list').childElementCount) $('plan-list').append(el('h4','','沒有符合的攻略'));
      count();
    };
    const count = () => {
      $('plan-count').textContent = `已選 ${chosen.size}／${MAX_PAGES}`;
      for (const c of boxes) c.disabled = !c.checked && chosen.size >= MAX_PAGES;
    };
    const showPlan = async (value) => {
      for (const id of ['messages','tutorial','error']) $(id).hidden = value || (id === 'error' && !$('error').textContent);
      root.querySelector('form').hidden = value; $('plan').hidden = !value;
      $('plan-btn').setAttribute('aria-expanded',String(value));
      if (!value) { $('plan-btn').focus(); return; }
      try { plan = {...plan, ...(await invoke('chat_plan',{character:name}))}; } catch(e) { showError(e); }
      chosen = new Set(plan.selected); $('plan-q').value = ''; $('plan-note').value = plan.note; planList(); $('plan-q').focus();
    };
    $('plan-btn').addEventListener('click',()=>showPlan($('plan').hidden));
    $('plan-cancel').addEventListener('click',()=>showPlan(false));
    $('plan-q').addEventListener('input',planList);
    $('plan-list').addEventListener('change',(e)=>{ if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value); count(); });
    $('plan-save').addEventListener('click',async()=>{
      const pages = [...chosen], note = $('plan-note').value.trim();
      const current = generation;
      try { const saved = await invoke('chat_plan_set',{character:name,pages,note}); if (current === generation) { plan = {...plan, ...saved}; followLine(); showPlan(false); } }
      catch(e) { if (current === generation) showError(e); }
    });
    followLine();
    $('pill').addEventListener('click',onPill);
    $('nudge').addEventListener('click',onPill);
    const close = () => embed ? opts.onClose?.() : open(false);
    $('close').addEventListener('click',close);
    root.addEventListener('keydown',(e)=>{if(e.key === 'Escape') close();});
    if (!embed) window.addEventListener('ro-idle-chat-state',(e)=>state(e.detail));
    $('new').addEventListener('click',async()=>{
      if (busy || !name) return;
      const current = generation;
      try { await invoke('chat_new',{character:name}); if(current === generation) {render([]);showError();} }
      catch(e) { if(current === generation) showError(e); }
    });
    root.querySelector('form').addEventListener('submit',async(e)=>{
      e.preventDefault(); const input = root.querySelector('form input'); const text = input.value.trim();
      if (busy || !name || !text) return;
      const current = generation; const character = name;
      busy = true; $('send').disabled = true; $('new').disabled = true; showError();
      card('user',text); const answer = card('assistant','讀取中…'); let content = '';
      const onEvent = new window.__TAURI__.core.Channel();
      onEvent.onmessage = (event) => {
        if (current !== generation) return;
        if (event.kind === 'text') {content += event.text; format(answer.body,content);}
        if (event.kind === 'tool') addTool(answer.chips,event.name);
        scroll();
      };
      try { const rows = await invoke('chat_send',{character,text,onEvent}); if(current === generation) {render(rows); input.value = ''; await memory();} }
      catch(e) { if(current === generation) {showError(e); await restore();} }
      finally { if(current === generation) {busy = false; $('send').disabled = false; $('new').disabled = false;} }
    });
    if (!embed) { invoke('chat_character').then(state).catch(()=>{}); return; }
    // Embedded opens straight away, on its unread log events when there are any.
    (async () => {
      try { state(await invoke('chat_character',who)); await alerts(); await onPill(); }
      catch(e) { $('box').hidden = false; showError(e); }
    })();
  };
  window.roIdleCharacterChat = (mount, character, onClose) => boot({mount, character, onClose});
  if (embedOnly) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',()=>boot(),{once:true}); else boot();
})();

// Injected into each game window. Secrets and model calls belong to Rust.
(() => {
  if (window !== window.top) return;
  const TOOL_LABELS = {list_characters:'角色列表',get_character:'角色狀態',get_log_summary:'讀取紀錄',game_lookup:'查詢資料',rank_maps:'地圖排名',remember:'記住',update_memory:'更新記憶',forget:'忘記',recall:'回想'};
  const STARTERS = ['為什麼剛才死亡？','最近效率如何？','下一步怎麼升級？'];
  const boot = () => {
    if (document.getElementById('ro-idle-assistant')) return;
    const host = document.createElement('div');
    host.id = 'ro-idle-assistant';
    host.style.cssText = 'all:initial;position:fixed;right:14px;bottom:14px;z-index:2147483647;';
    const root = host.attachShadow({mode:'closed'});
    root.innerHTML = `<style>
      :host{all:initial;--bg:#fff;--fg:#09090b;--muted:#f4f4f5;--mf:#71717a;--line:#e4e4e7;--pri:#18181b;--prf:#fafafa;--warn:#b45309}
      #box,.dock{font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;color:var(--fg);text-align:left}
      @media(prefers-color-scheme:dark){:host{--bg:#111114;--fg:#fafafa;--muted:#27272a;--mf:#a1a1aa;--line:#2e2e33;--pri:#fafafa;--prf:#18181b;--warn:#fbbf24}}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,input{font:inherit;color:inherit} button{cursor:pointer;border:0;background:none;padding:0}
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
      .tools{display:flex;flex-wrap:wrap;gap:4px} .tools:empty{display:none}
      .tools span{background:var(--muted);color:var(--mf);border-radius:6px;padding:1px 6px;font-size:10px}
      .alert{border:1px solid var(--line);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:3px}
      .alert b{font-size:11px;color:var(--warn);font-weight:600} .alert .at{font-size:12px;overflow-wrap:anywhere} .alert .as{font-size:11px;color:var(--mf)}
      .alert summary{font-size:11px;color:var(--mf);cursor:pointer} .alert pre{margin:4px 0 0;font:10px/1.5 ui-monospace,Menlo,monospace;color:var(--mf);white-space:pre-wrap;overflow-wrap:anywhere}
      .tip{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:4px;margin:2px 0}
      .tt{font-size:11px;font-weight:500;color:var(--mf)} .text code{background:var(--muted);border-radius:4px;padding:0 4px;font:11px ui-monospace,Menlo,monospace} .gap{height:6px}
      .starters{display:flex;flex-wrap:wrap;gap:6px;padding-left:32px}
      .starters button{border:1px solid var(--line);border-radius:14px;padding:3px 10px;font-size:11px} .starters button:hover{background:var(--muted)}
      #error{margin:0 12px 8px;color:#dc2626;font-size:12px;white-space:pre-wrap}
      form{border-top:1px solid var(--line);padding:10px}
      .field{display:flex;align-items:center;gap:8px;height:40px;border:1px solid var(--line);border-radius:8px;padding:0 6px 0 12px}
      .field:focus-within{border-color:var(--mf)}
      input{flex:1;min-width:0;border:0;background:none;outline:none!important} input::placeholder{color:var(--mf)}
      #send{width:28px;height:28px;border-radius:6px;background:var(--pri);color:var(--prf);font-size:14px}
      #memory{margin-top:6px;padding:0 4px;font-size:10px;color:var(--mf);white-space:nowrap;overflow:hidden;text-overflow:ellipsis} #memory:empty{display:none}
    </style><section id="box" hidden aria-label="角色助理"><header><div class="av" aria-hidden="true">✦</div><div class="who"><div><span id="title">助理</span> <span id="sub"></span></div><div id="state"></div></div><span id="model" class="chip" hidden></span><button id="new" class="icon" type="button" title="新對話" aria-label="新對話">↺</button><button id="close" class="icon" type="button" title="收起" aria-label="收起助理">—</button></header><div id="tutorial"></div><div id="messages" role="log" aria-label="角色對話"></div><div id="error" role="alert" hidden></div><form><div class="field"><input aria-label="詢問角色" placeholder="問這隻角色的事…" maxlength="2000" required/><button id="send" type="submit" aria-label="送出">↑</button></div><div id="memory" aria-live="polite"></div></form></section><div class="dock"><button id="nudge" type="button" hidden></button><button id="pill" type="button" aria-expanded="false"><span class="av" aria-hidden="true">✦</span><span id="pill-label">助理</span><span id="badge" hidden></span></button></div>`;
    document.body.append(host);
    const $ = (id) => root.getElementById(id);
    const invoke = (cmd,args={}) => window.__TAURI__.core.invoke(cmd,args);
    const el = (tag,cls='',text='') => { const n = document.createElement(tag); if(cls) n.className = cls; if(text) n.textContent = text; return n; };
    let name = null, busy = false, generation = 0, restored = false;
    const tutorial = window.roIdleTutorial($('tutorial'),invoke,()=>name);
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
    const addTool = (chips,tool) => chips.append(el('span','',`⌕ ${TOOL_LABELS[tool] ?? tool}`));
    // Replies use a plain-text convention (see chat.rs preamble): **bold**, `code`, "> " tip lines, final "追問：a｜b".
    const FOLLOW = /^追問[:：]/;
    const inline = (parent,line) => {
      for (const part of line.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
        if (!part) continue;
        if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) parent.append(el('b','',part.slice(2,-2)));
        else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) parent.append(el('code','',part.slice(1,-1)));
        else parent.append(el('span','',part));
      }
    };
    const format = (body,text) => {
      body.replaceChildren();
      const lines = text.split('\n'); let follow = [], tip = null;
      if (FOLLOW.test((lines[lines.length - 1] ?? '').trim())) follow = lines.pop().trim().replace(FOLLOW,'').split(/[｜|]/).map((q)=>q.trim()).filter(Boolean).slice(0,2);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      for (const line of lines) {
        if (line.startsWith('>')) {
          const t = line.replace(/^>\s?/,'');
          if (!tip) { tip = el('div','tip'); body.append(tip); if (t.trim() === '建議改法') { tip.append(el('div','tt',t.trim())); continue; } }
          const d = el('div'); inline(d,t); tip.append(d);
        } else { tip = null; const d = el('div',line.trim() ? '' : 'gap'); inline(d,line); body.append(d); }
      }
      return follow;
    };
    const card = (role,text,tools=[]) => {
      if (role === 'user') { const body = el('div','me',text); $('messages').append(body); scroll(); return {body}; }
      const row = el('div','ai'), col = el('div','col'), chips = el('div','tools'), body = el('div','text');
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
      for (const q of questions) { const b = el('button','',q); b.type = 'button'; b.addEventListener('click',()=>{ root.querySelector('input').value = q; root.querySelector('form').requestSubmit(); }); wrap.append(b); }
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
      try { const rows = await invoke('chat_history',{character:name}); if (current === generation) { render(rows); restored = true; await memory(); } }
      catch(e) { if (current === generation) showError(e); }
    };
    const state = (info) => {
      if (typeof info?.name !== 'string') return;
      if (name !== info.name) {
        name = info.name; generation++; restored = false; busy = false; unread = 0; nudge = ''; alertAt = 0;
        $('send').disabled = false; $('new').disabled = false; $('messages').replaceChildren(); $('memory').textContent = ''; showError(); tutorial.refresh();
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
        try { state(await invoke('chat_character')); } catch(e) { showError(e); }
        if (!restored) await restore();
        await tutorial.refresh();
        root.querySelector('input').focus();
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
    $('pill').addEventListener('click',onPill);
    $('nudge').addEventListener('click',onPill);
    $('close').addEventListener('click',()=>open(false));
    root.addEventListener('keydown',(e)=>{if(e.key === 'Escape') open(false);});
    window.addEventListener('ro-idle-chat-state',(e)=>state(e.detail));
    $('new').addEventListener('click',async()=>{
      if (busy || !name) return;
      const current = generation;
      try { await invoke('chat_new',{character:name}); if(current === generation) {render([]);showError();} }
      catch(e) { if(current === generation) showError(e); }
    });
    root.querySelector('form').addEventListener('submit',async(e)=>{
      e.preventDefault(); const input = root.querySelector('input'); const text = input.value.trim();
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
    invoke('chat_character').then(state).catch(()=>{});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();

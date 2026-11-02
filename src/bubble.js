// Injected into each game window. Secrets and model calls belong to Rust.
(() => {
  if (window !== window.top) return;
  const boot = () => {
    if (document.getElementById('ro-idle-assistant')) return;
    const host = document.createElement('div');
    host.id = 'ro-idle-assistant';
    host.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const root = host.attachShadow({mode:'closed'});
    root.innerHTML = `<style>
      :host{all:initial;font:13px -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;color:#20242c;}
      *{box-sizing:border-box} [hidden]{display:none!important}
      button,input{font:inherit} button{cursor:pointer;color:inherit;border:1px solid #c9ced6;border-radius:7px;background:#fff;padding:7px 11px}
      button:focus-visible,input:focus-visible{outline:2px solid #4f72c4;outline-offset:2px}button:disabled{opacity:.6;cursor:default}
      #pill{box-shadow:0 3px 16px #0003;border-radius:20px} #box{width:min(370px,calc(100vw - 36px));height:min(510px,calc(100vh - 80px));background:#f6f7f9;border:1px solid #c9ced6;border-radius:12px;box-shadow:0 7px 30px #0003;display:flex;flex-direction:column;gap:10px;padding:12px;margin-bottom:8px}
      header{display:flex;align-items:center;justify-content:space-between;gap:5px}#state{color:#626b7a;font-size:11px;line-height:1.5}#messages{overflow:auto;flex:1;min-height:0}article{border:1px solid #dce0e7;border-radius:8px;background:white;padding:9px;margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.user{margin-left:20px;background:#eff3fb}.tools{font-size:10px;color:#626b7a}form{display:flex;gap:6px}input{width:100%;min-width:0;border:1px solid #c9ced6;border-radius:7px;background:#fff;color:#20242c;padding:8px}#error{color:#b32016;white-space:pre-wrap}
      @media(prefers-color-scheme:dark){:host{color:#e5e7ec}#box{background:#252a35}button,input,article{background:#1e222b;color:#e5e7ec;border-color:#485062}.user{background:#29344d}#state,.tools{color:#afb7c7}#error{color:#ff8f85}}
    </style><section id="box" hidden aria-label="角色助理"><header><b id="title">✦ 助理</b><button id="new" type="button">新對話</button><button id="close" type="button" aria-label="關閉助理">×</button></header><div id="state"></div><div id="messages" role="log" aria-label="角色對話"></div><div id="memory" class="tools" aria-live="polite"></div><div id="error" role="alert" hidden></div><form><input aria-label="詢問角色" placeholder="為什麼剛才死亡？" maxlength="2000" required/><button id="send" type="submit">送出</button></form></section><button id="pill" type="button" aria-expanded="false">✦ 助理</button>`;
    document.body.append(host);
    const $ = (id) => root.getElementById(id);
    const invoke = (cmd,args={}) => window.__TAURI__.core.invoke(cmd,args);
    let name = null, busy = false, generation = 0, restored = false;
    const showError = (e='') => { $('error').textContent = String(e); $('error').hidden = !e; };
    const scroll = () => { $('messages').scrollTop = $('messages').scrollHeight; };
    const card = (role,text,tools=[]) => {
      const article = document.createElement('article'); article.className = role;
      const body = document.createElement('div'); body.textContent = text;
      const chips = document.createElement('div'); chips.className = 'tools'; chips.textContent = tools.join(' · ');
      article.append(body,chips); $('messages').append(article); scroll(); return {body,chips};
    };
    const render = (rows) => {
      $('messages').replaceChildren();
      for (const r of rows) if (!r.message && r.role !== 'summary' && r.text) card(r.role,r.text,r.tools);
      if (!$('messages').childElementCount) card('assistant',`想了解 ${name} 的狀態或戰鬥紀錄嗎？`);
      scroll();
    };
    const memory = async () => {
      const current = generation;
      const info = await invoke('chat_memory',{character:name});
      if(current === generation) $('memory').textContent = `已記住 ${info.count} 則${info.fact ? ` · ${info.fact}` : ''}`;
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
        name = info.name; generation++; restored = false; busy = false;
        $('send').disabled = false; $('new').disabled = false; $('messages').replaceChildren(); $('memory').textContent = ''; showError();
      }
      $('pill').textContent = `問 ${name}`; $('title').textContent = `✦ ${name}`;
      if (!$('box').hidden && !restored && !busy) restore();
      $('state').textContent = `${info.class ?? ''} Lv${info.base ?? '?'} · ${info.map ?? '?'} · ${info.running ? '掛機中' : '已停止'} · HP ${info.hp ?? '?'}/${info.maxHp ?? '?'}`;
    };
    const open = async (value) => {
      $('box').hidden = !value; $('pill').setAttribute('aria-expanded',String(value));
      if (value) {
        try { state(await invoke('chat_character')); } catch(e) { showError(e); }
        if (!restored) await restore();
        root.querySelector('input').focus();
      } else $('pill').focus();
    };
    $('pill').addEventListener('click',()=>open($('box').hidden));
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
        if (event.kind === 'text') {content += event.text; answer.body.textContent = content;}
        if (event.kind === 'tool') answer.chips.textContent += `${event.name} · `;
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

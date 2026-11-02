// Shared UI for the panel and the Shadow DOM bubble; contains no provider code.
window.roIdleTutorial = function(container, invoke, character = () => null) {
  const create = (tag,text='') => Object.assign(document.createElement(tag),{textContent:text});
  const toggle = create('button','教學模式'); toggle.type = 'button'; toggle.setAttribute('aria-pressed','false');
  const progress = create('span'); progress.style.cssText = 'font-size:11px;margin-left:6px';
  const detail = create('details'); detail.hidden = true;
  const summary = create('summary'); summary.style.cursor = 'pointer';
  const path = create('p'); path.style.cssText = 'font-weight:600;overflow-wrap:anywhere';
  const text = create('p'); text.style.cssText = 'font-size:12px;line-height:1.6';
  const learned = create('button','已學會'); learned.type = 'button';
  const error = create('p'); error.setAttribute('role','alert'); error.hidden = true;
  detail.append(summary,path,text,learned); container.append(toggle,progress,detail,error);
  container.style.cssText = 'padding:6px;border:1px solid #9ca3af55;border-radius:7px;flex-shrink:0;max-height:200px;overflow:auto';
  let state = {enabled:false}, request = 0, context, writing = false;
  async function refresh(changes = {}) {
    const mutate = Object.keys(changes).length > 0;
    if(writing) return;
    if(mutate) {writing = true;toggle.disabled = true;learned.disabled = true;}
    const who = character(), current = ++request;
    if(who !== context) {detail.hidden = true;context = who;}
    try {
      const value = await invoke('chat_tutorial',{character:who,...changes});
      if(current !== request || who !== character()) return;
      state = value; toggle.textContent = `教學模式：${value.enabled ? '開啟' : '關閉'}`;
      toggle.setAttribute('aria-pressed',String(value.enabled)); progress.textContent = `${value.learned}/${value.total} 已學會`;
      detail.hidden = !value.offer;
      if(value.offer) {
        summary.textContent = `${value.offer.character} · 下一課：${value.offer.lesson.title}`;
        path.textContent = value.offer.lesson.path; text.textContent = value.offer.lesson.text;
      }
      error.hidden = true;
    } catch(e) {if(current === request && who === character()) {error.textContent = String(e);error.hidden = false;}}
    finally {if(mutate) {writing = false;toggle.disabled = false;learned.disabled = false;if(who !== character()) refresh();}}
  }
  toggle.addEventListener('click',()=>refresh({enabled:!state.enabled}));
  learned.addEventListener('click',()=>{if(state.offer) return refresh({learned:state.offer.lesson.id});});
  setInterval(()=>{if(container.getClientRects().length) refresh();},5000);
  return {refresh};
};

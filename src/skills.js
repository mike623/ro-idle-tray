// Use the game's learnSkills command; the server owns job and prerequisite validation.
async function roIdleApplySkills(rows, characterId, character, current, publish) {
  const initial = current();
  if (!characterId || initial?.character?.name !== character) throw new Error('角色已切換，請重新確認');
  if (!Array.isArray(rows) || !rows.length || rows.length > 30 ||
      rows.some(r => !r || !/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(r.id) || !Number.isInteger(r.target) || r.target < 1 || r.target > 10) ||
      new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('無效的技能建議');
  const results = [];
  for (const row of rows) {
    const s = current();
    if (s?.character?.name !== character) throw new Error('角色已切換；請檢查已套用的技能');
    const level = s.character.skills?.[row.id] ?? 0;
    const result = {...row, level, reason: ''}; results.push(result);
    if (level >= row.target) continue;
    const count = Math.min(row.target - level, s.character.skillPoints ?? 0);
    if (count < 1) { result.reason = '技能點不足'; continue; }
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/commands`, {
        method:'POST', credentials:'same-origin', signal:AbortSignal.timeout(15000),
        headers:{'content-type':'application/json','x-ro-client':'1'},
        body:JSON.stringify({commandId:crypto.randomUUID(),command:{type:'learnSkills',skills:Array(count).fill(row.id)}}),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 429 || response.status >= 500) throw new Error(data.error?.message || `HTTP ${response.status}`);
        result.reason = data.error?.message || `HTTP ${response.status}`; continue;
      }
      const next = data.view?.snapshot;
      if (next?.character?.name !== character || !Number.isInteger(next.character.skills?.[row.id]) ||
          next.character.skills[row.id] <= level) throw new Error('未收到技能升級確認');
      publish(next); result.level = next.character.skills[row.id];
      if (result.level < row.target) result.reason = '技能點不足或僅部分完成';
    } catch (e) {
      // A lost reply may already have spent points: stop, never retry automatically.
      result.reason = `${e.message || e}；結果不確定，請先查看遊戲`;
      for (const rest of rows.slice(results.length)) results.push({...rest,level:current()?.character?.skills?.[rest.id] ?? 0,reason:'未執行'});
      break;
    }
  }
  return results;
}

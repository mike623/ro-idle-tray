// Uses the same authenticated command as the game's map picker.
async function roIdleMove(mapId, characterId, snapshot) {
  if (!characterId || !snapshot?.character || ![...document.querySelectorAll('button.xp-btn.primary')]
    .some(b => /停止掛機|開始掛機|停止中/.test(b.textContent))) {
    throw new Error('No character currently in play');
  }
  if (snapshot.mapId === mapId) return;
  const response = await fetch(`/api/characters/${characterId}/commands`, {
    method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
    headers: {'content-type': 'application/json', 'x-ro-client': '1'},
    body: JSON.stringify({commandId: crypto.randomUUID(), command: {type: 'selectMap', mapId}}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `HTTP ${response.status}`);
  if (data.view?.snapshot?.mapId !== mapId) throw new Error('Map switch was not confirmed');
  return data.view.snapshot;
}

// Pure helpers for the panel's compact (list) view: who needs attention and the status counts.

// Why a live character needs a look now, or null.
export function attention(p, othersIdling) {
  const c = p.info;
  if (p.offline || !c) return null;
  if (c.running === false && !c.stopping && othersIdling) return "已停止，其他角色在掛機";
  if (c.hp != null && c.maxHp && c.hp * 4 < c.maxHp) return `HP ${c.hp} / ${c.maxHp}，低於 25%`;
  // Over 90% weight a character can no longer attack.
  if (c.weight != null && c.weightMax && c.weight * 10 >= c.weightMax * 9) return `負重 ${Math.floor((c.weight / c.weightMax) * 100)}%，無法攻擊`;
  return null;
}

// Counts for the status tiles, each attention reason by profile number, and the
// map every live character shares (shown once in the header), else null.
export function overview(profiles) {
  const live = profiles.filter((p) => !p.offline && p.info);
  const idling = live.filter((p) => p.info.running).length;
  const reasons = new Map();
  for (const p of live) {
    const why = attention(p, idling - (p.info.running ? 1 : 0) > 0);
    if (why) reasons.set(p.n, why);
  }
  const maps = new Set(live.map((p) => p.info.map));
  return {
    reasons,
    counts: { attention: reasons.size, idle: idling, offline: profiles.filter((p) => p.offline).length },
    map: maps.size === 1 ? [...maps][0] ?? null : null,
  };
}

// Whether a profile shows under a status filter: all | attention | idle | offline.
export function shown(p, filter, reasons) {
  if (filter === "attention") return reasons.has(p.n);
  if (filter === "idle") return !p.offline && !!p.info?.running;
  if (filter === "offline") return !!p.offline;
  return true;
}

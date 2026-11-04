import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fights, replay } from './l2-fights.mjs';

// #23 L2 bar: real duration, damage taken and hits landed inside the simulated p5–p95 on ≥ 90% of fights.
// Judged on own-finish fights (all damage from mobHpStart is ours); party-helped fights cannot be replayed solo
// and are reported only. Report: `node tests/l2-fights.mjs 1000`.
test('L2: own-finish fixture fights pass p5–p95 on duration, damage taken and hits (1000 seeds each)', () => {
  const rs = fights.map((f) => replay(f, 1000));
  const own = rs.filter((r) => r.own);
  const rate = own.filter((r) => r.pass).length / own.length;
  assert.ok(own.length >= 150, `own-finish fights ${own.length}`);
  assert.ok(rate >= 0.9, `own-finish pass rate ${(100 * rate).toFixed(1)}%`);
});

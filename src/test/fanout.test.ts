import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapWithLimit } from '../mux/fanout.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('mapWithLimit', () => {
  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(5);
      running -= 1;
      return value * 10;
    });
    assert.equal(peak, 3);
    assert.deepEqual(results, [10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it('keeps input order even when later items finish first', async () => {
    const results = await mapWithLimit(['slow', 'fast'], 2, async (name) => {
      await sleep(name === 'slow' ? 20 : 1);
      return name;
    });
    assert.deepEqual(results, ['slow', 'fast']);
  });

  it('returns an empty array for no items', async () => {
    assert.deepEqual(await mapWithLimit([], 4, async () => 1), []);
  });
});

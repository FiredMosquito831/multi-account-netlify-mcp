// Runs `worker` over every item with at most `limit` calls in flight. Results keep the input order.
// The worker must not throw; callers catch errors per item so one failure cannot stop the rest.
export const mapWithLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
};

// All queue writers run in the background worker. Serialize their read/modify/write
// sections, while leaving capture, scraping, and uploads free to run concurrently.
let pendingMutation = Promise.resolve();

export function withCartMutation(mutate) {
  const result = pendingMutation.then(mutate);
  pendingMutation = result.catch(() => {});
  return result;
}

export function captureKey(item) {
  return JSON.stringify([
    item.customerId, item.userId,
    item.captureId || [item.url, item.screenshotId || null, item.timestamp || null]
  ]);
}

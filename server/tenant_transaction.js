import { getCustomerPool, withTransaction } from './db.js';

// All customer repository work enters through this boundary, including identity
// resolution and completion callbacks. SET LOCAL cannot leak to a pooled request.
// There is deliberately no caller-supplied customer ID or bypass option.
export function withCustomerTransaction(work, options = {}) {
  return withTransaction(async client => {
    await client.query('SET LOCAL ROLE rr_customer_runtime');
    await client.query("SELECT set_config('rr.customer_id', '', true)");
    await client.query('SET LOCAL search_path = pg_catalog, public');
    return work(client);
  }, { ...options, pool: options.pool || getCustomerPool() });
}

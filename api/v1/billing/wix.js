import { handleBilling } from '../../../server/billing_http.js';
export default { fetch: request => handleBilling(request) };

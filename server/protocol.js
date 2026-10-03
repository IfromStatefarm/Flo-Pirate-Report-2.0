// Served by each customer route, so an updated health function cannot hide a
// stale data/bootstrap/membership deployment. This is compatibility, not auth.
export const CUSTOMER_API_CAPABILITY = 'google-operations-v1';

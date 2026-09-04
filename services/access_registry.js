// Compatibility shim for modules that still use the former service name.
// Customer membership is now resolved by the API-backed Google identity bootstrap.
export { createCustomerBootstrapService as createAccessRegistry } from './customer_bootstrap_service.js';

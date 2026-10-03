import { defineConfig } from "@neon/config/v1";

const customerApiEnvironment = {
  CUSTOMER_DATABASE_URL: process.env.CUSTOMER_DATABASE_URL!,
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID!,
  ALLOWED_EXTENSION_IDS: process.env.ALLOWED_EXTENSION_IDS!,
  ALLOWED_EXTENSION_ORIGINS: process.env.ALLOWED_EXTENSION_ORIGINS!,
  ...Object.fromEntries(['GOOGLE_CONNECTORS_JSON', 'LEGACY_GOOGLE_USER_TOKEN_CUSTOMERS']
    .filter(key => Boolean(process.env[key])).map(key => [key, process.env[key]!])),
};
const billingEnvironment = Object.fromEntries(
  ['BILLING_BRIDGE_SECRET', 'BILLING_WIX_ACCOUNT_ID', 'BILLING_WORKER_SECRET']
    .filter(key => typeof process.env[key] === 'string' && process.env[key]!.length > 0)
    .map(key => [key, process.env[key]!])
);

export default defineConfig({
  preview: {
    functions: {
      billing: {
        name: 'Rights Reporter billing receiver',
        source: 'api/v1/billing/wix.js',
        env: billingEnvironment,
      },
      billingprocess: {
        name: 'Rights Reporter billing worker',
        source: 'api/v1/billing/process.js',
        env: billingEnvironment,
      },
      bootstrap: {
        name: "Rights Reporter customer bootstrap",
        source: "api/v1/extension/bootstrap.js",
        env: customerApiEnvironment,
      },
      memberships: {
        name: "Rights Reporter membership administration",
        source: "api/v1/extension/memberships.js",
        env: customerApiEnvironment,
      },
      data: {
        name: "Rights Reporter customer data",
        source: "api/v1/extension/data.js",
        env: {
          ...customerApiEnvironment,
          ...(process.env.YOUTUBE_DATA_API_KEY ? { YOUTUBE_DATA_API_KEY: process.env.YOUTUBE_DATA_API_KEY } : {}),
        },
      },
      health: {
        name: "Rights Reporter API health",
        source: "api/health.js",
      },
    },
  },
});

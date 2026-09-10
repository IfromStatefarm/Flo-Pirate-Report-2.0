import { defineConfig } from "@neon/config/v1";

const customerApiEnvironment = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID!,
  ALLOWED_EXTENSION_IDS: process.env.ALLOWED_EXTENSION_IDS!,
  ALLOWED_EXTENSION_ORIGINS: process.env.ALLOWED_EXTENSION_ORIGINS!,
};

export default defineConfig({
  preview: {
    functions: {
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
        env: customerApiEnvironment,
      },
      health: {
        name: "Rights Reporter API health",
        source: "api/health.js",
      },
    },
  },
});

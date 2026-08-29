import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://127.0.0.1:5173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    // Localnet transactions can be slow to finalize; keep generous timeouts.
    defaultCommandTimeout: 30_000,
    requestTimeout: 30_000,
    pageLoadTimeout: 60_000,
    video: false,
    retries: {
      runMode: 2,
      openMode: 0,
    },
  },
});

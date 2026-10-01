// In-browser demo account test.
//
// Requires:
//   - A running localnet (walletd + indexer) with a funded custom faucet
//     component deployed at `VITE_FAUCET_ADDRESS` — see ../../E2E.md.
//     `tariorg-cli e2e-infra` publishes and funds it during setup.

describe("in-browser demo account", () => {
  it("creates a faucet-funded demo account from the account popover", () => {
    cy.visit("/");

    // Open the account popover and create a demo account.
    cy.get('[data-testid="account-button"]').click();
    cy.get('[data-testid="create-demo-account"]').click();

    // The demo account becomes active: its "keys are in memory" disclaimer
    // appears in the popover once the faucet claim has finalized.
    cy.contains("keys are in memory", { timeout: 90_000 }).should("be.visible");
  });
});

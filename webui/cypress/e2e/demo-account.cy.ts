// In-browser demo account test.
//
// Requires:
//   - A running localnet (walletd + indexer) with the built-in tXTR faucet
//     deployed at `XTR_FAUCET_COMPONENT_ADDRESS` — see ../../E2E.md.

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

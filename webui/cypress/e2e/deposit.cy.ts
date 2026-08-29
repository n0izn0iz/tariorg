// Circular treasury test: deposit funds into an organization, then route them
// back out via a Send proposal (vote + execute) and confirm the treasury empties.
//
// Requires:
//   - A running localnet (walletd + indexer) and a published Organization
//     template — see ../../E2E.md.
//
// The member identity and account component address are read live from the
// account popover (rather than the setup fixture), so the test stays correct
// when the wallet daemon's default account changes.

describe("organization treasury deposit and refund", () => {
  it("deposits, then sends the funds back to the depositor", () => {
    // 1. Create the org with the active account as its sole member (the form is
    //    prefilled with the active account's public key).
    cy.visit("/new-org");
    cy.getAccountPublicKey().then((publicKey) => {
      cy.get("body").type("{esc}");
      cy.getByLabel("Member public key 1").should(
        "have.value",
        publicKey.trim(),
      );
    });
    cy.contains("button", "Create organization").click();
    cy.url({ timeout: 120_000 }).should("match", /\/org\/component_/);

    // 2. Deposit 0.42 TARI (420,000 microTARI at divisibility 6).
    cy.get('[data-testid="open-deposit"]').click();
    cy.get('[data-testid="deposit-amount"]').type("0.42");
    cy.get('[data-testid="deposit-submit"]').click();
    cy.contains("No balances yet.", { timeout: 60_000 }).should("not.exist");

    // 3. Read the account's component address from the account popover so we
    //    can send the funds back to it.
    cy.get('[data-testid="account-button"]').click();
    cy.get('[data-testid="account-component-address"]', { timeout: 30_000 })
      .invoke("text")
      .then((val) => {
        cy.get("body").type("{esc}"); // dismiss the popover

        // 4. Propose a Send that refunds the full amount to the depositor.
        cy.get('[data-testid="action-send"]').click();
        cy.getByLabel("Recipient component address").type(val.trim());
      });
    cy.get('[data-testid="send-amount"]').type("0.42");
    cy.get('[data-testid="propose-submit"]').click();

    // 5. Vote yes (sole member, so quorum is met) and execute.
    cy.contains("Proposal #1", { timeout: 60_000 }).should("be.visible");
    cy.contains("button", "Vote yes").click();
    cy.contains("button", "Execute", { timeout: 60_000 }).click();

    // 6. The treasury is empty again: the deposit was sent back out.
    cy.contains("No balances yet.", { timeout: 60_000 }).should("be.visible");

    // 7. The executed Send proposal appears in the history section.
    cy.get('[data-testid="history"]')
      .contains("Proposal #1", { timeout: 120_000 })
      .should("be.visible");
    cy.get('[data-testid="history"]').contains("tTARI").should("be.visible");
  });
});

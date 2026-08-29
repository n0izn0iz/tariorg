// End-to-end DAO lifecycle test.
//
// Requires:
//   - A running localnet (walletd + indexer) and a published Organization
//     template — see ../../E2E.md.
//
// The member identity is read live from the account popover (rather than the
// setup fixture), so the test stays correct when the wallet daemon's default
// account changes.

describe("DAO lifecycle (requires a running localnet)", () => {
  it("creates an organization and governs it end-to-end", () => {
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

    // 2. Wait for the transaction to finalize and the app to navigate to the org.
    cy.url({ timeout: 120_000 }).should("match", /\/org\/component_/);
    cy.contains("h1", "Organization", { timeout: 60_000 }).should("be.visible");

    // 3. The account is a member (sole member, so the quorum is 1).
    cy.contains("h5", "Member").should("be.visible");
    cy.contains("of 1 member required").should("be.visible");

    // 3b. The three action cards are visible.
    cy.get('[data-testid="action-add-member"]').should("be.visible");
    cy.get('[data-testid="action-remove-member"]').should("be.visible");
    cy.get('[data-testid="action-send"]').should("be.visible");

    // 3c. The Remove-member modal opens with the right fields.
    cy.get('[data-testid="action-remove-member"]').click();
    cy.contains("h2", "Remove member").should("be.visible");
    cy.getByLabel("Member public key").should("be.visible");
    cy.get('[aria-label="Close"]').click();

    // 3d. The Send modal uses whole units and has no resource config.
    cy.get('[data-testid="action-send"]').click();
    cy.contains("h2", "Send funds").should("be.visible");
    cy.getByLabel("Recipient component address").should("be.visible");
    cy.get('[data-testid="send-amount"]').should("be.visible");
    cy.contains("Resource address").should("not.exist");
    cy.get('[aria-label="Close"]').click();

    // 4. Propose adding a (dummy 32-byte) member.
    cy.get('[data-testid="action-add-member"]').click();
    cy.getByLabel("Member public key").type("cd".repeat(32));
    cy.get('[data-testid="propose-submit"]').click();

    // 5. Wait for the proposal, then vote yes.
    cy.contains("Proposal #1", { timeout: 60_000 }).should("be.visible");
    cy.contains("button", "Vote yes").click();

    // 6. Once the vote finalizes, the proposal meets its quorum and can execute.
    cy.contains("button", "Execute", { timeout: 60_000 }).click();

    // 7. Executed proposals leave the active list.
    cy.contains("No proposals yet", { timeout: 60_000 }).should("be.visible");

    // 8. The executed proposal appears in the history section.
    cy.get('[data-testid="history"]')
      .contains("Proposal #1", { timeout: 120_000 })
      .should("be.visible");
  });
});

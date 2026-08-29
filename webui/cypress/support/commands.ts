/// <reference types="cypress" />

// Mark this file as a module so `declare global` can augment the Cypress
// namespace (an augmentation must live inside a module, not a global script).
export {};

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Finds the `<input>` element associated with a MUI TextField by its
       * visible label text (e.g. "Member public key 1").
       */
      getByLabel(label: string): Chainable<JQuery<HTMLElement>>;
      /**
       * Opens the account popover and returns the active account's public key
       * hex. Closes the popover before yielding, so the value can be typed into
       * a member field in the same flow.
       */
      getAccountPublicKey(): Chainable<string>;
    }
  }
}

Cypress.Commands.add("getByLabel", (label: string) => {
  return cy.contains("label", label).then(($label) => {
    const id = $label.attr("for");
    if (!id) {
      throw new Error(`No <label> found with text "${label}"`);
    }
    return cy.get(`#${id}`);
  });
});

Cypress.Commands.add("getAccountPublicKey", () => {
  cy.get('[data-testid="account-button"]').click();
  return cy
    .get('[data-testid="account-public-key"]', { timeout: 30_000 })
    .invoke("text");
});

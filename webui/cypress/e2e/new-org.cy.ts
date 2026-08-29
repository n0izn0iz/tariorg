describe("new organization form", () => {
  beforeEach(() => {
    cy.visit("/new-org");
  });

  it("renders the form prefilled with the active account", () => {
    cy.contains("h1", "Create organization").should("be.visible");
    cy.contains("Approval threshold").should("be.visible");
    cy.contains("Members").should("be.visible");
    cy.getByLabel("Member public key 1").invoke("val").should("not.be.empty");
    cy.contains("button", "Create organization").should("be.enabled");
  });

  it("rejects a non-hex member public key", () => {
    cy.getByLabel("Member public key 1").invoke("val").should("not.be.empty");
    cy.getByLabel("Member public key 1").clear().type("zzzz");
    cy.contains("Must be a hexadecimal public key.").should("be.visible");
  });

  it("rejects a member public key that is not 32 bytes", () => {
    cy.getByLabel("Member public key 1").invoke("val").should("not.be.empty");
    cy.getByLabel("Member public key 1").clear().type("abcd");
    cy.contains("Must decode to 32 bytes (64 hex characters).").should(
      "be.visible",
    );
  });

  it("accepts a valid 32-byte member public key", () => {
    cy.getByLabel("Member public key 1").invoke("val").should("not.be.empty");
    cy.getByLabel("Member public key 1").clear().type("ab".repeat(32));
    cy.contains("Must be a hexadecimal public key.").should("not.exist");
    cy.contains("Must decode to 32 bytes (64 hex characters).").should(
      "not.exist",
    );
    cy.contains("button", "Create organization").should("not.be.disabled");
  });

  it("can add and remove member rows", () => {
    cy.contains("button", "Add member").click();
    cy.contains("Member public key 2").should("be.visible");

    cy.contains("button", "Add member").click();
    cy.contains("Member public key 3").should("be.visible");

    cy.get('button[aria-label="Remove member 3"]').click();
    cy.contains("Member public key 3").should("not.exist");
  });
});

describe("home page", () => {
  beforeEach(() => {
    cy.visit("/");
  });

  it("renders the hero", () => {
    cy.contains("h1", "Decentralized organizations, on-chain.").should(
      "be.visible",
    );
    cy.contains(
      "Create, govern, and coordinate organizations on Tari.",
    ).should("be.visible");
  });

  it("renders the feature cards", () => {
    cy.contains("Decentralized governance").should("be.visible");
    cy.contains("Flexible thresholds").should("be.visible");
    cy.contains("On-chain integrity").should("be.visible");
  });

  it("renders the planned roadmap", () => {
    cy.contains("h2", "Planned").should("be.visible");
    cy.contains("Privacy research topics").should("be.visible");
  });

  it("shows an empty organizations state", () => {
    cy.contains("h2", "Your organizations").should("be.visible");
    cy.contains("No organizations yet").should("be.visible");
  });

  it("navigates to the create-organization page", () => {
    cy.contains("a", "Create organization").first().click();
    cy.url().should("include", "/new-org");
    cy.contains("h1", "Create organization").should("be.visible");
  });
});

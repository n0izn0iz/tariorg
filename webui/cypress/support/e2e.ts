import "./commands";

// React 19 hydration mismatches are non-fatal: React logs them and re-renders
// the tree on the client, so the UI still renders. They're a known consequence
// of React Router v8's dev server doing SSR (its `ssr: false` config only
// affects the production build) while MUI/Emotion injects an
// `emotion-insertion-point` meta that mismatches React Router's critical-CSS
// link on the client. Ignore only these so every other uncaught error still
// fails the test.
Cypress.on("uncaught:exception", (err) => {
  const message = String(err?.message ?? err ?? "");
  if (/hydration/i.test(message) || /Minified React error #4(18|19|22|23|25)/.test(message)) {
    return false;
  }
  return true;
});

beforeEach(() => {
  // Each test starts from a clean organizations store (persisted in localStorage).
  cy.clearLocalStorage();
});

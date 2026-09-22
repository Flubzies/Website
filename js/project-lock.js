(function () {
  const PASSWORD = "!2ArBiTrArY";
  const STORAGE_KEY = "flubzies-early-access";

  function isUnlocked() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "granted";
    } catch (e) {
      return false;
    }
  }

  function grantAccess() {
    try {
      localStorage.setItem(STORAGE_KEY, "granted");
    } catch (e) {}
  }

  const gate = document.getElementById("lockGate");
  const gateForm = document.getElementById("lockGateForm");
  const gateInput = document.getElementById("lockGateInput");
  const gateError = document.getElementById("lockGateError");
  const gateClose = document.getElementById("lockGateClose");

  let pendingUrl = null;

  function openGate(targetUrl) {
    pendingUrl = targetUrl || null;
    if (!gate) return;
    gate.hidden = false;
    gateError.hidden = true;
    gateInput.value = "";
    requestAnimationFrame(() => gateInput.focus());
  }

  function closeGate() {
    if (!gate) return;
    gate.hidden = true;
    pendingUrl = null;
    const redirect = gate.getAttribute("data-redirect");
    if (redirect && document.documentElement.classList.contains("locked")) {
      window.location.href = redirect;
    }
  }

  if (gateForm) {
    gateForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (gateInput.value === PASSWORD) {
        grantAccess();
        document.documentElement.classList.remove("locked");
        gate.hidden = true;
        if (pendingUrl) {
          window.location.href = pendingUrl;
        }
      } else {
        gateError.hidden = false;
        gateInput.value = "";
        gateInput.focus();
      }
    });
  }

  if (gateClose) {
    gateClose.addEventListener("click", closeGate);
  }

  if (gate) {
    gate.addEventListener("click", (e) => {
      if (e.target === gate) closeGate();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && gate && !gate.hidden) closeGate();
  });

  // Whole-page gate for pages not yet public (marked via <html class="locked">).
  if (document.documentElement.classList.contains("locked")) {
    openGate(null);
  }

  // Front-page cards that link to a gated page: prompt before navigating.
  document.querySelectorAll('a.project-card[data-locked="true"]').forEach((card) => {
    card.addEventListener("click", (e) => {
      if (isUnlocked()) return;
      e.preventDefault();
      openGate(card.getAttribute("href"));
    });
  });
})();

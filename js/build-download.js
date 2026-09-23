(function () {
  // Password resets manually, at midnight GMT.
  const PASSWORD = "Aljakun_23092026";
  const DOWNLOAD_URL = "https://github.com/Flubzies/ZetaCore/releases/download/latest-build/Aljakun.zip";

  const trigger = document.getElementById("buildDownloadBtn");
  const gate = document.getElementById("buildGate");
  const form = document.getElementById("buildGateForm");
  const input = document.getElementById("buildGateInput");
  const error = document.getElementById("buildGateError");
  const closeBtn = document.getElementById("buildGateClose");

  if (!trigger || !gate) return;

  function openGate() {
    gate.hidden = false;
    error.hidden = true;
    input.value = "";
    requestAnimationFrame(() => input.focus());
  }

  function closeGate() {
    gate.hidden = true;
  }

  trigger.addEventListener("click", openGate);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value === PASSWORD) {
      closeGate();
      window.location.href = DOWNLOAD_URL;
    } else {
      error.hidden = false;
      input.value = "";
      input.focus();
    }
  });

  closeBtn.addEventListener("click", closeGate);

  gate.addEventListener("click", (e) => {
    if (e.target === gate) closeGate();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !gate.hidden) closeGate();
  });
})();

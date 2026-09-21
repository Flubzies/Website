document.getElementById("year").textContent = new Date().getFullYear();

const navToggle = document.getElementById("navToggle");
const navLinks = document.getElementById("navLinks");

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", isOpen);
});

navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

const cinematicToggle = document.getElementById("cinematicToggle");

if (cinematicToggle) {
  const cinematicLabel = cinematicToggle.querySelector(".cinematic-toggle-label");
  const projectCards = document.querySelectorAll(".project-card");

  cinematicToggle.addEventListener("click", () => {
    const firstRects = Array.from(projectCards).map((card) => card.getBoundingClientRect());

    const isCinematic = document.body.classList.toggle("cinematic-mode");
    cinematicToggle.setAttribute("aria-pressed", isCinematic);
    cinematicLabel.textContent = isCinematic ? "Exit Cinematic Mode" : "Cinematic Mode";

    projectCards.forEach((card, i) => {
      const first = firstRects[i];
      const last = card.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const sx = first.width / last.width;
      const sy = first.height / last.height;

      card.style.transformOrigin = "0 0";
      card.style.transition = "none";
      card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      card.style.opacity = "0.6";
    });

    requestAnimationFrame(() => {
      projectCards.forEach((card) => {
        card.style.transition = "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.5s ease";
        card.style.transform = "";
        card.style.opacity = "";
      });
    });

    projectCards.forEach((card) => {
      card.addEventListener(
        "transitionend",
        () => {
          card.style.transition = "";
          card.style.transformOrigin = "";
        },
        { once: true }
      );
    });
  });
}

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

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

document.querySelectorAll("[data-gallery]").forEach((gallery) => {
  const slides = Array.from(gallery.querySelectorAll(".devlog-img"));
  const dotsContainer = gallery.querySelector(".devlog-gallery-dots");
  if (slides.length < 2 || !dotsContainer) return;

  const dots = slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.className = "devlog-gallery-dot" + (i === 0 ? " is-active" : "");
    dot.setAttribute("aria-label", `Show image ${i + 1} of ${slides.length}`);
    dotsContainer.appendChild(dot);
    return dot;
  });

  let current = 0;
  let timer;

  const goTo = (index) => {
    slides[current].classList.remove("is-active");
    dots[current].classList.remove("is-active");
    current = (index + slides.length) % slides.length;
    slides[current].classList.add("is-active");
    dots[current].classList.add("is-active");
  };

  const start = () => {
    if (prefersReducedMotion) return;
    stop();
    timer = setInterval(() => goTo(current + 1), 3500);
  };

  const stop = () => clearInterval(timer);

  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => {
      goTo(i);
      start();
    });
  });

  gallery.addEventListener("mouseenter", stop);
  gallery.addEventListener("mouseleave", start);
  gallery.addEventListener("focusin", stop);
  gallery.addEventListener("focusout", start);

  start();
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

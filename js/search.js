(function () {
  if (typeof SEARCH_INDEX === "undefined") return;

  const toggle = document.getElementById("navSearchToggle");
  const panel = document.getElementById("navSearchPanel");
  const input = document.getElementById("navSearchInput");
  const results = document.getElementById("navSearchResults");
  if (!toggle || !panel || !input || !results) return;

  const inProjectsDir = location.pathname.indexOf("/projects/") !== -1;
  const prefix = inProjectsDir ? "../" : "";

  function openPanel() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    input.focus();
  }

  function closePanel() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    input.value = "";
    results.innerHTML = "";
  }

  toggle.addEventListener("click", function () {
    if (panel.hidden) {
      openPanel();
    } else {
      closePanel();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !panel.hidden) {
      closePanel();
      toggle.focus();
    }
  });

  document.addEventListener("click", function (e) {
    if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) {
      closePanel();
    }
  });

  function render(query) {
    results.innerHTML = "";
    const q = query.trim().toLowerCase();
    if (!q) return;

    const matches = SEARCH_INDEX.filter(function (entry) {
      const haystack = (
        entry.title +
        " " +
        entry.role +
        " " +
        entry.tags.join(" ")
      ).toLowerCase();
      return haystack.indexOf(q) !== -1;
    }).slice(0, 8);

    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "nav-search-empty";
      empty.textContent = "No projects match “" + query.trim() + "”";
      results.appendChild(empty);
      return;
    }

    matches.forEach(function (entry) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = prefix + entry.url;
      const title = document.createElement("span");
      title.className = "nav-search-result-title";
      title.textContent = entry.title;
      const role = document.createElement("span");
      role.className = "nav-search-result-role";
      role.textContent = entry.role;
      a.appendChild(title);
      a.appendChild(role);
      li.appendChild(a);
      results.appendChild(li);
    });
  }

  input.addEventListener("input", function () {
    render(input.value);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      const first = results.querySelector("a");
      if (first) {
        e.preventDefault();
        window.location.href = first.getAttribute("href");
      }
    }
  });
})();

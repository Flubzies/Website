(function () {
  var details = document.getElementById("devHistoryFold");
  var container = document.getElementById("devHistoryList");
  if (!details || !container) return;

  var loaded = false;

  details.addEventListener("toggle", function () {
    if (details.open && !loaded) {
      loaded = true;
      loadHistory();
    }
  });

  function loadHistory() {
    fetch("/api/dev-history")
      .then(function (res) {
        if (!res.ok) throw new Error("bad response");
        return res.json();
      })
      .then(function (data) {
        renderHistory(data.commits || []);
      })
      .catch(function () {
        loaded = false;
        container.innerHTML =
          '<p class="dev-history-status">Couldn’t load recent activity right now.</p>';
      });
  }

  function renderHistory(commits) {
    if (!commits.length) {
      container.innerHTML =
        '<p class="dev-history-status">No recent activity found.</p>';
      return;
    }

    var items = commits
      .map(function (c) {
        var ts = formatDate(c.date);
        return (
          '<li class="dev-history-row">' +
          '<span class="dev-history-time">' +
          ts +
          "</span>" +
          '<span class="dev-history-hash">' +
          escapeHtml(c.sha) +
          "</span>" +
          '<span class="dev-history-msg">' +
          escapeHtml(c.message) +
          "</span>" +
          "</li>"
        );
      })
      .join("");

    container.innerHTML = '<ul class="dev-history-list">' + items + "</ul>";
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }
})();

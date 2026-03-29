var searchTimer = null;

document.addEventListener("DOMContentLoaded", function () {
  var input = document.getElementById("search-input");
  var results = document.getElementById("search-results");

  input.addEventListener("input", function () {
    clearTimeout(searchTimer);
    var q = input.value.trim();
    if (q.length < 2) {
      results.style.display = "none";
      results.innerHTML = "";
      return;
    }
    searchTimer = setTimeout(function () { doSearch(q); }, 150);
  });

  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      results.style.display = "none";
      input.blur();
    }
  });

  // Close results when clicking elsewhere
  document.addEventListener("click", function (e) {
    if (!e.target.closest("#search-box")) {
      results.style.display = "none";
    }
  });
});

function doSearch(q) {
  var results = document.getElementById("search-results");

  fetch("/api/search?q=" + encodeURIComponent(q))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data || data.length === 0) {
        results.innerHTML = '<div class="search-result" style="color:#999;">No results</div>';
        results.style.display = "block";
        return;
      }

      results.innerHTML = data.map(function (a) {
        var ident = a.icao_id || a.ident;
        var meta = [a.city, a.state].filter(Boolean).join(", ");
        return '<div class="search-result" data-lat="' + a.latitude + '" data-lng="' + a.longitude +
          '" data-ident="' + ident + '">' +
          '<span class="search-result-ident">' + ident + '</span>' +
          '<span class="search-result-name">' + (a.name || "") + '</span>' +
          (meta ? '<div class="search-result-meta">' + meta + '</div>' : '') +
          '</div>';
      }).join("");

      results.querySelectorAll(".search-result").forEach(function (el) {
        el.addEventListener("click", function () {
          var lat = parseFloat(this.dataset.lat);
          var lng = parseFloat(this.dataset.lng);
          var ident = this.dataset.ident;
          if (!isNaN(lat) && !isNaN(lng)) {
            map.setCenter({ lat: lat, lng: lng });
            map.setZoom(12);
          }
          results.style.display = "none";
          document.getElementById("search-input").value = ident;
        });
      });

      results.style.display = "block";
    })
    .catch(function () {
      results.style.display = "none";
    });
}

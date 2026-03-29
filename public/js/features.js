// FAA feature layer system — loads point data from /api/features based on zoom/bounds
var featureLayers = {};   // layerName -> { enabled, markers: [] }
var featureConfig = null;  // from /api/features/config
var featureDebounceTimer = null;
var lastFeatureBounds = null;

// Marker style definitions
var FEATURE_STYLES = {
  airport: {
    icon: function (f) {
      var type = f.type_code || "AD";
      var isMil = f.mil_code === "MIL" || f.mil_code === "ALL";
      var hasIAP = f.iap_exists === 1 || f.iap_exists === "1";
      var isPrivate = f.private_use === 1 || f.private_use === "1";
      // Chart colors: towered/IAP = blue, non-towered = magenta, private = gray
      var color = isMil ? "#78909C" : hasIAP ? "#2196F3" : isPrivate ? "#999" : "#E040FB";
      var scale, path;

      if (type === "HP") {
        // Heliport: H shape
        path = "M -4,-5 L -4,5 M -4,0 L 4,0 M 4,-5 L 4,5";
        scale = 1;
        return { path: path, scale: scale, strokeColor: color, strokeWeight: 2, strokeOpacity: 1, fillOpacity: 0, labelOrigin: new google.maps.Point(0, -3) };
      }
      if (type === "SP") {
        // Seaplane: anchor-ish
        path = google.maps.SymbolPath.FORWARD_CLOSED_ARROW;
        return { path: path, scale: 4, fillColor: color, fillOpacity: 0.8, strokeColor: "#fff", strokeWeight: 0.5, rotation: 180, labelOrigin: new google.maps.Point(0, -3) };
      }

      // Standard airport: circle with tick marks for hard surface
      if (hasIAP || isMil) {
        // Larger, filled circle with tick marks (significant airport)
        path = "M 0,-6 A 6,6 0 1,1 0,6 A 6,6 0 1,1 0,-6 Z M 0,-9 L 0,-6 M 0,6 L 0,9 M -9,0 L -6,0 M 6,0 L 9,0";
        scale = 1;
        return { path: path, scale: scale, fillColor: color, fillOpacity: 0.3, strokeColor: color, strokeWeight: 1.5, strokeOpacity: 1, labelOrigin: new google.maps.Point(0, -3.5) };
      }

      // Small airport: open circle
      scale = isPrivate ? 3 : 4;
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: scale,
        fillColor: isPrivate ? "transparent" : color,
        fillOpacity: isPrivate ? 0 : 0.2,
        strokeColor: color,
        strokeWeight: 1.5,
        strokeOpacity: 0.9,
        labelOrigin: new google.maps.Point(0, -2.5),
      };
    },
    label: function (f) {
      var isPrivate = f.private_use === 1 || f.private_use === "1";
      var isMil = f.mil_code === "MIL" || f.mil_code === "ALL";
      var hasIAP = f.iap_exists === 1 || f.iap_exists === "1";
      var color = isMil ? "#B0BEC5" : hasIAP ? "#64B5F6" : isPrivate ? "#888" : "#EA80FC";
      return {
        text: f.icao_id || f.ident || "",
        color: color,
        fontSize: "10px",
        fontWeight: "500",
      };
    },
    title: function (f) { return (f.icao_id || f.ident) + " — " + (f.name || ""); },
    infoContent: function (f) {
      var id = f.icao_id || f.ident;
      var uid = "apt-popup-" + id.replace(/[^a-zA-Z0-9]/g, "");
      var typeLabels = { AD: "Airport", HP: "Heliport", SP: "Seaplane Base", UL: "Ultralight", GL: "Gliderport", BP: "Balloon Port" };

      var infoRows = [
        ["Name", f.name],
        ["Identifier", f.ident],
        ["ICAO", f.icao_id],
        ["Type", typeLabels[f.type_code] || f.type_code],
        ["Use", f.private_use ? "Private" : "Public"],
        ["Military", f.mil_code === "MIL" ? "Military" : f.mil_code === "ALL" ? "Joint Civil/Military" : null],
        ["Approaches", f.iap_exists ? "Yes" : "No"],
        ["Elevation", f.elevation != null ? f.elevation + " ft" : null],
        ["City", f.city],
        ["State", f.state],
        ["Lat/Lng", f.latitude != null ? f.latitude.toFixed(4) + ", " + f.longitude.toFixed(4) : null],
      ];
      var infoTable = '<table style="border-collapse:collapse;font-size:12px;">';
      for (var i = 0; i < infoRows.length; i++) {
        if (infoRows[i][1] == null || infoRows[i][1] === "") continue;
        infoTable += '<tr><td style="color:#999;padding:1px 8px 1px 0;white-space:nowrap;">' +
          infoRows[i][0] + '</td><td style="padding:1px 0;">' + infoRows[i][1] + '</td></tr>';
      }
      infoTable += '</table>';

      var tabStyle = 'style="padding:4px 8px;font-size:11px;border:none;cursor:pointer;border-radius:3px 3px 0 0;font-weight:500;"';
      var html = '<div style="color:#333;font-size:13px;min-width:240px;max-width:320px;" id="' + uid + '">' +
        '<strong style="font-size:15px;">' + id + '</strong>' +
        '<span style="color:#666;margin-left:6px;font-size:12px;">' + (f.name || "") + '</span>' +
        '<div style="margin-top:6px;display:flex;gap:2px;border-bottom:1px solid #ddd;">' +
          '<button ' + tabStyle + ' class="apt-tab active" data-tab="info" onclick="switchAptTab(\'' + uid + '\',\'info\')">Info</button>' +
          '<button ' + tabStyle + ' class="apt-tab" data-tab="freq" onclick="switchAptTab(\'' + uid + '\',\'freq\')">Freq</button>' +
          '<button ' + tabStyle + ' class="apt-tab" data-tab="rwy" onclick="switchAptTab(\'' + uid + '\',\'rwy\')">Runways</button>' +
        '</div>' +
        '<div class="apt-tab-content" data-tab="info" style="padding:6px 0;">' + infoTable + '</div>' +
        '<div class="apt-tab-content" data-tab="freq" style="padding:6px 0;display:none;"><div style="color:#999;font-size:11px;">Loading...</div></div>' +
        '<div class="apt-tab-content" data-tab="rwy" style="padding:6px 0;display:none;"><div style="color:#999;font-size:11px;">Loading...</div></div>' +
        '<button onclick="openPlatesPanel(\'' + id + '\')" style="margin-top:6px;padding:4px 10px;' +
        'background:#1a73e8;color:#fff;border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:500;">' +
        'Approach Plates</button></div>';

      // Fetch frequencies and runways after popup renders
      setTimeout(function () { loadAptPopupData(uid, f.ident); }, 100);

      return html;
    },
  },
  navaid: {
    icon: function (f) {
      return {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 4,
        fillColor: "#00d2d3",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 0.5,
        rotation: 0,
      };
    },
    title: function (f) { return f.ident + " (" + (f["class"] || "NAVAID") + ") — " + (f.name || ""); },
  },
  waypoint: {
    icon: function () {
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 2,
        fillColor: "#a29bfe",
        fillOpacity: 0.7,
        strokeWeight: 0,
      };
    },
    title: function (f) { return f.ident; },
  },
  obstacle: {
    icon: function (f) {
      var agl = f.agl || 0;
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: agl >= 500 ? 5 : agl >= 200 ? 3 : 2,
        fillColor: agl >= 500 ? "#ff4757" : "#ffa502",
        fillOpacity: 0.8,
        strokeColor: "#fff",
        strokeWeight: agl >= 500 ? 1 : 0.5,
      };
    },
    title: function (f) {
      return (f.type_code || "OBS") + " — " + (f.agl || "?") + "ft AGL / " + (f.amsl || "?") + "ft AMSL";
    },
  },
  ils: {
    icon: function () {
      return {
        path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
        scale: 4,
        fillColor: "#2ed573",
        fillOpacity: 0.9,
        strokeColor: "#fff",
        strokeWeight: 0.5,
        rotation: 0,
      };
    },
    title: function (f) {
      return "ILS " + (f.ident || "") + " — " + (f.airport_id || "") + " RWY " + (f.runway || "");
    },
  },
};

async function initFeatureLayers() {
  var res = await fetch("/api/features/config");
  featureConfig = await res.json();

  for (var name in featureConfig) {
    featureLayers[name] = { enabled: false, markers: [] };
  }

  // Listen to map events
  map.addListener("idle", onMapIdle);
}

function onMapIdle() {
  clearTimeout(featureDebounceTimer);
  featureDebounceTimer = setTimeout(loadVisibleFeatures, 200);
}

function loadVisibleFeatures() {
  var enabledLayers = [];
  for (var name in featureLayers) {
    if (featureLayers[name].enabled) enabledLayers.push(name);
  }
  if (enabledLayers.length === 0) return;

  var bounds = map.getBounds();
  if (!bounds) return;
  var ne = bounds.getNorthEast();
  var sw = bounds.getSouthWest();
  var zoom = map.getZoom();

  var boundsStr = sw.lat() + "," + sw.lng() + "," + ne.lat() + "," + ne.lng();

  // Skip if bounds haven't changed much
  if (lastFeatureBounds === boundsStr) return;
  lastFeatureBounds = boundsStr;

  var url = "/api/features?layers=" + enabledLayers.join(",") +
    "&zoom=" + zoom + "&bounds=" + boundsStr;

  fetch(url)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      for (var name in data) {
        renderFeatureLayer(name, data[name]);
      }
    })
    .catch(function (e) { console.error("Feature load error:", e); });
}

function renderFeatureLayer(name, features) {
  var layer = featureLayers[name];
  if (!layer) return;

  // Clear existing markers
  for (var i = 0; i < layer.markers.length; i++) {
    layer.markers[i].setMap(null);
  }
  layer.markers = [];

  if (!layer.enabled || !features || features.length === 0) return;

  var styleDef = FEATURE_STYLES[featureConfig[name]?.style] || FEATURE_STYLES.waypoint;

  for (var i = 0; i < features.length; i++) {
    var f = features[i];
    if (f.latitude == null || f.longitude == null) continue;

    var markerOpts = {
      position: { lat: f.latitude, lng: f.longitude },
      map: map,
      icon: styleDef.icon(f),
      title: styleDef.title(f),
      zIndex: 100,
    };
    if (styleDef.label) {
      markerOpts.label = styleDef.label(f);
    }
    var marker = new google.maps.Marker(markerOpts);
    if (styleDef.infoContent) {
      marker.addListener("click", (function (feature, mkr) {
        return function () {
          if (!window._featureInfoWindow) {
            window._featureInfoWindow = new google.maps.InfoWindow();
          }
          window._featureInfoWindow.setContent(styleDef.infoContent(feature));
          window._featureInfoWindow.open(map, mkr);
        };
      })(f, marker));
    }
    layer.markers.push(marker);
  }
}

function toggleFeatureLayer(name) {
  var layer = featureLayers[name];
  if (!layer) return;

  layer.enabled = !layer.enabled;
  var btn = document.getElementById("feat-" + name);
  if (btn) btn.classList.toggle("active", layer.enabled);

  if (!layer.enabled) {
    // Clear markers
    for (var i = 0; i < layer.markers.length; i++) {
      layer.markers[i].setMap(null);
    }
    layer.markers = [];
    return;
  }

  // Force reload
  lastFeatureBounds = null;
  loadVisibleFeatures();
}

// ─── Plates Panel ─────────────────────────────────────────

function openPlatesPanel(ident) {
  var panel = document.getElementById("plates-panel");
  var title = document.getElementById("plates-title");
  var list = document.getElementById("plates-list");
  var viewer = document.getElementById("plates-viewer");

  title.textContent = ident + " — Approach Plates";
  list.innerHTML = '<div style="padding:20px;color:#8899aa;">Loading...</div>';
  viewer.innerHTML = "";
  panel.style.display = "flex";
  document.getElementById("plates-overlay").style.display = "block";

  // Close any info windows
  if (window._featureInfoWindow) window._featureInfoWindow.close();

  fetch("/api/plates/" + encodeURIComponent(ident))
    .then(function (r) {
      if (!r.ok) throw new Error("No plates found");
      return r.json();
    })
    .then(function (groups) {
      list.innerHTML = "";
      for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var section = document.createElement("div");
        section.className = "plates-section";

        var header = document.createElement("div");
        header.className = "plates-section-header";
        header.textContent = group.label;
        section.appendChild(header);

        for (var p = 0; p < group.plates.length; p++) {
          var plate = group.plates[p];
          var item = document.createElement("div");
          item.className = "plates-item";
          item.textContent = plate.name;
          item.dataset.pdf = plate.pdf;
          item.dataset.ident = ident;
          item.addEventListener("click", function () {
            // Highlight selected
            var prev = list.querySelector(".plates-item.active");
            if (prev) prev.classList.remove("active");
            this.classList.add("active");
            // Show PDF
            var pdfUrl = "/api/plates/" + encodeURIComponent(this.dataset.ident) + "/" + encodeURIComponent(this.dataset.pdf);
            viewer.innerHTML = '<iframe src="' + pdfUrl + '" style="width:100%;height:100%;border:none;"></iframe>';
          });
          section.appendChild(item);
        }

        list.appendChild(section);
      }
    })
    .catch(function (e) {
      list.innerHTML = '<div style="padding:20px;color:#e94560;">' + e.message + '</div>';
    });
}

function closePlatesPanel() {
  document.getElementById("plates-panel").style.display = "none";
  document.getElementById("plates-overlay").style.display = "none";
}

// ─── Airport popup tabs ──────────────────────────────────

function switchAptTab(uid, tab) {
  var popup = document.getElementById(uid);
  if (!popup) return;
  popup.querySelectorAll(".apt-tab").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
    btn.style.background = btn.dataset.tab === tab ? "#e8f0fe" : "transparent";
    btn.style.color = btn.dataset.tab === tab ? "#1a73e8" : "#666";
  });
  popup.querySelectorAll(".apt-tab-content").forEach(function (div) {
    div.style.display = div.dataset.tab === tab ? "block" : "none";
  });
}

function loadAptPopupData(uid, ident) {
  fetch("/api/plates/info/" + encodeURIComponent(ident))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var popup = document.getElementById(uid);
      if (!popup) return;

      // Frequencies tab
      var freqDiv = popup.querySelector('.apt-tab-content[data-tab="freq"]');
      if (data.frequencies && data.frequencies.length > 0) {
        var freqHtml = '<table style="border-collapse:collapse;font-size:12px;width:100%;">';
        freqHtml += '<tr style="border-bottom:1px solid #eee;"><th style="text-align:left;padding:2px 8px 2px 0;color:#999;font-weight:500;">Type</th><th style="text-align:right;padding:2px 0;color:#999;font-weight:500;">Frequency</th></tr>';
        for (var i = 0; i < data.frequencies.length; i++) {
          var fr = data.frequencies[i];
          freqHtml += '<tr><td style="padding:2px 8px 2px 0;white-space:nowrap;">' + (fr.service_type || "") +
            '</td><td style="text-align:right;padding:2px 0;font-weight:600;">' + (fr.freq_tx || "") + '</td></tr>';
        }
        freqHtml += '</table>';
        freqDiv.innerHTML = freqHtml;
      } else {
        freqDiv.innerHTML = '<div style="color:#999;font-size:11px;">No frequencies available</div>';
      }

      // Runways tab
      var rwyDiv = popup.querySelector('.apt-tab-content[data-tab="rwy"]');
      if (data.runways && data.runways.length > 0) {
        var surfaceLabels = { ASPH: "Asphalt", CONC: "Concrete", TURF: "Turf", GRVL: "Gravel", DIRT: "Dirt", WATE: "Water" };
        var rwyHtml = '<table style="border-collapse:collapse;font-size:12px;width:100%;">';
        rwyHtml += '<tr style="border-bottom:1px solid #eee;"><th style="text-align:left;padding:2px 6px 2px 0;color:#999;font-weight:500;">Runway</th><th style="text-align:right;padding:2px 6px;color:#999;font-weight:500;">Length</th><th style="text-align:right;padding:2px 6px;color:#999;font-weight:500;">Width</th><th style="text-align:left;padding:2px 0;color:#999;font-weight:500;">Surface</th></tr>';
        for (var i = 0; i < data.runways.length; i++) {
          var rw = data.runways[i];
          rwyHtml += '<tr>' +
            '<td style="padding:2px 6px 2px 0;font-weight:600;">' + (rw.designator || "") + '</td>' +
            '<td style="text-align:right;padding:2px 6px;">' + (rw.length_ft ? rw.length_ft.toLocaleString() + "'" : "") + '</td>' +
            '<td style="text-align:right;padding:2px 6px;">' + (rw.width_ft ? rw.width_ft + "'" : "") + '</td>' +
            '<td style="padding:2px 0;">' + (surfaceLabels[rw.surface] || rw.surface || "") + '</td>' +
            '</tr>';
        }
        rwyHtml += '</table>';
        rwyDiv.innerHTML = rwyHtml;
      } else {
        rwyDiv.innerHTML = '<div style="color:#999;font-size:11px;">No runway data available</div>';
      }
    })
    .catch(function () {});
}

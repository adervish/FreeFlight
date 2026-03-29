let map;
var vfrOverlay = null;
var vfrVisible = false;
var airspaceLayer = null;
var airspaceVisible = false;

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 37.6213, lng: -122.379 }, // KSFO
    zoom: 5,
    mapTypeId: "terrain",
    styles: [
      { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
      { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#0e1626" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
      { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
    ],
  });
  initAirspaceLabelOverlay();

  vfrOverlay = new google.maps.ImageMapType({
    getTileUrl: function (coord, zoom) {
      return "https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/" +
        zoom + "/" + coord.y + "/" + coord.x;
    },
    tileSize: new google.maps.Size(256, 256),
    maxZoom: 12,
    minZoom: 5,
    opacity: 1.0,
    name: "VFR Sectional",
  });
}

var defaultMapStyles = null;

function toggleVFR() {
  if (!defaultMapStyles) defaultMapStyles = map.get("styles");
  if (vfrVisible) {
    map.overlayMapTypes.clear();
    map.set("styles", defaultMapStyles);
    vfrVisible = false;
  } else {
    map.overlayMapTypes.push(vfrOverlay);
    map.set("styles", [{ elementType: "geometry", stylers: [{ visibility: "off" }] },
      { elementType: "labels", stylers: [{ visibility: "off" }] }]);
    vfrVisible = true;
  }
  var btn = document.getElementById("vfr-toggle");
  if (btn) btn.classList.toggle("active", vfrVisible);
}

var AIRSPACE_STYLES = {
  A: { fill: "#78909C", stroke: "#78909C", fillOp: 0.05, strokeOp: 0.4, weight: 1 },
  B: { fill: "#2196F3", stroke: "#2196F3", fillOp: 0.10, strokeOp: 0.7, weight: 1.5 },
  C: { fill: "#9C27B0", stroke: "#9C27B0", fillOp: 0.08, strokeOp: 0.6, weight: 1 },
  D: { fill: "#2196F3", stroke: "#2196F3", fillOp: 0.06, strokeOp: 0.5, weight: 1 },
};

var AIRSPACE_FILES = ["/data/airspace.json", "/data/boundary-airspace.json", "/data/defense-airspace.json"];
var airspaceGeoData = [];
var airspaceLabels = [];

function airspaceStyleFn(feature) {
  var cls = feature.getProperty("c") || "";
  var type = feature.getProperty("t") || "";
  var zoom = map ? map.getZoom() : 10;
  if (cls === "E" || cls === "A") return { visible: false };
  if (cls === "D" && zoom < 7) return { visible: false };
  if (cls === "C" && zoom < 6) return { visible: false };
  var s = AIRSPACE_STYLES[cls];
  if (!s) {
    if (type === "ARTCC" || type === "ARTCC_L" || type === "ARTCC_H" || type === "CERAP") {
      if (zoom < 5) return { visible: false };
      s = { fill: "#607D8B", stroke: "#607D8B", fillOp: 0, strokeOp: 0.3, weight: 1 };
    } else if (type === "TRSA") {
      if (zoom < 7) return { visible: false };
      s = { fill: "#795548", stroke: "#795548", fillOp: 0.05, strokeOp: 0.5, weight: 1 };
    } else if (type === "ADIZ" || type === "NDA_TFR") {
      s = { fill: "#F44336", stroke: "#F44336", fillOp: 0.05, strokeOp: 0.5, weight: 1.5 };
    } else {
      if (zoom < 7) return { visible: false };
      s = { fill: "#9E9E9E", stroke: "#9E9E9E", fillOp: 0.03, strokeOp: 0.3, weight: 0.5 };
    }
  }
  return { fillColor: s.fill, fillOpacity: s.fillOp, strokeColor: s.stroke, strokeWeight: s.weight, strokeOpacity: s.strokeOp };
}

function formatAlt(val) {
  if (val === null || val === undefined || val === "") return "SFC";
  var n = parseInt(val);
  if (isNaN(n)) return String(val);
  if (n <= 0) return "SFC";
  if (n === -9998) return "Class A";
  if (n >= 18000) return "FL" + Math.round(n / 100);
  return n.toLocaleString() + "'";
}

function computeCentroid(geom) {
  var coords;
  if (geom.type === "Polygon") coords = geom.coordinates[0];
  else if (geom.type === "MultiPolygon") coords = geom.coordinates[0][0];
  else return null;
  var latSum = 0, lngSum = 0, n = coords.length;
  for (var i = 0; i < n; i++) { lngSum += coords[i][0]; latSum += coords[i][1]; }
  return { lat: latSum / n, lng: lngSum / n };
}

var AirspaceLabelOverlay = null;
function initAirspaceLabelOverlay() {
  if (AirspaceLabelOverlay) return;
  AirspaceLabelOverlay = function (position, text, angle, color) {
    this.position = position; this.text = text; this.angle = angle; this.color = color; this.div = null;
    google.maps.OverlayView.call(this);
  };
  AirspaceLabelOverlay.prototype = Object.create(google.maps.OverlayView.prototype);
  AirspaceLabelOverlay.prototype.onAdd = function () {
    var div = document.createElement("div");
    div.style.cssText = "position:absolute;transform:rotate(" + this.angle + "deg) translateY(-100%);transform-origin:center bottom;background:rgba(0,0,0,0.85);color:#fff;font-size:9px;font-weight:600;font-family:Roboto,Arial,sans-serif;padding:1px 4px;border-radius:2px;white-space:nowrap;border:1px solid " + (this.color || "rgba(255,255,255,0.3)") + ";pointer-events:none;z-index:51;";
    div.textContent = this.text; this.div = div;
    this.getPanes().overlayMouseTarget.appendChild(div);
  };
  AirspaceLabelOverlay.prototype.draw = function () {
    var proj = this.getProjection(); if (!proj) return;
    var px = proj.fromLatLngToDivPixel(this.position); if (!px) return;
    this.div.style.left = px.x + "px"; this.div.style.top = px.y + "px";
  };
  AirspaceLabelOverlay.prototype.onRemove = function () {
    if (this.div && this.div.parentNode) { this.div.parentNode.removeChild(this.div); this.div = null; }
  };
}

function getOuterRings(geom) {
  if (geom.type === "Polygon") return [geom.coordinates[0]];
  if (geom.type === "MultiPolygon") return geom.coordinates.map(function (p) { return p[0]; });
  return [];
}

function borderLabelPosition(p1, p2, centroid) {
  var midLat = (p1[1] + p2[1]) / 2, midLng = (p1[0] + p2[0]) / 2;
  var dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return null;
  var tangentDeg = Math.atan2(-dy, dx) * 180 / Math.PI;
  var nx1 = -dy / len, ny1 = dx / len;
  var dot = nx1 * (centroid.lat - midLat) + ny1 * (centroid.lng - midLng);
  var angle = tangentDeg;
  if (dot < 0) angle += 180;
  return { lat: midLat, lng: midLng, angle: angle };
}

function pickBorderLabelPositions(geom, bounds, zoom) {
  var rings = getOuterRings(geom); if (rings.length === 0) return [];
  var centroid = computeCentroid(geom); if (!centroid) return [];
  var candidates = [];
  for (var r = 0; r < rings.length; r++) {
    var ring = rings[r]; if (ring.length < 3) continue;
    for (var i = 0; i < ring.length - 1; i++) {
      var p1 = ring[i], p2 = ring[i + 1];
      var midLat = (p1[1] + p2[1]) / 2, midLng = (p1[0] + p2[0]) / 2;
      if (bounds && !bounds.contains(new google.maps.LatLng(midLat, midLng))) continue;
      var segLen = Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));
      var pos = borderLabelPosition(p1, p2, centroid);
      if (pos) candidates.push({ pos: pos, segLen: segLen });
    }
  }
  if (candidates.length === 0) return [];
  candidates.sort(function (a, b) { return b.segLen - a.segLen; });
  var picked = [candidates[0]];
  if (candidates.length > 4) {
    var best = candidates[0], furthest = null, maxDist = 0;
    for (var i = 1; i < candidates.length; i++) {
      var d = Math.pow(candidates[i].pos.lat - best.pos.lat, 2) + Math.pow(candidates[i].pos.lng - best.pos.lng, 2);
      if (d > maxDist) { maxDist = d; furthest = candidates[i]; }
    }
    if (furthest) picked.push(furthest);
  }
  return picked.map(function (c) { return c.pos; });
}

function clearAirspaceLabels() { for (var i = 0; i < airspaceLabels.length; i++) airspaceLabels[i].setMap(null); airspaceLabels = []; }

function addAirspaceLabels() {
  clearAirspaceLabels();
  var zoom = map ? map.getZoom() : 10;
  if (zoom < 6) return;
  var bounds = map.getBounds();
  var showBorderLabels = zoom >= 8;
  for (var i = 0; i < airspaceGeoData.length; i++) {
    var f = airspaceGeoData[i], cls = f.properties.c || "";
    if (cls === "E" || cls === "A") continue;
    if (cls === "D" && zoom < 7) continue;
    if (cls === "C" && zoom < 6) continue;
    var lower = formatAlt(f.properties.l), upper = formatAlt(f.properties.u);
    var color = AIRSPACE_STYLES[cls]?.stroke || "#aaa";
    var lowerNum = parseInt(f.properties.l) || 0;
    if (lowerNum === 0) {
      var center = computeCentroid(f.geometry);
      if (center && (!bounds || bounds.contains(new google.maps.LatLng(center.lat, center.lng)))) {
        var name = (f.properties.n || "").replace(/\s*CLASS\s+[A-E]\s*/i, "").trim();
        if (name.length > 20) name = name.substring(0, 18) + "\u2026";
        var centerMarker = new google.maps.Marker({
          position: center, map: map,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0, labelOrigin: new google.maps.Point(0, 0) },
          label: { text: "Class " + cls + (name ? "\n" + name : ""), color: color, fontSize: "10px", fontWeight: "600" },
          zIndex: 49, clickable: false,
        });
        airspaceLabels.push(centerMarker);
      }
    }
    if (showBorderLabels) {
      var positions = pickBorderLabelPositions(f.geometry, bounds, zoom);
      var borderText = cls + ": " + lower + " - " + upper;
      for (var p = 0; p < positions.length; p++) {
        var pos = positions[p];
        var overlay = new AirspaceLabelOverlay(new google.maps.LatLng(pos.lat, pos.lng), borderText, pos.angle, color);
        overlay.setMap(map); airspaceLabels.push(overlay);
      }
    }
  }
}

function refreshAirspaceForZoom() { if (!airspaceVisible) return; map.data.setStyle(airspaceStyleFn); addAirspaceLabels(); }

function pointInRing(lat, lng, ring) {
  var inside = false;
  for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    var xi = ring[i][1], yi = ring[i][0], xj = ring[j][1], yj = ring[j][0];
    if (((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lat, lng, geom) {
  if (!geom || !geom.coordinates) return false;
  if (geom.type === "Polygon") {
    if (!pointInRing(lat, lng, geom.coordinates[0])) return false;
    for (var h = 1; h < geom.coordinates.length; h++) if (pointInRing(lat, lng, geom.coordinates[h])) return false;
    return true;
  } else if (geom.type === "MultiPolygon") {
    for (var i = 0; i < geom.coordinates.length; i++) {
      var poly = geom.coordinates[i];
      if (pointInRing(lat, lng, poly[0])) {
        var inHole = false;
        for (var h = 1; h < poly.length; h++) if (pointInRing(lat, lng, poly[h])) { inHole = true; break; }
        if (!inHole) return true;
      }
    }
  }
  return false;
}

function findAirspacesAtPoint(lat, lng) {
  var results = [];
  for (var i = 0; i < airspaceGeoData.length; i++) {
    if (pointInGeometry(lat, lng, airspaceGeoData[i].geometry)) results.push(airspaceGeoData[i].properties);
  }
  return results;
}

function buildCrossSectionHTML(airspaces, lat, lng) {
  var layers = [];
  for (var i = 0; i < airspaces.length; i++) {
    var a = airspaces[i], cls = a.c || "";
    if (cls === "E") continue;
    var lo = parseInt(a.l) || 0, up = parseInt(a.u) || 0;
    if (lo < 0) lo = 0; if (up <= 0 || up === -9998) up = 18000; if (up > 18000) up = 18000;
    layers.push({ name: a.n || a.t || "?", cls: cls, lower: lo, upper: up });
  }
  if (layers.length === 0) return '<div style="color:#333;font-size:13px;padding:4px;">No controlled airspace at this point</div>';
  layers.sort(function (a, b) { return a.lower - b.lower; });
  var maxAlt = Math.max.apply(null, layers.map(function(l){return l.upper;}));
  maxAlt = Math.max(maxAlt, 5000);
  var chartH = 180, chartW = 160, leftPad = 45;
  var colors = { A: "#78909C", B: "#2196F3", C: "#9C27B0", D: "#42A5F5" };
  var html = '<div style="color:#333;font-size:12px;min-width:220px;"><strong>Airspace Cross Section</strong><div style="color:#999;font-size:10px;margin-bottom:6px;">' + lat.toFixed(4) + ', ' + lng.toFixed(4) + '</div><div style="position:relative;height:' + chartH + 'px;width:' + (leftPad + chartW) + 'px;margin-bottom:8px;">';
  for (var a = 0; a <= maxAlt; a += 1000) {
    var y = chartH - (a / maxAlt) * chartH;
    html += '<div style="position:absolute;left:0;top:' + y + 'px;font-size:9px;color:#999;transform:translateY(-50%);">' + formatAlt(a) + '</div><div style="position:absolute;left:' + leftPad + 'px;top:' + y + 'px;border-top:1px solid #eee;width:' + chartW + 'px;"></div>';
  }
  var bw = Math.max(30, Math.floor(chartW / Math.max(layers.length, 1)) - 4);
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i], yTop = chartH - (l.upper / maxAlt) * chartH, yBot = chartH - (l.lower / maxAlt) * chartH, h = Math.max(yBot - yTop, 2);
    var x = leftPad + 4 + i * (bw + 4), c = colors[l.cls] || "#9E9E9E";
    html += '<div style="position:absolute;left:' + x + 'px;top:' + yTop + 'px;width:' + bw + 'px;height:' + h + 'px;background:' + c + ';opacity:0.6;border:1px solid ' + c + ';border-radius:2px;display:flex;align-items:center;justify-content:center;overflow:hidden;"><span style="font-size:8px;color:#fff;font-weight:600;">' + l.cls + '</span></div>';
  }
  html += '</div><table style="font-size:11px;border-collapse:collapse;width:100%;">';
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i], c = colors[l.cls] || "#9E9E9E";
    html += '<tr><td style="padding:1px 4px;"><span style="display:inline-block;width:8px;height:8px;background:' + c + ';border-radius:1px;"></span></td><td style="padding:1px 4px;font-weight:600;">Class ' + l.cls + '</td><td style="padding:1px 4px;color:#666;">' + formatAlt(l.lower) + ' \u2013 ' + formatAlt(l.upper) + '</td></tr>';
  }
  html += '</table></div>';
  return html;
}

function toggleAirspace() {
  if (airspaceVisible) {
    if (airspaceLayer) { airspaceLayer.forEach(function (f) { map.data.remove(f); }); airspaceLayer = null; }
    clearAirspaceLabels(); airspaceGeoData = [];
    if (window._airspaceClickListener) { google.maps.event.removeListener(window._airspaceClickListener); window._airspaceClickListener = null; }
    if (window._airspaceZoomListener) { google.maps.event.removeListener(window._airspaceZoomListener); window._airspaceZoomListener = null; }
    airspaceVisible = false;
  } else {
    if (!airspaceLayer) {
      airspaceLayer = []; airspaceGeoData = []; var loaded = 0;
      AIRSPACE_FILES.forEach(function (file) {
        fetch(file).then(function (r) { return r.json(); }).then(function (geojson) {
          var filtered = { type: "FeatureCollection", features: geojson.features.filter(function (f) { return f.properties.c !== "E"; }) };
          var features = map.data.addGeoJson(filtered);
          airspaceLayer = airspaceLayer.concat(features);
          airspaceGeoData = airspaceGeoData.concat(geojson.features);
          loaded++;
          if (loaded === AIRSPACE_FILES.length) { map.data.setStyle(airspaceStyleFn); addAirspaceLabels(); }
        }).catch(function () { loaded++; });
      });
      window._airspaceZoomListener = map.addListener("idle", refreshAirspaceForZoom);
      if (!window._airspaceInfoWindow) window._airspaceInfoWindow = new google.maps.InfoWindow();
      window._airspaceClickListener = map.addListener("rightclick", function (e) {
        if (!airspaceVisible) return;
        var html = buildCrossSectionHTML(findAirspacesAtPoint(e.latLng.lat(), e.latLng.lng()), e.latLng.lat(), e.latLng.lng());
        window._airspaceInfoWindow.setContent(html); window._airspaceInfoWindow.setPosition(e.latLng); window._airspaceInfoWindow.open(map);
      });
      airspaceVisible = true; document.getElementById("airspace-toggle").classList.add("active");
      return;
    }
    airspaceLayer.forEach(function (f) { map.data.add(f); });
    map.data.setStyle(airspaceStyleFn); addAirspaceLabels(); airspaceVisible = true;
  }
  var btn = document.getElementById("airspace-toggle");
  if (btn) btn.classList.toggle("active", airspaceVisible);
}

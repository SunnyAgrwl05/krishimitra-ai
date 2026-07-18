const stressColor = {
  "Healthy": "#35c37b",
  "Mild Stress": "#e0a530",
  "Moderate Stress": "#ff7a1a",
  "Severe Stress": "#e0483d",
};

let map, markers = {}, fieldsData = [], markerClusterGroup = null, heatLayer = null;
let baseLayers = {}, currentBase = 'dark', overlayActive = { ndvi: false, stress: false, heat: false };
let currentField = null;
let wizardStep = 1;

/* ================= UTIL ================= */
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

function isMobile() {
  return window.innerWidth <= 767;
}

function safeInvalidate() {
  if (map) {
    map.invalidateSize();
  }
}

const debouncedInvalidate = debounce(safeInvalidate, 150);

/* ================= MAP ================= */
function initMap() {
  try {
    map = L.map('map', { zoomControl: true }).setView([27.3, 80.2], 7);

    baseLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    });
    baseLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', subdomains: 'abc', maxZoom: 19,
    });
    baseLayers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri',
        maxZoom: 19,
        maxNativeZoom: 18
      });
    baseLayers.terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenTopoMap contributors', subdomains: 'abc', maxZoom: 17,
    });

    baseLayers.dark.addTo(map);

    if (typeof L.markerClusterGroup === 'function') {
      markerClusterGroup = L.markerClusterGroup({ maxClusterRadius: 45 });
      map.addLayer(markerClusterGroup);
    }

    setupLayerControls();
    setupMapResizeHandling();
  } catch (e) {
    console.error('Map load failed (no internet / CDN blocked):', e);
    const el = document.getElementById('map');
    if (el) el.innerHTML = '<div style="padding:20px;color:#7fa093">Map tiles load nahi ho paayi (internet check karein). Field list aur advisory neeche kaam kar rahe hain.</div>';
  }
}

/* Keep Leaflet's internal size in sync with the actual container size across
   every situation that can change layout: window resize, orientation change,
   sidebar open/close, detail sheet open/close, tab switching, fullscreen. */
function setupMapResizeHandling() {
  const mapEl = document.getElementById('map');
  const mapwrap = document.getElementById('view-map');

  // Primary mechanism: ResizeObserver on the map's actual container.
  if (typeof ResizeObserver !== 'undefined' && mapwrap) {
    const ro = new ResizeObserver(() => debouncedInvalidate());
    ro.observe(mapwrap);
  } else if (mapEl) {
    const ro2 = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => debouncedInvalidate()) : null;
    if (ro2) ro2.observe(mapEl);
  }

  // Fallbacks / explicit triggers for browsers or transitions ResizeObserver may miss.
  window.addEventListener('resize', debouncedInvalidate);
  window.addEventListener('orientationchange', () => setTimeout(safeInvalidate, 250));

  // Modern orientation API — more reliable than 'orientationchange' on some
  // Android/Chrome versions where 'orientationchange' is unreliable or absent.
  if (screen.orientation && typeof screen.orientation.addEventListener === 'function') {
    screen.orientation.addEventListener('change', () => setTimeout(safeInvalidate, 250));
  }

  document.addEventListener('fullscreenchange', () => setTimeout(safeInvalidate, 200));
  document.addEventListener('webkitfullscreenchange', () => setTimeout(safeInvalidate, 200));

  // Late layout settle (webfonts, CDN scripts finishing) can shift the map's
  // actual box size slightly after DOMContentLoaded; one extra safety pass.
  window.addEventListener('load', () => setTimeout(safeInvalidate, 500));
}

function setupLayerControls() {
  document.querySelectorAll('.layer-btn[data-layer]').forEach(btn => {
    btn.addEventListener('click', () => {
      const layer = btn.dataset.layer;
      if (!map || !baseLayers[layer] || layer === currentBase) return;
      map.removeLayer(baseLayers[currentBase]);
      baseLayers[layer].addTo(map);
      currentBase = layer;
      document.querySelectorAll('.layer-btn[data-layer]').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    });
  });

  document.querySelectorAll('.overlay-btn[data-overlay]').forEach(btn => {
    btn.addEventListener('click', () => {
      const overlay = btn.dataset.overlay;
      overlayActive[overlay] = !overlayActive[overlay];
      btn.classList.toggle('active', overlayActive[overlay]);
      btn.setAttribute('aria-pressed', String(overlayActive[overlay]));
      applyOverlays();
    });
  });

  const locateBtn = document.getElementById('locateBtn');

  if (locateBtn) {
    locateBtn.addEventListener('click', () => {

      if (!map) return;

      if (!navigator.geolocation) {
        alert("❌ Geolocation is browser mein support nahi hai.");
        return;
      }

      locateBtn.disabled = true;

      navigator.geolocation.getCurrentPosition(

        (pos) => {

          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const accuracy = pos.coords.accuracy;

          map.flyTo([lat, lon], 14, {
            duration: 1.5
          });

          // Purana marker remove karo
          if (window.userLocationMarker) {
            map.removeLayer(window.userLocationMarker);
          }

          // Naya marker
          window.userLocationMarker = L.circleMarker([lat, lon], {

            radius: 9,

            color: "#ffffff",

            weight: 3,

            fillColor: "#22c55e",

            fillOpacity: 1

          })
            .addTo(map)
            .bindPopup(`
    <div style="font-family:Inter,sans-serif;line-height:1.6;min-width:220px">

        <div style="font-size:17px;font-weight:700;color:#16a34a">
            📍 Aap Yahan Hain
        </div>

        <hr style="margin:8px 0">

        <b>Latitude</b><br>
        ${lat.toFixed(6)}

        <br><br>

        <b>Longitude</b><br>
        ${lon.toFixed(6)}

        <br><br>

        <b>GPS Accuracy</b><br>
        ± ${Math.round(accuracy)} meter

    </div>
`)
            .openPopup();

          // =================== Accuracy Circle ===================
          if (window.userAccuracyCircle) {
            map.removeLayer(window.userAccuracyCircle);
          }

          window.userAccuracyCircle = L.circle([lat, lon], {
            radius: Math.max(accuracy, 150),
            color: "#22c55e",
            fillColor: "#22c55e",
            fillOpacity: 0.15,
            weight: 2
          }).addTo(map);

          window.userAccuracyCircle.bringToBack();
          window.userLocationMarker.bringToFront();

          // =======================================================

          locateBtn.disabled = false;
        },

        (err) => {

          console.warn("Geolocation failed:", err);

          alert("Current location detect nahi ho paayi. Default location use ki ja rahi hai.");

          map.flyTo([27.3, 80.2], 8);

          locateBtn.disabled = false;

        },   // ⭐⭐⭐ Ye comma missing tha

        {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 60000
        }
      );

    });
  }

  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) fsBtn.addEventListener('click', () => {
    const el = document.getElementById('view-map');
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
}

function ndviColor(ndvi) {
  if (ndvi > 0.65) return "#35c37b";
  if (ndvi > 0.45) return "#7bc335";
  if (ndvi > 0.25) return "#e0a530";
  if (ndvi > 0.1) return "#e0803a";
  return "#e0483d";
}

function applyOverlays() {
  // heat map layer (based on stress severity as intensity)
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  if (overlayActive.heat && typeof L.heatLayer === 'function' && fieldsData.length) {
    const severityWeight = { "Healthy": 0.15, "Mild Stress": 0.4, "Moderate Stress": 0.7, "Severe Stress": 1.0 };
    const points = fieldsData.filter(d => !d.error).map(d =>
      [d.field.lat, d.field.lon, severityWeight[d.ai_prediction.predicted_stress] || 0.3]
    );
    heatLayer = L.heatLayer(points, { radius: 45, blur: 35, maxZoom: 12 }).addTo(map);
  }
  // NDVI / stress overlays just recolor the markers (rendered via renderMarkers)
  renderMarkers(fieldsData);
}

/* ================= FIELD DATA ================= */
async function loadFields() {
  try {
    const res = await fetch('/api/fields');
    const data = await res.json();
    fieldsData = data;
    renderFieldList(data);
    renderMarkers(data);
    updateStatusCards(data);

    if (data.length > 0) {
      if (!isMobile()) {
        selectField(0);
      } else {
        currentField = data[0];
      }
    }
  } catch (e) {
    console.error('Fields load failed:', e);
    const list = document.getElementById('fieldList');
    if (list) list.innerHTML = '<div class="muted" style="padding:16px">Fields load nahi ho paaye. Server chal raha hai check karein.</div>';
  }
}

function updateStatusCards(data) {
  const total = data.filter(d => !d.error).length;
  const critical = data.filter(d => !d.error && ['High', 'Critical'].includes(d.advisory.urgency)).length;
  const totalEl = document.getElementById('statTotal');
  const critEl = document.getElementById('statCritical');
  if (totalEl) totalEl.textContent = total;
  if (critEl) critEl.textContent = critical;
  const countEl = document.getElementById('fieldCount');
  if (countEl) countEl.textContent = total;
}

function renderFieldList(data) {
  const list = document.getElementById('fieldList');
  if (!list) return;
  list.innerHTML = '';
  data.forEach((d, i) => {
    if (d.error) return;
    const ndvi = d.satellite_features.optical.NDVI;
    const stress = d.ai_prediction.predicted_stress;
    const card = document.createElement('div');
    card.className = 'field-card';
    card.id = 'card-' + i;
    card.dataset.name = (d.field.name || '').toLowerCase();
    card.dataset.district = (d.field.district || '').toLowerCase();
    card.dataset.critical = ['High', 'Critical'].includes(d.advisory.urgency) ? '1' : '0';
    card.dataset.healthy = stress === 'Healthy' ? '1' : '0';
    card.style.animationDelay = (i * 0.04) + 's';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${d.field.name}, NDVI ${ndvi.toFixed(2)}, ${stress}`);
    card.innerHTML = `
      <div>
        <div class="fc-name">${d.field.name} <span class="muted" style="font-size:11px">(${d.field.id})</span></div>
        <div class="fc-sub">${d.field.district} · ${d.ai_prediction.predicted_crop}</div>
      </div>
      <div class="fc-score" style="background:${ndviColor(ndvi)}">${ndvi.toFixed(2)}</div>
    `;
    card.onclick = () => selectField(i);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectField(i);
      }
    });
    list.appendChild(card);
  });
}

function renderMarkers(data) {
  if (!map) return;
  if (markerClusterGroup) markerClusterGroup.clearLayers();
  else Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  data.forEach((d, i) => {
    if (d.error) return;
    const stress = d.ai_prediction.predicted_stress;
    const ndvi = d.satellite_features.optical.NDVI;
    let color = stressColor[stress] || "#7fa093";
    if (overlayActive.ndvi && !overlayActive.stress) color = ndviColor(ndvi);

    const marker = L.circleMarker([d.field.lat, d.field.lon], {
      radius: 10, color: color, fillColor: color, fillOpacity: 0.85, weight: 2,
    });
    marker.bindTooltip(`${d.field.name} · ${d.ai_prediction.predicted_crop}`, { direction: 'top' });
    marker.on('click', () => selectField(i));

    if (markerClusterGroup) markerClusterGroup.addLayer(marker);
    else marker.addTo(map);
    markers[i] = marker;
  });
}

/* ================= FIELD SEARCH / FILTER ================= */
function setupFieldSearchFilter() {
  const searchInput = document.getElementById('fieldSearch');
  if (searchInput) searchInput.addEventListener('input', applyFieldFilter);

  document.querySelectorAll('.chip[data-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip[data-filter]').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');
      applyFieldFilter();
    });
  });
}

function applyFieldFilter() {
  const q = (document.getElementById('fieldSearch')?.value || '').toLowerCase();
  const activeChip = document.querySelector('.chip.active');
  const filter = activeChip ? activeChip.dataset.filter : 'all';

  document.querySelectorAll('.field-card').forEach(card => {
    const matchesText = !q || card.dataset.name.includes(q) || card.dataset.district.includes(q);
    let matchesFilter = true;
    if (filter === 'critical') matchesFilter = card.dataset.critical === '1';
    if (filter === 'healthy') matchesFilter = card.dataset.healthy === '1';
    card.style.display = (matchesText && matchesFilter) ? 'flex' : 'none';
  });
}

/* ================= DETAIL PANEL ================= */
function selectField(i) {
  document.querySelectorAll('.field-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('card-' + i);
  if (card) card.classList.add('selected');
  const d = fieldsData[i];
  currentField = d;
  if (map) {
    map.flyTo([d.field.lat, d.field.lon], 11, { duration: 1.2 });
  }
  renderDetail(d);
  if (isMobile()) {
    setSidebarOpen(false);
    openDetailSheet();
  }
}

function openDetailSheet() {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  if (isMobile()) {
    setSidebarOpen(false);
  }
  panel.style.display = 'block';
  requestAnimationFrame(() => {
    panel.classList.add('open');
  });
  // iOS Safari can resize the viewport (address bar collapse) right as the
  // sheet animates in; one extra invalidate keeps the map tiles aligned.
  setTimeout(safeInvalidate, 320);
}

function closeDetailSheet() {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  panel.classList.remove('open');
  if (isMobile()) {
    panel.style.display = 'none';
  }
}

function stageProgress(stage) {
  const order = ["Sowing", "Vegetative", "Heading/Flowering", "Maturity", "Harvest"];
  const idx = order.indexOf(stage);
  return { idx, total: order.length, order };
}

function renderDetail(d) {
  const panel = document.getElementById('detailPanel');
  if (!panel) return;
  const adv = d.advisory;
  const feats = d.satellite_features;
  const ai = d.ai_prediction;
  const { idx, total, order } = stageProgress(feats.growth_stage);

  const timelineSegs = order.map((s, i) => {
    const cls = i < idx ? 'done' : (i === idx ? 'current' : '');
    return `<div class="timeline-seg ${cls}"></div>`;
  }).join('');

  // preserve the mobile close button + drag handle, only replace the content below them
  const closeBtnHtml = `
    <button class="icon-btn detail-close mobile-only" id="detailClose" aria-label="Close detail panel">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M18.3 5.71 12 12.01l-6.3-6.3-1.41 1.41 6.3 6.3-6.3 6.29 1.41 1.42 6.3-6.3 6.3 6.3 1.41-1.42-6.3-6.29 6.3-6.3z"/>
      </svg>
    </button>
    <span class="sheet-handle mobile-only" aria-hidden="true"></span>
  `;

  panel.innerHTML = closeBtnHtml + `
    <h3>${d.field.name || 'Field'} <span style="color:var(--muted);font-size:13px">${d.field.id || ''}</span></h3>
    <div class="loc">${d.field.district ? d.field.district + ', ' + d.field.state + ' · ' : ''}${d.field.lat.toFixed(4)}, ${d.field.lon.toFixed(4)} · ${d.field.date}</div>

    <div class="risk-badge ${adv.urgency}">${adv.urgency} Risk</div>

    <div class="stat-grid">
      <div class="stat"><div class="label">Crop (AI)</div><div class="value">${ai.predicted_crop}</div></div>
      <div class="stat"><div class="label">Growth Stage</div><div class="value" style="font-size:14px">${feats.growth_stage}</div></div>
      <div class="stat"><div class="label">NDVI</div><div class="value">${feats.optical.NDVI}</div></div>
      <div class="stat"><div class="label">NDWI</div><div class="value">${feats.optical.NDWI}</div></div>
      <div class="stat"><div class="label">MSI</div><div class="value">${feats.optical.MSI}</div></div>
      <div class="stat"><div class="label">SAR VV/VH</div><div class="value" style="font-size:14px">${feats.sar.VV_VH_ratio}</div></div>
      <div class="stat"><div class="label">VV (dB)</div><div class="value" style="font-size:14px">${feats.sar.VV_dB}</div></div>
      <div class="stat"><div class="label">VH (dB)</div><div class="value" style="font-size:14px">${feats.sar.VH_dB}</div></div>
    </div>

    <div class="progress-row">
      <div class="plabel"><span>Crop confidence</span><span>${(ai.crop_confidence * 100).toFixed(0)}%</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${ai.crop_confidence * 100}%; background:var(--green)"></div></div>
    </div>
    <div class="progress-row">
      <div class="plabel"><span>Stress confidence</span><span>${(ai.stress_confidence * 100).toFixed(0)}%</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${ai.stress_confidence * 100}%; background:var(--orange)"></div></div>
    </div>

    <div class="advisory-box ${adv.urgency}">
      <div class="urgency">${adv.urgency} Urgency · ${adv.stress_level}</div>
      <div class="action">${adv.action_hi}</div>
      <div>Recommended: <b>${adv.recommended_water_mm} mm</b> water · Demand: ${adv.crop_water_demand_mm_day} mm/day</div>
      <ul class="reasoning">${adv.reasoning.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>

    <div class="timeline">
      <div class="timeline-title">Growth Timeline</div>
      <div class="timeline-track">${timelineSegs}</div>
      <div class="timeline-labels">${order.map(s => `<span>${s.split('/')[0]}</span>`).join('')}</div>
    </div>

    <div class="conf-tag">Source: ${feats.source}</div>

    <div style="margin-top:20px">
      <button class="btn-primary" onclick="exportPDF()">📄 Export PDF Report</button>
    </div>
  `;

  // re-wire the close button since we just replaced the panel's innerHTML
  const closeBtn = document.getElementById('detailClose');
  if (closeBtn) closeBtn.addEventListener('click', closeDetailSheet);
}

/* ================= TABS ================= */
function showView(view) {

  document.getElementById("view-map").style.display =
    view === "map" ? "block" : "none";

  document.getElementById("view-map-sidebar").style.display =
    view === "map" ? "flex" : "none";

  const detail = document.getElementById("detailPanel");
  if (detail) {
    if (isMobile()) {
      // On mobile the detail panel is a bottom sheet controlled entirely by
      // the .open class (see openDetailSheet/closeDetailSheet + CSS). Forcing
      // display:block here would fight that and make it cover the map.
      detail.style.display = "none";
      detail.classList.remove("open");
    } else {
      detail.style.display = view === "map" ? "block" : "none";
    }
  }

  document.getElementById("view-analyze").style.display =
    view === "analyze" ? "block" : "none";

  document.getElementById("view-pipeline").style.display =
    view === "pipeline" ? "block" : "none";

  document.querySelectorAll(".nav-pill").forEach(btn => {
    btn.classList.remove("active");
    btn.setAttribute("aria-selected", "false");
  });

  const activeTab = document.getElementById("tab-" + view);

  if (activeTab) {
    activeTab.classList.add("active");
    activeTab.setAttribute("aria-selected", "true");
  }

  if (view === "pipeline") {
    loadMetrics();
  }

  if (map) {
    setTimeout(() => {
      map.invalidateSize();
    }, 300);
  }
}

document.getElementById("tab-map").addEventListener("click", () => showView("map"));
document.getElementById("tab-analyze").addEventListener("click", () => showView("analyze"));
document.getElementById("tab-pipeline").addEventListener("click", () => showView("pipeline"));

const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.getElementById("view-map-sidebar");
const sidebarScrim = document.getElementById("sidebarScrim");

function setSidebarOpen(open) {
  if (!sidebar) return;
  sidebar.classList.toggle("open", open);
  document.body.classList.toggle("sidebar-open", open);
  if (sidebarScrim) sidebarScrim.classList.toggle("show", open);
  if (sidebarToggle) sidebarToggle.setAttribute("aria-expanded", String(open));
  // sidebar sliding in/out changes the map's visible width on mobile
  setTimeout(safeInvalidate, 300);
}

if (sidebarToggle && sidebar) {

  sidebarToggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSidebarOpen(!sidebar.classList.contains("open"));
  });

  // Prevent clicks inside the sidebar itself from being misread as "outside"
  // clicks by anything listening on document (defensive — the old global
  // outside-click listener that used to live here has been removed; the
  // scrim below is now the only thing that closes the sidebar on mobile).
  sidebar.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  const detailPanelEl = document.getElementById("detailPanel");
  if (detailPanelEl) {
    detailPanelEl.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  if (sidebarScrim) {
    sidebarScrim.addEventListener("click", () => setSidebarOpen(false));
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sidebar.classList.contains("open")) setSidebarOpen(false);
      closeDetailSheet();
    }
  });

}

// Keep everything in sync if the viewport crosses the mobile breakpoint
// (e.g. rotating a tablet, or resizing a DevTools responsive frame).
window.addEventListener('resize', debounce(() => {
  if (!isMobile()) {
    setSidebarOpen(false);
    closeDetailSheet();
  }
}, 200));

/* ================= PIPELINE METRICS ================= */
async function loadMetrics() {
  const el = document.getElementById('pipelineMetrics');
  const fiEl = document.getElementById('featureImportance');
  try {
    const res = await fetch('/api/model-metrics');
    const m = await res.json();
    el.innerHTML = `Crop model accuracy: <b>${(m.crop_model.accuracy * 100).toFixed(1)}%</b> (F1 ${m.crop_model.f1_macro}) ·
      Stress model accuracy: <b>${(m.stress_model.accuracy * 100).toFixed(1)}%</b> (F1 ${m.stress_model.f1_macro})`;

    if (fiEl && m.features) {
      // illustrative relative importances (spectral domain knowledge), since backend RandomForest
      // feature_importances_ is not exposed via metrics.json in this version
      const illustrative = { NDVI: 0.28, NDWI: 0.22, MSI: 0.10, VV_dB: 0.14, VH_dB: 0.12, VV_VH_ratio: 0.08, growth_fraction: 0.06 };
      fiEl.innerHTML = '<div class="legend-title" style="margin-bottom:10px">Feature Importance (illustrative)</div>' +
        Object.entries(illustrative).map(([k, v]) => `
          <div class="fi-row">
            <span class="fi-name">${k}</span>
            <div class="fi-bar-track"><div class="fi-bar-fill" style="width:${v * 100}%"></div></div>
            <span class="fi-val">${(v * 100).toFixed(0)}%</span>
          </div>
        `).join('');
    }
  } catch (e) {
    el.innerText = 'Metrics load nahi ho payi.';
  }
}

/* ================= ANALYZE WIZARD ================= */
function goToStep(step) {
  wizardStep = step;
  document.querySelectorAll('.wpanel').forEach(p => p.hidden = parseInt(p.dataset.panel) !== step);
  document.querySelectorAll('.wstep').forEach(s => {
    const n = parseInt(s.dataset.step);
    s.classList.toggle('active', n === step);
    s.classList.toggle('done', n < step);
    s.setAttribute('aria-selected', String(n === step));
  });
  document.getElementById('wPrev').disabled = step === 1;
  document.getElementById('wNext').style.display = step === 4 ? 'none' : 'inline-block';
}

const wNextBtn = document.getElementById('wNext');
const wPrevBtn = document.getElementById('wPrev');
if (wNextBtn) wNextBtn.addEventListener('click', () => { if (wizardStep < 4) goToStep(wizardStep + 1); });
if (wPrevBtn) wPrevBtn.addEventListener('click', () => { if (wizardStep > 1) goToStep(wizardStep - 1); });

document.querySelectorAll('.wstep').forEach(s => {
  s.addEventListener('click', () => goToStep(parseInt(s.dataset.step)));
  s.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToStep(parseInt(s.dataset.step));
    }
  });
});

const autoFillBtn = document.getElementById('autoFillBtn');
if (autoFillBtn) autoFillBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { alert('Geolocation supported nahi hai'); return; }
  autoFillBtn.textContent = '📍 Locating…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.querySelector('#analyzeForm input[name=lat]').value = pos.coords.latitude.toFixed(4);
      document.querySelector('#analyzeForm input[name=lon]').value = pos.coords.longitude.toFixed(4);
      autoFillBtn.textContent = '📍 Auto-fill Coordinates';
    },
    () => { alert('Location access denied'); autoFillBtn.textContent = '📍 Auto-fill Coordinates'; }
  );
});

document.getElementById('analyzeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = {
    lat: fd.get('lat'), lon: fd.get('lon'),
    crop: fd.get('crop') || null, date: fd.get('date') || null,
    deficit_pct: fd.get('deficit_pct') || null,
  };
  const resultDiv = document.getElementById('analyzeResult');
  resultDiv.innerHTML = '<div class="loader"><div class="spinner"></div> AI pipeline chal raha hai — satellite ingest, feature extraction, model prediction…</div>';
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (d.error) { resultDiv.innerHTML = `<p style="color:var(--red)">${d.error}</p>`; return; }
    const adv = d.advisory, feats = d.satellite_features;
    resultDiv.innerHTML = `
      <div class="risk-badge ${adv.urgency}">${adv.urgency} Risk</div>
      <div class="stat-grid">
        <div class="stat"><div class="label">Crop (AI)</div><div class="value">${d.ai_prediction.predicted_crop}</div></div>
        <div class="stat"><div class="label">Growth Stage</div><div class="value" style="font-size:14px">${feats.growth_stage}</div></div>
        <div class="stat"><div class="label">NDVI</div><div class="value">${feats.optical.NDVI}</div></div>
        <div class="stat"><div class="label">NDWI</div><div class="value">${feats.optical.NDWI}</div></div>
      </div>
      <div class="advisory-box ${adv.urgency}">
        <div class="urgency">${adv.urgency} Urgency · ${adv.stress_level}</div>
        <div class="action">${adv.action_hi}</div>
        <div>Recommended: <b>${adv.recommended_water_mm} mm</b> water</div>
        <ul class="reasoning">${adv.reasoning.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
    `;
  } catch (err) {
    resultDiv.innerHTML = `<p style="color:var(--red)">Error: ${err}</p>`;
  }
});

/* ================= PDF EXPORT (V2) ================= */
const stressBadgeColor = {
  "Healthy": [53, 195, 123],
  "Mild Stress": [224, 165, 48],
  "Moderate Stress": [255, 122, 26],
  "Severe Stress": [224, 72, 61],
};
const urgencyColor = {
  "Low": [53, 195, 123],
  "Moderate": [224, 165, 48],
  "High": [255, 122, 26],
  "Critical": [224, 72, 61],
};

function pdfBar(doc, x, y, w, h, pct, color) {
  doc.setFillColor(230, 236, 232);
  doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
  const fillW = Math.max(h, (w * Math.min(Math.max(pct, 0), 100)) / 100);
  doc.setFillColor(color[0], color[1], color[2]);
  doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
}

function ensureSpace(doc, y, needed) {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 20) {
    doc.addPage();
    return 20;
  }
  return y;
}

/* ---- health score: blend of NDVI, crop confidence, stress severity ---- */
function computeHealthScore(d) {
  const ndviScore = Math.min(Math.max(d.satellite_features.optical.NDVI, 0), 1) * 100;
  const cropConfScore = d.ai_prediction.crop_confidence * 100;
  const stressBase = { "Healthy": 100, "Mild Stress": 75, "Moderate Stress": 50, "Severe Stress": 25 };
  const stressScore = stressBase[d.ai_prediction.predicted_stress] ?? 50;
  const score = Math.round((ndviScore + cropConfScore + stressScore) / 3);
  let label = 'Poor';
  if (score >= 85) label = 'Excellent';
  else if (score >= 70) label = 'Good';
  else if (score >= 50) label = 'Fair';
  return { score, label };
}

/* ---- best-effort map snapshot via html2canvas (needs CORS-friendly tiles) ---- */
async function captureMapSnapshot() {
  try {
    if (!map || typeof html2canvas !== 'function') return null;
    const mapEl = document.getElementById('map');
    if (!mapEl) return null;
    const canvas = await html2canvas(mapEl, { useCORS: true, allowTaint: false, logging: false, scale: 1 });
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch (e) {
    console.warn('Map snapshot failed (tiles may not allow CORS capture):', e);
    return null;
  }
}

/* ---- weather for the field's coordinates ---- */
async function fetchFieldWeather(lat, lon) {
  try {
    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* ---- best-effort QR code image, encodes a short report summary ---- */
async function generateQRDataUrl(text) {
  return new Promise((resolve) => {
    try {
      if (typeof QRCode === 'undefined') { resolve(null); return; }
      const holder = document.createElement('div');
      holder.style.position = 'fixed';
      holder.style.left = '-9999px';
      document.body.appendChild(holder);
      new QRCode(holder, { text, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
      setTimeout(() => {
        const canvas = holder.querySelector('canvas');
        const url = canvas ? canvas.toDataURL('image/png') : null;
        document.body.removeChild(holder);
        resolve(url);
      }, 150);
    } catch (e) {
      resolve(null);
    }
  });
}

async function exportPDF() {
  if (!currentField) {
    alert("Please select a field first.");
    return;
  }

  const exportBtn = document.querySelector('[onclick="exportPDF()"]');
  if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '⏳ Generating PDF…'; }

  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const d = currentField;
    const pageW = doc.internal.pageSize.getWidth();
    const green = [53, 195, 123];
    const dark = [8, 18, 13];
    const feats = d.satellite_features;
    const uColor = urgencyColor[d.advisory.urgency] || [120, 120, 120];
    const sColor = stressBadgeColor[d.ai_prediction.predicted_stress] || [120, 120, 120];
    const health = computeHealthScore(d);

    // fetch weather + map snapshot + qr code in parallel
    const [weather, mapSnapshot, qrDataUrl] = await Promise.all([
      fetchFieldWeather(d.field.lat, d.field.lon),
      captureMapSnapshot(),
      generateQRDataUrl(`KrishiMitra Report | ${d.field.name || ''} (${d.field.id || ''}) | ${d.field.district || ''}, ${d.field.state || ''} | Crop: ${d.ai_prediction.predicted_crop} | Stress: ${d.ai_prediction.predicted_stress} | Urgency: ${d.advisory.urgency} | Generated: ${new Date().toLocaleString()}`),
    ]);

    // ---- Header banner ----
    doc.setFillColor(dark[0], dark[1], dark[2]);
    doc.rect(0, 0, pageW, 32, 'F');
    doc.setFillColor(green[0], green[1], green[2]);
    doc.circle(18, 16, 7, 'F');
    doc.setTextColor(8, 18, 13);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('K', 15.5, 19);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text('KrishiMitra AI Report', 30, 15);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text('ISRO H2S 2026 · Team SpaceHack · AI Crop & Irrigation Advisory', 30, 22);
    doc.setFontSize(8.5);
    doc.text('Generated: ' + new Date().toLocaleString(), 30, 28);

    // ---- Farmer / field info ----
    let y = 42;
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.text(d.field.name || 'Field', 15, y);

    doc.setFont(undefined, 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 100, 95);
    const locLine = [d.field.id, d.field.district, d.field.state].filter(Boolean).join(' · ');
    doc.text(locLine, 15, y + 6);
    doc.text(`Lat/Lon: ${d.field.lat}, ${d.field.lon}  ·  Date: ${d.field.date}`, 15, y + 11);

    doc.setFillColor(uColor[0], uColor[1], uColor[2]);
    doc.roundedRect(pageW - 55, y - 8, 40, 9, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont(undefined, 'bold');
    doc.text(`${d.advisory.urgency} Risk`, pageW - 35, y - 2, { align: 'center' });

    y += 20;

    // ---- Overall health score ----
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Overall Field Health', 15, y);
    doc.setFontSize(16);
    doc.setTextColor(green[0], green[1], green[2]);
    doc.text(`${health.score}%`, pageW - 20, y, { align: 'right' });
    y += 5;
    pdfBar(doc, 15, y, pageW - 55, 5, health.score, green);
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(90, 100, 95);
    doc.text(health.label, pageW - 20, y + 4, { align: 'right' });
    y += 14;

    // ---- AI Summary bullets ----
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('AI Summary', 15, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    const needsWater = d.advisory.recommended_water_mm > 0;
    const summaryLines = [
      `${d.ai_prediction.predicted_crop} detected`,
      `Crop status: ${d.ai_prediction.predicted_stress}`,
      `Growth stage: ${feats.growth_stage}`,
      needsWater ? `Irrigation required: ${d.advisory.recommended_water_mm} mm` : 'No irrigation required',
      `Risk: ${d.advisory.urgency}`,
    ];
    summaryLines.forEach(line => {
      doc.text(`✔ ${line}`, 18, y);
      y += 5.5;
    });
    y += 4;

    // ---- Map snapshot ----
    y = ensureSpace(doc, y, 70);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Field Map Snapshot', 15, y);
    y += 5;
    if (mapSnapshot) {
      try {
        doc.addImage(mapSnapshot, 'JPEG', 15, y, pageW - 30, 55);
      } catch (e) {
        doc.setDrawColor(200, 200, 200);
        doc.rect(15, y, pageW - 30, 55);
        doc.setFontSize(9);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(140, 150, 145);
        doc.text('Map snapshot unavailable', pageW / 2, y + 28, { align: 'center' });
      }
    } else {
      doc.setDrawColor(200, 200, 200);
      doc.rect(15, y, pageW - 30, 55);
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(140, 150, 145);
      doc.text('📍 Map snapshot unavailable (tiles blocked CORS capture)', pageW / 2, y + 28, { align: 'center' });
    }
    y += 62;

    // ---- AI prediction + stress ----
    y = ensureSpace(doc, y, 30);
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('AI Prediction', 15, y);
    y += 6;

    doc.setFont(undefined, 'normal');
    doc.setFontSize(9.5);
    doc.text(`Crop (AI): ${d.ai_prediction.predicted_crop}`, 15, y);
    doc.setFillColor(sColor[0], sColor[1], sColor[2]);
    doc.roundedRect(100, y - 4, 45, 6, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    doc.text(d.ai_prediction.predicted_stress, 122.5, y, { align: 'center' });
    doc.setTextColor(20, 20, 20);
    y += 8;

    doc.setFontSize(9);
    doc.text('Crop Confidence', 15, y + 3);
    pdfBar(doc, 55, y, 60, 4, d.ai_prediction.crop_confidence * 100, green);
    doc.text((d.ai_prediction.crop_confidence * 100).toFixed(0) + '%', 120, y + 3);

    doc.text('Stress Confidence', 15, y + 11);
    pdfBar(doc, 55, y + 8, 60, 4, d.ai_prediction.stress_confidence * 100, [255, 122, 26]);
    doc.text((d.ai_prediction.stress_confidence * 100).toFixed(0) + '%', 120, y + 11);

    y += 20;

    // ---- Satellite features (progress bars) ----
    y = ensureSpace(doc, y, 40);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Satellite Features', 15, y);
    y += 7;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);

    const featureRows = [
      ['NDVI', feats.optical.NDVI, Math.min(Math.max(feats.optical.NDVI, 0), 1) * 100, green],
      ['NDWI', feats.optical.NDWI, ((feats.optical.NDWI + 1) / 2) * 100, [47, 143, 224]],
      ['MSI', feats.optical.MSI, Math.min(Math.max(feats.optical.MSI, 0), 2) / 2 * 100, [224, 165, 48]],
    ];
    featureRows.forEach(([label, val, pct, color]) => {
      doc.text(label, 15, y + 3);
      pdfBar(doc, 40, y, 75, 4, pct, color);
      doc.text(String(val), 120, y + 3);
      y += 8;
    });

    doc.text(`SAR VV: ${feats.sar.VV_dB} dB   ·   SAR VH: ${feats.sar.VH_dB} dB   ·   VV/VH: ${feats.sar.VV_VH_ratio}`, 15, y + 2);
    y += 12;

    // ---- Satellite info card ----
    y = ensureSpace(doc, y, 26);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Satellite Information', 15, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text(`Source: ${feats.source}`, 15, y);
    doc.text('Resolution: 10 m', 90, y);
    doc.text(`Acquisition: ${d.field.date}`, 140, y);
    y += 12;

    // ---- Weather card ----
    y = ensureSpace(doc, y, 30);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Weather Conditions', 15, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    if (weather) {
      const temp = weather.temp_c ?? weather.temperature ?? weather.temp ?? 'N/A';
      const humidity = weather.humidity_pct ?? weather.humidity ?? 'N/A';
      const rain = weather.rain_mm ?? weather.rain ?? weather.precipitation_mm ?? 'N/A';
      const wind = weather.wind_kph ?? weather.wind_kmh ?? weather.wind ?? 'N/A';
      doc.text(`Temperature: ${temp} °C`, 15, y);
      doc.text(`Humidity: ${humidity} %`, 90, y);
      y += 6;
      doc.text(`Rain: ${rain} mm`, 15, y);
      doc.text(`Wind: ${wind} km/h`, 90, y);
      y += 10;
    } else {
      doc.setTextColor(140, 150, 145);
      doc.text('Weather data unavailable', 15, y);
      doc.setTextColor(20, 20, 20);
      y += 10;
    }

    // ---- Water requirement gauge ----
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('Required Water', 15, y);
    doc.setFontSize(13);
    doc.setTextColor(uColor[0], uColor[1], uColor[2]);
    doc.text(`${d.advisory.recommended_water_mm} mm`, pageW - 20, y, { align: 'right' });
    doc.setTextColor(20, 20, 20);
    y += 5;
    const waterPct = Math.min((d.advisory.recommended_water_mm / 50) * 100, 100);
    pdfBar(doc, 15, y, pageW - 30, 5, waterPct, uColor);
    y += 14;

    // ---- Advisory card ----
    y = ensureSpace(doc, y, 32);
    doc.setFillColor(245, 250, 247);
    doc.setDrawColor(uColor[0], uColor[1], uColor[2]);
    const advH = 30;
    doc.roundedRect(15, y, pageW - 30, advH, 3, 3, 'FD');
    doc.setTextColor(uColor[0], uColor[1], uColor[2]);
    doc.setFontSize(9.5);
    doc.setFont(undefined, 'bold');
    doc.text(`${d.advisory.urgency} Urgency · ${d.advisory.stress_level}`, 20, y + 7);
    doc.setTextColor(20, 20, 20);
    doc.setFontSize(9.5);
    doc.text(doc.splitTextToSize(d.advisory.action_hi, pageW - 45), 20, y + 14);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(9);
    doc.text(`Recommended water: ${d.advisory.recommended_water_mm} mm  ·  Demand: ${d.advisory.crop_water_demand_mm_day} mm/day`, 20, y + 25);

    y += advH + 10;

    // ---- Reasoning table ----
    if (Array.isArray(d.advisory.reasoning) && d.advisory.reasoning.length) {
      y = ensureSpace(doc, y, 20);
      doc.autoTable({
        startY: y,
        margin: { left: 15, right: 15 },
        head: [['AI Reasoning']],
        body: d.advisory.reasoning.map(r => [r]),
        theme: 'plain',
        headStyles: { fillColor: [16, 32, 26], textColor: 255, fontSize: 9.5 },
        bodyStyles: { fontSize: 9, textColor: [60, 70, 65] },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    // ---- Full data table ----
    y = ensureSpace(doc, y, 20);
    doc.autoTable({
      startY: y,
      margin: { left: 15, right: 15 },
      head: [['Property', 'Value']],
      headStyles: { fillColor: green, textColor: [8, 18, 13] },
      body: [
        ['Farmer', d.field.name],
        ['Field ID', d.field.id],
        ['District', d.field.district],
        ['State', d.field.state],
        ['Latitude', d.field.lat],
        ['Longitude', d.field.lon],
        ['Growth Stage', feats.growth_stage],
        ['Source', feats.source],
      ],
    });
    y = doc.lastAutoTable.finalY + 10;

    // ---- QR code ----
    if (qrDataUrl) {
      y = ensureSpace(doc, y, 40);
      doc.addImage(qrDataUrl, 'PNG', pageW / 2 - 15, y, 30, 30);
      doc.setFontSize(8.5);
      doc.setTextColor(140, 150, 145);
      doc.text('Scan to verify report', pageW / 2, y + 36, { align: 'center' });
    }

    // ---- Footer ----
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      const pageH = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(140, 150, 145);
      doc.text('Generated by KrishiMitra AI', 15, pageH - 8);
      doc.text(`Page ${p} of ${pageCount}`, pageW - 15, pageH - 8, { align: 'right' });
    }

    doc.save('KrishiMitra_Report_' + d.field.id + '.pdf');
  } catch (err) {
    console.error('PDF export failed:', err);
    alert('PDF export failed: ' + err.message);
  } finally {
    if (exportBtn) { exportBtn.disabled = false; exportBtn.textContent = '📄 Export PDF Report'; }
  }
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  showView("map");

  initMap();

  loadFields();

  setupFieldSearchFilter();

  goToStep(1);

  const initialCloseBtn = document.getElementById('detailClose');
  if (initialCloseBtn) initialCloseBtn.addEventListener('click', closeDetailSheet);
});






























/**
 * app.js  –  Student Predictor Frontend */

"use strict";

/* Constants*/
const API_BASE = "";   // same origin – Flask serves the frontend

/* ── State */
let predictionHistory = [];     // session-only array of {time, score, label, inputs}
let lastPrediction    = null;   // most recent prediction result object
let insightCharts     = {};     // Chart.js instances
let modelCharts       = {};

/*
   NAVIGATION */
function showPage(pageId) {
  document.querySelectorAll(".page").forEach(p => p.classList.add("hidden"));
  const target = document.getElementById(`page-${pageId}`);
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach(n => {
    n.classList.toggle("active", n.dataset.page === pageId);
  });

  // Lazy-load data for pages that need it
  if (pageId === "insights") loadInsights();
  if (pageId === "model")    loadModelMetrics();
  if (pageId === "profile")  renderProfileHistory();
  if (pageId === "dashboard") renderDashboardHistory();

  // Close mobile sidebar
  closeSidebar();
}

document.querySelectorAll(".nav-item").forEach(item => {
  item.addEventListener("click", e => {
    e.preventDefault();
    showPage(item.dataset.page);
  });
});

/*  Mobile sidebar  */
const sidebar        = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const menuToggle     = document.getElementById("menuToggle");

menuToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  sidebarOverlay.classList.toggle("active");
});
sidebarOverlay.addEventListener("click", closeSidebar);
function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarOverlay.classList.remove("active");
}

/* 
   GREETING */
function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const el = document.getElementById("greeting");
  if (el) el.textContent = `${g}, Student 👋`;
}
setGreeting();

/*   MODEL HEALTH CHECK */
async function checkHealth() {
  try {
    const res  = await fetch(`${API_BASE}/health`);
    const data = await res.json();
    const online = data.model_ready === true;
    setModelStatus(online, online ? "Model Online" : "Model Offline");
  } catch {
    setModelStatus(false, "Unavailable");
  }
}

function setModelStatus(online, label) {
  ["sidebarDot","headerDot"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("online",  online);
    el.classList.toggle("offline", !online);
  });
  const sidebarStatus = document.getElementById("sidebarStatus");
  const headerStatus  = document.getElementById("headerStatus");
  if (sidebarStatus) sidebarStatus.textContent = label;
  if (headerStatus)  headerStatus.textContent  = online ? "Prediction model online" : "Model unavailable";

  const badge = document.getElementById("settingsStatus");
  if (badge) {
    badge.textContent = label;
    badge.className   = "model-status-badge " + (online ? "online" : "offline");
  }
}

checkHealth();

/*    SLIDERS*/
function initSliders() {
  const sliders = [
    { id: "studyHours",   valId: "studyHoursVal",   fmt: v => `${parseFloat(v).toFixed(1)} hrs` },
    { id: "attendance",   valId: "attendanceVal",    fmt: v => `${Math.round(v)}%` },
    { id: "mentalHealth", valId: "mentalHealthVal",  fmt: v => `${Math.round(v)} / 10` },
    { id: "sleepHours",   valId: "sleepHoursVal",    fmt: v => `${parseFloat(v).toFixed(1)} hrs` },
  ];

  sliders.forEach(({ id, valId, fmt }) => {
    const slider = document.getElementById(id);
    const label  = document.getElementById(valId);
    if (!slider || !label) return;

    const update = () => {
      label.textContent = fmt(slider.value);
      updateSliderFill(slider);
    };
    slider.addEventListener("input", update);
    update();
  });
}

function updateSliderFill(slider) {
  const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
  slider.style.background = `linear-gradient(to right, var(--lavender) ${pct}%, var(--border) ${pct}%)`;
}

initSliders();

/*  PREDICT FORM*/
const predictForm = document.getElementById("predictForm");
predictForm.addEventListener("submit", async e => {
  e.preventDefault();
  await runPrediction();
});

async function runPrediction() {
  const formError  = document.getElementById("formError");
  const btnText    = document.querySelector(".btn-text");
  const btnLoader  = document.getElementById("btnLoader");
  const predictBtn = document.getElementById("predictBtn");

  formError.style.display = "none";

  // Collect values
  const study    = parseFloat(document.getElementById("studyHours").value);
  const att      = parseFloat(document.getElementById("attendance").value);
  const mental   = parseFloat(document.getElementById("mentalHealth").value);
  const sleep    = parseFloat(document.getElementById("sleepHours").value);
  const ptj      = document.querySelector('input[name="part_time_job"]:checked')?.value || "No";

  // Client-side validation
  const errors = [];
  if (isNaN(study) || study < 0 || study > 12) errors.push("Study hours must be 0–12.");
  if (isNaN(att)   || att   < 0 || att   > 100) errors.push("Attendance must be 0–100%.");
  if (isNaN(mental)|| mental < 1|| mental > 10)  errors.push("Mental health rating must be 1–10.");
  if (isNaN(sleep) || sleep  < 0 || sleep  > 12) errors.push("Sleep hours must be 0–12.");
  if (!["Yes","No"].includes(ptj))               errors.push("Part-time job must be Yes or No.");
  if (errors.length) {
    formError.textContent = errors.join(" ");
    formError.style.display = "block";
    return;
  }

  // Show loading
  predictBtn.disabled = true;
  btnText.classList.add("hidden");
  btnLoader.classList.remove("hidden");

  try {
    const res = await fetch(`${API_BASE}/predict`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        study_hours_per_day:    study,
        attendance_percentage:  att,
        mental_health_rating:   mental,
        sleep_hours:            sleep,
        part_time_job:          ptj,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showFormError(data.error || "Prediction failed. Please try again.");
      return;
    }

    // Save and display
    const result = {
      score:  data.predicted_score,
      label:  data.performance_label,
      color:  data.performance_color,
      inputs: { study, att, mental, sleep, ptj },
      time:   new Date(),
    };
    lastPrediction = result;
    predictionHistory.unshift(result);

    displayResult(result);
    updateDashboard(result);

  } catch (err) {
    showFormError("We couldn't reach the prediction server. Please ensure the backend is running.");
  } finally {
    predictBtn.disabled = false;
    btnText.classList.remove("hidden");
    btnLoader.classList.add("hidden");
  }
}

function showFormError(msg) {
  const el = document.getElementById("formError");
  el.textContent = msg;
  el.style.display = "block";
}

/* 
   DISPLAY PREDICTION RESULT*/
function displayResult(result) {
  const { score, label, color, inputs } = result;

  document.getElementById("resultPlaceholder").classList.add("hidden");
  document.getElementById("resultContent").classList.remove("hidden");

  // Score text
  document.getElementById("resultScore").textContent = score.toFixed(2);
  document.getElementById("resultRingPct").textContent = Math.round(score);

  // Badge
  const badge = document.getElementById("resultBadge");
  badge.textContent = label;
  const badgeColors = {
    green:  ["var(--green-light)",  "#2d6e4f"],
    blue:   ["var(--blue-light)",   "#2563a8"],
    yellow: ["var(--amber-light)",  "#92400e"],
    orange: ["#fde8e8",             "#991b1b"],
    red:    ["#fde8e8",             "#991b1b"],
  };
  const [bg, fg] = badgeColors[color] || badgeColors.blue;
  badge.style.background = bg;
  badge.style.color = fg;

  // Ring animation
  const ring = document.getElementById("resultRing");
  const circ = 452.39;
  ring.style.strokeDashoffset = circ - (score / 100) * circ;
  ring.style.stroke = score >= 70 ? "var(--green)" : score >= 50 ? "var(--amber)" : "var(--pink)";

  // Scale marker
  document.getElementById("scaleFill").style.width   = `${score}%`;
  document.getElementById("scaleMarker").style.left  = `${score}%`;

  // Model name
  document.getElementById("metaModel").textContent = "Random Forest";

  // Factor bars
  renderFactors(inputs, score);

  // Smooth scroll to result on mobile
  if (window.innerWidth < 900) {
    document.getElementById("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderFactors(inputs, score) {
  const list = document.getElementById("factorList");
  const items = [
    { name: "Study Hours",      val: `${inputs.study.toFixed(1)} hrs/day`, pct: (inputs.study  / 12)   * 100, color: "var(--lavender)" },
    { name: "Attendance",       val: `${Math.round(inputs.att)}%`,          pct: inputs.att,                    color: "var(--blue)"    },
    { name: "Mental Health",    val: `${inputs.mental} / 10`,               pct: (inputs.mental / 10)   * 100, color: "var(--green)"   },
    { name: "Sleep",            val: `${inputs.sleep.toFixed(1)} hrs`,       pct: (inputs.sleep  / 12)   * 100, color: "var(--amber)"   },
    { name: "Part-Time Job",    val: inputs.ptj,                             pct: inputs.ptj === "Yes" ? 100 : 0, color: "var(--pink)"  },
  ];

  list.innerHTML = items.map(it => `
    <div class="factor-item">
      <span class="factor-name">${it.name}</span>
      <div class="factor-bar-wrap">
        <div class="factor-bar" style="width:${it.pct}%;background:${it.color}"></div>
      </div>
      <span class="factor-val">${it.val}</span>
    </div>
  `).join("");
}

/* DASHBOARD UPDATE
 */
function updateDashboard(result) {
  const { score, label } = result;

  document.getElementById("dashScore").textContent = `${score.toFixed(2)} / 100`;
  document.getElementById("dashLevel").textContent = label;

  // Ring
  const ring  = document.getElementById("dashRing");
  const circ  = 502.65;
  ring.style.strokeDashoffset = circ - (score / 100) * circ;
  ring.style.stroke = score >= 70 ? "var(--lavender)" : score >= 50 ? "var(--amber)" : "var(--pink)";

  document.getElementById("dashRingScore").textContent = score.toFixed(1);
  document.getElementById("dashRangeFill").style.width = `${score}%`;
  document.getElementById("dashRingCaption").textContent = labelCaption(label);

  renderDashboardHistory();
}

function labelCaption(label) {
  const map = {
    "Excellent":         "Excellent performance range 🌟",
    "Good":              "Good performance range 👍",
    "Fair":              "Fair performance range",
    "Needs Improvement": "Room for improvement",
    "At Risk":           "Consider reviewing your study habits",
  };
  return map[label] || label;
}

function renderDashboardHistory() {
  const list = document.getElementById("historyList");
  if (!list) return;
  if (predictionHistory.length === 0) {
    list.innerHTML = `<div class="history-empty">No predictions yet. Head to <strong>Predict Score</strong> to get started.</div>`;
    return;
  }
  list.innerHTML = predictionHistory.slice(0, 6).map(h => `
    <div class="history-item">
      <span class="history-time">${formatTime(h.time)}</span>
      <span class="history-score">${h.score.toFixed(2)}</span>
      <span class="history-label ${labelClass(h.label)}">${h.label}</span>
    </div>
  `).join("");
}

/*    PROFILE PAGE */
function loadProfile() {
  const profile = JSON.parse(localStorage.getItem("sp_profile") || "{}");
  if (profile.id)     document.getElementById("profileId").value     = profile.id;
  if (profile.name)   document.getElementById("profileName").value   = profile.name;
  if (profile.course) document.getElementById("profileCourse").value = profile.course;
  if (profile.year)   document.getElementById("profileYear").value   = profile.year;
}

document.getElementById("saveProfile").addEventListener("click", () => {
  const profile = {
    id:     document.getElementById("profileId").value,
    name:   document.getElementById("profileName").value,
    course: document.getElementById("profileCourse").value,
    year:   document.getElementById("profileYear").value,
  };
  localStorage.setItem("sp_profile", JSON.stringify(profile));
  const confirm = document.getElementById("saveConfirm");
  confirm.classList.remove("hidden");
  setTimeout(() => confirm.classList.add("hidden"), 2500);
});

function renderProfileHistory() {
  const latest = document.getElementById("profileLatest");
  const level  = document.getElementById("profileLevel");
  const count  = document.getElementById("profileCount");
  const hist   = document.getElementById("profileHistory");

  count.textContent  = predictionHistory.length;
  if (lastPrediction) {
    latest.textContent = `${lastPrediction.score.toFixed(2)} / 100`;
    level.textContent  = lastPrediction.label;
  }

  if (predictionHistory.length === 0) {
    hist.innerHTML = `<div class="history-empty">No predictions yet.</div>`;
    return;
  }
  hist.innerHTML = predictionHistory.slice(0, 5).map(h => `
    <div class="history-item">
      <span class="history-time">${formatTime(h.time)}</span>
      <span class="history-score">${h.score.toFixed(2)}</span>
      <span class="history-label ${labelClass(h.label)}">${h.label}</span>
    </div>
  `).join("");
}

loadProfile();

/*    ACADEMIC INSIGHTS CHARTS */
let insightsLoaded = false;

async function loadInsights() {
  if (insightsLoaded) return;
  const badge = document.getElementById("datasetBadge");
  badge.textContent = "Loading…";

  try {
    const res  = await fetch(`${API_BASE}/dataset-stats`);
    const data = await res.json();
    if (!res.ok) { badge.textContent = "Dataset unavailable"; return; }

    badge.textContent = `${data.total_students} students · avg score ${data.avg_score}`;
    insightsLoaded = true;

    // Study vs score
    buildBarChart("studyChart",
      Object.keys(data.study_vs_score),
      Object.values(data.study_vs_score),
      "Mean Exam Score", "rgba(184,169,224,.75)", "rgba(184,169,224,1)");

    // Attendance vs score
    buildBarChart("attendanceChart",
      Object.keys(data.attendance_vs_score),
      Object.values(data.attendance_vs_score),
      "Mean Exam Score", "rgba(123,174,214,.75)", "rgba(123,174,214,1)");

    // Sleep vs score
    buildBarChart("sleepChart",
      Object.keys(data.sleep_vs_score),
      Object.values(data.sleep_vs_score),
      "Mean Exam Score", "rgba(141,191,168,.75)", "rgba(141,191,168,1)");

    // Mental health vs score (line chart)
    buildLineChart("mentalChart",
      Object.keys(data.mental_health_vs_score),
      Object.values(data.mental_health_vs_score),
      "Mean Exam Score");

    // Score distribution
    buildBarChart("distChart",
      Object.keys(data.score_distribution),
      Object.values(data.score_distribution),
      "Number of Students", "rgba(228,184,112,.75)", "rgba(228,184,112,1)");

    // Part-time job vs score
    buildBarChart("ptjChart",
      Object.keys(data.part_time_job_vs_score),
      Object.values(data.part_time_job_vs_score),
      "Mean Exam Score", "rgba(242,164,176,.75)", "rgba(242,164,176,1)");

    // Also update dashboard stats
    document.getElementById("dashAtt").textContent   = `${data.avg_attendance}%`;
    document.getElementById("dashStudy").textContent = `${data.avg_study_hours} hrs/day`;

  } catch (err) {
    badge.textContent = "Failed to load data";
    console.error("Insights error:", err);
  }
}

/* Shared Chart.js defaults  */
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: "#1e1b18",
      titleColor: "#fff",
      bodyColor: "rgba(255,255,255,.7)",
      padding: 10,
      cornerRadius: 8,
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 11 }, color: "#9ca3af" },
    },
    y: {
      grid: { color: "rgba(0,0,0,.05)" },
      ticks: { font: { size: 11 }, color: "#9ca3af" },
    },
  },
};

function buildBarChart(canvasId, labels, data, yLabel, bgColor, borderColor) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (insightCharts[canvasId]) insightCharts[canvasId].destroy();
  insightCharts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: yLabel,
        data,
        backgroundColor: bgColor,
        borderColor,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false },
      },
    },
  });
}

function buildLineChart(canvasId, labels, data, yLabel) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (insightCharts[canvasId]) insightCharts[canvasId].destroy();
  insightCharts[canvasId] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: yLabel,
        data,
        borderColor: "rgba(141,191,168,1)",
        backgroundColor: "rgba(141,191,168,.15)",
        fill: true,
        tension: 0.4,
        pointBackgroundColor: "rgba(141,191,168,1)",
        pointRadius: 5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...CHART_DEFAULTS,
      scales: {
        ...CHART_DEFAULTS.scales,
        y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false },
      },
    },
  });
}

/* MODEL PERFORMANCE*/
let metricsLoaded = false;

async function loadModelMetrics() {
  if (metricsLoaded) return;
  try {
    const res  = await fetch(`${API_BASE}/metrics`);
    const data = await res.json();
    if (!res.ok) return;

    metricsLoaded = true;

    // Dataset rows
    const rowsEl = document.getElementById("methodRows");
    if (rowsEl && data.dataset_rows_used) rowsEl.textContent = data.dataset_rows_used.toLocaleString();

    // Model cards
    const container = document.getElementById("modelCards");
    if (container && data.models) {
      container.innerHTML = data.models.map(m => `
        <div class="card model-card ${m.selected ? "selected" : ""}">
          <div class="model-name">${m.model}</div>
          <div class="model-metrics">
            <div class="metric-item metric-rmse">
              <div class="metric-val">${m.rmse.toFixed(4)}</div>
              <div class="metric-key">RMSE ↓</div>
            </div>
            <div class="metric-item metric-r2">
              <div class="metric-val">${(m.r2 * 100).toFixed(1)}%</div>
              <div class="metric-key">R² ↑</div>
            </div>
          </div>
          ${m.best_params && Object.keys(m.best_params).length ? `
            <div style="margin-top:10px;font-size:.75rem;color:var(--text-muted)">
              ${Object.entries(m.best_params).map(([k,v])=>`${k}=${v}`).join(" · ")}
            </div>` : ""}
        </div>
      `).join("");
    }

    // RMSE chart
    const modelNames = data.models.map(m => m.model);
    const rmseVals   = data.models.map(m => m.rmse);
    const r2Vals     = data.models.map(m => parseFloat((m.r2 * 100).toFixed(2)));

    const rmseCtx = document.getElementById("rmseChart");
    if (rmseCtx) {
      if (modelCharts.rmse) modelCharts.rmse.destroy();
      modelCharts.rmse = new Chart(rmseCtx, {
        type: "bar",
        data: {
          labels: modelNames,
          datasets: [{
            label: "RMSE (lower is better)",
            data: rmseVals,
            backgroundColor: ["rgba(184,169,224,.7)","rgba(141,191,168,.7)","rgba(242,164,176,.7)"],
            borderColor:     ["rgba(184,169,224,1)","rgba(141,191,168,1)","rgba(242,164,176,1)"],
            borderWidth: 1.5,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...CHART_DEFAULTS,
          scales: {
            ...CHART_DEFAULTS.scales,
            y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false },
          },
        },
      });
    }

    const r2Ctx = document.getElementById("r2Chart");
    if (r2Ctx) {
      if (modelCharts.r2) modelCharts.r2.destroy();
      modelCharts.r2 = new Chart(r2Ctx, {
        type: "bar",
        data: {
          labels: modelNames,
          datasets: [{
            label: "R² % (higher is better)",
            data: r2Vals,
            backgroundColor: ["rgba(123,174,214,.7)","rgba(228,184,112,.7)","rgba(184,169,224,.7)"],
            borderColor:     ["rgba(123,174,214,1)","rgba(228,184,112,1)","rgba(184,169,224,1)"],
            borderWidth: 1.5,
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          ...CHART_DEFAULTS,
          scales: {
            ...CHART_DEFAULTS.scales,
            y: { ...CHART_DEFAULTS.scales.y, beginAtZero: false, max: 100 },
          },
        },
      });
    }

    // Attach scroll-shrink behaviour after charts are built 
    attachScrollShrink();

  } catch (err) {
    console.error("Model metrics error:", err);
  }
}

/* SETTINGS */
document.getElementById("clearHistory").addEventListener("click", () => {
  predictionHistory = [];
  lastPrediction    = null;
  renderDashboardHistory();
  // Reset dashboard summary cards
  ["dashScore","dashLevel"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });
  document.getElementById("dashRingScore").textContent = "—";
  document.getElementById("dashRingCaption").textContent = "Run a prediction to see your score";
});

document.getElementById("clearProfile").addEventListener("click", () => {
  localStorage.removeItem("sp_profile");
  ["profileId","profileName","profileCourse"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const yearEl = document.getElementById("profileYear");
  if (yearEl) yearEl.value = "";
});

/*  HELPERS   */
function formatTime(date) {
  return date.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function labelClass(label) {
  const map = {
    "Excellent":         "label-excellent",
    "Good":              "label-good",
    "Fair":              "label-fair",
    "Needs Improvement": "label-needs",
    "At Risk":           "label-at-risk",
  };
  return map[label] || "label-good";
}

/*  OVERVIEW CHART (Dashboard)  */
async function buildOverviewChart() {
  try {
    const res  = await fetch(`${API_BASE}/dataset-stats`);
    const data = await res.json();
    if (!res.ok) return;

    const ctx = document.getElementById("overviewChart");
    if (!ctx) return;

    new Chart(ctx, {
      type: "line",
      data: {
        labels: Object.keys(data.study_vs_score),
        datasets: [
          {
            label: "Avg Score by Study Hours",
            data:  Object.values(data.study_vs_score),
            borderColor: "rgba(184,169,224,1)",
            backgroundColor: "rgba(184,169,224,.12)",
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: "rgba(184,169,224,1)",
          },
          {
            label: "Avg Score by Attendance ÷10",
            data:  Object.values(data.attendance_vs_score).map(v => v ? v * (80/100) : null),
            borderColor: "rgba(141,191,168,1)",
            backgroundColor: "rgba(141,191,168,.08)",
            fill: true,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: "rgba(141,191,168,1)",
          },
        ],
      },
      options: {
        /* ❶ explicit responsive flags — never collapse to 0px */
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { font: { size: 11 }, color: "#6b6e76", boxWidth: 12 },
          },
          tooltip: { backgroundColor: "#1e1b18", titleColor: "#fff", bodyColor: "rgba(255,255,255,.7)", cornerRadius: 8 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#9ca3af" } },
          y: { grid: { color: "rgba(0,0,0,.05)" }, ticks: { font: { size: 11 }, color: "#9ca3af" }, beginAtZero: false },
        },
      },
    });

    // Update summary cards with dataset averages
    document.getElementById("dashAtt").textContent   = `${data.avg_attendance}%`;
    document.getElementById("dashStudy").textContent = `${data.avg_study_hours} hrs/day`;
  } catch {
    // silent – overview chart is non-critical
  }
}

buildOverviewChart();

/*    SCROLL-SHRINK  (Model Performance bar charts)  */

let _shrinkObserver = null;

function attachScrollShrink() {
  // Idempotent – only attach once
  if (_shrinkObserver) return;

  const targets = document.querySelectorAll(".chart-canvas-wrap.scroll-shrink");
  if (!targets.length) return;

  _shrinkObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        // shrink when less than 20% is visible (user has scrolled past)
        const isMostlyHidden = entry.intersectionRatio < 0.2;
        entry.target.classList.toggle("shrunk", isMostlyHidden);

        // Tell Chart.js to resize after the CSS transition finishes
        const canvas = entry.target.querySelector("canvas");
        if (canvas) {
          setTimeout(() => {
            const chart = Chart.getChart(canvas);
            if (chart) chart.resize();
          }, 380); // match CSS transition duration
        }
      });
    },
    {
      // fire at 0% and 20% thresholds so both enter/exit are caught
      threshold: [0, 0.2],
    }
  );

  targets.forEach(el => _shrinkObserver.observe(el));
}

/*  INIT */
showPage("dashboard");

/*  SCORE ANALYZER*/

let analyzerRowCount = 0;
let analyzerChart    = null;

// Pastel palette for the bar chart (cycles if > 8 students)
const AZ_COLORS = [
  "rgba(184,169,224,.8)", "rgba(242,164,176,.8)", "rgba(141,191,168,.8)",
  "rgba(123,174,214,.8)", "rgba(228,184,112,.8)", "rgba(184,169,224,.5)",
  "rgba(242,164,176,.5)", "rgba(141,191,168,.5)",
];
const AZ_COLORS_BORDER = [
  "rgba(184,169,224,1)", "rgba(242,164,176,1)", "rgba(141,191,168,1)",
  "rgba(123,174,214,1)", "rgba(228,184,112,1)", "rgba(184,169,224,.8)",
  "rgba(242,164,176,.8)", "rgba(141,191,168,.8)",
];

/*  Row management */
function addAnalyzerRow(defaults = {}) {
  analyzerRowCount++;
  const n   = analyzerRowCount;
  const tbody = document.getElementById("analyzerBody");
  const tr    = document.createElement("tr");
  tr.id       = `az-row-${n}`;
  tr.innerHTML = `
    <td><span class="row-num">${n}</span></td>
    <td><input class="az-label-input" id="az-lbl-${n}" type="text"
         placeholder="Student ${n}" value="${defaults.label||''}" /></td>
    <td><input class="az-input" id="az-study-${n}" type="number"
         min="0" max="12" step="0.5" placeholder="5.0" value="${defaults.study||''}" /></td>
    <td><input class="az-input" id="az-att-${n}"   type="number"
         min="0" max="100" step="1"  placeholder="80"  value="${defaults.att||''}" /></td>
    <td><input class="az-input" id="az-mh-${n}"    type="number"
         min="1" max="10"  step="1"  placeholder="7"   value="${defaults.mh||''}" /></td>
    <td><input class="az-input" id="az-sleep-${n}" type="number"
         min="0" max="12"  step="0.5" placeholder="7.0" value="${defaults.sleep||''}" /></td>
    <td>
      <select class="az-select" id="az-ptj-${n}">
        <option value="No"  ${(defaults.ptj||'No')==='No' ?'selected':''}>No</option>
        <option value="Yes" ${defaults.ptj==='Yes'?'selected':''}>Yes</option>
      </select>
    </td>
    <td>
      <button class="btn-remove-row" onclick="removeAnalyzerRow(${n})" title="Remove row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </td>
  `;
  tbody.appendChild(tr);
}

function removeAnalyzerRow(n) {
  const row = document.getElementById(`az-row-${n}`);
  if (row) row.remove();
  // If all rows removed, add a fresh one
  if (document.getElementById("analyzerBody").children.length === 0) {
    analyzerRowCount = 0;
    addAnalyzerRow();
  }
}

// Seed with 3 starter rows
(function initAnalyzer() {
  addAnalyzerRow({ label:"Student A", study:6, att:85, mh:8, sleep:7,  ptj:"No"  });
  addAnalyzerRow({ label:"Student B", study:3, att:65, mh:5, sleep:6,  ptj:"Yes" });
  addAnalyzerRow({ label:"Student C", study:8, att:90, mh:9, sleep:7.5,ptj:"No"  });
})();

document.getElementById("addRowBtn").addEventListener("click", () => addAnalyzerRow());

/*  Read + validate all rows  */
function readAnalyzerRows() {
  const tbody = document.getElementById("analyzerBody");
  const rows  = Array.from(tbody.querySelectorAll("tr"));
  const students = [];
  const errors   = [];

  // Clear previous error highlights
  tbody.querySelectorAll(".az-input.error").forEach(el => el.classList.remove("error"));

  rows.forEach((tr, rowIdx) => {
    const n     = tr.id.replace("az-row-", "");
    const label = (document.getElementById(`az-lbl-${n}`)?.value || `Student ${rowIdx+1}`).trim();
    const study = parseFloat(document.getElementById(`az-study-${n}`)?.value);
    const att   = parseFloat(document.getElementById(`az-att-${n}`)?.value);
    const mh    = parseFloat(document.getElementById(`az-mh-${n}`)?.value);
    const sleep = parseFloat(document.getElementById(`az-sleep-${n}`)?.value);
    const ptj   = document.getElementById(`az-ptj-${n}`)?.value || "No";

    const rowErrors = [];
    const mark = (fieldId) => {
      const el = document.getElementById(fieldId);
      if (el) el.classList.add("error");
    };

    if (isNaN(study) || study < 0 || study > 12)  { rowErrors.push("study hours (0-12)");  mark(`az-study-${n}`); }
    if (isNaN(att)   || att   < 0 || att   > 100) { rowErrors.push("attendance (0-100)");  mark(`az-att-${n}`);   }
    if (isNaN(mh)    || mh    < 1 || mh    > 10)  { rowErrors.push("mental health (1-10)"); mark(`az-mh-${n}`);   }
    if (isNaN(sleep) || sleep < 0 || sleep > 12)  { rowErrors.push("sleep hours (0-12)");  mark(`az-sleep-${n}`); }

    if (rowErrors.length) {
      errors.push(`Row ${rowIdx + 1} (${label}): invalid ${rowErrors.join(", ")}`);
    } else {
      students.push({
        label,
        study_hours_per_day:   study,
        attendance_percentage: att,
        mental_health_rating:  mh,
        sleep_hours:           sleep,
        part_time_job:         ptj,
      });
    }
  });

  return { students, errors };
}

/* Run analysis */
document.getElementById("analyzeBtn").addEventListener("click", async () => {
  const errEl  = document.getElementById("analyzerError");
  const btnTxt = document.querySelector("#analyzeBtn .btn-text");
  const loader = document.getElementById("analyzeBtnLoader");
  const btn    = document.getElementById("analyzeBtn");

  errEl.style.display = "none";

  const { students, errors } = readAnalyzerRows();
  if (errors.length) {
    errEl.innerHTML = errors.map(e => `<div>⚠ ${e}</div>`).join("");
    errEl.style.display = "block";
    return;
  }

  // Loading state
  btn.disabled = true;
  btnTxt.classList.add("hidden");
  loader.classList.remove("hidden");

  try {
    const res  = await fetch(`${API_BASE}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ students }),
    });
    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || "Analysis failed. Please check your values.";
      errEl.style.display = "block";
      return;
    }

    renderAnalyzerResults(data);
  } catch {
    errEl.textContent = "Could not reach the prediction server. Is the backend running?";
    errEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btnTxt.classList.remove("hidden");
    loader.classList.add("hidden");
  }
});

/*Render results */
function renderAnalyzerResults(data) {
  const container = document.getElementById("analyzerResults");
  container.classList.remove("hidden");

  //  Summary pills 
  const summary = document.getElementById("analyzerSummary");
  summary.innerHTML = `
    <div class="az-summary-pill">
      <div class="az-pill-label">Students Analyzed</div>
      <div class="az-pill-val">${data.results.length}</div>
      <div class="az-pill-sub">in this batch</div>
    </div>
    <div class="az-summary-pill">
      <div class="az-pill-label">Average Score</div>
      <div class="az-pill-val">${data.avg_score.toFixed(2)}</div>
      <div class="az-pill-sub">/ 100</div>
    </div>
    <div class="az-summary-pill">
      <div class="az-pill-label">Highest Score</div>
      <div class="az-pill-val">${data.max_score.toFixed(2)}</div>
      <div class="az-pill-sub">${data.top_student}</div>
    </div>
    <div class="az-summary-pill">
      <div class="az-pill-label">Lowest Score</div>
      <div class="az-pill-val">${data.min_score.toFixed(2)}</div>
      <div class="az-pill-sub">/ 100</div>
    </div>
  `;

  //  Comparison bar chart 
  const ctx = document.getElementById("analyzerChart");
  if (analyzerChart) { analyzerChart.destroy(); analyzerChart = null; }
  analyzerChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.results.map(r => r.label),
      datasets: [{
        label: "Predicted Score",
        data:  data.results.map(r => r.predicted_score),
        backgroundColor: data.results.map((_, i) => AZ_COLORS[i % AZ_COLORS.length]),
        borderColor:     data.results.map((_, i) => AZ_COLORS_BORDER[i % AZ_COLORS_BORDER.length]),
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1e1b18",
          titleColor: "#fff",
          bodyColor:  "rgba(255,255,255,.75)",
          padding: 10, cornerRadius: 8,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y.toFixed(2)} / 100`,
          },
        },
        annotation: undefined,
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 }, color: "#6b6e76" } },
        y: {
          min: 0, max: 100,
          grid: { color: "rgba(0,0,0,.05)" },
          ticks: { font: { size: 11 }, color: "#9ca3af" },
        },
      },
    },
  });

  // ── Per-student cards (ranked by score) ──
  const sorted = [...data.results].sort((a, b) => b.predicted_score - a.predicted_score);
  const grid = document.getElementById("analyzerResultGrid");
  grid.innerHTML = sorted.map((r, rank) => {
    const inp     = r.inputs;
    const barColor = rank === 0 ? "var(--green)" : rank === sorted.length-1 ? "var(--pink)" : "var(--lavender)";
    return `
      <div class="az-result-card">
        <div class="az-card-header">
          <div class="az-card-name">${r.label}</div>
          <div class="az-card-rank">#${rank+1}</div>
        </div>
        <div class="az-card-score" style="color:${barColor}">${r.predicted_score.toFixed(2)}</div>
        <div class="az-card-label" style="color:${labelColorVar(r.performance_color)}">${r.performance_label}</div>
        <div class="az-mini-bars">
          ${miniBar("Study",    `${parseFloat(inp.study_hours_per_day).toFixed(1)} hrs`,   (inp.study_hours_per_day/12)*100, "var(--lavender)")}
          ${miniBar("Attend.",  `${Math.round(inp.attendance_percentage)}%`,                inp.attendance_percentage,        "var(--blue)"    )}
          ${miniBar("Mental",   `${inp.mental_health_rating}/10`,                          (inp.mental_health_rating/10)*100,"var(--green)"   )}
          ${miniBar("Sleep",    `${parseFloat(inp.sleep_hours).toFixed(1)} hrs`,            (inp.sleep_hours/12)*100,         "var(--amber)"   )}
          ${miniBar("Job",      inp.part_time_job,                                          inp.part_time_job==="Yes"?100:0,  "var(--pink)"    )}
        </div>
      </div>
    `;
  }).join("");

  // Smooth scroll to results
  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

function miniBar(key, val, pct, color) {
  return `
    <div class="az-mini-row">
      <span class="az-mini-key">${key}</span>
      <div class="az-mini-bar-w">
        <div class="az-mini-bar" style="width:${Math.min(100,Math.max(0,pct))}%;background:${color}"></div>
      </div>
      <span class="az-mini-val">${val}</span>
    </div>
  `;
}

function labelColorVar(color) {
  const map = { green:"#2d6e4f", blue:"#2563a8", yellow:"#92400e", orange:"#b45309", red:"#991b1b" };
  return map[color] || "#1f2328";
}

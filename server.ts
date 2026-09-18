import { spawnSync } from "child_process";
import { readFileSync, existsSync } from "fs";

const PORT = Number(process.env.PORT || 8844);
const HOST = process.env.HOST || "127.0.0.1";

// Live speed tracking cache from /proc/net/dev
let lastDevSampleTime = 0;
let lastDevStats: Record<string, { rx: number; tx: number }> = {};
let currentRates: Record<string, { rxSec: number; txSec: number }> = {};

function sampleProcNetDev(): void {
  try {
    if (!existsSync("/proc/net/dev")) return;
    const content = readFileSync("/proc/net/dev", "utf-8");
    const lines = content.split("\n").slice(2);
    const now = Date.now();
    const dt = lastDevSampleTime > 0 ? (now - lastDevSampleTime) / 1000 : 0;
    const newStats: Record<string, { rx: number; tx: number }> = {};

    for (const line of lines) {
      const parts = line.split(":");
      if (parts.length !== 2) continue;
      const iface = parts[0].trim();
      const cols = parts[1].trim().split(/\s+/);
      const rx = Number(cols[0]) || 0;
      const tx = Number(cols[8]) || 0;
      newStats[iface] = { rx, tx };

      if (dt > 0 && lastDevStats[iface]) {
        const rxSec = Math.max(0, (rx - lastDevStats[iface].rx) / dt);
        const txSec = Math.max(0, (tx - lastDevStats[iface].tx) / dt);
        currentRates[iface] = { rxSec, txSec };
      } else if (!currentRates[iface]) {
        currentRates[iface] = { rxSec: 0, txSec: 0 };
      }
    }
    lastDevStats = newStats;
    lastDevSampleTime = now;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error reading /proc/net/dev:", message);
  }
}

// Initial sample & regular interval
sampleProcNetDev();
setInterval(sampleProcNetDev, 2000);

function getVnstatData() {
  sampleProcNetDev();
  try {
    const res = spawnSync("vnstat", ["--json"], { encoding: "utf-8", timeout: 4000 });
    if (res.error) throw res.error;
    const parsed = JSON.parse(res.stdout);
    return { success: true, data: parsed, liveRates: currentRates };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, liveRates: currentRates };
  }
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Network Telemetry & Analytics · vnStat</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Geist:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #FBFBFA;
      --card-bg: #FFFFFF;
      --card-subtle: #F9F9F8;
      --border: #EAEAEA;
      --border-subtle: rgba(0, 0, 0, 0.05);
      --text-main: #111111;
      --text-muted: #787774;
      --text-dim: #9E9E9B;
      --font-serif: 'Newsreader', Georgia, serif;
      --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'Geist Mono', monospace;

      /* Semantic Muted Pastels (Strictly Minimalist Protocol) */
      --pastel-blue-bg: #E1F3FE;
      --pastel-blue-text: #1F6C9F;
      --pastel-red-bg: #FDEBEC;
      --pastel-red-text: #9F2F2D;
      --pastel-green-bg: #EDF3EC;
      --pastel-green-text: #346538;
      --pastel-yellow-bg: #FBF3DB;
      --pastel-yellow-text: #956400;

      /* Heatmap Palette */
      --heat-0-bg: #FFFFFF;
      --heat-0-border: #EAEAEA;
      --heat-1-bg: #F4F8F3;
      --heat-1-border: #DDECDA;
      --heat-1-text: #346538;
      --heat-2-bg: #E4F1E2;
      --heat-2-border: #C4DEC0;
      --heat-2-text: #27562A;
      --heat-3-bg: #CCE5C9;
      --heat-3-border: #A3CCA0;
      --heat-3-text: #19441B;
      --heat-4-bg: #ADD4A8;
      --heat-4-border: #7EA97B;
      --heat-4-text: #0D2C0E;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font-sans);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      padding: 40px 24px 80px 24px;
      display: flex;
      justify-content: center;
    }

    .container {
      width: 100%;
      max-width: 1200px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    /* Header & Document Bar */
    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
      flex-wrap: wrap;
      gap: 16px;
    }

    .doc-meta {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .doc-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #346538;
      display: inline-block;
      animation: pulse 2s infinite ease-in-out;
    }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.7; }
      50% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.7; }
    }

    h1 {
      font-family: var(--font-serif);
      font-size: 38px;
      font-weight: 400;
      letter-spacing: -0.025em;
      line-height: 1.1;
      color: var(--text-main);
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      max-width: 600px;
    }

    .controls-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .control-group {
      display: flex;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 13px;
    }

    .control-label {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-right: 8px;
    }

    select, input {
      background: transparent;
      border: none;
      font-family: var(--font-sans);
      font-size: 13px;
      color: var(--text-main);
      outline: none;
      cursor: pointer;
    }

    input[type="number"] {
      width: 54px;
      font-family: var(--font-mono);
    }

    button.btn-minimal {
      background: var(--text-main);
      color: #FFFFFF;
      border: 1px solid var(--text-main);
      border-radius: 6px;
      padding: 6px 14px;
      font-family: var(--font-sans);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.15s ease, transform 0.15s ease;
    }

    button.btn-minimal:hover {
      opacity: 0.88;
    }

    button.btn-minimal:active {
      transform: scale(0.98);
    }

    button.btn-subtle {
      background: var(--card-subtle);
      color: var(--text-main);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 12px;
      font-family: var(--font-sans);
      font-size: 12px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s ease, color 0.15s ease;
    }

    button.btn-subtle:hover {
      background: #EAEAEA;
    }

    /* Tag & Badges */
    .pill {
      border-radius: 9999px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 2px 8px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: var(--font-mono);
      font-weight: 500;
    }

    .pill-blue { background: var(--pastel-blue-bg); color: var(--pastel-blue-text); }
    .pill-red { background: var(--pastel-red-bg); color: var(--pastel-red-text); }
    .pill-green { background: var(--pastel-green-bg); color: var(--pastel-green-text); }
    .pill-yellow { background: var(--pastel-yellow-bg); color: var(--pastel-yellow-text); }

    /* Bento Grid Structure */
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 16px;
    }

    .col-3 { grid-column: span 3; }
    .col-4 { grid-column: span 4; }
    .col-5 { grid-column: span 5; }
    .col-6 { grid-column: span 6; }
    .col-7 { grid-column: span 7; }
    .col-8 { grid-column: span 8; }
    .col-12 { grid-column: span 12; }

    @media (max-width: 992px) {
      .col-3 { grid-column: span 6; }
      .col-4 { grid-column: span 12; }
      .col-5 { grid-column: span 12; }
      .col-7 { grid-column: span 12; }
      .col-8 { grid-column: span 12; }
    }

    @media (max-width: 640px) {
      .col-3 { grid-column: span 12; }
      .col-6 { grid-column: span 12; }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: box-shadow 0.2s ease, transform 0.2s ease;
    }

    .card:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.02);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 8px;
    }

    .card-title {
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
    }

    .card-figure {
      font-family: var(--font-mono);
      font-size: 28px;
      font-weight: 500;
      letter-spacing: -0.02em;
      color: var(--text-main);
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .card-unit {
      font-size: 13px;
      color: var(--text-muted);
      font-weight: 400;
    }

    .card-footnote {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    /* Split progress bar */
    .ratio-bar-container {
      width: 100%;
      height: 8px;
      background: var(--card-subtle);
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      margin: 14px 0 8px 0;
      border: 1px solid var(--border);
    }

    .ratio-dl {
      background: #1F6C9F;
      height: 100%;
      transition: width 0.4s ease;
    }

    .ratio-ul {
      background: #9F2F2D;
      height: 100%;
      transition: width 0.4s ease;
    }

    .ratio-legend {
      display: flex;
      justify-content: space-between;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }

    /* Chart wrapper */
    .chart-box {
      width: 100%;
      height: 260px;
      position: relative;
    }

    /* Insight Banner */
    .insight-callout {
      background: var(--card-subtle);
      border-left: 3px solid var(--text-main);
      padding: 12px 16px;
      border-radius: 0 6px 6px 0;
      margin-bottom: 16px;
      font-size: 13px;
      color: var(--text-main);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .insight-strong {
      font-family: var(--font-mono);
      font-weight: 500;
    }

    /* Table */
    .data-table-wrapper {
      overflow-x: auto;
      margin-top: 8px;
    }

    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-family: var(--font-mono);
      font-size: 12px;
      text-align: left;
    }

    table.data-table th {
      border-bottom: 1px solid var(--border);
      padding: 10px 8px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.05em;
    }

    table.data-table td {
      border-bottom: 1px solid var(--border-subtle);
      padding: 10px 8px;
      color: var(--text-main);
    }

    table.data-table tr:hover td {
      background-color: var(--card-subtle);
    }

    .text-right { text-align: right; }
    .text-muted { color: var(--text-muted); }

    /* ========================================================
       SPECTRUM CONTROLS & HEATMAP STYLES
       ======================================================== */
    .cal-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cal-month-title {
      font-family: var(--font-serif);
      font-size: 20px;
      font-weight: 400;
      letter-spacing: -0.01em;
      color: var(--text-main);
      min-width: 180px;
      text-align: center;
    }

    .heat-legend {
      display: flex;
      align-items: center;
      gap: 6px;
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
    }

    .heat-swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid var(--border);
      display: inline-block;
    }

    /* Daily Calendar Grid */
    .calendar-grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 8px;
      margin-top: 14px;
    }

    .cal-header-day {
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-muted);
      padding: 6px 8px;
      text-align: center;
      border-bottom: 1px solid var(--border);
    }

    .cal-cell {
      background: var(--heat-0-bg);
      border: 1px solid var(--heat-0-border);
      border-radius: 8px;
      padding: 10px 10px 8px 10px;
      min-height: 84px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      cursor: pointer;
      position: relative;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }

    .cal-cell:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
      border-color: #111111;
      z-index: 2;
    }

    .cal-cell-empty {
      background: transparent;
      border: 1px dashed var(--border-subtle);
      cursor: default;
      opacity: 0.35;
    }

    .cal-cell-empty:hover {
      transform: none;
      box-shadow: none;
      border-color: var(--border-subtle);
    }

    /* Heat intensity levels */
    .cal-level-0 {
      background: var(--heat-0-bg);
      border-color: var(--heat-0-border);
    }

    .cal-level-1 {
      background: var(--heat-1-bg);
      border-color: var(--heat-1-border);
      color: var(--heat-1-text);
    }

    .cal-level-2 {
      background: var(--heat-2-bg);
      border-color: var(--heat-2-border);
      color: var(--heat-2-text);
    }

    .cal-level-3 {
      background: var(--heat-3-bg);
      border-color: var(--heat-3-border);
      color: var(--heat-3-text);
    }

    .cal-level-4 {
      background: var(--heat-4-bg);
      border-color: var(--heat-4-border);
      color: var(--heat-4-text);
    }

    .cal-date-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .cal-date-num {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 500;
    }

    .cal-today-badge {
      font-family: var(--font-mono);
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #111111;
      color: #FFFFFF;
      padding: 1px 5px;
      border-radius: 3px;
    }

    .cal-volume {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      margin: 4px 0;
      letter-spacing: -0.02em;
    }

    .cal-breakdown-sub {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
      opacity: 0.9;
    }

    /* Weekly Grid Layout */
    .weekly-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-top: 14px;
    }

    .week-card {
      background: var(--heat-0-bg);
      border: 1px solid var(--heat-0-border);
      border-radius: 10px;
      padding: 18px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 140px;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }

    .week-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
      border-color: #111111;
    }

    .week-mini-bars {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 28px;
      margin-top: 10px;
      padding-top: 4px;
      border-top: 1px solid var(--border-subtle);
      overflow: hidden;
      position: relative;
    }

    .week-bar-col {
      flex: 1;
      background: var(--border);
      border-radius: 2px;
      min-height: 4px;
      max-height: 100%;
      transition: height 0.3s ease;
    }

    /* Monthly Grid Layout (12 months) */
    .monthly-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-top: 14px;
    }

    @media (max-width: 900px) {
      .monthly-grid {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    @media (max-width: 600px) {
      .monthly-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .month-card {
      background: var(--heat-0-bg);
      border: 1px solid var(--heat-0-border);
      border-radius: 10px;
      padding: 16px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-height: 110px;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }

    .month-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
      border-color: #111111;
    }

    /* ========================================================
       MODAL DRAWER: DRILL-DOWN (Day, Week, Month)
       ======================================================== */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(17, 17, 17, 0.45);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 100%;
      max-width: 680px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.08);
      display: flex;
      flex-direction: column;
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      padding: 24px 28px 18px 28px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .modal-title-group h2 {
      font-family: var(--font-serif);
      font-size: 26px;
      font-weight: 400;
      letter-spacing: -0.015em;
      color: var(--text-main);
    }

    .modal-subtitle {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 4px;
    }

    .modal-close-btn {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 6px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-muted);
      transition: color 0.15s ease, border-color 0.15s ease;
    }

    .modal-close-btn:hover {
      color: var(--text-main);
      border-color: var(--text-main);
    }

    .modal-body {
      padding: 24px 28px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .modal-grid-kpi {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }

    @media (max-width: 600px) {
      .modal-grid-kpi {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .modal-kpi-card {
      background: var(--card-subtle);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }

    .modal-kpi-label {
      font-family: var(--font-mono);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }

    .modal-kpi-val {
      font-family: var(--font-mono);
      font-size: 20px;
      font-weight: 500;
      color: var(--text-main);
      margin-top: 4px;
    }

    /* SVG icons helper */
    .svg-icon {
      width: 14px;
      height: 14px;
      stroke-width: 2;
      stroke: currentColor;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      vertical-align: middle;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="doc-meta">
        <div class="doc-badge">
          <span class="status-dot"></span>
          <span>System Telemetry Daemon · vnStat 2.x</span>
        </div>
        <h1>Network Consumption Analytics</h1>
        <div class="subtitle">
          Continuous kernel packet accounting, multi-scale temporal heatmaps (Day, Week, Month), and historical traffic characterization.
        </div>
      </div>

      <div class="controls-bar">
        <div class="control-group">
          <span class="control-label">Interface</span>
          <select id="ifaceSelector" onchange="renderDashboard()">
            <option value="ALL">All Interfaces</option>
          </select>
        </div>

        <div class="control-group">
          <span class="control-label">Budget</span>
          <input type="number" id="budgetInput" value="50" min="1" max="2000" onchange="renderDashboard()">
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: 2px;">GB</span>
        </div>

        <button class="btn-minimal" onclick="fetchTelemetry(true)">
          <svg class="svg-icon" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          Sync Now
        </button>
      </div>
    </header>

    <!-- Top KPI Bento Row -->
    <section class="bento-grid">
      <!-- KPI 1: Today Usage -->
      <div class="col-3 card">
        <div class="card-header">
          <span class="card-title">Today's Consumption</span>
          <span id="todayBadge" class="pill pill-blue">Active</span>
        </div>
        <div class="card-figure">
          <span id="todayTotal">0.00</span>
          <span class="card-unit">MB</span>
        </div>
        <div class="card-footnote">
          <span style="color: var(--pastel-blue-text);">↓ <span id="todayRx">0.00 MB</span></span>
          <span style="margin: 0 4px; color: var(--border);">·</span>
          <span style="color: var(--pastel-red-text);">↑ <span id="todayTx">0.00 MB</span></span>
        </div>
      </div>

      <!-- KPI 2: Current Live Throughput -->
      <div class="col-3 card">
        <div class="card-header">
          <span class="card-title">Current Throughput</span>
          <span id="liveStatus" class="pill pill-green">Live</span>
        </div>
        <div class="card-figure">
          <span id="liveTotalSpeed">0.0</span>
          <span class="card-unit">KB/s</span>
        </div>
        <div class="card-footnote">
          <span style="color: var(--pastel-blue-text);">RX: <span id="liveRxSpeed">0.0 KB/s</span></span>
          <span style="margin: 0 4px; color: var(--border);">·</span>
          <span style="color: var(--pastel-red-text);">TX: <span id="liveTxSpeed">0.0 KB/s</span></span>
        </div>
      </div>

      <!-- KPI 3: Monthly Projection & Quota Health -->
      <div class="col-3 card">
        <div class="card-header">
          <span class="card-title">Month-End Projection</span>
          <span id="budgetHealthPill" class="pill pill-green">Optimal</span>
        </div>
        <div class="card-figure">
          <span id="projectedTotal">0.0</span>
          <span class="card-unit">GB</span>
        </div>
        <div class="card-footnote" id="budgetFootnote">
          Current MTD: <span id="mtdActual" class="insight-strong">0.0 MB</span>
        </div>
      </div>

      <!-- KPI 4: Traffic Characterization -->
      <div class="col-3 card">
        <div class="card-header">
          <span class="card-title">DL / UL Ratio</span>
          <span id="ratioProfile" class="pill pill-yellow">Consumer</span>
        </div>
        <div class="ratio-bar-container">
          <div id="ratioDlBar" class="ratio-dl" style="width: 80%;"></div>
          <div id="ratioUlBar" class="ratio-ul" style="width: 20%;"></div>
        </div>
        <div class="ratio-legend">
          <span>Down: <strong id="ratioDlPct">80%</strong></span>
          <span>Up: <strong id="ratioUlPct">20%</strong></span>
        </div>
      </div>
    </section>

    <!-- ========================================================
         MULTI-GRANULARITY SPECTRUM: DAY / WEEK / MONTH HEATMAP
         ======================================================== -->
    <section class="card col-12" style="grid-column: span 12;">
      <div class="card-header">
        <div>
          <div class="card-title" id="spectrumTitle">Consumption Spectrum & Trend Heatmap</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-top: 2px;" id="spectrumSubtitle">
            Multi-scale telemetry heatmap. Toggle between Daily, Weekly, and Monthly views.
          </div>
        </div>

        <div class="cal-controls">
          <!-- Granularity Selector: Day / Week / Month -->
          <div class="control-group" style="padding: 2px 4px;">
            <button id="granDayBtn" class="btn-subtle" style="background: #111111; color: #FFFFFF;" onclick="setGranularity('day')">Day</button>
            <button id="granWeekBtn" class="btn-subtle" style="border: none;" onclick="setGranularity('week')">Week</button>
            <button id="granMonthBtn" class="btn-subtle" style="border: none;" onclick="setGranularity('month')">Month</button>
          </div>

          <!-- Time Navigator (adapts to Day/Week vs Month) -->
          <div id="calNavControls" style="display: flex; align-items: center; gap: 4px;">
            <button class="btn-subtle" onclick="shiftPeriod(-1)">‹</button>
            <span id="calendarPeriodLabel" class="cal-month-title">September 2026</span>
            <button class="btn-subtle" onclick="shiftPeriod(1)">›</button>
          </div>

          <!-- Heatmap Legend -->
          <div class="heat-legend" style="margin-left: 8px;">
            <span>0</span>
            <span class="heat-swatch" style="background: var(--heat-0-bg);"></span>
            <span class="heat-swatch" style="background: var(--heat-1-bg); border-color: var(--heat-1-border);"></span>
            <span class="heat-swatch" style="background: var(--heat-2-bg); border-color: var(--heat-2-border);"></span>
            <span class="heat-swatch" style="background: var(--heat-3-bg); border-color: var(--heat-3-border);"></span>
            <span class="heat-swatch" style="background: var(--heat-4-bg); border-color: var(--heat-4-border);"></span>
            <span>Peak</span>
          </div>
        </div>
      </div>

      <!-- Spectrum Summary Insight Banner -->
      <div id="spectrumInsightBanner" class="insight-callout" style="margin-bottom: 8px;">
        <div>
          <span class="insight-strong" id="bannerLabel1">Total:</span> <span id="bannerVal1">0.00 MB</span>
          <span style="margin: 0 8px; color: var(--border);">·</span>
          <span class="insight-strong" id="bannerLabel2">Peak:</span> <span id="bannerVal2">-</span>
        </div>
        <div id="bannerVal3" class="text-muted" style="font-family: var(--font-mono); font-size: 12px;">
          Active records: 0
        </div>
      </div>

      <!-- Dynamic Spectrum View Container -->
      <div id="spectrumContainer">
        <!-- Rendered dynamically depending on granularity: Day, Week, or Month -->
      </div>
    </section>

    <!-- Hourly Distribution & Temporal Peak Detection -->
    <section class="bento-grid">
      <div class="col-8 card">
        <div class="card-header">
          <span class="card-title">24-Hour Temporal Distribution & Peak Windows</span>
          <span class="pill pill-blue">Hourly Spectrum</span>
        </div>

        <div id="peakInsightBanner" class="insight-callout">
          <div>
            <span class="insight-strong">Peak Detection:</span>
            <span id="peakWindowText">Calculating window...</span>
          </div>
          <div id="workHoursText" class="text-muted" style="font-family: var(--font-mono); font-size: 12px;">
            Work hrs (09-18): 0%
          </div>
        </div>

        <div class="chart-box">
          <canvas id="hourlyChart"></canvas>
        </div>
      </div>

      <!-- 5-Minute High-Res Trend -->
      <div class="col-4 card">
        <div class="card-header">
          <span class="card-title">5-Minute Burst Activity</span>
          <span class="pill pill-green">High-Res</span>
        </div>
        <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
          Telemetry samples captured every 300 seconds to isolate sudden background transfers.
        </div>
        <div class="chart-box">
          <canvas id="recentTrendChart"></canvas>
        </div>
      </div>
    </section>

    <!-- Daily Trend & Hall of Fame -->
    <section class="bento-grid">
      <!-- 30-Day History with Moving Average -->
      <div class="col-7 card">
        <div class="card-header">
          <span class="card-title">Daily Trend & Moving Average</span>
          <span class="pill pill-blue">30 Days</span>
        </div>
        <div class="chart-box">
          <canvas id="dailyChart"></canvas>
        </div>
      </div>

      <!-- Hall of Fame: Top 10 Heavy Usage Days -->
      <div class="col-5 card">
        <div class="card-header">
          <span class="card-title">Top Volume Days (Hall of Fame)</span>
          <span class="pill pill-red">Peak Records</span>
        </div>
        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th class="text-right">Download</th>
                <th class="text-right">Upload</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody id="topDaysBody">
              <tr>
                <td colspan="4" class="text-muted" style="text-align: center; padding: 20px;">
                  Collecting historical baseline records...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Document Footer -->
    <footer style="margin-top: 16px; padding-top: 20px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 12px; color: var(--text-muted); font-family: var(--font-mono); flex-wrap: wrap; gap: 8px;">
      <div>Database: <code>/var/lib/vnstat/vnstat.db</code></div>
      <div id="lastSyncLabel">Last sync: Initializing...</div>
    </footer>
  </div>

  <!-- ========================================================
       DAY DRILL-DOWN INSPECTION MODAL (Document-Style)
       ======================================================== -->
  <div id="dayDetailModal" class="modal-overlay" onclick="handleModalBackdropClick(event, 'dayDetailModal')">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <div class="modal-subtitle">Daily Telemetry Record</div>
          <h2 id="modalDateTitle">18 September 2026</h2>
        </div>
        <button class="modal-close-btn" onclick="closeModal('dayDetailModal')">✕</button>
      </div>

      <div class="modal-body">
        <div class="modal-grid-kpi">
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Total Volume</div>
            <div class="modal-kpi-val" id="modalTotalVol">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Download (RX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-blue-text);" id="modalRxVol">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Upload (TX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-red-text);" id="modalTxVol">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Monthly Rank</div>
            <div class="modal-kpi-val" id="modalDayRank">#1</div>
          </div>
        </div>

        <div class="insight-callout" style="margin-bottom: 0;">
          <div>
            <span class="insight-strong">Analytical Comparison:</span>
            <span id="modalComparisonText">Calculating baseline delta...</span>
          </div>
        </div>

        <div>
          <div style="font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; letter-spacing: 0.05em;">
            Hourly Activity on this Date
          </div>
          <div style="height: 180px; position: relative;" id="modalChartWrapper">
            <canvas id="modalHourlyChart"></canvas>
          </div>
          <div id="modalNoHourlyNotice" style="display: none; padding: 24px; text-align: center; font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); background: var(--card-subtle); border-radius: 6px;">
            Granular hourly telemetry is preserved for the recent 24–48h window. Daily aggregate totals remain permanent.
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ========================================================
       WEEK DRILL-DOWN INSPECTION MODAL (Document-Style)
       ======================================================== -->
  <div id="weekDetailModal" class="modal-overlay" onclick="handleModalBackdropClick(event, 'weekDetailModal')">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <div class="modal-subtitle">Weekly Telemetry Summary</div>
          <h2 id="modalWeekTitle">Week 38 (15 Sep – 21 Sep 2026)</h2>
        </div>
        <button class="modal-close-btn" onclick="closeModal('weekDetailModal')">✕</button>
      </div>

      <div class="modal-body">
        <div class="modal-grid-kpi">
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Total Volume</div>
            <div class="modal-kpi-val" id="modalWeekTotal">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Daily Average</div>
            <div class="modal-kpi-val" id="modalWeekAvg">0.00 MB/d</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Download (RX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-blue-text);" id="modalWeekRx">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Upload (TX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-red-text);" id="modalWeekTx">0.00 MB</div>
          </div>
        </div>

        <div class="insight-callout" style="margin-bottom: 0;">
          <div>
            <span class="insight-strong">Peak Day in Week:</span>
            <span id="modalWeekPeakText">-</span>
          </div>
        </div>

        <div>
          <div style="font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; letter-spacing: 0.05em;">
            Days in this Week
          </div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Day</th>
                  <th class="text-right">Download</th>
                  <th class="text-right">Upload</th>
                  <th class="text-right">Total</th>
                  <th class="text-right">Action</th>
                </tr>
              </thead>
              <tbody id="modalWeekTableBody">
                <!-- Days rendered here -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ========================================================
       MONTH DRILL-DOWN INSPECTION MODAL (Document-Style)
       ======================================================== -->
  <div id="monthDetailModal" class="modal-overlay" onclick="handleModalBackdropClick(event, 'monthDetailModal')">
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title-group">
          <div class="modal-subtitle">Monthly Telemetry Summary</div>
          <h2 id="modalMonthTitle">September 2026</h2>
        </div>
        <button class="modal-close-btn" onclick="closeModal('monthDetailModal')">✕</button>
      </div>

      <div class="modal-body">
        <div class="modal-grid-kpi">
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Total Volume</div>
            <div class="modal-kpi-val" id="modalMonthTotal">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Annual Rank</div>
            <div class="modal-kpi-val" id="modalMonthRank">#1 of 12</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Download (RX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-blue-text);" id="modalMonthRx">0.00 MB</div>
          </div>
          <div class="modal-kpi-card">
            <div class="modal-kpi-label">Upload (TX)</div>
            <div class="modal-kpi-val" style="color: var(--pastel-red-text);" id="modalMonthTx">0.00 MB</div>
          </div>
        </div>

        <div class="insight-callout" style="margin-bottom: 0;">
          <div>
            <span class="insight-strong">Yearly Contribution:</span>
            <span id="modalMonthContribution">-</span>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <button class="btn-minimal" id="modalSwitchToDailyBtn">
            Explore Day-by-Day Calendar →
          </button>
        </div>
      </div>
    </div>
  </div>

  <script>
    let rawTelemetry = null;
    let hourlyChartInstance = null;
    let recentTrendChartInstance = null;
    let dailyChartInstance = null;
    let modalHourlyChartInstance = null;

    // Heatmap Spectrum State
    const now = new Date();
    let currentYear = now.getFullYear();
    let currentMonth = now.getMonth(); // 0-indexed (0=Jan..11=Dec)
    let currentGranularity = 'day'; // 'day' | 'week' | 'month'

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    function formatBytes(bytes, decimals = 2) {
      if (!bytes || bytes <= 0) return '0.00 B';
      const k = 1024;
      const dm = decimals < 0 ? 0 : decimals;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    function formatBytesValue(bytes, unit = 'MB') {
      if (!bytes) return '0.00';
      const units = { 'B': 1, 'KB': 1024, 'MB': 1024 * 1024, 'GB': 1024 * 1024 * 1024 };
      const divider = units[unit] || (1024 * 1024);
      return (bytes / divider).toFixed(2);
    }

    async function fetchTelemetry(manual = false) {
      try {
        const res = await fetch('/api/stats');
        const json = await res.json();
        if (json.success) {
          rawTelemetry = json;
          updateInterfaceOptions();
          renderDashboard();
          document.getElementById('lastSyncLabel').textContent = 'Last sync: ' + new Date().toLocaleTimeString();
        }
      } catch (err) {
        console.error("Failed to fetch telemetry:", err);
      }
    }

    function updateInterfaceOptions() {
      if (!rawTelemetry || !rawTelemetry.data || !rawTelemetry.data.interfaces) return;
      const select = document.getElementById('ifaceSelector');
      const current = select.value;
      const ifaces = rawTelemetry.data.interfaces;

      // Keep ALL option
      select.innerHTML = '<option value="ALL">All Interfaces (' + ifaces.length + ')</option>';
      ifaces.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = item.name + (item.alias ? ' (' + item.alias + ')' : '');
        select.appendChild(opt);
      });

      if (current && Array.from(select.options).some(o => o.value === current)) {
        select.value = current;
      }
    }

    function getActiveDataset() {
      if (!rawTelemetry || !rawTelemetry.data) return null;
      const selectedIface = document.getElementById('ifaceSelector').value;
      const interfaces = rawTelemetry.data.interfaces || [];

      if (selectedIface === 'ALL') {
        const agg = {
          name: 'ALL',
          traffic: {
            total: { rx: 0, tx: 0 },
            hour: [],
            day: [],
            fiveminute: [],
            month: [],
            year: [],
            top: []
          }
        };

        const hourlyMap = {};
        const dailyMap = {};
        const fiveMinMap = {};
        const monthMap = {};
        const yearMap = {};
        const topMap = {};

        interfaces.forEach(iface => {
          const t = iface.traffic || {};
          agg.traffic.total.rx += (t.total?.rx || 0);
          agg.traffic.total.tx += (t.total?.tx || 0);

          (t.hour || []).forEach(h => {
            const key = h.date.year + '-' + h.date.month + '-' + h.date.day + ' ' + h.time.hour + ':00';
            if (!hourlyMap[key]) hourlyMap[key] = { ...h, rx: 0, tx: 0 };
            hourlyMap[key].rx += (h.rx || 0);
            hourlyMap[key].tx += (h.tx || 0);
          });

          (t.day || []).forEach(d => {
            const key = d.date.year + '-' + d.date.month + '-' + d.date.day;
            if (!dailyMap[key]) dailyMap[key] = { ...d, rx: 0, tx: 0 };
            dailyMap[key].rx += (d.rx || 0);
            dailyMap[key].tx += (d.tx || 0);
          });

          (t.fiveminute || []).forEach(f => {
            const key = f.timestamp || (f.date.year + '-' + f.date.month + '-' + f.date.day + ' ' + f.time.hour + ':' + f.time.minute);
            if (!fiveMinMap[key]) fiveMinMap[key] = { ...f, rx: 0, tx: 0 };
            fiveMinMap[key].rx += (f.rx || 0);
            fiveMinMap[key].tx += (f.tx || 0);
          });

          (t.month || []).forEach(m => {
            const key = m.date.year + '-' + m.date.month;
            if (!monthMap[key]) monthMap[key] = { ...m, rx: 0, tx: 0 };
            monthMap[key].rx += (m.rx || 0);
            monthMap[key].tx += (m.tx || 0);
          });

          (t.year || []).forEach(y => {
            const key = String(y.date.year);
            if (!yearMap[key]) yearMap[key] = { ...y, rx: 0, tx: 0 };
            yearMap[key].rx += (y.rx || 0);
            yearMap[key].tx += (y.tx || 0);
          });

          (t.top || []).forEach(tp => {
            const key = tp.date.year + '-' + tp.date.month + '-' + tp.date.day;
            if (!topMap[key]) topMap[key] = { ...tp, rx: 0, tx: 0 };
            topMap[key].rx += (tp.rx || 0);
            topMap[key].tx += (tp.tx || 0);
          });
        });

        agg.traffic.hour = Object.values(hourlyMap).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        agg.traffic.day = Object.values(dailyMap).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        agg.traffic.fiveminute = Object.values(fiveMinMap).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        agg.traffic.month = Object.values(monthMap).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        agg.traffic.year = Object.values(yearMap).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
        agg.traffic.top = Object.values(topMap).sort((a,b) => ((b.rx + b.tx) - (a.rx + a.tx)));

        return agg;
      }

      return interfaces.find(i => i.name === selectedIface) || interfaces[0];
    }

    function renderDashboard() {
      const active = getActiveDataset();
      if (!active) return;

      const t = active.traffic || {};
      const totalRx = t.total?.rx || 0;
      const totalTx = t.total?.tx || 0;
      const grandTotal = totalRx + totalTx;

      // 1. Today's stats
      const todayEntry = (t.day || []).slice(-1)[0] || { rx: 0, tx: 0 };
      const todaySum = (todayEntry.rx || 0) + (todayEntry.tx || 0);
      document.getElementById('todayTotal').textContent = formatBytesValue(todaySum, todaySum > 1024*1024*1024 ? 'GB' : 'MB');
      document.querySelector('#todayTotal + .card-unit').textContent = todaySum > 1024*1024*1024 ? 'GB' : 'MB';
      document.getElementById('todayRx').textContent = formatBytes(todayEntry.rx || 0);
      document.getElementById('todayTx').textContent = formatBytes(todayEntry.tx || 0);

      // 2. Live Speed
      let liveRxTotal = 0, liveTxTotal = 0;
      const selectedIface = document.getElementById('ifaceSelector').value;
      const rates = rawTelemetry.liveRates || {};

      if (selectedIface === 'ALL') {
        Object.values(rates).forEach(r => {
          liveRxTotal += (r.rxSec || 0);
          liveTxTotal += (r.txSec || 0);
        });
      } else if (rates[selectedIface]) {
        liveRxTotal = rates[selectedIface].rxSec || 0;
        liveTxTotal = rates[selectedIface].txSec || 0;
      }

      const liveSum = liveRxTotal + liveTxTotal;
      document.getElementById('liveTotalSpeed').textContent = (liveSum > 1024*1024 ? (liveSum / (1024*1024)).toFixed(2) : (liveSum / 1024).toFixed(1));
      document.querySelector('#liveTotalSpeed + .card-unit').textContent = liveSum > 1024*1024 ? 'MB/s' : 'KB/s';
      document.getElementById('liveRxSpeed').textContent = formatBytes(liveRxTotal) + '/s';
      document.getElementById('liveTxSpeed').textContent = formatBytes(liveTxTotal) + '/s';

      // 3. DL/UL Ratio
      const rxPct = grandTotal > 0 ? Math.round((totalRx / grandTotal) * 100) : 50;
      const txPct = grandTotal > 0 ? (100 - rxPct) : 50;
      document.getElementById('ratioDlBar').style.width = rxPct + '%';
      document.getElementById('ratioUlBar').style.width = txPct + '%';
      document.getElementById('ratioDlPct').textContent = rxPct + '%';
      document.getElementById('ratioUlPct').textContent = txPct + '%';

      const ratioPill = document.getElementById('ratioProfile');
      if (rxPct >= 75) {
        ratioPill.textContent = 'Consumer';
        ratioPill.className = 'pill pill-blue';
      } else if (rxPct <= 45) {
        ratioPill.textContent = 'Producer / Host';
        ratioPill.className = 'pill pill-red';
      } else {
        ratioPill.textContent = 'Balanced';
        ratioPill.className = 'pill pill-green';
      }

      // 4. Monthly Projections & Quota Budget
      const daysInMonth = 30;
      const dayOfMonth = Math.max(1, now.getDate());
      const mtdTotal = grandTotal;
      const avgDaily = mtdTotal / dayOfMonth;
      const projectedMonthBytes = avgDaily * daysInMonth;
      const projectedGb = (projectedMonthBytes / (1024*1024*1024)).toFixed(1);

      document.getElementById('projectedTotal').textContent = projectedGb;
      document.getElementById('mtdActual').textContent = formatBytes(mtdTotal);

      const budgetGb = parseFloat(document.getElementById('budgetInput').value) || 50;
      const budgetBytes = budgetGb * 1024 * 1024 * 1024;
      const healthPill = document.getElementById('budgetHealthPill');
      if (projectedMonthBytes > budgetBytes) {
        healthPill.textContent = 'Warning · Over Budget';
        healthPill.className = 'pill pill-yellow';
      } else {
        healthPill.textContent = 'Optimal · Within Limit';
        healthPill.className = 'pill pill-green';
      }

      // 5. Render Multi-Granularity Spectrum & Other Bento Charts
      renderSpectrum();
      renderHourlyChart(t.hour || []);
      renderRecentTrendChart(t.fiveminute || []);
      renderDailyChart(t.day || []);
      renderTopDaysTable(t.top || []);
    }

    // ========================================================
    // MULTI-GRANULARITY CONTROLS & DISPATCHER
    // ========================================================
    function setGranularity(gran) {
      currentGranularity = gran;
      ['day', 'week', 'month'].forEach(g => {
        const btn = document.getElementById('gran' + g.charAt(0).toUpperCase() + g.slice(1) + 'Btn');
        if (g === gran) {
          btn.style.background = '#111111';
          btn.style.color = '#FFFFFF';
        } else {
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text-main)';
        }
      });

      renderSpectrum();
    }

    function shiftPeriod(delta) {
      if (currentGranularity === 'month') {
        currentYear += delta;
      } else {
        currentMonth += delta;
        if (currentMonth < 0) {
          currentMonth = 11;
          currentYear--;
        } else if (currentMonth > 11) {
          currentMonth = 0;
          currentYear++;
        }
      }
      renderSpectrum();
    }

    function renderSpectrum() {
      const label = document.getElementById('calendarPeriodLabel');
      if (currentGranularity === 'month') {
        label.textContent = String(currentYear);
        document.getElementById('spectrumTitle').textContent = 'Annual Monthly Spectrum (' + currentYear + ')';
        document.getElementById('spectrumSubtitle').textContent = 'Month-by-month bandwidth breakdown. Click any month card to view in-depth details.';
        renderMonthlySpectrum();
      } else if (currentGranularity === 'week') {
        label.textContent = monthNames[currentMonth] + ' ' + currentYear;
        document.getElementById('spectrumTitle').textContent = 'Weekly Consumption Spectrum (' + monthNames[currentMonth] + ' ' + currentYear + ')';
        document.getElementById('spectrumSubtitle').textContent = 'Week-by-week aggregated consumption. Click any week card to drill down into its days.';
        renderWeeklySpectrum();
      } else {
        label.textContent = monthNames[currentMonth] + ' ' + currentYear;
        document.getElementById('spectrumTitle').textContent = 'Daily Consumption Spectrum & Calendar Heatmap';
        document.getElementById('spectrumSubtitle').textContent = 'Day-by-day calendar heatmap. Click any day to inspect exact hourly telemetry.';
        renderDailyCalendarSpectrum();
      }
    }

    // Helper: calculate heat level 0..4
    function getHeatLevel(sum, maxVal) {
      if (!sum || sum <= 0 || !maxVal) return 'cal-level-0';
      const ratio = sum / maxVal;
      if (ratio >= 0.75) return 'cal-level-4';
      if (ratio >= 0.45) return 'cal-level-3';
      if (ratio >= 0.20) return 'cal-level-2';
      return 'cal-level-1';
    }

    // ========================================================
    // 1. DAY-BY-DAY CALENDAR VIEW (Existing + Enhanced)
    // ========================================================
    function renderDailyCalendarSpectrum() {
      const active = getActiveDataset();
      if (!active) return;
      const t = active.traffic || {};
      const days = t.day || [];

      const dayMap = {};
      let maxDayVolume = 0;
      days.forEach(d => {
        const key = d.date.year + '-' + String(d.date.month).padStart(2, '0') + '-' + String(d.date.day).padStart(2, '0');
        const sum = (d.rx || 0) + (d.tx || 0);
        dayMap[key] = { rx: d.rx || 0, tx: d.tx || 0, sum, date: d.date };
        if (sum > maxDayVolume) maxDayVolume = sum;
      });

      const container = document.getElementById('spectrumContainer');
      container.innerHTML = '<div id="calendarGrid" class="calendar-grid"></div>';
      const grid = document.getElementById('calendarGrid');

      // Day headers: Mon .. Sun
      const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      dayLabels.forEach(name => {
        const header = document.createElement('div');
        header.className = 'cal-header-day';
        header.textContent = name;
        grid.appendChild(header);
      });

      const startDate = new Date(currentYear, currentMonth, 1);
      const endDate = new Date(currentYear, currentMonth + 1, 0);

      // Padding for 1st day of week
      let startDayOfWeek = startDate.getDay();
      let padCount = (startDayOfWeek === 0 ? 6 : startDayOfWeek - 1);
      for (let p = 0; p < padCount; p++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-cell cal-cell-empty';
        grid.appendChild(emptyCell);
      }

      const current = new Date(startDate);
      let monthVolumeTotal = 0;
      let activeDaysRecorded = 0;
      let peakDayKey = '-';
      let peakDayVolume = 0;

      const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

      while (current <= endDate) {
        const y = current.getFullYear();
        const m = current.getMonth() + 1;
        const d = current.getDate();
        const dateKey = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const record = dayMap[dateKey];

        const cell = document.createElement('div');
        cell.className = 'cal-cell';

        let volumeText = '—';
        let levelClass = 'cal-level-0';

        if (record && record.sum > 0) {
          activeDaysRecorded++;
          monthVolumeTotal += record.sum;
          volumeText = formatBytes(record.sum);

          if (record.sum > peakDayVolume) {
            peakDayVolume = record.sum;
            peakDayKey = dateKey;
          }

          levelClass = getHeatLevel(record.sum, maxDayVolume);
        }

        cell.classList.add(levelClass);
        const isToday = (dateKey === todayStr);

        cell.innerHTML = 
          '<div class="cal-date-row">' +
            '<span class="cal-date-num">' + d + '</span>' +
            (isToday ? '<span class="cal-today-badge">TODAY</span>' : '') +
          '</div>' +
          '<div class="cal-volume">' + volumeText + '</div>' +
          (record && record.sum > 0 ? 
            '<div class="cal-breakdown-sub">' +
              '<span style="color: var(--pastel-blue-text);">↓ ' + formatBytes(record.rx, 1) + '</span>' +
              '<span style="color: var(--pastel-red-text);">↑ ' + formatBytes(record.tx, 1) + '</span>' +
            '</div>' : 
            '<div class="cal-breakdown-sub"><span style="color: var(--text-dim);">No traffic</span></div>');

        cell.onclick = () => openDayDetail(dateKey, record);
        grid.appendChild(cell);

        current.setDate(current.getDate() + 1);
      }

      // Update Banner
      document.getElementById('bannerLabel1').textContent = 'Month Total:';
      document.getElementById('bannerVal1').textContent = formatBytes(monthVolumeTotal);
      document.getElementById('bannerLabel2').textContent = 'Peak Day:';
      document.getElementById('bannerVal2').textContent = peakDayVolume > 0 ? (peakDayKey + ' (' + formatBytes(peakDayVolume) + ')') : '-';
      document.getElementById('bannerVal3').textContent = 'Active records: ' + activeDaysRecorded + ' day' + (activeDaysRecorded === 1 ? '' : 's');
    }

    // ========================================================
    // 2. WEEK-BY-WEEK VIEW (New Feature)
    // ========================================================
    function renderWeeklySpectrum() {
      const active = getActiveDataset();
      if (!active) return;
      const t = active.traffic || {};
      const days = t.day || [];

      // Map day records
      const dayMap = {};
      days.forEach(d => {
        const key = d.date.year + '-' + String(d.date.month).padStart(2, '0') + '-' + String(d.date.day).padStart(2, '0');
        dayMap[key] = { rx: d.rx || 0, tx: d.tx || 0, sum: (d.rx || 0) + (d.tx || 0), date: d.date };
      });

      // Split the month into calendar weeks (Mon..Sun chunks)
      const startDate = new Date(currentYear, currentMonth, 1);
      const endDate = new Date(currentYear, currentMonth + 1, 0);
      const weeks = [];

      let current = new Date(startDate);
      let currentWeekDays = [];

      while (current <= endDate) {
        const y = current.getFullYear();
        const m = current.getMonth() + 1;
        const d = current.getDate();
        const dateKey = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        const dayOfWeek = current.getDay(); // 0 is Sun, 1 is Mon...

        currentWeekDays.push({
          dateKey,
          d,
          dayOfWeek,
          record: dayMap[dateKey] || { rx: 0, tx: 0, sum: 0, date: { year: y, month: m, day: d } }
        });

        // If Sunday or last day of month, close the week
        if (dayOfWeek === 0 || current.getTime() === endDate.getTime()) {
          weeks.push(currentWeekDays);
          currentWeekDays = [];
        }

        current.setDate(current.getDate() + 1);
      }

      // Calculate weekly metrics
      let maxWeekVolume = 0;
      let monthTotalSum = 0;
      let peakWeekIdx = -1;
      let peakWeekSum = 0;

      const weekObjects = weeks.map((wDays, idx) => {
        let rx = 0, tx = 0, sum = 0;
        let peakDayInWeek = null;

        wDays.forEach(item => {
          rx += item.record.rx;
          tx += item.record.tx;
          sum += item.record.sum;
          if (!peakDayInWeek || item.record.sum > peakDayInWeek.record.sum) {
            peakDayInWeek = item;
          }
        });

        if (sum > maxWeekVolume) maxWeekVolume = sum;
        if (sum > peakWeekSum) {
          peakWeekSum = sum;
          peakWeekIdx = idx;
        }
        monthTotalSum += sum;

        const firstD = wDays[0].d;
        const lastD = wDays[wDays.length - 1].d;
        const rangeLabel = firstD + '–' + lastD + ' ' + monthNames[currentMonth].slice(0, 3);

        return {
          weekNum: idx + 1,
          rangeLabel,
          days: wDays,
          rx,
          tx,
          sum,
          dailyAvg: wDays.length > 0 ? sum / wDays.length : 0,
          peakDayInWeek
        };
      });

      // Render Weekly Grid
      const container = document.getElementById('spectrumContainer');
      container.innerHTML = '<div id="weeklyGrid" class="weekly-grid"></div>';
      const grid = document.getElementById('weeklyGrid');

      weekObjects.forEach(w => {
        const card = document.createElement('div');
        card.className = 'week-card ' + getHeatLevel(w.sum, maxWeekVolume);

        // Render mini 7-day sparkline bars
        let miniBarsHtml = '<div class="week-mini-bars">';
        w.days.forEach(item => {
          const peakVal = Math.max(1, w.peakDayInWeek?.record?.sum || w.sum);
          const barHeightPct = w.sum > 0 ? Math.min(100, Math.max(12, Math.round((item.record.sum / peakVal) * 100))) : 10;
          const bgCol = item.record.sum > 0 ? '#111111' : 'var(--border)';
          miniBarsHtml += '<div class="week-bar-col" style="height: ' + barHeightPct + '%; background: ' + bgCol + ';" title="' + item.dateKey + ': ' + formatBytes(item.record.sum) + '"></div>';
        });
        miniBarsHtml += '</div>';

        card.innerHTML = 
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
              '<span style="font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500;">Week ' + w.weekNum + ' · ' + w.rangeLabel + '</span>' +
              (w.sum > 0 && w.sum === peakWeekSum ? '<span class="pill pill-yellow" style="font-size: 9px; padding: 1px 6px;">Peak Week</span>' : '') +
            '</div>' +
            '<div class="cal-volume" style="font-size: 22px; margin: 4px 0;">' + formatBytes(w.sum) + '</div>' +
            '<div style="font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);">' +
              'Avg: ' + formatBytes(w.dailyAvg) + '/d' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<div class="cal-breakdown-sub" style="margin-top: 10px;">' +
              '<span style="color: var(--pastel-blue-text);">↓ ' + formatBytes(w.rx, 1) + '</span>' +
              '<span style="color: var(--pastel-red-text);">↑ ' + formatBytes(w.tx, 1) + '</span>' +
            '</div>' +
            miniBarsHtml +
          '</div>';

        card.onclick = () => openWeekDetail(w);
        grid.appendChild(card);
      });

      // Update Banner
      document.getElementById('bannerLabel1').textContent = 'Month Total:';
      document.getElementById('bannerVal1').textContent = formatBytes(monthTotalSum);
      document.getElementById('bannerLabel2').textContent = 'Peak Week:';
      document.getElementById('bannerVal2').textContent = peakWeekIdx >= 0 ? ('Week ' + (peakWeekIdx + 1) + ' (' + formatBytes(peakWeekSum) + ')') : '-';
      document.getElementById('bannerVal3').textContent = weekObjects.length + ' weeks in period';
    }

    // ========================================================
    // 3. MONTH-BY-MONTH VIEW (New Feature)
    // ========================================================
    function renderMonthlySpectrum() {
      const active = getActiveDataset();
      if (!active) return;
      const t = active.traffic || {};
      const months = t.month || [];

      // Map month records: "YYYY-M" -> { rx, tx, sum }
      const monthMap = {};
      let maxMonthVolume = 0;
      let annualTotalSum = 0;
      let peakMonthIdx = -1;
      let peakMonthSum = 0;

      months.forEach(m => {
        if (m.date && m.date.year === currentYear) {
          const sum = (m.rx || 0) + (m.tx || 0);
          monthMap[m.date.month] = { rx: m.rx || 0, tx: m.tx || 0, sum };
          if (sum > maxMonthVolume) maxMonthVolume = sum;
          annualTotalSum += sum;
        }
      });

      const container = document.getElementById('spectrumContainer');
      container.innerHTML = '<div id="monthlyGrid" class="monthly-grid"></div>';
      const grid = document.getElementById('monthlyGrid');

      const monthEntries = [];
      for (let m = 1; m <= 12; m++) {
        const record = monthMap[m] || { rx: 0, tx: 0, sum: 0 };
        if (record.sum > peakMonthSum) {
          peakMonthSum = record.sum;
          peakMonthIdx = m - 1;
        }
        monthEntries.push({
          monthNum: m,
          name: monthNames[m - 1],
          rx: record.rx,
          tx: record.tx,
          sum: record.sum
        });
      }

      monthEntries.forEach((me, idx) => {
        const card = document.createElement('div');
        card.className = 'month-card ' + getHeatLevel(me.sum, maxMonthVolume);

        const isCurrentMonth = (currentYear === now.getFullYear() && idx === now.getMonth());

        card.innerHTML = 
          '<div>' +
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
              '<span style="font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;">' + me.name + '</span>' +
              (isCurrentMonth ? '<span class="cal-today-badge">ACTIVE</span>' : '') +
            '</div>' +
            '<div class="cal-volume" style="font-size: 20px; margin: 6px 0;">' + (me.sum > 0 ? formatBytes(me.sum) : '—') + '</div>' +
          '</div>' +
          '<div class="cal-breakdown-sub">' +
            (me.sum > 0 ? 
              '<span style="color: var(--pastel-blue-text);">↓ ' + formatBytes(me.rx, 1) + '</span><span style="color: var(--pastel-red-text);">↑ ' + formatBytes(me.tx, 1) + '</span>' :
              '<span style="color: var(--text-dim);">No traffic</span>') +
          '</div>';

        card.onclick = () => openMonthDetail(me);
        grid.appendChild(card);
      });

      // Update Banner
      document.getElementById('bannerLabel1').textContent = 'Annual Total:';
      document.getElementById('bannerVal1').textContent = formatBytes(annualTotalSum);
      document.getElementById('bannerLabel2').textContent = 'Peak Month:';
      document.getElementById('bannerVal2').textContent = peakMonthIdx >= 0 && peakMonthSum > 0 ? (monthNames[peakMonthIdx] + ' (' + formatBytes(peakMonthSum) + ')') : '-';
      document.getElementById('bannerVal3').textContent = '12 calendar months (' + currentYear + ')';
    }

    // ========================================================
    // MODALS: DAY, WEEK, AND MONTH DRILL-DOWNS
    // ========================================================
    function openDayDetail(dateKey, record) {
      const modal = document.getElementById('dayDetailModal');
      const active = getActiveDataset();
      if (!active) return;
      const t = active.traffic || {};

      const parts = dateKey.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      const dateObj = new Date(y, m - 1, d);

      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      document.getElementById('modalDateTitle').textContent = dateObj.toLocaleDateString('en-US', options);

      const sum = record ? record.sum : 0;
      const rx = record ? record.rx : 0;
      const tx = record ? record.tx : 0;

      document.getElementById('modalTotalVol').textContent = formatBytes(sum);
      document.getElementById('modalRxVol').textContent = formatBytes(rx);
      document.getElementById('modalTxVol').textContent = formatBytes(tx);

      const days = (t.day || []).slice().sort((a,b) => ((b.rx + b.tx) - (a.rx + a.tx)));
      const rankIdx = days.findIndex(item => item.date.year === y && item.date.month === m && item.date.day === d);
      document.getElementById('modalDayRank').textContent = rankIdx >= 0 ? ('#' + (rankIdx + 1) + ' of ' + days.length) : 'Unranked';

      let avgDayVolume = 0;
      if (days.length > 0) {
        const totalAll = days.reduce((acc, curr) => acc + (curr.rx || 0) + (curr.tx || 0), 0);
        avgDayVolume = totalAll / days.length;
      }

      if (sum > 0 && avgDayVolume > 0) {
        const diffPct = Math.round(((sum - avgDayVolume) / avgDayVolume) * 100);
        const compText = diffPct >= 0 ? 
          '+' + diffPct + '% above historical daily average (' + formatBytes(avgDayVolume) + ')' : 
          Math.abs(diffPct) + '% below historical daily average (' + formatBytes(avgDayVolume) + ')';
        document.getElementById('modalComparisonText').textContent = compText;
      } else if (sum === 0) {
        document.getElementById('modalComparisonText').textContent = 'Zero recorded bandwidth activity for this date.';
      } else {
        document.getElementById('modalComparisonText').textContent = 'Initial baseline day in dataset.';
      }

      const allHours = t.hour || [];
      const dayHours = allHours.filter(h => h.date && h.date.year === y && h.date.month === m && h.date.day === d);

      const chartWrapper = document.getElementById('modalChartWrapper');
      const notice = document.getElementById('modalNoHourlyNotice');

      if (dayHours.length > 0) {
        chartWrapper.style.display = 'block';
        notice.style.display = 'none';
        renderModalHourlyChart(dayHours);
      } else {
        chartWrapper.style.display = 'none';
        notice.style.display = 'block';
      }

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function openWeekDetail(w) {
      const modal = document.getElementById('weekDetailModal');
      document.getElementById('modalWeekTitle').textContent = 'Week ' + w.weekNum + ' (' + w.rangeLabel + ' ' + currentYear + ')';
      document.getElementById('modalWeekTotal').textContent = formatBytes(w.sum);
      document.getElementById('modalWeekAvg').textContent = formatBytes(w.dailyAvg) + '/d';
      document.getElementById('modalWeekRx').textContent = formatBytes(w.rx);
      document.getElementById('modalWeekTx').textContent = formatBytes(w.tx);

      if (w.peakDayInWeek && w.peakDayInWeek.record.sum > 0) {
        document.getElementById('modalWeekPeakText').textContent = 
          w.peakDayInWeek.dateKey + ' (' + formatBytes(w.peakDayInWeek.record.sum) + ', ' + Math.round((w.peakDayInWeek.record.sum / (w.sum || 1)) * 100) + '% of week total)';
      } else {
        document.getElementById('modalWeekPeakText').textContent = 'No traffic recorded in this week.';
      }

      const tbody = document.getElementById('modalWeekTableBody');
      tbody.innerHTML = '';
      const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      w.days.forEach(item => {
        const tr = document.createElement('tr');
        const dayLabel = dayNamesShort[item.dayOfWeek];
        tr.innerHTML = 
          '<td>' + item.dateKey + '</td>' +
          '<td>' + dayLabel + '</td>' +
          '<td class="text-right" style="color: var(--pastel-blue-text);">' + formatBytes(item.record.rx) + '</td>' +
          '<td class="text-right" style="color: var(--pastel-red-text);">' + formatBytes(item.record.tx) + '</td>' +
          '<td class="text-right" style="font-weight: 500;">' + formatBytes(item.record.sum) + '</td>' +
          '<td class="text-right">' +
            '<button class="btn-subtle" style="padding: 2px 8px; font-size: 11px;" onclick="closeModal(\\'weekDetailModal\\'); openDayDetail(\\'' + item.dateKey + '\\', ' + JSON.stringify(item.record).replace(/"/g, '&quot;') + ')">Inspect</button>' +
          '</td>';
        tbody.appendChild(tr);
      });

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function openMonthDetail(me) {
      const modal = document.getElementById('monthDetailModal');
      document.getElementById('modalMonthTitle').textContent = me.name + ' ' + currentYear;
      document.getElementById('modalMonthTotal').textContent = formatBytes(me.sum);
      document.getElementById('modalMonthRx').textContent = formatBytes(me.rx);
      document.getElementById('modalMonthTx').textContent = formatBytes(me.tx);

      const active = getActiveDataset();
      const t = active ? (active.traffic || {}) : {};
      const allMonths = (t.month || []).filter(m => m.date && m.date.year === currentYear);
      const sortedMonths = allMonths.slice().sort((a,b) => ((b.rx + b.tx) - (a.rx + a.tx)));
      const rankIdx = sortedMonths.findIndex(m => m.date.month === me.monthNum);
      document.getElementById('modalMonthRank').textContent = rankIdx >= 0 ? ('#' + (rankIdx + 1) + ' of ' + sortedMonths.length) : 'Unranked';

      const yearSum = allMonths.reduce((acc, curr) => acc + (curr.rx || 0) + (curr.tx || 0), 0);
      const contribPct = yearSum > 0 ? Math.round((me.sum / yearSum) * 100) : 0;
      document.getElementById('modalMonthContribution').textContent = contribPct + '% of total annual bandwidth (' + formatBytes(yearSum) + ')';

      // Button to switch to Daily Calendar for this month
      const switchBtn = document.getElementById('modalSwitchToDailyBtn');
      switchBtn.onclick = () => {
        closeModal('monthDetailModal');
        currentMonth = me.monthNum - 1;
        setGranularity('day');
      };

      modal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }

    function renderModalHourlyChart(dayHours) {
      const ctx = document.getElementById('modalHourlyChart').getContext('2d');
      if (modalHourlyChartInstance) modalHourlyChartInstance.destroy();

      const labels = [];
      const rxData = [];
      const txData = [];

      dayHours.forEach(h => {
        labels.push(String(h.time.hour).padStart(2, '0') + ':00');
        rxData.push((h.rx || 0) / (1024 * 1024));
        txData.push((h.tx || 0) / (1024 * 1024));
      });

      modalHourlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Download (MB)',
              data: rxData,
              backgroundColor: '#1F6C9F',
              borderRadius: 3,
              stack: 'traffic'
            },
            {
              label: 'Upload (MB)',
              data: txData,
              backgroundColor: '#9F2F2D',
              borderRadius: 3,
              stack: 'traffic'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: { font: { family: 'Geist Mono', size: 10 } }
            },
            tooltip: {
              backgroundColor: '#111111',
              titleFont: { family: 'Geist Mono', size: 11 },
              bodyFont: { family: 'Geist Mono', size: 11 },
              callbacks: {
                label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + ' MB'
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            },
            y: {
              stacked: true,
              grid: { color: '#EAEAEA' },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            }
          }
        }
      });
    }

    function closeModal(modalId) {
      const modal = document.getElementById(modalId);
      if (modal) modal.style.display = 'none';
      document.body.style.overflow = '';
      if (modalId === 'dayDetailModal' && modalHourlyChartInstance) {
        modalHourlyChartInstance.destroy();
        modalHourlyChartInstance = null;
      }
    }

    function handleModalBackdropClick(event, modalId) {
      if (event.target && event.target.id === modalId) {
        closeModal(modalId);
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal('dayDetailModal');
        closeModal('weekDetailModal');
        closeModal('monthDetailModal');
      }
    });

    // ========================================================
    // STANDARD BENTO CHARTS RENDERING
    // ========================================================
    function renderHourlyChart(hours) {
      const ctx = document.getElementById('hourlyChart').getContext('2d');
      if (hourlyChartInstance) hourlyChartInstance.destroy();

      const labels = [];
      const rxData = [];
      const txData = [];

      let peakHour = -1;
      let peakVolume = -1;
      let workHourVolume = 0;
      let totalHourlyVolume = 0;

      const displayHours = hours.slice(-24);
      displayHours.forEach(h => {
        const hourStr = (h.time ? String(h.time.hour).padStart(2, '0') + ':00' : 'H');
        labels.push(hourStr);
        const rxMb = (h.rx || 0) / (1024 * 1024);
        const txMb = (h.tx || 0) / (1024 * 1024);
        const sum = (h.rx || 0) + (h.tx || 0);

        rxData.push(rxMb);
        txData.push(txMb);

        totalHourlyVolume += sum;
        if (h.time && h.time.hour >= 9 && h.time.hour < 18) {
          workHourVolume += sum;
        }
        if (sum > peakVolume) {
          peakVolume = sum;
          peakHour = h.time ? h.time.hour : -1;
        }
      });

      if (peakHour >= 0 && totalHourlyVolume > 0) {
        const peakPct = Math.round((peakVolume / totalHourlyVolume) * 100);
        document.getElementById('peakWindowText').textContent = 
          String(peakHour).padStart(2, '0') + ':00 – ' + String((peakHour + 1) % 24).padStart(2, '0') + ':00 (' + formatBytes(peakVolume) + ', ' + peakPct + '% of spectrum)';
        
        const workPct = Math.round((workHourVolume / totalHourlyVolume) * 100);
        document.getElementById('workHoursText').textContent = 
          'Work hrs (09-18): ' + workPct + '% | Off-hrs: ' + (100 - workPct) + '%';
      } else {
        document.getElementById('peakWindowText').textContent = 'Accumulating 24-hour baseline cycle...';
      }

      hourlyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.length > 0 ? labels : ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
          datasets: [
            {
              label: 'Download (MB)',
              data: rxData.length > 0 ? rxData : [0,0,0,0,0,0],
              backgroundColor: '#1F6C9F',
              borderRadius: 3,
              stack: 'traffic'
            },
            {
              label: 'Upload (MB)',
              data: txData.length > 0 ? txData : [0,0,0,0,0,0],
              backgroundColor: '#9F2F2D',
              borderRadius: 3,
              stack: 'traffic'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                boxWidth: 10,
                boxHeight: 10,
                font: { family: 'Geist Mono', size: 10 }
              }
            },
            tooltip: {
              backgroundColor: '#111111',
              titleFont: { family: 'Geist Mono', size: 11 },
              bodyFont: { family: 'Geist Mono', size: 11 },
              padding: 10,
              callbacks: {
                label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + ' MB'
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { display: false },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            },
            y: {
              stacked: true,
              border: { dash: [4, 4] },
              grid: { color: '#EAEAEA' },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            }
          }
        }
      });
    }

    function renderRecentTrendChart(fivemin) {
      const ctx = document.getElementById('recentTrendChart').getContext('2d');
      if (recentTrendChartInstance) recentTrendChartInstance.destroy();

      const samples = fivemin.slice(-12);
      const labels = samples.map(s => s.time ? String(s.time.hour).padStart(2, '0') + ':' + String(s.time.minute).padStart(2, '0') : '');
      const values = samples.map(s => ((s.rx || 0) + (s.tx || 0)) / (1024 * 1024));

      recentTrendChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels.length > 0 ? labels : ['-25m', '-20m', '-15m', '-10m', '-5m', 'now'],
          datasets: [{
            label: 'Total (MB)',
            data: values.length > 0 ? values : [0,0,0,0,0,0],
            borderColor: '#111111',
            backgroundColor: 'rgba(0, 0, 0, 0.03)',
            fill: true,
            tension: 0.3,
            borderWidth: 1.5,
            pointRadius: 2,
            pointBackgroundColor: '#111111'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#111111',
              titleFont: { family: 'Geist Mono', size: 11 },
              bodyFont: { family: 'Geist Mono', size: 11 },
              callbacks: {
                label: (c) => 'Transfer: ' + c.parsed.y.toFixed(2) + ' MB'
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: 'Geist Mono', size: 9 }, color: '#787774', maxRotation: 0 }
            },
            y: {
              grid: { color: '#EAEAEA' },
              ticks: { font: { family: 'Geist Mono', size: 9 }, color: '#787774' }
            }
          }
        }
      });
    }

    function renderDailyChart(days) {
      const ctx = document.getElementById('dailyChart').getContext('2d');
      if (dailyChartInstance) dailyChartInstance.destroy();

      const last30 = days.slice(-30);
      const labels = last30.map(d => d.date ? (d.date.month + '/' + d.date.day) : '');
      const totals = last30.map(d => ((d.rx || 0) + (d.tx || 0)) / (1024 * 1024));

      const movingAvg = [];
      for (let i = 0; i < totals.length; i++) {
        const start = Math.max(0, i - 6);
        const windowSlice = totals.slice(start, i + 1);
        const avg = windowSlice.reduce((a, b) => a + b, 0) / windowSlice.length;
        movingAvg.push(avg);
      }

      dailyChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.length > 0 ? labels : ['Day 1', 'Day 2', 'Day 3'],
          datasets: [
            {
              type: 'line',
              label: '7-Day Moving Avg',
              data: movingAvg,
              borderColor: '#956400',
              borderWidth: 2,
              pointRadius: 0,
              tension: 0.25,
              yAxisID: 'y'
            },
            {
              type: 'bar',
              label: 'Daily Total (MB)',
              data: totals,
              backgroundColor: '#EDF3EC',
              borderColor: '#346538',
              borderWidth: 1,
              borderRadius: 3,
              yAxisID: 'y'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: { font: { family: 'Geist Mono', size: 10 } }
            },
            tooltip: {
              backgroundColor: '#111111',
              titleFont: { family: 'Geist Mono', size: 11 },
              bodyFont: { family: 'Geist Mono', size: 11 },
              callbacks: {
                label: (c) => c.dataset.label + ': ' + c.parsed.y.toFixed(2) + ' MB'
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            },
            y: {
              grid: { color: '#EAEAEA' },
              ticks: { font: { family: 'Geist Mono', size: 10 }, color: '#787774' }
            }
          }
        }
      });
    }

    function renderTopDaysTable(topList) {
      const tbody = document.getElementById('topDaysBody');
      if (!topList || topList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align: center; padding: 20px;">Gathering historical records...</td></tr>';
        return;
      }

      tbody.innerHTML = '';
      topList.slice(0, 8).forEach((item, idx) => {
        const tr = document.createElement('tr');
        const dateStr = item.date ? item.date.year + '-' + String(item.date.month).padStart(2, '0') + '-' + String(item.date.day).padStart(2, '0') : '-';
        const sum = (item.rx || 0) + (item.tx || 0);

        tr.innerHTML = 
          '<td><span style="color: var(--text-dim); margin-right: 6px;">#' + (idx + 1) + '</span>' + dateStr + '</td>' +
          '<td class="text-right" style="color: var(--pastel-blue-text);">' + formatBytes(item.rx || 0) + '</td>' +
          '<td class="text-right" style="color: var(--pastel-red-text);">' + formatBytes(item.tx || 0) + '</td>' +
          '<td class="text-right" style="font-weight: 500;">' + formatBytes(sum) + '</td>';
        tbody.appendChild(tr);
      });
    }

    // Initial Load & Auto Refresh every 10 seconds
    fetchTelemetry();
    setInterval(() => fetchTelemetry(false), 10000);
  </script>
</body>
</html>
`;

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_TEMPLATE, {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    if (url.pathname === "/api/stats") {
      const telemetry = getVnstatData();
      return new Response(JSON.stringify(telemetry), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
});

console.log(`Light vnStat Analytics Dashboard live at http://${HOST}:${PORT}`);

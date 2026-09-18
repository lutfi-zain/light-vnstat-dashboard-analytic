# Light vnStat Dashboard & Network Analytics

An ultra-minimalist, single-file network telemetry and consumption analytics dashboard built with **Bun**, **vnStat 2.x**, and the **Minimalist Editorial UI** protocol.

## Features & Analytical Capabilities

- **Executive Summary Bento Grid:**
  - **Today's Consumption:** Live download & upload accounting for the active 24-hour cycle.
  - **Live Throughput Speedometer:** Real-time transfer rates sampled directly from kernel `/proc/net/dev`.
  - **Month-End Projection:** Extrapolated monthly burn rate with visual Quota & Budget health tags.
  - **Traffic Characterization:** Accurate Download-to-Upload ratio with profile classification (*Consumer* vs *Producer/Host*).
- **Multi-Scale Spectrum Heatmaps (Day, Week, Month):**
  - **Day View (Kalender Harian):** Kalender sebulan penuh (Senin–Minggu) dengan angka volume, badge hari ini, split download/upload, dan warna intensitas heatmap.
  - **Week View (Tren Mingguan):** Bulan dipecah per minggu (Week 1 s/d Week 5) dengan total volume mingguan, rata-rata harian (Daily Avg), dan mini sparkline per hari. Klik kartu minggu untuk membuka modal rincian hari di minggu tersebut.
  - **Month View (Tren Tahunan per Bulan):** Grid 12 bulan (Januari s/d Desember) menampilkan total pemakaian bulanan, perbandingan kontribusi tahunan, dan ranking. Klik kartu bulan untuk membuka detail atau langsung beralih ke kalender harian bulan tersebut.
  - **Interactive Drill-Down Modals:**
    - Modal Hari: Analitik komparatif vs rata-rata harian + grafik aktivitas per jam (00:00–23:00).
    - Modal Minggu: Rangkuman KPI mingguan, hari puncak di minggu tersebut, dan tabel hari-hari dalam minggu terkait.
    - Modal Bulan: Total MTD, ranking tahunan, kontribusi terhadap total tahunan, dan tombol shortcut navigasi.
- **Temporal Analytics:**
  - **24-Hour Spectrum:** Hourly breakdown separating download & upload with automatic **Peak Window Detection**.
  - **Work vs Off-Hours:** Work hours (09:00 – 18:00) vs off-hours traffic distribution.
  - **5-Minute Burst Trend:** High-resolution telemetry capturing sudden background transfers.
## Design Philosophy

Built under strict **Utilitarian Minimalism** guidelines:
- **Typography:** `Newsreader` editorial serif headings, `Geist Sans` UI, and `Geist Mono` data cells.
- **Palette:** Warm bone canvas (`#FBFBFA`), crisp cards (`#FFFFFF`) with `1px solid #EAEAEA` borders, and deliberate muted pastel accents (`#E1F3FE`, `#FDEBEC`, `#EDF3EC`, `#FBF3DB`).
- Zero heavy drop shadows, zero emojis, pure document-style aesthetic.

## Quick Start

Run directly with Bun:

```bash
bun server.ts
```

Or via npm script:

```bash
bun start
```

Access the dashboard at: `http://localhost:8844`

## Desktop & Omarchy Launcher

The project is integrated directly into the **Omarchy Desktop Environment**:
- **Application Launcher (Super key / Walker):** Search `Network Analytics` or `vnStat`.
- **Omarchy Menu:** Available under `trigger.network-analytics`.
- **Direct CLI Launcher:**
  ```bash
  ~/.local/bin/omarchy-network-analytics
  ```
The launcher automatically checks if the server is running, boots it in the background via Bun if needed, and opens the dashboard in Google Chrome.

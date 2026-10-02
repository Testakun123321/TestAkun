# IDX Radar

Pemindai saham BEI berbahasa Indonesia dengan histori harian Yahoo Finance, kriteria teknikal yang transparan, grafik detail, watchlist lokal, dan diagnostik koneksi.

## Menjalankan di Replit

- Gunakan tombol **Run** agar workflow web dan API yang sudah dikonfigurasi berjalan bersama.
- Untuk menjalankan manual di dua terminal: `pnpm --filter @workspace/api-server run dev` dan `pnpm --filter @workspace/idx-radar run dev`.
- Dependensi JavaScript dikelola oleh pnpm dan `pnpm-lock.yaml`.
- Backend memerlukan Python 3.13+ dan `yfinance` 1.7+; dependensinya dicatat di `pyproject.toml` dan `uv.lock`. Secara default worker menggunakan `.pythonlibs/bin/python`. Untuk lokasi Python lain, atur `IDX_RADAR_PYTHON`.
- Tidak diperlukan API key, akun Telegram/GitHub, atau database untuk menjalankan fitur yang tersedia.
- Pemeriksaan aktual Yahoo Finance tersedia di menu **Diagnostik** melalui tombol **TES KONEKSI DATA**.

## Pemeriksaan pengembangan

- `pnpm --filter @workspace/idx-radar run typecheck`
- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/api-spec run codegen` setelah mengubah `lib/api-spec/openapi.yaml`

## Struktur utama

- `artifacts/idx-radar` — aplikasi web React/Vite.
- `artifacts/api-server/src/routes/market.ts` — endpoint pemindai, detail saham, dan diagnostik.
- `artifacts/api-server/src/market_data.py` — pengambilan data `yfinance` dan perhitungan kriteria.
- `lib/api-spec/openapi.yaml` — kontrak API dan skema data.
- `pyproject.toml` / `uv.lock` — dependensi Python.

## Batasan data

Yahoo Finance menyediakan histori harian, bukan harga streaming real-time. Status per saham membedakan data tersedia, tertunda, tidak tersedia, dan gagal; data kosong tidak diganti dengan harga contoh. Watchlist disimpan di browser/perangkat yang dipakai. Aplikasi tidak mengirim order beli atau jual otomatis.

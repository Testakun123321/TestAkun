import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Link, Router as WouterRouter } from 'wouter';
import { Activity, ArrowRight, Bookmark, Check, ChevronRight, CircleHelp, Database, Gauge, Layers3, Menu, RefreshCw, Settings2, ShieldAlert, SlidersHorizontal, Star, Wifi, X } from 'lucide-react';
import { useGetDiagnostics, getGetDiagnosticsQueryKey, useGetScanner, getGetScannerQueryKey, useGetStockDetail, getGetStockDetailQueryKey, useGetSymbols, getGetSymbolsQueryKey, useTestDataConnection } from '@workspace/api-client-react';
import type { ScannedStock, StockDetail, StockSymbol } from '@workspace/api-client-react';

const queryClient = new QueryClient();
const nav = [
  { href: '/', label: 'Market', icon: Gauge },
  { href: '/watchlist', label: 'Watchlist', icon: Bookmark },
  { href: '/stockpick', label: 'Stockpick', icon: Star },
  { href: '/scan', label: 'Hasil Scan', icon: Layers3 },
];
const formatNumber = (value: number | null | undefined, currency = false) => value == null || !Number.isFinite(value)
  ? '—'
  : new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2, ...(currency ? { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 } : {}) }).format(value);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : 'Belum tersedia';
const formatTime = (value?: string | null) => value ? new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : 'Belum diperbarui';
const stateLabel: Record<string, string> = { available: 'Tersedia', delayed: 'Tertunda', unavailable: 'Tidak tersedia', failed: 'Gagal' };

function StatePill({ state }: { state?: string }) {
  return <span data-testid={`status-data-${state ?? 'unknown'}`} className={`state-pill state-${state ?? 'unknown'}`}><i />{stateLabel[state ?? ''] ?? state ?? 'Status tidak diketahui'}</span>;
}
function PageTitle({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{action}</div>;
}
function LoadingRows() {
  return <div className="loading-box" aria-label="Memuat data"><div className="skeleton sk-wide" /><div className="skeleton" /><div className="skeleton sk-short" /></div>;
}
function ErrorPanel({ error, retry, label = 'Data belum dapat dimuat' }: { error: unknown; retry: () => void; label?: string }) {
  const message = error instanceof Error ? error.message : String(error ?? 'Terjadi kesalahan');
  return <div className="error-panel"><div className="error-icon"><ShieldAlert size={18} /></div><div className="error-copy"><strong>{label}</strong><p>Periksa koneksi, lalu coba kembali.</p><code>{message}</code></div><button className="icon-button" onClick={retry} aria-label="Coba muat ulang"><RefreshCw size={16} /></button></div>;
}
function EmptyPanel({ title, text }: { title: string; text: string }) {
  return <div className="empty-panel"><div className="empty-mark"><Activity size={19} /></div><strong>{title}</strong><p>{text}</p></div>;
}
function DataNotice() {
  return <div className="data-notice"><span className="notice-mark"><Wifi size={14} /></span><span><b>Data harian, bukan real-time.</b> Bersumber dari histori harian Yahoo Finance; waktu penutupan terakhir dapat berbeda.</span></div>;
}
function StockLink({ stock, onToggle, saved }: { stock: ScannedStock; onToggle?: (symbol: string) => void; saved?: boolean }) {
  const positive = (stock.changePercent ?? 0) >= 0;
  return <div className="stock-row" data-testid={`row-stock-${stock.symbol}`}>
    <Link href={`/stocks/${encodeURIComponent(stock.symbol)}`} className="stock-name-link" data-testid={`link-stock-${stock.symbol}`}>
      <span className="ticker-mark">{stock.symbol.slice(0, 2)}</span><span className="ticker-copy"><b>{stock.symbol}</b><small>{stock.name}</small></span>
    </Link>
    <span className="row-value"><b>{formatNumber(stock.close, true)}</b><small>Penutupan</small></span>
    <span className={`change-value ${positive ? 'up' : 'down'}`}>{stock.changePercent == null ? '—' : `${positive ? '+' : ''}${formatNumber(stock.changePercent)}%`}<small>{stock.change == null ? '—' : `${positive ? '+' : ''}${formatNumber(stock.change)}`}</small></span>
    <span className="row-volume"><b>{formatNumber(stock.volume)}</b><small>Volume</small></span>
    <span className="row-status"><StatePill state={stock.state} /><small>{formatTime(stock.updatedAt)}</small></span>
    {onToggle && <button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={() => onToggle(stock.symbol)} aria-label={saved ? `Hapus ${stock.symbol} dari pantauan` : `Simpan ${stock.symbol} ke pantauan`} data-testid={`button-watch-${stock.symbol}`}><Bookmark size={16} fill={saved ? 'currentColor' : 'none'} /></button>}
    {!onToggle && <span className="save-spacer" aria-hidden="true" />}
    <Link href={`/stocks/${encodeURIComponent(stock.symbol)}`} className="row-arrow" aria-label={`Buka detail ${stock.symbol}`}><ChevronRight size={16} /></Link>
  </div>;
}
function CriteriaStrip({ stock }: { stock: ScannedStock }) {
  const criteria = [
    ['Breakout', stock.criteria.breakout], ['Volume', stock.criteria.volume], ['MACD', stock.criteria.macd], ['Turnover', stock.criteria.turnover],
  ] as const;
  return <div className="criteria-strip">{criteria.map(([label, item]) => <div className="criterion" key={label}><span className={`criterion-dot crit-${item.state}`} /><span>{label}</span><b>{item.state === 'unavailable' ? 'N/A' : item.state === 'pass' ? 'Lolos' : 'Belum'}</b></div>)}</div>;
}
function MarketPage() {
  const scanner = useGetScanner({ query: { queryKey: getGetScannerQueryKey() } });
  const stocks = scanner.data?.stocks ?? [];
  const available = stocks.filter(s => s.state === 'available');
  const qualifying = stocks.filter(s => s.state === 'available' && Object.values(s.criteria).every(c => c.state === 'pass'));
  return <main className="main-content">
    <PageTitle eyebrow="Ringkasan pasar · IDX" title="Pantau dengan jernih." detail="Data harian untuk membaca pergerakan, bukan instruksi transaksi." action={<button className="button secondary-button" onClick={() => scanner.refetch()} disabled={scanner.isFetching} data-testid="button-refresh-market"><RefreshCw size={15} className={scanner.isFetching ? 'spin' : ''} />{scanner.isFetching ? 'Memuat' : 'Perbarui data'}</button>} />
    <DataNotice />
    {scanner.isLoading ? <LoadingRows /> : scanner.isError ? <ErrorPanel error={scanner.error} retry={() => scanner.refetch()} /> : <>
      <section className="market-intro">
        <div className="market-lead"><div className="lead-label"><span className="live-dot" />PEMANTAUAN HARIAN</div><h2>Periksa sinyal.<br /><em>Pahami alasannya.</em></h2><p>IDX Radar menyusun hasil pemindaian dari kriteria teknikal harian yang transparan. Keputusan tetap milik Anda.</p><div className="lead-foot"><span>SUMBER DATA</span><b>{scanner.data?.source || 'Yahoo Finance'}</b></div></div>
        <div className="market-pulse"><div className="pulse-head"><span>PEMBARUAN TERAKHIR</span><Activity size={16} /></div><strong>{formatTime(scanner.data?.updatedAt)}</strong><p>Waktu server memperbarui hasil pemindaian</p><div className="pulse-line" /><div className="pulse-grid"><div><span>Simbol dipantau</span><b>{stocks.length}</b></div><div><span>Data tersedia</span><b>{available.length}</b></div><div><span>Lolos seluruh kriteria</span><b>{qualifying.length}</b></div></div><StatePill state={scanner.data?.state} /></div>
      </section>
      <div className="section-heading"><div><div className="eyebrow">HASIL HARI INI</div><h2>Yang perlu diperhatikan</h2></div><Link href="/scan" className="text-link">Lihat semua hasil <ArrowRight size={15} /></Link></div>
       {stocks.length ? <section className="stock-table"><div className="table-head"><span>SAHAM</span><span>HARGA TERAKHIR</span><span>PERUBAHAN</span><span>VOLUME</span><span>KONDISI DATA</span><span /><span /></div>{stocks.slice(0, 7).map(s => <StockLink key={s.symbol} stock={s} />)}</section> : <EmptyPanel title="Belum ada hasil pemindaian" text="Belum ada data yang dikirim oleh pemindai. Coba perbarui lagi nanti." />}
      <div className="bottom-split"><div className="note-card"><span className="note-index">01 / METODE</span><h3>Hasil, bukan rekomendasi.</h3><p>Setiap kandidat mengikuti kriteria breakout, volume, MACD, dan turnover. Buka detail saham untuk melihat data serta level yang dihitung.</p><Link href="/stockpick" className="text-link">Tinjau kandidat <ArrowRight size={15} /></Link></div><div className="note-card note-card-soft"><span className="note-index">02 / KETERSEDIAAN</span><h3>Angka yang jujur.</h3><p>Data yang tertunda, gagal, atau tidak tersedia ditandai dengan jelas. Tidak ada harga pengganti atau data buatan.</p><Link href="/diagnostics" className="text-link">Periksa koneksi data <ArrowRight size={15} /></Link></div></div>
    </>}
  </main>;
}
function StockCollection({ mode }: { mode: 'watchlist' | 'stockpick' | 'scan' }) {
  const scanner = useGetScanner({ query: { queryKey: getGetScannerQueryKey() } });
  const [saved, setSaved] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('idx-radar-watchlist') || '[]') as string[]; } catch { return []; } });
  const toggle = (symbol: string) => setSaved(current => {
    const next = current.includes(symbol) ? current.filter(item => item !== symbol) : [...current, symbol];
    localStorage.setItem('idx-radar-watchlist', JSON.stringify(next));
    return next;
  });
  const allStocks = scanner.data?.stocks ?? [];
  const stocks = mode === 'watchlist' ? allStocks.filter(s => saved.includes(s.symbol)) : mode === 'stockpick' ? allStocks.filter(s => s.state === 'available' && Object.values(s.criteria).every(c => c.state === 'pass')) : allStocks;
  const headings = {
    watchlist: ['PANTAUAN PRIBADI', 'Watchlist', 'Saham yang Anda simpan di perangkat ini.'],
    stockpick: ['HASIL TERFILTER', 'Stockpick harian', 'Saham dengan data tersedia yang lolos seluruh kriteria pemindaian.'],
    scan: ['PEMINDAIAN IDX', 'Hasil Scan', 'Lihat status data dan hasil kriteria untuk setiap simbol yang dipindai.'],
  } as const;
  const [eyebrow, title, detail] = headings[mode];
  const shown = mode === 'scan' ? stocks : stocks;
  return <main className="main-content">
    <PageTitle eyebrow={eyebrow} title={title} detail={detail} action={<button className="button secondary-button" onClick={() => scanner.refetch()} disabled={scanner.isFetching} data-testid={`button-refresh-${mode}`}><RefreshCw size={15} className={scanner.isFetching ? 'spin' : ''} />Segarkan</button>} />
    <DataNotice />
    {mode === 'stockpick' && <div className="criteria-banner"><SlidersHorizontal size={17} /><span><b>4 kriteria dipakai</b><small>Breakout · volume · MACD · turnover</small></span><span className="criteria-count">{stocks.length} lolos</span></div>}
    {mode === 'watchlist' && <div className="watchlist-info"><Bookmark size={16} /><span>Tersimpan hanya di perangkat ini melalui penyimpanan lokal.</span><span className="criteria-count">{saved.length} tersimpan</span></div>}
    {scanner.isLoading ? <LoadingRows /> : scanner.isError ? <ErrorPanel error={scanner.error} retry={() => scanner.refetch()} /> : shown.length ? <section className="stock-table"><div className="table-head"><span>SAHAM</span><span>HARGA TERAKHIR</span><span>PERUBAHAN</span><span>VOLUME</span><span>KONDISI DATA</span><span /><span /></div>{shown.map(s => <div key={s.symbol} className="stock-table-entry"><StockLink stock={s} saved={saved.includes(s.symbol)} onToggle={toggle} />{mode === 'scan' && <CriteriaStrip stock={s} />}{(s.state === 'failed' || s.state === 'unavailable' || s.state === 'delayed') && s.error && <div className="raw-error"><span>Pesan sumber</span><code>{s.error}</code></div>}</div>)}</section> : <EmptyPanel title={mode === 'watchlist' ? 'Pantauan Anda masih kosong' : mode === 'stockpick' ? 'Belum ada kandidat yang lolos' : 'Belum ada hasil scan'} text={mode === 'watchlist' ? 'Simpan saham dari hasil scan dengan ikon penanda. Daftar ini tetap tersimpan di perangkat Anda.' : mode === 'stockpick' ? 'Kandidat hanya ditampilkan saat seluruh kriteria tersedia dan lolos. Tidak ada hasil contoh.' : 'Pemindai belum mengembalikan hasil. Coba muat ulang nanti.'} />}
    {scanner.data && <div className="list-footer"><span>Hasil dari {scanner.data.source}</span><span>Diperbarui {formatTime(scanner.data.updatedAt)}</span></div>}
  </main>;
}
function CandleChart({ detail }: { detail: StockDetail }) {
  const candles = detail.candles.slice(-90);
  if (!candles.length) return <div className="chart-empty"><Activity size={19} /><span>Riwayat harian belum tersedia.</span></div>;
  const width = 760, height = 260, left = 12, right = 62, top = 15, bottom = 18;
  const min = Math.min(...candles.map(c => c.low)), max = Math.max(...candles.map(c => c.high));
  const y = (value: number) => height - bottom - ((value - min) / (max - min || 1)) * (height - top - bottom);
  const step = (width - left - right) / candles.length;
  const bodyWidth = Math.max(2, Math.min(8, step * .62));
  const support = detail.support.filter(level => level.price >= min && level.price <= max);
  const resistance = detail.resistance.filter(level => level.price >= min && level.price <= max);
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik candlestick harian dengan harga pembukaan, tertinggi, terendah, dan penutupan">
    {[0, .33, .66, 1].map((v, i) => { const lineY = top + v * (height - top - bottom); return <g key={i}><line x1={left} x2={width - right + 5} y1={lineY} y2={lineY} className="chart-grid" /><text x={width - right + 10} y={lineY + 3} className="chart-label">{formatNumber(max - (max - min) * v)}</text></g>; })}
    {support.map((level, i) => <line key={`s-${i}`} x1={left} x2={width - right} y1={y(level.price)} y2={y(level.price)} className="support-guide" />)}
    {resistance.map((level, i) => <line key={`r-${i}`} x1={left} x2={width - right} y1={y(level.price)} y2={y(level.price)} className="resistance-guide" />)}
    {candles.map((candle, i) => { const cx = left + step * (i + .5); const rising = candle.close >= candle.open; const candleTop = Math.min(y(candle.open), y(candle.close)); const candleHeight = Math.max(1.5, Math.abs(y(candle.open) - y(candle.close))); return <g key={candle.date}><line x1={cx} x2={cx} y1={y(candle.high)} y2={y(candle.low)} className={rising ? 'candle-wick up' : 'candle-wick down'} /><rect x={cx - bodyWidth / 2} y={candleTop} width={bodyWidth} height={candleHeight} rx="1" className={rising ? 'candle-body up' : 'candle-body down'} /></g>; })}
  </svg><div className="chart-dates"><span>{formatDate(candles[0].date)}</span><span>{formatDate(candles[candles.length - 1].date)}</span></div></div>;
}
function VolumeChart({ detail }: { detail: StockDetail }) {
  const candles = detail.candles.slice(-90);
  if (!candles.length) return <div className="chart-empty"><span>Volume belum tersedia.</span></div>;
  const width = 760, height = 126, left = 12, right = 62, top = 14, bottom = 16;
  const maxVolume = Math.max(1, ...candles.map(c => c.volume));
  const step = (width - left - right) / candles.length;
  const barWidth = Math.max(2, Math.min(8, step * .62));
  const baseline = height - bottom;
  return <div className="chart-wrap"><div className="chart-scale"><span>Volume</span><span>{formatNumber(maxVolume)}</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik volume harian">
    <line x1={left} x2={width - right} y1={baseline} y2={baseline} className="chart-grid" />
    {candles.map((candle, i) => { const cx = left + step * (i + .5); const barHeight = (candle.volume / maxVolume) * (height - top - bottom); return <rect key={candle.date} x={cx - barWidth / 2} y={baseline - barHeight} width={barWidth} height={barHeight} className={candle.close >= candle.open ? 'volume-bar up' : 'volume-bar down'} />; })}
  </svg><div className="chart-dates"><span>{formatDate(candles[0].date)}</span><span>{formatDate(candles[candles.length - 1].date)}</span></div></div>;
}
function MacdChart({ detail }: { detail: StockDetail }) {
  const points = detail.candles.filter(c => c.macd != null && c.signal != null && c.histogram != null).slice(-90);
  if (!points.length) return <div className="chart-empty"><span>Riwayat belum cukup untuk menghitung MACD 12/26/9.</span></div>;
  const width = 760, height = 168, left = 12, right = 62, top = 14, bottom = 14;
  const extent = Math.max(1, ...points.flatMap(c => [Math.abs(c.macd ?? 0), Math.abs(c.signal ?? 0), Math.abs(c.histogram ?? 0)]));
  const innerHeight = height - top - bottom;
  const zeroY = top + innerHeight / 2;
  const valueY = (value: number) => zeroY - (value / extent) * (innerHeight / 2);
  const step = (width - left - right) / points.length;
  const path = (field: 'macd' | 'signal') => points.map((point, i) => `${i ? 'L' : 'M'}${(left + step * (i + .5)).toFixed(1)},${valueY(point[field] ?? 0).toFixed(1)}`).join(' ');
  const barWidth = Math.max(2, Math.min(8, step * .62));
  return <div className="chart-wrap"><div className="macd-legend"><span><i className="macd-key-line" />MACD</span><span><i className="signal-key-line" />Signal</span><span><i className="hist-key" />Histogram</span></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Grafik MACD dengan garis MACD, signal, dan histogram">
    <line x1={left} x2={width - right} y1={zeroY} y2={zeroY} className="chart-grid" />
    {points.map((point, i) => { const cx = left + step * (i + .5); const hist = point.histogram ?? 0; const histY = valueY(hist); return <rect key={point.date} x={cx - barWidth / 2} y={Math.min(zeroY, histY)} width={barWidth} height={Math.max(1, Math.abs(zeroY - histY))} className={hist >= 0 ? 'histogram-bar positive' : 'histogram-bar negative'} />; })}
    <path d={path('macd')} className="macd-line" /><path d={path('signal')} className="signal-line" />
  </svg><div className="chart-dates"><span>{formatDate(points[0].date)}</span><span>{formatDate(points[points.length - 1].date)}</span></div></div>;
}
function DetailPage({ symbol }: { symbol: string }) {
  const detail = useGetStockDetail(symbol, { query: { queryKey: getGetStockDetailQueryKey(symbol) } });
  const stock = detail.data;
  const scanner = useGetScanner({ query: { queryKey: getGetScannerQueryKey() } });
  const scanStock = scanner.data?.stocks.find(s => s.symbol === symbol);
  const latestCandle = stock?.candles.at(-1);
  const previousCandle = stock?.candles.at(-2);
  const dailyChange = latestCandle && previousCandle ? latestCandle.close - previousCandle.close : null;
  return <main className="main-content">
    <div className="breadcrumb"><Link href="/">Pasar</Link><ChevronRight size={14} /><span>{symbol}</span></div>
    {detail.isLoading ? <LoadingRows /> : detail.isError ? <ErrorPanel error={detail.error} retry={() => detail.refetch()} /> : stock ? <>
      <PageTitle eyebrow="RINCIAN SAHAM · IDX" title={stock.symbol} detail={stock.name} action={<button className="button secondary-button" onClick={() => detail.refetch()} disabled={detail.isFetching} data-testid="button-refresh-detail"><RefreshCw size={15} className={detail.isFetching ? 'spin' : ''} />Segarkan</button>} />
      <DataNotice />
      <div className="detail-statusline"><StatePill state={stock.state} /><span>Sumber: {stock.source}</span><span>Terakhir diperdagangkan: {formatDate(stock.lastTradingDate)}</span><span>Diperbarui: {formatTime(stock.updatedAt)}</span></div>
      {stock.error && <div className="raw-error detail-error"><span>Pesan sumber</span><code>{stock.error}</code></div>}
      <section className="detail-metrics"><div><span>PENUTUPAN TERAKHIR</span><b>{formatNumber(latestCandle?.close, true)}</b><small>Perubahan harian {dailyChange == null ? 'belum tersedia' : `${dailyChange > 0 ? '+' : ''}${formatNumber(dailyChange)} (${formatNumber(previousCandle ? dailyChange / previousCandle.close * 100 : null)}%)`}</small></div><div><span>VOLUME HARIAN</span><b>{formatNumber(latestCandle?.volume)}</b><small>Per tanggal {formatDate(latestCandle?.date)}</small></div><div><span>ESTIMASI 1 LOT (100 LEMBAR)</span><b>{formatNumber(latestCandle ? latestCandle.close * 100 : null, true)}</b><small>Belum termasuk biaya transaksi · acuan modal Rp100.000</small></div></section>
      <section className="chart-card"><div className="card-head"><div><div className="eyebrow">HISTORI HARIAN · 90 SESI TERAKHIR</div><h2>Candlestick OHLC</h2></div><span className="chart-legend"><i className="legend-up" />Naik <i className="legend-down" />Turun</span></div><CandleChart detail={stock} /></section>
      <section className="chart-card indicator-card"><div className="card-head"><div><div className="eyebrow">AKTIVITAS HARIAN</div><h2>Volume perdagangan</h2></div></div><VolumeChart detail={stock} /></section>
      <section className="chart-card indicator-card"><div className="card-head"><div><div className="eyebrow">MOMENTUM · EMA 12/26/9</div><h2>MACD</h2></div></div><MacdChart detail={stock} /></section>
      <section className="levels-grid"><div className="level-card"><div className="eyebrow">AREA SUPPORT</div><h3>Dukungan terhitung</h3>{stock.support.length ? stock.support.map((l, i) => <div className="level-row" key={`${l.date}-${i}`}><b>{formatNumber(l.price, true)}</b><span>{formatDate(l.date)}</span></div>) : <p className="muted-copy">Belum tersedia</p>}</div><div className="level-card"><div className="eyebrow">AREA RESISTANCE</div><h3>Resistansi terhitung</h3>{stock.resistance.length ? stock.resistance.map((l, i) => <div className="level-row" key={`${l.date}-${i}`}><b>{formatNumber(l.price, true)}</b><span>{formatDate(l.date)}</span></div>) : <p className="muted-copy">Belum tersedia</p>}</div></section>
      <section className="detail-bottom"><div className="note-card"><span className="note-index">BACA DATA</span><h3>Histori, bukan harga langsung.</h3><p>Grafik menampilkan data candle harian yang tersedia dari sumber. Area teknikal adalah referensi historis, bukan jaminan pergerakan berikutnya.</p></div>{scanStock && <div className="note-card"><span className="note-index">HASIL PEMINDAIAN</span><h3>Kriteria harian</h3><CriteriaStrip stock={scanStock} /><Link href="/scan" className="text-link">Lihat seluruh pemindaian <ArrowRight size={15} /></Link></div>}</section>
    </> : <EmptyPanel title="Data saham belum tersedia" text="Belum ada detail untuk simbol ini." />}
  </main>;
}
function SettingsPage() {
  const symbols = useGetSymbols({ query: { queryKey: getGetSymbolsQueryKey() } });
  const scanner = useGetScanner({ query: { queryKey: getGetScannerQueryKey() } });
  return <main className="main-content"><PageTitle eyebrow="PREFERENSI & SUMBER" title="Pengaturan" detail="Informasi cakupan simbol dan sumber data yang digunakan IDX Radar." />
    <DataNotice />
    <section className="settings-card"><div className="settings-icon"><Database size={18} /></div><div className="settings-main"><div className="eyebrow">SUMBER PEMINDAIAN</div><h2>Yahoo Finance · histori harian</h2><p>Data bukan real-time. Perubahan hanya terlihat setelah penyedia memperbarui histori harian.</p><div className="settings-meta"><span>Status pemindaian</span>{scanner.data ? <StatePill state={scanner.data.state} /> : scanner.isError ? <StatePill state="failed" /> : <span>Memuat…</span>}<span>Data terakhir</span><b>{formatTime(scanner.data?.updatedAt)}</b></div>{scanner.isError && <code className="inline-error">{scanner.error instanceof Error ? scanner.error.message : String(scanner.error)}</code>}</div><button className="button secondary-button" onClick={() => scanner.refetch()} data-testid="button-refresh-settings"><RefreshCw size={15} />Periksa</button></section>
    <div className="section-heading"><div><div className="eyebrow">DAFTAR DUKUNGAN</div><h2>Simbol yang tersedia</h2></div>{symbols.data && <span className="quiet-count">{symbols.data.length} simbol</span>}</div>
    {symbols.isLoading ? <LoadingRows /> : symbols.isError ? <ErrorPanel error={symbols.error} retry={() => symbols.refetch()} /> : symbols.data?.length ? <div className="symbols-grid">{symbols.data.map((s: StockSymbol) => <Link className="symbol-tile" href={`/stocks/${encodeURIComponent(s.symbol)}`} key={s.symbol}><span><b>{s.symbol}</b><small>{s.name}</small></span><span className="symbol-sector">{s.sector}</span><ChevronRight size={15} /></Link>)}</div> : <EmptyPanel title="Daftar simbol belum tersedia" text="Coba periksa koneksi data atau muat ulang daftar." />}
  </main>;
}
function DiagnosticsPage() {
  const diagnostics = useGetDiagnostics({ query: { queryKey: getGetDiagnosticsQueryKey() } });
  const test = useTestDataConnection();
  const result = test.data ?? diagnostics.data;
  const checks = result ? [['Koneksi internet server', result.internet], ['Akses Yahoo Finance', result.yahoo]] as const : [];
  return <main className="main-content"><PageTitle eyebrow="KESEHATAN DATA" title="Diagnostik koneksi" detail="Periksa jalur data dan uji pengambilan histori saham nyata." action={<button className="button secondary-button" onClick={() => diagnostics.refetch()} disabled={diagnostics.isFetching} data-testid="button-refresh-diagnostics"><RefreshCw size={15} className={diagnostics.isFetching ? 'spin' : ''} />Muat ulang</button>} />
    <DataNotice />
     <div className="diagnostic-callout"><div><div className="eyebrow">UJI SUMBER NYATA</div><h2>Uji BBCA.JK dan BBRI.JK</h2><p>Permintaan ini mengambil data langsung dari koneksi server ke Yahoo Finance.</p></div><button className="button primary-button" onClick={() => test.mutate()} disabled={test.isPending} data-testid="button-test-connection"><Activity size={16} className={test.isPending ? 'spin' : ''} />{test.isPending ? 'Sedang menguji' : 'TES KONEKSI DATA'}</button></div>
    {test.isError && <ErrorPanel error={test.error} retry={() => test.mutate()} label="Uji koneksi gagal" />}
    {diagnostics.isLoading && !result ? <LoadingRows /> : diagnostics.isError && !result ? <ErrorPanel error={diagnostics.error} retry={() => diagnostics.refetch()} /> : result ? <>
      <div className="diagnostics-summary"><span>SUMBER</span><b>{result.source}</b><span>UJI TERAKHIR</span><b>{formatTime(result.testedAt)}</b></div>
      <section className="check-list">{checks.map(([label, check]) => <div className="check-row" key={label}><div className={`check-symbol ${check.status === 'success' ? 'check-good' : 'check-bad'}`}>{check.status === 'success' ? <Check size={16} /> : <X size={16} />}</div><div><b>{label}</b><small>{check.message}</small>{check.error && <code>{check.error}</code>}</div><span className={`check-state ${check.status}`}>{check.status === 'success' ? 'Berhasil' : 'Gagal'}</span></div>)}</section>
      <div className="section-heading"><div><div className="eyebrow">PENGUJIAN TICKER</div><h2>Histori saham uji</h2></div></div>
      <section className="ticker-results">{result.tickers.map(t => <div className="ticker-result" key={t.symbol}><span className={`check-symbol ${t.status === 'success' ? 'check-good' : 'check-bad'}`}>{t.status === 'success' ? <Check size={15} /> : <X size={15} />}</span><div className="ticker-result-copy"><b>{t.symbol}</b><small>{t.status === 'success' ? `${formatNumber(t.rows)} baris · terakhir ${formatDate(t.lastTradingDate)}` : 'Pengambilan data tidak berhasil'}</small>{t.error && <code>{t.error}</code>}</div>{t.close != null && <span className="ticker-close">{formatNumber(t.close, true)}</span>}</div>)}</section>
    </> : <EmptyPanel title="Diagnostik belum dijalankan" text="Status koneksi belum tersedia." />}
  </main>;
}
function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="app-shell dark">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><Link href="/" className="brand-lockup" onClick={() => setMobileOpen(false)}><span className="brand-symbol"><Activity size={18} strokeWidth={2.5} /></span><span><b>IDX RADAR</b><small>WORKSPACE HARIAN</small></span></Link><div className="nav-caption">RUANG KERJA</div><nav className="side-nav">{nav.map(item => { const Icon = item.icon; const active = location === item.href || (item.href === '/scan' && location.startsWith('/stocks/')); return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`nav-link ${active ? 'nav-active' : ''}`} data-testid={`link-nav-${item.href === '/' ? 'market' : item.href.slice(1)}`}><Icon size={17} /><span>{item.label}</span></Link>; })}</nav><div className="sidebar-spacer" /><div className="sidebar-foot"><div className="market-open"><span className="live-dot" /><span><b>MODE DATA HARIAN</b><small>Tanpa pembaruan real-time</small></span></div><Link href="/diagnostics" className={`nav-link foot-link ${location === '/diagnostics' ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)}><CircleHelp size={17} /><span>Diagnostik</span></Link><Link href="/settings" className={`nav-link foot-link ${location === '/settings' ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)}><Settings2 size={17} /><span>Pengaturan</span></Link><div className="sidebar-version"><span>IDX RADAR</span><span>V1.0</span></div></div></aside>
    {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Tutup menu" />}
    <div className="workspace"><header className="topbar"><button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu size={19} /></button><div className="crumb-label"><span>INDONESIA</span><i>/</i><b>BURSA EFEK INDONESIA</b></div><div className="topbar-right"><span className="daily-chip"><span className="live-dot" />HISTORI HARIAN</span><span className="top-date">{new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }).format(new Date())}</span></div></header>{children}<footer className="app-footer"><span>IDX RADAR <b>·</b> Informasi untuk observasi mandiri</span><span>Data harian Yahoo Finance · Bukan real-time</span></footer></div>
  </div>;
}
function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch>
    <Route path="/" component={MarketPage} />
    <Route path="/watchlist"><StockCollection mode="watchlist" /></Route>
    <Route path="/stockpick"><StockCollection mode="stockpick" /></Route>
    <Route path="/scan"><StockCollection mode="scan" /></Route>
    <Route path="/stocks/:symbol">{params => <DetailPage symbol={decodeURIComponent(params.symbol)} />}</Route>
    <Route path="/settings" component={SettingsPage} />
    <Route path="/diagnostics" component={DiagnosticsPage} />
    <Route component={NotFound} />
  </Switch></Shell></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
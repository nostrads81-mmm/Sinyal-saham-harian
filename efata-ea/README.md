# Replika Python — EfataTech EA v26.07.29

Replika logika `efatatech.mq5` (EA martingale-hedging MT5) dalam Python,
untuk **uji coba dan backtest** sebelum dibuat ulang sebagai file MQL5.
Sumber spesifikasi: dokumen *"EfataTech EA — Petunjuk Penggunaan
(v26.07.29)"*.

## Struktur

```
efata-ea/
├── efata/
│   ├── params.py       29 parameter LS Param (slot 1-29) + default dokumen
│   ├── magic.py        format magic imZEX + parser perintah LS Kendali
│   ├── indicators.py   MACD(5,13,1 weighted), Fractals, ATR, ADX, RSI,
│   │                   Ichimoku, Donchian — inkremental per bar
│   ├── data.py         loader CSV M1, data sintetis, agregator TF
│   ├── broker.py       simulator broker MT5 hedging (posisi, pending BS/SS,
│   │                   close-by, margin, stops level)
│   ├── techniques.py   teknik i=1-9 (rumus update target)
│   ├── engine.py       mesin inti: PINDAI→LAWAN→TEMAN→UPDATE→PENGAMAN→EXIT
│   └── backtest.py     backtester bar M1 (jalur intrabar O-H-L-C)
├── tests/              54 unit test (unittest, tanpa dependensi eksternal)
└── run_backtest.py     CLI backtest
```

Tanpa dependensi di luar pustaka standar Python (agar logika mudah
diporting balik ke MQL5).

## Cara pakai

```bash
# semua test
cd efata-ea && python3 -m unittest discover -s tests

# backtest data sintetis: teknik i=1, martingale x3, exit profit 1% balance
python3 run_backtest.py --magic 10110 --lot 0.01 --bars 20000 \
    --set xLot=3 --set exitPct=1 --set exitUSD=0

# mode pasangan (xLot=1) + level cut 3
python3 run_backtest.py --magic 10110 --set xLot=1 --set maxLevCut=3 \
    --set exitPct=1 --set exitUSD=0

# data nyata: CSV M1 kolom time,open,high,low,close
python3 run_backtest.py --csv XAUUSD_M1.csv --magic 20110 --set exitPct=1

# beberapa magic sekaligus
python3 run_backtest.py --magic 10110 --magic 70110 --set xLot=3
```

Dari kode, padanan "remote" MT5:

```python
from efata.backtest import Backtester
bt = Backtester()
bt.engine.execute(1011000.1)   # TP LS Kendali: spawn magic 10110 lot 0.1
bt.engine.params.set_slot(3, 3.0)   # LS Param slot 3: xLot = 3
stats = bt.run(bars)
```

## Pemetaan konsep MT5 → Python

| MT5 (dokumen) | Replika |
|---|---|
| LS Kendali (TP = perintah) | `Engine.execute(tp)` |
| LS Param 29 slot | `Params.set_slot(n, nilai)` |
| LS Loop (8mmZEXLL) | `Engine.execute(8........)` → respawn otomatis saat magic kosong (`loopPerDay` dihormati) |
| magic imZEX | `efata.magic.decode_magic` |
| OnTick throttle 1 dtk | `Engine.step()` — dipanggil backtester 4×/bar M1 (≈15 dtk) |
| pending siaga BS=7777777 / SS=0.07 | `STANDBY_BS` / `STANDBY_SS` |
| rem 99 | `Pending.parked` |
| ORDER_TYPE_CLOSE_BY | `SimBroker.close_by` (tanpa spread) |
| MQL_TESTER auto-siaga | selalu aktif (Python = mode backtest) |

## Keputusan desain & deviasi yang disengaja

Dicatat agar bisa dicek ulang terhadap EA asli saat porting ke MQL5:

1. **Konflik penomoran teknik di dokumen.** Tabel §5 dan daftar simple1-9
   (§11) tidak konsisten (§5: i=2 fraktal, i=4 lot-sama; §11: simple1
   fraktal, simple2 lot-sama, simple5 Donchian+marti). Replika memakai
   **tabel §5** sebagai pemetaan digit i, dengan detail implementasi dari
   prompt simple yang sesuai tekniknya. Pemetaan bisa ditukar via
   `Engine(technique_map=...)`.
2. **Granularitas waktu.** Engine jalan 4× per bar M1 di 4 titik jalur
   O→H→L→C (bukan per tick). Pending ter-fill tepat di harganya, tanpa
   slippage; spread konstan.
3. **Teman -T**: pemicu = fraktal baru terkonfirmasi searah MACD bar 1
   (buy saat MACD atas + lembah baru; sell mirror). Pelindung -TL dibuat
   sebagai pending seberang 1:1 (comment `-TL`), dikecualikan dari logika
   LAWAN tapi ikut digeser rutin UPDATE. Detail pemicu di EA asli
   ("pola retrace zona MACD") lebih halus — perlu kalibrasi.
4. **useRSI** (slot 8): diasumsikan gate L0 klasik — BS hanya di-arm bila
   RSI < 70, SS bila RSI > 30 (dokumen tidak merinci ambangnya).
5. **useEMA** (slot 20): target BS hanya dipakai bila di atas EMA(close),
   SS bila di bawah (asumsi; dokumen hanya menyebut "filter target").
6. **useDivergent** (slot 18): belum diimplementasikan (default 0/off).
7. **minMarginLev**: rem dilepas otomatis saat margin pulih (EA asli:
   manual) supaya backtest bisa berjalan terus.
8. **REPLIKASI order manual**: tidak relevan di backtest Python (tidak ada
   order manual); pasangan siaga dibuat otomatis saat magic kosong,
   meniru perilaku MQL_TESTER.
9. **exitRR X.Y**: "rugi terburuk" = floating paling negatif sepanjang
   siklus magic berjalan; Y (level mulai) = digit desimal pertama.
10. **i=9**: pengali marti ×3, RR recovery ×2, guard 300 point, kunci
    harian ±5% — angka tetap sesuai prompt simple9 (bukan dari xLot).
11. **Ichimoku**: displacement Senkou Span = 26 bar (klasik).
12. **i=7 chop-guard**: basis teknik polos (mengikuti rujukan "seperti
    i=1" di §5); ambang ADX memakai `minADX` (default 20), range 3×ATR.
13. **Level dari lot**: level = round(log_xLot(lot/init)); dengan booster
    besar dan xLot kecil (mis. xLot=2 + booster ≥ 1.9) pembulatan bisa
    meleset satu level.

## Peringatan

- Hasil backtest **data sintetis tidak bermakna** untuk profitabilitas
  riil — data buatan bergelombang teratur dan sangat ramah ke strategi
  mean-reversion/martingale. Gunakan CSV M1 riil untuk penilaian.
- Martingale (`xLot>1`) melipatgandakan lot secara eksponensial; tabel
  dokumen sendiri menunjukkan L5 = 243× lot awal. Ini bisa menghapus akun
  di pasar sideways panjang. Pengaman (`maxLevCut`, `lossMaxPersen`,
  `minMarginLev`) aktif secara default — jangan dimatikan saat uji.

## Langkah berikutnya (porting ke MQL5)

1. Validasi perilaku tiap teknik terhadap data riil + bandingkan dengan
   EA asli di akun demo (kalau file .mq5/.ex5 aslinya ada).
2. Kalibrasi bagian yang ditandai asumsi (teman -T, useRSI, useEMA,
   pemetaan i) — lalu kunci sebagai spesifikasi.
3. Tulis `efatatech.mq5` modul per modul mengikuti struktur `engine.py`;
   logika sudah 1:1 dengan konsep MQL5 (pending, magic, close-by).

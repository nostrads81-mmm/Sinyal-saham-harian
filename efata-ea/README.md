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

## Hasil backtest data riil (XAUUSD M1, Jan–Mar 2018)

Data: tick riil dari repo publik FX-Data (`python3 fetch_xauusd.py`),
82.685 bar M1. Balance awal $10.000, lot 0.01, spread 20 point, exit
profit 1% balance (`exitPct=1`, `exitUSD=0`). Bukan janji profit — hanya
potret perilaku tiap konfigurasi pada 3 bulan data itu:

| Konfigurasi | Balance akhir | PF | Win | Max DD |
|---|---|---|---|---|
| i=1 marti ×3, M1 | $9.748 | 0.91 | 45.8% | 2.7% |
| i=1 pasangan (xLot=1, cut L3), M1 | $9.416 | 0.82 | 35.7% | 6.0% |
| i=2 fraktal marti ×3, M1 | $9.909 | 0.96 | 48.5% | 1.9% |
| i=7 chop-guard marti ×3, M1 | $9.766 | 0.92 | 46.5% | 2.5% |
| i=3 Turtle, M1 | **-$39 (habis)** | 0.90 | 43.7% | 100% |
| i=9 ichi+RSI, M1 | $10.821 | 1.17 | 61.5% | 12.4% |
| i=1 marti ×3, M5 | $10.054 | 1.06 | 53.5% | 1.0% |
| i=1 marti ×3, M30 | $10.048 | 1.15 | 74.1% | 1.1% |

Pengamatan: varian scalping M1 kalah tipis oleh spread (siklus profit 1%
terlalu kecil dibanding biaya 20 point per order); timeframe lebih besar
(M5/M30) memperbaiki PF; Turtle 1%-risk di M1 whipsaw sampai habis —
teknik itu memang dirancang untuk TF besar. Belum termasuk komisi/swap.

## Uji konsistensi 2015–2017 (±338k bar M1 riil per tahun)

Return per periode (balance awal $10.000 tiap tahun; PF dalam kurung):

| Konfigurasi | 2015 | 2016 | 2017 | 2018 Q1 |
|---|---|---|---|---|
| i1 M5 ×3 e1% cut2 | +7,6% (1.18) | +2,0% (1.04) | +3,4% (1.09) | +0,5% (1.06) |
| i1 M30 ×3 e1% cut2 | +3,2% (1.19) | +1,4% (1.07) | +3,1% (1.22) | +0,4% (1.15) |
| i9 M1 | −92% | −84% | −46% | +4,2% |
| i9 M5 | −27% | −37% | −21% | **+19,8%** |
| i1 M30 ×2 e1% cut4 | −4,1% | +4,5% | −5,9%¹ | +4,7% |
| i1 M5 ×2 e2% cut4 | −8,3% | −3,6% | −7,1% | +3,1% |
| i2 M30 ×3 e1% cut4 | −13,9% | −12,8% | +26,4% | +2,6% |

¹ hanya 1 trade tertutup setahun — siklus macet panjang, equity akhir
didominasi posisi mengambang.

Kesimpulan:

1. **Grid pada satu kuartal = overfitting.** Semua "juara" grid 2018 Q1
   (i9 M5, varian cut4) rugi di mayoritas 2015–2017. i9 khususnya rapuh:
   +19,8% di 2018 Q1 tapi hancur di tiga tahun lainnya.
2. **Yang robust justru konfigurasi membosankan**: i1 (zona MACD polos)
   di M5/M30, xLot 3, exitPct 1%, maxLevCut 2 (default dokumen) —
   positif di EMPAT periode berturut-turut, PF 1.04–1.22, drawdown
   ≤ 2,7%. Profitnya kecil (+0,4%…+7,6% per tahun) tapi konsisten.
3. **maxLevCut kecil adalah nyawa martingale ini**: cut2 memotong tangga
   lebih awal → banyak siklus kecil yang stabil; cut4 membiarkan tangga
   dalam → beberapa periode bagus, periode lain macet berbulan-bulan
   dengan floating loss besar.
4. Semua angka belum termasuk komisi & swap; profit tipis konfigurasi
   robust bisa terkikis swap pada posisi yang menginap.

## Hasil tuning walk-forward (target ≥20%/tahun)

Metodologi: tuning HANYA di 2015–2016 (in-sample), dinilai di 2017 +
2018 Q1 (out-of-sample). Tahapan & temuan:

1. **Sweep exitRR** (0/1/2/3 × xLot 2/3 × M5/M30, basis i1 cut2):
   terbaik `exitRR=0` (exit murni via `exitPct=1%`) dan `xLot=3`.
2. **Portfolio**: gabungan magic **10220 + 10330** (i1 M5 + i1 M30, satu
   akun) ≈ menjumlahkan return kedua solo tanpa menambah DD berarti.
   Menambah i2 M30 justru merusak — magic ketiga menyedot margin sampai
   `minMarginLev` memarkir pending seluruh akun.
3. **Validasi OOS** (lot 0.01): 2017 +7,3% (PF 1.10, DD 3,2%);
   2018 Q1 −0,1% (kuartal vol rendah, siklus jarang).
4. **Sizing**: scaling lot naif GAGAL — dengan `minMarginLev=5000`
   (default), lot ≥0.05 memicu rem margin sejak level pertama, siklus
   beku, hasil acak. Dengan `minMarginLev=500` scaling kembali linier:

| Lot (per $10k) | 2015 | 2016 | 2017 | 2018 Q1 | DD maks |
|---|---|---|---|---|---|
| 0.01 | +15,7% | +9,2% | +7,3% | −0,1% | 3,6% |
| **0.03** | **+40,2%** | **+20,5%** | **+19,9%** | −0,9% | **9,4%** |
| 0.05 | +63,9% | +21,7% | +44,9% | +4,9% | 17,7% |
| 0.1 | +115,9% | +59,0% | +63,5% | +9,2% | 24,8% |
| 0.2¹ | +186,6% | +112,3% | +158,7% | +4,6% | 29,1% |

¹ lot 0.2 (`minMarginLev=200`): return simulator spektakuler tapi PALING
tidak bisa dipercaya — siklus profit $100 per 0.2 lot diambil dari
pergerakan sangat kecil, wilayah di mana slippage/komisi/spread melebar
(tak dimodelkan) menggigit paling dalam, dan simulator tanpa stop-out.
2018 Q1 memperlihatkan asimetrinya: +4,6% sekuartal sambil menanggung
DD 21,2%. Tier ini bukan untuk perencanaan.

Catatan skala: return TIDAK linier terhadap lot (efek path & margin) —
di 2016 lot 0.05 hanya menyamai 0.03 (+21,7% vs +20,5%) sementara
DD-nya berlipat (17,7% vs 9,4%).

**Konfigurasi final (P1):** magics 10220+10330 · `xLot=3` · `exitPct=1`
· `exitRR=0` · `exitUSD=0` · `maxLevCut=2` · `minMarginLev=500` ·
`lossMaxPersen=15` · lot 0.03 per $10.000 (≈ `MM=0.3`). Pengaman utama
sesungguhnya adalah `maxLevCut=2` (tangga marti dipotong di L2), bukan
rem margin. `lossMaxPersen` 25→15 terverifikasi TANPA dampak ke hasil
(rem darurat tak pernah menyala di 2016, tahun ber-DD terburuk; hasil
identik di 25/15/10) — diturunkan murni sebagai asuransi rezim buruk.

Catatan jujur: target "≥20%/tahun" tercapai di ketiga tahun penuh yang
diuji, tapi (a) 2018 Q1 menunjukkan akan ada periode flat, (b) belum
termasuk komisi/swap, (c) 3 tahun × 1 instrumen bukan jaminan masa
depan, (d) menurunkan `minMarginLev` melepas satu lapis pengaman —
di rezim yang lebih buruk dari 2015–2017, DD bisa jauh melebihi 10%.

## Sensitivitas spread & revisi preset (P1-r)

Spread XAUUSDc terukur di demo Windsor: **26 point** (asumsi lama 20).
Dampaknya besar — P1 (exitPct=1) di spread 26: +31,9% / +12,7% / +0,6%
(2017 nyaris nol); di spread 35 malah rugi. Mitigasi teruji (semua di
spread 26, lot 0.03/$10k):

| Varian | 2015 | 2016 | 2017 | DD maks |
|---|---|---|---|---|
| P1 exitPct=1 | +31,9% | +12,7% | +0,6% | 12,9% |
| **P1-r: exitPct=2** | **+36,0%** | **+23,8%** | **+14,5%** | 9,7% |
| M30 solo exitPct=2 | +21,2% | +22,7% | +8,4% | 7,5% |

**Preset direvisi (P1-r): `exitPct=2`** — siklus profit 2x lebih besar
mengamortisasi biaya spread yang per-siklusnya tetap. Parameter lain
tidak berubah. M30-solo-e2% adalah cadangan paling tahan bila spread
riil rata-rata > 30 point. Ukur spread rata-rata di beberapa sesi
sebelum live; strategi ini tidak layak di spread >= 35.

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

# efatatech_replika.mq5 — port MQL5 (v1)

Port MetaTrader 5 dari replika Python tervalidasi. Default input =
**preset P1** hasil tuning (lihat `../README.md`): magics `10220,10330`,
xLot 3, exitPct 1%, exitRR 0, maxLevCut 2, minMarginLev 500,
lossMaxPersen 15, MM 0.3 (lot otomatis = balance × 0.3 / 100k).

## Cakupan v1

- Mesin inti per magic (1×/detik): PINDAI → LAWAN → TEMAN → UPDATE →
  PENGAMAN → EXIT; mode martingale / pasangan / linier; booster;
  teman -T/-TL; maxLevel/maxLevCut/minMarginLev; exitPct/USD/RR/Bid;
  lossMax; jam trading WIB; close-by dengan fallback close biasa;
  type_filling otomatis FOK→IOC→RETURN.
- Teknik i=1, 2, 4, 5, 6, 7 (pending-based).
- Remote live: LS Kendali (magic 900000, TP = perintah) + LS Param
  29 slot (magic 55555) — hanya aktif di live/demo, bukan di tester.
- **Belum ada (v2):** teknik i=3/8/9, LS Loop, nextRound, useDivergent,
  teman per-level untuk mode pasangan (v1: batas total per magic).

## Pengaman sideways (ekstensi baru, default MATI)

`InpSidewaysAdxGate` (0=nonaktif) + `InpSidewaysPauseNew` (default false):
saat range 20 bar < 3×ATR **dan** ADX < gate (deteksi sama persis dengan
teknik i=7), EA tidak memasang pasangan siaga baru — posisi yang sudah
terbuka tetap dikelola normal (lawan/teman/exit jalan seperti biasa).

Divalidasi di backtest Python (replika 1:1): return lebih baik di
**ketiga** tahun uji (2015/16/17, gate=20) dibanding tanpa guard, DD
tidak memburuk. Belum pernah diuji live — **default MATI**, aktifkan
manual (set `InpSidewaysAdxGate=20`, `InpSidewaysPauseNew=true`) hanya
setelah observasi preset P1 polos selesai, dan uji dulu di Strategy
Tester sebelum demo.

## Cara pakai

1. MetaTrader 5 → buka MetaEditor (F4) → File > Open Data Folder →
   salin file ke `MQL5/Experts/`.
2. Compile (F7). Bila ada error, kirimkan pesan errornya untuk diperbaiki
   (file ini ditulis tanpa akses compiler).
3. **Strategy Tester dulu**: simbol XAUUSD, timeframe M1, "Every tick
   based on real ticks", modal 10.000, leverage 1:200. Bandingkan
   perilakunya dengan tabel backtest Python di `../README.md`.
4. **Demo** (Windsor/broker pilihan): pasang di chart XAUUSD; EA butuh
   akun **hedging**. Ukur spread riil di jam ramai.
5. Live hanya setelah 2–3 bulan demo konsisten dengan backtest.

## Checklist verifikasi paritas (tester MT5 vs Python)

- [ ] Tangga lot: 0.01 → lawan 0.03 → 0.09, cut di L2 (maxLevCut=2)
- [ ] Terkunci 1:1 → EA diam (tidak hapus-buat pending berulang)
- [ ] Target BS = high zona MACD atas; hanya digeser saat MACD bawah
- [ ] Exit saat profit floating magic > 1% balance (close-by dulu)
- [ ] Order/posisi dengan SL=99 tidak disentuh (rem manual)
- [ ] Margin level < 500% → pending tidak digeser/dibuat
- [ ] Return & DD Strategy Tester 2018 ± sebanding tabel Python
      (tidak akan identik — model fill & spread berbeda)

## Peringatan

- Wajib akun hedging; di akun netting close-by gagal (ada fallback,
  tapi hasil beda dari desain).
- Default `InpAutoSeed=true` = EA langsung memasang pasangan siaga
  (perilaku backtest). Set `false` untuk perilaku live EA asli
  (menunggu trigger order manual tanpa magic — belum diporting penuh,
  gunakan LS Kendali untuk spawn).
- Martingale tetap martingale: jangan jalankan tanpa memahami tabel
  risiko di `../README.md`.

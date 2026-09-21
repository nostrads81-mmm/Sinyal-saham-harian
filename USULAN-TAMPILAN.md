# Usulan Rombak Tampilan (Tahap 3) — untuk disetujui dulu

Dokumen ini **belum mengubah apa pun**. Isinya: fakta tampilan sekarang, usulan struktur, dan rencana 3 langkah kecil. Pemilik memilih arah **B dulu (rapikan struktur, selesai) lalu A (tampilan baru)**, jadi dokumen ini adalah pintu masuk tahap A.

## 1. Prinsip (dari cara aplikasi ini dipakai)

1. **Dipakai di HP, satu tangan, sambil cepat.** Yang penting terlihat tanpa menggulir: apakah hari ini ada sinyal, berapa nilainya, apa batas rugi.
2. **Angka adalah isinya.** Harga, lot, rupiah, persen. Tampilan harus membuat angka itu terbaca sekilas, bukan tenggelam di antara badge dan tombol.
3. **Jangan sentuh yang sudah benar.** Token warna, tema terang/gelap, ukuran teks, dan ketebalan teks sudah ada dan berfungsi — dipakai lebih konsisten, bukan diganti sistem baru.

## 2. Diagnosis (fakta, bukan selera)

| Temuan | Angka / bukti | Akibat saat dipakai |
|---|---|---|
| Satu kartu sinyal = **259 baris JSX** | `pages/index.js:520-778` → 28% dari seluruh halaman | Satu kartu memuat 9 blok sekaligus: skor, tombol TradingView, copy, skip, hapus, umur sinyal, detail status, range bar SL–Entry–TP, 3 kotak angka, kotak saran posisi, TP3, form catat order. Sinyal kedua dan seterusnya tidak terlihat tanpa menggulir jauh |
| Gaya bercampur CSS + inline | 77 kelas dipakai, 105 kelas didefinisikan di `styles/globals.css` (688 baris), plus banyak `style={{...}}` | Mengubah satu hal (mis. ukuran tombol) harus dikerjakan di banyak tempat, rawan lupa |
| Token desain sudah lengkap | `--bg/--surface/--border/--text/--accent/--success/--danger/--warning/--radius/--text-scale/--fw-boost`, tema gelap + terang | Tidak perlu sistem warna baru. Yang kurang hanya aturan pemakaian (kapan pakai danger vs warning, ukuran tombol) |
| Pengaturan hanya bisa dibuka dari tab Sinyal | ikon ⚙ di header Sinyal | Di tab Rekapan ada tombol serupa, tapi tidak konsisten posisinya |
| Aksi berbahaya bersebelahan dengan aksi aman | "hapus" berdampingan dengan "copy"/"skip" di kartu | Salah tekan berisiko menghilangkan sinyal; sekarang bisa dibatalkan 14 hari (dismissed/skipped), tapi tetap membingungkan |

## 3. Usulan struktur

### Tab Sinyal

| Bagian | Sekarang | Usulan |
|---|---|---|
| Ringkasan atas | Sisa modal + slot + 2 kotak (terpakai/total) | Sisa modal sebagai satu angka besar, slot sebagai pill, 2 kotak itu dilipat ke detail ("lihat rincian") |
| Memasukkan sinyal | Zona tempel kecil bertulisan "Tempel sinyal baru" | **Tombol besar selebar layar** "Tempel sinyal baru" (tempel tetap jalan lewat Ctrl+V/tekan lama); setelah terbaca → layar review seperti sekarang |
| Daftar sinyal | Kartu penuh 9 blok, semua terbuka | **Kartu ringkas** default: ticker + tag, skor, tiga angka besar (Entry · SL · TP), nilai beli + lot, satu badge status. Tap kartu → **detail** (range bar, TP1/TP2/TP3, MM, umur sinyal, alasan lot dibatasi, chart TradingView) |
| Angka uang di daftar | `Rp8.333.333` | Bentuk ringkas `Rp8,33 jt` di daftar, angka penuh hanya di detail |
| Aksi | copy, skip, hapus, TV tersebar sebagai tombol kecil | Aksi utama 2 tombol (Catat order, Copy) + menu `⋯` untuk TradingView/Skip/Hapus; Hapus dipisah dengan warna `--danger` |

### Tab Rekapan

| Bagian | Usulan |
|---|---|
| Ringkasan atas | Total untung/rugi bersih (sudah ada) dijadikan angka besar + jumlah posisi berjalan |
| Posisi berjalan | Kartu sama seperti Sinyal: entry, SL/TP, harga live, tombol "Tutup posisi" dan "Konfirmasi fill" |
| Sudah terjual | Tetap dilipat (sudah bagus); ditambah garis waktu singkat (tanggal masuk → keluar, berapa hari) yang sekarang sudah ada di dalam kartu |

### Tab Watchlist

| Bagian | Usulan |
|---|---|
| Daftar | Tetap seperti sekarang (sudah ringkas), ditambah kolom **MM** yang sekarang cuma tampil sebagai baris teks |
| Filter | Tetap; chip filter dirapikan agar muat satu baris |

### Berlaku di semua layar

- Target sentuh minimal **44px**, jarak antar tombol minimal 8px.
- Pesan error/gagal simpan muncul **di tempat aksi** (bukan hanya di atas halaman).
- Saat memuat: teks "Memuat..." diganti kerangka kartu (skeleton) sederhana supaya tata letak tidak melompat.
- Tema terang & gelap harus sama-sama diuji untuk tiap perubahan.

## 4. Rencana 3 langkah kecil (tiap langkah bisa dinilai sendiri)

| Langkah | Isi | Risiko | Bisa dibatalkan? |
|---|---|---|---|
| **1. Pecah kartu jadi komponen** | Pindahkan 259 baris kartu dari `pages/index.js` ke `components/SignalCard.js` + `SignalCardDetail.js`. **Tampilan tidak berubah sama sekali** | Rendah — tidak ada perubahan visual, hanya pindah berkas | Ya, `git checkout` berkas |
| **2. Kartu ringkas + buka-tutup** | Kartu ringkas sebagai default, detail dibuka dengan tap, format angka ringkas, aksi dipindah ke menu `⋯` | Sedang — perubahan visual besar, tapi hanya di satu komponen | Ya, kembali ke Langkah 1 |
| **3. Samakan Rekapan + Watchlist, rapikan CSS** | Ringkasan & kartu diseragamkan, kelas CSS tak terpakai dibuang, target sentuh 44px dibereskan | Sedang | Ya |

Setelah tiap langkah: `npx jest` (sekarang 105 tes) + `npx next build`, lalu Anda lihat sendiri di browser sebelum lanjut.

## 5. Yang perlu keputusan pemilik

| # | Pertanyaan |
|---|---|
| 1 | Tetap **3 tab**, atau tambah tab baru (mis. Statistik/Riwayat)? |
| 2 | Kartu ringkas lalu tap untuk detail — setuju, atau semua detail tetap terlihat? |
| 3 | Format ringkas `Rp8,33 jt` di daftar — setuju, atau tetap angka penuh? |
| 4 | Hapus/Skip: dipindah ke menu `⋯`, atau tetap terlihat langsung? |
| 5 | Warna aksen: tetap emas (gelap) / tosca (terang), atau mau diganti? |

## 6. Sengaja TIDAK diusulkan di tahap ini

- Pindah basis data (Tahap 4) — tunggu keputusan Sheets vs database.
- Fitur baru (mis. Bandarmology yang pernah dihapus) — rombak tampilan dulu.
- Notifikasi/pengingat, mode offline — perlu keputusan terpisah.

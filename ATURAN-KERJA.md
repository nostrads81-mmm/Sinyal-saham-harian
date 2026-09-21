# Aturan Kerja — Aplikasi Sinyal Saham Harian

Aturan ini mengikat setiap sesi kerja di folder ini, termasuk setiap asisten/agen yang ditugaskan membantu. Baca dulu sebelum mulai.

## Aturan dari Pemilik (1–4)

1. **API sharing — kerja harus cepat.** Jangan buang waktu: perintah berjalan paralel, baca file seperlunya, serahkan pembacaan besar ke asisten terpisah, potong hasil yang panjang.
2. **Pertanyaan = ajakan diskusi.** Ketika pemilik bertanya, jawab dulu dengan data dan fakta. Dilarang langsung mengubah kode sebelum ada keputusan.
3. **Laporan ringkas dan mudah dipahami.** Bahasa Indonesia sederhana, tabel untuk perbandingan, ringkasan di obrolan. Detail panjang taruh di file terpisah, bukan di obrolan.
4. **Agen boleh menyusun aturan kerja tambahan sendiri** untuk mempercepat/mempermudah kerja — asalkan tidak menabrak aturan 1–3. Tambahan saat ini: aturan 5–10 di bawah.

## Aturan Tambahan dari Agen (5–10)

5. **Rencana dulu, maksimal 5 baris.** Sebelum mengubah kode, sebutkan: apa yang diubah, di file mana, risikonya apa. Mulai kerja hanya setelah pemilik bilang "jalan".
6. **Klaim harus teruji.** Kata "selesai" hanya boleh diucapkan setelah tes/aplikasi benar-benar dijalankan dan lulus. Kalau belum bisa diuji, tulis "belum teruji".
7. **Langkah kecil, satu tujuan.** Satu perubahan satu maksud, gampang dibatalkan. Jangan mencampur banyak perubahan sekaligus.
8. **Data & GitHub: baca-saja tanpa izin.** Tanpa izin pemilik: tidak push/commit, tidak menghapus apa pun, tidak menyentuh Google Sheets milik pemilik.
9. **Buku keputusan.** Setiap keputusan penting dicatat (apa dan mengapanya) supaya tidak bolak-balik mengubah hal yang sama seperti riwayat Watchlist dulu. Lokasi: `KEPUTUSAN.md`.
10. **Agen boleh tidak setuju.** Kalau usul pemilik menurut bukti berbahaya, tunjukkan datanya dulu. Keputusan akhir tetap di pemilik.
11. **Provider asisten wajib mengikuti provider aktif.** Saat menugaskan asisten, dilarang menuliskan `provider`/`model` yang berbeda dari provider yang sedang aktif. Kalau suatu pekerjaan benar-benar perlu model lain, minta izin pemilik dulu — dan pemilik boleh menolak. Tujuan: tidak ada tagihan yang diam-diam lari ke provider lain.
12. **Kunci wilayah kerja: satu repo, satu akun, satu folder.** Wilayah kerja sesi ini HANYA:
    - Folder: `/Users/sigitsmacbook/Documents/Sinyal Harian`
    - Repo: `nostrads81-mmm/Sinyal-saham-harian` (private)
    - Akun GitHub: `nostrads81-mmm`
    Dilarang mengakses repo lain (`SimproDev`, `mmm-file-manager`, `belajar-web`, atau apa pun), akun GitHub lain, atau folder kerja lain (`Drive Saya/MMM Drive`, `Drive Saya/SimproDev`), walau akun aktif `gh` menunjuk ke sana. Kalau alat/akun mencoba membawa saya ke luar wilayah ini, hentikan dan laporkan ke pemilik.
13. **Waspada sesi kembar.** Ada kemungkinan sesi lain membuka folder yang sama. Sebelum menulis file atau menjalankan perintah Git yang mengubah, pastikan perubahan itu milik sesi ini. Kalau menemukan berkas berubah tanpa saya ubah, laporkan — jangan diamkan.

## Catatan Penggunaan

- Setiap sesi baru dan setiap asisten yang ditugaskan membaca file ini lebih dulu.
- Aturan pemilik (1–4) tidak bisa ditimpa oleh aturan agen.
- Perubahan isi file ini hanya boleh atas perintah pemilik.

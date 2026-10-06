# 🎟️ Sistem Penjualan Tiket Sekolah & Verifikasi Otomatis

Aplikasi Web Dashboard dan Otomasi WhatsApp untuk penjualan tiket kegiatan sekolah (Pentas Seni, Bazar, Workshop, dll.) yang terintegrasi langsung dengan **Google Form** dan **Google Sheets**.

---

## 🌟 Fitur Utama

1. **Otomasi WhatsApp Tanda Terima (Receipt)**:
   - Setiap ada pembeli yang mengisi Google Form, mereka akan menerima pesan WhatsApp tanda terima secara otomatis.
   - Pesan berisi: **Nomor Order Unik**, Kategori & Jumlah Tiket, Total Tagihan (Rp), Petunjuk Transfer Bank, serta Rekening Panitia.
   - Mendukung WhatsApp Gateway populer Indonesia (**Fonnte** & **Wablas**) serta fitur fallback **Direct WhatsApp Web Link** (100% gratis tanpa gateway).

2. **Dashboard Verifikasi Panitia**:
   - Menampilkan daftar semua pembeli tiket secara real-time.
   - Filter cepat: *Menunggu Verifikasi*, *Lunas*, dan *Ditolak*.
   - Preview foto bukti transfer m-banking langsung di layar (dengan zoom & link Google Drive).
   - **Verifikasi 1-Klik**: Sekali klik *Lunas*, status langsung terupdate dan sistem otomatis memicu pengiriman **E-Tiket resmi ber-QR Code** via WhatsApp ke nomor pembeli!
   - Fitur Tolak Bukti Transfer jika nominal tidak cocok atau buram dengan alasan otomatis ke pembeli.

3. **E-Tiket Digital & QR Code**:
   - Halaman E-Tiket publik responsif yang dapat diakses pembeli lewat link di WhatsApp mereka.
   - Dilengkapi QR Code beresolusi tinggi dan tombol *Cetak / Simpan PDF*.

4. **Gate Check-in Scanner (Hari-H Acara)**:
   - Panel khusus untuk panitia di pintu masuk acara.
   - Memasukkan kode tiket atau memindai QR Code untuk validasi kehadiran.
   - Mencegah tiket ganda / kecurangan (sistem memberi peringatan jika tiket sudah pernah digunakan).

5. **Input Manual / OTS (On The Spot)**:
   - Form untuk panitia memasukkan pembeli yang membeli tiket secara offline / tunai di sekolah.

6. **Export Data & Pengaturan**:
   - Download seluruh data penjualan tiket dalam format **CSV / Excel**.
   - Pengaturan fleksibel: Nama Acara, Rekening Bank, Template Pesan WhatsApp, dan API Gateway.

---

## 🚀 Cara Menjalankan Aplikasi

### 1. Masuk ke direktori proyek
```bash
cd "C:\Users\USER\.gemini\antigravity\scratch\school-ticket-dashboard"
```

### 2. Jalankan Server
```bash
npm start
```
Atau mode pengembangan (auto-reload):
```bash
npm run dev
```

### 3. Buka Dashboard di Browser
Akses: **[http://localhost:3000](http://localhost:3000)**

---

## 📋 Langkah Menghubungkan dengan Google Form

Panduan lengkap langkah demi langkah tersedia di:
- **[google-apps-script/PANDUAN_SETUP.md](file:///C:/Users/USER/.gemini/antigravity/scratch/school-ticket-dashboard/google-apps-script/PANDUAN_SETUP.md)**
- Tab **Pengaturan & Integrasi Form** langsung di dalam Dashboard Web.

Secara ringkas:
1. Buat Google Form dengan pertanyaan: Nama Lengkap, Nomor WhatsApp, Kelas/Instansi, Kategori Tiket, Jumlah, dan Upload Bukti Transfer.
2. Tautkan form ke Google Sheets.
3. Buka **Ekstensi > Apps Script** di Google Sheets tersebut.
4. Salin kode dari file `google-apps-script/Code.gs` dan paste ke Apps Script.
5. Pasang pemicu (Trigger) jenis **Saat mengirim formulir (On form submit)** untuk fungsi `onFormSubmit`.

Selesai! Setiap ada respon baru di form, tanda terima WhatsApp langsung terkirim dan data akan otomatis muncul di Dashboard panitia.

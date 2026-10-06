# 📖 Panduan Lengkap: Integrasi Google Form, WhatsApp Receipt, & Dashboard Tiket Sekolah

Panduan ini menjelaskan langkah-langkah praktis untuk menghubungkan:
1. **Google Form** (Data Pembeli & Upload Bukti Transfer)
2. **Google Sheets & Google Apps Script** (Pengolah data otomatis)
3. **WhatsApp Gateway** (Kirim Tanda Terima / E-Tiket otomatis)
4. **Dashboard Web App** (Panel verifikasi pembayaran dan check-in)

---

## 🎯 Langkah 1: Siapkan Google Form Penjualan Tiket

Buat formulir baru di [Google Forms](https://forms.google.com) dengan pertanyaan berikut:

| No | Judul Pertanyaan | Jenis Pertanyaan | Catatan |
|---|---|---|---|
| 1 | **Nama Lengkap** | Jawaban Singkat | Wajib diisi |
| 2 | **Nomor WhatsApp** | Jawaban Singkat | Wajib diisi. Beri deskripsi: *Cth: 081234567890* |
| 3 | **Kelas / Asal Instansi** | Jawaban Singkat | Cth: Kelas X-MIPA 1, Alumni, Umum |
| 4 | **Email** | Jawaban Singkat | Opsional |
| 5 | **Kategori Tiket** | Pilihan Ganda | Pilihan: *Presale (Rp20.000)*, *Reguler (Rp25.000)*, *VIP (Rp50.000)* |
| 6 | **Jumlah Tiket** | Jawaban Singkat | Beri validasi hanya angka |
| 7 | **Metode Transfer** | Pilihan Ganda | Cth: Transfer BCA, Transfer Mandiri, QRIS / DANA |
| 8 | **Upload Bukti Transfer** | Upload File | Izinkan file gambar (JPG/PNG). File tersimpan di Google Drive |
| 9 | **Catatan Tambahan** | Paragraf | Opsional |

---

## 📊 Langkah 2: Hubungkan Google Form ke Google Sheets

1. Pada Google Form Anda, buka tab **Jawaban (Responses)**.
2. Klik ikon hijau **Tautkan ke Spreadsheet (Link to Sheets)**.
3. Pilih *Buat spreadsheet baru* lalu klik **Buat**.
4. Spreadsheet baru akan terbuka dan otomatis merekam setiap respon form.

---

## ⚡ Langkah 3: Pasang Google Apps Script

1. Di Google Sheets tersebut, klik menu atas: **Ekstensi &rarr; Apps Script** *(Extensions &rarr; Apps Script)*.
2. Hapus semua baris teks default di editor kode `Code.gs`.
3. Buka file `google-apps-script/Code.gs` dari folder proyek ini, lalu **Copy & Paste** seluruh kodenya ke editor Apps Script.
4. Sesuaikan konfigurasi di bagian atas script:
   - `EVENT_NAME`: Nama kegiatan sekolah Anda (cth: *"PENTAS SENI SISWA 2026"*).
   - `SCHOOL_NAME`: Nama sekolah panitia.
   - `BANK_INFO`: Nomor rekening BCA, Mandiri, atau QRIS panitia.
   - `WA_API_TOKEN`: Masukkan Token Fonnte Anda (lihat Langkah 4).
   - `DASHBOARD_WEBHOOK_URL`: Masukkan URL Webhook Dashboard (cth: `http://localhost:3000/api/webhook/order` atau URL Ngrok/Hosting Anda).
5. Klik ikon **Simpan (Save)** (ikon disket) atau tekan `Ctrl + S`.

---

## 📲 Langkah 4: Menyiapkan WhatsApp Gateway (Fonnte / Wablas)

Agar WhatsApp tanda terima terkirim otomatis secara instan:
1. Buka [Fonnte.com](https://fonnte.com) dan buat akun (gratis kuota awal).
2. Tautkan nomor WhatsApp panitia/sekolah dengan memindai (scan) QR Code di menu **Device**.
3. Buka menu **API / Token** di Fonnte, lalu salin Token tersebut.
4. Tempelkan token tersebut pada variabel `WA_API_TOKEN` di file `Code.gs` dan di tab **Pengaturan** Dashboard Web App.

> **Tips Tanpa Biaya (100% Gratis):** Jika sekolah tidak ingin menggunakan API pihak ketiga, Dashboard Web App kami juga menyediakan fitur **Direct WhatsApp Web Link**. Panitia cukup klik 1 tombol di dashboard dan jendela WhatsApp otomatis terbuka dengan pesan tanda terima/tiket yang sudah siap terkirim tanpa mengetik ulang!

---

## ⏰ Langkah 5: Pasang Trigger Otomatis "On Form Submit"

1. Di halaman Google Apps Script, klik menu berikon jam di sebelah kiri: **Pemicu (Triggers)**.
2. Klik tombol biru di pojok kanan bawah: **+ Tambahkan Pemicu (+ Add Trigger)**.
3. Konfigurasikan pengaturannya sebagai berikut:
   - **Pilih fungsi yang akan dijalankan**: `onFormSubmit`
   - **Pilih penyebaran mana yang harus dijalankan**: `Head`
   - **Pilih sumber acara**: `Dari spreadsheet (From spreadsheet)`
   - **Pilih jenis acara**: `Saat mengirim formulir (On form submit)`
4. Klik **Simpan (Save)**.
5. Google akan meminta izin akses (Review Permissions). Klik akun Google Anda &rarr; klik *Advanced* &rarr; klik *Go to (Nama Script) (unsafe)* &rarr; klik **Allow**.

---

## 💻 Langkah 6: Menjalankan Dashboard Web App

1. Buka terminal di folder `school-ticket-dashboard`:
   ```bash
   npm start
   ```
2. Buka browser dan akses:
   ```
   http://localhost:3000
   ```
3. Dashboard siap digunakan!
   - **Data Pembeli & Verifikasi**: Mengecek foto bukti transfer dan klik *Verifikasi Lunas*.
   - **Otomasi WhatsApp**: Begitu klik *Verifikasi*, sistem otomatis memicu pengiriman E-Tiket ber-QR Code ke pembeli.
   - **Check-in Gate**: Digunakan saat hari H kegiatan untuk memvalidasi tiket masuk.

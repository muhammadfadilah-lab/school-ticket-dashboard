/**
 * ====================================================================================
 * GOOGLE APPS SCRIPT - SISTEM TIKET KEGIATAN SEKOLAH
 * Khusus Disesuaikan untuk Kolom Form Anda:
 * 1. Email
 * 2. Name
 * 3. Phone Number
 * 4. Performance Session
 * 5. Amount of Ticket Purchased
 * 6. Have you transferred?
 * 7. Sender's Account Name
 * 8. Please attach your payment receipt here :
 * ====================================================================================
 */

// ==========================================
// 1. KONFIGURASI UTAMA
// ==========================================

// Masukkan URL Dashboard Online Anda (Gunakan URL Tunnel aktif atau domain hosting):
const DASHBOARD_WEBHOOK_URL = "https://nice-mugs-return.loca.lt/api/webhook/order";

// Gateway WhatsApp: "fonnte" (rekomendasi Indonesia) atau "wablas"
const WA_GATEWAY = "fonnte";

// Token API WhatsApp (Dapatkan gratis dari https://fonnte.com)
// Jika diisi, tanda terima WhatsApp akan langsung terkirim otomatis detik itu juga!
const WA_API_TOKEN = "PASTE_TOKEN_FONNTE_ANDA_DI_SINI";

// Informasi Acara & Rekening Bank Panitia Sekolah
const EVENT_NAME = "Drama Musikal & Pentas Budaya 2026 - SMP Regina Pacis Jakarta";
const SCHOOL_NAME = "SMP Regina Pacis Jakarta";
const CONTACT_PERSON = "Panitia Tiket SMP Regina Pacis";

// Informasi Rekening Transfer Bank Sekolah
const BANK_INFO = 
  "• Bank BCA     : 0678025685 (a.n. Muhammad Fadilah)";

// Harga per tiket resmi: Rp 75.000
const DEFAULT_TICKET_PRICE = 75000; 

// Pilihan harga berdasarkan Performance Session
const SESSION_PRICES = {
  "Session 1": 75000,
  "Session 2": 75000
};

// ==========================================
// 2. TRIGGER UTAMA (ON FORM SUBMIT)
// ==========================================
function onFormSubmit(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();

    // 1. Ekstrak data dari event submission (namedValues atau pembacaan baris)
    let email = "";
    let name = "";
    let phoneNumber = "";
    let performanceSession = "";
    let amountPurchased = 1;
    let haveTransferred = "";
    let senderAccountName = "";
    let receiptUrl = "";

    if (e && e.namedValues) {
      // Menggunakan namedValues (paling presisi berdasarkan nama kolom form)
      email = getVal(e.namedValues, ["Email", "email"]);
      name = getVal(e.namedValues, ["Name", "name", "Nama", "Nama Lengkap"]);
      phoneNumber = getVal(e.namedValues, ["Phone Number", "phone number", "Nomor WhatsApp", "Phone", "No WA"]);
      performanceSession = getVal(e.namedValues, ["Performance Session", "performance session", "Session"]);
      amountPurchased = parseInt(getVal(e.namedValues, ["Amount of Ticket Purchased", "amount of ticket purchased", "Jumlah Tiket", "Amount"]) || "1", 10) || 1;
      haveTransferred = getVal(e.namedValues, ["Have you transferred?", "have you transferred?", "Sudah transfer?"]);
      senderAccountName = getVal(e.namedValues, ["Sender's Account Name", "sender's account name", "Nama Rekening Pengirim"]);
      receiptUrl = getVal(e.namedValues, ["Please attach your payment receipt here :", "Please attach your payment receipt here", "Bukti Transfer", "Receipt"]);
    } else {
      // Fallback jika ditest manual dari Apps Script
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const rowValues = sheet.getRange(lastRow, 1, 1, lastCol).getValues()[0];
      const rowData = {};
      headers.forEach((h, idx) => { rowData[h.toString().trim()] = rowValues[idx]; });

      email = rowData["Email"] || "";
      name = rowData["Name"] || "";
      phoneNumber = rowData["Phone Number"] || "";
      performanceSession = rowData["Performance Session"] || "";
      amountPurchased = parseInt(rowData["Amount of Ticket Purchased"] || "1", 10) || 1;
      haveTransferred = rowData["Have you transferred?"] || "";
      senderAccountName = rowData["Sender's Account Name"] || "";
      receiptUrl = rowData["Please attach your payment receipt here :"] || "";
    }

    Logger.log("Data Pembeli: " + name + " | WA: " + phoneNumber + " | Qty: " + amountPurchased);

    if (!name || !phoneNumber) {
      Logger.log("Peringatan: Name atau Phone Number tidak ditemukan!");
      return;
    }

    // 2. Normalisasi nomor telepon ke format internasional (08xxx -> 628xxx)
    const cleanPhone = normalizePhone(phoneNumber);

    // 3. Hitung harga dan total tagihan
    const unitPrice = SESSION_PRICES[performanceSession] || DEFAULT_TICKET_PRICE;
    const totalAmount = unitPrice * amountPurchased;

    // 4. Generate Order ID Unik (contoh: TIX-4821)
    const orderId = "TIX-" + Math.floor(1000 + Math.random() * 9000);

    // 5. Tulis balik Kode Tiket & Status Verifikasi ke Google Sheets (kolom otomatis dibuat jika belum ada)
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    writeCol(sheet, lastRow, headers, "KODE TIKET (ORDER ID)", orderId);
    writeCol(sheet, lastRow, headers, "TOTAL TAGIHAN (RP)", totalAmount);
    writeCol(sheet, lastRow, headers, "STATUS VERIFIKASI", "Menunggu Verifikasi");
    writeCol(sheet, lastRow, headers, "STATUS WHATSAPP", "Pending");

    // 6. KIRIM TANDA TERIMA WHATSAPP KE PEMBELI
    if (WA_API_TOKEN && WA_API_TOKEN !== "PASTE_TOKEN_FONNTE_ANDA_DI_SINI") {
      const receiptMsg = buildReceiptText({
        orderId: orderId,
        name: name,
        session: performanceSession,
        qty: amountPurchased,
        totalAmount: totalAmount,
        senderAccountName: senderAccountName,
        haveTransferred: haveTransferred
      });

      const waSuccess = sendWA(cleanPhone, receiptMsg);
      if (waSuccess) {
        writeCol(sheet, lastRow, headers, "STATUS WHATSAPP", "Terkirim Otomatis");
      }
    }

    // 7. KIRIM DATA KE DASHBOARD WEB APP (WEBHOOK)
    if (DASHBOARD_WEBHOOK_URL) {
      try {
        const payload = {
          order_id: orderId,
          name: name,
          phone: cleanPhone,
          email: email,
          performance_session: performanceSession,
          ticket_category: performanceSession || "Reguler",
          ticket_qty: amountPurchased,
          ticket_price: unitPrice,
          total_amount: totalAmount,
          sender_account_name: senderAccountName,
          has_transferred: haveTransferred,
          payment_method: senderAccountName ? ("Transfer a.n. " + senderAccountName) : "Transfer Bank",
          payment_proof_url: receiptUrl,
          source: "google_form"
        };

        const res = UrlFetchApp.fetch(DASHBOARD_WEBHOOK_URL, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });

        Logger.log("Dashboard response: " + res.getContentText());
      } catch (webhookErr) {
        Logger.log("Catatan: Webhook ke dashboard lokal mungkin belum aktif/di-forward: " + webhookErr.toString());
      }
    }

  } catch (err) {
    Logger.log("Error onFormSubmit: " + err.toString());
  }
}

// ==========================================
// 3. FORMAT PESAN TANDA TERIMA WHATSAPP
// ==========================================
function buildReceiptText(data) {
  const formattedTotal = Utilities.formatString("%,d", data.totalAmount).replace(/,/g, ".");
  
  let text = 
    "🎟️ *TANDA TERIMA PEMESANAN TIKET* 🎟️\n" +
    "*" + EVENT_NAME + "*\n" +
    SCHOOL_NAME + "\n" +
    "----------------------------------------\n" +
    "Halo Kak *" + data.name + "*! Formulir pemesanan tiket Anda telah kami terima.\n\n" +
    "📋 *RINCIAN PEMESANAN:*\n" +
    "• No. Pesanan    : *" + data.orderId + "*\n" +
    "• Sesi Acara     : *" + (data.session || "-") + "*\n" +
    "• Jumlah Tiket   : " + data.qty + " Tiket\n" +
    "• Total Tagihan  : *Rp " + formattedTotal + "*\n" +
    (data.senderAccountName ? ("• Rek. Pengirim  : " + data.senderAccountName + "\n") : "") +
    "• Status Saat Ini: ⏳ *Menunggu Verifikasi Bank*\n\n" +
    "🏦 *REKENING TRANSFER BANK RESMI:*\n" +
    BANK_INFO + "\n\n" +
    "📌 *CATATAN PENTING:*\n" +
    "1. Pastikan nominal transfer tepat Rp " + formattedTotal + ".\n" +
    "2. Jika Anda sudah mengunggah bukti transfer pada form, panitia akan segera mencocokkan mutasi rekening bank.\n" +
    "3. *E-Tiket resmi dengan QR Code unik* akan otomatis dikirimkan ke WhatsApp ini segera setelah pembayaran Anda diverifikasi oleh panitia.\n\n" +
    "Pertanyaan atau konfirmasi manual? Hubungi: " + CONTACT_PERSON + "\n" +
    "_Pesan tanda terima otomatis dari Sistem Tiket Sekolah._";

  return text;
}

// ==========================================
// 4. PENGIRIMAN API WHATSAPP (FONNTE / WABLAS)
// ==========================================
function sendWA(phone, message) {
  try {
    if (WA_GATEWAY === "fonnte") {
      const options = {
        method: "post",
        headers: { "Authorization": WA_API_TOKEN },
        contentType: "application/json",
        payload: JSON.stringify({
          target: phone,
          message: message,
          countryCode: "62"
        }),
        muteHttpExceptions: true
      };
      const res = UrlFetchApp.fetch("https://api.fonnte.com/send", options);
      Logger.log("Fonnte WA Response: " + res.getContentText());
      return true;
    } else if (WA_GATEWAY === "wablas") {
      const options = {
        method: "post",
        headers: { "Authorization": WA_API_TOKEN },
        contentType: "application/json",
        payload: JSON.stringify({
          phone: phone,
          message: message
        }),
        muteHttpExceptions: true
      };
      const res = UrlFetchApp.fetch("https://sby.wablas.com/api/send-message", options);
      Logger.log("Wablas WA Response: " + res.getContentText());
      return true;
    }
  } catch (e) {
    Logger.log("Gagal kirim WA API: " + e.toString());
    return false;
  }
}

// ==========================================
// 5. HELPER UTILITIES
// ==========================================
function normalizePhone(num) {
  let clean = num.toString().replace(/[^0-9]/g, "");
  if (clean.indexOf("0") === 0) {
    clean = "62" + clean.substring(1);
  } else if (clean.indexOf("8") === 0) {
    clean = "62" + clean;
  }
  return clean;
}

function getVal(namedValues, possibleNames) {
  for (let i = 0; i < possibleNames.length; i++) {
    const key = possibleNames[i];
    if (namedValues[key] && namedValues[key].length > 0) {
      return namedValues[key][0].toString().trim();
    }
  }
  return "";
}

function writeCol(sheet, row, headers, colName, val) {
  let idx = headers.indexOf(colName) + 1;
  if (idx === 0) {
    idx = sheet.getLastColumn() + 1;
    sheet.getRange(1, idx).setValue(colName);
    headers.push(colName);
  }
  sheet.getRange(row, idx).setValue(val);
}

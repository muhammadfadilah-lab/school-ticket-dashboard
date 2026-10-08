const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Render Persistent Disk or local data directory
const dbDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'tickets.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance and reliability
db.pragma('journal_mode = WAL');

// Read file config if exists
function loadFileConfig() {
  const cfgPath = path.join(__dirname, 'config', 'settings.json');
  if (fs.existsSync(cfgPath)) {
    try {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      console.warn('Warning reading config/settings.json:', e.message);
    }
  }
  return {};
}

// Persist all current settings to config/settings.json
function persistSettingsToFile() {
  try {
    const current = getSettings();
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'settings.json'), JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning writing config/settings.json:', err.message);
  }
}

// Initialize Tables
function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT,
      institution TEXT,
      ticket_category TEXT DEFAULT 'Reguler',
      ticket_qty INTEGER DEFAULT 1,
      ticket_price INTEGER DEFAULT 75000,
      total_amount INTEGER DEFAULT 75000,
      payment_method TEXT DEFAULT 'Transfer Bank',
      payment_proof_url TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending', -- 'pending', 'verified', 'rejected'
      rejection_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      verified_at DATETIME,
      verified_by TEXT,
      checked_in INTEGER DEFAULT 0,
      checked_in_at DATETIME,
      wa_receipt_sent INTEGER DEFAULT 0,
      wa_ticket_sent INTEGER DEFAULT 0,
      raw_source TEXT DEFAULT 'google_form'
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(phone);
  `);

  // Column migration for specific form fields
  const columns = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!columns.includes('performance_session')) {
    db.exec(`ALTER TABLE orders ADD COLUMN performance_session TEXT;`);
  }
  if (!columns.includes('sender_account_name')) {
    db.exec(`ALTER TABLE orders ADD COLUMN sender_account_name TEXT;`);
  }
  if (!columns.includes('has_transferred')) {
    db.exec(`ALTER TABLE orders ADD COLUMN has_transferred TEXT;`);
  }

  const fileCfg = loadFileConfig();

  // Baseline Persistent Settings (Environment Variables > config/settings.json > Defaults)
  const defaultSettings = [
    {
      key: 'event_name',
      value: process.env.EVENT_NAME || fileCfg.event_name || 'PENTAS SENI & KREATIVITAS SISWA 2026'
    },
    {
      key: 'school_name',
      value: process.env.SCHOOL_NAME || fileCfg.school_name || 'SMA / SMK Negeri 1 Jakarta'
    },
    {
      key: 'event_date',
      value: process.env.EVENT_DATE || fileCfg.event_date || 'Sabtu, 24 Oktober 2026'
    },
    {
      key: 'event_time',
      value: process.env.EVENT_TIME || fileCfg.event_time || '08:00 - 16:00 WIB'
    },
    {
      key: 'event_location',
      value: process.env.EVENT_LOCATION || fileCfg.event_location || 'Aula Utama & Lapangan Sekolah'
    },
    {
      key: 'contact_person',
      value: process.env.CONTACT_PERSON || fileCfg.contact_person || '081234567890 (Kak Panitia)'
    },
    {
      key: 'bank_accounts',
      value: process.env.BANK_ACCOUNTS || (fileCfg.bank_accounts ? JSON.stringify(fileCfg.bank_accounts) : JSON.stringify([
        { bank: 'BCA', number: '1234567890', holder: 'BENDAHARA OSIS' },
        { bank: 'Mandiri', number: '9876543210', holder: 'PANITIA KEGIATAN' },
        { bank: 'DANA / QRIS', number: '081234567890', holder: 'KAS KEGIATAN' }
      ]))
    },
    {
      key: 'ticket_prices',
      value: JSON.stringify(fileCfg.ticket_prices || {
        'Default': 75000,
        'Presale': 75000,
        'Reguler': 75000
      })
    },
    {
      key: 'ticket_price',
      value: String(process.env.TICKET_PRICE || fileCfg.ticket_price || 75000)
    },
    {
      key: 'wa_gateway_type',
      value: process.env.WA_GATEWAY_TYPE || fileCfg.wa_gateway_type || 'fonnte'
    },
    {
      key: 'wa_api_token',
      value: process.env.WA_API_TOKEN || fileCfg.wa_api_token || ''
    },
    {
      key: 'google_sheet_url',
      value: process.env.GOOGLE_SHEET_URL || fileCfg.google_sheet_url || 'https://docs.google.com/spreadsheets/d/1yfkuGbePDKFCV3Zxsx6aaJiMzYEGzyPaG7cqC-xUIWQ/edit?usp=sharing'
    },
    {
      key: 'auto_sync_enabled',
      value: String(fileCfg.auto_sync_enabled !== false)
    },
    {
      key: 'template_receipt',
      value: fileCfg.template_receipt || `🎟️ *TANDA TERIMA PEMESANAN TIKET* 🎟️\n*{{event_name}}*\n{{school_name}}\n----------------------------------------\nHalo Kak *{{name}}*! Terima kasih telah memesan tiket kegiatan kami.\n\n📋 *RINCIAN PESANAN:*\n• No. Pesanan : *{{order_id}}*\n• Sesi Acara  : {{performance_session}}\n• Jumlah      : {{ticket_qty}} Tiket\n• Total Bayar : *Rp {{total_amount}}*\n• Status      : ⏳ *Menunggu Verifikasi Bank*\n\n🏦 *REKENING TRANSFER BANK:*\n{{bank_list}}\n\n📌 *PETUNJUK:*\n1. Pastikan Anda telah mentransfer sesuai nominal tepat.\n2. Jika sudah mengunggah bukti transfer pada form, mohon tunggu panitia memverifikasi mutasi bank.\n3. *E-Tiket resmi ber-QR Code* akan dikirim otomatis ke WhatsApp ini segera setelah pembayaran diverifikasi.\n\nButuh bantuan? Hubungi panitia: {{contact_person}}\n_Pesan otomatis sistem tiket sekolah._`
    },
    {
      key: 'template_verified',
      value: fileCfg.template_verified || `🎉 *PEMBAYARAN TERVERIFIKASI - E-TIKET RESMI* 🎉\n*{{event_name}}*\n----------------------------------------\nHalo Kak *{{name}}*,\nPembayaran tiket Anda telah *DISETUJUI & LUNAS* oleh panitia!\n\n🎟️ *DATA E-TIKET ANDA:*\n• No. Tiket    : *{{order_id}}*\n• Sesi Acara   : {{performance_session}}\n• Jumlah Tiket : {{ticket_qty}} Pax\n• Status       : ✅ *LUNAS (VERIFIED)*\n\n📅 *JADWAL KEGIATAN:*\n• Waktu  : {{event_date}} ({{event_time}})\n• Tempat : {{event_location}}\n\n📲 *LINK E-TIKET DIGITAL DENGAN QR CODE:*\n{{ticket_url}}\n\n⚠️ *PENTING:*\n• Tunjukkan QR Code pada link di atas ke panitia gate/pintu masuk.\n• 1 QR Code berlaku untuk {{ticket_qty}} orang sesuai kuota pesanan.\n• Jangan bagikan link e-tiket Anda kepada orang lain.\n\nSampai jumpa di acara! 🥳`
    },
    {
      key: 'template_rejected',
      value: fileCfg.template_rejected || `⚠️ *PEMBERITAHUAN VERIFIKASI TIKET* ⚠️\n*{{event_name}}*\n----------------------------------------\nHalo Kak *{{name}}*,\nMohon maaf, bukti pembayaran untuk pesanan *{{order_id}}* belum dapat kami verifikasi karena:\n\n👉 *Alasan:* {{reason}}\n\nSilakan kirim ulang bukti transfer yang jelas dan valid dengan membalas pesan WhatsApp ini atau menghubungi panitia: {{contact_person}}.\n\nTerima kasih!`
    }
  ];

  // Insert or update settings
  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE settings.value IS NULL OR settings.value = ''
  `);

  const runMany = db.transaction((items) => {
    for (const item of items) insertSetting.run(item);
  });

  runMany(defaultSettings);

  // If google_sheet_url in DB is empty, forcefully seed it
  const currentSheet = db.prepare("SELECT value FROM settings WHERE key = 'google_sheet_url'").get();
  if (!currentSheet || !currentSheet.value || currentSheet.value === '') {
    const fallbackSheet = process.env.GOOGLE_SHEET_URL || fileCfg.google_sheet_url || 'https://docs.google.com/spreadsheets/d/1yfkuGbePDKFCV3Zxsx6aaJiMzYEGzyPaG7cqC-xUIWQ/edit?usp=sharing';
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)").run(fallbackSheet);
  }
}

// Helpers
function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

function updateSetting(key, value) {
  const valStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, valStr);
  persistSettingsToFile();
}

module.exports = {
  db,
  initDatabase,
  getSettings,
  updateSetting,
  persistSettingsToFile
};

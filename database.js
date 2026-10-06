const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'tickets.db');
const db = new Database(dbPath);

// Enable WAL mode for high performance and reliability
db.pragma('journal_mode = WAL');

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
      ticket_price INTEGER DEFAULT 25000,
      total_amount INTEGER DEFAULT 25000,
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

  // Default settings
  const defaultSettings = [
    { key: 'event_name', value: 'PENTAS SENI & KREATIVITAS SISWA 2026' },
    { key: 'school_name', value: 'SMA / SMK Negeri 1 Jakarta' },
    { key: 'event_date', value: 'Sabtu, 24 Oktober 2026' },
    { key: 'event_time', value: '08:00 - 16:00 WIB' },
    { key: 'event_location', value: 'Aula Utama & Lapangan Sekolah' },
    { key: 'contact_person', value: '081234567890 (Kak Panitia)' },
    {
      key: 'bank_accounts',
      value: JSON.stringify([
        { bank: 'BCA', number: '1234567890', holder: 'BENDAHARA OSIS' },
        { bank: 'Mandiri', number: '9876543210', holder: 'PANITIA KEGIATAN' },
        { bank: 'DANA / QRIS', number: '081234567890', holder: 'KAS KEGIATAN' }
      ])
    },
    {
      key: 'ticket_prices',
      value: JSON.stringify({
        'Presale': 20000,
        'Reguler': 25000,
        'VIP': 50000
      })
    },
    { key: 'wa_gateway_type', value: 'fonnte' }, // 'fonnte', 'wablas', 'direct'
    { key: 'wa_api_token', value: '' }, // Fonnte / Wablas API Token
    {
      key: 'template_receipt',
      value: `🎟️ *TANDA TERIMA PEMESANAN TIKET* 🎟️\n*{{event_name}}*\n{{school_name}}\n----------------------------------------\nHalo Kak *{{name}}*! Terima kasih telah memesan tiket kegiatan kami.\n\n📋 *RINCIAN PESANAN:*\n• No. Pesanan : *{{order_id}}*\n• Kategori    : {{ticket_category}}\n• Jumlah      : {{ticket_qty}} Tiket\n• Total Bayar : *Rp {{total_amount}}*\n• Status      : ⏳ *Menunggu Verifikasi Bank*\n\n🏦 *REKENING TRANSFER BANK:*\n{{bank_list}}\n\n📌 *PETUNJUK:*\n1. Pastikan Anda telah mentransfer sesuai nominal tepat.\n2. Jika sudah mengunggah bukti transfer pada form, mohon tunggu panitia memverifikasi mutasi bank.\n3. *E-Tiket resmi ber-QR Code* akan dikirim otomatis ke WhatsApp ini segera setelah pembayaran diverifikasi.\n\nButuh bantuan? Hubungi panitia: {{contact_person}}\n_Pesan otomatis sistem tiket sekolah._`
    },
    {
      key: 'template_verified',
      value: `🎉 *PEMBAYARAN TERVERIFIKASI - E-TIKET RESMI* 🎉\n*{{event_name}}*\n----------------------------------------\nHalo Kak *{{name}}*,\nPembayaran tiket Anda telah *DISETUJUI & LUNAS* oleh panitia!\n\n🎟️ *DATA E-TIKET ANDA:*\n• No. Tiket    : *{{order_id}}*\n• Kategori     : {{ticket_category}}\n• Jumlah Tiket : {{ticket_qty}} Pax\n• Status       : ✅ *LUNAS (VERIFIED)*\n\n📅 *JADWAL KEGIATAN:*\n• Waktu  : {{event_date}} ({{event_time}})\n• Tempat : {{event_location}}\n\n📲 *LINK E-TIKET DIGITAL DENGAN QR CODE:*\n{{ticket_url}}\n\n⚠️ *PENTING:*\n• Tunjukkan QR Code pada link di atas ke panitia gate/pintu masuk.\n• 1 QR Code berlaku untuk {{ticket_qty}} orang sesuai kuota pesanan.\n• Jangan bagikan link e-tiket Anda kepada orang lain.\n\nSampai jumpa di acara! 🥳`
    },
    {
      key: 'template_rejected',
      value: `⚠️ *PEMBERITAHUAN VERIFIKASI TIKET* ⚠️\n*{{event_name}}*\n----------------------------------------\nHalo Kak *{{name}}*,\nMohon maaf, bukti pembayaran untuk pesanan *{{order_id}}* belum dapat kami verifikasi karena:\n\n👉 *Alasan:* {{reason}}\n\nSilakan kirim ulang bukti transfer yang jelas dan valid dengan membalas pesan WhatsApp ini atau menghubungi panitia: {{contact_person}}.\n\nTerima kasih!`
    }
  ];

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (@key, @value)
  `);

  const runMany = db.transaction((items) => {
    for (const item of items) insertSetting.run(item);
  });

  runMany(defaultSettings);

  // Add dummy sample orders if empty for testing
  const count = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
  if (count === 0) {
    const insertOrder = db.prepare(`
      INSERT INTO orders (
        order_id, name, phone, email, institution, ticket_category,
        ticket_qty, ticket_price, total_amount, payment_method,
        payment_proof_url, notes, status, created_at, wa_receipt_sent
      ) VALUES (
        @order_id, @name, @phone, @email, @institution, @ticket_category,
        @ticket_qty, @ticket_price, @total_amount, @payment_method,
        @payment_proof_url, @notes, @status, @created_at, @wa_receipt_sent
      )
    `);

    const sampleOrders = [
      {
        order_id: 'TIX-1001',
        name: 'Ahmad Fauzi',
        phone: '081234567890',
        email: 'ahmad.fauzi@gmail.com',
        institution: 'Kelas XII MIPA 1',
        ticket_category: 'Reguler',
        ticket_qty: 2,
        ticket_price: 25000,
        total_amount: 50000,
        payment_method: 'BCA Transfer',
        payment_proof_url: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop',
        notes: 'Sudah transfer tadi pagi jam 09.00',
        status: 'pending',
        created_at: new Date(Date.now() - 3600000 * 3).toISOString(),
        wa_receipt_sent: 1
      },
      {
        order_id: 'TIX-1002',
        name: 'Siti Nurhaliza',
        phone: '085712345678',
        email: 'sitinur@gmail.com',
        institution: 'Kelas XI IPS 2',
        ticket_category: 'VIP',
        ticket_qty: 1,
        ticket_price: 50000,
        total_amount: 50000,
        payment_method: 'Mandiri Transfer',
        payment_proof_url: 'https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=600&auto=format&fit=crop',
        notes: 'Transfer via Livin Mandiri',
        status: 'verified',
        created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        wa_receipt_sent: 1
      },
      {
        order_id: 'TIX-1003',
        name: 'Budi Santoso',
        phone: '089612345678',
        email: 'budi.santoso@yahoo.com',
        institution: 'Umum / Alumni 2024',
        ticket_category: 'Presale',
        ticket_qty: 3,
        ticket_price: 20000,
        total_amount: 60000,
        payment_method: 'DANA / QRIS',
        payment_proof_url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&auto=format&fit=crop',
        notes: '',
        status: 'pending',
        created_at: new Date(Date.now() - 3600000 * 1).toISOString(),
        wa_receipt_sent: 1
      }
    ];

    const runSample = db.transaction((orders) => {
      for (const order of orders) insertOrder.run(order);
    });
    runSample(sampleOrders);
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
}

module.exports = {
  db,
  initDatabase,
  getSettings,
  updateSetting
};

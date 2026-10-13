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

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_code TEXT UNIQUE NOT NULL,
      type TEXT NOT NULL DEFAULT 'parent',
      name TEXT NOT NULL,
      class_grade TEXT,
      session TEXT NOT NULL,
      original_session TEXT NOT NULL,
      ticket_qty INTEGER NOT NULL DEFAULT 2,
      is_swapped INTEGER DEFAULT 0,
      swap_notes TEXT,
      institution TEXT,
      phone TEXT,
      checked_in INTEGER DEFAULT 0,
      checked_in_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_invitations_type ON invitations(type);
    CREATE INDEX IF NOT EXISTS idx_invitations_session ON invitations(session);
    CREATE INDEX IF NOT EXISTS idx_invitations_class ON invitations(class_grade);
    CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(invitation_code);

    CREATE TABLE IF NOT EXISTS deleted_orders (
      order_id TEXT PRIMARY KEY,
      phone TEXT,
      name TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checkins_log (
      code TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      checked_in_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS parent_swaps (
      invitation_code TEXT PRIMARY KEY,
      session TEXT NOT NULL,
      ticket_qty INTEGER NOT NULL DEFAULT 2,
      swap_notes TEXT,
      phone TEXT,
      is_swapped INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
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

  // Normalize any legacy DD/MM/YYYY dates stored in orders table
  try {
    const rawDateOrders = db.prepare("SELECT id, created_at FROM orders WHERE created_at LIKE '%/%'").all();
    const updateDateStmt = db.prepare("UPDATE orders SET created_at = ? WHERE id = ?");
    for (const row of rawDateOrders) {
      const match = String(row.created_at).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
      if (match) {
        const day = match[1].padStart(2, '0');
        const month = match[2].padStart(2, '0');
        const year = match[3];
        const h = (match[4] || '00').padStart(2, '0');
        const m = (match[5] || '00').padStart(2, '0');
        const s = (match[6] || '00').padStart(2, '0');
        updateDateStmt.run(`${year}-${month}-${day} ${h}:${m}:${s}`, row.id);
      }
    }
  } catch (errDate) {}

  const fileCfg = loadFileConfig();

  // Baseline Persistent Settings (Environment Variables > config/settings.json > Defaults)
  const defaultSettings = [
    {
      key: 'event_name',
      value: process.env.EVENT_NAME || fileCfg.event_name || 'Drama Musikal & Pentas Budaya 2026 - SMP Regina Pacis Jakarta'
    },
    {
      key: 'school_name',
      value: process.env.SCHOOL_NAME || fileCfg.school_name || 'SMP Regina Pacis Jakarta'
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
      value: process.env.EVENT_LOCATION || fileCfg.event_location || 'Auditorium Regina Pacis Jakarta'
    },
    {
      key: 'contact_person',
      value: process.env.CONTACT_PERSON || fileCfg.contact_person || 'Panitia Tiket SMP Regina Pacis'
    },
    {
      key: 'bank_accounts',
      value: process.env.BANK_ACCOUNTS || (fileCfg.bank_accounts ? JSON.stringify(fileCfg.bank_accounts) : JSON.stringify([
        { bank: 'BCA', number: '0678025685', holder: 'Muhammad Fadilah' }
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
    },
    {
      key: 'capacity_session_1',
      value: String(process.env.CAPACITY_SESSION_1 || fileCfg.capacity_session_1 || 350)
    },
    {
      key: 'capacity_session_2',
      value: String(process.env.CAPACITY_SESSION_2 || fileCfg.capacity_session_2 || 350)
    }
  ];

  // Insert settings if missing or empty
  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (@key, @value)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE settings.value IS NULL OR settings.value = ''
  `);

  const runMany = db.transaction((items) => {
    for (const item of items) insertSetting.run(item);
  });
  runMany(defaultSettings);

  // If environment variables are explicitly defined in Render, they ALWAYS take absolute priority!
  const envKeys = [
    { key: 'google_sheet_url', env: process.env.GOOGLE_SHEET_URL },
    { key: 'event_name', env: process.env.EVENT_NAME },
    { key: 'school_name', env: process.env.SCHOOL_NAME },
    { key: 'event_date', env: process.env.EVENT_DATE },
    { key: 'event_time', env: process.env.EVENT_TIME },
    { key: 'event_location', env: process.env.EVENT_LOCATION },
    { key: 'contact_person', env: process.env.CONTACT_PERSON },
    { key: 'ticket_price', env: process.env.TICKET_PRICE },
    { key: 'wa_gateway_type', env: process.env.WA_GATEWAY_TYPE },
    { key: 'wa_api_token', env: process.env.WA_API_TOKEN },
    { key: 'bank_accounts', env: process.env.BANK_ACCOUNTS },
    { key: 'capacity_session_1', env: process.env.CAPACITY_SESSION_1 },
    { key: 'capacity_session_2', env: process.env.CAPACITY_SESSION_2 }
  ];

  for (const item of envKeys) {
    if (item.env && String(item.env).trim() !== '') {
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(item.key, String(item.env).trim());
    }
  }

  // Force seed google_sheet_url if somehow empty
  const currentSheet = db.prepare("SELECT value FROM settings WHERE key = 'google_sheet_url'").get();
  if (!currentSheet || !currentSheet.value || currentSheet.value === '') {
    const fallbackSheet = process.env.GOOGLE_SHEET_URL || fileCfg.google_sheet_url || 'https://docs.google.com/spreadsheets/d/1yfkuGbePDKFCV3Zxsx6aaJiMzYEGzyPaG7cqC-xUIWQ/edit?usp=sharing';
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('google_sheet_url', ?)").run(fallbackSheet);
  }

  // Seed invitations (parents & guests) if empty
  const countInvitations = db.prepare('SELECT COUNT(*) as count FROM invitations').get().count;
  if (countInvitations === 0) {
    const customPath = path.join(__dirname, 'config', 'invitations_custom.json');
    const studentsPath = path.join(__dirname, 'config', 'students_data.json');
    
    let seedItems = [];
    if (fs.existsSync(customPath)) {
      try {
        seedItems = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      } catch (e) {
        console.warn('Error reading config/invitations_custom.json:', e.message);
      }
    }
    if ((!seedItems || seedItems.length === 0) && fs.existsSync(studentsPath)) {
      try {
        seedItems = JSON.parse(fs.readFileSync(studentsPath, 'utf8'));
      } catch (e) {
        console.warn('Error reading config/students_data.json:', e.message);
      }
    }

    if (seedItems && seedItems.length > 0) {
      const insertInv = db.prepare(`
        INSERT INTO invitations (
          invitation_code, type, name, class_grade, session, original_session,
          ticket_qty, is_swapped, swap_notes, institution, phone, checked_in, checked_in_at
        ) VALUES (
          @invitation_code, @type, @name, @class_grade, @session, @original_session,
          @ticket_qty, @is_swapped, @swap_notes, @institution, @phone, @checked_in, @checked_in_at
        )
      `);
      const insertMany = db.transaction((rows) => {
        for (const item of rows) {
          insertInv.run({
            invitation_code: item.invitation_code,
            type: item.type || 'parent',
            name: item.name || item.student_name || 'Tanpa Nama',
            class_grade: item.class_grade || null,
            session: item.session || 'Sesi 1',
            original_session: item.original_session || item.session || 'Sesi 1',
            ticket_qty: item.ticket_qty !== undefined ? item.ticket_qty : 2,
            is_swapped: item.is_swapped ? 1 : 0,
            swap_notes: item.swap_notes || '',
            institution: item.institution || '',
            phone: item.phone || '',
            checked_in: item.checked_in ? 1 : 0,
            checked_in_at: item.checked_in_at || null
          });
        }
      });
      insertMany(seedItems);
      console.log(`Seeded ${seedItems.length} invitations into database`);
    }
  }
  // 1. Rehydrate deleted orders from config/deleted_orders.json
  const deletedPath = path.join(__dirname, 'config', 'deleted_orders.json');
  if (fs.existsSync(deletedPath)) {
    try {
      const deletedList = JSON.parse(fs.readFileSync(deletedPath, 'utf8'));
      if (Array.isArray(deletedList)) {
        const insDel = db.prepare(`
          INSERT INTO deleted_orders (order_id, phone, name, deleted_at)
          VALUES (@order_id, @phone, @name, COALESCE(@deleted_at, CURRENT_TIMESTAMP))
          ON CONFLICT(order_id) DO NOTHING
        `);
        const delOrder = db.prepare('DELETE FROM orders WHERE order_id = ?');
        for (const item of deletedList) {
          const row = typeof item === 'string' ? { order_id: item, phone: null, name: null, deleted_at: null } : item;
          if (row.order_id) {
            insDel.run(row);
            delOrder.run(row.order_id);
          }
        }
      }
    } catch (e) {
      console.warn('Error reading config/deleted_orders.json:', e.message);
    }
  }

  // 2. Rehydrate parent swaps from config/parent_swaps.json or config/invitations_custom.json
  const swapsPath = path.join(__dirname, 'config', 'parent_swaps.json');
  if (fs.existsSync(swapsPath)) {
    try {
      const swapsObj = JSON.parse(fs.readFileSync(swapsPath, 'utf8'));
      const updateSwap = db.prepare(`
        UPDATE invitations
        SET session = ?, ticket_qty = ?, swap_notes = ?, phone = ?, is_swapped = 1, updated_at = CURRENT_TIMESTAMP
        WHERE invitation_code = ?
      `);
      const insSwap = db.prepare(`
        INSERT INTO parent_swaps (invitation_code, session, ticket_qty, swap_notes, phone, is_swapped, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(invitation_code) DO UPDATE SET session=excluded.session, ticket_qty=excluded.ticket_qty, swap_notes=excluded.swap_notes, phone=excluded.phone, is_swapped=1
      `);
      for (const [code, sw] of Object.entries(swapsObj)) {
        updateSwap.run(sw.session, sw.ticket_qty || 2, sw.swap_notes || '', sw.phone || '', code);
        insSwap.run(code, sw.session, sw.ticket_qty || 2, sw.swap_notes || '', sw.phone || '');
      }
    } catch (e) {
      console.warn('Error reading config/parent_swaps.json:', e.message);
    }
  } else {
    // Check if invitations_custom.json has swapped entries
    const customPath = path.join(__dirname, 'config', 'invitations_custom.json');
    if (fs.existsSync(customPath)) {
      try {
        const customRows = JSON.parse(fs.readFileSync(customPath, 'utf8'));
        const updateSwap = db.prepare(`
          UPDATE invitations
          SET session = ?, ticket_qty = ?, swap_notes = ?, phone = ?, is_swapped = ?, updated_at = CURRENT_TIMESTAMP
          WHERE invitation_code = ?
        `);
        for (const r of customRows) {
          if (r.is_swapped || r.session !== r.original_session || (r.ticket_qty !== undefined && r.ticket_qty !== 2)) {
            updateSwap.run(r.session, r.ticket_qty !== undefined ? r.ticket_qty : 2, r.swap_notes || '', r.phone || '', r.is_swapped ? 1 : 0, r.invitation_code);
          }
        }
      } catch (e) {}
    }
  }

  // 3. Rehydrate checkins from config/checkins_log.json
  const checkinsPath = path.join(__dirname, 'config', 'checkins_log.json');
  if (fs.existsSync(checkinsPath)) {
    try {
      const checkinsObj = JSON.parse(fs.readFileSync(checkinsPath, 'utf8'));
      const insCheck = db.prepare(`
        INSERT INTO checkins_log (code, type, checked_in_at)
        VALUES (?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET checked_in_at=excluded.checked_in_at
      `);
      const updInv = db.prepare('UPDATE invitations SET checked_in = 1, checked_in_at = ? WHERE invitation_code = ?');
      const updOrd = db.prepare('UPDATE orders SET checked_in = 1, checked_in_at = ? WHERE order_id = ?');
      for (const [code, val] of Object.entries(checkinsObj)) {
        const time = val.checked_in_at || new Date().toISOString();
        insCheck.run(code, val.type || 'unknown', time);
        updInv.run(time, code);
        updOrd.run(time, code);
      }
    } catch (e) {
      console.warn('Error reading config/checkins_log.json:', e.message);
    }
  }

  // 4. Rehydrate order verified & checkin statuses from config/orders_cache.json
  const cachePath = path.join(__dirname, 'config', 'orders_cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      const cacheObj = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const updStatus = db.prepare("UPDATE orders SET status = 'verified' WHERE order_id = ? AND status != 'verified'");
      const updCheck = db.prepare("UPDATE orders SET checked_in = 1, checked_in_at = COALESCE(checked_in_at, ?) WHERE order_id = ? AND checked_in = 0");
      for (const entry of Object.values(cacheObj)) {
        if (entry.order_id) {
          if (entry.status === 'verified') updStatus.run(entry.order_id);
          if (entry.checked_in === 1) updCheck.run(entry.checked_in_at || new Date().toISOString(), entry.order_id);
        }
      }
    } catch (e) {}
  }
}

// Persist all current invitations to config/invitations_custom.json
function persistInvitationsToFile() {
  try {
    const rows = db.prepare('SELECT * FROM invitations ORDER BY id ASC').all();
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'invitations_custom.json'), JSON.stringify(rows, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning writing config/invitations_custom.json:', err.message);
  }
}

// Persist deleted orders to config/deleted_orders.json
function persistDeletedOrdersToFile() {
  try {
    const rows = db.prepare('SELECT * FROM deleted_orders ORDER BY deleted_at DESC').all();
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'deleted_orders.json'), JSON.stringify(rows, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning writing config/deleted_orders.json:', err.message);
  }
}

// Persist parent swaps to config/parent_swaps.json
function persistParentSwapsToFile() {
  try {
    const rows = db.prepare('SELECT * FROM parent_swaps WHERE is_swapped = 1').all();
    const map = {};
    for (const r of rows) {
      map[r.invitation_code] = {
        session: r.session,
        ticket_qty: r.ticket_qty,
        swap_notes: r.swap_notes,
        phone: r.phone,
        is_swapped: r.is_swapped,
        updated_at: r.updated_at
      };
    }
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'parent_swaps.json'), JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning writing config/parent_swaps.json:', err.message);
  }
}

// Persist checkins log to config/checkins_log.json
function persistCheckinsLogToFile() {
  try {
    const rows = db.prepare('SELECT * FROM checkins_log').all();
    const map = {};
    for (const r of rows) {
      map[r.code] = {
        code: r.code,
        type: r.type,
        checked_in_at: r.checked_in_at
      };
    }
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'checkins_log.json'), JSON.stringify(map, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning writing config/checkins_log.json:', err.message);
  }
}

// Get Authoritative Server Vault State
function getVaultState() {
  const deleted_orders = db.prepare('SELECT order_id, phone, name, deleted_at FROM deleted_orders').all();
  const parent_swaps = {};
  const swappedRows = db.prepare('SELECT * FROM invitations WHERE is_swapped = 1').all();
  for (const r of swappedRows) {
    parent_swaps[r.invitation_code] = {
      session: r.session,
      ticket_qty: r.ticket_qty,
      swap_notes: r.swap_notes || '',
      phone: r.phone || '',
      is_swapped: 1,
      updated_at: r.updated_at
    };
  }
  const checkins = {};
  const checkinRows = db.prepare('SELECT * FROM checkins_log').all();
  for (const c of checkinRows) {
    checkins[c.code] = {
      code: c.code,
      type: c.type,
      checked_in_at: c.checked_in_at
    };
  }
  const verified_orders = db.prepare("SELECT order_id FROM orders WHERE status = 'verified'").all().map(o => o.order_id);

  return {
    deleted_orders,
    parent_swaps,
    checkins,
    verified_orders
  };
}

// Apply Vault Sync from Client Browser
function applyVaultSync(vault) {
  if (!vault || typeof vault !== 'object') return getVaultState();

  // 1. Process Deleted Orders
  if (Array.isArray(vault.deleted_orders)) {
    const insDel = db.prepare(`
      INSERT INTO deleted_orders (order_id, phone, name, deleted_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(order_id) DO NOTHING
    `);
    const delOrd = db.prepare('DELETE FROM orders WHERE order_id = ?');
    for (const item of vault.deleted_orders) {
      const orderId = typeof item === 'string' ? item : (item && item.order_id);
      if (orderId) {
        insDel.run(orderId, (item && item.phone) || null, (item && item.name) || null);
        delOrd.run(orderId);
      }
    }
    persistDeletedOrdersToFile();
  }

  // 2. Process Parent Swaps
  if (vault.parent_swaps && typeof vault.parent_swaps === 'object') {
    const updInv = db.prepare(`
      UPDATE invitations
      SET session = ?, ticket_qty = ?, swap_notes = ?, phone = ?, is_swapped = 1, updated_at = CURRENT_TIMESTAMP
      WHERE invitation_code = ?
    `);
    const insSwap = db.prepare(`
      INSERT INTO parent_swaps (invitation_code, session, ticket_qty, swap_notes, phone, is_swapped, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(invitation_code) DO UPDATE SET session=excluded.session, ticket_qty=excluded.ticket_qty, swap_notes=excluded.swap_notes, phone=excluded.phone, is_swapped=1
    `);
    for (const [code, sw] of Object.entries(vault.parent_swaps)) {
      if (code && sw && sw.session) {
        updInv.run(sw.session, sw.ticket_qty || 2, sw.swap_notes || '', sw.phone || '', code);
        insSwap.run(code, sw.session, sw.ticket_qty || 2, sw.swap_notes || '', sw.phone || '');
      }
    }
    persistParentSwapsToFile();
    persistInvitationsToFile();
  }

  // 3. Process Check-ins
  if (vault.checkins && typeof vault.checkins === 'object') {
    const insCheck = db.prepare(`
      INSERT INTO checkins_log (code, type, checked_in_at)
      VALUES (?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET checked_in_at=excluded.checked_in_at
    `);
    const updInv = db.prepare('UPDATE invitations SET checked_in = 1, checked_in_at = ? WHERE invitation_code = ?');
    const updOrd = db.prepare('UPDATE orders SET checked_in = 1, checked_in_at = ? WHERE order_id = ?');
    for (const [code, val] of Object.entries(vault.checkins)) {
      if (code) {
        const time = (val && val.checked_in_at) || new Date().toISOString();
        const type = (val && val.type) || 'unknown';
        insCheck.run(code, type, time);
        updInv.run(time, code);
        updOrd.run(time, code);
      }
    }
    persistCheckinsLogToFile();
  }

  // 4. Process Verified Orders
  if (Array.isArray(vault.verified_orders)) {
    const updVer = db.prepare("UPDATE orders SET status = 'verified' WHERE order_id = ? AND status != 'verified'");
    for (const ordId of vault.verified_orders) {
      if (ordId) updVer.run(ordId);
    }
  }

  return getVaultState();
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
  persistSettingsToFile,
  persistInvitationsToFile,
  persistDeletedOrdersToFile,
  persistParentSwapsToFile,
  persistCheckinsLogToFile,
  getVaultState,
  applyVaultSync
};

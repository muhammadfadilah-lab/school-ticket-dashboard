const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');
const { db, getSettings, updateSetting } = require('./database');
const { formatIndonesianPhone, buildReceiptMessage, sendWhatsAppMessage } = require('./whatsappService');

/**
 * Load persistent orders cache from disk
 */
function loadOrdersCache() {
  const cachePath = path.join(__dirname, 'config', 'orders_cache.json');
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      console.warn('Warning reading config/orders_cache.json:', e.message);
    }
  }
  return {};
}

/**
 * Save persistent orders cache to disk
 */
function saveOrdersCache(cache) {
  try {
    const cfgDir = path.join(__dirname, 'config');
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(path.join(cfgDir, 'orders_cache.json'), JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.warn('Warning saving config/orders_cache.json:', e.message);
  }
}

/**
 * Generate stable, deterministic order ID from phone and name with optional salt
 */
function generateDeterministicOrderId(phone, name, salt = '') {
  const seed = `${phone || ''}_${(name || '').trim().toLowerCase()}${salt ? '_' + salt : ''}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const codeNum = Math.abs(hash) % 9000 + 1000;
  return `TIX-${codeNum}`;
}

/**
 * Get existing order ID or generate a guaranteed non-colliding order ID
 */
function getOrGenerateUniqueOrderId(db, ordersCache, sheetOrderId, phone, name) {
  if (sheetOrderId && sheetOrderId.trim()) {
    return sheetOrderId.trim();
  }

  const cleanName = (name || '').trim();
  const cleanPhone = phone || '';
  const cacheKey = `${cleanPhone}_${cleanName}`;

  if (ordersCache[cacheKey] && ordersCache[cacheKey].order_id) {
    const cachedId = ordersCache[cacheKey].order_id;
    // Check if another order with different identity in DB holds this ID
    const conflicting = db.prepare(`
      SELECT id FROM orders 
      WHERE order_id = ? AND NOT (phone = ? AND lower(trim(name)) = lower(trim(?)))
    `).get(cachedId, cleanPhone, cleanName);
    if (!conflicting) {
      return cachedId;
    }
  }

  let saltIndex = 0;
  while (true) {
    const salt = saltIndex === 0 ? '' : `salt${saltIndex}`;
    const candidate = generateDeterministicOrderId(cleanPhone, cleanName, salt);

    // Verify candidate does NOT conflict in DB for a different person
    const dbConflict = db.prepare(`
      SELECT id FROM orders 
      WHERE order_id = ? AND NOT (phone = ? AND lower(trim(name)) = lower(trim(?)))
    `).get(candidate, cleanPhone, cleanName);

    // Verify candidate does NOT conflict in cache for a different person
    let cacheConflict = false;
    for (const [k, v] of Object.entries(ordersCache)) {
      if (k !== cacheKey && v && v.order_id === candidate) {
        cacheConflict = true;
        break;
      }
    }

    if (!dbConflict && !cacheConflict) {
      return candidate;
    }
    saltIndex++;
  }
}

/**
 * Normalize DD/MM/YYYY or various date formats from Google Forms into standard SQLite YYYY-MM-DD HH:mm:ss
 */
function normalizeDateToSqlite(str) {
  if (!str) return new Date().toISOString().replace('T', ' ').substring(0, 19);
  str = String(str).trim();

  // DD/MM/YYYY or DD-MM-YYYY with optional HH:mm:ss or HH.mm.ss
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const hours = (dmyMatch[4] || '00').padStart(2, '0');
    const minutes = (dmyMatch[5] || '00').padStart(2, '0');
    const seconds = (dmyMatch[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  // Already YYYY-MM-DD...
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    const hours = (ymdMatch[4] || '00').padStart(2, '0');
    const minutes = (ymdMatch[5] || '00').padStart(2, '0');
    const seconds = (ymdMatch[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toISOString().replace('T', ' ').substring(0, 19);
  }
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Extract Google Spreadsheet ID from URL
 */
function extractSpreadsheetId(url) {
  if (!url) return null;
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match) return match[1];
  // If user passed ID directly
  if (/^[a-zA-Z0-9-_]{20,}$/.test(url.trim())) return url.trim();
  return null;
}

/**
 * Fetch and sync data directly from Google Sheets
 */
async function syncFromGoogleSheet(sheetUrlOrId, options = {}) {
  const spreadsheetId = extractSpreadsheetId(sheetUrlOrId);
  if (!spreadsheetId) {
    throw new Error('Link Google Spreadsheet tidak valid. Pastikan link memiliki format https://docs.google.com/spreadsheets/d/...');
  }

  // Save the URL to settings for future auto-sync
  updateSetting('google_sheet_url', sheetUrlOrId);

  // Google Sheet CSV Export URLs
  const urls = [
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`,
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv`
  ];

  let csvText = null;
  let lastErr = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (res.ok) {
        csvText = await res.text();
        if (csvText && csvText.trim().length > 0 && !csvText.includes('<!DOCTYPE html>')) {
          break;
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!csvText || csvText.includes('<!DOCTYPE html>') || csvText.includes('ServiceLogin')) {
    throw new Error(
      'Gagal membaca Google Spreadsheet. Pastikan Spreadsheet Anda sudah diatur agar bisa diakses:\n' +
      'Buka Google Spreadsheet > Klik tombol "Bagikan" (Share) di kanan atas > ' +
      'Ubah akses umum menjadi "Siapa saja yang memiliki link dapat melihat" (Anyone with link can view).'
    );
  }

  // Parse CSV
  let records = [];
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
  } catch (parseErr) {
    throw new Error('Gagal memproses data CSV Google Sheet: ' + parseErr.message);
  }

  const settings = getSettings();
  const ordersCache = loadOrdersCache();
  let newCount = 0;
  let updatedCount = 0;

  const insertOrder = db.prepare(`
    INSERT INTO orders (
      order_id, name, phone, email, institution, ticket_category,
      performance_session, sender_account_name, has_transferred,
      ticket_qty, ticket_price, total_amount, payment_method,
      payment_proof_url, notes, status, checked_in, checked_in_at, created_at, raw_source
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google_sheet_sync')
  `);

  const updateOrder = db.prepare(`
    UPDATE orders 
    SET name = ?,
        phone = ?,
        email = COALESCE(NULLIF(?, ''), email),
        payment_proof_url = COALESCE(NULLIF(?, ''), payment_proof_url),
        sender_account_name = COALESCE(NULLIF(?, ''), sender_account_name),
        has_transferred = COALESCE(NULLIF(?, ''), has_transferred),
        performance_session = COALESCE(NULLIF(?, ''), performance_session),
        ticket_category = COALESCE(NULLIF(?, ''), ticket_category),
        ticket_qty = ?,
        ticket_price = ?,
        total_amount = ?
    WHERE id = ?
  `);

  for (const row of records) {
    // Normalisasi kunci kolom
    const data = {};
    for (const [k, v] of Object.entries(row)) {
      data[k.trim()] = (v || '').trim();
    }

    // Ekstrak kolom utama berdasarkan form user
    const name = data['Name'] || data['Nama'] || data['Nama Lengkap'] || '';
    if (!name) continue;

    const rawPhone = data['Phone Number'] || data['Nomor WhatsApp'] || data['Phone'] || data['No WA'] || '';
    const phone = rawPhone ? formatIndonesianPhone(rawPhone) : '';
    const email = data['Email'] || data['Email Address'] || data['Alamat Email'] || '';
    const performance_session = data['Performance Session'] || data['Session'] || '';
    const ticket_category = performance_session || 'Reguler';
    const ticket_qty = parseInt(data['Amount of Ticket Purchased'] || data['Jumlah Tiket'] || '1', 10) || 1;
    const have_transferred = data['Have you transferred?'] || data['Sudah transfer?'] || '';
    const sender_account_name = data["Sender's Account Name"] || data['Nama Rekening Pengirim'] || '';
    const payment_proof_url = data['Please attach your payment receipt here :'] || data['Please attach your payment receipt here'] || data['Bukti Transfer'] || '';
    const rawTimestamp = data['Timestamp'] || data['Waktu'] || '';
    const timestampStr = normalizeDateToSqlite(rawTimestamp);

    const sheetOrderId = (data['KODE TIKET (ORDER ID)'] || data['Kode Tiket'] || data['Order ID'] || '').trim();

    // 1. Cari apakah data ini sudah ada sebelumnya di database
    let existing = null;
    if (sheetOrderId) {
      existing = db.prepare('SELECT id, order_id, status, ticket_price, checked_in, checked_in_at, payment_proof_url, email, name, phone FROM orders WHERE order_id = ?').get(sheetOrderId);
    }
    if (!existing && phone) {
      existing = db.prepare('SELECT id, order_id, status, ticket_price, checked_in, checked_in_at, payment_proof_url, email, name, phone FROM orders WHERE phone = ? AND lower(trim(name)) = lower(trim(?))').get(phone, name);
    }
    if (!existing && !phone) {
      existing = db.prepare('SELECT id, order_id, status, ticket_price, checked_in, checked_in_at, payment_proof_url, email, name, phone FROM orders WHERE lower(trim(name)) = lower(trim(?))').get(name);
    }

    // Tentukan order_id yang valid & bebas tabrakan (collision-free)
    let order_id = '';
    if (sheetOrderId) {
      order_id = sheetOrderId;
    } else if (existing) {
      order_id = existing.order_id;
    } else {
      order_id = getOrGenerateUniqueOrderId(db, ordersCache, '', phone, name);
    }

    const cacheKey = `${phone}_${name.trim()}`;

    // CEK APAKAH TRANSAKSI INI PERNAH DIHAPUS (TOMBSTONE DELETED)
    const isDeleted = db.prepare(`
      SELECT 1 FROM deleted_orders 
      WHERE order_id = ? OR (phone != '' AND phone = ? AND lower(trim(name)) = lower(trim(?)))
    `).get(order_id, phone, name);

    if (isDeleted) {
      // Lewati transaksi ini! Jangan pernah memasukkan ulang transaksi yang sudah dihapus pengguna!
      continue;
    }

    let sheetStatus = (data['STATUS VERIFIKASI'] || data['Status'] || '').toLowerCase();
    let status = 'pending';
    if (sheetStatus.includes('lunas') || sheetStatus.includes('verified')) {
      status = 'verified';
    } else if (sheetStatus.includes('tolak') || sheetStatus.includes('reject')) {
      status = 'rejected';
    }

    // Hitung harga satuan tiket dan total nominal tagihan (berdasarkan jumlah tiket terbaru)
    let ticket_price = 75000;
    if (settings.ticket_prices && (settings.ticket_prices[ticket_category] || settings.ticket_prices['Default'])) {
      ticket_price = settings.ticket_prices[ticket_category] || settings.ticket_prices['Default'];
    } else if (settings.ticket_price) {
      ticket_price = parseInt(settings.ticket_price, 10) || 75000;
    }
    const total_amount = ticket_price * ticket_qty;

    if (existing) {
      // Update data: sinkronkan email, nama, nomor telepon, sesi, nominal, jumlah tiket, bukti bayar
      updateOrder.run(
        name,
        phone,
        email,
        payment_proof_url,
        sender_account_name,
        have_transferred,
        performance_session,
        ticket_category,
        ticket_qty,
        ticket_price,
        total_amount,
        existing.id
      );

      if (timestampStr) {
        db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(timestampStr, existing.id);
      }

      // Pertahankan status verifikasi & checkin lokal jika ada
      let finalStatus = existing.status;
      if (status === 'verified') finalStatus = 'verified';
      else if (ordersCache[cacheKey] && ordersCache[cacheKey].status === 'verified') finalStatus = 'verified';

      let finalCheckin = existing.checked_in;
      let finalCheckinAt = existing.checked_in_at;
      if (ordersCache[cacheKey] && ordersCache[cacheKey].checked_in === 1) {
        finalCheckin = 1;
        finalCheckinAt = ordersCache[cacheKey].checked_in_at || existing.checked_in_at || new Date().toISOString();
      }

      // Cek juga dari checkins_log
      const checkinRecord = db.prepare('SELECT checked_in_at FROM checkins_log WHERE code = ?').get(existing.order_id);
      if (checkinRecord) {
        finalCheckin = 1;
        finalCheckinAt = checkinRecord.checked_in_at;
      }

      db.prepare('UPDATE orders SET status = ?, checked_in = ?, checked_in_at = ? WHERE id = ?')
        .run(finalStatus, finalCheckin, finalCheckinAt, existing.id);

      updatedCount++;

      // Update cache
      ordersCache[cacheKey] = {
        order_id: existing.order_id,
        name,
        phone,
        status: finalStatus,
        checked_in: finalCheckin,
        checked_in_at: finalCheckinAt
      };
    } else {
      // Pulihkan status verified & check-in dari cache jika database baru di-reset
      let checked_in = 0;
      let checked_in_at = null;
      if (ordersCache[cacheKey]) {
        if (ordersCache[cacheKey].status === 'verified') status = 'verified';
        if (ordersCache[cacheKey].checked_in === 1) {
          checked_in = 1;
          checked_in_at = ordersCache[cacheKey].checked_in_at;
        }
      }

      // Check checkins_log table as well
      const checkinRecord = db.prepare('SELECT checked_in_at FROM checkins_log WHERE code = ?').get(order_id);
      if (checkinRecord) {
        checked_in = 1;
        checked_in_at = checkinRecord.checked_in_at;
      }

      const payment_method = sender_account_name ? `Transfer a.n. ${sender_account_name}` : 'Transfer Bank';
      const notes = sender_account_name ? `Rek. Pengirim: ${sender_account_name} | Trf: ${have_transferred}` : '';

      insertOrder.run(
        order_id, name, phone, email, performance_session, ticket_category,
        performance_session, sender_account_name, have_transferred,
        ticket_qty, ticket_price, total_amount, payment_method,
        payment_proof_url, notes, status, checked_in, checked_in_at, timestampStr
      );

      newCount++;

      // Update cache
      ordersCache[cacheKey] = {
        order_id,
        name,
        phone,
        status,
        checked_in,
        checked_in_at
      };

      // Kirim WhatsApp Receipt jika diaktifkan
      if (options.sendWaOnSync && settings.wa_api_token) {
        try {
          const newOrder = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);
          const msg = buildReceiptMessage(newOrder, settings);
          sendWhatsAppMessage({ phone, message: msg, settings });
        } catch (e) {
          console.error('Error sending WA on sync:', e);
        }
      }
    }
  }

  // Persist updated orders cache to disk
  saveOrdersCache(ordersCache);

  return {
    success: true,
    totalRecords: records.length,
    newOrders: newCount,
    updatedOrders: updatedCount
  };
}

module.exports = {
  extractSpreadsheetId,
  syncFromGoogleSheet,
  loadOrdersCache,
  saveOrdersCache,
  normalizeDateToSqlite,
  generateDeterministicOrderId,
  getOrGenerateUniqueOrderId
};

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
 * Generate stable, deterministic order ID from phone and name
 */
function generateDeterministicOrderId(phone, name) {
  const seed = `${phone || ''}_${(name || '').trim().toLowerCase()}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash |= 0;
  }
  const codeNum = Math.abs(hash) % 9000 + 1000;
  return `TIX-${codeNum}`;
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

  const updateProof = db.prepare(`
    UPDATE orders 
    SET payment_proof_url = COALESCE(NULLIF(?, ''), payment_proof_url),
        sender_account_name = COALESCE(NULLIF(?, ''), sender_account_name),
        has_transferred = COALESCE(NULLIF(?, ''), has_transferred)
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
    const rawPhone = data['Phone Number'] || data['Nomor WhatsApp'] || data['Phone'] || data['No WA'] || '';
    if (!name || !rawPhone) continue;

    const phone = formatIndonesianPhone(rawPhone);
    const email = data['Email'] || '';
    const performance_session = data['Performance Session'] || data['Session'] || '';
    const ticket_category = performance_session || 'Reguler';
    const ticket_qty = parseInt(data['Amount of Ticket Purchased'] || data['Jumlah Tiket'] || '1', 10) || 1;
    const have_transferred = data['Have you transferred?'] || data['Sudah transfer?'] || '';
    const sender_account_name = data["Sender's Account Name"] || data['Nama Rekening Pengirim'] || '';
    const payment_proof_url = data['Please attach your payment receipt here :'] || data['Please attach your payment receipt here'] || data['Bukti Transfer'] || '';
    const timestampStr = data['Timestamp'] || data['Waktu'] || new Date().toISOString();

    const cacheKey = `${phone}_${name.trim()}`;

    // Cek apakah di sheet sudah ada kolom Kode Tiket
    let order_id = data['KODE TIKET (ORDER ID)'] || data['Kode Tiket'] || data['Order ID'] || '';
    let sheetStatus = (data['STATUS VERIFIKASI'] || data['Status'] || '').toLowerCase();
    let status = 'pending';
    if (sheetStatus.includes('lunas') || sheetStatus.includes('verified')) {
      status = 'verified';
    } else if (sheetStatus.includes('tolak') || sheetStatus.includes('reject')) {
      status = 'rejected';
    }

    // Cek apakah order sudah ada di database (berdasarkan order_id atau nama + phone)
    let existing = null;
    if (order_id) {
      existing = db.prepare('SELECT id, order_id, status, checked_in, checked_in_at, payment_proof_url FROM orders WHERE order_id = ?').get(order_id);
    }
    if (!existing) {
      existing = db.prepare('SELECT id, order_id, status, checked_in, checked_in_at, payment_proof_url FROM orders WHERE phone = ? AND name = ?').get(phone, name);
    }

    if (existing) {
      // Update data jika ada bukti pembayaran baru
      updateProof.run(payment_proof_url, sender_account_name, have_transferred, existing.id);
      updatedCount++;

      // Update cache
      ordersCache[cacheKey] = {
        order_id: existing.order_id,
        name,
        phone,
        status: existing.status,
        checked_in: existing.checked_in,
        checked_in_at: existing.checked_in_at
      };
    } else {
      // Tentukan Order ID yang stabil & permanen
      if (!order_id) {
        if (ordersCache[cacheKey] && ordersCache[cacheKey].order_id) {
          order_id = ordersCache[cacheKey].order_id;
        } else {
          order_id = generateDeterministicOrderId(phone, name);
        }
      }

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

      let ticket_price = 75000;
      if (settings.ticket_prices && (settings.ticket_prices[ticket_category] || settings.ticket_prices['Default'])) {
        ticket_price = settings.ticket_prices[ticket_category] || settings.ticket_prices['Default'];
      }
      const total_amount = ticket_price * ticket_qty;
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
  saveOrdersCache
};

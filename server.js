const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const multer = require('multer');
const { db, initDatabase, getSettings, updateSetting } = require('./database');
const {
  formatIndonesianPhone,
  formatRupiah,
  buildReceiptMessage,
  buildVerifiedMessage,
  buildRejectedMessage,
  getDirectWhatsAppLink,
  sendWhatsAppMessage
} = require('./whatsappService');
const { syncFromGoogleSheet } = require('./googleSheetSync');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
initDatabase();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload directory for transfer proof images
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'proof-' + uniqueSuffix + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to generate unique order ID
function generateOrderId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `TIX-${num}`;
}

// ==========================================
// API ROUTES
// ==========================================

// 1. Dashboard Statistics
app.get('/api/stats', (req, res) => {
  try {
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
    const totalTickets = db.prepare('SELECT COALESCE(SUM(ticket_qty), 0) as count FROM orders').get().count;
    
    const pendingOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'pending'").get().count;
    const pendingTickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM orders WHERE status = 'pending'").get().count;
    
    const verifiedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'verified'").get().count;
    const verifiedTickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM orders WHERE status = 'verified'").get().count;
    const verifiedRevenue = db.prepare("SELECT COALESCE(SUM(total_amount), 0) as amount FROM orders WHERE status = 'verified'").get().amount;
    
    const rejectedOrders = db.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'rejected'").get().count;
    const checkedInCount = db.prepare("SELECT COUNT(*) as count FROM orders WHERE checked_in = 1").get().count;

    // Breakdown by category
    const categoryBreakdown = db.prepare(`
      SELECT ticket_category, COUNT(*) as orders_count, SUM(ticket_qty) as total_qty, SUM(total_amount) as total_revenue
      FROM orders
      GROUP BY ticket_category
    `).all();

    res.json({
      success: true,
      data: {
        totalOrders,
        totalTickets,
        pendingOrders,
        pendingTickets,
        verifiedOrders,
        verifiedTickets,
        verifiedRevenue,
        rejectedOrders,
        checkedInCount,
        categoryBreakdown
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Rekap Sesi Pertunjukan (Performance Session Recap)
app.get('/api/recap/sessions', (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT 
        COALESCE(NULLIF(performance_session, ''), ticket_category, 'General') as session_name,
        COUNT(*) as total_orders,
        COALESCE(SUM(ticket_qty), 0) as total_tickets,
        COALESCE(SUM(CASE WHEN status = 'verified' THEN ticket_qty ELSE 0 END), 0) as verified_tickets,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN ticket_qty ELSE 0 END), 0) as pending_tickets,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN ticket_qty ELSE 0 END), 0) as rejected_tickets,
        COALESCE(SUM(CASE WHEN status = 'verified' THEN total_amount ELSE 0 END), 0) as verified_revenue,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN total_amount ELSE 0 END), 0) as pending_revenue,
        COALESCE(SUM(CASE WHEN checked_in = 1 THEN ticket_qty ELSE 0 END), 0) as checked_in_tickets
      FROM orders
      GROUP BY session_name
      ORDER BY session_name ASC
    `).all();

    const orders = db.prepare(`
      SELECT 
        id, order_id, name, phone, email,
        COALESCE(NULLIF(performance_session, ''), ticket_category, 'General') as session_name,
        ticket_qty, total_amount, sender_account_name, has_transferred,
        status, checked_in, checked_in_at, created_at, payment_proof_url
      FROM orders
      ORDER BY session_name ASC, created_at DESC
    `).all();

    res.json({
      success: true,
      data: {
        summary,
        orders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export Rekap Sesi to CSV
app.get('/api/recap/sessions/export-csv', (req, res) => {
  try {
    const summary = db.prepare(`
      SELECT 
        COALESCE(NULLIF(performance_session, ''), ticket_category, 'General') as session_name,
        COUNT(*) as total_orders,
        COALESCE(SUM(ticket_qty), 0) as total_tickets,
        COALESCE(SUM(CASE WHEN status = 'verified' THEN ticket_qty ELSE 0 END), 0) as verified_tickets,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN ticket_qty ELSE 0 END), 0) as pending_tickets,
        COALESCE(SUM(CASE WHEN status = 'verified' THEN total_amount ELSE 0 END), 0) as verified_revenue,
        COALESCE(SUM(CASE WHEN checked_in = 1 THEN ticket_qty ELSE 0 END), 0) as checked_in_tickets
      FROM orders
      GROUP BY session_name
      ORDER BY session_name ASC
    `).all();

    const headers = [
      'Performance Session', 'Total Pesanan', 'Total Tiket (Pax)',
      'Tiket Lunas (Verified)', 'Tiket Pending', 'Total Pendapatan Lunas (Rp)',
      'Tamu Sudah Hadir (Checked-in)'
    ];

    let csvContent = '\uFEFF' + headers.join(',') + '\n';
    for (const s of summary) {
      csvContent += [
        `"${s.session_name}"`,
        s.total_orders,
        s.total_tickets,
        s.verified_tickets,
        s.pending_tickets,
        s.verified_revenue,
        s.checked_in_tickets
      ].join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rekap-sesi-pertunjukan.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Google Sheet Live Sync Endpoints
app.post('/api/sync/google-sheet', async (req, res) => {
  try {
    const { sheet_url, send_wa } = req.body;
    if (!sheet_url) {
      return res.status(400).json({ success: false, message: 'Link Google Spreadsheet wajib diisi' });
    }

    const result = await syncFromGoogleSheet(sheet_url, { sendWaOnSync: send_wa });
    res.json({
      success: true,
      message: `Sinkronisasi berhasil! ${result.newOrders} pesanan baru ditambahkan, ${result.updatedOrders} baris diperbarui.`,
      data: result
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/sync/google-sheet', (req, res) => {
  try {
    const settings = getSettings();
    res.json({
      success: true,
      data: {
        sheet_url: settings.google_sheet_url || '',
        auto_sync: true
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 2. Orders List with search & filters
app.get('/api/orders', (req, res) => {
  try {
    const { status, category, search } = req.query;
    let query = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (status && status !== 'all') {
      query += ' AND status = ?';
      params.push(status);
    }
    if (category && category !== 'all') {
      query += ' AND ticket_category = ?';
      params.push(category);
    }
    if (search) {
      query += ' AND (name LIKE ? OR phone LIKE ? OR order_id LIKE ? OR institution LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term, term);
    }

    query += ' ORDER BY created_at DESC';

    const orders = db.prepare(query).all(...params);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Single Order Detail
app.get('/api/orders/:id', (req, res) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(req.params.id, req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete Order / Hapus Transaksi
app.delete('/api/orders/:id', (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    // Hapus file bukti lokal jika ada
    if (order.payment_proof_url && order.payment_proof_url.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, 'public', order.payment_proof_url);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { console.error('Gagal hapus file bukti:', e); }
      }
    }

    db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);

    res.json({
      success: true,
      message: `Transaksi ${order.order_id} (${order.name}) berhasil dihapus`,
      deleted_id: order.id,
      order_id: order.order_id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Webhook from Google Form / Google Apps Script
// This receives data whenever a buyer submits the Google Form!
app.post('/api/webhook/order', async (req, res) => {
  try {
    const body = req.body;
    const settings = getSettings();

    // Required fields
    const name = (body.name || body.Name || body.nama || '').trim();
    let phone = (body.phone || body['Phone Number'] || body.phone_number || body.nomor_wa || body.no_wa || body.whatsapp || '').trim();
    if (!name || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name dan Phone Number wajib diisi'
      });
    }

    phone = formatIndonesianPhone(phone);
    const order_id = body.order_id || generateOrderId();
    const email = (body.email || body.Email || '').trim();
    const performance_session = (body.performance_session || body['Performance Session'] || body.session || '').trim();
    const institution = (body.institution || body.kelas || body.instansi || performance_session || '').trim();
    const ticket_category = (performance_session || body.ticket_category || body.kategori_tiket || 'Reguler').trim();
    const ticket_qty = parseInt(body.ticket_qty || body['Amount of Ticket Purchased'] || body.jumlah_tiket || 1, 10) || 1;

    // Sender details & payment confirmation from form
    const sender_account_name = (body.sender_account_name || body["Sender's Account Name"] || body.sender_name || '').trim();
    const has_transferred = (body.has_transferred || body['Have you transferred?'] || '').trim();

    // Price calculation
    let ticket_price = parseInt(body.ticket_price || 0, 10);
    if (!ticket_price && settings.ticket_prices) {
      ticket_price = settings.ticket_prices[ticket_category] || settings.ticket_prices['Default'] || 75000;
    } else if (!ticket_price) {
      ticket_price = 75000;
    }
    const total_amount = parseInt(body.total_amount || 0, 10) || (ticket_price * ticket_qty);
    const payment_method = body.payment_method || (sender_account_name ? `Transfer a.n. ${sender_account_name}` : 'Transfer Bank');
    const payment_proof_url = body.payment_proof_url || body['Please attach your payment receipt here :'] || body.bukti_transfer || body.bukti_bayar || '';
    const notes = body.notes || (sender_account_name ? `Rekening Pengirim: ${sender_account_name} | Konfirmasi: ${has_transferred}` : '');

    // Check if order_id already exists
    const existing = db.prepare('SELECT id FROM orders WHERE order_id = ?').get(order_id);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Order ID ${order_id} sudah terdaftar`
      });
    }

    // Insert order
    const insert = db.prepare(`
      INSERT INTO orders (
        order_id, name, phone, email, institution, ticket_category,
        performance_session, sender_account_name, has_transferred,
        ticket_qty, ticket_price, total_amount, payment_method,
        payment_proof_url, notes, status, created_at, raw_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, 'webhook_form')
    `);

    const result = insert.run(
      order_id, name, phone, email, institution, ticket_category,
      performance_session, sender_account_name, has_transferred,
      ticket_qty, ticket_price, total_amount, payment_method,
      payment_proof_url, notes
    );

    const createdOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(result.lastInsertRowid);

    // Send WhatsApp Receipt
    const receiptMessage = buildReceiptMessage(createdOrder, settings);
    let waResult = null;
    let waReceiptSent = 0;

    try {
      waResult = await sendWhatsAppMessage({
        phone: phone,
        message: receiptMessage,
        settings: settings
      });
      if (waResult.success) {
        waReceiptSent = 1;
        db.prepare('UPDATE orders SET wa_receipt_sent = 1 WHERE id = ?').run(createdOrder.id);
      }
    } catch (waErr) {
      console.error('Failed sending receipt WA:', waErr);
    }

    const directWaLink = getDirectWhatsAppLink(phone, receiptMessage);

    res.status(201).json({
      success: true,
      message: 'Pesanan berhasil disimpan dan WhatsApp tanda terima diproses',
      data: {
        order_id,
        name,
        phone,
        total_amount,
        wa_receipt_sent: waReceiptSent,
        wa_result: waResult,
        direct_wa_link: directWaLink
      }
    });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Verify / Approve Payment
app.post('/api/orders/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { verified_by } = req.body;
    const settings = getSettings();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    }

    const host = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const ticketUrl = `${protocol}://${host}/ticket.html?id=${order.order_id}`;

    // Update status in DB
    db.prepare(`
      UPDATE orders
      SET status = 'verified',
          verified_at = CURRENT_TIMESTAMP,
          verified_by = ?,
          rejection_reason = NULL
      WHERE id = ?
    `).run(verified_by || 'Admin Panitia', order.id);

    // Send WhatsApp E-Ticket
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const ticketMessage = buildVerifiedMessage(updatedOrder, settings, ticketUrl);

    let waResult = null;
    let waTicketSent = 0;

    try {
      waResult = await sendWhatsAppMessage({
        phone: updatedOrder.phone,
        message: ticketMessage,
        settings: settings
      });
      if (waResult.success) {
        waTicketSent = 1;
        db.prepare('UPDATE orders SET wa_ticket_sent = 1 WHERE id = ?').run(order.id);
      }
    } catch (waErr) {
      console.error('Failed sending e-ticket WA:', waErr);
    }

    const directWaLink = getDirectWhatsAppLink(updatedOrder.phone, ticketMessage);

    res.json({
      success: true,
      message: 'Pembayaran berhasil diverifikasi menjadi LUNAS',
      data: {
        order: updatedOrder,
        wa_ticket_sent: waTicketSent,
        wa_result: waResult,
        direct_wa_link: directWaLink,
        ticket_url: ticketUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Reject Payment / Invalid Proof
app.post('/api/orders/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, send_wa } = req.body;
    const settings = getSettings();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    }

    db.prepare(`
      UPDATE orders
      SET status = 'rejected',
          rejection_reason = ?
      WHERE id = ?
    `).run(reason || 'Bukti transfer tidak dapat diverifikasi atau belum masuk mutasi bank', order.id);

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    const rejectMessage = buildRejectedMessage(updatedOrder, settings, reason);

    let waResult = null;
    if (send_wa !== false) {
      try {
        waResult = await sendWhatsAppMessage({
          phone: updatedOrder.phone,
          message: rejectMessage,
          settings: settings
        });
      } catch (e) {
        console.error('Failed sending reject notification:', e);
      }
    }

    const directWaLink = getDirectWhatsAppLink(updatedOrder.phone, rejectMessage);

    res.json({
      success: true,
      message: 'Pesanan ditandai Ditolak',
      data: {
        order: updatedOrder,
        direct_wa_link: directWaLink,
        wa_result: waResult
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Resend WhatsApp / Generate Direct Link
app.post('/api/orders/:id/resend-wa', async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body; // 'receipt' or 'ticket' or 'reminder'
    const settings = getSettings();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Pesanan tidak ditemukan' });
    }

    const host = req.get('host') || `localhost:${PORT}`;
    const protocol = req.protocol || 'http';
    const ticketUrl = `${protocol}://${host}/ticket.html?id=${order.order_id}`;

    let message = '';
    if (type === 'ticket') {
      message = buildVerifiedMessage(order, settings, ticketUrl);
    } else {
      message = buildReceiptMessage(order, settings);
    }

    const directLink = getDirectWhatsAppLink(order.phone, message);

    // Try API send if configured
    let waResult = null;
    try {
      waResult = await sendWhatsAppMessage({
        phone: order.phone,
        message: message,
        settings: settings
      });
      if (waResult.success) {
        if (type === 'ticket') {
          db.prepare('UPDATE orders SET wa_ticket_sent = 1 WHERE id = ?').run(order.id);
        } else {
          db.prepare('UPDATE orders SET wa_receipt_sent = 1 WHERE id = ?').run(order.id);
        }
      }
    } catch (e) {
      console.error('Error sending WA:', e);
    }

    res.json({
      success: true,
      message: 'Pesan WhatsApp diproses',
      data: {
        direct_link: directLink,
        wa_result: waResult,
        message_text: message
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Gate Check-in Ticket (Day of Event)
app.post('/api/orders/:id/checkin', (req, res) => {
  try {
    const { id } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Kode tiket tidak ditemukan!' });
    }

    if (order.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: `Tiket belum lunas (Status: ${order.status.toUpperCase()}). Pembayaran harus diverifikasi terlebih dahulu!`
      });
    }

    if (order.checked_in === 1) {
      return res.status(409).json({
        success: false,
        already_checked_in: true,
        message: `Tiket SUDAH DIGUNAKAN sebelumnya pada ${order.checked_in_at}!`,
        data: order
      });
    }

    db.prepare(`
      UPDATE orders
      SET checked_in = 1, checked_in_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(order.id);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    res.json({
      success: true,
      message: 'Check-in BERHASIL! Selamat datang di acara.',
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. Public Ticket View & QR Code Generator
app.get('/api/tickets/public/:order_id', async (req, res) => {
  try {
    const { order_id } = req.params;
    const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);

    if (!order) {
      return res.status(404).json({ success: false, message: 'E-Tiket tidak ditemukan' });
    }

    const settings = getSettings();

    // Generate QR Code data URL containing order code
    const qrData = JSON.stringify({
      order_id: order.order_id,
      name: order.name,
      qty: order.ticket_qty,
      category: order.ticket_category,
      status: order.status
    });

    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 320,
      margin: 2,
      color: {
        dark: '#1e1b4b',
        light: '#ffffff'
      }
    });

    res.json({
      success: true,
      data: {
        order,
        settings,
        qr_code: qrCodeDataUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Manual Order Creation (OTS / Cash / Manual entry)
app.post('/api/orders/manual', upload.single('payment_proof'), async (req, res) => {
  try {
    const {
      name, phone, email, institution, ticket_category,
      ticket_qty, ticket_price, payment_method, notes, auto_verify
    } = req.body;

    const settings = getSettings();
    const cleanPhone = formatIndonesianPhone(phone);
    const order_id = generateOrderId();
    const qty = parseInt(ticket_qty || 1, 10);
    const price = parseInt(ticket_price || (settings.ticket_prices ? (settings.ticket_prices[ticket_category] || settings.ticket_prices['Default']) : 75000) || 75000, 10);
    const total = qty * price;

    let proofUrl = '';
    if (req.file) {
      proofUrl = `/uploads/${req.file.filename}`;
    }

    const status = auto_verify === 'true' || auto_verify === true ? 'verified' : 'pending';
    const verified_at = status === 'verified' ? new Date().toISOString() : null;

    db.prepare(`
      INSERT INTO orders (
        order_id, name, phone, email, institution, ticket_category,
        ticket_qty, ticket_price, total_amount, payment_method,
        payment_proof_url, notes, status, verified_at, verified_by, raw_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Admin Manual', 'manual_dashboard')
    `).run(
      order_id, name, cleanPhone, email || '', institution || '', ticket_category || 'Reguler',
      qty, price, total, payment_method || 'Tunai / Manual',
      proofUrl, notes || '', status, verified_at
    );

    const created = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(order_id);

    // Send receipt or ticket via WA
    let receiptMessage = '';
    if (status === 'verified') {
      const host = req.get('host') || `localhost:${PORT}`;
      const protocol = req.protocol || 'http';
      const ticketUrl = `${protocol}://${host}/ticket.html?id=${order_id}`;
      receiptMessage = buildVerifiedMessage(created, settings, ticketUrl);
    } else {
      receiptMessage = buildReceiptMessage(created, settings);
    }

    const directLink = getDirectWhatsAppLink(cleanPhone, receiptMessage);

    res.status(201).json({
      success: true,
      message: 'Pesanan manual berhasil dibuat',
      data: created,
      direct_wa_link: directLink
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11. Settings API
app.get('/api/settings', (req, res) => {
  try {
    const settings = getSettings();
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const updates = req.body;
    for (const [key, val] of Object.entries(updates)) {
      updateSetting(key, val);
    }
    const current = getSettings();
    res.json({ success: true, message: 'Pengaturan berhasil disimpan', data: current });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 12. Test WhatsApp connection
app.post('/api/test-wa', async (req, res) => {
  try {
    const { phone, message } = req.body;
    const settings = getSettings();

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Nomor WhatsApp wajib diisi' });
    }

    const testMsg = message || `🔔 *UJI COBA SISTEM TIKET SEKOLAH*\nHalo! Pesan ini adalah tes integrasi WhatsApp Gateway dari Dashboard Tiket ${settings.event_name}.\nWaktu: ${new Date().toLocaleString('id-ID')}`;

    const result = await sendWhatsAppMessage({
      phone,
      message: testMsg,
      settings
    });

    const directLink = getDirectWhatsAppLink(phone, testMsg);

    res.json({
      success: result.success,
      result,
      directLink,
      message: result.success ? 'Pesan berhasil dikirim via Gateway!' : 'Gagal mengirim otomatis, silakan periksa Token atau gunakan Direct Link'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 13. Export Orders to CSV
app.get('/api/orders/export-csv', (req, res) => {
  try {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created_at ASC').all();
    
    // Header
    const headers = [
      'Order ID', 'Waktu Pemesanan', 'Nama Lengkap', 'No WhatsApp', 'Email',
      'Kelas / Instansi', 'Kategori Tiket', 'Jumlah Tiket', 'Harga Tiket (Rp)',
      'Total Bayar (Rp)', 'Metode Bayar', 'Status', 'Diverifikasi Pada',
      'Diverifikasi Oleh', 'Status Masuk (Check-in)', 'Link Bukti Transfer', 'Catatan'
    ];

    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    for (const o of orders) {
      const row = [
        `"${o.order_id}"`,
        `"${o.created_at || ''}"`,
        `"${(o.name || '').replace(/"/g, '""')}"`,
        `"${o.phone || ''}"`,
        `"${o.email || ''}"`,
        `"${(o.institution || '').replace(/"/g, '""')}"`,
        `"${o.ticket_category || ''}"`,
        o.ticket_qty,
        o.ticket_price,
        o.total_amount,
        `"${o.payment_method || ''}"`,
        `"${o.status.toUpperCase()}"`,
        `"${o.verified_at || ''}"`,
        `"${o.verified_by || ''}"`,
        o.checked_in === 1 ? '"SUDAH MASUK"' : '"BELUM"',
        `"${o.payment_proof_url || ''}"`,
        `"${(o.notes || '').replace(/"/g, '""')}"`
      ];
      csvContent += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="data-tiket-sekolah.csv"');
    res.send(csvContent);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Background Auto-Sync Timer (Every 30 seconds if Google Sheet URL is configured)
setInterval(async () => {
  try {
    const settings = getSettings();
    if (settings.google_sheet_url) {
      await syncFromGoogleSheet(settings.google_sheet_url, { sendWaOnSync: false });
    }
  } catch (err) {
    // silent catch in background
  }
}, 30000);

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🎟️  SISTEM TIKET KEGIATAN SEKOLAH AKTIF!`);
  console.log(`🌐  Dashboard Web : http://localhost:${PORT}`);
  console.log(`📡  Webhook URL  : http://localhost:${PORT}/api/webhook/order`);
  console.log(`====================================================`);
});

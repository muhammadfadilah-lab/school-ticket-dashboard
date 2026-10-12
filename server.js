const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const multer = require('multer');
const { db, initDatabase, getSettings, updateSetting, persistInvitationsToFile } = require('./database');
const {
  formatIndonesianPhone,
  formatRupiah,
  buildReceiptMessage,
  buildVerifiedMessage,
  buildRejectedMessage,
  getDirectWhatsAppLink,
  sendWhatsAppMessage
} = require('./whatsappService');
const { syncFromGoogleSheet, loadOrdersCache, saveOrdersCache } = require('./googleSheetSync');

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

// ==========================================
// REKAP TOTAL KURSI & KAPASITAS AUDITORIUM
// ==========================================
app.get('/api/recap/capacity', (req, res) => {
  try {
    const settings = getSettings();
    const cap1 = parseInt(settings.capacity_session_1, 10) || 350;
    const cap2 = parseInt(settings.capacity_session_2, 10) || 350;

    // 1. Orang Tua Siswa
    const parentS1Count = db.prepare("SELECT COUNT(*) as c FROM invitations WHERE type = 'parent' AND session = 'Sesi 1'").get().c;
    const parentS1Tickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as s FROM invitations WHERE type = 'parent' AND session = 'Sesi 1'").get().s;

    const parentS2Count = db.prepare("SELECT COUNT(*) as c FROM invitations WHERE type = 'parent' AND session = 'Sesi 2'").get().c;
    const parentS2Tickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as s FROM invitations WHERE type = 'parent' AND session = 'Sesi 2'").get().s;

    // 2. Tamu Undangan
    const guestS1Count = db.prepare("SELECT COUNT(*) as c FROM invitations WHERE type = 'guest' AND session = 'Sesi 1'").get().c;
    const guestS1Tickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as s FROM invitations WHERE type = 'guest' AND session = 'Sesi 1'").get().s;

    const guestS2Count = db.prepare("SELECT COUNT(*) as c FROM invitations WHERE type = 'guest' AND session = 'Sesi 2'").get().c;
    const guestS2Tickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as s FROM invitations WHERE type = 'guest' AND session = 'Sesi 2'").get().s;

    // 3. Pembeli Berbayar (Orders)
    const allOrders = db.prepare('SELECT id, status, ticket_qty, performance_session, ticket_category FROM orders').all();
    
    let buyerVerifiedS1Count = 0, buyerVerifiedS1Tickets = 0;
    let buyerPendingS1Count = 0, buyerPendingS1Tickets = 0;
    let buyerVerifiedS2Count = 0, buyerVerifiedS2Tickets = 0;
    let buyerPendingS2Count = 0, buyerPendingS2Tickets = 0;

    for (const ord of allOrders) {
      const sessStr = ((ord.performance_session || '') + ' ' + (ord.ticket_category || '')).toLowerCase();
      const isSesi2 = sessStr.includes('2') || sessStr.includes('sesi 2') || sessStr.includes('session 2');
      const qty = ord.ticket_qty || 1;

      if (isSesi2) {
        if (ord.status === 'verified') {
          buyerVerifiedS2Count++;
          buyerVerifiedS2Tickets += qty;
        } else if (ord.status === 'pending') {
          buyerPendingS2Count++;
          buyerPendingS2Tickets += qty;
        }
      } else {
        if (ord.status === 'verified') {
          buyerVerifiedS1Count++;
          buyerVerifiedS1Tickets += qty;
        } else if (ord.status === 'pending') {
          buyerPendingS1Count++;
          buyerPendingS1Tickets += qty;
        }
      }
    }

    // Calculations Sesi 1
    const terisiFix1 = parentS1Tickets + guestS1Tickets + buyerVerifiedS1Tickets;
    const sisaKursi1 = Math.max(0, cap1 - terisiFix1);
    const okupansiPct1 = cap1 > 0 ? Number(((terisiFix1 / cap1) * 100).toFixed(1)) : 0;
    const potensiTerisi1 = terisiFix1 + buyerPendingS1Tickets;
    const sisaPotensial1 = Math.max(0, cap1 - potensiTerisi1);

    // Calculations Sesi 2
    const terisiFix2 = parentS2Tickets + guestS2Tickets + buyerVerifiedS2Tickets;
    const sisaKursi2 = Math.max(0, cap2 - terisiFix2);
    const okupansiPct2 = cap2 > 0 ? Number(((terisiFix2 / cap2) * 100).toFixed(1)) : 0;
    const potensiTerisi2 = terisiFix2 + buyerPendingS2Tickets;
    const sisaPotensial2 = Math.max(0, cap2 - potensiTerisi2);

    // Grand Totals
    const capTotal = cap1 + cap2;
    const terisiTotal = terisiFix1 + terisiFix2;
    const sisaTotal = Math.max(0, capTotal - terisiTotal);
    const okupansiTotal = capTotal > 0 ? Number(((terisiTotal / capTotal) * 100).toFixed(1)) : 0;

    res.json({
      success: true,
      data: {
        capacity_settings: {
          session_1: cap1,
          session_2: cap2,
          total: capTotal
        },
        session_1: {
          capacity: cap1,
          parents: { count: parentS1Count, tickets: parentS1Tickets },
          guests: { count: guestS1Count, tickets: guestS1Tickets },
          buyers_verified: { count: buyerVerifiedS1Count, tickets: buyerVerifiedS1Tickets },
          buyers_pending: { count: buyerPendingS1Count, tickets: buyerPendingS1Tickets },
          total_occupied: terisiFix1,
          remaining_seats: sisaKursi1,
          occupancy_rate: okupansiPct1,
          potential_occupied: potensiTerisi1,
          potential_remaining: sisaPotensial1
        },
        session_2: {
          capacity: cap2,
          parents: { count: parentS2Count, tickets: parentS2Tickets },
          guests: { count: guestS2Count, tickets: guestS2Tickets },
          buyers_verified: { count: buyerVerifiedS2Count, tickets: buyerVerifiedS2Tickets },
          buyers_pending: { count: buyerPendingS2Count, tickets: buyerPendingS2Tickets },
          total_occupied: terisiFix2,
          remaining_seats: sisaKursi2,
          occupancy_rate: okupansiPct2,
          potential_occupied: potensiTerisi2,
          potential_remaining: sisaPotensial2
        },
        grand_total: {
          capacity: capTotal,
          parents_tickets: parentS1Tickets + parentS2Tickets,
          guests_tickets: guestS1Tickets + guestS2Tickets,
          buyers_verified_tickets: buyerVerifiedS1Tickets + buyerVerifiedS2Tickets,
          buyers_pending_tickets: buyerPendingS1Tickets + buyerPendingS2Tickets,
          total_occupied: terisiTotal,
          remaining_seats: sisaTotal,
          occupancy_rate: okupansiTotal
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Kapasitas Kursi
app.post('/api/settings/capacity', (req, res) => {
  try {
    const { capacity_session_1, capacity_session_2 } = req.body;
    if (capacity_session_1 !== undefined) {
      updateSetting('capacity_session_1', Math.max(0, parseInt(capacity_session_1, 10) || 0));
    }
    if (capacity_session_2 !== undefined) {
      updateSetting('capacity_session_2', Math.max(0, parseInt(capacity_session_2, 10) || 0));
    }
    const settings = getSettings();
    res.json({
      success: true,
      message: 'Kapasitas kursi berhasil diperbarui!',
      data: {
        capacity_session_1: settings.capacity_session_1,
        capacity_session_2: settings.capacity_session_2
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// ORANG TUA SISWA & TAMU UNDANGAN
// ==========================================

// List Invitations with filters and counters
app.get('/api/invitations', (req, res) => {
  try {
    const { search, class_grade, session, type, is_swapped, checked_in } = req.query;
    
    let query = 'SELECT * FROM invitations WHERE 1=1';
    const params = [];

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query += ' AND (name LIKE ? OR invitation_code LIKE ? OR phone LIKE ? OR institution LIKE ? OR swap_notes LIKE ?)';
      params.push(q, q, q, q, q);
    }

    if (type && type !== 'all') {
      query += ' AND type = ?';
      params.push(type);
    }

    if (class_grade && class_grade !== 'all') {
      if (class_grade === 'guest') {
        query += " AND type = 'guest'";
      } else {
        query += ' AND class_grade = ?';
        params.push(class_grade);
      }
    }

    if (session && session !== 'all') {
      query += ' AND session = ?';
      params.push(session);
    }

    if (is_swapped !== undefined && is_swapped !== '' && is_swapped !== 'all') {
      query += ' AND is_swapped = ?';
      params.push(parseInt(is_swapped, 10));
    }

    if (checked_in !== undefined && checked_in !== '' && checked_in !== 'all') {
      query += ' AND checked_in = ?';
      params.push(parseInt(checked_in, 10));
    }

    query += ' ORDER BY class_grade ASC, invitation_code ASC';

    const rows = db.prepare(query).all(...params);

    // Compute summary stats
    const totalParents = db.prepare("SELECT COUNT(*) as count FROM invitations WHERE type = 'parent'").get().count;
    const totalGuests = db.prepare("SELECT COUNT(*) as count FROM invitations WHERE type = 'guest'").get().count;

    const parentTicketsS1 = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM invitations WHERE type = 'parent' AND session = 'Sesi 1'").get().count;
    const parentTicketsS2 = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM invitations WHERE type = 'parent' AND session = 'Sesi 2'").get().count;

    const guestTicketsS1 = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM invitations WHERE type = 'guest' AND session = 'Sesi 1'").get().count;
    const guestTicketsS2 = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM invitations WHERE type = 'guest' AND session = 'Sesi 2'").get().count;

    const totalSwapped = db.prepare("SELECT COUNT(*) as count FROM invitations WHERE is_swapped = 1").get().count;
    const totalCheckedIn = db.prepare("SELECT COUNT(*) as count FROM invitations WHERE checked_in = 1").get().count;
    const totalCheckedInTickets = db.prepare("SELECT COALESCE(SUM(ticket_qty), 0) as count FROM invitations WHERE checked_in = 1").get().count;

    res.json({
      success: true,
      data: rows,
      meta: {
        totalRows: rows.length,
        totalParents,
        totalGuests,
        parentTicketsS1,
        parentTicketsS2,
        guestTicketsS1,
        guestTicketsS2,
        totalSwapped,
        totalCheckedIn,
        totalCheckedInTickets
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Sesi & Jumlah Tiket (Orang Tua / Undangan)
app.post('/api/invitations/:id/update-session', (req, res) => {
  try {
    const { id } = req.params;
    const { session, ticket_qty, swap_notes, phone } = req.body;

    const item = db.prepare('SELECT * FROM invitations WHERE id = ? OR invitation_code = ?').get(id, id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Data orang tua / tamu tidak ditemukan' });
    }

    const newSession = session || item.session;
    const newQty = ticket_qty !== undefined ? Math.max(0, parseInt(ticket_qty, 10)) : item.ticket_qty;
    const newNotes = swap_notes !== undefined ? String(swap_notes).trim() : item.swap_notes;
    const newPhone = phone !== undefined ? String(phone).trim() : item.phone;

    // is_swapped is 1 if session changed from original OR ticket_qty changed from original (2 for parents)
    const isSwapped = (newSession !== item.original_session || newQty !== 2 || Boolean(newNotes)) ? 1 : 0;

    db.prepare(`
      UPDATE invitations
      SET session = ?, ticket_qty = ?, swap_notes = ?, phone = ?, is_swapped = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newSession, newQty, newNotes, newPhone, isSwapped, item.id);

    persistInvitationsToFile();

    const updated = db.prepare('SELECT * FROM invitations WHERE id = ?').get(item.id);
    res.json({
      success: true,
      message: `Data ${updated.name} (${updated.invitation_code}) berhasil diperbarui`,
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reset Sesi & Tiket ke Bawaan
app.post('/api/invitations/:id/reset-session', (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT * FROM invitations WHERE id = ? OR invitation_code = ?').get(id, id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Data tidak ditemukan' });
    }

    db.prepare(`
      UPDATE invitations
      SET session = original_session, ticket_qty = 2, is_swapped = 0, swap_notes = '', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(item.id);

    persistInvitationsToFile();

    const updated = db.prepare('SELECT * FROM invitations WHERE id = ?').get(item.id);
    res.json({
      success: true,
      message: `Alokasi sesi untuk ${updated.name} berhasil direset ke bawaan (${updated.session}, 2 tiket)`,
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tambah Tamu Undangan Baru
app.post('/api/invitations/guest', (req, res) => {
  try {
    const { name, institution, session, ticket_qty, phone, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama tamu undangan wajib diisi' });
    }

    // Find next available code
    const guests = db.prepare("SELECT invitation_code FROM invitations WHERE type = 'guest'").all();
    let maxNum = 0;
    for (const g of guests) {
      const match = g.invitation_code.match(/UND-(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const code = `UND-${String(maxNum + 1).padStart(2, '0')}`;
    const selectedSession = session || 'Sesi 1';
    const qty = parseInt(ticket_qty, 10) || 2;

    db.prepare(`
      INSERT INTO invitations (
        invitation_code, type, name, class_grade, session, original_session,
        ticket_qty, is_swapped, swap_notes, institution, phone
      ) VALUES (?, 'guest', ?, NULL, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      code, name.trim(), selectedSession, selectedSession, qty,
      notes || '', institution || '', phone || ''
    );

    persistInvitationsToFile();

    const created = db.prepare('SELECT * FROM invitations WHERE invitation_code = ?').get(code);
    res.status(201).json({
      success: true,
      message: `Tamu undangan "${created.name}" berhasil ditambahkan (${created.invitation_code})`,
      data: created
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Tamu Undangan
app.put('/api/invitations/guest/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, institution, session, ticket_qty, phone, notes } = req.body;
    const guest = db.prepare("SELECT * FROM invitations WHERE (id = ? OR invitation_code = ?) AND type = 'guest'").get(id, id);
    if (!guest) {
      return res.status(404).json({ success: false, message: 'Tamu undangan tidak ditemukan' });
    }

    db.prepare(`
      UPDATE invitations
      SET name = COALESCE(NULLIF(?, ''), name),
          institution = ?,
          session = COALESCE(NULLIF(?, ''), session),
          ticket_qty = ?,
          phone = ?,
          swap_notes = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name ? name.trim() : guest.name,
      institution !== undefined ? institution.trim() : guest.institution,
      session || guest.session,
      ticket_qty !== undefined ? parseInt(ticket_qty, 10) : guest.ticket_qty,
      phone !== undefined ? phone.trim() : guest.phone,
      notes !== undefined ? notes.trim() : guest.swap_notes,
      guest.id
    );

    persistInvitationsToFile();
    const updated = db.prepare('SELECT * FROM invitations WHERE id = ?').get(guest.id);
    res.json({ success: true, message: 'Data tamu berhasil diperbarui', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hapus Tamu Undangan
app.delete('/api/invitations/guest/:id', (req, res) => {
  try {
    const { id } = req.params;
    const guest = db.prepare("SELECT * FROM invitations WHERE (id = ? OR invitation_code = ?) AND type = 'guest'").get(id, id);
    if (!guest) {
      return res.status(404).json({ success: false, message: 'Tamu undangan tidak ditemukan' });
    }

    db.prepare('DELETE FROM invitations WHERE id = ?').run(guest.id);
    persistInvitationsToFile();

    res.json({ success: true, message: `Tamu undangan ${guest.name} (${guest.invitation_code}) berhasil dihapus` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Check-in / Uncheck-in Toggle for Invitations
app.post('/api/invitations/:id/checkin', (req, res) => {
  try {
    const { id } = req.params;
    const inv = db.prepare('SELECT * FROM invitations WHERE id = ? OR invitation_code = ?').get(id, id);
    if (!inv) return res.status(404).json({ success: false, message: 'Undangan tidak ditemukan' });
    const newChecked = inv.checked_in === 1 ? 0 : 1;
    const checkedAt = newChecked === 1 ? new Date().toISOString() : null;
    db.prepare('UPDATE invitations SET checked_in = ?, checked_in_at = ? WHERE id = ?').run(newChecked, checkedAt, inv.id);
    persistInvitationsToFile();
    const updated = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id);
    res.json({
      success: true,
      message: newChecked === 1 ? `Check-in berhasil untuk ${updated.name}` : `Check-in dibatalkan untuk ${updated.name}`,
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Export Daftar Orang Tua & Tamu ke CSV
app.get('/api/invitations/export-csv', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM invitations ORDER BY class_grade ASC, invitation_code ASC').all();
    
    const headers = [
      'Kode Tiket', 'Kategori', 'Kelas', 'Nama Siswa / Tamu',
      'Sesi Pertunjukan', 'Sesi Bawaan', 'Jumlah Tiket (Pax)',
      'Status Tukar Sesi', 'Catatan / Alasan Tukar', 'Instansi / Keterangan',
      'No Telepon / WA', 'Status Check-in', 'Waktu Masuk (Gate)'
    ];

    let csvContent = '\uFEFF' + headers.join(',') + '\n';

    for (const r of rows) {
      const row = [
        `"${r.invitation_code}"`,
        r.type === 'parent' ? '"Orang Tua Siswa"' : '"Tamu Undangan"',
        `"${r.class_grade || '-'}"`,
        `"${(r.name || '').replace(/"/g, '""')}"`,
        `"${r.session}"`,
        `"${r.original_session}"`,
        r.ticket_qty,
        r.is_swapped === 1 ? '"BERTUKAR / MODIFIKASI"' : '"SESUAI DEFAULT"',
        `"${(r.swap_notes || '').replace(/"/g, '""')}"`,
        `"${(r.institution || '').replace(/"/g, '""')}"`,
        `"${r.phone || ''}"`,
        r.checked_in === 1 ? '"SUDAH MASUK"' : '"BELUM"',
        `"${r.checked_in_at || ''}"`
      ];
      csvContent += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="daftar_orangtua_dan_tamu_undangan.csv"');
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

    // Persist verified status to orders cache
    try {
      const cache = loadOrdersCache();
      const k = `${updatedOrder.phone}_${updatedOrder.name.trim()}`;
      cache[k] = {
        order_id: updatedOrder.order_id,
        name: updatedOrder.name,
        phone: updatedOrder.phone,
        status: 'verified',
        checked_in: updatedOrder.checked_in || 0,
        checked_in_at: updatedOrder.checked_in_at
      };
      saveOrdersCache(cache);
    } catch (e) {}

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
    let order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);

    if (!order) {
      // Check invitations table (parents and guests)
      const inv = db.prepare('SELECT * FROM invitations WHERE id = ? OR invitation_code = ?').get(id, id);
      if (inv) {
        if (inv.checked_in === 1) {
          return res.status(409).json({
            success: false,
            already_checked_in: true,
            message: `Tiket ${inv.invitation_code} (${inv.name}) SUDAH DIGUNAKAN sebelumnya pada ${inv.checked_in_at}!`,
            data: {
              ...inv,
              order_id: inv.invitation_code,
              ticket_category: inv.type === 'parent' ? `Orang Tua Siswa (${inv.class_grade})` : 'Tamu Undangan',
              performance_session: inv.session,
              status: 'verified'
            }
          });
        }

        db.prepare('UPDATE invitations SET checked_in = 1, checked_in_at = CURRENT_TIMESTAMP WHERE id = ?').run(inv.id);
        persistInvitationsToFile();

        const updatedInv = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id);
        return res.json({
          success: true,
          message: `Check-in BERHASIL! Selamat datang ${updatedInv.type === 'parent' ? 'Orang Tua dari ' + updatedInv.name : updatedInv.name}.`,
          data: {
            ...updatedInv,
            order_id: updatedInv.invitation_code,
            ticket_category: updatedInv.type === 'parent' ? `Orang Tua Siswa (${updatedInv.class_grade})` : 'Tamu Undangan',
            performance_session: updatedInv.session,
            status: 'verified'
          }
        });
      }

      return res.status(404).json({ success: false, message: 'Kode tiket tidak ditemukan!' });
    }

    if (order.status !== 'verified') {
      return res.status(400).json({
        success: false,
        message: `Tiket belum lunas (Status: ${order.status.toUpperCase()}). Pembayaran harus diverifikasi terlebih dahulu!`,
        data: order
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

    // Persist check-in status to orders cache
    try {
      const cache = loadOrdersCache();
      const k = `${updated.phone}_${updated.name.trim()}`;
      cache[k] = {
        order_id: updated.order_id,
        name: updated.name,
        phone: updated.phone,
        status: updated.status,
        checked_in: 1,
        checked_in_at: updated.checked_in_at
      };
      saveOrdersCache(cache);
    } catch (e) {}

    res.json({
      success: true,
      message: 'Check-in BERHASIL! Selamat datang di acara.',
      data: updated
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8b. Gate Uncheck-in / Reset Check-in Ticket (Panitia override)
app.post('/api/orders/:id/uncheckin', (req, res) => {
  try {
    const { id } = req.params;
    let order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_id = ?').get(id, id);

    if (!order) {
      const inv = db.prepare('SELECT * FROM invitations WHERE id = ? OR invitation_code = ?').get(id, id);
      if (inv) {
        db.prepare('UPDATE invitations SET checked_in = 0, checked_in_at = NULL WHERE id = ?').run(inv.id);
        persistInvitationsToFile();
        const updatedInv = db.prepare('SELECT * FROM invitations WHERE id = ?').get(inv.id);
        return res.json({
          success: true,
          message: `Status check-in ${updatedInv.name} berhasil dibatalkan.`,
          data: {
            ...updatedInv,
            order_id: updatedInv.invitation_code,
            is_invitation: true
          }
        });
      }
      return res.status(404).json({ success: false, message: 'Kode tiket tidak ditemukan!' });
    }

    db.prepare(`
      UPDATE orders
      SET checked_in = 0, checked_in_at = NULL
      WHERE id = ?
    `).run(order.id);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);

    // Persist uncheck-in status to orders cache
    try {
      const cache = loadOrdersCache();
      const k = `${updated.phone}_${updated.name.trim()}`;
      if (cache[k]) {
        cache[k].checked_in = 0;
        cache[k].checked_in_at = null;
        saveOrdersCache(cache);
      }
    } catch (e) {}

    res.json({
      success: true,
      message: 'Status check-in berhasil dibatalkan. Tiket dapat digunakan kembali.',
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

// 11b. Browser Client State Auto-Sync & Recovery
app.post('/api/settings/backup-sync', async (req, res) => {
  try {
    const { settings: clientSettings, overrides } = req.body;
    let shouldSync = false;

    if (clientSettings && typeof clientSettings === 'object') {
      const current = getSettings();
      // If current google_sheet_url is empty, or client provided a valid sheet url
      if (clientSettings.google_sheet_url && (!current.google_sheet_url || current.google_sheet_url !== clientSettings.google_sheet_url)) {
        updateSetting('google_sheet_url', clientSettings.google_sheet_url);
        shouldSync = true;
      }
      for (const [k, v] of Object.entries(clientSettings)) {
        if (v !== undefined && v !== null && v !== '' && !k.startsWith('_')) {
          updateSetting(k, v);
        }
      }
    }

    // Apply any client-side order overrides (e.g. verified or checked-in)
    if (overrides && typeof overrides === 'object') {
      const cache = loadOrdersCache();
      for (const [orderId, state] of Object.entries(overrides)) {
        if (state.status === 'verified') {
          db.prepare("UPDATE orders SET status = 'verified' WHERE order_id = ?").run(orderId);
        }
        if (state.checked_in === 1) {
          db.prepare("UPDATE orders SET checked_in = 1, checked_in_at = COALESCE(checked_in_at, CURRENT_TIMESTAMP) WHERE order_id = ?").run(orderId);
        }
        const order = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);
        if (order) {
          const k = `${order.phone}_${order.name.trim()}`;
          cache[k] = {
            order_id: order.order_id,
            name: order.name,
            phone: order.phone,
            status: state.status || order.status,
            checked_in: state.checked_in !== undefined ? state.checked_in : order.checked_in,
            checked_in_at: order.checked_in_at
          };
        }
      }
      saveOrdersCache(cache);
    }

    const current = getSettings();
    if (shouldSync && current.google_sheet_url) {
      syncFromGoogleSheet(current.google_sheet_url, { sendWaOnSync: false }).catch(() => {});
    }

    res.json({ success: true, message: 'Pengaturan dan status cadangan berhasil disinkronkan', data: current });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11c. Export Settings & Data State (JSON File Download)
app.get('/api/settings/export', (req, res) => {
  try {
    const settings = getSettings();
    const ordersCache = loadOrdersCache();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="backup-sistem-tiket.json"');
    res.send(JSON.stringify({ settings, orders_cache: ordersCache, exported_at: new Date().toISOString() }, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 11d. Import Settings & Data State (JSON File Upload / Restore)
app.post('/api/settings/import', (req, res) => {
  try {
    const { settings: importedSettings, orders_cache: importedCache } = req.body;
    if (importedSettings && typeof importedSettings === 'object') {
      for (const [k, v] of Object.entries(importedSettings)) {
        updateSetting(k, v);
      }
    }
    if (importedCache && typeof importedCache === 'object') {
      const existing = loadOrdersCache();
      Object.assign(existing, importedCache);
      saveOrdersCache(existing);
    }
    const current = getSettings();
    if (current.google_sheet_url) {
      syncFromGoogleSheet(current.google_sheet_url, { sendWaOnSync: false }).catch(() => {});
    }
    res.json({ success: true, message: 'Cadangan berhasil diimpor & dipulihkan!', data: current });
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
    if (settings.google_sheet_url && settings.auto_sync_enabled !== false && settings.auto_sync_enabled !== 'false') {
      await syncFromGoogleSheet(settings.google_sheet_url, { sendWaOnSync: false });
    }
  } catch (err) {
    // silent catch in background
  }
}, 30000);

// Start Server
app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(`🎟️  SISTEM TIKET KEGIATAN SEKOLAH AKTIF!`);
  console.log(`🌐  Dashboard Web : http://localhost:${PORT}`);
  console.log(`📡  Webhook URL  : http://localhost:${PORT}/api/webhook/order`);
  console.log(`====================================================`);

  // Initial Sync from Google Spreadsheet on startup
  try {
    const settings = getSettings();
    if (settings.google_sheet_url) {
      console.log(`🔄 Menjalankan sinkronisasi awal Google Spreadsheet...`);
      const syncResult = await syncFromGoogleSheet(settings.google_sheet_url, { sendWaOnSync: false });
      console.log(`✓ Sinkronisasi awal selesai: ${syncResult.newOrders} data baru, ${syncResult.updatedOrders} data diperbarui.`);
    }
  } catch (err) {
    console.warn(`⚠️ Catatan sinkronisasi awal Google Sheet: ${err.message}`);
  }
});

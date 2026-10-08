// State Management
let currentSettings = {};
let allOrders = [];
let searchDebounceTimer = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  if (window.lucide) lucide.createIcons();
  await loadSettings();
  await loadStats();
  await loadOrders();
  generateAppsScriptTemplate();
  
  // Auto-sync spreadsheet in background when opening dashboard if configured
  if (currentSettings.google_sheet_url && currentSettings.auto_sync_enabled !== false && currentSettings.auto_sync_enabled !== 'false') {
    fetch('/api/sync/google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url: currentSettings.google_sheet_url, send_wa: false })
    }).then(r => r.json()).then(res => {
      if (res.success && res.data.newOrders > 0) {
        showToast(`Tersinkron otomatis: ${res.data.newOrders} pesanan baru dari Spreadsheet`, 'info');
        loadStats();
        loadOrders();
        if (typeof loadSessionRecap === 'function') loadSessionRecap();
      }
    }).catch(() => {});
  }

  // Auto refresh stats every 30 seconds
  setInterval(() => {
    loadStats();
  }, 30000);
}

function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');
  
  const tasks = [loadStats(), loadOrders()];
  if (currentSettings.google_sheet_url && currentSettings.auto_sync_enabled !== false && currentSettings.auto_sync_enabled !== 'false') {
    tasks.push(
      fetch('/api/sync/google-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_url: currentSettings.google_sheet_url, send_wa: false })
      }).then(r => r.json()).then(res => {
        if (res.success && res.data.newOrders > 0) {
          showToast(`Tersinkron: ${res.data.newOrders} data baru dari Spreadsheet`, 'info');
        }
      }).catch(() => {})
    );
  }

  Promise.all(tasks).finally(() => {
    setTimeout(() => {
      if (icon) icon.classList.remove('animate-spin');
      showToast('Data berhasil diperbarui', 'success');
    }, 400);
  });
}

// ==========================================
// NAVIGATION & TABS
// ==========================================
function switchTab(tabId) {
  // If leaving checkin tab and camera is active, turn it off to save resources
  if (tabId !== 'checkin' && isScannerRunning) {
    stopCameraScanner();
  }

  const tabs = ['overview', 'orders', 'recap', 'checkin', 'manual', 'settings'];
  tabs.forEach(t => {
    const content = document.getElementById(`tab-content-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (content) content.classList.toggle('hidden', t !== tabId);
    if (btn) {
      if (t === tabId) {
        btn.classList.add('bg-indigo-800', 'text-white');
        btn.classList.remove('text-indigo-200');
      } else {
        btn.classList.remove('bg-indigo-800', 'text-white');
        btn.classList.add('text-indigo-200');
      }
    }
  });

  if (tabId === 'recap') {
    loadSessionRecap();
  }

  if (window.lucide) lucide.createIcons();
}

function filterByStatus(status) {
  switchTab('orders');
  const sel = document.getElementById('filter-status');
  if (sel) {
    sel.value = status;
    loadOrders();
  }
}

function switchSettingsSubTab(subTab) {
  const general = document.getElementById('settings-panel-general');
  const guide = document.getElementById('settings-panel-guide');
  const btnGen = document.getElementById('subtab-btn-general');
  const btnGui = document.getElementById('subtab-btn-guide');

  if (subTab === 'general') {
    general.classList.remove('hidden');
    guide.classList.add('hidden');
    btnGen.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-indigo-50 text-indigo-700';
    btnGui.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl text-slate-600 hover:bg-slate-100';
  } else {
    general.classList.add('hidden');
    guide.classList.remove('hidden');
    btnGui.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl bg-indigo-50 text-indigo-700';
    btnGen.className = 'px-4 py-2 text-xs sm:text-sm font-bold rounded-xl text-slate-600 hover:bg-slate-100';
    generateAppsScriptTemplate();
  }
  if (window.lucide) lucide.createIcons();
}

// ==========================================
// DATA FETCHING: STATS & OVERVIEW
// ==========================================
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const result = await res.json();
    if (!result.success) return;

    const data = result.data;

    // Metrics
    document.getElementById('metric-revenue').textContent = 'Rp ' + formatRupiah(data.verifiedRevenue);
    document.getElementById('metric-pending-orders').textContent = data.pendingOrders;
    document.getElementById('metric-pending-tickets').textContent = `(${data.pendingTickets} tiket)`;
    document.getElementById('metric-verified-tickets').textContent = data.verifiedTickets;
    document.getElementById('metric-verified-orders').textContent = data.verifiedOrders;
    document.getElementById('metric-total-orders').textContent = data.totalOrders;
    document.getElementById('metric-checked-in').textContent = data.checkedInCount;

    // Pending Alert Banner & Tab Badge
    const pendingBanner = document.getElementById('pending-alert-banner');
    const pendingCounterBadge = document.getElementById('pending-counter-badge');
    const bannerPendingCount = document.getElementById('banner-pending-count');

    if (data.pendingOrders > 0) {
      pendingBanner.classList.remove('hidden');
      bannerPendingCount.textContent = data.pendingOrders;
      pendingCounterBadge.textContent = data.pendingOrders;
      pendingCounterBadge.classList.remove('hidden');
    } else {
      pendingBanner.classList.add('hidden');
      pendingCounterBadge.classList.add('hidden');
    }

    // Category breakdown list
    renderCategoryBreakdown(data.categoryBreakdown);
  } catch (err) {
    console.error('Error loading stats:', err);
  }
}

function renderCategoryBreakdown(categories) {
  const container = document.getElementById('category-list');
  if (!container) return;

  if (!categories || categories.length === 0) {
    container.innerHTML = '<p class="text-xs text-slate-400">Belum ada transaksi</p>';
    return;
  }

  container.innerHTML = categories.map(cat => `
    <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
      <div>
        <span class="font-bold text-xs text-slate-800 block">${cat.ticket_category}</span>
        <span class="text-[11px] text-slate-500">${cat.orders_count} pesanan (${cat.total_qty || 0} pax)</span>
      </div>
      <div class="text-right">
        <span class="font-extrabold text-xs text-indigo-700">Rp ${formatRupiah(cat.total_revenue || 0)}</span>
      </div>
    </div>
  `).join('');
}

// ==========================================
// DATA FETCHING: ORDERS TABLE
// ==========================================
async function loadOrders() {
  const status = document.getElementById('filter-status').value;
  const category = document.getElementById('filter-category').value;
  const search = document.getElementById('order-search').value.trim();

  const tbody = document.getElementById('orders-tbody');
  tbody.innerHTML = `
    <tr>
      <td colspan="8" class="text-center py-8 text-slate-400">
        <div class="inline-block animate-spin rounded-full h-6 w-6 border-2 border-indigo-600 border-t-transparent mb-1"></div>
        <p class="text-xs">Memuat transaksi...</p>
      </td>
    </tr>
  `;

  try {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (category) params.append('category', category);
    if (search) params.append('search', search);

    const res = await fetch(`/api/orders?${params.toString()}`);
    const result = await res.json();

    if (!result.success) throw new Error(result.error);

    allOrders = result.data;
    document.getElementById('orders-count-text').textContent = allOrders.length;
    renderOrdersTable(allOrders);

    // Persist verified & checked-in statuses to browser storage for Render survival
    try {
      const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
      allOrders.forEach(o => {
        if (o.status === 'verified' || o.checked_in === 1) {
          existingOverrides[o.order_id] = {
            status: o.status,
            checked_in: o.checked_in || 0,
            phone: o.phone,
            name: o.name
          };
        }
      });
      localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
    } catch (e) {}
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red-500 text-xs">Gagal memuat data: ${err.message}</td></tr>`;
  }
}

function handleSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    loadOrders();
  }, 300);
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('orders-tbody');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-12 text-slate-400">
          <i data-lucide="inbox" class="w-10 h-10 mx-auto mb-2 text-slate-300"></i>
          <p class="text-sm font-semibold text-slate-600">Tidak ada transaksi ditemukan</p>
          <p class="text-xs text-slate-400 mt-1">Coba ubah filter atau lakukan pencarian lain.</p>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  tbody.innerHTML = orders.map(order => {
    // Status Badge
    let statusBadge = '';
    if (order.status === 'verified') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
          <i data-lucide="check" class="w-3 h-3"></i> Lunas
        </span>
      `;
    } else if (order.status === 'rejected') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-100 text-red-800" title="${order.rejection_reason || ''}">
          <i data-lucide="x" class="w-3 h-3"></i> Ditolak
        </span>
      `;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-500 badge-pulse"></span> Menunggu
        </span>
      `;
    }

    // Proof button
    let proofButton = '';
    if (order.payment_proof_url) {
      proofButton = `
        <button onclick="openProofModal('${order.order_id}')" class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition inline-flex items-center gap-1">
          <i data-lucide="eye" class="w-3.5 h-3.5"></i> Lihat Bukti
        </button>
      `;
    } else {
      proofButton = `<span class="text-[11px] text-slate-400 italic">Tanpa bukti</span>`;
    }

    // Action buttons based on status
    let actionButtons = '';
    if (order.status === 'pending') {
      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="verifyOrder('${order.id}', '${order.name}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm" title="Verifikasi Lunas & Kirim Tiket WA">
            <i data-lucide="check" class="w-3.5 h-3.5"></i> Lunas
          </button>
          <button onclick="openRejectModal('${order.id}', '${order.order_id}')" class="bg-red-50 hover:bg-red-100 text-red-700 px-2 py-1.5 rounded-lg text-xs font-bold transition" title="Tolak Bukti">
            <i data-lucide="x" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="openWhatsAppAction('${order.order_id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 p-1.5 rounded-lg text-xs transition" title="Opsi WhatsApp">
            <i data-lucide="message-circle" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteOrder('${order.id}', '${order.order_id}', '${escapeHtml(order.name)}')" class="bg-red-50 hover:bg-red-100 text-red-600 p-1.5 rounded-lg text-xs transition" title="Hapus Transaksi">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    } else if (order.status === 'verified') {
      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <a href="/ticket.html?id=${order.order_id}" target="_blank" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1" title="Lihat E-Tiket Digital">
            <i data-lucide="ticket" class="w-3.5 h-3.5"></i> E-Tiket
          </a>
          <button onclick="resendWhatsApp('${order.id}', 'ticket')" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 p-1.5 rounded-lg text-xs transition" title="Kirim Ulang Tiket WA">
            <i data-lucide="send" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteOrder('${order.id}', '${order.order_id}', '${escapeHtml(order.name)}')" class="bg-red-50 hover:bg-red-100 text-red-600 p-1.5 rounded-lg text-xs transition" title="Hapus Transaksi">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    } else {
      actionButtons = `
        <div class="flex items-center justify-end gap-1.5">
          <button onclick="verifyOrder('${order.id}', '${order.name}')" class="bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1" title="Buka Kembali & Verifikasi">
            Pulihkan
          </button>
          <button onclick="deleteOrder('${order.id}', '${order.order_id}', '${escapeHtml(order.name)}')" class="bg-red-50 hover:bg-red-100 text-red-600 p-1.5 rounded-lg text-xs transition" title="Hapus Transaksi">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      `;
    }

    const formattedDate = order.created_at ? new Date(order.created_at).toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    }) : '-';

    const cleanWa = (order.phone || '').replace(/[^0-9]/g, '');

    return `
      <tr class="hover:bg-slate-50/80 transition text-xs">
        <!-- 1. Order ID & Waktu -->
        <td class="py-3 px-3 whitespace-nowrap">
          <span class="font-mono font-bold text-xs text-indigo-900 block">${order.order_id}</span>
          <span class="text-[10px] text-slate-400 block">${formattedDate}</span>
        </td>

        <!-- 2. Name & Email -->
        <td class="py-3 px-3">
          <span class="font-bold text-slate-900 block">${escapeHtml(order.name)}</span>
          <span class="text-[10px] text-slate-400 block truncate max-w-[140px]" title="${escapeHtml(order.email || '')}">${escapeHtml(order.email || '-')}</span>
        </td>

        <!-- 3. Phone Number -->
        <td class="py-3 px-3 whitespace-nowrap">
          <a href="https://wa.me/${cleanWa}" target="_blank" class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md">
            <i data-lucide="message-square" class="w-3 h-3 text-emerald-600"></i> ${order.phone}
          </a>
        </td>

        <!-- 4. Performance Session -->
        <td class="py-3 px-3">
          <span class="inline-block px-2 py-0.5 rounded-md text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
            ${escapeHtml(order.performance_session || order.ticket_category || '-')}
          </span>
        </td>

        <!-- 5. Amount of Ticket Purchased -->
        <td class="py-3 px-3 text-center">
          <span class="font-extrabold text-xs text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md inline-block">${order.ticket_qty}</span>
        </td>

        <!-- 6. Total Tagihan (Rp) -->
        <td class="py-3 px-3 whitespace-nowrap">
          <span class="font-extrabold text-xs text-slate-900 block">Rp ${formatRupiah(order.total_amount)}</span>
        </td>

        <!-- 7. Have you transferred? -->
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${order.has_transferred ? `<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${order.has_transferred.toLowerCase().includes('yes') || order.has_transferred.toLowerCase().includes('sudah') ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${escapeHtml(order.has_transferred)}</span>` : '<span class="text-slate-400">-</span>'}
        </td>

        <!-- 8. Sender's Account Name -->
        <td class="py-3 px-3">
          <span class="font-medium text-slate-800 block truncate max-w-[130px]" title="${escapeHtml(order.sender_account_name || '-')}">
            ${escapeHtml(order.sender_account_name || order.payment_method || '-')}
          </span>
        </td>

        <!-- 9. Payment Receipt (Bukti Bayar) -->
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${proofButton}
        </td>

        <!-- 10. Status Verifikasi -->
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${statusBadge}
        </td>

        <!-- 11. Aksi -->
        <td class="py-3 px-3 text-right whitespace-nowrap">
          ${actionButtons}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// ==========================================
// ACTIONS: VERIFY, REJECT, WHATSAPP
// ==========================================
async function verifyOrder(id, name) {
  if (!confirm(`Konfirmasi verifikasi pembayaran untuk ${name}?\n\nStatus akan diubah menjadi LUNAS dan sistem otomatis mengirimkan E-Tiket ber-QR Code via WhatsApp ke pembeli.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/orders/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_by: 'Admin Panitia' })
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.message);

    showToast(`✓ Pesanan ${name} LUNAS! E-Tiket berhasil diproses`, 'success');

    // Update local cache
    try {
      const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
      const order = allOrders.find(o => o.id == id);
      const oId = (order && order.order_id) || (result.data && result.data.order && result.data.order.order_id);
      if (oId) {
        existingOverrides[oId] = { status: 'verified', checked_in: 0, name: name };
        localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
      }
    } catch (e) {}
    
    // If WhatsApp gateway is not configured, provide direct link
    if (result.data.direct_wa_link && (!result.data.wa_result || !result.data.wa_result.success)) {
      if (confirm(`Pesan E-Tiket siap dikirimkan!\nKlik OK untuk membuka WhatsApp Web / Chat sekarang:`)) {
        window.open(result.data.direct_wa_link, '_blank');
      }
    }

    closeProofModal();
    loadStats();
    loadOrders();
  } catch (err) {
    alert('Gagal verifikasi: ' + err.message);
  }
}

async function deleteOrder(id, orderId, name) {
  if (!confirm(`Hapus transaksi ${orderId} atas nama "${name}"?\n\nData transaksi ini akan dihapus permanen dari sistem.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/orders/${id}`, {
      method: 'DELETE'
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.message || 'Gagal menghapus transaksi');

    showToast(`Transaksi ${orderId} berhasil dihapus`, 'info');

    // Remove from local cache
    try {
      const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
      if (existingOverrides[orderId]) {
        delete existingOverrides[orderId];
        localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
      }
    } catch (e) {}

    loadStats();
    loadOrders();
  } catch (err) {
    alert('Gagal menghapus transaksi: ' + err.message);
  }
}

function openRejectModal(id, orderId) {
  document.getElementById('reject-order-id').value = id;
  document.getElementById('reject-preset').value = 'Nominal transfer tidak sesuai dengan jumlah tagihan tiket.';
  document.getElementById('reject-reason').value = 'Nominal transfer tidak sesuai dengan jumlah tagihan tiket.';
  document.getElementById('reject-modal').classList.remove('hidden');
}

function closeRejectModal() {
  document.getElementById('reject-modal').classList.add('hidden');
}

function applyRejectPreset() {
  const preset = document.getElementById('reject-preset').value;
  const textarea = document.getElementById('reject-reason');
  if (preset !== 'custom') {
    textarea.value = preset;
  } else {
    textarea.value = '';
    textarea.focus();
  }
}

async function handleRejectSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('reject-order-id').value;
  const reason = document.getElementById('reject-reason').value.trim();

  try {
    const res = await fetch(`/api/orders/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.message);

    showToast('Pesanan ditolak dan notifikasi WA diproses', 'info');
    closeRejectModal();
    loadStats();
    loadOrders();
  } catch (err) {
    alert('Gagal menolak pesanan: ' + err.message);
  }
}

async function resendWhatsApp(id, type) {
  try {
    const res = await fetch(`/api/orders/${id}/resend-wa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const result = await res.json();

    if (result.success) {
      if (result.data.direct_link) {
        window.open(result.data.direct_link, '_blank');
      }
      showToast('Pesan WhatsApp dibuka / dikirim!', 'success');
    }
  } catch (err) {
    alert('Gagal mengirim WhatsApp: ' + err.message);
  }
}

function openWhatsAppAction(orderId) {
  const order = allOrders.find(o => o.order_id === orderId);
  if (!order) return;

  const choice = prompt(
    `Pilih aksi WhatsApp untuk ${order.name} (${order.order_id}):\n` +
    `1. Kirim Ulang Tanda Terima / Tagihan Transfer\n` +
    `2. Kirim Link E-Tiket Digital\n` +
    `3. Buka Chat WA Langsung\n\n` +
    `Ketik nomor pilihan (1/2/3):`,
    '1'
  );

  if (choice === '1') {
    resendWhatsApp(order.id, 'receipt');
  } else if (choice === '2') {
    resendWhatsApp(order.id, 'ticket');
  } else if (choice === '3') {
    window.open(`https://wa.me/${order.phone.replace(/[^0-9]/g, '')}`, '_blank');
  }
}

// ==========================================
// MODAL: PROOF PREVIEW
// ==========================================
function openProofModal(orderId) {
  const order = allOrders.find(o => o.order_id === orderId);
  if (!order) return;

  document.getElementById('modal-order-id').textContent = order.order_id;
  const extraInfo = [];
  if (order.email) extraInfo.push(order.email);
  if (order.performance_session) extraInfo.push(`Sesi: ${order.performance_session}`);
  if (order.sender_account_name) extraInfo.push(`Rek. Pengirim: ${order.sender_account_name}`);
  if (order.has_transferred) extraInfo.push(`Konfirmasi: ${order.has_transferred}`);

  document.getElementById('modal-buyer-name').innerHTML = `
    <strong>${escapeHtml(order.name)}</strong> • ${order.phone}
    ${extraInfo.length ? `<span class="block text-slate-500 mt-0.5 text-[11px]">${extraInfo.join(' | ')}</span>` : ''}
  `;
  document.getElementById('modal-total-amount').textContent = 'Rp ' + formatRupiah(order.total_amount);
  document.getElementById('modal-payment-method').textContent = order.sender_account_name ? `Transfer a.n. ${order.sender_account_name}` : (order.payment_method || 'Transfer Bank');

  const imgEl = document.getElementById('modal-proof-img');
  const noImgEl = document.getElementById('modal-no-img');
  const proofLinkEl = document.getElementById('modal-proof-link');

  let proofUrl = order.payment_proof_url;
  if (proofUrl) {
    // If it's a Google Drive link, format preview
    if (proofUrl.includes('drive.google.com')) {
      const match = proofUrl.match(/[-\w]{25,}/);
      if (match) {
        proofUrl = `https://drive.google.com/uc?export=view&id=${match[0]}`;
      }
    }

    imgEl.src = proofUrl;
    imgEl.classList.remove('hidden');
    noImgEl.classList.add('hidden');
    proofLinkEl.href = order.payment_proof_url;
    proofLinkEl.classList.remove('hidden');
  } else {
    imgEl.classList.add('hidden');
    noImgEl.classList.remove('hidden');
    proofLinkEl.classList.add('hidden');
  }

  // Action buttons inside modal
  const actionsContainer = document.getElementById('modal-action-buttons');
  if (order.status === 'pending') {
    actionsContainer.innerHTML = `
      <button onclick="closeProofModal()" class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Tutup</button>
      <button onclick="deleteOrder('${order.id}', '${order.order_id}', '${escapeHtml(order.name)}'); closeProofModal();" class="px-3 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-1">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus
      </button>
      <button onclick="openRejectModal('${order.id}', '${order.order_id}')" class="px-4 py-2 rounded-xl text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100">Tolak Bukti</button>
      <button onclick="verifyOrder('${order.id}', '${order.name}')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-md flex items-center gap-1.5">
        <i data-lucide="check" class="w-4 h-4"></i> Verifikasi Lunas & Terbitkan Tiket
      </button>
    `;
  } else {
    actionsContainer.innerHTML = `
      <button onclick="closeProofModal()" class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100">Tutup</button>
      <button onclick="deleteOrder('${order.id}', '${order.order_id}', '${escapeHtml(order.name)}'); closeProofModal();" class="px-3 py-2 rounded-xl text-xs font-bold text-red-600 hover:bg-red-50 flex items-center gap-1">
        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Hapus
      </button>
      <a href="/ticket.html?id=${order.order_id}" target="_blank" class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
        <i data-lucide="ticket" class="w-3.5 h-3.5"></i> Buka E-Tiket
      </a>
    `;
  }

  document.getElementById('proof-modal').classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeProofModal() {
  document.getElementById('proof-modal').classList.add('hidden');
}

// ==========================================
// CHECK-IN GATE: BARCODE & QR CODE SCANNER (CAMERA)
// ==========================================
let html5QrScannerInstance = null;
let isScannerRunning = false;
let isScanLocked = false;
let lastScannedTicketCode = null;
let lastScannedTime = 0;
let resumeTimerId = null;
let availableCameraDevices = [];
let currentCameraIndex = 0;

// Audio synthesized feedback (Web Audio API)
function playBeepSound(type = 'success') {
  try {
    const soundToggle = document.getElementById('scanner-sound-toggle');
    if (soundToggle && !soundToggle.checked) return;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    if (type === 'success') {
      // Pleasant high double beep (Ding-Dong)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.1); // D6
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'warning') {
      // Sawtooth warning buzz (already checked-in duplicate)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.setValueAtTime(240, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } else {
      // Low error buzz (invalid or unpaid)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      gain.gain.setValueAtTime(0.35, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    console.warn('Audio playback error:', e);
  }
}

// Smart ticket code extractor (supports raw text, JSON payload, and URL query params)
function extractTicketCode(rawText) {
  if (!rawText) return '';
  const text = String(rawText).trim();

  // 1. Check if payload is a JSON string (used by default E-Ticket QR Code)
  try {
    const parsed = JSON.parse(text);
    if (parsed.order_id) return String(parsed.order_id).trim().toUpperCase();
    if (parsed.id) return String(parsed.id).trim().toUpperCase();
  } catch (e) {}

  // 2. Check for TIX-XXXX pattern (case-insensitive)
  const tixMatch = text.match(/TIX-[A-Z0-9_-]+/i);
  if (tixMatch) return tixMatch[0].toUpperCase();

  // 3. Check if payload is a URL (e.g., ticket.html?id=TIX-XXXX)
  try {
    if (text.includes('?') || text.startsWith('http')) {
      const url = new URL(text, window.location.origin);
      const idParam = url.searchParams.get('id');
      if (idParam) return idParam.trim().toUpperCase();
    }
  } catch (e) {}

  return text.toUpperCase();
}

async function toggleCameraScanner() {
  if (isScannerRunning) {
    await stopCameraScanner();
  } else {
    await startCameraScanner();
  }
}

async function startCameraScanner() {
  const wrapper = document.getElementById('scanner-wrapper');
  const btnLabel = document.getElementById('btn-toggle-scanner-label');
  const toggleBtn = document.getElementById('btn-toggle-scanner');
  const switchBtn = document.getElementById('btn-switch-camera');
  const statusBadge = document.getElementById('scanner-status-badge');

  if (typeof Html5Qrcode === 'undefined') {
    alert('Library kamera (Html5Qrcode) belum selesai dimuat dari CDN. Silakan pastikan koneksi internet aktif dan muat ulang halaman.');
    return;
  }

  wrapper.classList.remove('hidden');
  if (statusBadge) {
    statusBadge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
      <span>Menghubungkan ke kamera perangkat...</span>
    `;
  }

  try {
    if (!html5QrScannerInstance) {
      html5QrScannerInstance = new Html5Qrcode("qr-reader");
    }

    // Discover available camera devices
    try {
      availableCameraDevices = await Html5Qrcode.getCameras();
      if (availableCameraDevices && availableCameraDevices.length > 1) {
        switchBtn.classList.remove('hidden');
      } else {
        switchBtn.classList.add('hidden');
      }
    } catch (camErr) {
      console.warn('Could not enumerate cameras:', camErr);
    }

    const qrConfig = {
      fps: 15,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const qrboxSize = Math.max(180, Math.floor(minEdge * 0.72));
        return { width: qrboxSize, height: qrboxSize };
      },
      aspectRatio: 1.0
    };

    // Camera selector: Use rear camera on phones or device ID
    let cameraToUse = { facingMode: "environment" };
    if (availableCameraDevices && availableCameraDevices.length > 0) {
      if (currentCameraIndex >= availableCameraDevices.length) {
        currentCameraIndex = 0;
      }
      cameraToUse = availableCameraDevices[currentCameraIndex].id;
    }

    await html5QrScannerInstance.start(
      cameraToUse,
      qrConfig,
      onCameraScanSuccess,
      onCameraScanError
    );

    isScannerRunning = true;
    isScanLocked = false;
    if (btnLabel) btnLabel.textContent = 'Matikan Scanner Kamera';
    if (toggleBtn) {
      toggleBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
      toggleBtn.classList.add('bg-red-600', 'hover:bg-red-700');
    }

    if (statusBadge) {
      statusBadge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
        <span>Kamera Aktif • Arahkan ke Barcode / QR Tiket</span>
      `;
    }
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Failed to start camera:', err);
    wrapper.classList.add('hidden');
    isScannerRunning = false;
    if (btnLabel) btnLabel.textContent = 'Buka Scanner Kamera';
    if (toggleBtn) {
      toggleBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
      toggleBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
    }
    alert(
      'Gagal membuka kamera:\n' + (err.message || err) +
      '\n\nCatatan:\n' +
      '1. Pastikan Anda telah mengizinkan izin Kamera pada browser (Izinkan / Allow).\n' +
      '2. Pada perangkat seluler, gunakan browser Chrome atau Safari.\n' +
      '3. Jika kamera sedang dipakai aplikasi lain, silakan tutup aplikasi tersebut.'
    );
  }
}

async function stopCameraScanner() {
  if (resumeTimerId) {
    clearTimeout(resumeTimerId);
    resumeTimerId = null;
  }
  isScanLocked = false;
  if (html5QrScannerInstance && isScannerRunning) {
    try {
      await html5QrScannerInstance.stop();
    } catch (e) {
      console.warn('Error stopping scanner:', e);
    }
    isScannerRunning = false;
  }
  const wrapper = document.getElementById('scanner-wrapper');
  if (wrapper) wrapper.classList.add('hidden');
  const btnLabel = document.getElementById('btn-toggle-scanner-label');
  if (btnLabel) btnLabel.textContent = 'Buka Scanner Kamera';
  const toggleBtn = document.getElementById('btn-toggle-scanner');
  if (toggleBtn) {
    toggleBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
    toggleBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
  }
  const switchBtn = document.getElementById('btn-switch-camera');
  if (switchBtn) switchBtn.classList.add('hidden');
  if (window.lucide) lucide.createIcons();
}

async function switchScannerCamera() {
  if (!availableCameraDevices || availableCameraDevices.length < 2) return;
  currentCameraIndex = (currentCameraIndex + 1) % availableCameraDevices.length;
  if (isScannerRunning) {
    await stopCameraScanner();
    await startCameraScanner();
  }
}

async function onCameraScanSuccess(decodedText, decodedResult) {
  // 1. Strict lock to prevent any multi-frame race condition
  if (isScanLocked) return;

  const ticketCode = extractTicketCode(decodedText);
  if (!ticketCode) return;

  // 2. Prevent scanning the exact same code twice within 15 seconds
  if (ticketCode === lastScannedTicketCode && (Date.now() - lastScannedTime < 15000)) {
    return;
  }

  // 3. Immediately engage locks
  isScanLocked = true;
  lastScannedTicketCode = ticketCode;
  lastScannedTime = Date.now();

  // 4. FREEZE camera scanning physically so no subsequent frames are processed while reviewing result
  try {
    if (html5QrScannerInstance && isScannerRunning) {
      html5QrScannerInstance.pause(true);
    }
  } catch (pauseErr) {
    console.warn('Camera pause error:', pauseErr);
  }

  // Update status badge
  const statusBadge = document.getElementById('scanner-status-badge');
  if (statusBadge) {
    statusBadge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-indigo-400 animate-spin"></span>
      <span>Memvalidasi Tiket: <strong>${escapeHtml(ticketCode)}</strong>...</span>
    `;
  }

  // Fill manual input for visual consistency
  const input = document.getElementById('checkin-input');
  if (input) input.value = ticketCode;

  // 5. Execute check-in validation
  await executeCheckin(ticketCode);
}

function onCameraScanError(errorMessage) {
  // Frame scan misses are standard while camera is aiming, keep silent
}

// Resumes camera scanning for the next attendee
function resumeCameraScanning() {
  if (resumeTimerId) {
    clearTimeout(resumeTimerId);
    resumeTimerId = null;
  }
  isScanLocked = false;
  lastScannedTicketCode = null;

  try {
    if (html5QrScannerInstance && isScannerRunning) {
      html5QrScannerInstance.resume();
    }
  } catch (resumeErr) {
    console.warn('Camera resume error:', resumeErr);
  }

  const statusBadge = document.getElementById('scanner-status-badge');
  if (statusBadge) {
    statusBadge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
      <span>Kamera Aktif • Arahkan ke Barcode / QR Tiket</span>
    `;
  }

  const input = document.getElementById('checkin-input');
  if (input) input.value = '';

  const resultContainer = document.getElementById('checkin-result');
  if (resultContainer) {
    resultContainer.classList.add('hidden');
  }
}

// Optional countdown to auto-resume camera scanning
function startResumeCountdown(seconds = 5) {
  if (resumeTimerId) clearTimeout(resumeTimerId);
  let remaining = seconds;
  const updateTimerText = () => {
    const countdownEl = document.getElementById('checkin-countdown-timer');
    if (countdownEl) countdownEl.textContent = `(${remaining}d)`;
  };
  updateTimerText();

  const interval = setInterval(() => {
    remaining--;
    updateTimerText();
    if (remaining <= 0) {
      clearInterval(interval);
      resumeTimerId = null;
      resumeCameraScanning();
    }
  }, 1000);

  resumeTimerId = interval;
}

// Execute check-in logic (called by both camera scanner and manual form)
async function executeCheckin(codeToValidate) {
  const code = (codeToValidate || '').trim().toUpperCase();
  if (!code) return;

  if (resumeTimerId) {
    clearTimeout(resumeTimerId);
    resumeTimerId = null;
  }

  const resultContainer = document.getElementById('checkin-result');
  resultContainer.className = 'mt-6 text-left p-5 rounded-2xl border bg-slate-50 border-slate-200';
  resultContainer.innerHTML = `
    <div class="flex items-center gap-2 text-xs text-slate-500">
      <div class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent"></div>
      <span>Memeriksa kode tiket <strong>${escapeHtml(code)}</strong> di database...</span>
    </div>
  `;
  resultContainer.classList.remove('hidden');

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(code)}/checkin`, {
      method: 'POST'
    });
    const result = await res.json();

    if (res.status === 200 && result.success) {
      // 1. SUCCESS CHECK-IN
      playBeepSound('success');
      const order = result.data;
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-emerald-950 shadow-md animate-in zoom-in-95 duration-150';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold shadow-sm">✓</div>
          <div class="flex-1">
            <span class="inline-block px-2.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-bold text-[11px] uppercase tracking-wider mb-1">AKSES DITERIMA • CHECK-IN BERHASIL</span>
            <h3 class="text-xl font-black text-emerald-950">${escapeHtml(order.name)}</h3>
            <p class="text-xs text-emerald-800 font-medium">${escapeHtml(order.performance_session || 'Sesi Umum')} • ${escapeHtml(order.institution || 'Umum')} • ${order.phone}</p>
            
            <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-white/70 p-3 rounded-xl border border-emerald-100">
              <div>
                <span class="text-emerald-700 block text-[10px] font-semibold">KODE TIKET</span>
                <strong class="text-sm font-mono font-bold text-slate-800">${escapeHtml(order.order_id)}</strong>
              </div>
              <div>
                <span class="text-emerald-700 block text-[10px] font-semibold">JUMLAH TIKET</span>
                <strong class="text-sm font-bold text-slate-800">${order.ticket_qty} Tiket (Pax)</strong>
              </div>
              <div class="col-span-2 sm:col-span-1">
                <span class="text-emerald-700 block text-[10px] font-semibold">WAKTU MASUK</span>
                <strong class="text-sm font-bold text-slate-800">${new Date(order.checked_in_at || Date.now()).toLocaleTimeString('id-ID')} WIB</strong>
              </div>
            </div>
            
            <div class="mt-4 flex flex-wrap items-center gap-2.5">
              <button type="button" onclick="resumeCameraScanning()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition flex items-center gap-1.5">
                <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                <span>Scan Tiket Berikutnya <span id="checkin-countdown-timer">(5d)</span></span>
              </button>
              <button type="button" onclick="uncheckinOrder('${order.id}', '${order.order_id}')" class="bg-white hover:bg-red-50 text-red-600 border border-red-200 font-semibold px-3 py-2 rounded-xl text-xs transition">
                ↩️ Batalkan Check-in
              </button>
            </div>
          </div>
        </div>
      `;

      // Cache checked-in state locally
      try {
        const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
        existingOverrides[order.order_id] = {
          status: 'verified',
          checked_in: 1,
          name: order.name,
          phone: order.phone
        };
        localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
      } catch (e) {}

      loadStats();
      startResumeCountdown(5);
    } else if (res.status === 409) {
      // 2. WARNING: ALREADY CHECKED IN
      playBeepSound('warning');
      const order = result.data || {};
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-red-500 bg-red-50 text-red-950 shadow-md';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold shadow-sm">✕</div>
          <div class="flex-1">
            <span class="inline-block px-2.5 py-0.5 rounded-full bg-red-200 text-red-900 font-bold text-[11px] uppercase tracking-wider mb-1">PERINGATAN: TIKET SUDAH DIGUNAKAN!</span>
            <h3 class="text-lg font-black text-red-950">${escapeHtml(result.message)}</h3>
            <p class="text-xs text-red-800 mt-1">Pemegang Tiket: <strong>${escapeHtml(order.name || '-')}</strong> (${escapeHtml(order.performance_session || order.institution || '-')})</p>
            <p class="text-[11px] text-red-700 mt-2 bg-red-100/70 p-2.5 rounded-xl border border-red-200 font-medium">
              ⚠️ Tamu ini sudah pernah tercatat masuk sebelumnya pada <strong>${order.checked_in_at ? new Date(order.checked_in_at).toLocaleTimeString('id-ID') + ' WIB' : 'hari ini'}</strong>. Jika tamu hanya keluar sebentar atau panitia sedang menguji coba, klik tombol reset di bawah.
            </p>
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onclick="resumeCameraScanning()" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition flex items-center gap-1.5">
                <i data-lucide="camera" class="w-3.5 h-3.5"></i>
                <span>Scan Tiket Lain</span>
              </button>
              ${order.id ? `
                <button type="button" onclick="uncheckinOrder('${order.id}', '${order.order_id}')" class="bg-white hover:bg-amber-50 text-amber-800 border border-amber-300 font-semibold px-3 py-2 rounded-xl text-xs transition">
                  ↩️ Reset / Izinkan Masuk Ulang
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      // 3. REJECTED / UNPAID / NOT FOUND
      playBeepSound('error');
      const order = result.data || null;
      const isPending = order && order.status === 'pending';
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-amber-500 bg-amber-50 text-amber-950 shadow-md';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold shadow-sm">!</div>
          <div class="flex-1">
            <span class="inline-block px-2.5 py-0.5 rounded-full bg-amber-200 text-amber-900 font-bold text-[11px] uppercase tracking-wider mb-1">AKSES DITOLAK • ${isPending ? 'BELUM LUNAS' : 'TIKET TIDAK VALID'}</span>
            <h3 class="text-base font-bold text-amber-950">${escapeHtml(result.message || 'Tiket tidak ditemukan')}</h3>
            ${order ? `
              <div class="mt-2 text-xs text-amber-800 bg-white/60 p-2.5 rounded-xl border border-amber-200">
                <p>Nama: <strong>${escapeHtml(order.name)}</strong> • ${order.phone}</p>
                <p>Sesi: <strong>${escapeHtml(order.performance_session || order.ticket_category || '-')}</strong> (${order.ticket_qty} Tiket)</p>
                <p>Tagihan: <strong>Rp ${formatRupiah(order.total_amount)}</strong> (Status: <span class="uppercase font-bold text-amber-700">${order.status}</span>)</p>
              </div>
            ` : ''}
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onclick="resumeCameraScanning()" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition">
                <span>Scan Tiket Lain</span>
              </button>
              ${isPending ? `
                <button type="button" onclick="quickVerifyAndCheckin('${order.id}', '${order.order_id}')" class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-xs shadow-sm transition flex items-center gap-1.5">
                  <i data-lucide="check" class="w-3.5 h-3.5"></i>
                  <span>Verifikasi Lunas & Izinkan Masuk</span>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }
  } catch (err) {
    playBeepSound('error');
    resultContainer.className = 'mt-6 text-left p-5 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs';
    resultContainer.innerHTML = `
      <p class="font-bold">Terjadi kesalahan sistem: ${escapeHtml(err.message)}</p>
      <button type="button" onclick="resumeCameraScanning()" class="mt-3 bg-red-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs">
        Coba Scan Ulang
      </button>
    `;
  } finally {
    if (window.lucide) lucide.createIcons();
  }
}

async function uncheckinOrder(id, orderId) {
  try {
    const res = await fetch(`/api/orders/${id}/uncheckin`, { method: 'POST' });
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    showToast(`✓ Check-in ${orderId} berhasil dibatalkan!`, 'success');

    // Update local cache
    try {
      const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
      if (existingOverrides[orderId]) {
        existingOverrides[orderId].checked_in = 0;
        localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
      }
    } catch (e) {}

    loadStats();
    resumeCameraScanning();
  } catch (e) {
    alert('Gagal membatalkan check-in: ' + e.message);
  }
}

async function quickVerifyAndCheckin(id, orderId) {
  if (!confirm(`Verifikasi pembayaran tiket ${orderId} sebagai LUNAS dan izinkan tamu langsung masuk?`)) return;
  try {
    const res = await fetch(`/api/orders/${id}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verified_by: 'Panitia Gate (Pintu Masuk)' })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.message);
    showToast(`✓ Tiket ${orderId} telah diverifikasi LUNAS!`, 'success');

    try {
      const existingOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
      existingOverrides[orderId] = { status: 'verified', checked_in: 1 };
      localStorage.setItem('school_ticket_orders_state', JSON.stringify(existingOverrides));
    } catch (e) {}

    await executeCheckin(orderId);
  } catch (e) {
    alert('Gagal memverifikasi tiket: ' + e.message);
  }
}

async function handleCheckinSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('checkin-input');
  const code = (input.value || '').trim();
  if (!code) return;
  await executeCheckin(code);
}

// ==========================================
// MANUAL ORDER / OTS
// ==========================================
function updateManualPrice() {
  const cat = document.getElementById('manual-ticket-cat').value;
  const qty = parseInt(document.getElementById('manual-ticket-qty').value || 1, 10);
  const prices = currentSettings.ticket_prices || { 'Default': 75000, 'Reguler': 75000 };
  const price = prices[cat] || prices['Default'] || 75000;
  document.getElementById('manual-ticket-total').value = price * qty;
}

async function handleManualOrder(e) {
  e.preventDefault();
  const form = document.getElementById('manual-order-form');
  const formData = new FormData(form);

  try {
    const res = await fetch('/api/orders/manual', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.message);

    showToast(`Tiket ${result.data.order_id} berhasil dibuat!`, 'success');

    if (result.direct_wa_link) {
      if (confirm(`Pesanan dibuat!\nBuka WhatsApp untuk mengirimkan tiket ke ${result.data.name}?`)) {
        window.open(result.direct_wa_link, '_blank');
      }
    }

    form.reset();
    updateManualPrice();
    switchTab('orders');
    loadStats();
    loadOrders();
  } catch (err) {
    alert('Gagal membuat pesanan: ' + err.message);
  }
}

// ==========================================
// SETTINGS & INTEGRATION
// ==========================================
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const result = await res.json();
    if (!result.success) return;

    currentSettings = result.data || {};

    // Check if client has local backup in localStorage
    const savedLocalStr = localStorage.getItem('school_ticket_persistent_settings');
    let savedLocal = null;
    try {
      if (savedLocalStr) savedLocal = JSON.parse(savedLocalStr);
    } catch (e) {}

    let savedOverrides = {};
    try {
      savedOverrides = JSON.parse(localStorage.getItem('school_ticket_orders_state') || '{}');
    } catch (e) {}

    const hasOverrides = Object.keys(savedOverrides).length > 0;
    const isCustomizedLocal = savedLocal && (savedLocal._customized === true || savedLocal._updatedAt);

    // Check if browser has customized settings or order overrides that need auto-healing
    let shouldRecover = false;
    if (hasOverrides) shouldRecover = true;
    if (isCustomizedLocal) {
      if (savedLocal.event_name && savedLocal.event_name !== currentSettings.event_name) shouldRecover = true;
      if (savedLocal.school_name && savedLocal.school_name !== currentSettings.school_name) shouldRecover = true;
      if (savedLocal.contact_person && savedLocal.contact_person !== currentSettings.contact_person) shouldRecover = true;
      if (savedLocal.wa_api_token && savedLocal.wa_api_token !== currentSettings.wa_api_token) shouldRecover = true;
      if (savedLocal.google_sheet_url && savedLocal.google_sheet_url !== currentSettings.google_sheet_url) shouldRecover = true;
    }

    if (shouldRecover) {
      console.log('Restoring user session data from browser storage...');
      try {
        const syncRes = await fetch('/api/settings/backup-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            settings: isCustomizedLocal ? savedLocal : undefined,
            overrides: hasOverrides ? savedOverrides : undefined
          })
        });
        const syncData = await syncRes.json();
        if (syncData.success && syncData.data) {
          currentSettings = syncData.data;
          showToast('Data & pengaturan sesi Anda berhasil dipulihkan otomatis!', 'info');
        }
      } catch (err) {
        console.warn('Auto-recovery error:', err);
      }
    } else if (!savedLocal && currentSettings.google_sheet_url) {
      // Only seed localStorage if completely empty
      localStorage.setItem('school_ticket_persistent_settings', JSON.stringify(currentSettings));
    }

    document.getElementById('top-event-name').textContent = currentSettings.event_name || 'Kegiatan Sekolah';

    // Helper safely sets field values
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val !== undefined && val !== null ? val : '';
    };

    setVal('setting-event-name', currentSettings.event_name || '');
    setVal('setting-school-name', currentSettings.school_name || '');
    setVal('setting-event-date', currentSettings.event_date || '');
    setVal('setting-event-time', currentSettings.event_time || '');
    setVal('setting-event-location', currentSettings.event_location || '');
    setVal('setting-contact-person', currentSettings.contact_person || '');
    setVal('setting-ticket-price', currentSettings.ticket_price || 75000);
    setVal('setting-gateway-type', currentSettings.wa_gateway_type || 'fonnte');
    setVal('setting-wa-token', currentSettings.wa_api_token || '');
    setVal('setting-template-receipt', currentSettings.template_receipt || '');
    setVal('setting-template-verified', currentSettings.template_verified || '');

    // Spreadsheet URL
    const sheetUrl = currentSettings.google_sheet_url || '';
    setVal('setting-sheet-url', sheetUrl);
    setVal('sheet-sync-url', sheetUrl);

    // Auto sync toggle
    const autoSyncEl = document.getElementById('setting-auto-sync');
    if (autoSyncEl) {
      autoSyncEl.checked = currentSettings.auto_sync_enabled !== false && currentSettings.auto_sync_enabled !== 'false';
    }

    // Render bank accounts
    renderBankAccounts(currentSettings.bank_accounts || []);
    updateManualPrice();
  } catch (err) {
    console.error('Error loading settings:', err);
  }
}

function renderBankAccounts(banks) {
  const container = document.getElementById('bank-accounts-container');
  if (!container) return;

  container.innerHTML = banks.map((b, idx) => `
    <div class="flex items-center gap-2 bank-row">
      <input type="text" placeholder="Bank (BCA/Mandiri/BRI/DANA)" value="${escapeHtml(b.bank)}" class="bank-name w-1/4 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl">
      <input type="text" placeholder="Nomor Rekening" value="${escapeHtml(b.number)}" class="bank-number w-1/3 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono">
      <input type="text" placeholder="Atas Nama" value="${escapeHtml(b.holder)}" class="bank-holder flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl">
      <button type="button" onclick="removeBankRow(this)" class="p-1.5 text-red-500 hover:text-red-700 rounded-lg">✕</button>
    </div>
  `).join('');
}

function addBankRow() {
  const container = document.getElementById('bank-accounts-container');
  const div = document.createElement('div');
  div.className = 'flex items-center gap-2 bank-row';
  div.innerHTML = `
    <input type="text" placeholder="Bank (BCA/Mandiri/BRI/DANA)" value="" class="bank-name w-1/4 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl">
    <input type="text" placeholder="Nomor Rekening" value="" class="bank-number w-1/3 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl font-mono">
    <input type="text" placeholder="Atas Nama" value="" class="bank-holder flex-1 px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl">
    <button type="button" onclick="removeBankRow(this)" class="p-1.5 text-red-500 hover:text-red-700 rounded-lg">✕</button>
  `;
  container.appendChild(div);
}

function removeBankRow(btn) {
  btn.closest('.bank-row').remove();
}

async function handleSaveSettings(e) {
  e.preventDefault();

  // Read bank rows
  const bankRows = document.querySelectorAll('.bank-row');
  const banks = [];
  bankRows.forEach(row => {
    const bank = row.querySelector('.bank-name').value.trim();
    const number = row.querySelector('.bank-number').value.trim();
    const holder = row.querySelector('.bank-holder').value.trim();
    if (bank && number) banks.push({ bank, number, holder });
  });

  const getElVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  };

  const payload = {
    event_name: getElVal('setting-event-name'),
    school_name: getElVal('setting-school-name'),
    event_date: getElVal('setting-event-date'),
    event_time: getElVal('setting-event-time'),
    event_location: getElVal('setting-event-location'),
    contact_person: getElVal('setting-contact-person'),
    ticket_price: parseInt(getElVal('setting-ticket-price') || 75000, 10),
    google_sheet_url: getElVal('setting-sheet-url'),
    auto_sync_enabled: document.getElementById('setting-auto-sync') ? document.getElementById('setting-auto-sync').checked : true,
    wa_gateway_type: getElVal('setting-gateway-type'),
    wa_api_token: getElVal('setting-wa-token'),
    template_receipt: getElVal('setting-template-receipt'),
    template_verified: getElVal('setting-template-verified'),
    bank_accounts: banks
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.message);

    // Save to localStorage as well for browser auto-healing
    payload._customized = true;
    payload._updatedAt = Date.now();
    localStorage.setItem('school_ticket_persistent_settings', JSON.stringify(payload));

    showToast('Pengaturan berhasil disimpan permanen!', 'success');
    await loadSettings();
  } catch (err) {
    alert('Gagal menyimpan pengaturan: ' + err.message);
  }
}

// ==========================================
// BACKUP & RESTORE PERSISTENCE TOOLS
// ==========================================
function exportSettingsBackup() {
  window.location.href = '/api/settings/export';
}

async function handleImportBackup(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data || (!data.settings && !data.orders_cache)) {
        throw new Error('Format file cadangan tidak valid (harus file JSON backup sistem tiket).');
      }

      showToast('Memulihkan data cadangan...', 'info');

      const res = await fetch('/api/settings/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const result = await res.json();

      if (!result.success) throw new Error(result.message || result.error);

      if (result.data) {
        localStorage.setItem('school_ticket_persistent_settings', JSON.stringify(result.data));
      }

      showToast('✓ Data dan pengaturan berhasil dipulihkan secara penuh!', 'success');
      await Promise.all([loadSettings(), loadStats(), loadOrders()]);
      if (typeof loadSessionRecap === 'function') loadSessionRecap();
    } catch (err) {
      alert('Gagal memulihkan file cadangan: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function handleQuickSheetSync() {
  const urlInput = document.getElementById('setting-sheet-url');
  const sheetUrl = (urlInput ? urlInput.value.trim() : '') || currentSettings.google_sheet_url;
  if (!sheetUrl) {
    alert('Masukkan link Google Spreadsheet terlebih dahulu.');
    return;
  }

  const btn = document.getElementById('btn-quick-sync');
  const icon = document.getElementById('quick-sync-icon');
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add('animate-spin');

  try {
    const res = await fetch('/api/sync/google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url: sheetUrl, send_wa: false })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error || result.message);

    showToast(`✓ Sinkronisasi Sukses! ${result.data.newOrders} data baru ditarik.`, 'success');
    await Promise.all([loadStats(), loadOrders()]);
    if (typeof loadSessionRecap === 'function') loadSessionRecap();
    
    const badge = document.getElementById('sync-last-status');
    if (badge) {
      badge.textContent = `Tersinkron (${result.data.totalRecords} baris)`;
    }
  } catch (err) {
    alert('Gagal menyinkronkan Google Sheet: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove('animate-spin');
  }
}

async function testWhatsAppMessage() {
  const phone = document.getElementById('test-wa-phone').value.trim();
  if (!phone) {
    alert('Masukkan nomor WhatsApp uji coba terlebih dahulu');
    return;
  }

  showToast('Mengirim pesan uji coba...', 'info');

  try {
    const res = await fetch('/api/test-wa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const result = await res.json();

    if (result.success) {
      showToast('✓ Pesan WhatsApp uji coba berhasil dikirim!', 'success');
    } else {
      alert(`Hasil Pengiriman:\n${result.message}\n\nAnda dapat membuka tautan WhatsApp berikut untuk tes manual:`);
      window.open(result.directLink, '_blank');
    }
  } catch (err) {
    alert('Gagal kirim: ' + err.message);
  }
}

// ==========================================
// APPS SCRIPT CODE TEMPLATE
// ==========================================
function generateAppsScriptTemplate() {
  const origin = window.location.origin || 'http://localhost:3000';
  const webhookUrl = `${origin}/api/webhook/order`;
  const token = currentSettings.wa_api_token || 'TOKEN_FONNTE_ANDA_JIKA_LANGSUNG_DARI_GAS';

  const code = `/**
 * =========================================================================
 * GOOGLE APPS SCRIPT: INTEGRASI GOOGLE FORM & WHATSAPP TICKET RECEIPT
 * Kegiatan: ${currentSettings.event_name || 'Tiket Kegiatan Sekolah'}
 * =========================================================================
 * CARA MEMASANG:
 * 1. Buka Google Sheets yang tersambung dengan Google Form penjualan tiket
 * 2. Klik menu: Ekstensi > Apps Script
 * 3. Hapus semua kode yang ada, lalu Paste kode ini
 * 4. Pasang Trigger: Klik ikon Jam di kiri > + Add Trigger
 *    - Pilih fungsi: onFormSubmit
 *    - Sumber acara: Dari spreadsheet
 *    - Jenis acara : Saat mengirim formulir (On form submit)
 *    - Klik Save
 * =========================================================================
 */

// Konfigurasi Webhook ke Dashboard
const WEBHOOK_URL = "${webhookUrl}";

// Konfigurasi WhatsApp Gateway (Fonnte) jika ingin dikirim langsung dari Google Sheets
const FONNTE_API_TOKEN = "${token}";

function onFormSubmit(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    const row = sheet.getLastRow();
    
    // Ambil semua header kolom baris ke-1
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const rowData = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    
    // Mapping data form berdasarkan nama kolom
    const data = {};
    headers.forEach((header, index) => {
      const cleanHeader = header.toString().trim().toLowerCase();
      data[cleanHeader] = rowData[index];
    });

    Logger.log("Form Response Received: " + JSON.stringify(data));

    // Ekstraksi field kunci
    const name = findField(data, ["nama", "nama lengkap", "name"]);
    const rawPhone = findField(data, ["nomor wa", "no wa", "whatsapp", "no hp", "telepon", "phone"]);
    const institution = findField(data, ["kelas", "asal kelas", "instansi", "sekolah"]);
    const category = findField(data, ["kategori", "kategori tiket", "jenis tiket"]) || "Reguler";
    const qty = parseInt(findField(data, ["jumlah", "jumlah tiket", "qty"]) || "1", 10) || 1;
    const paymentMethod = findField(data, ["metode", "metode transfer", "bank"]) || "Transfer Bank";
    const proofUrl = findField(data, ["bukti", "bukti transfer", "upload bukti", "bukti bayar"]) || "";

    // Generate Order ID Unik jika belum ada
    const orderId = "TIX-" + Math.floor(1000 + Math.random() * 9000);

    // Kirim payload ke Dashboard Webhook
    const payload = {
      order_id: orderId,
      name: name,
      phone: rawPhone,
      institution: institution,
      ticket_category: category,
      ticket_qty: qty,
      payment_method: paymentMethod,
      payment_proof_url: proofUrl,
      source: "google_form"
    };

    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    Logger.log("Dashboard Webhook Response: " + response.getContentText());

    // Tulis balik Kode Tiket & Status ke Spreadsheet
    ensureColumnAndWrite(sheet, row, headers, "KODE TIKET", orderId);
    ensureColumnAndWrite(sheet, row, headers, "STATUS VERIFIKASI", "Menunggu Verifikasi");

  } catch (error) {
    Logger.log("Error onFormSubmit: " + error.toString());
  }
}

// Helper untuk mencari nama kolom fleksibel
function findField(data, possibleKeys) {
  for (let key in data) {
    for (let p of possibleKeys) {
      if (key.indexOf(p) !== -1) {
        return data[key];
      }
    }
  }
  return "";
}

// Helper untuk menulis kembali ke sheet
function ensureColumnAndWrite(sheet, row, headers, colName, value) {
  let colIndex = headers.indexOf(colName) + 1;
  if (colIndex === 0) {
    colIndex = sheet.getLastColumn() + 1;
    sheet.getRange(1, colIndex).setValue(colName);
  }
  sheet.getRange(row, colIndex).setValue(value);
}
`;

  const block = document.getElementById('gas-code-block');
  if (block) block.textContent = code;
}

function copyAppsScriptCode() {
  const block = document.getElementById('gas-code-block');
  if (!block) return;

  navigator.clipboard.writeText(block.textContent).then(() => {
    const btnText = document.getElementById('copy-btn-text');
    btnText.textContent = 'Tersalin!';
    showToast('Kode Google Apps Script berhasil disalin ke clipboard!', 'success');
    setTimeout(() => {
      btnText.textContent = 'Salin Kode';
    }, 2000);
  });
}

// ==========================================
// UTILITIES
// ==========================================
function formatRupiah(num) {
  return new Intl.NumberFormat('id-ID').format(Number(num) || 0);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const box = document.getElementById('toast-box');
  const icon = document.getElementById('toast-icon');
  const msg = document.getElementById('toast-msg');

  msg.textContent = message;

  if (type === 'success') {
    box.className = 'bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2';
    icon.textContent = '✓';
  } else if (type === 'info') {
    box.className = 'bg-indigo-600 text-white px-5 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2';
    icon.textContent = 'ℹ';
  } else {
    box.className = 'bg-red-600 text-white px-5 py-3 rounded-2xl shadow-xl text-xs font-semibold flex items-center gap-2';
    icon.textContent = '✕';
  }

  toast.classList.remove('translate-y-24', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-24', 'opacity-0');
  }, 3500);
}

// ==========================================
// REKAP SESI PERTUNJUKAN
// ==========================================
let currentRecapData = null;

async function loadSessionRecap() {
  const container = document.getElementById('recap-cards-container');
  if (container) {
    container.innerHTML = `
      <div class="col-span-full py-8 text-center text-slate-400">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent mb-2"></div>
        <p class="text-xs">Memuat rekapitulasi sesi pertunjukan...</p>
      </div>
    `;
  }

  try {
    const res = await fetch('/api/recap/sessions');
    const result = await res.json();
    if (!result.success) throw new Error(result.error);

    currentRecapData = result.data;
    renderRecapCards(currentRecapData.summary);
    renderRecapMatrix(currentRecapData.summary);
    populateRecapSessionFilter(currentRecapData.summary);
    filterRecapOrders();
  } catch (err) {
    if (container) {
      container.innerHTML = `<div class="col-span-full text-red-500 text-xs py-4 text-center">Gagal memuat rekap: ${err.message}</div>`;
    }
  }
}

function renderRecapCards(summaryList) {
  const container = document.getElementById('recap-cards-container');
  if (!container) return;

  if (!summaryList || summaryList.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center text-slate-400 py-8 text-xs bg-white rounded-2xl border border-slate-200">Belum ada data sesi pertunjukan.</div>`;
    return;
  }

  container.innerHTML = summaryList.map((s) => {
    const percentVerified = s.total_tickets > 0 ? Math.round((s.verified_tickets / s.total_tickets) * 100) : 0;

    return `
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden flex flex-col justify-between hover:border-indigo-200 transition">
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
              <i data-lucide="sparkles" class="w-3.5 h-3.5 text-indigo-600"></i>
              ${escapeHtml(s.session_name)}
            </span>
            <span class="text-xs font-semibold text-slate-400">${s.total_orders} Pesanan</span>
          </div>

          <div class="flex items-baseline gap-2 mb-2">
            <span class="text-3xl font-black text-slate-900">${s.total_tickets}</span>
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wide">Total Tiket (Pax)</span>
          </div>

          <!-- Progress Bar Verified -->
          <div class="mb-3">
            <div class="flex justify-between text-[10px] text-slate-500 font-semibold mb-1">
              <span>Tingkat Pelunasan</span>
              <span class="text-emerald-700">${percentVerified}% (${s.verified_tickets}/${s.total_tickets})</span>
            </div>
            <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
              <div class="bg-emerald-500 h-2 rounded-full transition-all duration-500" style="width: ${percentVerified}%"></div>
            </div>
          </div>

          <!-- Mini Breakdown -->
          <div class="grid grid-cols-2 gap-2 text-xs mb-4">
            <div class="p-2.5 rounded-xl bg-emerald-50/80 border border-emerald-100">
              <span class="text-emerald-700 text-[10px] block font-bold uppercase tracking-wider">Tiket Lunas</span>
              <strong class="text-emerald-950 text-base font-extrabold">${s.verified_tickets}</strong>
              <span class="text-[10px] text-emerald-700 block">Pax</span>
            </div>
            <div class="p-2.5 rounded-xl bg-amber-50/80 border border-amber-100">
              <span class="text-amber-700 text-[10px] block font-bold uppercase tracking-wider">Pending</span>
              <strong class="text-amber-950 text-base font-extrabold">${s.pending_tickets}</strong>
              <span class="text-[10px] text-amber-700 block">Pax</span>
            </div>
          </div>
        </div>

        <div class="border-t border-slate-100 pt-3 flex items-center justify-between text-xs">
          <div>
            <span class="text-slate-400 text-[10px] block">Pendapatan Lunas</span>
            <strong class="text-indigo-900 text-sm font-black">Rp ${formatRupiah(s.verified_revenue)}</strong>
          </div>
          <div class="text-right">
            <span class="text-slate-400 text-[10px] block">Kehadiran Gate</span>
            <strong class="text-slate-700 text-xs font-bold">${s.checked_in_tickets} Hadir</strong>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function renderRecapMatrix(summaryList) {
  const tbody = document.getElementById('recap-matrix-tbody');
  if (!tbody) return;

  if (!summaryList || summaryList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-slate-400 text-xs">Belum ada data sesi</td></tr>`;
    return;
  }

  tbody.innerHTML = summaryList.map(s => `
    <tr class="hover:bg-slate-50/80 transition text-xs">
      <td class="py-3 px-4 font-bold text-slate-900">
        <span class="inline-flex items-center gap-1.5">
          <i data-lucide="tag" class="w-3.5 h-3.5 text-indigo-500"></i>
          ${escapeHtml(s.session_name)}
        </span>
      </td>
      <td class="py-3 px-4 text-center font-medium text-slate-600">${s.total_orders} Pesanan</td>
      <td class="py-3 px-4 text-center font-black text-slate-900 text-sm">${s.total_tickets} Pax</td>
      <td class="py-3 px-4 text-center font-bold text-emerald-600 bg-emerald-50/30">${s.verified_tickets}</td>
      <td class="py-3 px-4 text-center font-bold text-amber-600 bg-amber-50/30">${s.pending_tickets}</td>
      <td class="py-3 px-4 text-right font-black text-indigo-950">Rp ${formatRupiah(s.verified_revenue)}</td>
      <td class="py-3 px-4 text-center font-semibold text-slate-700">
        <span class="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-bold">${s.checked_in_tickets} Tamu</span>
      </td>
    </tr>
  `).join('');

  if (window.lucide) lucide.createIcons();
}

function populateRecapSessionFilter(summaryList) {
  const select = document.getElementById('recap-session-filter');
  if (!select) return;

  const currentVal = select.value || 'all';
  select.innerHTML = '<option value="all">Semua Sesi Pertunjukan</option>' +
    summaryList.map(s => `<option value="${escapeHtml(s.session_name)}">${escapeHtml(s.session_name)} (${s.total_tickets} Tiket)</option>`).join('');
  select.value = currentVal;
}

function filterRecapOrders() {
  const select = document.getElementById('recap-session-filter');
  const filter = select ? select.value : 'all';
  const tbody = document.getElementById('recap-guestlist-tbody');
  if (!tbody || !currentRecapData) return;

  let orders = currentRecapData.orders || [];
  if (filter !== 'all') {
    orders = orders.filter(o => o.session_name === filter);
  }

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 text-xs">Tidak ada data penonton untuk sesi ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map((o, idx) => {
    const isLunas = o.status === 'verified';
    const isHadir = o.checked_in === 1;

    return `
      <tr class="hover:bg-slate-50/80 transition text-xs">
        <td class="py-3 px-3 text-slate-400 font-semibold">${idx + 1}</td>
        <td class="py-3 px-3 font-mono font-bold text-indigo-900">${o.order_id}</td>
        <td class="py-3 px-3">
          <strong class="text-slate-900 block">${escapeHtml(o.name)}</strong>
          <span class="text-[10px] text-slate-400 block">${escapeHtml(o.email || '-')}</span>
        </td>
        <td class="py-3 px-3 font-semibold text-slate-700 whitespace-nowrap">${o.phone}</td>
        <td class="py-3 px-3">
          <span class="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold text-[10px] whitespace-nowrap">${escapeHtml(o.session_name)}</span>
        </td>
        <td class="py-3 px-3 text-center font-extrabold text-slate-900 text-sm">${o.ticket_qty}</td>
        <td class="py-3 px-3 text-slate-600">
          <span class="block font-medium truncate max-w-[140px]">${escapeHtml(o.sender_account_name || '-')}</span>
          <span class="text-[10px] text-slate-400">Trf: ${escapeHtml(o.has_transferred || '-')}</span>
        </td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${isLunas ? '<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">Lunas</span>' : '<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold text-[10px]">Pending</span>'}
        </td>
        <td class="py-3 px-3 text-center whitespace-nowrap">
          ${isHadir ? `<span class="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[10px]">✓ Hadir (${new Date(o.checked_in_at).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit'})})</span>` : '<span class="text-slate-400 text-[11px] font-medium">Belum</span>'}
        </td>
      </tr>
    `;
  }).join('');
}

function printSessionRecap() {
  window.print();
}

// ==========================================
// GOOGLE SHEET DIRECT LIVE SYNC
// ==========================================
function openSheetSyncModal() {
  const modal = document.getElementById('sheet-sync-modal');
  if (!modal) return;
  modal.classList.remove('hidden');

  fetch('/api/sync/google-sheet')
    .then(res => res.json())
    .then(res => {
      if (res.success && res.data.sheet_url) {
        const input = document.getElementById('sheet-sync-url');
        if (input && !input.value) input.value = res.data.sheet_url;
      }
    }).catch(() => {});

  if (window.lucide) lucide.createIcons();
}

function closeSheetSyncModal() {
  const modal = document.getElementById('sheet-sync-modal');
  if (modal) modal.classList.add('hidden');
}

async function handleGoogleSheetSync(e) {
  e.preventDefault();
  const urlInput = document.getElementById('sheet-sync-url');
  const sendWaCheckbox = document.getElementById('sync-send-wa');
  const submitBtn = document.getElementById('sync-submit-btn');
  const spinner = document.getElementById('sync-btn-spinner');
  const label = document.getElementById('sync-btn-label');

  const sheetUrl = urlInput.value.trim();
  if (!sheetUrl) return;

  submitBtn.disabled = true;
  if (spinner) spinner.classList.add('animate-spin');
  if (label) label.textContent = 'Sedang Menyinkronkan...';

  try {
    const res = await fetch('/api/sync/google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheet_url: sheetUrl,
        send_wa: sendWaCheckbox ? sendWaCheckbox.checked : false
      })
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.error || result.message);

    showToast(`✓ Sinkronisasi Sukses! ${result.data.newOrders} data baru ditarik.`, 'success');
    closeSheetSyncModal();
    loadStats();
    loadOrders();
    if (typeof loadSessionRecap === 'function') loadSessionRecap();
  } catch (err) {
    alert('Gagal menyinkronkan Google Sheet:\n\n' + err.message);
  } finally {
    submitBtn.disabled = false;
    if (spinner) spinner.classList.remove('animate-spin');
    if (label) label.textContent = 'Tarik & Sinkronkan Sekarang';
  }
}


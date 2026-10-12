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
  loadInvitations();
  loadCapacityRecap();
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
  if (typeof loadInvitations === 'function') tasks.push(loadInvitations());
  if (typeof loadCapacityRecap === 'function') tasks.push(loadCapacityRecap());
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

  const tabs = ['overview', 'orders', 'parents', 'capacity', 'recap', 'checkin', 'manual', 'settings'];
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

  if (tabId === 'parents') {
    loadInvitations();
  }
  if (tabId === 'capacity') {
    loadCapacityRecap();
  }
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

    const formattedDate = formatDateTime(order.created_at);

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
function parseFormDate(str) {
  if (!str) return new Date();
  if (str instanceof Date) return str;
  str = String(str).trim();

  // Format DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hours = parseInt(dmyMatch[4] || '0', 10);
    const minutes = parseInt(dmyMatch[5] || '0', 10);
    const seconds = parseInt(dmyMatch[6] || '0', 10);
    return new Date(year, month, day, hours, minutes, seconds);
  }

  // Format YYYY-MM-DD
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hours = parseInt(ymdMatch[4] || '0', 10);
    const minutes = parseInt(ymdMatch[5] || '0', 10);
    const seconds = parseInt(ymdMatch[6] || '0', 10);
    return new Date(year, month, day, hours, minutes, seconds);
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return new Date();
}

function formatDateTime(str) {
  if (!str) return '-';
  str = String(str).trim();

  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    const year = parseInt(dmyMatch[3], 10);
    const hours = parseInt(dmyMatch[4] || '0', 10);
    const minutes = parseInt(dmyMatch[5] || '0', 10);
    const seconds = parseInt(dmyMatch[6] || '0', 10);
    const d = new Date(year, month, day, hours, minutes, seconds);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{1,2})[:\.](\d{1,2})(?:[:\.](\d{1,2}))?)?/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    const hours = parseInt(ymdMatch[4] || '0', 10);
    const minutes = parseInt(ymdMatch[5] || '0', 10);
    const seconds = parseInt(ymdMatch[6] || '0', 10);
    const d = new Date(year, month, day, hours, minutes, seconds);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }
  return str;
}

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

// ==========================================
// ORANG TUA SISWA & TAMU UNDANGAN
// ==========================================
let allInvitations = [];
let parentSearchDebounceTimer = null;
let currentEditingInvitation = null;

async function loadInvitations() {
  const tbody = document.getElementById('parents-tbody');
  if (!tbody) return;

  const search = (document.getElementById('parent-search-input')?.value || '').trim();
  const classGrade = document.getElementById('parent-filter-class')?.value || 'all';
  const session = document.getElementById('parent-filter-session')?.value || 'all';
  const swapped = document.getElementById('parent-filter-swapped')?.value || 'all';
  const gate = document.getElementById('parent-filter-gate')?.value || 'all';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (classGrade !== 'all') params.append('class_grade', classGrade);
  if (session !== 'all') params.append('session', session);
  if (swapped !== 'all') params.append('is_swapped', swapped);
  if (gate !== 'all') params.append('checked_in', gate);

  try {
    const res = await fetch(`/api/invitations?${params.toString()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Gagal memuat data');

    allInvitations = json.data || [];
    const meta = json.meta || {};

    // Update KPI counters
    const kpiStudents = document.getElementById('kpi-parent-students');
    if (kpiStudents) kpiStudents.textContent = meta.totalParents || 0;

    const kpiParentTotalTickets = document.getElementById('kpi-parent-total-tickets');
    if (kpiParentTotalTickets) kpiParentTotalTickets.textContent = `${(meta.parentTicketsS1 || 0) + (meta.parentTicketsS2 || 0)} Tiket Ortu`;

    const kpiS1Tickets = document.getElementById('kpi-parent-s1-tickets');
    if (kpiS1Tickets) kpiS1Tickets.textContent = meta.parentTicketsS1 || 0;

    const kpiS1Students = document.getElementById('kpi-parent-s1-students');
    if (kpiS1Students) {
      const s1StudentsCount = allInvitations.filter(x => x.type === 'parent' && x.session === 'Sesi 1').length;
      kpiS1Students.textContent = `${s1StudentsCount} Siswa Alokasi S1`;
    }

    const kpiS2Tickets = document.getElementById('kpi-parent-s2-tickets');
    if (kpiS2Tickets) kpiS2Tickets.textContent = meta.parentTicketsS2 || 0;

    const kpiS2Students = document.getElementById('kpi-parent-s2-students');
    if (kpiS2Students) {
      const s2StudentsCount = allInvitations.filter(x => x.type === 'parent' && x.session === 'Sesi 2').length;
      kpiS2Students.textContent = `${s2StudentsCount} Siswa Alokasi S2`;
    }

    const kpiGuests = document.getElementById('kpi-guests-count');
    if (kpiGuests) kpiGuests.textContent = meta.totalGuests || 0;

    const kpiGuestsTickets = document.getElementById('kpi-guests-tickets');
    if (kpiGuestsTickets) kpiGuestsTickets.textContent = `${(meta.guestTicketsS1 || 0) + (meta.guestTicketsS2 || 0)} Tiket Undangan`;

    const kpiSwapped = document.getElementById('kpi-swapped-count');
    if (kpiSwapped) kpiSwapped.textContent = meta.totalSwapped || 0;

    const kpiCheckedin = document.getElementById('kpi-checkedin-count');
    if (kpiCheckedin) kpiCheckedin.textContent = meta.totalCheckedIn || 0;

    const kpiCheckedinTickets = document.getElementById('kpi-checkedin-tickets');
    if (kpiCheckedinTickets) kpiCheckedinTickets.textContent = `${meta.totalCheckedInTickets || 0} Tiket Hadir`;

    // Render Table
    if (allInvitations.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" class="py-12 text-center text-slate-400">
            <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
            Tidak ada data orang tua siswa atau tamu yang cocok dengan filter.
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = allInvitations.map((row, idx) => {
        const isParent = row.type === 'parent';
        const isSwapped = row.is_swapped === 1;
        const isCheckedIn = row.checked_in === 1;

        const classBadge = isParent
          ? `<span class="bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-md text-[11px] whitespace-nowrap">Kelas ${row.class_grade}</span>`
          : `<span class="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-md text-[11px] whitespace-nowrap inline-flex items-center gap-1"><i data-lucide="crown" class="w-3 h-3"></i> Tamu</span>`;

        const sessionBadge = row.session === 'Sesi 1'
          ? `<span class="bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2 py-0.5 rounded-lg text-xs whitespace-nowrap">Sesi 1 (Pagi)</span>`
          : `<span class="bg-purple-50 text-purple-700 border border-purple-200 font-bold px-2 py-0.5 rounded-lg text-xs whitespace-nowrap">Sesi 2 (Siang)</span>`;

        const swapBadge = isSwapped
          ? `<div class="mt-1 text-[10px] font-bold text-orange-600 bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded inline-block">
               🔄 Pindah dari ${row.original_session}
             </div>`
          : '';

        const gateBadge = isCheckedIn
          ? `<span class="bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-md text-[11px] inline-flex items-center gap-1">
               <i data-lucide="check" class="w-3 h-3"></i> Hadir
             </span>
             ${row.checked_in_at ? `<div class="text-[10px] text-slate-400 mt-0.5">${formatDateTime(row.checked_in_at)}</div>` : ''}`
          : `<span class="bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-md text-[11px]">Belum</span>`;

        const notesText = row.swap_notes || row.institution || '';

        return `
          <tr class="hover:bg-slate-50/80 transition-colors ${isCheckedIn ? 'bg-emerald-50/20' : ''}">
            <td class="py-3 px-4 text-center font-medium text-slate-400">${idx + 1}</td>
            <td class="py-3 px-4 font-mono font-bold text-slate-800 text-xs">${row.invitation_code}</td>
            <td class="py-3 px-4">${classBadge}</td>
            <td class="py-3 px-4">
              <div class="font-bold text-slate-900">${row.name}</div>
              ${isParent ? `<div class="text-[10px] text-slate-400">Orang Tua Siswa ${row.name}</div>` : ''}
              ${row.phone ? `<div class="text-[10px] text-emerald-600 font-medium">${row.phone}</div>` : ''}
            </td>
            <td class="py-3 px-4">
              ${sessionBadge}
              ${swapBadge}
            </td>
            <td class="py-3 px-4 text-center">
              <span class="font-black text-slate-900 text-xs">${row.ticket_qty}</span>
              <span class="text-[10px] text-slate-400 block">Pax</span>
            </td>
            <td class="py-3 px-4 max-w-xs">
              ${notesText ? `<span class="text-xs text-slate-700 italic">${notesText}</span>` : `<span class="text-slate-300">-</span>`}
            </td>
            <td class="py-3 px-4 text-center">
              ${gateBadge}
            </td>
            <td class="py-3 px-4 text-center whitespace-nowrap">
              <div class="flex items-center justify-center gap-1.5">
                <button onclick="openParentSwapModalById(${row.id})" class="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] transition flex items-center gap-1" title="Ubah Sesi atau Jumlah Tiket">
                  <i data-lucide="arrow-left-right" class="w-3.5 h-3.5"></i>
                  <span>Ubah Sesi</span>
                </button>
                <button onclick="toggleInvitationCheckin(${row.id})" class="p-1.5 rounded-lg ${isCheckedIn ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'} transition" title="${isCheckedIn ? 'Batalkan Presensi (Uncheck-in)' : 'Tandai Hadir di Gate (Check-in)'}">
                  <i data-lucide="${isCheckedIn ? 'undo-2' : 'scan-line'}" class="w-3.5 h-3.5"></i>
                </button>
                ${!isParent ? `
                  <button onclick="openEditGuestModalById(${row.id})" class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition" title="Edit Tamu">
                    <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                  </button>
                  <button onclick="deleteGuest(${row.id}, '${row.name}')" class="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 transition" title="Hapus Tamu">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    const countLabel = document.getElementById('parents-table-count');
    if (countLabel) {
      countLabel.textContent = `Menampilkan ${allInvitations.length} data (${meta.totalParents || 0} Siswa/Ortu, ${meta.totalGuests || 0} Tamu)`;
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="py-8 text-center text-red-500 font-semibold">
          Gagal memuat data: ${err.message}
        </td>
      </tr>
    `;
  }
}

function debounceSearchInvitations() {
  clearTimeout(parentSearchDebounceTimer);
  parentSearchDebounceTimer = setTimeout(() => {
    loadInvitations();
  }, 250);
}

function openParentSwapModalById(id) {
  const inv = allInvitations.find(x => String(x.id) === String(id));
  if (!inv) {
    console.warn('Invitation not found in local cache for id:', id);
    fetch(`/api/invitations?search=${encodeURIComponent(id)}`).then(r => r.json()).then(res => {
      if (res.data && res.data.length > 0) openParentSwapModal(res.data[0]);
    }).catch(() => {});
    return;
  }
  openParentSwapModal(inv);
}

function openParentSwapModal(inv) {
  if (!inv) return;
  currentEditingInvitation = inv;
  const modal = document.getElementById('parent-swap-modal');
  if (!modal) return;

  const idEl = document.getElementById('swap-invitation-id');
  if (idEl) idEl.value = inv.id;

  const title = document.getElementById('modal-swap-student-title');
  if (title) {
    title.textContent = inv.type === 'parent'
      ? `${inv.name} (Kelas ${inv.class_grade || '-'})`
      : `${inv.name} (Tamu Undangan)`;
  }

  const origSess = document.getElementById('modal-swap-original-session');
  if (origSess) origSess.textContent = inv.original_session || inv.session;

  const sessSelect = document.getElementById('swap-session');
  if (sessSelect) sessSelect.value = inv.session;

  const qtyInput = document.getElementById('swap-ticket-qty');
  if (qtyInput) qtyInput.value = inv.ticket_qty;

  const notesInput = document.getElementById('swap-notes');
  if (notesInput) notesInput.value = inv.swap_notes || '';

  const phoneInput = document.getElementById('swap-phone');
  if (phoneInput) phoneInput.value = inv.phone || '';

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) lucide.createIcons();
}

function closeParentSwapModal() {
  const modal = document.getElementById('parent-swap-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  currentEditingInvitation = null;
}

async function handleParentSwapSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('swap-invitation-id').value;
  const session = document.getElementById('swap-session').value;
  const ticket_qty = document.getElementById('swap-ticket-qty').value;
  const swap_notes = document.getElementById('swap-notes').value;
  const phone = document.getElementById('swap-phone').value;

  try {
    const res = await fetch(`/api/invitations/${id}/update-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, ticket_qty, swap_notes, phone })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message || 'Perubahan sesi berhasil disimpan!', 'success');
    closeParentSwapModal();
    await loadInvitations();
    if (typeof loadCapacityRecap === 'function') await loadCapacityRecap();
  } catch (err) {
    alert('Gagal menyimpan perubahan: ' + err.message);
  }
}

async function handleResetInvitationSession() {
  if (!currentEditingInvitation) return;
  if (!confirm(`Kembalikan alokasi ${currentEditingInvitation.name} ke sesi bawaan (${currentEditingInvitation.original_session}, 2 tiket)?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/invitations/${currentEditingInvitation.id}/reset-session`, {
      method: 'POST'
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message, 'info');
    closeParentSwapModal();
    await loadInvitations();
    if (typeof loadCapacityRecap === 'function') await loadCapacityRecap();
  } catch (err) {
    alert('Gagal mereset sesi: ' + err.message);
  }
}

function openGuestModal(guest = null) {
  const modal = document.getElementById('guest-modal');
  if (!modal) return;

  const titleEl = document.getElementById('guest-modal-title');
  if (guest) {
    if (titleEl) titleEl.textContent = 'Edit Tamu Undangan';
    document.getElementById('guest-id').value = guest.id;
    document.getElementById('guest-name').value = guest.name;
    document.getElementById('guest-institution').value = guest.institution || '';
    document.getElementById('guest-session').value = guest.session;
    document.getElementById('guest-ticket-qty').value = guest.ticket_qty;
    document.getElementById('guest-phone').value = guest.phone || '';
    document.getElementById('guest-notes').value = guest.swap_notes || '';
  } else {
    if (titleEl) titleEl.textContent = 'Tambah Tamu Undangan Baru';
    document.getElementById('guest-id').value = '';
    document.getElementById('guest-name').value = '';
    document.getElementById('guest-institution').value = '';
    document.getElementById('guest-session').value = 'Sesi 1';
    document.getElementById('guest-ticket-qty').value = 2;
    document.getElementById('guest-phone').value = '';
    document.getElementById('guest-notes').value = '';
  }

  modal.classList.remove('hidden');
  modal.classList.add('flex');
  if (window.lucide) lucide.createIcons();
}

function openEditGuestModalById(id) {
  const guest = allInvitations.find(x => String(x.id) === String(id));
  if (guest) openGuestModal(guest);
}

function closeGuestModal() {
  const modal = document.getElementById('guest-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

async function handleGuestSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('guest-id').value;
  const name = document.getElementById('guest-name').value.trim();
  const institution = document.getElementById('guest-institution').value.trim();
  const session = document.getElementById('guest-session').value;
  const ticket_qty = document.getElementById('guest-ticket-qty').value;
  const phone = document.getElementById('guest-phone').value.trim();
  const notes = document.getElementById('guest-notes').value.trim();

  const url = id ? `/api/invitations/guest/${id}` : '/api/invitations/guest';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, institution, session, ticket_qty, phone, notes })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message, 'success');
    closeGuestModal();
    loadInvitations();
    if (typeof loadCapacityRecap === 'function') loadCapacityRecap();
  } catch (err) {
    alert('Gagal menyimpan tamu undangan: ' + err.message);
  }
}

async function deleteGuest(id, name) {
  if (!confirm(`Hapus tamu undangan "${name}" dari sistem?`)) return;

  try {
    const res = await fetch(`/api/invitations/guest/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message, 'info');
    loadInvitations();
    if (typeof loadCapacityRecap === 'function') loadCapacityRecap();
  } catch (err) {
    alert('Gagal menghapus tamu: ' + err.message);
  }
}

async function toggleInvitationCheckin(id) {
  try {
    const res = await fetch(`/api/invitations/${id}/checkin`, { method: 'POST' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message, 'success');
    loadInvitations();
  } catch (err) {
    alert('Gagal memperbarui check-in: ' + err.message);
  }
}

// ==========================================
// REKAP TOTAL KURSI & KAPASITAS AUDITORIUM
// ==========================================
async function loadCapacityRecap() {
  try {
    const res = await fetch('/api/recap/capacity');
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Gagal memuat rekap kapasitas');

    const d = json.data;
    const s1 = d.session_1;
    const s2 = d.session_2;
    const gt = d.grand_total;

    // Fill capacity input fields
    const inS1 = document.getElementById('input-cap-s1');
    const inS2 = document.getElementById('input-cap-s2');
    if (inS1 && (!inS1.value || inS1.value === '')) inS1.value = d.capacity_settings.session_1;
    if (inS2 && (!inS2.value || inS2.value === '')) inS2.value = d.capacity_settings.session_2;

    // Sesi 1 Card
    const s1Cap = document.getElementById('cap-card-s1-capacity');
    if (s1Cap) s1Cap.textContent = `${s1.capacity} Kursi`;

    const s1Rem = document.getElementById('cap-card-s1-remaining');
    if (s1Rem) {
      s1Rem.innerHTML = `<span>${s1.remaining_seats}</span> <span class="text-sm font-semibold text-slate-500">kursi tersisa</span>`;
      if (s1.remaining_seats <= 0) {
        s1Rem.className = 'text-3xl font-black text-red-600 mt-1 flex items-baseline gap-1';
      } else if (s1.remaining_seats < 30) {
        s1Rem.className = 'text-3xl font-black text-amber-600 mt-1 flex items-baseline gap-1';
      } else {
        s1Rem.className = 'text-3xl font-black text-emerald-600 mt-1 flex items-baseline gap-1';
      }
    }

    const s1Badge = document.getElementById('cap-card-s1-occupancy-badge');
    if (s1Badge) {
      s1Badge.textContent = `Okupansi ${s1.occupancy_rate}%`;
      s1Badge.className = s1.occupancy_rate >= 100
        ? 'px-3 py-1 text-xs font-black rounded-full bg-red-100 text-red-800'
        : (s1.occupancy_rate >= 80 ? 'px-3 py-1 text-xs font-black rounded-full bg-amber-100 text-amber-800' : 'px-3 py-1 text-xs font-black rounded-full bg-blue-100 text-blue-800');
    }

    const s1OccText = document.getElementById('cap-card-s1-occupied-text');
    if (s1OccText) s1OccText.textContent = `${s1.total_occupied} / ${s1.capacity} terisi`;

    const s1Bar = document.getElementById('cap-card-s1-progress-bar');
    if (s1Bar) s1Bar.style.width = `${Math.min(100, s1.occupancy_rate)}%`;

    const s1Pct = document.getElementById('cap-card-s1-progress-pct');
    if (s1Pct) s1Pct.textContent = `${s1.occupancy_rate}%`;

    const s1Parents = document.getElementById('cap-card-s1-parents');
    if (s1Parents) s1Parents.textContent = `${s1.parents.tickets} Tiket (${s1.parents.count} Siswa)`;

    const s1Guests = document.getElementById('cap-card-s1-guests');
    if (s1Guests) s1Guests.textContent = `${s1.guests.tickets} Tiket (${s1.guests.count} Tamu)`;

    const s1BuyersV = document.getElementById('cap-card-s1-buyers-verified');
    if (s1BuyersV) s1BuyersV.textContent = `${s1.buyers_verified.tickets} Tiket (${s1.buyers_verified.count} Pesanan)`;

    const s1TotalOcc = document.getElementById('cap-card-s1-total-occupied');
    if (s1TotalOcc) s1TotalOcc.textContent = `${s1.total_occupied} Tiket`;

    const s1BuyersP = document.getElementById('cap-card-s1-buyers-pending');
    if (s1BuyersP) s1BuyersP.textContent = `${s1.buyers_pending.tickets} Tiket (${s1.buyers_pending.count} Pesanan)`;

    // Sesi 2 Card
    const s2Cap = document.getElementById('cap-card-s2-capacity');
    if (s2Cap) s2Cap.textContent = `${s2.capacity} Kursi`;

    const s2Rem = document.getElementById('cap-card-s2-remaining');
    if (s2Rem) {
      s2Rem.innerHTML = `<span>${s2.remaining_seats}</span> <span class="text-sm font-semibold text-slate-500">kursi tersisa</span>`;
      if (s2.remaining_seats <= 0) {
        s2Rem.className = 'text-3xl font-black text-red-600 mt-1 flex items-baseline gap-1';
      } else if (s2.remaining_seats < 30) {
        s2Rem.className = 'text-3xl font-black text-amber-600 mt-1 flex items-baseline gap-1';
      } else {
        s2Rem.className = 'text-3xl font-black text-emerald-600 mt-1 flex items-baseline gap-1';
      }
    }

    const s2Badge = document.getElementById('cap-card-s2-occupancy-badge');
    if (s2Badge) {
      s2Badge.textContent = `Okupansi ${s2.occupancy_rate}%`;
      s2Badge.className = s2.occupancy_rate >= 100
        ? 'px-3 py-1 text-xs font-black rounded-full bg-red-100 text-red-800'
        : (s2.occupancy_rate >= 80 ? 'px-3 py-1 text-xs font-black rounded-full bg-amber-100 text-amber-800' : 'px-3 py-1 text-xs font-black rounded-full bg-purple-100 text-purple-800');
    }

    const s2OccText = document.getElementById('cap-card-s2-occupied-text');
    if (s2OccText) s2OccText.textContent = `${s2.total_occupied} / ${s2.capacity} terisi`;

    const s2Bar = document.getElementById('cap-card-s2-progress-bar');
    if (s2Bar) s2Bar.style.width = `${Math.min(100, s2.occupancy_rate)}%`;

    const s2Pct = document.getElementById('cap-card-s2-progress-pct');
    if (s2Pct) s2Pct.textContent = `${s2.occupancy_rate}%`;

    const s2Parents = document.getElementById('cap-card-s2-parents');
    if (s2Parents) s2Parents.textContent = `${s2.parents.tickets} Tiket (${s2.parents.count} Siswa)`;

    const s2Guests = document.getElementById('cap-card-s2-guests');
    if (s2Guests) s2Guests.textContent = `${s2.guests.tickets} Tiket (${s2.guests.count} Tamu)`;

    const s2BuyersV = document.getElementById('cap-card-s2-buyers-verified');
    if (s2BuyersV) s2BuyersV.textContent = `${s2.buyers_verified.tickets} Tiket (${s2.buyers_verified.count} Pesanan)`;

    const s2TotalOcc = document.getElementById('cap-card-s2-total-occupied');
    if (s2TotalOcc) s2TotalOcc.textContent = `${s2.total_occupied} Tiket`;

    const s2BuyersP = document.getElementById('cap-card-s2-buyers-pending');
    if (s2BuyersP) s2BuyersP.textContent = `${s2.buyers_pending.tickets} Tiket (${s2.buyers_pending.count} Pesanan)`;

    // Master Matrix Table
    const grandSum = document.getElementById('cap-matrix-grand-summary');
    if (grandSum) grandSum.textContent = `Total Kapasitas: ${gt.capacity} Kursi (${gt.total_occupied} Terisi, Sisa ${gt.remaining_seats})`;

    const mParentsS1 = document.getElementById('matrix-parents-s1');
    if (mParentsS1) mParentsS1.textContent = `${s1.parents.tickets} Tiket`;
    const mParentsS2 = document.getElementById('matrix-parents-s2');
    if (mParentsS2) mParentsS2.textContent = `${s2.parents.tickets} Tiket`;
    const mParentsTot = document.getElementById('matrix-parents-total');
    if (mParentsTot) mParentsTot.textContent = `${gt.parents_tickets} Tiket`;

    const mGuestsS1 = document.getElementById('matrix-guests-s1');
    if (mGuestsS1) mGuestsS1.textContent = `${s1.guests.tickets} Tiket`;
    const mGuestsS2 = document.getElementById('matrix-guests-s2');
    if (mGuestsS2) mGuestsS2.textContent = `${s2.guests.tickets} Tiket`;
    const mGuestsTot = document.getElementById('matrix-guests-total');
    if (mGuestsTot) mGuestsTot.textContent = `${gt.guests_tickets} Tiket`;

    const mBuyersS1 = document.getElementById('matrix-buyers-s1');
    if (mBuyersS1) mBuyersS1.textContent = `${s1.buyers_verified.tickets} Tiket`;
    const mBuyersS2 = document.getElementById('matrix-buyers-s2');
    if (mBuyersS2) mBuyersS2.textContent = `${s2.buyers_verified.tickets} Tiket`;
    const mBuyersTot = document.getElementById('matrix-buyers-total');
    if (mBuyersTot) mBuyersTot.textContent = `${gt.buyers_verified_tickets} Tiket`;

    const mOccS1 = document.getElementById('matrix-occupied-s1');
    if (mOccS1) mOccS1.textContent = `${s1.total_occupied} Tiket`;
    const mOccS2 = document.getElementById('matrix-occupied-s2');
    if (mOccS2) mOccS2.textContent = `${s2.total_occupied} Tiket`;
    const mOccTot = document.getElementById('matrix-occupied-total');
    if (mOccTot) mOccTot.textContent = `${gt.total_occupied} Tiket`;
    const mOccPct = document.getElementById('matrix-occupied-pct');
    if (mOccPct) mOccPct.textContent = `Okupansi ${gt.occupancy_rate}%`;

    const mPendS1 = document.getElementById('matrix-pending-s1');
    if (mPendS1) mPendS1.textContent = `${s1.buyers_pending.tickets} Tiket`;
    const mPendS2 = document.getElementById('matrix-pending-s2');
    if (mPendS2) mPendS2.textContent = `${s2.buyers_pending.tickets} Tiket`;
    const mPendTot = document.getElementById('matrix-pending-total');
    if (mPendTot) mPendTot.textContent = `${gt.buyers_pending_tickets} Tiket`;

    const mCapS1 = document.getElementById('matrix-capacity-s1');
    if (mCapS1) mCapS1.textContent = `${s1.capacity} Kursi`;
    const mCapS2 = document.getElementById('matrix-capacity-s2');
    if (mCapS2) mCapS2.textContent = `${s2.capacity} Kursi`;
    const mCapTot = document.getElementById('matrix-capacity-total');
    if (mCapTot) mCapTot.textContent = `${gt.capacity} Kursi`;

    const mRemS1 = document.getElementById('matrix-remaining-s1');
    if (mRemS1) mRemS1.textContent = `${s1.remaining_seats} Kursi`;
    const mRemS2 = document.getElementById('matrix-remaining-s2');
    if (mRemS2) mRemS2.textContent = `${s2.remaining_seats} Kursi`;
    const mRemTot = document.getElementById('matrix-remaining-total');
    if (mRemTot) mRemTot.textContent = `${gt.remaining_seats} Kursi`;

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Error loading capacity recap:', err);
  }
}

async function handleSaveCapacity(e) {
  e.preventDefault();
  const capS1 = document.getElementById('input-cap-s1').value;
  const capS2 = document.getElementById('input-cap-s2').value;

  try {
    const res = await fetch('/api/settings/capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capacity_session_1: capS1,
        capacity_session_2: capS2
      })
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || json.message);

    showToast(json.message || 'Kapasitas auditorium berhasil diperbarui!', 'success');
    loadCapacityRecap();
  } catch (err) {
    alert('Gagal menyimpan kapasitas: ' + err.message);
  }
}


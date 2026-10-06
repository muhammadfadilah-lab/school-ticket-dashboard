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
  
  // Auto refresh stats every 30 seconds
  setInterval(() => {
    loadStats();
  }, 30000);
}

function refreshData() {
  const icon = document.getElementById('refresh-icon');
  if (icon) icon.classList.add('animate-spin');
  Promise.all([loadStats(), loadOrders()]).finally(() => {
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
// CHECK-IN GATE
// ==========================================
async function handleCheckinSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('checkin-input');
  const code = input.value.trim().toUpperCase();
  if (!code) return;

  const resultContainer = document.getElementById('checkin-result');
  resultContainer.className = 'mt-6 text-left p-5 rounded-2xl border bg-slate-50 border-slate-200';
  resultContainer.innerHTML = `
    <div class="flex items-center gap-2 text-xs text-slate-500">
      <div class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-indigo-600 border-t-transparent"></div>
      <span>Memeriksa database tiket...</span>
    </div>
  `;
  resultContainer.classList.remove('hidden');

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(code)}/checkin`, {
      method: 'POST'
    });
    const result = await res.json();

    if (res.status === 200 && result.success) {
      // SUCCESS CHECK-IN
      const order = result.data;
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-emerald-950 animate-in zoom-in-95 duration-150';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold">✓</div>
          <div class="flex-1">
            <span class="inline-block px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-bold text-[11px] uppercase tracking-wider mb-1">AKSES DITERIMA - CHECK-IN BERHASIL</span>
            <h3 class="text-lg font-black text-emerald-950">${escapeHtml(order.name)}</h3>
            <p class="text-xs text-emerald-800">${escapeHtml(order.institution || 'Umum')} • ${order.phone}</p>
            <div class="mt-3 grid grid-cols-2 gap-2 text-xs bg-white/60 p-3 rounded-xl">
              <div>
                <span class="text-emerald-700 block text-[10px]">KATEGORI & JUMLAH</span>
                <strong class="text-sm font-bold">${order.ticket_category} (${order.ticket_qty} Tiket)</strong>
              </div>
              <div>
                <span class="text-emerald-700 block text-[10px]">WAKTU CHECK-IN</span>
                <strong class="text-sm font-bold">${new Date(order.checked_in_at).toLocaleTimeString('id-ID')} WIB</strong>
              </div>
            </div>
          </div>
        </div>
      `;
      input.value = '';
      loadStats();
    } else if (res.status === 409) {
      // ALREADY CHECKED IN WARNING!
      const order = result.data;
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-red-500 bg-red-50 text-red-950';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-red-600 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold">✕</div>
          <div class="flex-1">
            <span class="inline-block px-2 py-0.5 rounded bg-red-200 text-red-900 font-bold text-[11px] uppercase tracking-wider mb-1">PERINGATAN: TIKET SUDAH PERNAH DIGUNAKAN!</span>
            <h3 class="text-lg font-black text-red-950">${result.message}</h3>
            <p class="text-xs text-red-800 mt-1">Pemegang Tiket: <strong>${escapeHtml(order ? order.name : '-')}</strong></p>
            <p class="text-[11px] text-red-700 mt-2">Dilarang masuk dua kali dengan tiket yang sama. Periksa identitas pembawa tiket.</p>
          </div>
        </div>
      `;
    } else {
      // NOT VERIFIED / NOT FOUND
      resultContainer.className = 'mt-6 text-left p-6 rounded-2xl border-2 border-amber-500 bg-amber-50 text-amber-950';
      resultContainer.innerHTML = `
        <div class="flex items-start gap-4">
          <div class="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center flex-shrink-0 text-2xl font-bold">!</div>
          <div class="flex-1">
            <span class="inline-block px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-bold text-[11px] uppercase tracking-wider mb-1">AKSES DITOLAK</span>
            <h3 class="text-base font-bold text-amber-950">${result.message || 'Tiket tidak valid'}</h3>
            <p class="text-xs text-amber-800 mt-1">Pastikan status tiket sudah diverifikasi LUNAS oleh bendahara sebelum tamu dapat masuk.</p>
          </div>
        </div>
      `;
    }
  } catch (err) {
    resultContainer.className = 'mt-6 text-left p-5 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-xs';
    resultContainer.textContent = 'Terjadi kesalahan sistem: ' + err.message;
  }
}

// ==========================================
// MANUAL ORDER / OTS
// ==========================================
function updateManualPrice() {
  const cat = document.getElementById('manual-ticket-cat').value;
  const qty = parseInt(document.getElementById('manual-ticket-qty').value || 1, 10);
  const prices = currentSettings.ticket_prices || { 'Presale': 20000, 'Reguler': 25000, 'VIP': 50000 };
  const price = prices[cat] || 25000;
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

    currentSettings = result.data;
    document.getElementById('top-event-name').textContent = currentSettings.event_name || 'Kegiatan Sekolah';

    // Fill settings form
    document.getElementById('setting-event-name').value = currentSettings.event_name || '';
    document.getElementById('setting-school-name').value = currentSettings.school_name || '';
    document.getElementById('setting-event-date').value = currentSettings.event_date || '';
    document.getElementById('setting-event-time').value = currentSettings.event_time || '';
    document.getElementById('setting-gateway-type').value = currentSettings.wa_gateway_type || 'fonnte';
    document.getElementById('setting-wa-token').value = currentSettings.wa_api_token || '';
    document.getElementById('setting-template-receipt').value = currentSettings.template_receipt || '';
    document.getElementById('setting-template-verified').value = currentSettings.template_verified || '';

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

  const payload = {
    event_name: document.getElementById('setting-event-name').value.trim(),
    school_name: document.getElementById('setting-school-name').value.trim(),
    event_date: document.getElementById('setting-event-date').value.trim(),
    event_time: document.getElementById('setting-event-time').value.trim(),
    wa_gateway_type: document.getElementById('setting-gateway-type').value,
    wa_api_token: document.getElementById('setting-wa-token').value.trim(),
    template_receipt: document.getElementById('setting-template-receipt').value,
    template_verified: document.getElementById('setting-template-verified').value,
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

    showToast('Pengaturan berhasil disimpan!', 'success');
    await loadSettings();
  } catch (err) {
    alert('Gagal menyimpan pengaturan: ' + err.message);
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


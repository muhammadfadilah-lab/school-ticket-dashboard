/**
 * WhatsApp Gateway Service
 * Supports Fonnte, Wablas, and direct WhatsApp Web link generation
 */

function formatIndonesianPhone(phone) {
  if (!phone) return '';
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) {
    clean = '62' + clean.slice(1);
  } else if (clean.startsWith('8')) {
    clean = '62' + clean;
  }
  return clean;
}

function formatRupiah(amount) {
  return new Intl.NumberFormat('id-ID').format(Number(amount) || 0);
}

function formatBankList(banks) {
  if (!Array.isArray(banks) || banks.length === 0) {
    return '• Hubungi panitia untuk nomor rekening';
  }
  return banks.map(b => `• *${b.bank}*: ${b.number} (a.n. ${b.holder})`).join('\n');
}

function renderTemplate(template, data) {
  let text = template || '';
  for (const [key, val] of Object.entries(data)) {
    const reg = new RegExp(`{{${key}}}`, 'g');
    text = text.replace(reg, val !== undefined && val !== null ? String(val) : '');
  }
  return text;
}

function buildReceiptMessage(order, settings) {
  const bankList = formatBankList(settings.bank_accounts);
  return renderTemplate(settings.template_receipt, {
    event_name: settings.event_name,
    school_name: settings.school_name,
    name: order.name,
    order_id: order.order_id,
    ticket_category: order.ticket_category,
    performance_session: order.performance_session || order.ticket_category || '-',
    session: order.performance_session || order.ticket_category || '-',
    sender_account_name: order.sender_account_name || '-',
    ticket_qty: order.ticket_qty,
    ticket_price: formatRupiah(order.ticket_price),
    total_amount: formatRupiah(order.total_amount),
    bank_list: bankList,
    contact_person: settings.contact_person
  });
}

function buildVerifiedMessage(order, settings, ticketUrl) {
  return renderTemplate(settings.template_verified, {
    event_name: settings.event_name,
    school_name: settings.school_name,
    name: order.name,
    order_id: order.order_id,
    ticket_category: order.ticket_category,
    performance_session: order.performance_session || order.ticket_category || '-',
    session: order.performance_session || order.ticket_category || '-',
    ticket_qty: order.ticket_qty,
    event_date: settings.event_date,
    event_time: settings.event_time,
    event_location: settings.event_location,
    ticket_url: ticketUrl,
    contact_person: settings.contact_person
  });
}

function buildRejectedMessage(order, settings, reason) {
  return renderTemplate(settings.template_rejected, {
    event_name: settings.event_name,
    school_name: settings.school_name,
    name: order.name,
    order_id: order.order_id,
    reason: reason || 'Bukti transfer tidak dapat diverifikasi atau nominal tidak cocok',
    contact_person: settings.contact_person
  });
}

function getDirectWhatsAppLink(phone, message) {
  const formattedPhone = formatIndonesianPhone(phone);
  const encodedText = encodeURIComponent(message);
  return `https://wa.me/${formattedPhone}?text=${encodedText}`;
}

async function sendWhatsAppMessage({ phone, message, settings }) {
  const target = formatIndonesianPhone(phone);
  const gateway = settings.wa_gateway_type || 'fonnte';
  const token = settings.wa_api_token || '';

  if (!token && gateway !== 'direct') {
    return {
      success: false,
      isDirectFallback: true,
      directUrl: getDirectWhatsAppLink(target, message),
      message: 'Token API WhatsApp belum diisi di Pengaturan. Gunakan Direct Link atau isi token Fonnte/Wablas.'
    };
  }

  try {
    if (gateway === 'fonnte') {
      // Fonnte API
      const res = await fetch('https://api.fonnte.com/send', {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          target: target,
          message: message,
          countryCode: '62'
        })
      });
      const data = await res.json();
      if (data.status === true || data.status === 'success') {
        return { success: true, gateway: 'fonnte', data };
      } else {
        return {
          success: false,
          error: data.reason || data.message || 'Gagal mengirim via Fonnte',
          directUrl: getDirectWhatsAppLink(target, message)
        };
      }
    } else if (gateway === 'wablas') {
      // Wablas API
      const res = await fetch('https://sby.wablas.com/api/send-message', {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          phone: target,
          message: message
        })
      });
      const data = await res.json();
      if (data.status === true || data.status === 'success') {
        return { success: true, gateway: 'wablas', data };
      } else {
        return {
          success: false,
          error: data.message || 'Gagal mengirim via Wablas',
          directUrl: getDirectWhatsAppLink(target, message)
        };
      }
    } else {
      // Mode direct link
      return {
        success: true,
        mode: 'direct',
        directUrl: getDirectWhatsAppLink(target, message)
      };
    }
  } catch (err) {
    console.error('WhatsApp Gateway Error:', err);
    return {
      success: false,
      error: err.message,
      directUrl: getDirectWhatsAppLink(target, message)
    };
  }
}

module.exports = {
  formatIndonesianPhone,
  formatRupiah,
  formatBankList,
  renderTemplate,
  buildReceiptMessage,
  buildVerifiedMessage,
  buildRejectedMessage,
  getDirectWhatsAppLink,
  sendWhatsAppMessage
};

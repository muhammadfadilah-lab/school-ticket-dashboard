/**
 * Public HTTPS Tunnel using localtunnel
 * Exposes local port 3000 to the public internet so:
 * 1. Anyone on phone/internet can open the dashboard
 * 2. Google Apps Script can send webhook requests to https://..../api/webhook/order
 */

const localtunnel = require('localtunnel');

const PORT = process.env.PORT || 3000;

(async () => {
  console.log(`Menghubungkan port ${PORT} ke public internet tunnel...`);
  try {
    const tunnel = await localtunnel({ port: PORT });

    console.log(`\n======================================================`);
    console.log(`🌐 DASHBOARD ONLINE (PUBLIC HTTPS URL):`);
    console.log(`👉 ${tunnel.url}`);
    console.log(`======================================================`);
    console.log(`📡 WEBHOOK URL UNTUK GOOGLE APPS SCRIPT:`);
    console.log(`👉 ${tunnel.url}/api/webhook/order`);
    console.log(`======================================================`);
    console.log(`(Tekan Ctrl+C untuk menghentikan tunnel)\n`);

    tunnel.on('close', () => {
      console.log('Tunnel ditutup.');
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
    });
  } catch (err) {
    console.error('Gagal membuka tunnel:', err.message);
  }
})();

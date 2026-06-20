// SE Alert Bridge — server.js v3.0
// Saweria / Trakteer / SociaBuzz → forward ke Streamlabs sebagai tip
// Notifikasi muncul di Streamlabs Alert Box → OBS 1 Browser Source

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const http    = require('http');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app    = express();
const server = http.createServer(app);

// ── Config ────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch {
    const def = {
      ngrokUrl:   '',
      streamlabs: {
        enabled:       false,
        socket_token:  '',
        access_token:  '',
      },
      saweria:    { enabled: false, stream_key: '' },
      trakteer:   { enabled: false },
      sociabuzz:  { enabled: false },
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    return def;
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── Push tip ke Streamlabs API ────────────────────────────
async function pushToStreamlabs(data) {
  const cfg   = loadConfig();
  const token = cfg.streamlabs?.access_token;

  if (!token) {
    console.warn('[Streamlabs] ⚠ access_token belum diset — skip push');
    return false;
  }

  const providerLabel = {
    saweria:   'Saweria',
    trakteer:  'Trakteer',
    sociabuzz: 'SociaBuzz',
  }[data.provider] || data.provider;

  // Streamlabs tip API hanya USD — pakai 0.01 agar trigger alert
  // Info nominal asli ditaruh di pesan
  const tipAmount = data.currency === 'USD'
    ? (parseFloat(data.amount) || 0.01).toFixed(2)
    : '0.01';

  // Susun pesan: nominal asli + pesan donatur
  let tipMessage = '';
  if (data.currency === 'IDR' && data.amount) {
    const fmt = Number(data.amount) >= 1000
      ? 'Rp ' + Math.round(Number(data.amount)/1000) + 'k'
      : 'Rp ' + Number(data.amount).toLocaleString('id-ID');
    tipMessage += fmt;
  } else if (data.unit && data.quantity) {
    tipMessage += `${data.quantity}x ${data.unit}`;
  }
  if (data.message) {
    tipMessage += tipMessage ? ` — ${data.message}` : data.message;
  }

  // Nama donatur + provider di dalam kurung
  const tipName = `${data.from} [${providerLabel}]`;

  const postData = new URLSearchParams({
    access_token: token,
    type:         'donation',
    name:         tipName,
    amount:       tipAmount,
    currency:     'USD',
    message:      tipMessage,
    identifier:   `hsnm_${Date.now()}`,
    created_at:   Math.floor(Date.now() / 1000).toString(),
  }).toString();

  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'streamlabs.com',
      path:     '/api/v2.0/donations',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.donation_id) {
            console.log(`[Streamlabs] ✅ ${tipName} | ${tipMessage} | id:${json.donation_id}`);
            resolve(true);
          } else {
            console.error('[Streamlabs] ❌ Gagal:', body);
            resolve(false);
          }
        } catch {
          console.error('[Streamlabs] ❌ Parse error:', body);
          resolve(false);
        }
      });
    });
    req.on('error', e => {
      console.error('[Streamlabs] ❌ Request error:', e.message);
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

// ── Middleware ────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,saweria-callback-signature');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Pages ─────────────────────────────────────────────────
app.get('/',        (_, r) => r.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/overlay', (_, r) => r.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// ── Config API ────────────────────────────────────────────
app.get('/api/config', (_, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const cfg  = loadConfig();
  const body = req.body;

  if (body.ngrokUrl !== undefined)
    cfg.ngrokUrl = body.ngrokUrl.trim().replace(/\/$/, '');

  ['saweria','trakteer','sociabuzz','streamlabs'].forEach(k => {
    if (body[k]) cfg[k] = { ...cfg[k], ...body[k] };
  });

  saveConfig(cfg);
  if (body.streamlabs?.socket_token) restartStreamlabsSocket();
  res.json({ ok: true });
});

app.post('/api/ngrok', (req, res) => {
  const cfg = loadConfig();
  cfg.ngrokUrl = (req.body.url || '').trim().replace(/\/$/, '');
  saveConfig(cfg);
  res.json({ ok: true, ngrokUrl: cfg.ngrokUrl });
});

// ── Status API ────────────────────────────────────────────
app.get('/api/status', (_, res) => {
  const cfg = loadConfig();
  res.json({
    version:            '3.0.0',
    ngrok_url:          cfg.ngrokUrl || null,
    ngrok_configured:   !!cfg.ngrokUrl,
    streamlabs_token:   !!(cfg.streamlabs?.access_token),
    streamlabs_socket:  !!(cfg.streamlabs?.socket_token),
    streamlabs_enabled: cfg.streamlabs?.enabled || false,
    saweria_enabled:    cfg.saweria?.enabled || false,
    trakteer_enabled:   cfg.trakteer?.enabled || false,
    sociabuzz_enabled:  cfg.sociabuzz?.enabled || false,
  });
});

// ── Test Alert ────────────────────────────────────────────
app.post('/api/test', async (req, res) => {
  const provider = req.body?.provider || 'saweria';
  const samples  = {
    saweria:   { provider:'saweria',   from:'Tester Saweria',   amount:69420, currency:'IDR', message:'Test donasi dari Saweria!' },
    trakteer:  { provider:'trakteer',  from:'Tester Trakteer',  amount:5000,  currency:'IDR', unit:'Cendol', quantity:2, message:'Test dari Trakteer!' },
    sociabuzz: { provider:'sociabuzz', from:'Tester SociaBuzz', amount:20000, currency:'IDR', message:'Test dari SociaBuzz!' },
  };
  const alert = samples[provider] || samples.saweria;
  console.log(`[TEST] Push ke Streamlabs: ${alert.provider}`);
  const ok = await pushToStreamlabs(alert);
  res.json({
    ok,
    sent: alert,
    note: ok
      ? '✅ Berhasil! Cek Alert Box Streamlabs di OBS kamu.'
      : '❌ Gagal — pastikan access_token sudah diset dan benar.',
  });
});

// ═══════════════════════════════════════════════════════
// WEBHOOK SAWERIA
// ═══════════════════════════════════════════════════════
app.post('/webhook/saweria', async (req, res) => {
  const cfg     = loadConfig();
  const rawBody = req.body;
  let bodyStr;
  try {
    bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);
  } catch { return res.sendStatus(400); }

  const sig = req.headers['saweria-callback-signature'];
  if (sig && cfg.saweria?.stream_key) {
    const expected = crypto
      .createHmac('sha256', cfg.saweria.stream_key.trim())
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(bodyStr))
      .digest('hex');
    console.log(sig === expected ? '[Saweria] ✓ Signature valid' : '[Saweria] ⚠ Signature tidak cocok (tetap diproses)');
  }

  let data;
  try { data = JSON.parse(bodyStr); }
  catch { return res.sendStatus(400); }

  let amount = 0;
  if (data.amount_raw !== undefined)                  amount = data.amount_raw;
  else if (data.etc?.amount_to_display !== undefined) amount = data.etc.amount_to_display;
  else if (data.amount !== undefined)                 amount = parseInt(String(data.amount).replace(/[^0-9]/g,'')) || 0;

  await pushToStreamlabs({
    provider: 'saweria',
    from:     data.donator_name || data.name || 'Anonim',
    amount,
    currency: 'IDR',
    message:  data.message || '',
  });

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// WEBHOOK TRAKTEER
// ═══════════════════════════════════════════════════════
app.post('/webhook/trakteer', async (req, res) => {
  let raw;
  try {
    raw = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  const d = raw.data || raw;
  await pushToStreamlabs({
    provider: 'trakteer',
    from:     d.supporter_name || 'Anonim',
    amount:   d.price ? parseInt(String(d.price).replace(/[^0-9]/g,'')) || 0 : 0,
    currency: 'IDR',
    unit:     d.unit || '',
    quantity: d.quantity || 1,
    message:  d.supporter_message || '',
  });

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// WEBHOOK SOCIABUZZ
// ═══════════════════════════════════════════════════════
app.post('/webhook/sociabuzz', async (req, res) => {
  let data;
  try {
    data = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  await pushToStreamlabs({
    provider: 'sociabuzz',
    from:     data.invoker_name || data.supporter_name || data.from || 'Anonim',
    amount:   data.amount || data.amount_raw || 0,
    currency: 'IDR',
    message:  data.message || data.supporter_message || '',
  });

  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// STREAMLABS SOCKET (terima event native: follow, superchat YouTube, dll)
// ═══════════════════════════════════════════════════════
let slSocket = null;

function restartStreamlabsSocket() {
  if (slSocket) { try { slSocket.disconnect(); } catch {} slSocket = null; }
  const cfg = loadConfig();
  if (cfg.streamlabs?.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabsSocket(cfg.streamlabs.socket_token);
  }
}

function connectStreamlabsSocket(token) {
  try {
    const io = require('socket.io-client');
    slSocket  = io(`https://sockets.streamlabs.com?token=${token}`, { transports:['websocket'] });
    slSocket.on('connect',       () => console.log('[SL Socket] Connected ✓'));
    slSocket.on('disconnect',    () => console.log('[SL Socket] Disconnected'));
    slSocket.on('connect_error', e  => console.error('[SL Socket] Error:', e.message));
    slSocket.on('event',         d  => console.log(`[SL Socket] Native event: ${d.type}`));
  } catch(e) {
    console.error('[SL Socket] Gagal konek:', e.message);
  }
}

// ── Helper ────────────────────────────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const n of ifaces)
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return 'localhost';
}

// ── Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const cfg = loadConfig();
  const ip  = getLocalIP();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SE Alert Bridge v3.0  — Streamlabs Edition           ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard  →  http://localhost:${PORT}                      ║`);
  console.log(`║  LAN        →  http://${ip}:${PORT}                   ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Alur: Saweria/Trakteer → webhook → Streamlabs Alert    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (!cfg.streamlabs?.access_token) {
    console.log('⚠  access_token belum diset! Buka dashboard → isi token\n');
  }
  if (cfg.streamlabs?.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabsSocket(cfg.streamlabs.socket_token);
  }
});

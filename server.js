// Stream Alert Hub — server.js
// Terima webhook dari Saweria, Trakteer, SociaBuzz, Streamlabs
// Push ke overlay via SSE → 1 Browser Source di OBS
// Jalankan: node server.js

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const app    = express();
const server = http.createServer(app);

// ── Config file ─────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch {
    return {
      saweria:     { enabled: false, stream_key: '' },
      trakteer:    { enabled: false, webhook_secret: '' },
      sociabuzz:   { enabled: false, webhook_secret: '' },
      streamlabs:  { enabled: false, socket_token: '' },
      overlay: {
        theme: 'dark',
        position: 'bottom-right',
        duration: 6000,
        sound: true,
        queue_delay: 1000,
      }
    };
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── SSE Clients ─────────────────────────────────────────
const overlayClients = new Set();

function pushAlert(alert) {
  const msg = 'data:' + JSON.stringify(alert) + '\n\n';
  overlayClients.forEach(res => {
    try { res.write(msg); } catch { overlayClients.delete(res); }
  });
  console.log(`[ALERT] ${alert.provider} | ${alert.type} | from: ${alert.from} | amount: ${alert.amount || '-'}`);
}

// ── Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Raw body untuk verifikasi signature webhook
app.use('/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Pages ────────────────────────────────────────────────
app.get('/',        (_, r) => r.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/overlay', (_, r) => r.sendFile(path.join(__dirname, 'public', 'overlay.html')));

// ── SSE Overlay ──────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const cfg = loadConfig();
  res.write('data:' + JSON.stringify({ type: 'CONFIG', config: cfg.overlay }) + '\n\n');

  overlayClients.add(res);
  console.log(`[SSE] +1 overlay client (total: ${overlayClients.size})`);

  const ping = setInterval(() => {
    try { res.write('data:{"type":"ping"}\n\n'); } catch { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    overlayClients.delete(res);
    console.log(`[SSE] -1 overlay client (total: ${overlayClients.size})`);
  });
});

// ── Config API ───────────────────────────────────────────
app.get('/api/config', (_, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const cfg = loadConfig();
  const body = req.body;
  // Merge semua field
  ['saweria','trakteer','sociabuzz','streamlabs','overlay'].forEach(k => {
    if (body[k]) cfg[k] = { ...cfg[k], ...body[k] };
  });
  saveConfig(cfg);
  // Restart Streamlabs socket jika token berubah
  if (body.streamlabs) restartStreamlabs();
  res.json({ ok: true });
});

// ── Test Alert API ───────────────────────────────────────
app.post('/api/test', (req, res) => {
  const { provider } = req.body;
  const testAlerts = {
    saweria: {
      provider: 'saweria', type: 'donation',
      from: 'Tester', amount: 69420, currency: 'IDR',
      message: 'Test donasi dari Saweria! Semangat streaming!',
      timestamp: new Date().toISOString(),
    },
    trakteer: {
      provider: 'trakteer', type: 'donation',
      from: 'Tester', amount: 5000, currency: 'IDR',
      unit: 'Cendol', quantity: 2,
      message: 'Test dari Trakteer! Terus berkarya!',
      avatar: 'https://edge-cdn.trakteer.id/images/mix/default-avatar.png',
      timestamp: new Date().toISOString(),
    },
    sociabuzz: {
      provider: 'sociabuzz', type: 'donation',
      from: 'Tester', amount: 20000, currency: 'IDR',
      message: 'Test dari SociaBuzz! Mantap!',
      timestamp: new Date().toISOString(),
    },
    streamlabs: {
      provider: 'streamlabs', type: 'donation',
      from: 'Tester', amount: 5, currency: 'USD',
      message: 'Test dari Streamlabs! GG!',
      timestamp: new Date().toISOString(),
    },
    follow: {
      provider: 'streamlabs', type: 'follow',
      from: 'NewFollower', amount: null,
      message: '',
      timestamp: new Date().toISOString(),
    },
    subscription: {
      provider: 'streamlabs', type: 'subscription',
      from: 'Subscriber', amount: null,
      message: 'Sub baru!',
      timestamp: new Date().toISOString(),
    },
  };
  const alert = testAlerts[provider] || testAlerts.saweria;
  pushAlert(alert);
  res.json({ ok: true, alert });
});

// ── Status API ───────────────────────────────────────────
app.get('/api/status', (_, res) => {
  const ip = getLocalIP();
  res.json({
    version: '1.0.0',
    overlayClients: overlayClients.size,
    overlay_url: `http://localhost:3000/overlay`,
    mobile_ip: `http://${ip}:3000`,
  });
});

// ═══════════════════════════════════════════════════════
// SAWERIA WEBHOOK
// POST /webhook/saweria
// Saweria kirim POST + header Saweria-Callback-Signature
// Signature = HMAC-SHA256(body, stream_key)
// ═══════════════════════════════════════════════════════
app.post('/webhook/saweria', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.saweria.enabled) return res.sendStatus(200);

  // Verifikasi signature
  const sig = req.headers['saweria-callback-signature'];
  if (sig && cfg.saweria.stream_key) {
    const expected = crypto
      .createHmac('sha256', cfg.saweria.stream_key)
      .update(req.body)
      .digest('hex');
    if (sig !== expected) {
      console.warn('[Saweria] Invalid signature');
      return res.sendStatus(401);
    }
  }

  let data;
  try { data = JSON.parse(req.body.toString()); }
  catch { return res.sendStatus(400); }

  const alert = {
    provider: 'saweria',
    type: data.type || 'donation',
    from: data.donator_name || 'Anonim',
    amount: data.amount_raw || data.etc?.amount_to_display || 0,
    currency: 'IDR',
    message: data.message || '',
    avatar: null,
    timestamp: data.created_at || new Date().toISOString(),
  };

  pushAlert(alert);
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// TRAKTEER WEBHOOK
// POST /webhook/trakteer
// Body: JSON dengan field supporter_name, price, quantity, dll
// ═══════════════════════════════════════════════════════
app.post('/webhook/trakteer', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.trakteer.enabled) return res.sendStatus(200);

  let data;
  try {
    // Trakteer bisa kirim raw atau parsed
    data = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  // Trakteer webhook payload berada di dalam field "data"
  const d = data.data || data;

  // Parse amount dari string "Rp 5.000" → number
  let amount = 0;
  if (d.price) {
    amount = parseInt(d.price.replace(/[^0-9]/g, '')) || 0;
  }

  const alert = {
    provider: 'trakteer',
    type: 'donation',
    from: d.supporter_name || 'Anonim',
    amount,
    currency: 'IDR',
    unit: d.unit || '',
    quantity: d.quantity || 1,
    message: d.supporter_message || '',
    avatar: d.supporter_avatar || null,
    unit_icon: d.unit_icon || null,
    timestamp: new Date().toISOString(),
  };

  pushAlert(alert);
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// SOCIABUZZ WEBHOOK
// POST /webhook/sociabuzz
// Body: JSON dari SociaBuzz Tribe
// ═══════════════════════════════════════════════════════
app.post('/webhook/sociabuzz', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.sociabuzz.enabled) return res.sendStatus(200);

  let data;
  try {
    data = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  // SociaBuzz payload bisa berbeda tergantung versi
  // Field utama: invoker_name, amount, message, type
  const alert = {
    provider: 'sociabuzz',
    type: data.type || 'donation',
    from: data.invoker_name || data.supporter_name || data.from || 'Anonim',
    amount: data.amount || data.amount_raw || 0,
    currency: 'IDR',
    message: data.message || data.supporter_message || '',
    avatar: data.avatar || data.invoker_avatar || null,
    timestamp: data.created_at || new Date().toISOString(),
  };

  pushAlert(alert);
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// STREAMLABS SOCKET.IO CLIENT
// Streamlabs pakai Socket.IO, bukan webhook biasa
// Server ini connect ke Streamlabs sebagai client
// ═══════════════════════════════════════════════════════
let slSocket = null;

function restartStreamlabs() {
  if (slSocket) {
    try { slSocket.disconnect(); } catch {}
    slSocket = null;
  }
  const cfg = loadConfig();
  if (cfg.streamlabs.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabs(cfg.streamlabs.socket_token);
  }
}

function connectStreamlabs(token) {
  // Dynamic import karena socket.io-client adalah ESM di versi baru
  // Pakai versi 2.x yang masih CJS
  try {
    const io = require('socket.io-client');
    const url = `https://sockets.streamlabs.com?token=${token}`;
    slSocket = io(url, { transports: ['websocket'] });

    slSocket.on('connect', () => console.log('[Streamlabs] Socket connected ✓'));
    slSocket.on('disconnect', () => console.log('[Streamlabs] Socket disconnected'));
    slSocket.on('connect_error', e => console.error('[Streamlabs] Connect error:', e.message));

    slSocket.on('event', (data) => {
      if (!data || !data.type || !data.message) return;
      const events = Array.isArray(data.message) ? data.message : [data.message];

      events.forEach(ev => {
        let alert = null;

        if (data.type === 'donation') {
          alert = {
            provider: 'streamlabs',
            type: 'donation',
            from: ev.name || 'Anonim',
            amount: parseFloat(ev.amount) || 0,
            currency: ev.currency || 'USD',
            message: ev.message || '',
            avatar: ev.avatar || null,
            timestamp: new Date().toISOString(),
          };
        } else if (data.type === 'follow') {
          alert = {
            provider: 'streamlabs',
            type: 'follow',
            from: ev.name || ev.from || 'Someone',
            amount: null,
            currency: null,
            message: '',
            timestamp: new Date().toISOString(),
          };
        } else if (data.type === 'subscription' || data.type === 'resub') {
          alert = {
            provider: 'streamlabs',
            type: 'subscription',
            from: ev.name || 'Someone',
            amount: null,
            currency: null,
            message: ev.message || '',
            months: ev.months || 1,
            timestamp: new Date().toISOString(),
          };
        } else if (data.type === 'bits') {
          alert = {
            provider: 'streamlabs',
            type: 'bits',
            from: ev.name || 'Someone',
            amount: ev.amount || 0,
            currency: 'bits',
            message: ev.message || '',
            timestamp: new Date().toISOString(),
          };
        }

        if (alert) pushAlert(alert);
      });
    });
  } catch (e) {
    console.error('[Streamlabs] socket.io-client not installed:', e.message);
    console.log('[Streamlabs] Run: npm install socket.io-client@2');
  }
}

// ── Utils ────────────────────────────────────────────────
function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces()))
    for (const n of ifaces)
      if (n.family === 'IPv4' && !n.internal) return n.address;
  return 'localhost';
}

// ── Start ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   Stream Alert Hub v1.0                                 ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard  →  http://localhost:${PORT}                      ║`);
  console.log(`║  Overlay OBS→  http://localhost:${PORT}/overlay               ║`);
  console.log(`║  LAN IP     →  http://${ip}:${PORT}                ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Webhook URLs (perlu ngrok/tunnel untuk internet):      ║');
  console.log(`║  Saweria    →  http://localhost:${PORT}/webhook/saweria        ║`);
  console.log(`║  Trakteer   →  http://localhost:${PORT}/webhook/trakteer       ║`);
  console.log(`║  SociaBuzz  →  http://localhost:${PORT}/webhook/sociabuzz      ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Auto-connect Streamlabs jika sudah ada config
  const cfg = loadConfig();
  if (cfg.streamlabs.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabs(cfg.streamlabs.socket_token);
  }
});

// SE Alert Bridge — server.js v1.0
// Terima webhook dari Saweria, Trakteer, SociaBuzz, Streamlabs
// Push ke SE Custom Widget via SSE (EventSource dari widget SE)
// Jalankan: node server.js  →  http://localhost:3000

const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');

const app    = express();
const server = http.createServer(app);

// ── Config ────────────────────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch {
    const def = {
      saweria:    { enabled: false, stream_key: '' },
      trakteer:   { enabled: false },
      sociabuzz:  { enabled: false },
      streamlabs: { enabled: false, socket_token: '' },
      overlay: {
        position:    'bottom-right',
        duration:    6000,
        queue_delay: 1000,
        sound:       true,
      },
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    return def;
  }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ── SSE Clients (SE widget connect ke sini) ───────────────
const clients = new Set();

function pushEvent(alert) {
  const msg = 'data:' + JSON.stringify(alert) + '\n\n';
  clients.forEach(res => {
    try { res.write(msg); } catch { clients.delete(res); }
  });
  console.log(`[ALERT] ${alert.provider} | ${alert.type} | ${alert.from} | ${alert.amount ?? '-'} ${alert.currency ?? ''}`);
}

// ── Middleware ────────────────────────────────────────────
// CORS harus izinkan origin SE agar widget bisa fetch ke sini
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'] }));
app.options('*', cors());

// Raw body untuk verifikasi signature Saweria
app.use('/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Halaman utama ─────────────────────────────────────────
app.get('/', (_, r) => r.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ── Serve widget code sebagai plain text ─────────────────
// Dashboard ambil ini dan user copy-paste ke SE
app.get('/widget-code', (_, res) => {
  const file = path.join(__dirname, 'public', 'se-widget.html');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(file);
});

// ── SSE endpoint — SE Custom Widget connect ke sini ───────
app.get('/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  clients.add(res);
  console.log(`[SSE] +1 widget terhubung (total: ${clients.size})`);

  // Kirim config overlay saat connect
  const cfg = loadConfig();
  res.write('data:' + JSON.stringify({ type: 'CONFIG', config: cfg.overlay }) + '\n\n');
  res.write('data:{"type":"connected"}\n\n');

  const ping = setInterval(() => {
    try { res.write('data:{"type":"ping"}\n\n'); } catch { clearInterval(ping); }
  }, 20000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    console.log(`[SSE] -1 widget (total: ${clients.size})`);
  });
});

// ── Config API ────────────────────────────────────────────
app.get('/api/config', (_, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const cfg  = loadConfig();
  const body = req.body;
  ['saweria','trakteer','sociabuzz','streamlabs','overlay'].forEach(k => {
    if (body[k]) cfg[k] = { ...cfg[k], ...body[k] };
  });
  saveConfig(cfg);
  if (body.streamlabs) restartStreamlabs();
  // Broadcast config baru ke semua widget yang terhubung
  const updated = loadConfig();
  clients.forEach(r => {
    try { r.write('data:' + JSON.stringify({ type: 'CONFIG', config: updated.overlay }) + '\n\n'); } catch {}
  });
  res.json({ ok: true });
});

// ── Status API ────────────────────────────────────────────
app.get('/api/status', (_, res) => {
  const ip = getLocalIP();
  res.json({
    version: '1.0.0',
    widgets_connected: clients.size,
    local_ip: ip,
  });
});

// ── Test alert ────────────────────────────────────────────
app.post('/api/test', (req, res) => {
  const samples = {
    saweria: {
      provider:'saweria', type:'donation',
      from:'Tester', amount:69420, currency:'IDR',
      message:'Test donasi dari Saweria! Semangat streaming!',
      timestamp: new Date().toISOString(),
    },
    trakteer: {
      provider:'trakteer', type:'donation',
      from:'Tester', amount:5000, currency:'IDR',
      unit:'Cendol', quantity:2,
      message:'Test dari Trakteer! Terus berkarya!',
      avatar:'https://edge-cdn.trakteer.id/images/mix/default-avatar.png',
      timestamp: new Date().toISOString(),
    },
    sociabuzz: {
      provider:'sociabuzz', type:'donation',
      from:'Tester', amount:20000, currency:'IDR',
      message:'Test dari SociaBuzz! Mantap!',
      timestamp: new Date().toISOString(),
    },
    streamlabs: {
      provider:'streamlabs', type:'donation',
      from:'Tester', amount:5, currency:'USD',
      message:'Test dari Streamlabs! GG!',
      timestamp: new Date().toISOString(),
    },
    follow: {
      provider:'streamlabs', type:'follow',
      from:'NewFollower', amount:null, currency:null, message:'',
      timestamp: new Date().toISOString(),
    },
    subscription: {
      provider:'streamlabs', type:'subscription',
      from:'Subscriber', amount:null, currency:null,
      message:'Sub baru! 3 bulan berturut-turut!', months:3,
      timestamp: new Date().toISOString(),
    },
  };
  const alert = samples[req.body?.provider] || samples.saweria;
  pushEvent(alert);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// SAWERIA WEBHOOK
// POST /webhook/saweria
// Header: Saweria-Callback-Signature = HMAC-SHA256(body, stream_key)
// ═══════════════════════════════════════════════════════
app.post('/webhook/saweria', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.saweria?.enabled) return res.sendStatus(200);

  const sig = req.headers['saweria-callback-signature'];
  if (sig && cfg.saweria.stream_key) {
    const expected = crypto
      .createHmac('sha256', cfg.saweria.stream_key)
      .update(req.body)
      .digest('hex');
    if (sig !== expected) {
      console.warn('[Saweria] Signature tidak valid');
      return res.sendStatus(401);
    }
  }

  let data;
  try { data = JSON.parse(req.body.toString()); }
  catch { return res.sendStatus(400); }

  pushEvent({
    provider:  'saweria',
    type:      data.type || 'donation',
    from:      data.donator_name || 'Anonim',
    amount:    data.amount_raw ?? data.etc?.amount_to_display ?? 0,
    currency:  'IDR',
    message:   data.message || '',
    avatar:    null,
    timestamp: data.created_at || new Date().toISOString(),
  });
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// TRAKTEER WEBHOOK
// POST /webhook/trakteer
// ═══════════════════════════════════════════════════════
app.post('/webhook/trakteer', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.trakteer?.enabled) return res.sendStatus(200);

  let raw;
  try {
    raw = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  const d = raw.data || raw;
  let amount = 0;
  if (d.price) amount = parseInt(String(d.price).replace(/[^0-9]/g, '')) || 0;

  pushEvent({
    provider:  'trakteer',
    type:      'donation',
    from:      d.supporter_name || 'Anonim',
    amount,
    currency:  'IDR',
    unit:      d.unit || '',
    quantity:  d.quantity || 1,
    message:   d.supporter_message || '',
    avatar:    d.supporter_avatar || null,
    unit_icon: d.unit_icon || null,
    timestamp: new Date().toISOString(),
  });
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// SOCIABUZZ WEBHOOK
// POST /webhook/sociabuzz
// ═══════════════════════════════════════════════════════
app.post('/webhook/sociabuzz', (req, res) => {
  const cfg = loadConfig();
  if (!cfg.sociabuzz?.enabled) return res.sendStatus(200);

  let data;
  try {
    data = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  pushEvent({
    provider:  'sociabuzz',
    type:      data.type || 'donation',
    from:      data.invoker_name || data.supporter_name || data.from || 'Anonim',
    amount:    data.amount || data.amount_raw || 0,
    currency:  'IDR',
    message:   data.message || data.supporter_message || '',
    avatar:    data.avatar || data.invoker_avatar || null,
    timestamp: data.created_at || new Date().toISOString(),
  });
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// STREAMLABS — Socket.IO client (tidak butuh ngrok)
// ═══════════════════════════════════════════════════════
let slSocket = null;

function restartStreamlabs() {
  if (slSocket) { try { slSocket.disconnect(); } catch {} slSocket = null; }
  const cfg = loadConfig();
  if (cfg.streamlabs?.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabs(cfg.streamlabs.socket_token);
  }
}

function connectStreamlabs(token) {
  try {
    const io = require('socket.io-client');
    slSocket  = io(`https://sockets.streamlabs.com?token=${token}`, { transports: ['websocket'] });

    slSocket.on('connect',       () => console.log('[Streamlabs] Connected ✓'));
    slSocket.on('disconnect',    () => console.log('[Streamlabs] Disconnected'));
    slSocket.on('connect_error', e  => console.error('[Streamlabs] Error:', e.message));

    slSocket.on('event', data => {
      if (!data?.type || !data.message) return;
      const events = Array.isArray(data.message) ? data.message : [data.message];
      events.forEach(ev => {
        let alert = null;
        if (data.type === 'donation') {
          alert = { provider:'streamlabs', type:'donation', from:ev.name||'Anonim', amount:parseFloat(ev.amount)||0, currency:ev.currency||'USD', message:ev.message||'', avatar:ev.avatar||null, timestamp:new Date().toISOString() };
        } else if (data.type === 'follow') {
          alert = { provider:'streamlabs', type:'follow', from:ev.name||ev.from||'Someone', amount:null, currency:null, message:'', timestamp:new Date().toISOString() };
        } else if (['subscription','resub'].includes(data.type)) {
          alert = { provider:'streamlabs', type:'subscription', from:ev.name||'Someone', amount:null, currency:null, message:ev.message||'', months:ev.months||1, timestamp:new Date().toISOString() };
        } else if (data.type === 'bits') {
          alert = { provider:'streamlabs', type:'bits', from:ev.name||'Someone', amount:ev.amount||0, currency:'bits', message:ev.message||'', timestamp:new Date().toISOString() };
        }
        if (alert) pushEvent(alert);
      });
    });
  } catch (e) {
    console.error('[Streamlabs] socket.io-client error:', e.message);
    console.log('[Streamlabs] Coba: npm install socket.io-client@2');
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
  const ip = getLocalIP();
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SE Alert Bridge v1.0                                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard  →  http://localhost:${PORT}                      ║`);
  console.log(`║  SSE Events →  http://localhost:${PORT}/events               ║`);
  console.log(`║  Widget Code→  http://localhost:${PORT}/widget-code           ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Webhook endpoints (butuh ngrok untuk Saweria dll):     ║');
  console.log(`║  /webhook/saweria  /webhook/trakteer  /webhook/sociabuzz║`);
  console.log(`║  LAN: http://${ip}:${PORT}                      ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const cfg = loadConfig();
  if (cfg.streamlabs?.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabs(cfg.streamlabs.socket_token);
  }
});

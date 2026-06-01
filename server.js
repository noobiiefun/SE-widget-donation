// SE Alert Bridge — server.js v2.0
// Mendukung dua mode:
//   1. OBS langsung → http://localhost:3000/overlay  (PALING MUDAH, tidak perlu ngrok)
//   2. SE Custom Widget → pakai ngrok URL

const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const http    = require('http');
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

// ── SSE Clients ───────────────────────────────────────────
const clients = new Set();

function pushEvent(alert) {
  const msg = 'data:' + JSON.stringify(alert) + '\n\n';
  const dead = [];
  clients.forEach(res => {
    try { res.write(msg); }
    catch { dead.push(res); }
  });
  dead.forEach(r => clients.delete(r));
  console.log(`[ALERT] ${alert.provider} | ${alert.type} | "${alert.from}" | ${alert.amount ?? '-'} ${alert.currency ?? ''} | clients: ${clients.size}`);
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

// ── Routes ────────────────────────────────────────────────
app.get('/', (_, r) => r.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ── OVERLAY langsung untuk OBS (tidak perlu ngrok!) ───────
// Buka di OBS Browser Source: http://localhost:3000/overlay
app.get('/overlay', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// ── Widget code untuk SE (inject ngrok URL otomatis) ──────
app.get('/widget-code', (_, res) => {
  const cfg      = loadConfig();
  const ngrokUrl = (cfg.ngrokUrl || '').trim().replace(/\/$/, '');
  const file     = path.join(__dirname, 'public', 'se-widget.html');
  let html       = fs.readFileSync(file, 'utf8');

  // Inject ngrok URL ke SERVER_URL
  html = html.replace(
    /const SERVER_URL\s*=\s*['"][^'"]*['"]/,
    `const SERVER_URL = '${ngrokUrl || 'MASUKKAN_NGROK_URL_DI_DASHBOARD'}'`
  );

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(html);
});

// ── SSE endpoint — widget connect ke sini ────────────────
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type':                'text/event-stream',
    'Cache-Control':               'no-cache, no-transform',
    'Connection':                  'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering':           'no',
  });

  res.write(':ok\n\n');
  clients.add(res);
  console.log(`[SSE] +1 client terhubung (total: ${clients.size})`);

  // Kirim config ke client baru
  const cfg = loadConfig();
  res.write('data:' + JSON.stringify({ type: 'CONFIG', config: cfg.overlay }) + '\n\n');
  res.write('data:{"type":"connected"}\n\n');

  const ping = setInterval(() => {
    try { res.write(':ping\n\n'); }
    catch { clearInterval(ping); clients.delete(res); }
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    console.log(`[SSE] -1 client (total: ${clients.size})`);
  });
});

// ── Config API ────────────────────────────────────────────
app.get('/api/config', (_, res) => res.json(loadConfig()));

app.post('/api/config', (req, res) => {
  const cfg  = loadConfig();
  const body = req.body;

  if (body.ngrokUrl !== undefined)
    cfg.ngrokUrl = body.ngrokUrl.trim().replace(/\/$/, '');

  ['saweria','trakteer','sociabuzz','streamlabs','overlay'].forEach(k => {
    if (body[k]) cfg[k] = { ...cfg[k], ...body[k] };
  });

  saveConfig(cfg);
  if (body.streamlabs) restartStreamlabs();

  // Broadcast config baru ke semua client
  const updated = loadConfig();
  clients.forEach(r => {
    try { r.write('data:' + JSON.stringify({ type: 'CONFIG', config: updated.overlay }) + '\n\n'); } catch {}
  });
  res.json({ ok: true });
});

// ── Status API ────────────────────────────────────────────
app.get('/api/status', (_, res) => {
  const cfg = loadConfig();
  res.json({
    version:           '2.0.0',
    clients_connected: clients.size,
    local_ip:          getLocalIP(),
    ngrok_url:         cfg.ngrokUrl || null,
    ngrok_configured:  !!cfg.ngrokUrl,
    overlay_url:       `http://localhost:3000/overlay`,
    saweria_enabled:   cfg.saweria?.enabled || false,
    saweria_has_key:   !!(cfg.saweria?.stream_key),
  });
});

// ── Test Alert ────────────────────────────────────────────
app.post('/api/test', (req, res) => {
  const samples = {
    saweria: {
      provider:'saweria', type:'donation',
      from:'Tester Saweria', amount:69420, currency:'IDR',
      message:'Test donasi dari Saweria! Semangat streaming!',
      timestamp: new Date().toISOString(),
    },
    trakteer: {
      provider:'trakteer', type:'donation',
      from:'Tester Trakteer', amount:5000, currency:'IDR',
      unit:'Cendol', quantity:2,
      message:'Test dari Trakteer!',
      timestamp: new Date().toISOString(),
    },
    sociabuzz: {
      provider:'sociabuzz', type:'donation',
      from:'Tester SociaBuzz', amount:20000, currency:'IDR',
      message:'Test dari SociaBuzz!',
      timestamp: new Date().toISOString(),
    },
    streamlabs: {
      provider:'streamlabs', type:'donation',
      from:'Tester Streamlabs', amount:5, currency:'USD',
      message:'Test dari Streamlabs!',
      timestamp: new Date().toISOString(),
    },
    follow: {
      provider:'streamlabs', type:'follow',
      from:'NewFollower123', amount:null, currency:null, message:'',
      timestamp: new Date().toISOString(),
    },
    subscription: {
      provider:'streamlabs', type:'subscription',
      from:'SubBaru', amount:null, currency:null,
      message:'Sub baru!', months:3,
      timestamp: new Date().toISOString(),
    },
  };
  const alert = samples[req.body?.provider] || samples.saweria;
  console.log(`[TEST] Kirim: ${alert.provider}, clients aktif: ${clients.size}`);
  pushEvent(alert);
  res.json({ ok: true, sent: alert, clients_count: clients.size });
});

// ═══════════════════════════════════════════════════════
// SAWERIA WEBHOOK
// ═══════════════════════════════════════════════════════
app.post('/webhook/saweria', (req, res) => {
  const cfg    = loadConfig();
  const rawBody = req.body;

  let bodyStr;
  try {
    bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : JSON.stringify(rawBody);
  } catch { return res.sendStatus(400); }

  // Verifikasi signature (opsional, tidak block kalau gagal)
  const sig = req.headers['saweria-callback-signature'];
  if (sig && cfg.saweria?.stream_key) {
    const expected = crypto
      .createHmac('sha256', cfg.saweria.stream_key.trim())
      .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(bodyStr))
      .digest('hex');
    if (sig === expected) {
      console.log('[Saweria] ✓ Signature valid');
    } else {
      // TIDAK return 401 — tetap proses agar donasi masuk
      console.warn('[Saweria] ⚠ Signature tidak cocok (tetap diproses) — pastikan Stream Key benar');
    }
  }

  let data;
  try { data = JSON.parse(bodyStr); }
  catch { return res.sendStatus(400); }

  let amount = 0;
  if (data.amount_raw !== undefined)               amount = data.amount_raw;
  else if (data.etc?.amount_to_display !== undefined) amount = data.etc.amount_to_display;
  else if (data.amount !== undefined)              amount = parseInt(String(data.amount).replace(/[^0-9]/g, '')) || 0;

  pushEvent({
    provider:  'saweria',
    type:      data.type || 'donation',
    from:      data.donator_name || data.name || 'Anonim',
    amount,
    currency:  'IDR',
    message:   data.message || '',
    avatar:    null,
    timestamp: data.created_at || new Date().toISOString(),
  });
  res.sendStatus(200);
});

// ═══════════════════════════════════════════════════════
// TRAKTEER WEBHOOK
// ═══════════════════════════════════════════════════════
app.post('/webhook/trakteer', (req, res) => {
  let raw;
  try {
    raw = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  const d = raw.data || raw;
  const amount = d.price ? parseInt(String(d.price).replace(/[^0-9]/g, '')) || 0 : 0;

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
// ═══════════════════════════════════════════════════════
app.post('/webhook/sociabuzz', (req, res) => {
  let data;
  try {
    data = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
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
// STREAMLABS SOCKET
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
          alert = { provider:'streamlabs', type:'follow', from:ev.name||'Someone', amount:null, currency:null, message:'', timestamp:new Date().toISOString() };
        } else if (['subscription','resub'].includes(data.type)) {
          alert = { provider:'streamlabs', type:'subscription', from:ev.name||'Someone', amount:null, currency:null, message:ev.message||'', months:ev.months||1, timestamp:new Date().toISOString() };
        } else if (data.type === 'bits') {
          alert = { provider:'streamlabs', type:'bits', from:ev.name||'Someone', amount:ev.amount||0, currency:'bits', message:ev.message||'', timestamp:new Date().toISOString() };
        }
        if (alert) pushEvent(alert);
      });
    });
  } catch (e) {
    console.error('[Streamlabs] Error:', e.message);
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
  const ip  = getLocalIP();
  const cfg = loadConfig();

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SE Alert Bridge v2.0                                  ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Dashboard  →  http://localhost:${PORT}                      ║`);
  console.log(`║  SSE Events →  http://localhost:${PORT}/events               ║`);
  console.log(`║  Widget Code→  http://localhost:${PORT}/widget-code           ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  ⭐ CARA MUDAH — OBS langsung tanpa SE widget:          ║');
  console.log(`║  Browser Source → http://localhost:${PORT}/overlay           ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Webhook endpoints (butuh ngrok):                       ║');
  console.log('║  /webhook/saweria  /webhook/trakteer  /webhook/sociabuzz║');
  console.log(`║  LAN: http://${ip}:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  if (cfg.streamlabs?.enabled && cfg.streamlabs.socket_token) {
    connectStreamlabs(cfg.streamlabs.socket_token);
  }
});

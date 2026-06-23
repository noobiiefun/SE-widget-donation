# 🎯 SE Alert Bridge — Dokumentasi Teknis v3.0

> **Streamlabs Edition** — Saweria, Trakteer, SociaBuzz → Streamlabs Alert Box → OBS

| | |
|---|---|
| **Repo** | `noobiiefun/SE-widget-donation` |
| **Stack** | Node.js + Express + Streamlabs API |
| **Platform** | YouTube Live + OBS Studio |
| **Provider** | Saweria, Trakteer, SociaBuzz |

---

## Daftar Isi

1. [Ringkasan Proyek](#1-ringkasan-proyek)
2. [Arsitektur & Struktur File](#2-arsitektur--struktur-file)
3. [Fungsi Utama server.js](#3-fungsi-utama-serverjs)
4. [Sistem Konfigurasi](#4-sistem-konfigurasi)
5. [Dashboard](#5-dashboard-dashboardhtml)
6. [Panduan Setup Lengkap](#6-panduan-setup-lengkap)
7. [Format Payload Webhook](#7-format-payload-webhook-provider)
8. [Known Issues & Debug](#8-known-issues--cara-debug)
9. [Roadmap Fitur](#9-roadmap-fitur--pengembangan)
10. [Panduan untuk Developer & AI](#10-panduan-untuk-developer--ai)
11. [Changelog](#11-changelog)

---

## 1. Ringkasan Proyek

SE Alert Bridge adalah server lokal berbasis Node.js yang menjadi jembatan antara platform donasi Indonesia dan Streamlabs Alert Box di OBS. Tujuannya: **semua notifikasi donasi masuk ke 1 Browser Source di OBS**.

### Masalah yang Dipecahkan

- Streamer Indonesia sering pakai beberapa platform donasi sekaligus (Saweria + Trakteer + SociaBuzz)
- Setiap platform butuh Browser Source terpisah di OBS — ribet manajemen scene
- WebSocket dari provider tidak bisa diproxy karena signature/origin validation ketat
- **Solusi:** terima webhook dari provider → forward ke Streamlabs API → 1 Alert Box di OBS

### Kenapa Streamlabs (bukan StreamElements)?

StreamElements **tidak mendukung** push donation API untuk kanal YouTube. Streamlabs mendukung endpoint `POST /api/v2.0/donations` yang bisa menerima event dari sumber eksternal, sehingga donasi dari Saweria/Trakteer bisa muncul di Streamlabs Alert Box.

### Alur Kerja

```
Donatur → Saweria / Trakteer / SociaBuzz
               ↓  (webhook HTTP POST via ngrok)
          Server Lokal (localhost:3000)
               ↓  (HTTPS POST ke Streamlabs API)
          Streamlabs Alert Box
               ↓  (Browser Source di OBS)
          Muncul di layar stream ✅
```

---

## 2. Arsitektur & Struktur File

### Struktur Direktori

```
SE-widget-donation/
├── server.js              ← Entry point, semua logika backend
├── package.json           ← Dependencies
├── config.json            ← Config tersimpan (auto-generated, di .gitignore)
├── start.bat              ← Windows launcher
├── .gitignore
└── public/
    ├── dashboard.html     ← UI konfigurasi (buka di browser)
    ├── overlay.html       ← OBS overlay langsung (mode alternatif tanpa Streamlabs)
    └── se-widget.html     ← SE Custom Widget (mode lama, deprecated)
```

### Dependencies

| Package | Versi | Kegunaan |
|---|---|---|
| `express` | ^4.19.2 | HTTP server & routing |
| `cors` | ^2.8.5 | Cross-origin resource sharing |
| `socket.io-client` | ^2.5.0 | Konek ke Streamlabs Socket API (native events) |
| `nodemon` | ^3.1.4 | Auto-restart saat development (devDependency) |

> **Catatan:** Tidak ada dependency eksternal untuk HTTPS — menggunakan modul bawaan Node.js (`https`, `http`, `crypto`, `fs`, `os`, `path`) untuk push ke Streamlabs API dan verifikasi webhook signature.

### Semua Endpoint

| Endpoint | Method | Fungsi |
|---|---|---|
| `/` | GET | Serve `dashboard.html` |
| `/overlay` | GET | Serve `overlay.html` (mode OBS langsung) |
| `/api/config` | GET | Ambil config tersimpan |
| `/api/config` | POST | Simpan config (token, ngrok, provider) |
| `/api/ngrok` | POST | Simpan ngrok URL saja |
| `/api/status` | GET | Status server & kondisi config |
| `/api/test` | POST | Kirim test alert ke Streamlabs |
| `/webhook/saweria` | POST | Terima webhook dari Saweria |
| `/webhook/trakteer` | POST | Terima webhook dari Trakteer |
| `/webhook/sociabuzz` | POST | Terima webhook dari SociaBuzz |

---

## 3. Fungsi Utama server.js

### 3.1 `pushToStreamlabs(data)`

Fungsi inti yang mem-forward data donasi ke Streamlabs API. Dipanggil setiap ada webhook masuk dari provider manapun.

**Parameter `data`:**

| Field | Tipe | Keterangan |
|---|---|---|
| `provider` | string | `"saweria"` \| `"trakteer"` \| `"sociabuzz"` |
| `from` | string | Nama donatur |
| `amount` | number | Nominal (IDR atau USD) |
| `currency` | string | `"IDR"` \| `"USD"` |
| `message` | string | Pesan donatur |
| `unit` | string | *(opsional)* Unit Trakteer, contoh `"Cendol"` |
| `quantity` | number | *(opsional)* Jumlah unit Trakteer |

**Logika konversi mata uang:**

Streamlabs tip API hanya menerima USD. Donasi IDR di-forward sebagai `$0.01` agar alert tetap trigger. Nominal IDR asli disertakan dalam field `message`.

**Format yang muncul di Streamlabs Alert Box:**

```
Nama:  "Yoga Pratama [Saweria]"
Pesan: "Rp 69k — Semangat streaming!"

Nama:  "Budi [Trakteer]"
Pesan: "2x Cendol — Test dari Trakteer!"
```

**Response handling:**
- Sukses → response JSON dengan field `donation_id` → log ✅
- Gagal → response tanpa `donation_id` → log ❌ dengan body response
- Error network → catch block → log ❌ dengan pesan error

---

### 3.2 Webhook Handler — Saweria

**Route:** `POST /webhook/saweria`

**Verifikasi signature:** Header `saweria-callback-signature` diverifikasi dengan HMAC-SHA256 menggunakan `stream_key` dari config. Jika tidak cocok, webhook **tetap diproses** (tidak di-reject) — hanya warning di log. Ini mencegah donasi hilang jika stream_key salah.

**Field yang diambil:**

| Field Body | Dipetakan ke | Keterangan |
|---|---|---|
| `donator_name` / `name` | `from` | Nama donatur |
| `amount_raw` | `amount` | Prioritas pertama |
| `etc.amount_to_display` | `amount` | Prioritas kedua |
| `amount` | `amount` | Fallback, di-parse dari string |
| `message` | `message` | Pesan donatur |
| `created_at` | `timestamp` | Waktu donasi |

---

### 3.3 Webhook Handler — Trakteer

**Route:** `POST /webhook/trakteer`

Body bisa berada di root atau di dalam field `data`. Server mencoba keduanya. Tidak ada verifikasi signature.

| Field Body | Dipetakan ke | Keterangan |
|---|---|---|
| `data.supporter_name` | `from` | Nama supporter |
| `data.price` | `amount` | Nominal, di-parse dari string IDR |
| `data.unit` | `unit` | Nama unit (Cendol, Kopi, dll) |
| `data.quantity` | `quantity` | Jumlah unit |
| `data.supporter_message` | `message` | Pesan supporter |

---

### 3.4 Webhook Handler — SociaBuzz

**Route:** `POST /webhook/sociabuzz`

Format body langsung di root. Mendukung dua kemungkinan field nama (`invoker_name` atau `supporter_name`).

---

### 3.5 `connectStreamlabsSocket(token)`

Koneksi opsional ke Streamlabs Socket API menggunakan `socket.io-client` v2. Digunakan untuk menerima event native YouTube (follow, superchat) yang datang langsung dari Streamlabs.

> Event yang diterima hanya di-log — Streamlabs sudah otomatis menampilkan event native-nya di Alert Box. Socket ini murni untuk monitoring.

> ⚠️ **Known issue:** Auto-reconnect belum diimplementasi. Jika socket disconnect, perlu restart server.

---

## 4. Sistem Konfigurasi

### Struktur `config.json`

```json
{
  "ngrokUrl": "https://xxx.ngrok-free.app",
  "streamlabs": {
    "enabled": true,
    "access_token": "...",
    "socket_token": "..."
  },
  "saweria": {
    "enabled": true,
    "stream_key": "..."
  },
  "trakteer":  { "enabled": true },
  "sociabuzz": { "enabled": false }
}
```

> ⚠️ `config.json` ada di `.gitignore` — tidak pernah di-commit ke GitHub. File ini berisi token sensitif.

### Token Streamlabs

| Token | Sumber | Kegunaan |
|---|---|---|
| `access_token` | Streamlabs → API Settings → Access Token | **WAJIB** — untuk push donasi ke Alert Box |
| `socket_token` | Streamlabs → API Settings → Socket API Token | **OPSIONAL** — monitoring event native YouTube |

---

## 5. Dashboard (`dashboard.html`)

Single-page app berbasis HTML/CSS/Vanilla JS. Diakses di `localhost:3000`.

### Komponen UI

| Komponen | Fungsi |
|---|---|
| Status Koneksi | Checklist 4 item: server, ngrok, token, socket (polling `/api/status` tiap 5 detik) |
| Alur Kerja | Penjelasan flow + 5 langkah setup |
| Streamlabs API Token | Input `access_token` + `socket_token`, tombol Simpan Token |
| Ngrok Setup | Input URL + Simpan Ngrok + Generate URL webhook per provider |
| Provider Donasi | Toggle per provider dengan accordion detail & URL webhook |
| Test Alert | 3 tombol test, result box menampilkan respons API berwarna |

### Fungsi JavaScript Utama

| Fungsi | Deskripsi |
|---|---|
| `loadConfig()` | `GET /api/config` → populate semua form field |
| `saveTokens()` | `POST /api/config` dengan `streamlabs.access_token` dan `socket_token` |
| `saveNgrok()` | `POST /api/ngrok` dengan URL, validasi format `https://` |
| `saveAll()` | `POST /api/config` dengan semua field sekaligus |
| `genWebhooks()` | Generate URL webhook per provider dari ngrok URL yang diinput |
| `sendTest(provider)` | `POST /api/test` → tampilkan result di result box |
| `checkStatus()` | `GET /api/status` → update 4 indikator checklist di UI |

---

## 6. Panduan Setup Lengkap

### Prasyarat

- Node.js >= 18.0.0
- Akun ngrok (gratis) — [ngrok.com](https://ngrok.com)
- Akun Streamlabs sudah terkoneksi ke YouTube
- OBS Studio

### Instalasi

```bash
git clone https://github.com/noobiiefun/SE-widget-donation.git
cd SE-widget-donation
npm install
npm start
# Buka http://localhost:3000
```

### Setup Token Streamlabs

1. Buka [streamlabs.com/dashboard → Settings → API Settings](https://streamlabs.com/dashboard#/settings/api-settings)
2. Copy **Access Token** → paste di dashboard → field "API Access Token" → **Simpan Token**
3. *(Opsional)* Copy **Socket API Token** → paste di field "Socket API Token"

### Setup Ngrok

```bash
# Terminal 1 — server tetap jalan
npm start

# Terminal 2
ngrok config add-authtoken TOKEN_KAMU
ngrok http 3000
# Copy URL: https://xxx.ngrok-free.app
```

Paste URL ngrok di dashboard → **Simpan Ngrok** → **Generate URL**

### Setup Provider

**Saweria:**
1. [saweria.co/admin/integrations](https://saweria.co/admin/integrations) → Webhook
2. Isi URL: `https://NGROK_URL/webhook/saweria`
3. Aktifkan → opsional copy Stream Key ke dashboard

**Trakteer:**
1. [trakteer.id/manage](https://trakteer.id/manage) → Integrasi → Webhook
2. Isi URL: `https://NGROK_URL/webhook/trakteer`

**SociaBuzz:**
1. SociaBuzz → Pro Account → Settings → Integrations
2. Isi URL: `https://NGROK_URL/webhook/sociabuzz`

### Setup OBS

1. Streamlabs Dashboard → Alert Box → copy **URL Alert Box**
2. OBS: `+` di Sources → Browser
3. URL: URL Alert Box dari Streamlabs *(bukan localhost)*
4. Width: `1920`, Height: `1080`
5. Centang **"Refresh browser when scene becomes active"**
6. Test Alert dari dashboard → notif muncul di OBS ✅

---

## 7. Format Payload Webhook Provider

### Saweria

```json
// POST /webhook/saweria
// Header: saweria-callback-signature: <hmac-sha256>
{
  "type": "donation",
  "donator_name": "Yoga Pratama",
  "amount_raw": 69420,
  "etc": {
    "amount_to_display": 69420
  },
  "amount": "69420",
  "message": "Semangat streaming!",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

### Trakteer

```json
// POST /webhook/trakteer
// Format 1 — data di dalam field "data"
{
  "data": {
    "supporter_name": "Budi",
    "price": "5000",
    "unit": "Cendol",
    "quantity": 2,
    "supporter_message": "Mantap!",
    "supporter_avatar": "https://..."
  }
}

// Format 2 — data langsung di root
{
  "supporter_name": "Budi",
  "price": "5000"
}
```

### SociaBuzz

```json
// POST /webhook/sociabuzz
{
  "type": "donation",
  "invoker_name": "Ani",
  "amount": 20000,
  "message": "Halo!",
  "avatar": "https://...",
  "created_at": "2024-01-01T00:00:00.000Z"
}
```

---

## 8. Known Issues & Cara Debug

### Daftar Known Issues

| # | Issue | Penyebab | Status |
|---|---|---|---|
| 1 | Ngrok URL gratis berubah setiap restart | Limitasi ngrok free tier | By design — setup ulang tiap sesi |
| 2 | Donasi Saweria tetap masuk meski stream_key salah | HMAC mismatch diabaikan by design | Warning di log, bukan error |
| 3 | Test alert berhasil tapi notif tidak muncul di OBS | Alert Box URL belum di-add ke OBS | Pastikan source OBS pakai URL Alert Box Streamlabs |
| 4 | Nominal Trakteer selalu 0 | Field `price` tidak ada atau format berbeda | Cek log server untuk raw payload |
| 5 | Socket Streamlabs disconnect tidak auto-reconnect | Belum diimplementasi | Restart server sebagai workaround |

### Cara Baca Log Server

```
[Saweria] ✓ Signature valid
[Streamlabs] ✅ Yoga [Saweria] | Rp 69k | id:123456

// Jika gagal:
[Streamlabs] ❌ Gagal: {"error":"invalid_token"}
[Streamlabs] ❌ Request error: ECONNREFUSED
[Saweria] ⚠ Signature tidak cocok (tetap diproses)
```

### Checklist Debug Umum

- **Server tidak jalan** → `npm start`, pastikan port 3000 tidak dipakai proses lain
- **Webhook tidak masuk** → pastikan ngrok jalan dan URL di provider sudah diupdate
- **`access_token` invalid** → reset token di Streamlabs → update di dashboard → Simpan Token
- **Alert Box kosong di OBS** → tambahkan Browser Source dari URL Alert Box Streamlabs (bukan localhost)
- **Notif muncul di Streamlabs tapi tidak di OBS** → klik kanan Browser Source di OBS → Refresh

---

## 9. Roadmap Fitur & Pengembangan

### Prioritas Tinggi

| Fitur | Deskripsi Implementasi |
|---|---|
| Auto-reconnect Socket | Tambah exponential backoff di `connectStreamlabsSocket` — retry dengan delay 2s, 4s, 8s, max 30s |
| Filter donasi minimum | Tambah field `minAmount` di config — skip `pushToStreamlabs` jika `amount < threshold` |
| Queue & rate limiting | Antrian alert agar tidak spam — delay antar push ke Streamlabs minimal 1-2 detik |

### Prioritas Sedang

| Fitur | Deskripsi Implementasi |
|---|---|
| Log history donasi | Simpan setiap donasi ke JSON file — tampilkan di dashboard sebagai tabel riwayat |
| Notifikasi HP (mobile) | Tambah SSE endpoint `/api/mobile/events` — push event ke HP via browser PWA |
| Support KaryaKarsa | Tambah route `POST /webhook/karyakarsa` — field: `supporter_name`, `amount`, `message` |
| Custom alert message template | Config template teks per provider — misal `"{from} donasi {amount} lewat {provider}"` |

### Prioritas Rendah / Eksperimental

| Fitur | Deskripsi Implementasi |
|---|---|
| Sound alert lokal | Play audio di browser overlay saat donasi masuk |
| Dashboard analytics | Total donasi hari ini, top donatur, chart donasi per jam |
| Multi-instance support | Support lebih dari 1 streamer dengan path berbeda `/streamer/:id/webhook/saweria` |

---

## 10. Panduan untuk Developer & AI

Bagian ini berisi potongan kode siap pakai untuk pengembangan fitur atau fix bug. Cukup paste ke bagian yang relevan di `server.js`.

### 10.1 Menambah Provider Baru (contoh: KaryaKarsa)

Tambahkan di `server.js`:

```javascript
// 1. Tambah route webhook baru
app.post('/webhook/karyakarsa', async (req, res) => {
  let data;
  try {
    data = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  await pushToStreamlabs({
    provider: 'karyakarsa',
    from:     data.supporter_name || 'Anonim',
    amount:   data.amount || 0,
    currency: 'IDR',
    message:  data.message || '',
  });

  res.sendStatus(200);
});

// 2. Tambah di config default di loadConfig()
karyakarsa: { enabled: false },
```

Tambahkan di `dashboard.html` — salin pattern `div.prow` dari provider yang sudah ada di bagian "Provider Donasi".

---

### 10.2 Mengubah Format Pesan Alert

Cari fungsi `pushToStreamlabs` di `server.js`, bagian penyusunan `tipMessage` dan `tipName` (~baris 60-75):

```javascript
// Ubah format nama donatur:
const tipName = `${data.from} [${providerLabel}]`;

// Ubah format pesan — contoh tambah emoji:
let tipMessage = '';
if (data.currency === 'IDR' && data.amount) {
  const fmt = Number(data.amount) >= 1000
    ? 'Rp ' + Math.round(Number(data.amount)/1000) + 'k'
    : 'Rp ' + Number(data.amount).toLocaleString('id-ID');
  tipMessage += `💰 ${fmt}`;
}
if (data.message) {
  tipMessage += tipMessage ? ` — ${data.message}` : data.message;
}
```

---

### 10.3 Menambah Filter Donasi Minimum

Tambahkan di awal fungsi `pushToStreamlabs`, setelah baris `const token = cfg.streamlabs?.access_token;`:

```javascript
const minAmount = cfg.filter?.minAmount || 0;
if (data.currency === 'IDR' && data.amount < minAmount) {
  console.log(`[Filter] Skip: ${data.from} Rp ${data.amount} < min Rp ${minAmount}`);
  return false;
}
```

Tambahkan di config default `loadConfig()`:

```javascript
filter: { minAmount: 0 },
```

---

### 10.4 Auto-reconnect Socket Streamlabs

Ganti fungsi `connectStreamlabsSocket` dengan versi ini:

```javascript
function connectStreamlabsSocket(token, retries = 0) {
  try {
    const io = require('socket.io-client');
    slSocket = io(`https://sockets.streamlabs.com?token=${token}`, {
      transports: ['websocket'],
    });
    slSocket.on('connect', () => {
      console.log('[SL Socket] Connected ✓');
      retries = 0;
    });
    slSocket.on('disconnect', () => {
      console.log('[SL Socket] Disconnected — reconnecting...');
      const delay = Math.min(2000 * Math.pow(2, retries), 30000);
      setTimeout(() => connectStreamlabsSocket(token, retries + 1), delay);
    });
    slSocket.on('connect_error', e => {
      console.error('[SL Socket] Error:', e.message);
    });
    slSocket.on('event', d => console.log(`[SL] Native: ${d.type}`));
  } catch(e) {
    console.error('[SL Socket] Gagal konek:', e.message);
  }
}
```

---

### 10.5 Log History Donasi ke File

Tambahkan di dalam `pushToStreamlabs`, setelah baris `console.log('✅ ...')`:

```javascript
const logEntry = {
  timestamp:   new Date().toISOString(),
  provider:    data.provider,
  from:        data.from,
  amount:      data.amount,
  currency:    data.currency,
  message:     data.message,
  donation_id: json.donation_id,
};
const LOG_FILE = path.join(__dirname, 'donations.log.json');
let logs = [];
try { logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch {}
logs.unshift(logEntry);
if (logs.length > 500) logs = logs.slice(0, 500); // max 500 entries
fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
```

Tambahkan `donations.log.json` ke `.gitignore`.

---

### 10.6 Menambah Queue Alert (Anti-Spam)

Tambahkan sebelum fungsi `pushToStreamlabs`:

```javascript
// Queue system agar alert tidak spam
const alertQueue = [];
let isProcessing = false;

async function enqueueAlert(data) {
  alertQueue.push(data);
  if (!isProcessing) processQueue();
}

async function processQueue() {
  if (!alertQueue.length) { isProcessing = false; return; }
  isProcessing = true;
  const data = alertQueue.shift();
  await pushToStreamlabs(data);
  setTimeout(processQueue, 2000); // jeda 2 detik antar alert
}
```

Ganti semua pemanggilan `await pushToStreamlabs(alert)` di webhook handler menjadi `enqueueAlert(alert)`.

---

## 11. Changelog

| Versi | Tanggal | Perubahan |
|---|---|---|
| **v3.0** | Jun 2026 | Ganti arsitektur dari SSE → Streamlabs API. Semua provider forward ke Streamlabs sebagai tip. Dashboard baru dengan checklist status dan token input. Hapus SSE client system. |
| **v2.1** | Jun 2026 | Fix bug inject ngrok URL ke widget code (string replace vs regex). Tambah endpoint `POST /api/ngrok`. Tambah debug panel di dashboard. |
| **v2.0** | Jun 2026 | Tambah HTTP proxy bypass X-Frame-Options. Tambah SE Custom Widget mode dengan SSE. Tambah ngrok URL inject. |
| **v1.0** | Jun 2026 | Initial release. Webhook Saweria/Trakteer/SociaBuzz + Streamlabs Socket. OBS overlay langsung di `/overlay`. |

---

<div align="center">
  Made with ❤️ untuk streamer Indonesia 🇮🇩<br>
  <b>noobiiefun/SE-widget-donation</b>
</div>

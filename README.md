# 🎯 SE Alert Bridge — Streamlabs Edition v3.0

> Satukan semua notifikasi donasi Indonesia ke **1 Browser Source di OBS** lewat Streamlabs Alert Box.

[![Node.js](https://img.shields.io/badge/Node.js-≥18.0.0-green)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/Platform-YouTube%20Live-red)](https://youtube.com)
[![License](https://img.shields.io/badge/License-MIT-blue)](#)

---

## ✨ Cara Kerja

```
Saweria ──┐  (webhook via ngrok)
Trakteer ─┤  (webhook via ngrok)  →  Server Lokal  →  Streamlabs API  →  Alert Box OBS ✅
SociaBuzz ┘  (webhook via ngrok)       Port 3000
```

Donasi dari Saweria, Trakteer, dan SociaBuzz diterima server lokal lewat webhook, lalu di-forward ke **Streamlabs API** sebagai tip. Streamlabs menampilkannya di Alert Box seperti donasi biasa — animasi, suara, dan tema diatur langsung dari **Streamlabs Dashboard**.

> **Kenapa Streamlabs, bukan StreamElements?**
> SE tidak mendukung push donation API untuk kanal YouTube. Streamlabs mendukung endpoint `/api/v2.0/donations` sehingga donasi dari provider Indonesia bisa muncul di Alert Box.

---

## 🚀 Install & Jalankan

```bash
# 1. Clone repo
git clone https://github.com/noobiiefun/SE-widget-donation.git
cd SE-widget-donation

# 2. Install dependencies
npm install

# 3. Jalankan server
npm start
# atau di Windows: double-click start.bat

# 4. Buka dashboard
# http://localhost:3000
```

---

## 📋 Setup Lengkap

### Step 1 — Token Streamlabs

1. Buka [streamlabs.com/dashboard → Settings → API Settings](https://streamlabs.com/dashboard#/settings/api-settings)
2. Copy **Access Token**
3. Di dashboard → isi field **API Access Token** → klik **Simpan Token**
4. *(Opsional)* Copy **Socket API Token** untuk monitoring follow/superchat native YouTube

### Step 2 — Setup Ngrok

```bash
# Install & auth ngrok (sekali saja)
ngrok config add-authtoken TOKEN_NGROK_KAMU

# Jalankan di terminal baru (server tetap jalan)
ngrok http 3000
# Copy URL yang muncul: https://xxx.ngrok-free.app
```

Di dashboard → paste URL ngrok → klik **Simpan Ngrok** → klik **Generate URL**

### Step 3 — Setup Provider Donasi

| Provider | URL Webhook |
|---|---|
| **Saweria** | `https://NGROK_URL/webhook/saweria` |
| **Trakteer** | `https://NGROK_URL/webhook/trakteer` |
| **SociaBuzz** | `https://NGROK_URL/webhook/sociabuzz` |

- **Saweria** → [saweria.co/admin/integrations](https://saweria.co/admin/integrations) → Webhook → isi URL → aktifkan
- **Trakteer** → [trakteer.id/manage](https://trakteer.id/manage) → Integrasi → Webhook → isi URL → aktifkan
- **SociaBuzz** → Pro Account → Settings → Integrations → isi URL → aktifkan

### Step 4 — Setup OBS

1. Buka [Streamlabs Dashboard → Alert Box](https://streamlabs.com/dashboard#/alertbox) → copy **URL Alert Box**
2. Di OBS: klik **+** di Sources → **Browser**
3. URL: *(URL Alert Box dari Streamlabs — bukan localhost)*
4. Width: **1920**, Height: **1080**
5. Centang **"Refresh browser when scene becomes active"** → OK

### Step 5 — Test

Di dashboard → klik tombol **Test Alert** → notifikasi harus muncul di OBS ✅

---

## 📺 Tampilan Notifikasi di Alert Box

Notifikasi yang muncul di Streamlabs Alert Box mengikuti format:

```
Nama:  "Yoga Pratama [Saweria]"
Pesan: "Rp 69k — Semangat streaming!"

Nama:  "Budi [Trakteer]"
Pesan: "2x Cendol — Terus berkarya!"
```

Animasi, suara, tema, dan durasi diatur di **Streamlabs Dashboard → Alert Box** — tidak perlu konfigurasi tambahan di server ini.

---

## 📁 Struktur File

```
SE-widget-donation/
├── server.js              ← Server Express + semua logika backend
├── package.json
├── config.json            ← Config tersimpan (auto-generate, di .gitignore)
├── start.bat              ← Windows launcher
├── .gitignore
└── public/
    ├── dashboard.html     ← UI konfigurasi (buka di browser)
    └── overlay.html       ← OBS overlay langsung (mode alternatif tanpa Streamlabs)
```

---

## ⚙️ Konfigurasi (config.json)

File ini di-generate otomatis saat pertama jalan. **Tidak perlu diedit manual** — gunakan dashboard di `localhost:3000`.

```json
{
  "ngrokUrl": "https://xxx.ngrok-free.app",
  "streamlabs": {
    "enabled": true,
    "access_token": "...",
    "socket_token": "..."
  },
  "saweria":   { "enabled": true, "stream_key": "..." },
  "trakteer":  { "enabled": true },
  "sociabuzz": { "enabled": false }
}
```

> ⚠️ `config.json` ada di `.gitignore` — tidak pernah di-commit. Jangan share file ini karena berisi token sensitif.

---

## 🔌 API Endpoints

| Endpoint | Method | Fungsi |
|---|---|---|
| `/` | GET | Dashboard |
| `/overlay` | GET | OBS overlay langsung (tanpa Streamlabs) |
| `/api/config` | GET/POST | Baca/simpan konfigurasi |
| `/api/ngrok` | POST | Simpan ngrok URL |
| `/api/status` | GET | Status server & konfigurasi |
| `/api/test` | POST | Kirim test alert ke Streamlabs |
| `/webhook/saweria` | POST | Terima webhook Saweria |
| `/webhook/trakteer` | POST | Terima webhook Trakteer |
| `/webhook/sociabuzz` | POST | Terima webhook SociaBuzz |

---

## ➕ Tambah Provider Baru

Di `server.js`, tambahkan route baru setelah webhook SociaBuzz:

```javascript
app.post('/webhook/nama_provider', async (req, res) => {
  let data;
  try {
    data = typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body : JSON.parse(req.body.toString());
  } catch { return res.sendStatus(400); }

  await pushToStreamlabs({
    provider: 'nama_provider',
    from:     data.nama_donatur || 'Anonim',
    amount:   data.jumlah || 0,
    currency: 'IDR',
    message:  data.pesan || '',
  });

  res.sendStatus(200);
});
```

---

## ❓ FAQ & Troubleshooting

**Notifikasi tidak muncul di OBS setelah test berhasil**
→ Pastikan Browser Source di OBS pakai URL Alert Box dari Streamlabs, bukan `localhost:3000`

**Test alert gagal — access_token invalid**
→ Reset token di Streamlabs Dashboard → API Settings → update di dashboard → Simpan Token

**Webhook Saweria tidak masuk**
→ Pastikan ngrok masih jalan. URL ngrok gratis berubah setiap restart ngrok — update di dashboard dan di Saweria setiap sesi.

**Nominal donasi muncul $0.01 bukan Rp asli**
→ Ini by design — Streamlabs API hanya terima USD, nominal IDR asli ada di pesan alert. Atur template pesan di Streamlabs Alert Box untuk tampilkan field `{message}`.

**Socket Streamlabs disconnect**
→ Restart server. Auto-reconnect belum diimplementasi di versi ini.

---

## 📖 Dokumentasi Teknis

Lihat [DOCUMENTATION.md](./DOCUMENTATION.md) untuk dokumentasi lengkap meliputi:
- Arsitektur & semua endpoint
- Format payload webhook per provider
- Panduan menambah fitur baru
- Potongan kode siap pakai untuk pengembangan
- Known issues & cara debug

---

## 📦 Dependencies

| Package | Versi | Kegunaan |
|---|---|---|
| `express` | ^4.19.2 | HTTP server |
| `cors` | ^2.8.5 | CORS headers |
| `socket.io-client` | ^2.5.0 | Streamlabs Socket API |
| `nodemon` | ^3.1.4 | Auto-restart (dev) |

---

<div align="center">
  Made with ❤️ untuk streamer Indonesia 🇮🇩<br><br>
  <b>SE Alert Bridge v3.0 — Streamlabs Edition</b>
</div>

# 🎯 SE Widget Donation Hub v1.0

> **1 Browser Source di OBS** untuk semua notifikasi donasi — Saweria, Trakteer, SociaBuzz, Streamlabs, dan provider lain.

---

## ✨ Cara Kerja

```
Saweria ──┐  (webhook)
Trakteer ─┤  (webhook)   →  Server Lokal (Node.js)  →  1 Browser Source OBS
SociaBuzz ┤  (webhook)        Port 3000                    /overlay
Streamlabs┘  (socket)
```

- **Saweria, Trakteer, SociaBuzz** → kirim webhook ke URL kamu (butuh ngrok)
- **Streamlabs** → server ini connect langsung ke Streamlabs via Socket API (tidak butuh ngrok)

---

## 🚀 Install & Jalankan

```bash
# 1. Install dependencies
npm install

# 2. Jalankan server
npm start
# atau di Windows: double-click start.bat

# 3. Buka browser → http://localhost:3000
```

---

## 📺 Setup di OBS

1. Di OBS: klik **+** di Sources → **Browser**
2. URL: `http://localhost:3000/overlay`
3. Width: **1920**, Height: **1080**
4. Centang **"Refresh browser when scene becomes active"**
5. Background Color: **transparan** (RGBA 0,0,0,0)

---

## 🔌 Setup Provider

### Streamlabs (Paling Mudah — Tidak Butuh Ngrok)
1. Buka [streamlabs.com/dashboard → API Settings](https://streamlabs.com/dashboard#/settings/api-settings)
2. Tab **API Tokens** → copy **Socket API Token**
3. Paste di Dashboard → Simpan

### Saweria, Trakteer, SociaBuzz (Butuh Ngrok)

**Install ngrok:**
1. Download di [ngrok.com/download](https://ngrok.com/download) → daftar akun gratis
2. `ngrok config add-authtoken YOUR_TOKEN`
3. Buka terminal baru: `ngrok http 3000`
4. Copy URL yang muncul (contoh: `https://abc123.ngrok.io`)
5. Buka Dashboard → masukkan URL ngrok → klik **Generate URL**
6. Copy URL untuk masing-masing provider dan paste di dashboard mereka

---

## 🧪 Test Notifikasi

Buka Dashboard → klik tombol test di bagian **Test Alert** — notifikasi akan muncul di overlay.

**Buka overlay preview:** `http://localhost:3000/overlay` di tab lain

---

## 📁 Struktur File

```
stream-alert-hub/
├── server.js           ← Server Express + webhook handler
├── package.json
├── config.json         ← Config tersimpan (auto-generate)
├── start.bat           ← Windows launcher
└── public/
    ├── dashboard.html  ← Setup & test (buka di browser)
    └── overlay.html    ← OBS Browser Source
```

---

## ➕ Tambah Provider Lain (Custom)

Di `server.js`, tambahkan route baru:

```javascript
app.post('/webhook/NAMA_PROVIDER', (req, res) => {
  let data = typeof req.body === 'object' ? req.body : JSON.parse(req.body.toString());
  
  const alert = {
    provider: 'NAMA_PROVIDER',
    type: 'donation',
    from: data.nama_donatur,
    amount: data.jumlah,
    currency: 'IDR',
    message: data.pesan || '',
    timestamp: new Date().toISOString(),
  };
  
  pushAlert(alert);
  res.sendStatus(200);
});
```

---

Made with ❤️ untuk streamer Indonesia

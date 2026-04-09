# 🎬 YT Downloader

A beautiful YouTube downloader web app. Download any YouTube video as MP4 in every quality, or extract MP3 audio.

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or newer
- Internet connection (to download yt-dlp)

---

### Step 1 — Open the project in VS Code

Open the `ytdl-site` folder in VS Code.

---

### Step 2 — Open the Terminal in VS Code

`Terminal → New Terminal`

---

### Step 3 — Install yt-dlp (one time only)

```bash
node setup.js
```

This downloads the `yt-dlp` binary into the `./bin/` folder automatically (works on Windows, Mac, Linux).

---

### Step 4 — Install Node dependencies

```bash
npm install
```

---

### Step 5 — Start the server

```bash
npm start
```

You'll see:
```
🎬 YT Downloader running at http://localhost:3000
```

---

### Step 6 — Open in browser

Go to: **http://localhost:3000**

---

## 🎯 Features

- ✅ Paste any YouTube link
- ✅ Fetches video title, thumbnail, channel, duration
- ✅ All available video qualities (1080p, 720p, 480p, 360p, etc.)
- ✅ MP3 audio extraction (best quality)
- ✅ Best audio (M4A/WebM) option
- ✅ Files download directly to your Downloads folder

---

## 📁 Project Structure

```
ytdl-site/
├── bin/             ← yt-dlp binary (created by setup.js)
├── public/
│   └── index.html   ← Frontend UI
├── server.js        ← Express backend
├── setup.js         ← yt-dlp downloader script
├── package.json
└── README.md
```

---

## ⚠️ Notes

- For personal use only. Respect YouTube's Terms of Service and copyright laws.
- Downloads are processed on your own machine — no data is sent anywhere.
- If a video is age-restricted or private, yt-dlp may not be able to download it without cookies.

const express = require("express");
const cors = require("cors");
const path = require("path");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;

// Write cookies to temp file from env var
const cookiesPath = path.join(os.tmpdir(), "yt_cookies.txt");

function setupCookies() {
  // Try base64 encoded
  if (process.env.YT_COOKIES_B64) {
    const decoded = Buffer.from(process.env.YT_COOKIES_B64, "base64").toString("utf8");
    fs.writeFileSync(cookiesPath, decoded, "utf8");
    console.log("✅ YouTube cookies loaded from YT_COOKIES_B64");
    return true;
  }
  // Try plain text YT_COOKIES
  if (process.env.YT_COOKIES) {
    // Check if it looks like base64
    const val = process.env.YT_COOKIES;
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(val.trim()) && val.length > 500;
    if (isBase64) {
      try {
        const decoded = Buffer.from(val, "base64").toString("utf8");
        fs.writeFileSync(cookiesPath, decoded, "utf8");
        console.log("✅ YouTube cookies loaded from YT_COOKIES (base64 decoded)");
        return true;
      } catch(e) {}
    }
    fs.writeFileSync(cookiesPath, val, "utf8");
    console.log("✅ YouTube cookies loaded from YT_COOKIES (plain text)");
    return true;
  }
  // Try local file
  const localCookies = path.join(__dirname, "cookies.txt");
  if (fs.existsSync(localCookies)) {
    fs.copyFileSync(localCookies, cookiesPath);
    console.log("✅ YouTube cookies loaded from local cookies.txt");
    return true;
  }
  console.log("⚠️  No cookies found - YouTube will likely block requests");
  return false;
}

const hasCookies = setupCookies();

function getCookieArgs() {
  if (hasCookies) return ["--cookies", cookiesPath];
  return [];
}

function getBinPath(name) {
  // On Railway, yt-dlp is installed globally via pip (on PATH)
  if (IS_RAILWAY) return `/usr/local/bin/${name}`;
  // Locally, use ./bin/
  return path.join(__dirname, "bin", name);
}

function getFfmpegDir() {
  // On Railway, ffmpeg is installed by nixpacks into /usr/bin
  if (IS_RAILWAY) return "/usr/bin";
  // Locally, ffmpeg is downloaded into ./bin/
  return path.join(__dirname, "bin");
}

// GET /api/thumbnail?url=... (proxy for CORS-blocked thumbnails)
app.get("/api/thumbnail", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).end();

  const mod = url.startsWith("https") ? require("https") : require("http");
  const request = mod.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://www.instagram.com/",
    }
  }, (response) => {
    res.setHeader("Content-Type", response.headers["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    response.pipe(res);
  });

  request.on("error", () => res.status(500).end());
});

// GET /api/info?url=...
app.get("/api/info", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  const ytdlp = getBinPath("yt-dlp");
  const binDir = getFfmpegDir();

  const args = [
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--ffmpeg-location", binDir,
    "--extractor-args", "youtube:player_client=ios,web",
    "--user-agent", "com.google.ios.youtube/19.29.1 CFNetwork/1474 Darwin/23.0.0",
    "--add-header", "X-Youtube-Client-Name:5",
    "--add-header", "X-Youtube-Client-Version:19.29.1",
    ...getCookieArgs(),
    url,
  ];

  execFile(ytdlp, args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      const errMsg = stderr || err.message || "unknown error";
      console.error("yt-dlp error:", errMsg);
      return res.status(500).json({
        error: errMsg,
        details: errMsg,
      });
    }
    try {
      const info = JSON.parse(stdout);
      const formatsMap = new Map();

      // MP3 audio option
      formatsMap.set("mp3", {
        id: "mp3",
        label: "MP3 Audio Only",
        ext: "mp3",
        type: "audio",
        note: "Best audio quality",
      });

      // Build height -> best format ID map
      const heightMap = new Map();
      (info.formats || []).forEach((f) => {
        if (f.height && f.vcodec && f.vcodec !== "none" && f.height >= 144) {
          const existing = heightMap.get(f.height);
          // Prefer mp4, then any
          if (!existing || (f.ext === "mp4" && existing.ext !== "mp4")) {
            heightMap.set(f.height, { fid: f.format_id, ext: f.ext });
          }
        }
      });

      [...heightMap.keys()].sort((a, b) => b - a).forEach((h) => {
        const { fid, ext } = heightMap.get(h);
        formatsMap.set(`${h}p`, {
          id: `${h}p__${fid}`,
          label: `${h}p — MP4`,
          ext: "mp4",
          type: "video",
          note: `${h}p video`,
        });
      });

      if (formatsMap.size <= 1) {
        formatsMap.set("best", {
          id: "best",
          label: "Best Quality — MP4",
          ext: "mp4",
          type: "video",
          note: "Highest available",
        });
      }

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: info.duration,
        channel: info.uploader,
        formats: [...formatsMap.values()],
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to parse video info" });
    }
  });
});

// POST /api/download
app.post("/api/download", (req, res) => {
  const { url, formatId, ext, label } = req.body;
  if (!url || !formatId) return res.status(400).json({ error: "Missing params" });

  const ytdlp = getBinPath("yt-dlp");
  const binDir = getFfmpegDir();
  const tmpDir = os.tmpdir();
  const safeLabel = (label || "video").replace(/[^a-z0-9_\-]/gi, "_").slice(0, 60);
  const timestamp = Date.now();
  const outTemplate = path.join(tmpDir, `ytdl_${timestamp}_${safeLabel}.%(ext)s`);

  let args;

  if (formatId === "mp3") {
    args = [
      "--no-playlist",
      "--no-warnings",
      "--ffmpeg-location", binDir,
      "--extractor-args", "youtube:player_client=ios,web",
      "--user-agent", "com.google.ios.youtube/19.29.1 CFNetwork/1474 Darwin/23.0.0",
      "--add-header", "X-Youtube-Client-Name:5",
      "--add-header", "X-Youtube-Client-Version:19.29.1",
      ...getCookieArgs(),
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-o", outTemplate,
      url,
    ];
  } else {
    let formatStr;
    if (formatId === "best") {
      formatStr = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best";
    } else if (formatId.includes("__")) {
      // Use actual format ID from yt-dlp + best audio
      const vidFid = formatId.split("__")[1];
      const h = parseInt(formatId.split("__")[0]);
      formatStr = `${vidFid}+bestaudio[ext=m4a]/${vidFid}+bestaudio/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
    } else {
      const h = parseInt(formatId);
      formatStr = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`;
    }

    args = [
      "--no-playlist",
      "--no-warnings",
      "--ffmpeg-location", binDir,
      "--extractor-args", "youtube:player_client=ios,web",
      "--user-agent", "com.google.ios.youtube/19.29.1 CFNetwork/1474 Darwin/23.0.0",
      "--add-header", "X-Youtube-Client-Name:5",
      "--add-header", "X-Youtube-Client-Version:19.29.1",
      ...getCookieArgs(),
      "-f", formatStr,
      "--merge-output-format", "mp4",
      "--postprocessor-args", "ffmpeg:-c:v copy -c:a copy",
      "--prefer-free-formats",
      "-o", outTemplate,
      url,
    ];
  }

  console.log(`\n⬇  [${formatId}] Downloading:`, url);

  execFile(ytdlp, args, { timeout: 300000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("Download error:", stderr || err.message);
      return res.status(500).json({
        error: "Download failed. Make sure ffmpeg is in ./bin/ (run: node setup.js)",
        details: stderr || err.message,
      });
    }

    // Find output file
    let outFile = null;
    const tryExts = formatId === "mp3" ? ["mp3"] : ["mp4", "mkv", "webm", "m4a"];
    for (const e of tryExts) {
      const c = path.join(tmpDir, `ytdl_${timestamp}_${safeLabel}.${e}`);
      if (fs.existsSync(c)) { outFile = c; break; }
    }
    if (!outFile) {
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`ytdl_${timestamp}_`));
      if (files.length > 0) outFile = path.join(tmpDir, files[0]);
    }

    if (!outFile) {
      return res.status(500).json({ error: "Output file not found after download" });
    }

    const downloadExt = path.extname(outFile).slice(1);
    const downloadName = `${safeLabel}.${downloadExt}`;
    console.log("✅ Sending:", downloadName);

    res.setHeader("Content-Disposition", `attachment; filename="${downloadName}"`);
    res.setHeader("Content-Type", "application/octet-stream");

    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on("end", () => { try { fs.unlinkSync(outFile); } catch {} });
    stream.on("error", (e) => { console.error("Stream error:", e); res.status(500).end(); });
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🎬 YT Downloader running at http://localhost:${PORT}`);
  console.log(`   Running on Railway: ${IS_RAILWAY}`);
  console.log(`   ffmpeg location: ${getFfmpegDir()}\n`);
});

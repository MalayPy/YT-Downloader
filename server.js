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

function getBinPath(name) {
  return name; // use global installation on Render
}

// GET /api/info?url=...
app.get("/api/info", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "No URL provided" });

  const ytdlp = getBinPath("yt-dlp");
  const binDir = path.join(__dirname, "bin");

  const args = [
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    "--ffmpeg-location", binDir,
    url,
  ];

  execFile(ytdlp, args, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("yt-dlp error:", stderr || err.message);
      return res.status(500).json({
        error: "Could not fetch video info. Run: node setup.js",
        details: stderr || err.message,
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

      // Collect unique video heights
      const heights = new Set();
      (info.formats || []).forEach((f) => {
        if (f.height && f.vcodec && f.vcodec !== "none" && f.height >= 144) {
          heights.add(f.height);
        }
      });

      [...heights].sort((a, b) => b - a).forEach((h) => {
        formatsMap.set(`${h}p`, {
          id: `${h}p`,
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
  const binDir = path.join(__dirname, "bin");
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
    } else {
      const h = parseInt(formatId);
      formatStr = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
    }

    args = [
      "--no-playlist",
      "--no-warnings",
      "--ffmpeg-location", binDir,
      "-f", formatStr,
      "--merge-output-format", "mp4",
      "--postprocessor-args", "ffmpeg:-c:v copy -c:a aac",
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

app.listen(PORT, () => {
  console.log(`\n🎬 YT Downloader running at http://localhost:${PORT}`);
  console.log(`   ffmpeg location: ${path.join(__dirname, "bin")}\n`);
});

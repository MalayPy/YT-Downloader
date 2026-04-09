#!/usr/bin/env node
/**
 * setup.js — Downloads yt-dlp AND ffmpeg into ./bin/
 * Run once: node setup.js
 */

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const BIN_DIR = path.join(__dirname, "bin");
if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR);

const platform = os.platform();

// ─── 1. Download yt-dlp ──────────────────────────────────────────────────────

const ytdlpDest = path.join(BIN_DIR, platform === "win32" ? "yt-dlp.exe" : "yt-dlp");

let ytdlpUrl;
if (platform === "win32") {
  ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
} else if (platform === "darwin") {
  ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
} else {
  ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
}

// ─── 2. ffmpeg URLs ──────────────────────────────────────────────────────────

// We use a reliable static build source
let ffmpegUrl, ffmpegArchiveName;
if (platform === "win32") {
  // Windows: use a prebuilt ffmpeg zip from GitHub releases (gyan.dev mirror via direct link)
  ffmpegUrl = "https://github.com/BtbN/ffmpeg-builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
  ffmpegArchiveName = "ffmpeg.zip";
} else if (platform === "darwin") {
  ffmpegUrl = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
  ffmpegArchiveName = "ffmpeg.zip";
} else {
  ffmpegUrl = "https://github.com/BtbN/ffmpeg-builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz";
  ffmpegArchiveName = "ffmpeg.tar.xz";
}

// ─── Helper: follow redirects and download ───────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl) => {
      const mod = currentUrl.startsWith("https") ? https : http;
      const req = mod.get(currentUrl, { headers: { "User-Agent": "setup-script/1.0" } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
        }
        const total = parseInt(res.headers["content-length"] || "0", 10);
        let received = 0;
        const file = fs.createWriteStream(dest);
        res.on("data", (chunk) => {
          received += chunk.length;
          if (total > 0) {
            const pct = Math.floor((received / total) * 100);
            process.stdout.write(`\r   ${pct}% (${(received/1024/1024).toFixed(1)} MB / ${(total/1024/1024).toFixed(1)} MB)`);
          } else {
            process.stdout.write(`\r   ${(received/1024/1024).toFixed(1)} MB downloaded...`);
          }
        });
        res.pipe(file);
        file.on("finish", () => { process.stdout.write("\n"); file.close(resolve); });
        file.on("error", reject);
      });
      req.on("error", reject);
    };
    doRequest(url);
  });
}

// ─── Helper: extract ffmpeg binary from archive ──────────────────────────────

async function extractFfmpeg(archivePath) {
  const ffmpegDest = path.join(BIN_DIR, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  if (platform === "win32") {
    // Use PowerShell to extract zip
    console.log("   Extracting ffmpeg from zip...");
    const extractDir = path.join(BIN_DIR, "_ffmpeg_extract");
    if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true });
    fs.mkdirSync(extractDir);
    execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${extractDir}' -Force"`, { stdio: "inherit" });
    // Find ffmpeg.exe recursively
    const found = findFile(extractDir, "ffmpeg.exe");
    if (!found) throw new Error("ffmpeg.exe not found in archive");
    fs.copyFileSync(found, ffmpegDest);
    fs.rmSync(extractDir, { recursive: true });
  } else if (platform === "darwin") {
    execSync(`unzip -o "${archivePath}" -d "${BIN_DIR}"`, { stdio: "inherit" });
    // macOS zip contains just 'ffmpeg'
    const extracted = path.join(BIN_DIR, "ffmpeg");
    if (fs.existsSync(extracted)) fs.chmodSync(extracted, 0o755);
  } else {
    // Linux: tar.xz
    execSync(`tar -xf "${archivePath}" -C "${BIN_DIR}" --strip-components=2 --wildcards "*/bin/ffmpeg"`, { stdio: "inherit" });
    if (fs.existsSync(ffmpegDest)) fs.chmodSync(ffmpegDest, 0o755);
  }

  fs.unlinkSync(archivePath);
  return ffmpegDest;
}

function findFile(dir, name) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { const r = findFile(full, name); if (r) return r; }
    else if (e.name === name) return full;
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("\n════════════════════════════════════════");
  console.log("  YT Downloader — Setup Script");
  console.log("════════════════════════════════════════\n");

  // 1. yt-dlp
  if (fs.existsSync(ytdlpDest)) {
    console.log("✅ yt-dlp already exists, skipping.");
  } else {
    console.log("📥 Downloading yt-dlp...");
    await downloadFile(ytdlpUrl, ytdlpDest);
    if (platform !== "win32") fs.chmodSync(ytdlpDest, 0o755);
    console.log("✅ yt-dlp downloaded!\n");
  }

  // 2. ffmpeg
  const ffmpegDest = path.join(BIN_DIR, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (fs.existsSync(ffmpegDest)) {
    console.log("✅ ffmpeg already exists, skipping.");
  } else {
    console.log("📥 Downloading ffmpeg (this may take a minute — ~60MB)...");
    const archivePath = path.join(BIN_DIR, ffmpegArchiveName);
    await downloadFile(ffmpegUrl, archivePath);
    console.log("📦 Extracting ffmpeg...");
    await extractFfmpeg(archivePath);
    console.log("✅ ffmpeg ready!\n");
  }

  console.log("\n════════════════════════════════════════");
  console.log("  Setup complete! Now run:");
  console.log("    npm install");
  console.log("    npm start");
  console.log("════════════════════════════════════════\n");
})();

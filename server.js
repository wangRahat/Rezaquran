const express = require("express");
const path = require("path");
const fs = require("fs");
const config = require("./lib/config");
const { getProgress, saveProgress, savePost, getRecentPosts, saveRun, getRecentRuns } = require("./lib/db");
const { getFullSurahData, getAyahAudioUrl, getReciterPath } = require("./lib/quran");
const { getBackgroundVideos, downloadClip, downloadAudio } = require("./lib/pixabay");
const { generateShortVideo, generateLongVideo } = require("./lib/ffmpeg");
const { sendMessage, sendVideo, sendNotification } = require("./lib/telegram");

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Core bot function ──────────────────────────────────────
async function runBot() {
  const logs = [];
  const startTime = Date.now();

  logs.push(`[BOT] 🕌 Reza Quran Bot Started`);
  logs.push(`[BOT] Time: ${new Date().toISOString()}`);

  let shortDone = false;
  let longDone = false;

  try {
    // Step 1: Get current progress
    const progress = await getProgress();
    logs.push(`[BOT] Current: Surah ${progress.surah}, Ayah ${progress.ayah}`);

    // Get reciter (rotate daily based on surah number)
    const reciterIndex = (progress.surah - 1) % config.RECITERS.length;
    const reciter = config.RECITERS[reciterIndex];
    logs.push(`[BOT] Reciter: ${reciter.name}`);

    // Step 2: Fetch surah data
    logs.push(`[BOT] Fetching Surah ${progress.surah} data...`);
    const surahData = await getFullSurahData(progress.surah);
    logs.push(`[BOT] ✅ Surah: ${surahData.englishName} (${surahData.totalAyahs} ayahs)`);

    // Step 3: Determine ayahs for SHORT video (max 5 ayahs or ~1-2 mins)
    const shortAyahCount = Math.min(5, surahData.totalAyahs);
    const shortAyahs = surahData.ayahs.slice(0, shortAyahCount);
    const allAyahs = surahData.ayahs;

    // Step 4: Download audio for short video
    logs.push(`[BOT] Downloading audio for short video...`);
    const shortAudioPaths = [];
    for (const ayah of shortAyahs) {
      const audioUrl = getAyahAudioUrl(reciter.id, progress.surah, ayah.number);
      const audioPath = await downloadAudio(audioUrl, `short_audio_${ayah.number}.mp3`, logs);
      if (audioPath) shortAudioPaths.push(audioPath);
      await new Promise(r => setTimeout(r, 500));
    }

    // Step 5: Download audio for long video (full surah)
    logs.push(`[BOT] Downloading audio for full surah...`);
    const longAudioPaths = [];
    for (const ayah of allAyahs) {
      const audioUrl = getAyahAudioUrl(reciter.id, progress.surah, ayah.number);
      const audioPath = await downloadAudio(audioUrl, `long_audio_${ayah.number}.mp3`, logs);
      if (audioPath) longAudioPaths.push(audioPath);
      await new Promise(r => setTimeout(r, 300));
    }

    // Step 6: Download background videos
    logs.push(`[BOT] Downloading background videos...`);
    const shortBgVideos = await getBackgroundVideos(5, logs);
    const longBgVideos = await getBackgroundVideos(15, logs);

    const shortBgPaths = [];
    for (let i = 0; i < shortBgVideos.length; i++) {
      const clipPath = await downloadClip(shortBgVideos[i].url, `short_bg_${i}.mp4`, logs);
      if (clipPath) shortBgPaths.push(clipPath);
    }

    const longBgPaths = [];
    for (let i = 0; i < longBgVideos.length; i++) {
      const clipPath = await downloadClip(longBgVideos[i].url, `long_bg_${i}.mp4`, logs);
      if (clipPath) longBgPaths.push(clipPath);
    }

    const surahLabel = `Surah ${surahData.englishName} (${progress.surah})`;

    // Step 7: Generate SHORT video
    if (shortAudioPaths.length > 0 && shortBgPaths.length > 0) {
      const shortOutputPath = `/tmp/short_${progress.surah}.mp4`;
      await generateShortVideo({
        ayahs: shortAyahs,
        audioPaths: shortAudioPaths,
        bgClips: shortBgPaths,
        outputPath: shortOutputPath,
        brandName: config.BRAND_NAME,
        surahName: surahLabel,
      }, logs);

      // Send to Telegram
      const shortCaption = `📱 <b>${surahLabel}</b>\n🎙️ ${reciter.name}\n\n<i>Short Clip - First ${shortAyahCount} Ayahs</i>`;
      shortDone = await sendVideo(shortOutputPath, shortCaption, logs);
      if (fs.existsSync(shortOutputPath)) fs.unlinkSync(shortOutputPath);
    }

    // Step 8: Generate LONG video (full surah)
    if (longAudioPaths.length > 0 && longBgPaths.length > 0) {
      const longOutputPath = `/tmp/long_${progress.surah}.mp4`;
      await generateLongVideo({
        ayahs: allAyahs,
        audioPaths: longAudioPaths,
        bgClips: longBgPaths,
        outputPath: longOutputPath,
        brandName: config.BRAND_NAME,
        surahName: surahLabel,
        surahArabicName: surahData.name,
      }, logs);

      // Send to Telegram
      const longCaption = `🎬 <b>${surahData.name}</b>\n<b>${surahLabel}</b>\n🎙️ ${reciter.name}\n\n<i>Full Surah Recitation</i>`;
      longDone = await sendVideo(longOutputPath, longCaption, logs);
      if (fs.existsSync(longOutputPath)) fs.unlinkSync(longOutputPath);
    }

    // Step 9: Update progress to next surah
    let nextSurah = progress.surah + 1;
    if (nextSurah > config.TOTAL_SURAHS) nextSurah = 1; // Loop back to Al-Fatiha
    await saveProgress(nextSurah, 1, reciter.id);
    logs.push(`[BOT] ✅ Progress saved → next: Surah ${nextSurah}`);

    // Save post record
    await savePost("short", progress.surah, 1, shortAyahCount);
    await savePost("long", progress.surah, 1, allAyahs.length);

    // Send summary notification
    await sendNotification({
      surahName: surahLabel,
      surahNum: progress.surah,
      reciterName: reciter.name,
      shortDone,
      longDone,
    });

  } catch (err) {
    logs.push(`[BOT] ❌ Fatal error: ${err.message}`);
    await sendMessage(`❌ <b>Quran Bot Error</b>\n${err.message}`);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logs.push(`\n[BOT] ✅ Done in ${duration}s | Short:${shortDone ? "✅" : "❌"} Long:${longDone ? "✅" : "❌"}`);

  await saveRun(shortDone && longDone ? "success" : "partial", logs);
  return { shortDone, longDone, logs };
}

// ── API Endpoints ──────────────────────────────────────────

app.get("/api/run", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: true, message: "Quran bot started", timestamp: new Date().toISOString() }));
  setImmediate(() => runBot().catch(err => console.error("[SERVER] Error:", err.message)));
});

app.get("/api/logs", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const runs = await getRecentRuns(10);
  const formatted = runs.map(r => ({
    status: r[0]?.value,
    logs: JSON.parse(r[1]?.value || "[]"),
    timestamp: r[2]?.value,
  }));
  res.json({ success: true, runs: formatted });
});

app.get("/api/posts", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const posts = await getRecentPosts(20);
  const formatted = posts.map(p => ({
    type: p[0]?.value,
    surah: p[1]?.value,
    ayahStart: p[2]?.value,
    ayahEnd: p[3]?.value,
    createdAt: p[4]?.value,
  }));
  res.json({ success: true, posts: formatted });
});

app.get("/api/progress", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const progress = await getProgress();
  res.json({ success: true, progress });
});

app.get("/ping", (req, res) => res.json({ status: "alive", time: new Date().toISOString() }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`[SERVER] Reza Quran Bot running on port ${PORT}`));

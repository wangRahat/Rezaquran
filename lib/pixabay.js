const axios = require("axios");
const fs = require("fs");
const path = require("path");
const config = require("./config");

const AERIAL_KEYWORDS = [
  "aerial nature", "aerial forest", "sky clouds aerial",
  "aerial ocean", "aerial mountains", "nature peaceful aerial",
  "aerial landscape", "sunset aerial", "aerial river",
];

// Get random aerial/nature video clips from Pixabay
async function getBackgroundVideos(count, logs) {
  logs.push(`[PIXABAY] Fetching ${count} background videos...`);
  const keyword = AERIAL_KEYWORDS[Math.floor(Math.random() * AERIAL_KEYWORDS.length)];
  logs.push(`[PIXABAY] Keyword: ${keyword}`);

  try {
    const res = await axios.get("https://pixabay.com/api/videos/", {
      params: {
        key: config.PIXABAY_API_KEY,
        q: keyword,
        video_type: "film",
        per_page: 20,
        safesearch: true,
        min_duration: 10,
        max_duration: 60,
      },
      timeout: 15000,
    });

    const hits = res.data?.hits || [];
    if (!hits.length) {
      logs.push(`[PIXABAY] ❌ No videos found`);
      return [];
    }

    // Shuffle and pick needed count
    const shuffled = hits.sort(() => Math.random() - 0.5).slice(0, count);
    const videos = shuffled.map(h => ({
      url: h.videos?.medium?.url || h.videos?.small?.url || "",
      duration: h.duration,
      id: h.id,
    })).filter(v => v.url);

    logs.push(`[PIXABAY] ✅ Found ${videos.length} videos`);
    return videos;
  } catch (err) {
    logs.push(`[PIXABAY] ❌ Error: ${err.message}`);
    return [];
  }
}

// Download a video clip to temp
async function downloadClip(url, filename, logs) {
  const outPath = path.join("/tmp", filename);
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
    fs.writeFileSync(outPath, res.data);
    logs.push(`[PIXABAY] ✅ Downloaded: ${filename}`);
    return outPath;
  } catch (err) {
    logs.push(`[PIXABAY] ❌ Download failed: ${err.message}`);
    return null;
  }
}

// Download audio from everyayah.com
async function downloadAudio(url, filename, logs) {
  const outPath = path.join("/tmp", filename);
  try {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
    fs.writeFileSync(outPath, res.data);
    logs.push(`[AUDIO] ✅ Downloaded: ${filename}`);
    return outPath;
  } catch (err) {
    logs.push(`[AUDIO] ❌ Failed: ${err.message}`);
    return null;
  }
}

module.exports = { getBackgroundVideos, downloadClip, downloadAudio };

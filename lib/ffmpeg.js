const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd, timeout = 300000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function wrapText(text, maxChars = 35) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current.trim());
  return lines.join("\\n");
}

// SHORT video - 9:16 portrait with black bars
async function generateShortVideo({ ayahs, audioPaths, bgClips, outputPath, brandName, surahName }, logs) {
  logs.push(`[FFMPEG] Generating SHORT video...`);

  const clipListPath = "/tmp/short_clips.txt";
  fs.writeFileSync(clipListPath, bgClips.map(c => `file '${c}'`).join("\n"));

  const bgPath = "/tmp/short_bg.mp4";
  // height must be divisible by 2 → use 606
  await run(`ffmpeg -y -f concat -safe 0 -i "${clipListPath}" -vf "scale=1080:606,setsar=1" -c:v libx264 -preset fast -t 120 "${bgPath}"`);

  const audioListPath = "/tmp/short_audio.txt";
  fs.writeFileSync(audioListPath, audioPaths.map(a => `file '${a}'`).join("\n"));

  const combinedAudioPath = "/tmp/short_audio.mp3";
  await run(`ffmpeg -y -f concat -safe 0 -i "${audioListPath}" "${combinedAudioPath}"`);

  let audioDuration = 60;
  try {
    const dur = await run(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${combinedAudioPath}"`);
    audioDuration = parseFloat(dur.trim()) || 60;
  } catch(e) {}
  logs.push(`[FFMPEG] Audio duration: ${audioDuration.toFixed(1)}s`);

  const ayahDuration = audioDuration / ayahs.length;
  let filters = [];

  ayahs.forEach((ayah, i) => {
    const s = i * ayahDuration;
    const e = (i + 1) * ayahDuration;
    filters.push(`drawtext=text='${escapeText(ayah.arabic)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=30:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.55:enable='between(t,${s},${e})'`);
    filters.push(`drawtext=text='${escapeText(wrapText(ayah.bengali, 35))}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=20:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.68:enable='between(t,${s},${e})'`);
    filters.push(`drawtext=text='${escapeText(wrapText(ayah.english, 40))}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=16:fontcolor=white@0.85:shadowcolor=black:shadowx=1:shadowy=1:x=(w-text_w)/2:y=h*0.78:enable='between(t,${s},${e})'`);
  });

  filters.push(`drawtext=text='${escapeText(brandName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=22:fontcolor=white@0.9:shadowcolor=black:shadowx=2:shadowy=2:x=w-text_w-20:y=20`);
  filters.push(`drawtext=text='${escapeText(surahName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=18:fontcolor=white@0.8:shadowcolor=black:shadowx=1:shadowy=1:x=20:y=20`);

  const filterStr = filters.join(",");

  // Pad 1080x606 → 1080x1920 with black bars, center y=(1920-606)/2=657
  const cmd = `ffmpeg -y \
    -i "${bgPath}" \
    -i "${combinedAudioPath}" \
    -filter_complex "[0:v]pad=1080:1920:0:657:black,${filterStr}[v]" \
    -map "[v]" -map 1:a \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -t ${audioDuration} -shortest \
    "${outputPath}"`;

  await run(cmd, 600000);
  logs.push(`[FFMPEG] ✅ Short video done`);
}

// LONG video - 16:9 landscape full surah
async function generateLongVideo({ ayahs, audioPaths, bgClips, outputPath, brandName, surahName, surahArabicName }, logs) {
  logs.push(`[FFMPEG] Generating LONG video...`);

  // Repeat clips to fill duration
  const repeated = [];
  let total = 0;
  while (total < 7200) {
    for (const c of bgClips) { repeated.push(`file '${c}'`); total += 30; }
  }
  const clipListPath = "/tmp/long_clips.txt";
  fs.writeFileSync(clipListPath, repeated.join("\n"));

  const bgPath = "/tmp/long_bg.mp4";
  // 1920x1080 - both divisible by 2 ✅
  await run(`ffmpeg -y -f concat -safe 0 -i "${clipListPath}" -vf "scale=1920:1080,setsar=1" -c:v libx264 -preset fast -t 7200 "${bgPath}"`);

  const audioListPath = "/tmp/long_audio.txt";
  fs.writeFileSync(audioListPath, audioPaths.map(a => `file '${a}'`).join("\n"));

  const combinedAudioPath = "/tmp/long_audio.mp3";
  await run(`ffmpeg -y -f concat -safe 0 -i "${audioListPath}" "${combinedAudioPath}"`);

  let audioDuration = 300;
  try {
    const dur = await run(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${combinedAudioPath}"`);
    audioDuration = parseFloat(dur.trim()) || 300;
  } catch(e) {}
  logs.push(`[FFMPEG] Total audio: ${(audioDuration/60).toFixed(1)} mins`);

  const ayahDuration = audioDuration / ayahs.length;
  let filters = [];

  // Surah title shown first 5 seconds
  filters.push(`drawtext=text='${escapeText(surahArabicName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=52:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=h*0.30:enable='between(t,0,5)'`);
  filters.push(`drawtext=text='${escapeText(surahName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=36:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.42:enable='between(t,0,5)'`);

  ayahs.forEach((ayah, i) => {
    const s = 5 + i * ayahDuration;
    const e = 5 + (i + 1) * ayahDuration;
    filters.push(`drawtext=text='${escapeText(ayah.arabic)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=42:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=h*0.55:enable='between(t,${s},${e})'`);
    filters.push(`drawtext=text='${escapeText(wrapText(ayah.english, 55))}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=26:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.68:enable='between(t,${s},${e})'`);
    filters.push(`drawtext=text='${escapeText(wrapText(ayah.bengali, 45))}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=22:fontcolor=white@0.9:shadowcolor=black:shadowx=1:shadowy=1:x=(w-text_w)/2:y=h*0.78:enable='between(t,${s},${e})'`);
    filters.push(`drawtext=text='Ayah ${ayah.number}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=20:fontcolor=white@0.7:x=(w-text_w)/2:y=h*0.86:enable='between(t,${s},${e})'`);
  });

  filters.push(`drawtext=text='${escapeText(brandName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=28:fontcolor=white@0.9:shadowcolor=black:shadowx=2:shadowy=2:x=w-text_w-40:y=40`);

  const cmd = `ffmpeg -y \
    -i "${bgPath}" \
    -i "${combinedAudioPath}" \
    -filter_complex "[0:v]${filters.join(",")}[v]" \
    -map "[v]" -map 1:a \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -t ${audioDuration + 5} -shortest \
    "${outputPath}"`;

  await run(cmd, 3600000);
  logs.push(`[FFMPEG] ✅ Long video done`);
}

module.exports = { generateShortVideo, generateLongVideo };

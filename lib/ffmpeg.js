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

// Escape text for FFmpeg drawtext
function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// Wrap text to max chars per line
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

// Generate a SHORT video (9:16 portrait, 1-2 mins)
// Black bars top/bottom, nature strip middle, text overlay
async function generateShortVideo({ ayahs, audioPaths, bgClips, outputPath, brandName, surahName }, logs) {
  logs.push(`[FFMPEG] Generating SHORT video...`);

  // Concat background clips
  const clipListPath = "/tmp/short_clips.txt";
  const clipList = bgClips.map(c => `file '${c}'`).join("\n");
  fs.writeFileSync(clipListPath, clipList);

  const bgPath = "/tmp/short_bg.mp4";
  await run(`ffmpeg -y -f concat -safe 0 -i "${clipListPath}" -vf "scale=1080:607,setsar=1" -c:v libx264 -t 120 "${bgPath}"`);

  // Concat audio files
  const audioListPath = "/tmp/short_audio.txt";
  const audioList = audioPaths.map(a => `file '${a}'`).join("\n");
  fs.writeFileSync(audioListPath, audioList);

  const combinedAudioPath = "/tmp/short_audio.mp3";
  await run(`ffmpeg -y -f concat -safe 0 -i "${audioListPath}" "${combinedAudioPath}"`);

  // Get audio duration
  let audioDuration = 60;
  try {
    const dur = await run(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${combinedAudioPath}"`);
    audioDuration = parseFloat(dur.trim()) || 60;
  } catch(e) {}

  logs.push(`[FFMPEG] Audio duration: ${audioDuration.toFixed(1)}s`);

  // Build text overlays per ayah
  // Distribute ayahs evenly across duration
  const ayahDuration = audioDuration / ayahs.length;

  let drawtextFilters = [];

  ayahs.forEach((ayah, i) => {
    const startTime = i * ayahDuration;
    const endTime = (i + 1) * ayahDuration;

    const arabicText = escapeText(ayah.arabic);
    const englishText = escapeText(wrapText(`- ${ayah.english} -`, 40));
    const bengaliText = escapeText(wrapText(ayah.bengali, 35));
    const ayahNum = `(${ayah.number})`;

    // Arabic text - large, center bottom area
    drawtextFilters.push(
      `drawtext=text='${arabicText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=32:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.58:enable='between(t,${startTime},${endTime})'`
    );

    // Bengali text
    drawtextFilters.push(
      `drawtext=text='${bengaliText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=22:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.68:enable='between(t,${startTime},${endTime})'`
    );

    // English text - small caps
    drawtextFilters.push(
      `drawtext=text='${englishText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=18:fontcolor=white@0.85:shadowcolor=black:shadowx=1:shadowy=1:x=(w-text_w)/2:y=h*0.76:enable='between(t,${startTime},${endTime})'`
    );
  });

  // Brand name top right always visible
  drawtextFilters.push(
    `drawtext=text='${escapeText(brandName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=24:fontcolor=white@0.9:shadowcolor=black:shadowx=2:shadowy=2:x=w-text_w-30:y=30`
  );

  // Surah name top left
  drawtextFilters.push(
    `drawtext=text='${escapeText(surahName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=20:fontcolor=white@0.8:shadowcolor=black:shadowx=1:shadowy=1:x=30:y=30`
  );

  const filterStr = drawtextFilters.join(",");

  // Final: 9:16 portrait with black bars (pillarbox bg to 1080x1920)
  // Background strip in middle, black top and bottom
  const cmd = `ffmpeg -y \
    -i "${bgPath}" \
    -i "${combinedAudioPath}" \
    -filter_complex "[0:v]scale=1080:607,pad=1080:1920:0:656:black,${filterStr}[v]" \
    -map "[v]" -map 1:a \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -t ${audioDuration} \
    -shortest \
    "${outputPath}"`;

  await run(cmd, 600000);
  logs.push(`[FFMPEG] ✅ Short video done: ${outputPath}`);
}

// Generate LONG video (16:9 landscape, full surah)
async function generateLongVideo({ ayahs, audioPaths, bgClips, outputPath, brandName, surahName, surahArabicName }, logs) {
  logs.push(`[FFMPEG] Generating LONG video...`);

  // Concat background clips (loop if needed)
  const clipListPath = "/tmp/long_clips.txt";
  // Repeat clips to fill duration
  const repeatedClips = [];
  let totalBgTime = 0;
  while (totalBgTime < 7200) { // max 2 hours
    for (const clip of bgClips) {
      repeatedClips.push(`file '${clip}'`);
      totalBgTime += 30;
    }
  }
  fs.writeFileSync(clipListPath, repeatedClips.join("\n"));

  const bgPath = "/tmp/long_bg.mp4";
  await run(`ffmpeg -y -f concat -safe 0 -i "${clipListPath}" -vf "scale=1920:1080,setsar=1" -c:v libx264 -t 7200 "${bgPath}"`);

  // Concat all audio
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
  let drawtextFilters = [];

  // Surah title - shown at start for 5 seconds
  drawtextFilters.push(
    `drawtext=text='${escapeText(surahArabicName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=52:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=h*0.30:enable='between(t,0,5)'`
  );
  drawtextFilters.push(
    `drawtext=text='${escapeText(surahName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=36:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.42:enable='between(t,0,5)'`
  );

  ayahs.forEach((ayah, i) => {
    const startTime = 5 + i * ayahDuration;
    const endTime = 5 + (i + 1) * ayahDuration;

    const arabicText = escapeText(ayah.arabic);
    const englishText = escapeText(wrapText(ayah.english, 55));
    const bengaliText = escapeText(wrapText(ayah.bengali, 45));
    const ayahNum = escapeText(`Ayah ${ayah.number}`);

    // Arabic - large center
    drawtextFilters.push(
      `drawtext=text='${arabicText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=42:fontcolor=white:shadowcolor=black:shadowx=3:shadowy=3:x=(w-text_w)/2:y=h*0.55:enable='between(t,${startTime},${endTime})'`
    );

    // English translation
    drawtextFilters.push(
      `drawtext=text='${englishText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=26:fontcolor=white:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h*0.68:enable='between(t,${startTime},${endTime})'`
    );

    // Bengali
    drawtextFilters.push(
      `drawtext=text='${bengaliText}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:fontsize=22:fontcolor=white@0.9:shadowcolor=black:shadowx=1:shadowy=1:x=(w-text_w)/2:y=h*0.78:enable='between(t,${startTime},${endTime})'`
    );

    // Ayah number
    drawtextFilters.push(
      `drawtext=text='${ayahNum}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=20:fontcolor=white@0.7:x=(w-text_w)/2:y=h*0.86:enable='between(t,${startTime},${endTime})'`
    );
  });

  // Brand name always visible top right
  drawtextFilters.push(
    `drawtext=text='${escapeText(brandName)}':fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf:fontsize=28:fontcolor=white@0.9:shadowcolor=black:shadowx=2:shadowy=2:x=w-text_w-40:y=40`
  );

  const filterStr = drawtextFilters.join(",");

  const cmd = `ffmpeg -y \
    -i "${bgPath}" \
    -i "${combinedAudioPath}" \
    -filter_complex "[0:v]${filterStr}[v]" \
    -map "[v]" -map 1:a \
    -c:v libx264 -preset fast -crf 23 \
    -c:a aac -b:a 128k \
    -t ${audioDuration + 5} \
    -shortest \
    "${outputPath}"`;

  await run(cmd, 3600000); // 1 hour timeout for long videos
  logs.push(`[FFMPEG] ✅ Long video done: ${outputPath}`);
}

module.exports = { generateShortVideo, generateLongVideo };

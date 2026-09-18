const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const config = require("./config");

const TG_URL = `https://api.telegram.org/bot${config.TG_BOT_TOKEN}`;

async function sendMessage(text) {
  try {
    await axios.post(`${TG_URL}/sendMessage`, {
      chat_id: config.TG_CHAT_ID,
      text,
      parse_mode: "HTML",
    });
  } catch (err) {
    console.error("[TG] Message error:", err.message);
  }
}

async function sendVideo(videoPath, caption, logs) {
  logs.push(`[TG] Sending video: ${videoPath}`);
  try {
    const form = new FormData();
    form.append("chat_id", config.TG_CHAT_ID);
    form.append("video", fs.createReadStream(videoPath));
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    form.append("supports_streaming", "true");

    const res = await axios.post(`${TG_URL}/sendVideo`, form, {
      headers: form.getHeaders(),
      timeout: 300000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    if (res.data?.ok) {
      logs.push(`[TG] ✅ Video sent!`);
      return true;
    }
    logs.push(`[TG] ❌ Send failed: ${JSON.stringify(res.data)}`);
    return false;
  } catch (err) {
    logs.push(`[TG] ❌ Error: ${err.message}`);
    return false;
  }
}

async function sendNotification({ surahName, surahNum, reciterName, shortDone, longDone }) {
  const bd_time = new Date().toLocaleString("en-BD", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });

  let msg = `🕌 <b>Reza Quran Recitation Bot</b>\n\n`;
  msg += `📖 <b>Surah:</b> ${surahName} (${surahNum})\n`;
  msg += `🎙️ <b>Reciter:</b> ${reciterName}\n`;
  msg += `🕐 <b>Time:</b> ${bd_time}\n\n`;
  msg += `📱 <b>Short Video:</b> ${shortDone ? "✅ Sent" : "❌ Failed"}\n`;
  msg += `🎬 <b>Long Video:</b> ${longDone ? "✅ Sent" : "❌ Failed"}`;

  await sendMessage(msg);
}

module.exports = { sendMessage, sendVideo, sendNotification };

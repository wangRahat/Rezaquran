const axios = require("axios");

const QURAN_API = "https://api.alquran.cloud/v1";

// Get surah info
async function getSurahInfo(surahNum) {
  const res = await axios.get(`${QURAN_API}/surah/${surahNum}`, { timeout: 15000 });
  return res.data?.data || null;
}

// Get all ayahs of a surah with Arabic text
async function getSurahArabic(surahNum) {
  const res = await axios.get(`${QURAN_API}/surah/${surahNum}/quran-uthmani`, { timeout: 15000 });
  return res.data?.data?.ayahs || [];
}

// Get English translation
async function getSurahEnglish(surahNum) {
  const res = await axios.get(`${QURAN_API}/surah/${surahNum}/en.sahih`, { timeout: 15000 });
  return res.data?.data?.ayahs || [];
}

// Get Bengali translation (Muhiuddin Khan)
async function getSurahBengali(surahNum) {
  const res = await axios.get(`${QURAN_API}/surah/${surahNum}/bn.bengali`, { timeout: 15000 });
  return res.data?.data?.ayahs || [];
}

// Get audio URL for specific ayah
function getAyahAudioUrl(reciterId, surahNum, ayahNum) {
  // Format: surah(3 digits) + ayah(3 digits)
  const s = String(surahNum).padStart(3, "0");
  const a = String(ayahNum).padStart(3, "0");
  // Use everyayah.com for reliable audio
  return `https://everyayah.com/data/${getReciterPath(reciterId)}/${s}${a}.mp3`;
}

function getReciterPath(reciterId) {
  const paths = {
    "ar.alafasy": "Alafasy_128kbps",
    "ar.abdurrahmaansudais": "Abdul_Basit_Murattal_192kbps",
    "ar.saadalghamidi": "Saad_Al-Ghamdi_128kbps",
    "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
    "ar.husary": "Husary_128kbps",
  };
  return paths[reciterId] || "Alafasy_128kbps";
}

// Get full surah data (Arabic + English + Bengali)
async function getFullSurahData(surahNum) {
  console.log(`[QURAN] Fetching surah ${surahNum}...`);
  const [info, arabic, english, bengali] = await Promise.all([
    getSurahInfo(surahNum),
    getSurahArabic(surahNum),
    getSurahEnglish(surahNum),
    getSurahBengali(surahNum),
  ]);

  const ayahs = arabic.map((a, i) => ({
    number: a.numberInSurah,
    arabic: a.text,
    english: english[i]?.text || "",
    bengali: bengali[i]?.text || "",
  }));

  return {
    number: surahNum,
    name: info?.name || "",
    englishName: info?.englishName || "",
    totalAyahs: ayahs.length,
    ayahs,
  };
}

module.exports = { getFullSurahData, getAyahAudioUrl, getReciterPath };

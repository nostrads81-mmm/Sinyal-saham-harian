// Server-side only: this is the one place GEMINI_API_KEY is used, so it
// never reaches the browser bundle.

const WA_SIGNAL_SCHEMA = {
  type: 'object',
  properties: {
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          stock: { type: 'string' },
          tradeType: { type: 'string', enum: ['DAY TRADE', 'SWING TRADE'] },
          buyLow: { type: 'number' },
          buyHigh: { type: 'number' },
          sl: { type: 'number' },
          tp1: { type: 'number' },
          tp2: { type: 'number' },
          mmPercent: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
        required: ['stock', 'tradeType', 'buyLow', 'buyHigh', 'sl', 'tp1', 'confidence'],
      },
    },
  },
  required: ['signals'],
};

const WA_SIGNAL_PROMPT = `Ini screenshot atau teks pengumuman sinyal saham dari grup WhatsApp komunitas trading. Ada tiga gaya format yang biasa dipakai:

Gaya 1 (terstruktur, bisa lebih dari satu sinyal dalam satu pesan):
"DAY TRADE - BUY [KODE SAHAM] : [harga rendah]-[harga tinggi]"
"SL IF CLOSE < [harga]" atau "SL : [harga]"
"TP 1 : [harga]"
"TP 2 : [harga]" (kadang tertulis "TP 1" dua kali karena typo admin - baris kedua tetap perlakukan sebagai TP2 jika angkanya lebih tinggi dari TP1)
"MM : [persen] EQUITY"

Gaya 2 (kalimat naratif singkat, biasanya cuma satu sinyal per pesan), contoh:
"INET offer bagus, retest demand di daily. maks buy 352. SL 340. TP 370."
Di sini kode sahamnya di awal kalimat, tidak ada label "DAY TRADE"/"SWING TRADE" sama sekali (anggap "DAY TRADE" kalau tidak disebutkan), harga beli cuma satu angka (bukan range - pakai angka itu untuk buyLow dan buyHigh), dan "SL"/"TP" tanpa titik dua.

Gaya 3 (kode saham sendirian di baris pertama, field lain diberi label jelas dengan titik dua), contoh:
"PTRO
Entry : 4925-5075
TP 1 : 5175
TP 2 : 5375
TP 3 : 5625
SL : 4750
High risk"
Kode saham di baris paling atas sendirian, "Entry" dipakai sebagai ganti "BUY" untuk range harga beli, TP bisa sampai TP 3 (TP 3 boleh diabaikan, tidak perlu diekstrak), dan biasanya ada label risiko di baris terakhir ("High risk"/"Low risk"/dst - abaikan, tidak perlu diekstrak). Tidak ada label "DAY TRADE"/"SWING TRADE" (anggap "DAY TRADE").

Bisa ada lebih dari satu sinyal saham dalam satu screenshot/teks. Ekstrak semua yang kamu temukan jadi array "signals". Untuk tiap sinyal:
- stock: kode saham
- tradeType: "DAY TRADE" atau "SWING TRADE" sesuai yang tertulis, default "DAY TRADE" kalau tidak disebutkan
- buyLow, buyHigh: dari range harga beli (sama-sama diisi dengan angka yang sama kalau cuma ada satu harga beli, bukan range)
- sl: harga stop loss (angka saja, abaikan kata "IF CLOSE <")
- tp1, tp2: target profit (tp2 boleh dikosongkan kalau cuma ada satu TP)
- mmPercent: angka MM dalam persen (misal "9% EQUITY" -> 9), kosongkan kalau tidak disebutkan
- confidence: "low" kalau ada angka yang kurang yakin terbaca atau formatnya gaya 2 (naratif, kurang eksplisit), selain itu "high"

Abaikan paragraf analisa teknikal panjang di bawahnya (alasan, kondisi chart, dll) - itu tidak perlu diekstrak, cukup data terstruktur di atas.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY belum diset di server' });
    return;
  }

  const { image, mimeType, text } = req.body || {};
  if ((!image || !mimeType) && !text) {
    res.status(400).json({ error: 'image+mimeType atau text wajib dikirim' });
    return;
  }

  // Sama-sama lewat Gemini (bukan cuma regex) karena format pesan WA suka
  // beda-beda gaya admin (baris kebalik, typo "TP 1" dua kali, dll) - model
  // yang sudah dipakai buat baca screenshot sama toleransinya kalau dikasih
  // teks polos, jadi tinggal lewatkan sebagai bagian teks tanpa gambar.
  const parts = text
    ? [{ text: `${WA_SIGNAL_PROMPT}\n\nPesan yang di-paste:\n${text}` }]
    : [{ text: WA_SIGNAL_PROMPT }, { inline_data: { mime_type: mimeType, data: image } }];

  // Gemini occasionally answers with a 503 "model overloaded, try again
  // later" during traffic spikes - that's on Google's end, not a real
  // failure, so it's worth a couple of quick automatic retries before
  // making the user paste the screenshot again themselves. 429 (daily
  // quota exhausted) is not retried since waiting a few seconds never
  // helps there.
  const RETRYABLE_STATUSES = [503, 500, 504];
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = [800, 1600];

  try {
    let geminiRes;
    let errText;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: WA_SIGNAL_SCHEMA,
            },
          }),
        }
      );

      if (geminiRes.ok) break;

      errText = await geminiRes.text();
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!RETRYABLE_STATUSES.includes(geminiRes.status) || isLastAttempt) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS[attempt]));
    }

    if (!geminiRes.ok) {
      if (geminiRes.status === 429) {
        res.status(429).json({
          error: 'Kuota harian AI untuk baca screenshot WA sudah habis (maks 20x/hari di paket gratis). Coba lagi setelah kuota reset, atau aktifkan billing di Google AI Studio untuk kuota lebih besar.',
        });
        return;
      }
      res.status(502).json({ error: `Gemini API error: ${errText}` });
      return;
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      res.status(502).json({ error: 'Gemini tidak mengembalikan hasil yang bisa dibaca' });
      return;
    }

    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } },
};

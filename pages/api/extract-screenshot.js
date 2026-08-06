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

const WA_SIGNAL_PROMPT = `Ini screenshot pengumuman sinyal saham dari grup WhatsApp komunitas trading. Formatnya biasanya seperti:
"DAY TRADE - BUY [KODE SAHAM] : [harga rendah]-[harga tinggi]"
"SL IF CLOSE < [harga]" atau "SL : [harga]"
"TP 1 : [harga]"
"TP 2 : [harga]" (kadang tertulis "TP 1" dua kali karena typo admin - baris kedua tetap perlakukan sebagai TP2 jika angkanya lebih tinggi dari TP1)
"MM : [persen] EQUITY"

Bisa ada lebih dari satu sinyal saham dalam satu screenshot. Ekstrak semua yang kamu temukan jadi array "signals". Untuk tiap sinyal:
- stock: kode saham
- tradeType: "DAY TRADE" atau "SWING TRADE" sesuai yang tertulis
- buyLow, buyHigh: dari range harga beli
- sl: harga stop loss (angka saja, abaikan kata "IF CLOSE <")
- tp1, tp2: target profit (tp2 boleh dikosongkan kalau cuma ada satu TP)
- mmPercent: angka MM dalam persen (misal "9% EQUITY" -> 9)
- confidence: "low" kalau ada angka yang kurang yakin terbaca, selain itu "high"

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

  const { image, mimeType } = req.body || {};
  if (!image || !mimeType) {
    res.status(400).json({ error: 'image dan mimeType wajib dikirim' });
    return;
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: WA_SIGNAL_PROMPT },
              { inline_data: { mime_type: mimeType, data: image } },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: WA_SIGNAL_SCHEMA,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
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

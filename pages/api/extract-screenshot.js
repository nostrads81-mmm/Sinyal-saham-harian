// Server-side only: this is the one place GEMINI_API_KEY is used, so it
// never reaches the browser bundle.

const PORTFOLIO_SCHEMA = {
  type: 'object',
  properties: {
    account: {
      type: 'object',
      properties: {
        cash: { type: 'number' },
        invested: { type: 'number' },
        totalEquity: { type: 'number' },
      },
    },
    holdings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          avgPrice: { type: 'number' },
          qtyLot: { type: 'number' },
          currentPrice: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
        required: ['symbol', 'avgPrice', 'qtyLot', 'currentPrice', 'confidence'],
      },
    },
  },
  required: ['holdings'],
};

const PROMPT = `Ini screenshot portofolio saham dari aplikasi Stockbit. Baca tiap baris saham dan ekstrak:
- symbol (kode saham)
- avgPrice (kolom "Avg Price")
- qtyLot (kolom "Qty", ini satuan LOT bukan lembar)
- currentPrice (kolom "Current Price")
- confidence: "low" kalau kamu kurang yakin membaca salah satu angka di baris itu (blur, terpotong, dsb), selain itu "high"

Kalau ada ringkasan akun (Trading Balance/cash, Invested, Total Equity) di layar, isi juga field account. Kalau tidak ada, boleh dikosongkan.
Jangan mengarang angka - kalau benar-benar tidak terbaca, tetap isi field-nya dengan estimasi terbaikmu tapi tandai confidence "low".`;

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
              { text: PROMPT },
              { inline_data: { mime_type: mimeType, data: image } },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: PORTFOLIO_SCHEMA,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
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

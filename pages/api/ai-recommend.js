// Server-side only: this is the one place DEEPSEEK_API_KEY is used, so it
// never reaches the browser bundle.

// DeepSeek's JSON mode requires the word "json" to appear in the prompt and
// only guarantees valid JSON syntax, not this exact shape - the schema is
// spelled out here instead of enforced by the API (unlike Gemini's
// responseSchema in extract-screenshot.js).
function buildPrompt(signals) {
  const lines = signals.map((s) => {
    const range = s.buyLow != null && s.buyHigh != null ? `${s.buyLow}-${s.buyHigh}` : String(s.entry);
    const tp = s.tp2 != null ? `TP1 ${s.tp1} / TP2 ${s.tp2}` : `TP1 ${s.tp1}`;
    const last = s.lastPrice != null ? `, harga terakhir ${s.lastPrice}` : ' (harga terakhir tidak diketahui)';
    return `- ${s.stock} (${s.tradeType}): entry ${s.entry}, range beli ${range}, SL ${s.sl}, ${tp}, skor risk/reward ${s.score?.toFixed?.(2) ?? s.score}${last}`;
  });

  return `Kamu asisten trading saham harian. Untuk tiap sinyal di bawah, tentukan satu rekomendasi tindakan:
- "BUY" kalau harga terakhir sudah masuk ke range beli (atau tidak diketahui tapi risk/reward-nya bagus, skor >= 2) dan layak dieksekusi sekarang.
- "WAIT" kalau harga terakhir masih di atas range beli (belum turun ke area entry).
- "SELL" kalau risk/reward-nya buruk (skor rendah, di bawah 1.2) atau harga terakhir sudah di bawah/dekat SL sehingga sinyalnya sudah tidak valid untuk masuk baru.

Sinyal:
${lines.join('\n')}

Balas HANYA dengan JSON (tanpa markdown code fence) berbentuk:
{"recommendations": [{"stock": "KODE", "action": "BUY atau WAIT atau SELL", "reason": "alasan singkat 1 kalimat dalam Bahasa Indonesia", "detail": "penjelasan lebih panjang (3-5 kalimat) kenapa rekomendasinya itu - sebut angka-angka relevan (entry, SL, TP, skor risk/reward, posisi harga terakhir terhadap range beli) dan apa yang perlu diperhatikan trader sebelum eksekusi"}]}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'DEEPSEEK_API_KEY belum diset di server' });
    return;
  }

  const { signals } = req.body || {};
  if (!Array.isArray(signals) || signals.length === 0) {
    res.status(400).json({ error: 'signals (array) wajib dikirim' });
    return;
  }

  // Same "retry a couple of times on a transient server error" reasoning as
  // extract-screenshot.js - a 500/502/503 from the provider isn't the
  // user's fault and often clears up within a second or two.
  const RETRYABLE_STATUSES = [500, 502, 503, 504];
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = [800, 1600];

  try {
    let dsRes;
    let errText;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      dsRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: buildPrompt(signals) }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      });

      if (dsRes.ok) break;

      errText = await dsRes.text();
      const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
      if (!RETRYABLE_STATUSES.includes(dsRes.status) || isLastAttempt) break;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS[attempt]));
    }

    if (!dsRes.ok) {
      if (dsRes.status === 429) {
        res.status(429).json({ error: 'Kuota/rate limit DeepSeek tercapai, coba lagi sebentar lagi.' });
        return;
      }
      res.status(502).json({ error: `DeepSeek API error: ${errText}` });
      return;
    }

    const data = await dsRes.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      res.status(502).json({ error: 'DeepSeek tidak mengembalikan hasil yang bisa dibaca' });
      return;
    }

    const parsed = JSON.parse(text);
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

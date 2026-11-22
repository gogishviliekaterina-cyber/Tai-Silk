// /api/gemini.js (Vercel Serverless Function)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
  }

  try {
    const { mode, lang = 'ka', systemPrompt = '', context = {}, history = [], message = '' } = req.body || {};
    const targetLang = lang === 'en' ? 'English' : 'Georgian (ქართული)';

    const modeInstruction =
      mode === 'stylist'
        ? `\nMODE: AI PERSONAL GIFT STYLIST.\nAnalyze the recipient's zodiac sign, occasion/relationship, and preferred color mood. Respond strictly in ${targetLang} as valid JSON with keys: {"text": string, "zodiacId": string|null, "moodId": number|null, "rec": {"zodiacId": string, "moodId": number, "zName": string, "mName": string, "wish": string}|null}. Match moodId (1..12) accurately to: ${JSON.stringify(context?.moodsCatalog || [])}. Match zodiacId accurately to: ${JSON.stringify(context?.zodiacsCatalog || [])}. Include a warm, poetic greeting card note in "wish".`
        : `\nMODE: BRAND FAQ ASSISTANT.\nAnswer strictly and ONLY based on TAİ's verified brand rules, policies, sizes, prices, silk care, packaging, delivery, payments, and Tbilisi locations. If the user asks about unrelated topics, politely explain that you only assist with TAİ 💜 brand questions. Respond strictly in ${targetLang} as valid JSON with keys: {"text": string}.`;

    const cleanHistory = (Array.isArray(history) ? history : [])
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .slice(-8)
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

    while (cleanHistory.length > 0 && cleanHistory[0].role === 'model') {
      cleanHistory.shift();
    }

    const contents = [
      ...cleanHistory,
      {
        role: 'user',
        parts: [{ text: `[Language: ${targetLang} | Selected size: ${context?.selectedSize || '65'}cm] ${message}` }]
      }
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${systemPrompt}${modeInstruction}` }]
          },
          contents,
          generationConfig: {
            temperature: mode === 'stylist' ? 0.65 : 0.3,
            responseMimeType: 'application/json'
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: 'Gemini API error', details: errText });
    }

    const data = await geminiRes.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

    let parsed = {};
    try {
      const cleaned = rawText.replace(/^
```json\s*/i, '').replace(/
```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (_parseErr) {
      parsed = { text: rawText };
    }

    return res.status(200).json({
      text: parsed.text || '',
      zodiacId: parsed.zodiacId || null,
      moodId: parsed.moodId || null,
      rec: parsed.rec || null
    });
  } catch (error) {
    return res.status(500).json({ error: 'Server error', details: error.message });
  }
}

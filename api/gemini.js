// /api/gemini.js (Vercel Serverless Function)
async function callGemini(apiKey, payload) {
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  let lastError = '';

  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    if (res.ok) {
      const data = await res.json();
      return { ok: true, model, data };
    }
    lastError = `${model} (${res.status}): ${await res.text()}`;
  }

  return { ok: false, error: lastError };
}

export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (req.method === 'GET') {
    if (!apiKey) {
      return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY is not configured in Vercel' });
    }
    try {
      const test = await callGemini(apiKey, {
        contents: [{ role: 'user', parts: [{ text: 'Say OK in one word.' }] }]
      });
      if (!test.ok) {
        return res.status(502).json({ ok: false, error: test.error });
      }
      const reply = test.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ ok: true, model: test.model, reply });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });
  }

  try {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_e) { body = {}; }
    }

    const { mode, lang = 'ka', systemPrompt = '', context = {}, history = [], message = '' } = body;
    const targetLang = lang === 'en' ? 'English' : 'Georgian (ქართული)';

    const modeInstruction =
      mode === 'stylist'
        ? `\nMODE: AI PERSONAL GIFT STYLIST.\nAnalyze the recipient's zodiac sign, occasion/relationship, and preferred color mood. Respond strictly in ${targetLang} as valid JSON with keys: {"text": string, "zodiacId": string|null, "moodId": number|null, "rec": {"zodiacId": string, "moodId": number, "zName": string, "mName": string, "wish": string}|null}. Match moodId (1..12) accurately to: ${JSON.stringify(context?.moodsCatalog || [])}. Match zodiacId accurately to: ${JSON.stringify(context?.zodiacsCatalog || [])}. Include a warm, poetic greeting card note in "wish".`
        : `\nMODE: BRAND FAQ ASSISTANT.\nAnswer strictly and ONLY based on TAİ's verified brand rules, policies, sizes, prices, silk care, packaging, delivery, payments, and Tbilisi locations. If the user asks about unrelated topics, politely explain that you only assist with TAİ 💜 brand questions. Respond strictly in ${targetLang} as valid JSON with keys: {"text": string}.`;

    const rawTurns = (Array.isArray(history) ? history : [])
      .filter((m) => m && typeof m.text === 'string' && m.text.trim())
      .slice(-8)
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'model',
        text: m.text.trim()
      }));

    rawTurns.push({
      role: 'user',
      text: `[Language: ${targetLang} | Selected size: ${context?.selectedSize || '65'}cm] ${message}`
    });

    while (rawTurns.length > 0 && rawTurns[0].role === 'model') {
      rawTurns.shift();
    }
    const contents = [];
    for (const turn of rawTurns) {
      const prev = contents[contents.length - 1];
      if (prev && prev.role === turn.role) {
        prev.parts[0].text += `\n${turn.text}`;
      } else {
        contents.push({ role: turn.role, parts: [{ text: turn.text }] });
      }
    }

    const result = await callGemini(apiKey, {
      systemInstruction: {
        parts: [{ text: `${systemPrompt}${modeInstruction}` }]
      },
      contents,
      generationConfig: {
        temperature: mode === 'stylist' ? 0.65 : 0.3,
        responseMimeType: 'application/json'
      }
    });

    if (!result.ok) {
      return res.status(502).json({ error: 'Gemini API error', details: result.error });
    }

    const rawText = result.data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed = {};
    try {
      const start = rawText.indexOf('{');
      const end = rawText.lastIndexOf('}');
      const cleaned = start !== -1 && end !== -1 ? rawText.slice(start, end + 1) : rawText;
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

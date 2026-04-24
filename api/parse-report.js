// Vercel serverless function: parse a handwritten/printed daily report image
// using Claude Sonnet 4.6 vision + structured outputs.
//
// Input (POST JSON):
//   { image: "data:image/...;base64,XXXX" | "<base64>", masters: [{id, name}] }
// Output:
//   { date: "YYYY-MM-DD"|null, entries: [{ master_id, master_name, revenue, master_pay, note }], raw_text }

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

function stripDataUrl(s) {
  if (typeof s !== 'string') return { data: '', mediaType: 'image/jpeg' };
  const m = s.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (m) return { data: m[2], mediaType: m[1].toLowerCase().replace('image/jpg', 'image/jpeg') };
  return { data: s, mediaType: 'image/jpeg' };
}

function buildSchema() {
  return {
    type: 'object',
    properties: {
      date: {
        type: ['string', 'null'],
        description: 'Date of the report in YYYY-MM-DD. Null if not visible.',
      },
      entries: {
        type: 'array',
        description: 'One entry per master that has data on this report.',
        items: {
          type: 'object',
          properties: {
            master_id: {
              type: ['integer', 'null'],
              description: 'Database id of the master if matched by name, else null.',
            },
            master_name: {
              type: 'string',
              description: 'Master name as written or matched.',
            },
            revenue: {
              type: 'number',
              description: 'Daily revenue in rubles (Выручка).',
            },
            master_pay: {
              type: 'number',
              description: 'Master share / payout in rubles (Доля мастера).',
            },
            note: {
              type: ['string', 'null'],
              description: 'Optional free-text note: services performed, comments.',
            },
          },
          required: ['master_id', 'master_name', 'revenue', 'master_pay', 'note'],
          additionalProperties: false,
        },
      },
      raw_text: {
        type: 'string',
        description: 'Full transcribed text of the page for audit.',
      },
    },
    required: ['date', 'entries', 'raw_text'],
    additionalProperties: false,
  };
}

function buildPrompt(masters) {
  const list = (masters || [])
    .map((m) => `- id=${m.id}, name="${m.name}"`)
    .join('\n');
  return `Ты помощник салона красоты «Nicole Beauty». На фото — рукописный или печатный дневной отчёт из тетради с финансовыми итогами за день.

Известные мастера салона:
${list || '(нет данных — вернуть master_id=null для всех)'}

Извлеки данные:
1. Дата отчёта (если видна) — формат YYYY-MM-DD.
2. По каждому мастеру: выручка (Выручка) и доля мастера (Доля мастера / Мастеру). Числа — в рублях, целые или с десятыми.
3. Если имя мастера на фото совпадает (точно или явно) с одним из списка выше — поставь соответствующий master_id. Иначе master_id=null.
4. Игнорируй строки без числовых данных. Если мастер встречается несколько раз за день — сложи суммы в один entry.
5. Если число неразборчиво — поставь 0 и упомяни это в note.
6. raw_text — вся видимая на странице запись подряд, без пропусков.

Возвращай только JSON по заданной схеме.`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY env var is not set on the server' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const { image, masters } = body;
  if (!image) {
    res.status(400).json({ error: 'image (base64) is required' });
    return;
  }

  const { data, mediaType } = stripDataUrl(image);
  if (!data || data.length < 100) {
    res.status(400).json({ error: 'image data appears empty or too small' });
    return;
  }

  const payload = {
    model: MODEL,
    max_tokens: 4096,
    output_config: {
      format: { type: 'json_schema', schema: buildSchema() },
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: buildPrompt(masters) },
        ],
      },
    ],
  };

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    const text = await r.text();
    if (!r.ok) {
      res.status(r.status).json({ error: 'Anthropic API error', status: r.status, body: text.slice(0, 2000) });
      return;
    }

    let api;
    try { api = JSON.parse(text); } catch (e) {
      res.status(502).json({ error: 'Anthropic returned non-JSON', body: text.slice(0, 2000) });
      return;
    }

    const block = (api.content || []).find((b) => b.type === 'text');
    if (!block || !block.text) {
      res.status(502).json({ error: 'No text block in Anthropic response', api });
      return;
    }

    let parsed;
    try { parsed = JSON.parse(block.text); } catch (e) {
      res.status(502).json({ error: 'Failed to parse model JSON', raw: block.text });
      return;
    }

    res.status(200).json({
      ...parsed,
      usage: api.usage,
    });
  } catch (e) {
    res.status(500).json({ error: 'Server error: ' + (e.message || String(e)) });
  }
};

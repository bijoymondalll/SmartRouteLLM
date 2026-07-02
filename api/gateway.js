// ============================================================================
// 🔥 BIJOY.AI SUPREME API GATEWAY (CEREBRAS 3.3 + GEMINI 2.5 FLASH FALLBACK)
// ============================================================================

export default {
  async fetch(request, env, ctx) {
    // 💥 1. CORS Preflight Bypass
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: getCorsHeaders() });
    }

    if (request.method !== 'POST') {
      return new Response('Only POST requests allowed', { status: 405 });
    }

    const log = [];
    let body = {};
    let messages = [];

    try {
      body = await request.json();
      messages = body.messages || [];
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      });
    }

    // 💥 UNIVERSAL FIRE-POOL (closure over `body` so payload forwarding works)
    async function firePool(poolName, keysArr, endpointUrl, overrideModel, timeoutMs = 7000) {
      if (!endpointUrl || endpointUrl.trim().length < 8) return { success: false, reason: 'NO_URL' };

      const pool = getCleanPool(keysArr);
      if (pool.length === 0) return { success: false, reason: 'EMPTY_KEY_ARRAY' };

      const targetUrl = smartUrl(endpointUrl);
      const payload = { ...body, model: overrideModel };

      for (const apiKey of pool) {
        try {
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
              'Connection': 'close',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (res.ok) {
            const headers = new Headers(res.headers);
            Object.entries(getCorsHeaders()).forEach(([k, v]) => headers.set(k, v));
            return { success: true, res: new Response(res.body, { status: res.status, headers }) };
          }
        } catch (e) {
          continue; // 💥 Key dead → instant hop to next key in the pool
        }
      }
      return { success: false, reason: 'ALL_KEYS_DEAD' };
    }

    // =========================================================================
    // 🚀 LAYER 1: Cerebras Pool (Heavyweight Llama-3.3-70b)
    // CEREBRAS_KEYS comes from env as a comma-separated string of API keys
    // =========================================================================
    const cerebrasKeys = parseKeysFromEnv(env.CEREBRAS_KEYS);
    const cer = await firePool(
      'Cerebras',
      cerebrasKeys,
      'https://api.cerebras.ai/v1/chat/completions',
      'llama-3.3-70b',
      5000,
    );
    if (cer.success) return cer.res;
    log.push(`Cerebras:${cer.reason}`);

    // =========================================================================
    // 🚀 LAYER 2: Gemini 2.5 Flash Fallback (System Prompts Fixed)
    // =========================================================================
    const geminiRes = await callGemini(env.GEMINI_API_KEY, messages);
    if (geminiRes) return geminiRes;
    log.push('Gemini: Failed to fetch or parse');

    // 💥 DEAD END: All layers failed
    return new Response(
      JSON.stringify({ error: 'All API layers failed', logs: log }),
      {
        status: 500,
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      },
    );
  },
};

// ============================================================================
// 🛠️ HELPER FUNCTIONS
// ============================================================================

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// 💥 Parse comma-separated key string from Cloudflare env into a clean array
function parseKeysFromEnv(envValue) {
  if (!envValue || typeof envValue !== 'string') return [];
  return envValue
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 3);
}

// 💥 Pool cleaner: filters junk, randomizes order for load distribution
function getCleanPool(keysArray) {
  if (!Array.isArray(keysArray)) return [];
  return keysArray
    .map(k => (typeof k === 'string' ? k.trim() : ''))
    .filter(k => k.length > 3)
    .sort(() => Math.random() - 0.5);
}

// 💥 Smart URL normalizer: guarantees the endpoint always ends with /v1/chat/completions
function smartUrl(baseUrl) {
  if (!baseUrl || typeof baseUrl !== 'string') return '';
  let clean = baseUrl.trim().replace(/\/+$/, '');
  if (!clean.endsWith('/v1/chat/completions')) {
    clean += '/v1/chat/completions';
  }
  return clean;
}

// ============================================================================
// 🔥 GEMINI 2.5 FLASH — Raw REST API (System Role parsing permanently fixed)
// ============================================================================
async function callGemini(apiKey, messages) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 5) return null;

  let systemInstruction = null;
  const contents = [];

  // 💥 System Role parsing — Gemini API wants system prompts as `systemInstruction`
  (messages || []).forEach(m => {
    if (m.role === 'system') {
      systemInstruction = { parts: [{ text: m.content }] };
    } else {
      contents.push({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      });
    }
  });

  const bodyPayload = { contents };
  if (systemInstruction) bodyPayload.systemInstruction = systemInstruction;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(12000),
      },
    );

    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!t) return null;

    return new Response(
      JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        model: 'gemini-2.5-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: t },
            finish_reason: 'stop',
          },
        ],
      }),
      {
        headers: { ...getCorsHeaders(), 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    return null;
  }
}

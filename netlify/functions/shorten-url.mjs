const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(bodyObj),
  };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, message: 'Método não permitido. Use POST.' });
  }

  try {
    let rawBodyStr = event.body || '';
    if (rawBodyStr && event.isBase64Encoded) {
      rawBodyStr = Buffer.from(rawBodyStr, 'base64').toString('utf-8');
    }
    const parsedBody = rawBodyStr ? JSON.parse(rawBodyStr) : {};
    const rawUrl = typeof parsedBody?.url === 'string' ? parsedBody.url.trim() : '';

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return jsonResponse(400, { ok: false, message: 'URL inválida para encurtamento.' });
    }

    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:' ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('ais-dev-')
    ) {
      return jsonResponse(400, {
        ok: false,
        message: 'Apenas URLs públicas HTTPS (ex: Netlify ou ais-pre-...) podem ser encurtadas.',
      });
    }

    if (host.includes('script.google.com') || host.includes('docs.google.com')) {
      return jsonResponse(400, {
        ok: false,
        message: 'Informe a URL pública do site do aplicativo, e não o endereço do Google Sheets/Script.',
      });
    }

    const target = parsed.toString();

    try {
      const tinyRes = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(target)}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (tinyRes.ok) {
        const tinyText = (await tinyRes.text()).trim();
        if (/^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]+$/.test(tinyText)) {
          return jsonResponse(200, { ok: true, shortUrl: tinyText, provider: 'tinyurl' });
        }
      }
    } catch {
      // fallback below
    }

    try {
      const isGdRes = await fetch(
        `https://is.gd/create.php?format=simple&url=${encodeURIComponent(target)}`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (isGdRes.ok) {
        const isGdText = (await isGdRes.text()).trim();
        if (/^https:\/\/is\.gd\/[A-Za-z0-9_-]+$/.test(isGdText)) {
          return jsonResponse(200, { ok: true, shortUrl: isGdText, provider: 'is.gd' });
        }
      }
    } catch {
      // fall through
    }

    return jsonResponse(200, {
      ok: false,
      message: 'Os encurtadores externos não responderam no momento. Tente novamente em instantes.',
    });
  } catch (err) {
    return jsonResponse(200, {
      ok: false,
      message: err instanceof Error ? err.message : 'Erro interno ao encurtar URL.',
    });
  }
}

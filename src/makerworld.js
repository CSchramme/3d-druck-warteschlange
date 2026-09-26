'use strict';

// MakerWorld-Links prüfen und (so gut es geht) Titel und Vorschaubild laden.

const MAKERWORLD_HOSTS = ['makerworld.com', 'makerworld.com.cn'];
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Gibt einen sauberen http(s)-Link zurück, null wenn leer, sonst Fehler. */
function normalizeUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;
  if (!raw.includes('://')) raw = `https://${raw}`;
  const invalid = new Error('Das sieht nicht wie ein gültiger Link aus.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || /\s/.test(raw)) {
    throw invalid;
  }
  if (raw.length > 500) throw new Error('Der Link ist zu lang.');
  return raw;
}

function isMakerworld(url) {
  if (!url) return false;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return MAKERWORLD_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

function modelId(url) {
  const match = /\/models\/(\d+)/.exec(url || '');
  return match ? match[1] : null;
}

function fallbackTitle(url) {
  const id = modelId(url);
  return id ? `MakerWorld-Modell ${id}` : 'MakerWorld-Modell';
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}

function cleanTitle(title) {
  return (title || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s*[-|–]\s*MakerWorld.*$/i, '')
    .replace(/\s*[-|–]\s*(Free\s+)?3D\s+Print(able)?\s+Model.*$/i, '')
    .trim()
    .slice(0, 120);
}

function parsePage(html) {
  const meta = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
    }
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content;
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = cleanTitle(meta['og:title'] || (titleTag ? decodeEntities(titleTag[1]) : ''));
  let image = meta['og:image'] || meta['twitter:image'] || '';
  if (!image.startsWith('https://')) image = '';
  return { title: title || null, imageUrl: image.slice(0, 500) || null };
}

/** Lädt Titel und Vorschaubild. Bei jedem Fehler (z. B. Bot-Schutz) kommt
 *  einfach ein leeres Ergebnis zurück. */
async function fetchInfo(url, timeoutMs = 6000) {
  const empty = { title: null, imageUrl: null };
  if (!isMakerworld(url)) return empty;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return empty;
    const html = (await response.text()).slice(0, 2_000_000);
    return parsePage(html);
  } catch (err) {
    console.info(`MakerWorld-Infos für ${url} nicht ladbar: ${err.message}`);
    return empty;
  }
}

module.exports = { normalizeUrl, isMakerworld, modelId, fallbackTitle, parsePage, fetchInfo };

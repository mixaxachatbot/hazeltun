import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const MAX_BYTES = 5 * 1024 * 1024;
const ACCESS_CODE = process.env.HAZELTUN_CODE || '4578';
const SESSION_COOKIE = 'hazeltun_session';
const sessionToken = createHmac('sha256', randomBytes(32)).update('hazeltun-local-session').digest('hex');
const failedUnlocks = new Map();
const blockedHosts = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

function hasSession(req) {
  const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${SESSION_COOKIE}=`));
  const provided = cookie?.slice(SESSION_COOKIE.length + 1) || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(sessionToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

async function readJson(req, limit = 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request is too large.');
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

function isPrivateAddress(address) {
  if (address.includes(':')) {
    const a = address.toLowerCase();
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') || /^fe[89ab]/.test(a) || a.startsWith('::ffff:127.') || a.startsWith('::ffff:10.') || a.startsWith('::ffff:192.168.');
  }
  const n = address.split('.').map(Number);
  return n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] >= 224 || (n[0] === 169 && n[1] === 254) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) || (n[0] === 192 && n[1] === 168);
}

async function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Enter a complete web address, such as https://example.com'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS addresses are supported.');
  if (u.username || u.password) throw new Error('Addresses containing sign-in credentials are not allowed.');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (blockedHosts.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Private network addresses are blocked.');
  const ip = isIP(host);
  if (ip && isPrivateAddress(host)) throw new Error('Private network addresses are blocked.');
  if (!ip) {
    const records = await lookup(host, { all: true, verbatim: true }).catch(() => []);
    if (!records.length || records.some(record => isPrivateAddress(record.address))) throw new Error('This address could not be safely reached.');
  }
  return u;
}

function proxiedUrl(value, base) {
  try {
    const resolved = new URL(value, base);
    if (!['http:', 'https:'].includes(resolved.protocol)) return value;
    return `/proxy?url=${encodeURIComponent(resolved.href)}`;
  } catch { return value; }
}

function rewriteHtml(html, finalUrl) {
  // Drop base tags and route common navigations/assets back through this server.
  return html.replace(/<base\b[^>]*>/gi, '')
    .replace(/\b(href|src|action|poster)\s*=\s*(["'])(.*?)\2/gi, (whole, attr, quote, value) => {
      if (/^(?:#|data:|javascript:|mailto:|tel:|blob:)/i.test(value.trim())) return whole;
      return `${attr}=${quote}${proxiedUrl(value, finalUrl)}${quote}`;
    });
}

async function proxyRequest(url) {
  let target = await validateTarget(url);
  for (let redirects = 0; redirects <= 4; redirects++) {
    const response = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'HazeltunGlass/1.0' } });
    if ([301,302,303,307,308].includes(response.status)) {
      if (redirects === 4) throw new Error('Too many redirects.');
      const location = response.headers.get('location');
      if (!location) throw new Error('The destination returned an invalid redirect.');
      target = await validateTarget(new URL(location, target).href);
      continue;
    }
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new Error('This page is larger than the 5 MB preview limit.');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('This page is larger than the 5 MB preview limit.');
    return { status: response.status, type, bytes, url: target.href };
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (requestUrl.pathname === '/session' && req.method === 'GET') {
    json(res, 200, { unlocked: hasSession(req) });
    return;
  }
  if (requestUrl.pathname === '/unlock' && req.method === 'POST') {
    try {
      const client = req.socket.remoteAddress || 'unknown';
      const attempt = failedUnlocks.get(client);
      if (attempt && attempt.expiresAt > Date.now() && attempt.count >= 10) { json(res, 429, { error: 'Too many attempts. Wait ten minutes and try again.' }); return; }
      const body = await readJson(req);
      if (String(body.code || '') !== ACCESS_CODE) {
        const current = attempt && attempt.expiresAt > Date.now() ? attempt : { count: 0, expiresAt: Date.now() + 10 * 60 * 1000 };
        current.count++;
        failedUnlocks.set(client, current);
        json(res, 401, { error: 'That code didn’t match.' });
        return;
      }
      failedUnlocks.delete(client);
      const secure = req.socket.encrypted ? '; Secure' : '';
      json(res, 200, { unlocked: true }, { 'Set-Cookie': `${SESSION_COOKIE}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400${secure}` });
    } catch (error) {
      json(res, 400, { error: error.message || 'Invalid request.' });
    }
    return;
  }
  if (requestUrl.pathname === '/lock' && req.method === 'POST') {
    json(res, 200, { unlocked: false }, { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
    return;
  }
  if (requestUrl.pathname === '/proxy') {
    try {
      if (!hasSession(req)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Enter the access code to continue.'); return; }
      if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }).end('GET only'); return; }
      const target = requestUrl.searchParams.get('url');
      if (!target) { res.writeHead(400).end('Missing URL'); return; }
      const result = await proxyRequest(target);
      let body = result.bytes;
      let contentType = result.type;
      if (/text\/html/i.test(contentType)) {
        body = Buffer.from(rewriteHtml(body.toString('utf8'), result.url));
        contentType = 'text/html; charset=utf-8';
      } else if (/text\/css/i.test(contentType)) {
        body = Buffer.from(body.toString('utf8').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (m, q, value) => `url("${proxiedUrl(value, result.url)}")`));
      }
      res.writeHead(result.status, {
        'Content-Type': contentType,
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox allow-scripts allow-forms; default-src * data: blob: 'unsafe-inline' 'unsafe-eval';",
        'Referrer-Policy': 'no-referrer',
      }).end(body);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'That site took too long to respond.' : (error?.message || 'The page could not be loaded.');
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Could not load page</title><body style="font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;color:#27241f"><h1>Couldn’t load this page</h1><p>${message.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p></body>`);
    }
    return;
  }
  if (requestUrl.pathname === '/logo.jpg') {
    try { const data = await readFile(path.join(here, 'public', 'logo.jpg')); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }).end(data); }
    catch { res.writeHead(404).end(); }
    return;
  }
  try {
    const html = await readFile(path.join(here, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html);
  } catch { res.writeHead(500).end('Website files are missing.'); }
});

server.listen(port, '0.0.0.0', () => console.log(`Hazeltun is ready at http://localhost:${port}`));

//67

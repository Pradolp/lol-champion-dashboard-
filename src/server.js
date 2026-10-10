// server.js — servidor HTTP (sem dependências externas).
// Serve o frontend em /public e expõe a API em /api/*.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, DEFAULT_QUEUE, QUEUES, REGIONS } from './config.js';
import { ApiError } from './riotClient.js';
import { aggregateTopChampions, findLastPlayed, getAnalyzedMatches } from './matches.js';
import { getChampionData } from './dataDragon.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function sendError(res, err) {
  const isApiError = err instanceof ApiError;
  const status = isApiError ? err.status : 500;
  const code = isApiError ? err.code : 'INTERNAL';
  const message = isApiError ? err.message : 'Erro interno inesperado.';
  if (!isApiError || status >= 500) console.error('[erro]', err);
  sendJson(res, status, { error: message, code });
}

/** Valida e devolve a região (objeto com key/regional/platform). */
function parseRegion(rawKey) {
  const key = String(rawKey || config.defaultRegion).toUpperCase();
  const region = REGIONS[key];
  if (!region) {
    throw new ApiError(`Região inválida: "${rawKey}".`, { status: 400, code: 'BAD_REGION' });
  }
  return { key, ...region };
}

/** Aceita gameName/tagLine separados ou um "riotId" no formato Nome#TAG. */
function parseRiotId(searchParams) {
  let gameName = searchParams.get('gameName') ?? '';
  let tagLine = searchParams.get('tagLine') ?? '';

  const riotId = searchParams.get('riotId');
  if ((!gameName || !tagLine) && riotId) {
    const hashIndex = riotId.lastIndexOf('#');
    if (hashIndex > 0) {
      gameName = riotId.slice(0, hashIndex);
      tagLine = riotId.slice(hashIndex + 1);
    }
  }

  gameName = gameName.trim();
  tagLine = tagLine.trim();

  if (!gameName || !tagLine) {
    throw new ApiError('Informe o Riot ID no formato Nome#TAG.', {
      status: 400,
      code: 'BAD_RIOT_ID',
    });
  }
  return { gameName, tagLine };
}

function parseCount(raw) {
  if (raw == null || raw === '') return config.defaultMatchCount;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return config.defaultMatchCount;
  return Math.min(n, config.maxMatchCount);
}

function parseQueue(raw) {
  if (raw == null || raw === '' || raw === 'all' || raw === 'todas') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'Método não permitido.' });
    return;
  }

  if (pathname === '/api/health') {
    sendJson(res, 200, { ok: true, hasKey: Boolean(config.apiKey) });
    return;
  }

  if (pathname === '/api/config') {
    sendJson(res, 200, {
      regions: Object.entries(REGIONS).map(([key, region]) => ({ key, label: region.label })),
      queues: QUEUES,
      defaults: {
        region: config.defaultRegion,
        count: config.defaultMatchCount,
        maxCount: config.maxMatchCount,
        queue: DEFAULT_QUEUE,
      },
    });
    return;
  }

  if (pathname === '/api/champions') {
    const data = await getChampionData();
    sendJson(res, 200, {
      version: data.version,
      champions: data.list.map((c) => ({ id: c.id, name: c.name })),
    });
    return;
  }

  if (pathname === '/api/painel') {
    const region = parseRegion(searchParams.get('region'));
    const { gameName, tagLine } = parseRiotId(searchParams);
    const count = parseCount(searchParams.get('count'));
    const queue = parseQueue(searchParams.get('queue'));

    const { account, puuid, matches } = await getAnalyzedMatches(region, gameName, tagLine, {
      count,
      queue,
    });
    const championData = await getChampionData();
    const topChampions = aggregateTopChampions(matches, championData, 10);

    sendJson(res, 200, {
      ok: true,
      player: { gameName: account.gameName, tagLine: account.tagLine, puuid },
      region: region.key,
      count,
      queue,
      matchesAnalyzed: matches.length,
      iconBaseUrl: `https://ddragon.leagueoflegends.com/cdn/${championData.version}/img/champion/`,
      topChampions,
    });
    return;
  }

  if (pathname === '/api/last-played') {
    const region = parseRegion(searchParams.get('region'));
    const { gameName, tagLine } = parseRiotId(searchParams);
    const count = parseCount(searchParams.get('count'));
    const queue = parseQueue(searchParams.get('queue'));
    const champion = searchParams.get('champion');

    if (!champion || !champion.trim()) {
      throw new ApiError('Informe o nome do campeão.', { status: 400, code: 'BAD_CHAMPION' });
    }

    const result = await findLastPlayed(region, gameName, tagLine, champion.trim(), { count, queue });
    sendJson(res, 200, { ok: true, ...result });
    return;
  }

  sendJson(res, 404, { error: 'Rota não encontrada.' });
}

async function serveStatic(req, res, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendJson(res, 400, { error: 'URL inválida.' });
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + sep)) {
    sendJson(res, 403, { error: 'Acesso negado.' });
    return;
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    // Fallback SPA: devolve o index.html para rotas desconhecidas.
    try {
      const html = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
      res.end(req.method === 'HEAD' ? undefined : html);
    } catch {
      sendJson(res, 404, { error: 'Arquivo não encontrado.' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (err) {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(res, err);
  }
});

server.listen(config.port, () => {
  console.log(`\n  Painel de Dados Pessoais do LoL`);
  console.log(`  → http://localhost:${config.port}\n`);
  if (!config.apiKey) {
    console.warn('  ⚠  RIOT_API_KEY não configurada. Copie .env.example para .env e cole sua chave.');
    console.warn('     (Veja docs/DEPENDENCIAS_MANUAIS.md para o passo a passo.)\n');
  }
});

export { server };

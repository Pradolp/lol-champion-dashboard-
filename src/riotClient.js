// riotClient.js — cliente HTTP da Riot Games API.
// Todas as requisições passam pelo RateLimiter global e tratam erros/Retry-After.

import { config, RATE_LIMITS } from './config.js';
import { RateLimiter } from './rateLimiter.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Erro padronizado com status HTTP e código legível. */
export class ApiError extends Error {
  constructor(message, { status = 500, code = 'RIOT_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Um único limitador global (conservador: cobre rota regional e platform).
const limiter = new RateLimiter({ limits: RATE_LIMITS, maxConcurrent: 8, buffer: 0.9 });

export function getLimiter() {
  return limiter;
}

/** Traduz o status HTTP da Riot em um ApiError amigável. */
function mapStatusError(status) {
  switch (status) {
    case 400:
      return new ApiError('Riot ID inválido. Use o formato Nome#TAG.', {
        status: 400,
        code: 'BAD_REQUEST',
      });
    case 401:
      return new ApiError(
        'Chave da Riot inválida ou expirada (a chave de desenvolvimento expira a cada 24h).',
        { status: 401, code: 'UNAUTHORIZED' },
      );
    case 403:
      return new ApiError('Acesso negado pela Riot (chave revogada ou sem permissão).', {
        status: 403,
        code: 'FORBIDDEN',
      });
    case 404:
      return new ApiError('Recurso não encontrado na Riot.', { status: 404, code: 'NOT_FOUND' });
    default:
      return new ApiError(`Erro inesperado da Riot (HTTP ${status}).`, {
        status: status || 500,
        code: 'RIOT_ERROR',
      });
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa uma requisição GET à Riot respeitando o limiter.
 * @param {string} host  Ex.: "americas.api.riotgames.com" ou "br1.api.riotgames.com".
 * @param {string} path  Caminho iniciando em "/".
 */
async function request(host, path, { retries = 3 } = {}) {
  if (!config.apiKey) {
    throw new ApiError('RIOT_API_KEY não configurada no servidor (.env).', {
      status: 503,
      code: 'NO_API_KEY',
    });
  }

  const url = `https://${host}${path}`;

  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await limiter.run(() =>
        fetchWithTimeout(url, {
          headers: { 'X-Riot-Token': config.apiKey, Accept: 'application/json' },
        }),
      );
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new ApiError('Tempo esgotado ao falar com a Riot.', { status: 504, code: 'TIMEOUT' });
      }
      if (attempt <= retries) {
        await sleep(300 * attempt);
        continue;
      }
      throw new ApiError('Falha de rede ao falar com a Riot.', { status: 502, code: 'NETWORK' });
    }

    if (res.status === 429) {
      const retryAfterSec = Number(res.headers.get('retry-after'));
      const waitSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 5;
      limiter.pauseFor(waitSec * 1000);
      if (attempt <= retries) continue;
      throw new ApiError('Rate limit da Riot excedido. Tente novamente em instantes.', {
        status: 429,
        code: 'RATE_LIMITED',
      });
    }

    if (res.status >= 500) {
      if (attempt <= retries) {
        await sleep(300 * attempt);
        continue;
      }
      throw new ApiError('A Riot está instável no momento. Tente novamente.', {
        status: 502,
        code: 'RIOT_UNAVAILABLE',
      });
    }

    if (!res.ok) throw mapStatusError(res.status);

    return res.json();
  }
}

// Rota REGIONAL (americas/europe/asia/sea)
export async function getAccountByRiotId(regional, gameName, tagLine) {
  const path = `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  try {
    return await request(`${regional}.api.riotgames.com`, path);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      throw new ApiError(`Jogador "${gameName}#${tagLine}" não encontrado.`, {
        status: 404,
        code: 'PLAYER_NOT_FOUND',
      });
    }
    throw err;
  }
}

export async function getMatchIds(regional, puuid, { count, queue, type } = {}) {
  const params = new URLSearchParams();
  if (count != null) params.set('count', String(count));
  if (queue != null) params.set('queue', String(queue));
  if (type) params.set('type', type);
  const qs = params.toString();
  const path = `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids${qs ? `?${qs}` : ''}`;
  const data = await request(`${regional}.api.riotgames.com`, path);
  // Defesa: a Riot sempre devolve um array, mas nunca confie cegamente.
  return Array.isArray(data) ? data : [];
}

export async function getMatch(regional, matchId) {
  const path = `/lol/match/v5/matches/${encodeURIComponent(matchId)}`;
  return request(`${regional}.api.riotgames.com`, path);
}

// Rota PLATFORM (br1/na1/kr/...)
export async function getChampionMastery(platform, puuid, championId) {
  const path = `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/by-champion/${championId}`;
  try {
    return await request(`${platform}.api.riotgames.com`, path);
  } catch (err) {
    // 404 = o jogador não possui maestria registrada nesse campeão.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

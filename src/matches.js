// matches.js — regras de negócio: buscar partidas, agregar Top 10 e
// responder "última vez que joguei de X" (Abordagem A + fallback B).

import { config } from './config.js';
import { TTLCache } from './cache.js';
import { getChampionData, resolveChampion } from './dataDragon.js';
import {
  ApiError,
  getAccountByRiotId,
  getChampionMastery,
  getMatch,
  getMatchIds,
} from './riotClient.js';

const cache = new TTLCache({ ttlMs: config.cacheTtlMs, maxEntries: 300 });

/** Concorrência ao buscar detalhes de partidas (o limiter global também atua). */
const MATCH_FETCH_CONCURRENCY = 5;

/** Executa `fn` sobre `items` com concorrência limitada, preservando a ordem. */
async function mapWithConcurrency(items, limit, fn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Resolve o PUUID a partir do Riot ID (com cache). */
export async function resolvePlayer(region, gameName, tagLine) {
  const key = `puuid:${region.regional}:${gameName.toLowerCase()}#${tagLine.toLowerCase()}`;
  return cache.wrap(key, () => getAccountByRiotId(region.regional, gameName, tagLine), config.cacheTtlMs);
}

/** Extrai os dados relevantes do dono do PUUID em uma partida. */
function parseMatch(detail, puuid) {
  const info = detail?.info;
  const participant = info?.participants?.find((p) => p.puuid === puuid);
  if (!info || !participant) return null;
  return {
    matchId: detail.metadata?.matchId ?? null,
    championName: participant.championName, // id interno (ex.: "MonkeyKing")
    championId: participant.championId,
    win: Boolean(participant.win),
    gameCreation: info.gameCreation, // ms Unix
    gameDurationSec: info.gameDuration, // segundos (Match-V5)
    queueId: info.queueId,
    kills: participant.kills ?? 0,
    deaths: participant.deaths ?? 0,
    assists: participant.assists ?? 0,
  };
}

/**
 * Busca e analisa as partidas recentes de um jogador (com cache por jogador+params).
 * @returns {Promise<{account:object, puuid:string, matches:Array}>}
 */
export async function getAnalyzedMatches(region, gameName, tagLine, { count, queue }) {
  const account = await resolvePlayer(region, gameName, tagLine);
  const puuid = account.puuid;
  const key = `matches:${region.regional}:${puuid}:${count}:${queue ?? 'all'}`;

  return cache.wrap(
    key,
    async () => {
      const matchIds = await getMatchIds(region.regional, puuid, { count, queue });

      // Se não houver filtro de fila, descarta remakes curtos? Não — mantemos tudo,
      // mas erros pontuais de uma partida não derrubam o resultado inteiro.
      const details = await mapWithConcurrency(matchIds, MATCH_FETCH_CONCURRENCY, async (matchId) => {
        try {
          return await getMatch(region.regional, matchId);
        } catch {
          return null;
        }
      });

      const matches = details
        .filter(Boolean)
        .map((detail) => parseMatch(detail, puuid))
        .filter(Boolean);

      return { account, puuid, matches };
    },
    config.cacheTtlMs,
  );
}

/** Agrega os campeões mais jogados (Top N). */
export function aggregateTopChampions(matches, championData, limit = 10) {
  const stats = new Map();

  for (const match of matches) {
    const champion =
      championData.byInternalId.get(match.championName) ??
      { id: match.championName, name: match.championName, icon: null };

    const current = stats.get(match.championName) ?? {
      id: champion.id,
      name: champion.name,
      icon: champion.icon,
      games: 0,
      wins: 0,
    };

    current.games += 1;
    if (match.win) current.wins += 1;
    stats.set(match.championName, current);
  }

  return [...stats.values()]
    .map((champion) => ({
      ...champion,
      losses: champion.games - champion.wins,
      winrate: champion.games ? Math.round((champion.wins / champion.games) * 100) : 0,
    }))
    .sort((a, b) => b.games - a.games || b.winrate - a.winrate)
    .slice(0, limit);
}

/**
 * Responde "última vez que joguei de X".
 * 1) Procura nas partidas recentes (Abordagem A).
 * 2) Se não achar, consulta a Champion Mastery (Abordagem B) para resposta definitiva.
 */
export async function findLastPlayed(region, gameName, tagLine, championInput, { count, queue }) {
  const champion = await resolveChampion(championInput);
  if (!champion) {
    throw new ApiError(`Campeão "${championInput}" não encontrado.`, {
      status: 404,
      code: 'CHAMPION_NOT_FOUND',
    });
  }

  const { puuid, matches } = await getAnalyzedMatches(region, gameName, tagLine, { count, queue });

  const played = matches
    .filter((match) => match.championName === champion.id)
    .sort((a, b) => b.gameCreation - a.gameCreation);

  if (played.length > 0) {
    const last = played[0];
    return {
      champion,
      source: 'recent',
      searchedMatches: matches.length,
      timesInWindow: played.length,
      lastPlayed: {
        date: last.gameCreation,
        win: last.win,
        matchId: last.matchId,
        queueId: last.queueId,
        kills: last.kills,
        deaths: last.deaths,
        assists: last.assists,
        durationSec: last.gameDurationSec,
      },
    };
  }

  // Abordagem B — Champion Mastery (rota PLATFORM).
  let mastery = null;
  try {
    mastery = await getChampionMastery(region.platform, puuid, champion.championId);
  } catch {
    mastery = null;
  }

  if (mastery && mastery.lastPlayTime) {
    return {
      champion,
      source: 'mastery',
      searchedMatches: matches.length,
      timesInWindow: 0,
      lastPlayed: {
        date: mastery.lastPlayTime,
        win: null, // a Mastery não informa o resultado da partida
        masteryLevel: mastery.championLevel,
        masteryPoints: mastery.championPoints,
      },
    };
  }

  return { champion, source: 'never', searchedMatches: matches.length, timesInWindow: 0, lastPlayed: null };
}

export { getChampionData };

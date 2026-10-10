// dataDragon.js — dados estáticos de campeões (Data Dragon), com cache longo.
// Usado para: mapear nome -> championId (Champion Mastery) e exibir nomes/ícones.

import { TTLCache } from './cache.js';

const DD = 'https://ddragon.leagueoflegends.com';
const LOCALE = 'pt_BR';
const CHAMPION_TTL_MS = 12 * 60 * 60 * 1000; // 12h (muda só a cada patch)

const cache = new TTLCache({ ttlMs: CHAMPION_TTL_MS, maxEntries: 4 });

/**
 * Normaliza um nome de campeão para busca tolerante:
 * minúsculas, sem acentos e sem caracteres especiais.
 * Ex.: "Kai'Sa" -> "kaisa", "Dr. Mundo" -> "drmundo".
 */
export function normalizeChampionName(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Data Dragon falhou (HTTP ${res.status}) em ${url}`);
  return res.json();
}

/**
 * Retorna os dados de campeões indexados de várias formas.
 * @returns {Promise<{version:string, byInternalId:Map, byInput:Map, list:Array}>}
 *   - byInternalId: id interno (ex.: "MonkeyKing") -> entrada
 *   - byInput: nome normalizado -> entrada (para a busca do usuário)
 *   - list: lista ordenada por nome para autocomplete
 */
export async function getChampionData() {
  return cache.wrap(
    'champions',
    async () => {
      const versions = await fetchJson(`${DD}/api/versions.json`);
      const version = versions[0];
      const payload = await fetchJson(`${DD}/cdn/${version}/data/${LOCALE}/champion.json`);

      const byInternalId = new Map();
      const byInput = new Map();
      const list = [];

      for (const champ of Object.values(payload.data)) {
        const entry = {
          id: champ.id, // id interno usado pelo Match-V5 (ex.: "MonkeyKing")
          name: champ.name, // nome de exibição (ex.: "Wukong")
          championId: Number(champ.key), // id numérico (ex.: 62)
          icon: `${DD}/cdn/${version}/img/champion/${champ.id}.png`,
        };
        byInternalId.set(entry.id, entry);

        // Índices de busca: id interno, nome exibido e primeiro "pedaço" do nome
        // (ex.: "Nunu & Willump" -> "nunu").
        const keys = new Set([normalizeChampionName(entry.id), normalizeChampionName(entry.name)]);
        const firstChunk = normalizeChampionName(String(entry.name).split(/[\s(&]/)[0]);
        if (firstChunk) keys.add(firstChunk);
        for (const key of keys) {
          if (key && !byInput.has(key)) byInput.set(key, entry);
        }

        list.push(entry);
      }

      list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      return { version, byInternalId, byInput, list };
    },
    CHAMPION_TTL_MS,
  );
}

/** Resolve um termo digitado pelo usuário para a entrada de campeão. */
export async function resolveChampion(input) {
  const term = String(input ?? '').trim();
  if (!term) return null;
  const { byInternalId, byInput } = await getChampionData();
  return byInternalId.get(term) || byInput.get(normalizeChampionName(term)) || null;
}

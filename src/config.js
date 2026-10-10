// config.js — carregamento de ambiente, regiões, filas e constantes.
// Sem dependências externas: usa o suporte nativo do Node (>= 20.12 / 21.7).

import { existsSync, readFileSync } from 'node:fs';

/** Faz o parse de um arquivo .env simples (fallback caso process.loadEnvFile não exista). */
function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** Carrega o arquivo .env para process.env, sem sobrescrever variáveis já definidas. */
export function loadEnv(file = '.env') {
  if (!existsSync(file)) return;
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(file);
      return;
    }
    const parsed = parseEnvFile(readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (err) {
    console.warn(`[config] Não foi possível carregar "${file}": ${err.message}`);
  }
}

// Carrega o .env antes de ler as variáveis abaixo.
loadEnv();

const clamp = (n, min, max) => Math.min(Math.max(Number.isFinite(n) ? n : min, min), max);
const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Mapa de regiões: cada uma aponta para o host REGIONAL (Account-V1 / Match-V5)
 * e para o host PLATFORM (Champion-Mastery / Summoner / League).
 */
export const REGIONS = {
  BR: { label: 'Brasil (BR)', regional: 'americas', platform: 'br1' },
  NA: { label: 'América do Norte (NA)', regional: 'americas', platform: 'na1' },
  LAN: { label: 'Latinoamérica Norte (LAN)', regional: 'americas', platform: 'la1' },
  LAS: { label: 'Latinoamérica Sur (LAS)', regional: 'americas', platform: 'la2' },
  EUW: { label: 'Europa Oeste (EUW)', regional: 'europe', platform: 'euw1' },
  EUNE: { label: 'Europa Nórdica/Leste (EUNE)', regional: 'europe', platform: 'eun1' },
  TR: { label: 'Turquia (TR)', regional: 'europe', platform: 'tr1' },
  RU: { label: 'Rússia (RU)', regional: 'europe', platform: 'ru' },
  KR: { label: 'Coreia (KR)', regional: 'asia', platform: 'kr' },
  JP: { label: 'Japão (JP)', regional: 'asia', platform: 'jp1' },
  OCE: { label: 'Oceania (OCE)', regional: 'sea', platform: 'oc1' },
  PH: { label: 'Filipinas (PH)', regional: 'sea', platform: 'ph2' },
  SG: { label: 'Singapura (SG)', regional: 'sea', platform: 'sg2' },
  TH: { label: 'Tailândia (TH)', regional: 'sea', platform: 'th2' },
  TW: { label: 'Taiwan (TW)', regional: 'sea', platform: 'tw2' },
  VN: { label: 'Vietnã (VN)', regional: 'sea', platform: 'vn2' },
};

/** Filas oferecidas no dropdown. `null` = todas. */
export const QUEUES = [
  { id: 420, label: 'Ranqueada Solo/Duo' },
  { id: 440, label: 'Ranqueada Flex' },
  { id: 400, label: 'Normal Draft' },
  { id: 430, label: 'Normal Blind' },
  { id: 450, label: 'ARAM' },
  { id: 1700, label: 'Arena' },
];

export const DEFAULT_QUEUE = 420;

export const config = {
  port: toInt(process.env.PORT, 3000),
  apiKey: (process.env.RIOT_API_KEY || '').trim(),
  defaultRegion: (process.env.DEFAULT_REGION || 'BR').toUpperCase(),
  defaultMatchCount: clamp(toInt(process.env.DEFAULT_MATCH_COUNT, 20), 1, 100),
  maxMatchCount: clamp(toInt(process.env.MAX_MATCH_COUNT, 100), 1, 100),
  cacheTtlMs: clamp(toInt(process.env.CACHE_TTL_MS, 600000), 0, Number.MAX_SAFE_INTEGER),
  requestTimeoutMs: clamp(toInt(process.env.REQUEST_TIMEOUT_MS, 15000), 1000, 60000),
};

/** Limites da chave de desenvolvimento/pessoal da Riot (por região). */
export const RATE_LIMITS = [
  { max: 20, windowMs: 1000 },
  { max: 100, windowMs: 120000 },
];

// app.js — frontend (JS puro). Conversa apenas com o nosso backend em /api/*.

const $ = (selector) => document.querySelector(selector);

const els = {
  form: $('#form'),
  riotId: $('#riotId'),
  region: $('#region'),
  queue: $('#queue'),
  count: $('#count'),
  submitBtn: $('#submitBtn'),
  status: $('#status'),
  results: $('#results'),
  playerName: $('#playerName'),
  matchesInfo: $('#matchesInfo'),
  topChampions: $('#topChampions'),
  searchSection: $('#searchSection'),
  championSearch: $('#championSearch'),
  championList: $('#championList'),
  searchBtn: $('#searchBtn'),
  searchResult: $('#searchResult'),
};

const state = {
  config: null,
  lastPlayer: null, // { riotId, region, count, queue }
  loadingMatches: false,
  loadingSearch: false,
};

// ---------- utilitários ----------
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

function formatDate(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function formatDuration(seconds) {
  if (!seconds || seconds < 0) return null;
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

async function api(path) {
  const res = await fetch(path);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = data?.error || `Falha na requisição (HTTP ${res.status}).`;
    const error = new Error(message);
    error.code = data?.code;
    throw error;
  }
  return data;
}

function showStatus(kind, html) {
  const palette = {
    loading: 'border-lolborder text-slate-300',
    error: 'border-red-500/40 bg-red-500/10 text-red-200',
    info: 'border-lolborder text-slate-300',
  };
  els.status.className = `mt-5 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${palette[kind] || palette.info}`;
  const spinner = kind === 'loading' ? '<span class="spinner shrink-0"></span>' : '';
  els.status.innerHTML = `${spinner}<span>${html}</span>`;
  els.status.classList.remove('hidden');
}

function hideStatus() {
  els.status.classList.add('hidden');
}

function setBusy(which, busy) {
  state[which] = busy;
  els.submitBtn.disabled = state.loadingMatches;
  els.searchBtn.disabled = state.loadingSearch;
}

// ---------- inicialização ----------
async function boot() {
  try {
    state.config = await api('/api/config');
    fillRegions();
    fillQueues();
    fillCounts();
  } catch (err) {
    showStatus('error', `Não foi possível carregar a configuração: ${escapeHtml(err.message)}`);
  }

  // Lista de campeões para autocomplete (best-effort).
  api('/api/champions')
    .then((data) => {
      els.championList.innerHTML = (data.champions || [])
        .map((c) => `<option value="${escapeHtml(c.name)}"></option>`)
        .join('');
    })
    .catch(() => {});
}

function fillRegions() {
  const { regions = [], defaults } = state.config || {};
  els.region.innerHTML = regions
    .map((r) => `<option value="${escapeHtml(r.key)}">${escapeHtml(r.label)}</option>`)
    .join('');
  if (defaults?.region) els.region.value = defaults.region;
}

function fillQueues() {
  const { queues = [], defaults } = state.config || {};
  const options = [`<option value="all">Todas</option>`]
    .concat(queues.map((q) => `<option value="${q.id}">${escapeHtml(q.label)}</option>`))
    .join('');
  els.queue.innerHTML = options;
  if (defaults?.queue != null) els.queue.value = String(defaults.queue);
}

function fillCounts() {
  const max = state.config?.defaults?.maxCount ?? 100;
  const def = state.config?.defaults?.count ?? 20;
  const options = [...new Set([20, 50, 100, max].filter((n) => n <= max))].sort((a, b) => a - b);
  els.count.innerHTML = options.map((n) => `<option value="${n}">${n}</option>`).join('');
  els.count.value = String(def);
}

// ---------- análise principal ----------
function readForm() {
  const raw = els.riotId.value.trim();
  const hashIndex = raw.lastIndexOf('#');
  if (hashIndex <= 0 || hashIndex === raw.length - 1) {
    throw new Error('Digite o Riot ID no formato Nome#TAG (ex.: Faker#KR1).');
  }
  return {
    gameName: raw.slice(0, hashIndex).trim(),
    tagLine: raw.slice(hashIndex + 1).trim(),
    region: els.region.value,
    queue: els.queue.value,
    count: els.count.value,
  };
}

function renderTopChampions(data) {
  els.playerName.textContent = `${data.player.gameName}#${data.player.tagLine}`;
  const queueLabel =
    data.queue == null
      ? 'todas as filas'
      : state.config?.queues?.find((q) => q.id === data.queue)?.label || `fila ${data.queue}`;
  els.matchesInfo.textContent = `${data.matchesAnalyzed} partidas analisadas · ${queueLabel} · ${data.region}`;

  if (!data.topChampions.length) {
    els.topChampions.innerHTML = `<p class="col-span-full text-sm text-slate-400">Nenhuma partida encontrada para os filtros escolhidos.</p>`;
    return;
  }

  els.topChampions.innerHTML = data.topChampions
    .map((c) => {
      const icon = c.icon
        ? `<img src="${escapeHtml(c.icon)}" alt="${escapeHtml(c.name)}" loading="lazy"
             class="mx-auto h-14 w-14 rounded-full ring-2 ring-lolborder"
             onerror="this.style.visibility='hidden'" />`
        : `<div class="mx-auto h-14 w-14 rounded-full bg-lolborder"></div>`;
      return `
        <div class="rounded-xl border border-lolborder bg-lolcard/70 p-3 text-center">
          ${icon}
          <div class="mt-2 truncate text-sm font-semibold" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
          <div class="mt-1 text-xs text-slate-400">${c.games} jogo(s) · ${c.winrate}% WR</div>
          <div class="winrate-bar mt-2"><span style="width:${c.winrate}%"></span></div>
        </div>`;
    })
    .join('');
}

async function onAnalyze(event) {
  event.preventDefault();
  if (state.loadingMatches) return;

  let payload;
  try {
    payload = readForm();
  } catch (err) {
    showStatus('error', escapeHtml(err.message));
    return;
  }

  state.lastPlayer = payload;
  els.results.classList.add('hidden');
  els.searchSection.classList.add('hidden');
  els.searchResult.innerHTML = '';
  setBusy('loadingMatches', true);
  showStatus('loading', 'Buscando e analisando as partidas… isso pode levar alguns segundos.');

  try {
    const params = new URLSearchParams({
      region: payload.region,
      gameName: payload.gameName,
      tagLine: payload.tagLine,
      count: payload.count,
      queue: payload.queue,
    });
    const data = await api(`/api/painel?${params}`);
    renderTopChampions(data);
    els.results.classList.remove('hidden');
    els.searchSection.classList.remove('hidden');
    hideStatus();
  } catch (err) {
    showStatus('error', escapeHtml(err.message));
  } finally {
    setBusy('loadingMatches', false);
  }
}

// ---------- busca por campeão ----------
function renderSearchResult(data) {
  const championName = escapeHtml(data.champion.name);
  const icon = data.champion.icon
    ? `<img src="${escapeHtml(data.champion.icon)}" alt="${championName}"
         class="h-12 w-12 rounded-full ring-2 ring-lolborder" onerror="this.style.visibility='hidden'" />`
    : '';

  if (data.source === 'recent' && data.lastPlayed) {
    const lp = data.lastPlayed;
    const result = lp.win
      ? '<span class="font-semibold text-emerald-400">Vitória</span>'
      : '<span class="font-semibold text-red-400">Derrota</span>';
    const duration = formatDuration(lp.durationSec);
    const kda = `${lp.kills ?? 0}/${lp.deaths ?? 0}/${lp.assists ?? 0}`;
    els.searchResult.innerHTML = `
      <div class="flex items-center gap-4 rounded-xl border border-lolborder bg-lolbg/60 p-4">
        ${icon}
        <div>
          <div class="text-slate-300">Última vez que você jogou de <span class="font-semibold text-goldsoft">${championName}</span>:</div>
          <div class="mt-1 text-lg font-semibold">${escapeHtml(formatDate(lp.date))}</div>
          <div class="mt-1 text-xs text-slate-400">
            ${result} · KDA ${kda}${duration ? ` · ${duration}` : ''} ·
            ${data.timesInWindow} jogo(s) nas ${data.searchedMatches} partidas analisadas
          </div>
        </div>
      </div>`;
    return;
  }

  if (data.source === 'mastery' && data.lastPlayed) {
    els.searchResult.innerHTML = `
      <div class="flex items-center gap-4 rounded-xl border border-lolborder bg-lolbg/60 p-4">
        ${icon}
        <div>
          <div class="text-slate-300">
            <span class="font-semibold text-goldsoft">${championName}</span> não aparece nas
            ${data.searchedMatches} partidas analisadas, mas a Maestria indica:
          </div>
          <div class="mt-1 text-lg font-semibold">${escapeHtml(formatDate(data.lastPlayed.date))}</div>
          <div class="mt-1 text-xs text-slate-400">
            Maestria nível ${data.lastPlayed.masteryLevel ?? '?'} ·
            ${Number(data.lastPlayed.masteryPoints || 0).toLocaleString('pt-BR')} pts ·
            resultado da partida indisponível via Maestria
          </div>
        </div>
      </div>`;
    return;
  }

  els.searchResult.innerHTML = `
    <div class="flex items-center gap-4 rounded-xl border border-lolborder bg-lolbg/60 p-4">
      ${icon}
      <div class="text-slate-300">
        Você <span class="font-semibold">nunca jogou</span> de
        <span class="font-semibold text-goldsoft">${championName}</span>
        (considerando as partidas analisadas e a Maestria).
      </div>
    </div>`;
}

async function onSearch() {
  if (state.loadingSearch) return;
  const champion = els.championSearch.value.trim();
  if (!champion) {
    els.searchResult.innerHTML = '<span class="text-red-300">Digite o nome de um campeão.</span>';
    return;
  }
  if (!state.lastPlayer) {
    els.searchResult.innerHTML =
      '<span class="text-slate-400">Analise um Riot ID antes de buscar um campeão.</span>';
    return;
  }

  setBusy('loadingSearch', true);
  els.searchResult.innerHTML = '<span class="inline-flex items-center gap-2 text-slate-400"><span class="spinner"></span> Procurando…</span>';

  try {
    const params = new URLSearchParams({
      region: state.lastPlayer.region,
      gameName: state.lastPlayer.gameName,
      tagLine: state.lastPlayer.tagLine,
      count: state.lastPlayer.count,
      queue: state.lastPlayer.queue,
      champion,
    });
    const data = await api(`/api/last-played?${params}`);
    renderSearchResult(data);
  } catch (err) {
    els.searchResult.innerHTML = `<span class="text-red-300">${escapeHtml(err.message)}</span>`;
  } finally {
    setBusy('loadingSearch', false);
  }
}

// ---------- eventos ----------
els.form.addEventListener('submit', onAnalyze);
els.searchBtn.addEventListener('click', onSearch);
els.championSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    onSearch();
  }
});

boot();

# Painel de Dados Pessoais — LoL

Aplicação web que mostra **seus campeões mais jogados** e **quando você jogou de cada campeão pela última vez**, usando a [Riot Games API](https://developer.riotgames.com).

Digite seu Riot ID (`Nome#TAG`), escolha a região e a fila, e o app busca suas partidas recentes para montar o Top 10 e responder consultas por campeão.

---

## Funcionalidades

- 🔎 Busca por **Riot ID** (`Nome#TAG`)
- 🏆 **Top 10 campeões mais jogados** nas últimas N partidas (com taxa de vitória)
- 🕹️ Busca **"quando joguei de X?"** com **data + resultado** da partida
- 🌎 Suporte a **todas as regiões** e **filtro por fila** (Ranqueada, Normal, ARAM…)
- ⚡ **Cache** e **rate limiting** embutidos
- 🔒 A chave da API fica **somente no servidor**

## Requisitos

- **Node.js 20.12 ou superior** — nada mais.
- Uma **chave da Riot Games API** (veja abaixo).

> O projeto **não usa dependências externas** (nem `express`, nem `dotenv`, nem `axios`).
> Ou seja: **não precisa rodar `npm install`**.

---

## Instalação

```bash
git clone git@github.com:Pradolp/lol-champion-dashboard-.git
cd lol-champion-dashboard-

# crie o arquivo de ambiente a partir do modelo
cp .env.example .env
```

Abra o `.env` e cole sua chave:

```env
RIOT_API_KEY=RGAPI-sua-chave-aqui
```

> **Como obter a chave:** acesse <https://developer.riotgames.com>, faça login e copie a **Development API Key**.
> ⚠️ A chave de desenvolvimento **expira a cada 24 horas** — quando o app reclamar, gere uma nova e atualize o `.env`.

## Como rodar

```bash
npm start
```

Depois abra: **<http://localhost:3000>**

Para desenvolvimento (reinicia sozinho ao salvar):

```bash
npm run dev
```

## Como usar

1. Digite o **Riot ID** no formato `Nome#TAG` (ex.: `Faker#KR1`).
2. Escolha a **região** (para o Brasil, `Brasil (BR)`).
3. Escolha a **fila** e quantas **partidas analisar**.
4. Clique em **Analisar** → aparece o **Top 10**.
5. Na seção **"Quando joguei de…?"**, digite um campeão e clique em **Buscar**.

---

## Estrutura do projeto

```
Projeto-League/
├── README.md
├── package.json
├── .env.example          # modelo das variáveis de ambiente
├── .gitignore
├── public/               # frontend (HTML + Tailwind CDN + JS puro)
│   ├── index.html
│   └── app.js
├── src/                  # backend (Node sem dependências)
│   ├── server.js         # servidor HTTP + rotas /api/*
│   ├── config.js         # regiões, filas e variáveis de ambiente
│   ├── matches.js        # Top 10 + "última vez" (Abordagem A + B)
│   ├── riotClient.js     # cliente da Riot (retry, erros, Retry-After)
│   ├── dataDragon.js     # dados estáticos de campeões (Data Dragon)
│   ├── rateLimiter.js    # limitador de taxa global
│   └── cache.js          # cache em memória com TTL
└── docs/                 # documentação interna (não versionada)
    ├── AGENT.md
    ├── DEPENDENCIAS_MANUAIS.md
    └── document.md
```

---

## Configuração (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `RIOT_API_KEY` | — | **Obrigatória.** Chave da Riot Games API. |
| `PORT` | `3000` | Porta do servidor. |
| `DEFAULT_REGION` | `BR` | Região já selecionada no dropdown. |
| `DEFAULT_MATCH_COUNT` | `20` | Quantas partidas são analisadas por padrão. |
| `MAX_MATCH_COUNT` | `100` | Limite máximo permitido pelo servidor. |
| `CACHE_TTL_MS` | `600000` | Tempo de cache em ms (10 min). |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout de cada chamada à Riot (ms). |

---

## Como funciona

```
[Navegador]  ──►  [Backend / Proxy]  ──►  Riot Account-V1 / Match-V5 (rota regional)
                   (chave + cache +             Champion-Mastery (rota platform)
                    rate limiter)               Data Dragon (dados de campeões)
```

O navegador **nunca** fala direto com a Riot: a Riot API não envia CORS e a chave seria exposta. Todo o tráfego passa pelo backend.

A busca "última vez que joguei de X" usa duas abordagens:
- **A (principal):** procura o campeão nas partidas já analisadas (rápido).
- **B (fallback):** se não achar, consulta a **Champion Mastery** para saber a última vez, mesmo que seja antiga.

---

## Notas técnicas

- **Rate limit (chave dev):** 20 req/s e 100 req/2min por região. Analisar 100 partidas consome quase todo o orçamento de 2 minutos — por isso o padrão é 20. O servidor já limita e respeita o `Retry-After`.
- **Cache:** em memória (10 min). Em ambiente **serverless** a memória não é compartilhada entre instâncias — nesse caso, use um cache externo (ex.: Redis/Upstash).
- **Segurança:** nunca comite o `.env`. A chave é lida do ambiente do servidor.

## Produção

Para abrir o app ao público é necessário solicitar uma **Production API Key** (aprovação no portal da Riot) — a chave de desenvolvimento não pode ser usada em produtos públicos. Além disso: hospedar o backend, configurar a chave como *secret* e usar HTTPS.

---

## Aviso legal

Este projeto não é endossado pela Riot Games e não reflete os pontos de vista ou opiniões da Riot Games ou de qualquer pessoa oficialmente envolvida na produção ou gerenciamento das propriedades da Riot Games. Riot Games e todas as propriedades associadas são marcas comerciais ou marcas registradas da Riot Games, Inc. League of Legends © Riot Games, Inc.

Projeto de uso pessoal/educacional.

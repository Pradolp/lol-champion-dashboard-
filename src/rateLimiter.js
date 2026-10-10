// rateLimiter.js — limitador de taxa global (janela deslizante) + concorrência.
// Garante que todas as chamadas à Riot passem pelos mesmos limites, e respeita
// o header Retry-After (via pauseFor) quando a Riot responde 429.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  /**
   * @param {object} options
   * @param {{max:number, windowMs:number}[]} options.limits  Limites por janela.
   * @param {number} [options.maxConcurrent]  Máximo de requisições simultâneas.
   * @param {number} [options.buffer]  Fator de segurança (0..1) aplicado aos limites.
   */
  constructor({ limits, maxConcurrent = 8, buffer = 0.9 } = {}) {
    this.limits = limits.map((l) => ({
      max: Math.max(1, Math.floor(l.max * buffer)),
      windowMs: l.windowMs,
    }));
    this.maxConcurrent = maxConcurrent;
    this.active = 0;
    this.hits = this.limits.map(() => []);
    this.pausedUntil = 0;
  }

  _prune(now) {
    for (let i = 0; i < this.limits.length; i++) {
      const { windowMs } = this.limits[i];
      const arr = this.hits[i];
      while (arr.length && arr[0] <= now - windowMs) arr.shift();
    }
  }

  /** Quanto tempo (ms) precisamos esperar antes de poder disparar. */
  _waitTime(now) {
    let wait = 0;
    if (now < this.pausedUntil) wait = Math.max(wait, this.pausedUntil - now);
    for (let i = 0; i < this.limits.length; i++) {
      const { max, windowMs } = this.limits[i];
      const arr = this.hits[i];
      if (arr.length >= max) {
        wait = Math.max(wait, arr[0] + windowMs - now);
      }
    }
    return wait;
  }

  _record(now) {
    for (const arr of this.hits) arr.push(now);
  }

  /** Espera até haver uma vaga (concorrência + taxa) e a reserva de forma atômica. */
  async acquire() {
    for (;;) {
      const now = Date.now();
      this._prune(now);

      if (this.active >= this.maxConcurrent) {
        await sleep(10);
        continue;
      }

      const wait = this._waitTime(now);
      if (wait > 0) {
        await sleep(Math.min(wait, 500));
        continue;
      }

      this._record(now);
      this.active += 1;
      return;
    }
  }

  release() {
    this.active = Math.max(0, this.active - 1);
  }

  /** Pausa todas as requisições por `ms` (usado ao receber 429 / Retry-After). */
  pauseFor(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + Math.max(0, ms));
  }

  /** Executa `task` respeitando os limites. */
  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

// cache.js — cache em memória com TTL.
// Observação: em ambiente serverless o cache em memória NÃO é compartilhado
// entre instâncias e se perde no cold start (ver docs/AGENT.md / docs/DEPENDENCIAS_MANUAIS.md).

export class TTLCache {
  constructor({ ttlMs = 600000, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.maxEntries) {
      // Descarta a entrada mais antiga (o Map preserva a ordem de inserção).
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /** Retorna o valor em cache ou executa `factory()` e guarda o resultado. */
  async wrap(key, factory, ttlMs = this.ttlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  clear() {
    this.store.clear();
  }
}

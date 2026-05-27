/**
 * Circuit Breaker — padrão de resiliência para chamadas de IA.
 *
 * Estados:
 *   CLOSED    → chamadas fluem normalmente
 *   OPEN      → após N falhas consecutivas, bloqueia chamadas por cooldownMs
 *   HALF_OPEN → após cooldown, permite 1 chamada teste; sucesso → CLOSED, falha → OPEN
 */
(function () {
    'use strict';

    const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

    class CircuitBreaker {
        /**
         * @param {Function} fn              — função assíncrona a ser protegida
         * @param {Object}   options
         * @param {number}   options.maxFailures  — falhas consecutivas para abrir (default 3)
         * @param {number}   options.cooldownMs   — tempo em OPEN antes de HALF_OPEN (default 10000)
         * @param {Function} options.fallback     — chamada quando circuito está OPEN (recebe mesmos args)
         * @param {string}   options.name         — nome para logging
         */
        constructor(fn, options = {}) {
            this._fn = fn;
            this._maxFailures = options.maxFailures ?? 3;
            this._cooldownMs = options.cooldownMs ?? 10000;
            this._fallback = options.fallback;
            this._name = options.name || 'unnamed';

            this._state = STATE.CLOSED;
            this._failureCount = 0;
            this._nextAttempt = 0;
        }

        get state() { return this._state; }
        get failureCount() { return this._failureCount; }

        async call(...args) {
            const now = Date.now();

            if (this._state === STATE.OPEN) {
                if (now >= this._nextAttempt) {
                    this._state = STATE.HALF_OPEN;
                    console.log(`[CircuitBreaker:${this._name}] OPEN → HALF_OPEN`);
                } else {
                    if (this._fallback) return this._fallback(...args);
                    throw new Error(`CircuitBreaker: ${this._name} OPEN (${this._nextAttempt - now}ms restantes)`);
                }
            }

            try {
                const result = await this._fn(...args);
                this._onSuccess();
                return result;
            } catch (err) {
                this._onFailure();
                throw err;
            }
        }

        _onSuccess() {
            this._failureCount = 0;
            if (this._state === STATE.HALF_OPEN) {
                console.log(`[CircuitBreaker:${this._name}] HALF_OPEN → CLOSED`);
            }
            this._state = STATE.CLOSED;
        }

        _onFailure() {
            this._failureCount++;
            if (this._state === STATE.HALF_OPEN || this._failureCount >= this._maxFailures) {
                this._state = STATE.OPEN;
                this._nextAttempt = Date.now() + this._cooldownMs;
                console.log(`[CircuitBreaker:${this._name}] → OPEN (${this._failureCount} falhas, cooldown ${this._cooldownMs}ms)`);
            }
        }

        reset() {
            this._state = STATE.CLOSED;
            this._failureCount = 0;
            this._nextAttempt = 0;
        }
    }

    window.CircuitBreaker = CircuitBreaker;
})();

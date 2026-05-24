const path = require('path');
const fs = require('fs');

/**
 * AI Predictor Lite
 * Agora o processamento pesado é feito no servidor Python nativo
 * para evitar travar o event loop do Node.js.
 */
class FeedbackPredictor {
    constructor() {
        this.pythonUrl = '';
        this.apiKey = '';
    }

    async init() {
        const PYTHON_PORT = parseInt(process.env.PYTHON_PORT || '3002', 10);
        this.pythonUrl = `http://127.0.0.1:${PYTHON_PORT}/analyze-feedback`;
        this.apiKey = process.env.AI_API_KEY || '';

        if (!this.apiKey) {
            console.warn('[AI Predictor] Aviso: AI_API_KEY não configurada. A comunicação com o servidor Python pode falhar em produção.');
        }
        console.log(`[AI Predictor] Operando em modo Remoto (Offloading para Python na porta ${PYTHON_PORT}).`);
    }

    /**
     * Envia dados para o Python analisar o risco
     */
    async predictRisk(freq, db, prevDb, gain) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
            const res = await fetch(this.pythonUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({ freq, db, prevDb, gain }),
                signal: controller.signal
            });
            clearTimeout(timeout);
            const data = await res.json();
            return data.risk || 0;
        } catch (e) {
            clearTimeout(timeout);
            // Em caso de erro ou timeout, retorna risco zero para não travar
            return 0;
        }
    }


}

module.exports = new FeedbackPredictor();

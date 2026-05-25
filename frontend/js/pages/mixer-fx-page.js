/**
 * SoundMaster — Mixer FX Page Module
 * Controls the 4 Lexicon FX engines, levels, types, BPMs, and TAP buttons.
 */

'use strict';

(function () {
    const pm = createPageModule();

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const fxTypes = ['Reverb', 'Delay', 'Chorus', 'Room'];
    const _fxDebounce = {};

    function renderFXEngines() {
        const container = pm._el('mixer-fx-container');
        if (!container) return;

        container.innerHTML = '';
        for (let i = 1; i <= 4; i++) {
            const fxCard = document.createElement('div');
            fxCard.className = 'bg-slate-900/60 border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col gap-6 group hover:border-cyan-500/30 transition-all';
            fxCard.innerHTML = `
                <div class="flex items-center justify-between">
                    <span class="text-[10px] font-black text-cyan-400 uppercase tracking-widest">Engine Lexicon ${i}</span>
                    <span id="fx-type-${i}" class="text-[9px] font-bold text-slate-500 uppercase">${esc(fxTypes[i - 1])}</span>
                </div>
                
                <div class="flex gap-4 items-center">
                    <div class="h-48 w-10 bg-black/40 rounded-xl relative flex items-center justify-center border border-white/5 overflow-hidden">
                        <input type="range" id="fx-level-${i}" min="0" max="100" value="50" 
                               class="fader-vertical text-cyan-500" orient="vertical">
                    </div>
                    <div class="flex-1 space-y-4">
                        <div class="bg-black/20 p-3 rounded-xl border border-white/5">
                            <label class="text-[9px] uppercase font-bold text-slate-500 mb-1 block">Volume de Retorno</label>
                            <div class="flex items-end gap-1">
                                <span id="fx-val-${i}" class="text-xl font-black text-white">50</span>
                                <span class="text-[10px] text-slate-500 mb-1">%</span>
                            </div>
                        </div>
                        <div class="bg-black/20 p-3 rounded-xl border border-white/5">
                            <label class="text-[9px] uppercase font-bold text-slate-500 mb-2 block">Tempo / BPM</label>
                            <div class="flex gap-2">
                                <input type="number" id="fx-bpm-${i}" value="120" min="40" max="300" 
                                       class="w-full bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-cyan-400 font-mono text-center focus:border-cyan-500 outline-none">
                                <button id="fx-tap-${i}" class="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-black rounded-lg transition-all">TAP</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            container.appendChild(fxCard);

            // Bind Event Listeners
            const levelInput = pm._el(`fx-level-${i}`);
            if (levelInput) {
                pm._on(levelInput, 'pointerdown', (e) => {
                    const val = Number(e.target.value) / 100;
                    if (window.SocketService) SocketService.lockFader(`fx_${i}`, val);
                });
                pm._on(levelInput, 'input', (e) => {
                    const val = e.target.value;
                    const valText = pm._el(`fx-val-${i}`);
                    if (valText) valText.innerText = val;
                });
                pm._on(levelInput, 'change', (e) => {
                    const val = Number(e.target.value) / 100;
                    MixerService.sendRaw(`SETD|f|${i - 1}|mix|${val}`);
                    clearTimeout(_fxDebounce[i]);
                    _fxDebounce[i] = setTimeout(() => {
                        if (window.SocketService) SocketService.unlockFader(`fx_${i}`);
                    }, 300);
                });
            }

            const bpmInput = pm._el(`fx-bpm-${i}`);
            if (bpmInput) {
                pm._on(bpmInput, 'change', (e) => {
                    MixerService.setFxBpm(i, e.target.value);
                });
            }

            const tapBtn = pm._el(`fx-tap-${i}`);
            if (tapBtn) {
                pm._on(tapBtn, 'click', () => {
                    const input = pm._el(`fx-bpm-${i}`);
                    if (input) {
                        const next = (parseInt(input.value) || 120) + 5;
                        input.value = next > 180 ? 80 : next;
                        MixerService.setFxBpm(i, input.value);
                    }
                });
            }

            // Subscriptions
            pm._subscribe('AppStore', `fx_${i}_level`, (level) => {
                if (window.SocketService && window.SocketService.isFaderLocked(`fx_${i}`)) return;
                const fader = pm._el(`fx-level-${i}`);
                const valText = pm._el(`fx-val-${i}`);
                const pct = Math.round((level || 0) * 100);
                if (fader) fader.value = pct;
                if (valText) valText.innerText = pct;
            });

            pm._subscribe('AppStore', `fx_${i}_bpm`, (bpm) => {
                const input = pm._el(`fx-bpm-${i}`);
                if (input) input.value = bpm || 120;
            });
        }
    }

    function init() {
        renderFXEngines();
    }

    function destroy() {
        Object.keys(_fxDebounce).forEach(function (k) { clearTimeout(_fxDebounce[k]); delete _fxDebounce[k]; });
        pm.destroy();
    }

    window.MixerFxPage = {
        init: init,
        destroy: destroy
    };
})();

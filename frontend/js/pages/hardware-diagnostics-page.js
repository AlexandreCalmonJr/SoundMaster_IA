'use strict';
(function () {
    var pm = createPageModule();
    var _snapshots = [];
    var _diagHistory = [];

    function _el(id) { return pm._el(id); }
    function _setStatus(msg, type) {
        var el = _el('hd-status');
        if (el) { el.textContent = msg; el.className = 'text-xs mb-4 min-h-[18px] ' + (type || ''); }
    }

    function _getSpectrumSnapshot() {
        var analyzer = window.SoundMasterAnalyzer;
        if (!analyzer || !analyzer.isAnalyzing()) return null;
        var snap = analyzer.getFreqData();
        if (!snap || !snap.data) return null;
        var spectrum = {};
        for (var i = 0; i < snap.data.length; i++) {
            var hz = i * snap.sampleRate / snap.fftSize;
            spectrum[Math.round(hz)] = Math.round(snap.data[i] * 10) / 10;
        }
        return {
            timestamp: new Date().toISOString(),
            spectrum_db: spectrum,
            sampleRate: snap.sampleRate,
            fftSize: snap.fftSize
        };
    }

    function _saveSnapshot() {
        var snapshot = _getSpectrumSnapshot();
        if (!snapshot) {
            _setStatus('❌ Ative o microfone primeiro.', 'err');
            return;
        }
        var ch = _el('hd-channel-select') ? parseInt(_el('hd-channel-select').value) : 1;
        snapshot.channel = ch;
        _snapshots.push(snapshot);
        if (_snapshots.length > 50) _snapshots.shift();
        _renderSnapshots();
        _setStatus('✅ Snapshot salvo para canal ' + ch + ' (' + _snapshots.length + ' total).', 'ok');
        localStorage.setItem('hd-snapshots', JSON.stringify(_snapshots));
    }

    function _renderSnapshots() {
        var list = _el('hd-snapshots-list');
        if (!list) return;
        if (_snapshots.length === 0) {
            list.innerHTML = '<div class="text-center py-4 text-slate-600">Nenhum snapshot salvo.</div>';
            return;
        }
        list.innerHTML = _snapshots.map(function (s, i) {
            var d = new Date(s.timestamp);
            return '<div class="flex items-center justify-between bg-black/20 border border-white/5 rounded px-2 py-1">' +
                '<span class="text-[10px] text-slate-400">#' + (i + 1) + ' Ch' + s.channel + ' — ' + d.toLocaleTimeString() + '</span>' +
                '<span class="text-[9px] text-cyan-400 font-mono">' + Object.keys(s.spectrum_db).length + ' bins</span></div>';
        }).join('');
    }

    async function _runDiagnosis() {
        if (_snapshots.length < 3) {
            _setStatus('❌ Mínimo de 3 snapshots necessários para diagnóstico. Atuais: ' + _snapshots.length, 'err');
            return;
        }
        _setStatus('🔍 Analisando hardware com IA...', '');
        var ch = _el('hd-channel-select') ? parseInt(_el('hd-channel-select').value) : 1;
        var result = null;
        if (window.AIService && typeof AIService.hardwareDiagnosis === 'function') {
            result = await AIService.hardwareDiagnosis('Canal ' + ch, _snapshots);
        }
        if (!result) {
            _setStatus('⚠️ IA offline. Usando diagnóstico local.', 'warn');
            result = _localDiagnosis(ch);
        }
        _renderDiagnosis(result);
    }

    function _localDiagnosis(channel) {
        if (_snapshots.length < 3) return null;
        var recent = _snapshots.slice(-5);
        var hfDrift = 0, hfCount = 0;
        var baseline = _snapshots[0];
        var latest = recent[recent.length - 1];
        for (var hzStr in latest.spectrum_db) {
            var hz = parseInt(hzStr);
            if (hz > 4000 && baseline.spectrum_db[hzStr] !== undefined) {
                var drift = latest.spectrum_db[hzStr] - baseline.spectrum_db[hzStr];
                hfDrift += drift;
                hfCount++;
            }
        }
        var avgHfDrift = hfCount > 0 ? hfDrift / hfCount : 0;
        var code = 'NORMAL', severity = 'ok', confidence = 0.95;
        var summary = 'Sem anomalias detectadas.';
        var recommendations = ['Monitoramento contínuo recomendado.'];
        if (avgHfDrift < -3) {
            code = 'CABO_DEGRADADO'; severity = 'critical';
            summary = 'Perda HF progressiva detectada (>3dB em altas frequências)';
            recommendations = ['Substituir cabo de sinal do microfone.', 'Verificar conectores XLR quanto à oxidação.'];
            confidence = 0.85;
        } else if (avgHfDrift < -1.5) {
            code = 'CONECTOR_OXIDADO'; severity = 'warn';
            summary = 'Perda moderada em altas frequências. Possível oxidação de conector.';
            recommendations = ['Limpar conectores com contato limpo.', 'Verificar crimpagem dos cabos.'];
            confidence = 0.75;
        }
        return { channel: 'Canal ' + channel, code: code, severity: severity, confidence: confidence, summary: summary, recommendations: recommendations, bands: [], stats: { snapshots: _snapshots.length } };
    }

    function _renderDiagnosis(result) {
        if (!result) { _setStatus('❌ Não foi possível gerar diagnóstico.', 'err'); return; }
        _diagHistory.push(result);
        var container = _el('hd-result');
        if (!container) return;
        container.classList.remove('hidden');

        var iconMap = { 'NORMAL': '✅', 'CABO_DEGRADADO': '🔴', 'CONECTOR_OXIDADO': '🟡', 'CAPSULA_DESGASTE': '🟠' };
        var severityColors = { 'ok': 'text-green-400', 'warn': 'text-amber-400', 'critical': 'text-red-400' };

        _el('hd-diagnosis-icon').textContent = iconMap[result.code] || '❓';
        _el('hd-diagnosis-code').textContent = result.code;
        _el('hd-diagnosis-code').className = 'text-lg font-black ' + (severityColors[result.severity] || 'text-white');
        _el('hd-diagnosis-summary').textContent = result.summary || 'Sem informações';
        _el('hd-confidence').textContent = Math.round((result.confidence || 0) * 100) + '%';

        var recEl = _el('hd-recommendations');
        if (recEl) {
            recEl.innerHTML = '';
            if (result.recommendations && result.recommendations.length) {
                result.recommendations.forEach(function (r) {
                    var div = document.createElement('div');
                    div.className = 'flex items-center gap-2';
                    div.innerHTML = '<span class="text-cyan-400">→</span> ' + r;
                    recEl.appendChild(div);
                });
            } else {
                recEl.innerHTML = '<div class="text-slate-500">Nenhuma recomendação.</div>';
            }
        }

        var bandsEl = _el('hd-bands-container');
        if (bandsEl && result.bands && result.bands.length) {
            bandsEl.innerHTML = result.bands.map(function (b) {
                var driftColor = b.drift_db > 0 ? 'text-green-400' : 'text-red-400';
                return '<div class="bg-black/30 border border-white/10 rounded-xl p-2 text-center">' +
                    '<div class="text-[10px] text-slate-500">' + b.hz + ' Hz</div>' +
                    '<div class="text-sm font-black ' + driftColor + '">' + (b.drift_db > 0 ? '+' : '') + b.drift_db.toFixed(1) + ' dB</div>' +
                    '<div class="text-[8px] text-slate-600">drift</div></div>';
            }).join('');
        } else if (bandsEl) {
            bandsEl.innerHTML = '<div class="col-span-full text-center text-slate-500 text-xs py-4">Dados de banda não disponíveis.</div>';
        }

        _setStatus('✅ Diagnóstico concluído: ' + result.code, 'ok');
        _drawTrendChart();
    }

    function _drawTrendChart() {
        var canvas = _el('hd-trend-canvas');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);
        if (_snapshots.length < 2) {
            ctx.fillStyle = 'rgba(148,163,184,0.5)';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Aguardando mais snapshots...', w / 2, h / 2);
            return;
        }
        var pad = { top: 10, bottom: 20, left: 35, right: 10 };
        var plotW = w - pad.left - pad.right;
        var plotH = h - pad.top - pad.bottom;
        var freqs = [125, 500, 1000, 4000, 8000];
        var colors = ['#22d3ee', '#facc15', '#4ade80', '#f87171', '#a78bfa'];
        freqs.forEach(function (freq, fi) {
            var values = _snapshots.map(function (s) {
                var nearest = Object.keys(s.spectrum_db).reduce(function (a, b) {
                    return Math.abs(parseInt(a) - freq) < Math.abs(parseInt(b) - freq) ? a : b;
                });
                return s.spectrum_db[nearest] || -100;
            });
            if (values.length < 2) return;
            var minV = Math.min.apply(null, values);
            var maxV = Math.max.apply(null, values);
            var range = Math.max(maxV - minV, 10);
            ctx.strokeStyle = colors[fi % colors.length];
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            values.forEach(function (v, i) {
                var x = pad.left + (i / (values.length - 1)) * plotW;
                var y = pad.top + plotH - ((v - minV) / range) * plotH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            var labelX = pad.left + plotW + 3;
            var labelY = pad.top + (fi / freqs.length) * plotH;
            ctx.fillStyle = colors[fi % colors.length];
            ctx.font = '8px monospace';
            ctx.textAlign = 'left';
            ctx.fillText((freq >= 1000 ? (freq / 1000) + 'k' : freq) + ' Hz', labelX, labelY);
        });
        ctx.fillStyle = 'rgba(148,163,184,0.3)';
        ctx.font = '8px monospace';
        ctx.textAlign = 'center';
        for (var i = 0; i < _snapshots.length; i++) {
            var x = pad.left + (i / Math.max(_snapshots.length - 1, 1)) * plotW;
            ctx.fillText('#' + (i + 1), x, h - 4);
        }
    }

    function _clearHistory() {
        _snapshots = [];
        _diagHistory = [];
        localStorage.removeItem('hd-snapshots');
        _renderSnapshots();
        var container = _el('hd-result');
        if (container) container.classList.add('hidden');
        var canvas = _el('hd-trend-canvas');
        if (canvas) { var ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
        _setStatus('🗑 Histórico limpo.', 'ok');
    }

    function _initCanvas() {
        var canvas = _el('hd-trend-canvas');
        if (!canvas) return;
        var resize = function () {
            var rect = canvas.parentElement.getBoundingClientRect();
            if (canvas.width !== rect.width || canvas.height !== 192) {
                canvas.width = rect.width;
                canvas.height = 192;
                _drawTrendChart();
            }
        };
        resize();
        pm._on(window, 'resize', resize);
    }

    function init() {
        var saved = localStorage.getItem('hd-snapshots');
        if (saved) {
            try { _snapshots = JSON.parse(saved); _renderSnapshots(); } catch (_) {}
        }
        _initCanvas();
        pm._on(_el('hd-analyze-btn'), 'click', _runDiagnosis);
        pm._on(_el('hd-save-snapshot-btn'), 'click', _saveSnapshot);
        pm._on(_el('hd-clear-btn'), 'click', _clearHistory);
    }

    function destroy() { pm.destroy(); }

    window.HardwareDiagnosticsPage = { init: init, destroy: destroy };
})();

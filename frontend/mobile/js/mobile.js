/**
 * SoundMaster Mobile JS
 * Encapsulado em IIFE para não poluir o escopo global
 */
(function() {
'use strict';

const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
const socket = io({
    auth: { token }
});

// UI Elements - Navigation & Status
const statusBar = document.getElementById('status-heartbeat');
const connectionIndicator = document.getElementById('connection-indicator');
const appRoot = document.getElementById('mobile-app-root');

// UI Elements - Master
const masterSlider = document.getElementById('mobile-master-slider');
const masterLevelText = document.getElementById('mobile-master-level');
const masterDbText = document.getElementById('mobile-master-db');
const masterDown = document.getElementById('mobile-master-down');
const masterUp = document.getElementById('mobile-master-up');

// SPA Router State
const MobileRouter = {
    currentPage: 'mobile-master',
    
    init() {
        const navButtons = document.querySelectorAll('.mobile-nav-btn');
        navButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                triggerHaptic('light');
                const target = btn.getAttribute('data-target');
                this.navigate(target);
            });
        });
        this.navigate(this.currentPage);
        // ✅ Inicializa lista de mapeamentos salvos
        loadMobileMappings();
    },

    navigate(pageId) {
        this.currentPage = pageId;
        
        // Update Nav UI
        document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
            if (btn.getAttribute('data-target') === pageId) {
                btn.classList.add('tab-active');
            } else {
                btn.classList.remove('tab-active');
            }
        });

        // Update Page Visibility
        document.querySelectorAll('.mobile-page').forEach(page => {
            if (page.id === pageId) {
                page.classList.remove('hidden');
                page.classList.add('page-transition');
            } else {
                page.classList.add('hidden');
                page.classList.remove('page-transition');
            }
        });

        // Auto-scroll to top on navigation
        appRoot.scrollTop = 0;
    }
};

// State de Mix Atual
let currentMix = { type: 'master', id: null };

function initMixSelector() {
    const btns = document.querySelectorAll('.mix-selector-btn');
    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            triggerHaptic('light');
            btns.forEach(b => b.classList.remove('active-mix'));
            btn.classList.add('active-mix');
            
            currentMix.type = btn.getAttribute('data-mix-type');
            currentMix.id = btn.getAttribute('data-mix-id');
            
            appendMobileLog(`Mix alterado para: ${currentMix.type.toUpperCase()} ${currentMix.id || ''}`);
            
            // Opcional: Atualizar cor do acento baseado no mix?
            const root = document.documentElement;
            if (currentMix.type === 'aux') root.style.setProperty('--accent', '#14b8a6'); // Teal para Aux
            else if (currentMix.type === 'fx') root.style.setProperty('--accent', '#f59e0b'); // Laranja para FX
            else root.style.setProperty('--accent', '#06b6d4'); // Ciano para Master
        });
    });
}
// Connectivity Heartbeat & Latency
let lastPingTime = 0;
let currentLatency = 0;

function measureLatency() {
    if (!socket.connected) return;
    lastPingTime = Date.now();
    socket.emit('ping_mixer');
}

socket.on('pong_mixer', () => {
    currentLatency = Date.now() - lastPingTime;
    updateConnectivityUI(true);
});

// Intervalo de latência (3s)
let latencyInterval = null;
function updateConnectivityUI(connected) {
    if (!statusBar || !connectionIndicator) return;
    
    if (connected) {
        statusBar.className = 'status-bar-inner status-online';
        statusBar.style.width = '100%';
        connectionIndicator.innerText = `Online • ${currentLatency}ms`;
        connectionIndicator.className = 'text-[8px] font-bold text-emerald-500 uppercase tracking-widest';
    } else {
        statusBar.className = 'status-bar-inner status-offline';
        statusBar.style.width = '30%';
        connectionIndicator.innerText = 'Mixer Offline';
        connectionIndicator.className = 'text-[8px] font-bold text-red-500 uppercase tracking-widest';
    }
}

// Haptic Feedback Helper
function triggerHaptic(type = 'light') {
    if (!navigator.vibrate) return;
    if (type === 'light') navigator.vibrate(10);
    if (type === 'medium') navigator.vibrate(30);
    if (type === 'heavy') navigator.vibrate(50);
}

// Socket Listeners for Connectivity
socket.on('connect', () => {
    updateConnectivityUI(true);
    appendMobileLog('Conectado via SPA Bridge.');
    measureLatency();
    if (!latencyInterval) latencyInterval = setInterval(measureLatency, 3000);
});

socket.on('disconnect', () => {
    updateConnectivityUI(false);
    appendMobileLog('Desconectado do servidor.');
    if (latencyInterval) {
        clearInterval(latencyInterval);
        latencyInterval = null;
    }
});

socket.on('mixer_status', (data) => {
    updateConnectivityUI(data.connected);
});

function vuToHeight(linearValue) {
    const val = Number(linearValue) || 0;
    const db = val < 0.001 ? -80 : 20 * Math.log10(val);
    return Math.min(100, Math.max(0, ((db + 60) / 60) * 100));
}

// Listener de VU Meters
socket.on('vu_data', (data) => {
    if (data && data.master) {
        const vuMaster = document.getElementById('vu-master');
        if (vuMaster) {
            // ✅ Correção Auditoria: Usar escala logarítmica (dB)
            const height = vuToHeight(data.master.vuPostFader || 0);
            vuMaster.style.transform = `scaleY(${height / 100})`;
        }
    }
});

// Listener de Gravador
socket.on('recorder_status', (data) => {
    const isRecording = !!data.recording || !!data.mtkRecording;
    if (isRecording) {
        document.body.classList.add('rec-active');
        if (recDot) recDot.classList.remove('hidden');
        if (btnRecToggle) btnRecToggle.classList.add('text-red-500', 'font-bold');
    } else {
        document.body.classList.remove('rec-active');
        if (recDot) recDot.classList.add('hidden');
        if (btnRecToggle) btnRecToggle.classList.remove('text-red-500', 'font-bold');
    }
});

// ✅ Novo: Sincronização de Shows e Snapshots no Mobile
socket.on('show_status', (data) => {
    appendMobileLog(`Show carregado: ${data.show}`);
});
socket.on('snapshot_status', (data) => {
    appendMobileLog(`Snapshot atual: ${data.snapshot}`);
});

// ✅ Novo: Sincronização de nomes (etiquetas) no Mobile
socket.on('channel_name_update', (data) => {
    // Se estivermos vendo este canal no mobileTargetChannel, poderíamos atualizar um label de nome.
    // Por enquanto apenas logamos.
    appendMobileLog(`Canal ${data.channel} renomeado para: ${data.name}`);
});

// ✅ Novo: Sincronização de Mute Groups no Mobile
socket.on('mute_group_state', (data) => {
    if (data.enabled) {
        appendMobileLog(`Mute Group ${data.groupId} ATIVADO.`);
        if (data.groupId === 'all') {
            document.body.classList.add('panic-active');
        }
    } else {
        if (data.groupId === 'all') {
            document.body.classList.remove('panic-active');
        }
    }
});

// ✅ Novo: Sincronização de seleção externa de canal
socket.on('channel_selected_external', (data) => {
    if (data.type === 'i') {
        if (mobileTargetChannel) mobileTargetChannel.value = data.number;
        appendMobileLog(`Seguindo seleção externa: Canal ${data.number}`);
    }
});

// Initialize Router
MobileRouter.init();

const presetButtons = document.querySelectorAll('[data-master-preset]');
const btnStartMic = document.getElementById('mobile-btn-start-mic');
const btnStopMic = document.getElementById('mobile-btn-stop-mic');
const btnCutFeedback = document.getElementById('mobile-btn-cut-feedback');
    
// Novos botões
const btnRT60 = document.getElementById('mobile-btn-measure-rt60');
const btnTimbre = document.getElementById('mobile-btn-analyze-timbre');
const btnModeFFT = document.getElementById('btn-mode-fft');
const btnModePink = document.getElementById('btn-mode-pink');

if (btnRT60) btnRT60.addEventListener('click', startRT60Measurement);
if (btnTimbre) btnTimbre.addEventListener('click', analyzeTimbre);
if (btnModeFFT) btnModeFFT.addEventListener('click', () => setMeasurementMode('fft'));
if (btnModePink) btnModePink.addEventListener('click', () => setMeasurementMode('pink'));

// DOM Elements — Analysis Section
const fftCanvas = document.getElementById('mobile-fft-canvas');
const feedbackAlert = document.getElementById('mobile-feedback-alert');
const rmsReadout = document.getElementById('mobile-rms-readout');

// DOM Elements — Tools Section
const mobileTargetChannel = document.getElementById('mobile-target-channel');
const btnMobileCleanChannel = document.getElementById('mobile-clean-channel');
const btnMobileHpf = document.getElementById('mobile-hpf-channel');
const btnMobileGate = document.getElementById('mobile-gate-channel');
const btnMobileCompressor = document.getElementById('mobile-compressor-channel');
const btnMobileEqMud = document.getElementById('mobile-eq-mud');
const btnMobileEqHarsh = document.getElementById('mobile-eq-harsh');
const btnMobileAfsOn = document.getElementById('mobile-afs-on');
const btnMobileAfsOff = document.getElementById('mobile-afs-off');

// Botões de Ação Rápida
const btnMuteAll = document.getElementById('mobile-mute-all');
const btnRecToggle = document.getElementById('mobile-rec-toggle');
const recDot = document.getElementById('mobile-rec-dot');
const recStatusMobile = document.getElementById('rec-status-mobile');

// DOM Elements — AI Chat Section
const btnAiSend = document.getElementById('mobile-ai-send');
const aiInput = document.getElementById('mobile-ai-input');
const aiChatBox = document.getElementById('mobile-ai-chat');
const aiQuickTags = document.querySelectorAll('.mobile-ai-suggest');

// DOM Elements — Mappings
const mobileMappingList = document.getElementById('mobile-mapping-list');
const mobileMapLocation = document.getElementById('mobile-map-location');
const btnMobileSavePeak = document.getElementById('mobile-btn-save-peak');


let audioCtx = null;
let analyser = null;
let source = null;
let micStream = null;
let isMicActive = false;
let animationId = null;
let currentPeakHz = 0;
let isMeasuringRT60 = false;
let rt60StartTime = 0;
let rt60Bands = {
    '125': { hz: 125, filter: null, analyser: null, data: null, decay: [] },
    '500': { hz: 500, filter: null, analyser: null, data: null, decay: [] },
    '1k': { hz: 1000, filter: null, analyser: null, data: null, decay: [] },
    '4k': { hz: 4000, filter: null, analyser: null, data: null, decay: [] }
};
let rt60BackgroundLevel = -60;
let rt60BackgroundSamples = 0;

function setupMultibandFilters() {
    if (!audioCtx || !source) return;
    Object.keys(rt60Bands).forEach(key => {
        let band = rt60Bands[key];
        band.filter = audioCtx.createBiquadFilter();
        band.filter.type = 'bandpass';
        band.filter.frequency.value = band.hz;
        band.filter.Q.value = 1.41;
        
        band.analyser = audioCtx.createAnalyser();
        band.analyser.fftSize = 512;
        band.analyser.smoothingTimeConstant = 0.2;
        band.data = new Float32Array(band.analyser.fftSize);
        
        source.connect(band.filter);
        band.filter.connect(band.analyser);
    });
}
let isMeasuringPink = false;
let pinkSamples = [];
let pinkSampleCount = 0;
let measurementMode = 'fft';
let latestMasterPercent = 0;
let suspectedFeedbackFrames = 0;
let isPinkNoiseActive = false;
let lastDevicePixelRatio = 1;

function appendMobileLog(message) {
    console.log(`[Mobile] ${message}`);
    const logEl = document.getElementById('mobile-log');
    if (logEl) {
        const entry = document.createElement('div');
        entry.className = 'text-[8px] text-slate-500 py-0.5';
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;
    }
}

function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    if (label) button.innerText = label;
}

function updateMasterDisplay(level, db) {
    const percentage = Math.round(Math.min(100, Math.max(0, level * 100)));
    latestMasterPercent = percentage;
    if (masterLevelText) masterLevelText.innerText = `${percentage}%`;
    if (masterDbText) masterDbText.innerText = `${typeof db === 'number' ? db.toFixed(1) + ' db' : '-∞ dB'}`;
    
    if (masterSlider) {
        masterSlider.value = percentage;
    }
}

function setupMobileTouchFader() {
    const container = document.querySelector('.fader-container');
    if (!container) return;

    let _touchTimer = null;

    function _finalizeTouch() {
        if (_touchTimer) clearTimeout(_touchTimer);
        // Debounce: enviar valor final com um pequeno delay
        _touchTimer = setTimeout(function () {
            var level = (masterSlider ? masterSlider.value : 0) / 100;
            setMasterLevel(level);
            triggerHaptic('medium');
            _touchTimer = null;
        }, 150);
    }

    const handleTouch = (e) => {
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const touchY = e.touches[0].clientY;
        
        let percent = ((rect.bottom - touchY) / rect.height) * 100;
        percent = Math.min(100, Math.max(0, percent));
        
        const level = percent / 100;
        setMasterLevel(level);

        // Haptic feedback more precise
        if (Math.abs(percent - latestMasterPercent) > 2) {
            triggerHaptic('light');
        }
        
        // Cancel pending finalization while still touching
        if (_touchTimer) { clearTimeout(_touchTimer); _touchTimer = null; }
    };

    container.addEventListener('touchstart', handleTouch, { passive: false });
    container.addEventListener('touchmove', handleTouch, { passive: false });
    container.addEventListener('touchend', _finalizeTouch, { passive: true });
    container.addEventListener('touchcancel', _finalizeTouch, { passive: true });
}

function resizeCanvasForDisplay() {
    if (!fftCanvas) return;
    const scale = window.devicePixelRatio || 1;
    const dprChanged = scale !== lastDevicePixelRatio;
    lastDevicePixelRatio = scale;
    const displayWidth = Math.max(320, Math.floor(fftCanvas.clientWidth));
    const displayHeight = Math.max(140, Math.floor(fftCanvas.clientHeight));
    const width = Math.floor(displayWidth * scale);
    const height = Math.floor(displayHeight * scale);
    if (dprChanged || fftCanvas.width !== width || fftCanvas.height !== height) {
        fftCanvas.width = width;
        fftCanvas.height = height;
        _micCanvasCtx = null;
    }
}

async function startMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
        alert('🔒 Acesso Negado pelo Navegador\n\nPara usar o microfone no celular, você DEVE acessar o aplicativo usando o link seguro (HTTPS / Túnel) gerado pelo SoundMaster.\n\nNavegadores bloqueiam o microfone se você acessar via IP local (HTTP).');
        return;
    }

    try {
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        await audioCtx.resume();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.82;
        source = audioCtx.createMediaStreamSource(micStream);
        source.connect(analyser);
        setupMultibandFilters();
        isMicActive = true;
        suspectedFeedbackFrames = 0;
        btnStartMic?.classList.add('hidden');
        btnStopMic?.classList.remove('hidden');
        btnCutFeedback?.classList.add('hidden');
        analyzeMic();
        appendMobileLog('Microfone do telefone ativado.');
    } catch (error) {
        console.error('[Mobile] Mic error:', error);
        alert('Não foi possível ativar o microfone. Verifique as permissões do navegador.');
    }
}

function stopMic() {
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
    }
    if (audioCtx) {
        audioCtx.close();
    }
    isMicActive = false;
    micStream = null;
    audioCtx = null;
    analyser = null;
    source = null;
    cancelAnimationFrame(animationId);
    btnStartMic?.classList.remove('hidden');
    btnStopMic?.classList.add('hidden');
    btnCutFeedback?.classList.add('hidden');
    
    if (feedbackAlert) {
        feedbackAlert.className = 'p-3.5 rounded-2xl glass-card text-slate-500 text-center text-[10px] font-bold mb-6 italic';
        feedbackAlert.innerText = 'Microfone parado.';
    }
    if (rmsReadout) rmsReadout.innerText = '0%';
    appendMobileLog('Microfone do telefone parado.');
}

function drawAnalyzer(canvasCtx, dataArray, bufferLength) {
    const canvas = fftCanvas;
    if (!canvas) return;
    
    const width = canvas.width;
    const height = canvas.height;
    
    // Fundo ultra dark
    canvasCtx.fillStyle = '#050507';
    canvasCtx.fillRect(0, 0, width, height);
    
    const barWidth = (width / bufferLength) * 2;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const db = dataArray[i];
        const normalized = Math.max(0, Math.min(1, (db + 100) / 100));
        const barHeight = normalized * height;
        
        const freq = i * audioCtx.sampleRate / (bufferLength * 2);
        
        // Cores Premium (Glow)
        let color = '#334155';
        if (freq < 250) color = '#0ea5e9'; // Cyan
        else if (freq < 2500) color = '#10b981'; // Green
        else if (freq < 6000) color = '#f59e0b'; // Amber
        else color = '#ef4444'; // Red
        
        // Efeito de gradiente/brilho
        canvasCtx.fillStyle = color;
        canvasCtx.globalAlpha = 0.8;
        canvasCtx.fillRect(x, height - barHeight, barWidth - 1.5, barHeight);
        
        // Brilho no topo da barra
        canvasCtx.globalAlpha = 1.0;
        canvasCtx.fillStyle = '#fff';
        canvasCtx.fillRect(x, height - barHeight, barWidth - 1.5, 2);
        
        x += barWidth;
    }
    canvasCtx.globalAlpha = 1.0;
}

// Arrays globais (reaproveitados) para evitar GC pressure no loop 60fps
let micDataArray = null;
let micFreqDataArray = null;

let _micCanvasCtx = null;

function analyzeMic() {
    if (!isMicActive || !analyser) return;
    animationId = requestAnimationFrame(analyzeMic);

    if (!_micCanvasCtx) _micCanvasCtx = fftCanvas.getContext('2d');
    const canvasCtx = _micCanvasCtx;
    const bufferLength = analyser.frequencyBinCount;
    
    // Aloca apenas 1x
    if (!micDataArray || micDataArray.length !== bufferLength) {
        micDataArray = new Uint8Array(bufferLength);
        micFreqDataArray = new Float32Array(bufferLength);
    }
    
    analyser.getByteFrequencyData(micDataArray);
    analyser.getFloatFrequencyData(micFreqDataArray);
    const dataArray = micDataArray;
    const freqData = micFreqDataArray;

    let maxVal = 0;
    let maxIndex = 0;
    let sumSquares = 0;

    for (let i = 0; i < bufferLength; i++) {
        const value = dataArray[i];
        const normalized = value / 255;
        sumSquares += normalized * normalized;
        if (value > maxVal) {
            maxVal = value;
            maxIndex = i;
        }
    }

    resizeCanvasForDisplay();
    drawAnalyzer(canvasCtx, dataArray, bufferLength);

    // Lógica de Medição de Ruído Rosa (Averaging)
    if (isMeasuringPink && pinkSampleCount < 100) {
        if (pinkSamples.length === 0) {
            pinkSamples = new Float32Array(bufferLength);
        }
        for (let i = 0; i < bufferLength; i++) {
            pinkSamples[i] += freqData[i];
        }
        pinkSampleCount++;
        if (pinkSampleCount === 100) {
            for (let i = 0; i < bufferLength; i++) pinkSamples[i] /= 100;
            isMeasuringPink = false;
            appendMobileLog('Medição de Ruído Rosa concluída.');
            askAI('Analise a curva de ruído rosa que acabei de medir.', true);
        }
    }

    const rms = Math.sqrt(sumSquares / bufferLength);
    const rmsDb = 20 * Math.log10(rms + 1e-6);

    // Lógica de Medição de RT60 (Multibanda Schroeder-inspired)
    if (isMeasuringRT60) {
        // ✅ Correção Auditoria: Calibração de ruído de fundo (primeiros 30 frames ~500ms)
        if (rt60StartTime === 0 && rt60BackgroundSamples < 30) {
            if (rt60BackgroundSamples === 0) rt60BackgroundLevel = 0;
            rt60BackgroundLevel += rmsDb;
            rt60BackgroundSamples++;
            if (rt60BackgroundSamples === 30) rt60BackgroundLevel /= 30;
            return;
        }

        let isImpulseDetected = false;
        const impulseThreshold = rt60BackgroundLevel + 12; // Threshold dinâmico

        // Coleta RMS de todas as bandas
        Object.keys(rt60Bands).forEach(key => {
            let band = rt60Bands[key];
            if (!band.analyser) return;
            band.analyser.getFloatTimeDomainData(band.data);
            let sq = 0;
            for(let i=0; i<band.data.length; i++) sq += band.data[i] * band.data[i];
            let bandRmsDb = 20 * Math.log10(Math.sqrt(sq / band.data.length) + 1e-6);
            
            if (rt60StartTime === 0) {
                // Impulso detectado se ultrapassar o threshold dinâmico
                if (bandRmsDb > impulseThreshold) isImpulseDetected = true;
            } else {
                band.decay.push(bandRmsDb);
            }
        });

        if (rt60StartTime === 0) {
            if (isImpulseDetected || rmsDb > impulseThreshold) {
                rt60StartTime = Date.now();
                Object.keys(rt60Bands).forEach(k => rt60Bands[k].decay = []);
            }
        } else {
            const elapsed = Date.now() - rt60StartTime;
            const progress = Math.min(100, (elapsed / 3000) * 100); // ✅ Correção Auditoria: Baseado em tempo real
            document.getElementById('rt60-progress').style.width = `${progress}%`;
            
            if (elapsed > 3000) { // 3 segundos reais de captura
                isMeasuringRT60 = false;
                document.getElementById('rt60-overlay').classList.add('hidden');
                
                let results = {};
                Object.keys(rt60Bands).forEach(key => {
                    let decayArr = rt60Bands[key].decay;
                    const maxLevel = Math.max(...decayArr);
                    const maxIndex = decayArr.indexOf(maxLevel);
                    const last = decayArr[decayArr.length - 1];
                    const drop = maxLevel - last;
                    
                    const framesDecay = decayArr.length - maxIndex;
                    const time = (framesDecay * 1000 / 60) / 1000;
                    
                    const rt60 = drop > 5 ? (time * 60 / drop) : 0;
                    results[key] = parseFloat(rt60.toFixed(2));
                    
                    // ✅ Novo: Check de SNR no Mobile
                    const bandSnr = maxLevel - rt60BackgroundLevel;
                    if (bandSnr < 20) {
                        appendMobileLog(`⚠️ SNR insuficiente na banda ${key}Hz (${bandSnr.toFixed(1)}dB).`);
                    }

                    const el = document.getElementById(`mobile-rt60-${key}`);
                    if (el) el.innerText = rt60 > 0 ? `${rt60.toFixed(2)}` : '--';
                });
                
                appendMobileLog(`RT60 Multibanda concluído.`);
                emitMobileTool('ai_chat', { 
                    message: "Analise o RT60 Multibanda medido na sala.",
                    analysis: { rt60_multiband: results }
                }, "Enviando RT60 para IA...");
            }
        }
    }

    const rmsPercent = Math.round(Math.min(100, Math.max(0, (rmsDb + 60) / 60 * 100)));
    currentPeakHz = maxIndex * (audioCtx.sampleRate / analyser.fftSize);
    const peakRounded = Math.round(currentPeakHz);

    if (rmsReadout) rmsReadout.innerText = `${rmsPercent}%`;

    const looksLikeFeedback = maxVal > 225 && currentPeakHz > 180 && currentPeakHz < 9000 && rmsPercent > 18;
    suspectedFeedbackFrames = looksLikeFeedback ? suspectedFeedbackFrames + 1 : Math.max(0, suspectedFeedbackFrames - 2);

    if (suspectedFeedbackFrames > 16) {
        if (feedbackAlert) {
            feedbackAlert.className = 'p-3.5 rounded-2xl glass-card text-red-400 text-center text-[10px] font-bold mb-6 animate-pulse';
            feedbackAlert.innerText = `⚠️ Atenção: pico sustentado em ${peakRounded} Hz.`;
        }
        btnCutFeedback?.classList.remove('hidden');
    } else if (rmsPercent > 75) {
        if (feedbackAlert) {
            feedbackAlert.className = 'p-3.5 rounded-2xl glass-card text-red-400 text-center text-[10px] font-bold mb-6';
            feedbackAlert.innerText = '🔊 Nível muito alto! Risco de microfonia.';
        }
        btnCutFeedback?.classList.add('hidden');
    } else if (isMeasuringPink) {
        if (feedbackAlert) {
            feedbackAlert.className = 'p-3.5 rounded-2xl glass-card text-cyan-400 text-center text-[10px] font-bold mb-6';
            feedbackAlert.innerText = `Capturando Ruído Rosa (${pinkSampleCount}/100)...`;
        }
    } else {
        if (feedbackAlert) {
            feedbackAlert.className = 'p-3.5 rounded-2xl glass-card text-emerald-400 text-center text-[10px] font-bold mb-6';
            feedbackAlert.innerText = `✅ Som Limpo. Pico: ${peakRounded} Hz.`;
        }
        btnCutFeedback?.classList.add('hidden');
    }
}

function setMeasurementMode(mode) {
    measurementMode = mode;
    const btnFFT = document.getElementById('btn-mode-fft');
    const btnPink = document.getElementById('btn-mode-pink');
    
    if (mode === 'pink') {
        btnFFT?.classList.remove('active-mode');
        btnPink?.classList.add('active-mode');
        startPinkMeasurement();
    } else {
        btnPink?.classList.remove('active-mode');
        btnFFT?.classList.add('active-mode');
        isMeasuringPink = false;
    }
}

function startPinkMeasurement() {
    if (!isMicActive) {
        alert('Ative o microfone primeiro!');
        setMeasurementMode('fft');
        return;
    }
    isMeasuringPink = true;
    pinkSamples = [];
    pinkSampleCount = 0;
}

function startRT60Measurement() {
    if (!isMicActive) {
        alert('Ative o microfone primeiro!');
        return;
    }
    const overlay = document.getElementById('rt60-overlay');
    overlay.classList.remove('hidden');
    isMeasuringRT60 = true;
    rt60StartTime = 0;
    rt60BackgroundLevel = -60;
    rt60BackgroundSamples = 0;
    Object.keys(rt60Bands).forEach(k => rt60Bands[k].decay = []);
    
    appendMobileLog('Iniciando medição de RT60. Faça um estalo ou barulho seco.');
}

function analyzeTimbre() {
    if (!isMicActive) {
        alert('Ative o microfone primeiro!');
        return;
    }
    
    // Simples análise de balanço espectral
    const bufferLength = analyser.frequencyBinCount;
    const data = new Float32Array(bufferLength);
    analyser.getFloatFrequencyData(data);
    
    let lowSum = 0, midSum = 0, highSum = 0;
    const sampleRate = audioCtx.sampleRate;
    
    for(let i=0; i<bufferLength; i++) {
        const freq = i * sampleRate / (bufferLength * 2);
        if (freq < 250) lowSum += data[i];
        else if (freq < 4000) midSum += data[i];
        else highSum += data[i];
    }
    
    const lowAvg = lowSum / (bufferLength * 0.1);
    const midAvg = midSum / (bufferLength * 0.5);
    const highAvg = highSum / (bufferLength * 0.4);
    
    let report = 'Balanço Espectral: ';
    if (lowAvg > midAvg + 6) report += 'Grave excessivo. ';
    else if (lowAvg < midAvg - 6) report += 'Falta grave. ';
    
    if (highAvg > midAvg + 6) report += 'Agudo brilhante/reflexivo. ';
    else if (highAvg < midAvg - 6) report += 'Agudo apagado. ';
    
    if (report === 'Balanço Espectral: ') report += 'Equilibrado.';
    
    appendMobileLog(report);
    askAI(`Analise este timbre: Grave=${Math.round(lowAvg)}dB, Médio=${Math.round(midAvg)}dB, Agudo=${Math.round(highAvg)}dB. ${report}`);
}

function setMasterLevel(value) {
    const level = Math.min(1, Math.max(0, value));
    updateMasterDisplay(level, undefined);
    
    if (currentMix.type === 'master') {
        emitMobileTool('set_master_level', { level });
    } else if (currentMix.type === 'aux') {
        const channel = getTargetChannel();
        if (channel) emitMobileTool('set_aux_level', { channel, aux: currentMix.id, level });
    } else if (currentMix.type === 'fx') {
        const channel = getTargetChannel();
        if (channel) emitMobileTool('set_fx_level', { channel, fx: currentMix.id, level });
    }
}

function getTargetChannel() {
    const value = Number(mobileTargetChannel?.value || 1);
    if (!Number.isInteger(value) || value < 1 || value > 24) {
        alert('Informe um canal entre 1 e 24.');
        return null;
    }
    return value;
}

function emitMobileTool(eventName, payload, label) {
    if (!socket.connected) {
        console.warn('[Mobile] Socket desconectado — comando ignorado:', eventName);
        return;
    }
    socket.emit(eventName, payload);
    if (label) appendMobileLog(label);
}

async function loadMobileMappings() {
    if (!mobileMappingList) return;
    try {
        const res = await fetch('/api/mappings');
        if (!res.ok) throw new Error('Falha ao carregar mapeamentos.');
        const mappings = await res.json();
        if (!mappings.length) {
            mobileMappingList.innerText = 'Nenhum mapeamento salvo ainda.';
            return;
        }
        mobileMappingList.innerHTML = '';
        mappings.slice().reverse().slice(0, 8).forEach((map) => {
            const item = document.createElement('div');
            item.className = 'mobile-map-item';
            const location = map.location ? ` - ${map.location}` : '';
            const channel = map.channel ? ` canal ${map.channel}` : '';
            item.innerText = `${map.hz} Hz${channel}${location}`;
            mobileMappingList.appendChild(item);
        });
    } catch (error) {
        mobileMappingList.innerText = error.message;
    }
}

async function saveCurrentPeak() {
    const hz = Math.round(currentPeakHz);
    if (!hz) {
        alert('Ative o microfone e espere o pico aparecer antes de salvar.');
        return;
    }
    const body = {
        hz,
        channel: getTargetChannel() || 1,
        location: mobileMapLocation?.value?.trim() || '',
        rms: rmsReadout?.innerText || '',
        date: new Date().toISOString()
    };
    try {
        const res = await fetch('/api/mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('Nao foi possivel salvar o mapeamento.');
        appendMobileLog(`Pico ${hz} Hz salvo no mapeamento.`);
        loadMobileMappings();
    } catch (error) {
        alert(error.message);
    }
}

async function askAI(text, includeAnalysis = false) {
    if (!text && !includeAnalysis) return;
    
    // Bubble Usuário
    const userRow = document.createElement('div');
    userRow.className = 'flex justify-end mb-4';
    const userBubble = document.createElement('div');
    userBubble.className = 'bg-cyan-600/90 backdrop-blur-md p-3.5 rounded-3xl rounded-tr-none text-xs text-white border border-cyan-500/30 max-w-[85%] shadow-lg shadow-cyan-900/20';
    userBubble.textContent = text || '📊 Enviando análise acústica...';
    userRow.appendChild(userBubble);
    aiChatBox.appendChild(userRow);
    aiChatBox.scrollTop = aiChatBox.scrollHeight;

    const payload = {
        message: text || 'analise o som ambiente',
        session_id: token, 
        analysis: includeAnalysis ? {
            peakHz: Math.round(currentPeakHz),
            rms: rmsReadout?.innerText || '0%',
            timestamp: Date.now(),
            isPinkNoise: isPinkNoiseActive
        } : null
    };

    // Placeholder de carregamento
    const loadingId = 'ai-loading-' + Date.now();
    const loadingRow = document.createElement('div');
    loadingRow.id = loadingId;
    loadingRow.className = 'flex justify-start mb-4 animate-pulse';
    loadingRow.innerHTML = `
        <div class="bg-slate-800/60 backdrop-blur-md p-3.5 rounded-3xl rounded-tl-none text-xs text-slate-400 border border-white/5">
            Processando...
        </div>
    `;
    aiChatBox.appendChild(loadingRow);
    aiChatBox.scrollTop = aiChatBox.scrollHeight;

    try {
        const res = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        // Remove loading
        document.getElementById(loadingId)?.remove();

        const aiRow = document.createElement('div');
        aiRow.className = 'flex justify-start mb-4';
        
        var _cmdDesc = data.command ? _sanitizeMobile(data.command.desc) : '';
        var commandHtml = '';
        if (data.command) {
            commandHtml = [
                '<button class="mt-3 w-full py-2 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest active:bg-cyan-500 active:text-black transition-all">',
                'Executar: ', _cmdDesc,
                '</button>'
            ].join('');
        }

        var _sanitizeMobile = function _sanitizeMobile(str) {
            if (window.DOMPurify && typeof DOMPurify.sanitize === 'function') {
                return DOMPurify.sanitize(str, { ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'br'] });
            }
            return String(str).replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
        };
        aiRow.innerHTML = [
            '<div class="bg-slate-800/60 backdrop-blur-md p-3.5 rounded-3xl rounded-tl-none text-xs text-slate-200 border border-white/5 max-w-[85%] shadow-xl">',
            '<div class="font-black text-[9px] text-cyan-500 uppercase tracking-widest mb-1">SoundMaster IA</div>',
            '<div class="leading-relaxed">', _sanitizeMobile(data.text), '</div>',
            commandHtml,
            '</div>'
        ].join('');

        if (data.command) {
            const btnCmd = aiRow.querySelector('button');
            btnCmd.textContent = 'Revisar ajuste: ' + (data.command.desc || data.command.action);
            btnCmd.addEventListener('click', () => {
                const actionId = btnCmd.dataset.actionId;
                if (actionId) {
                    socket.emit('sound_assistant_confirm_action', { actionId });
                    btnCmd.disabled = true;
                    btnCmd.textContent = 'Aplicando ajuste confirmado...';
                    return;
                }
                if (btnCmd.dataset.proposing === 'true') return;

                const clientRequestId = 'mobile-' + Date.now();
                btnCmd.dataset.proposing = 'true';
                btnCmd.disabled = true;
                btnCmd.textContent = 'Validando ajuste...';

                const onPending = (entry) => {
                    if (entry.clientRequestId !== clientRequestId) return;
                    socket.off('sound_assistant_action_pending', onPending);
                    btnCmd.dataset.actionId = entry.actionId;
                    btnCmd.dataset.proposing = 'false';
                    btnCmd.disabled = false;
                    btnCmd.textContent = entry.risk === 'high' ? 'Confirmar ajuste de alto impacto' : 'Confirmar e aplicar';
                };
                const onRejected = (entry) => {
                    if (entry.clientRequestId !== clientRequestId) return;
                    socket.off('sound_assistant_action_rejected', onRejected);
                    btnCmd.dataset.proposing = 'false';
                    btnCmd.disabled = true;
                    btnCmd.textContent = 'Ajuste bloqueado: ' + (entry.error || 'não permitido');
                };
                const onResult = (entry) => {
                    if (!btnCmd.dataset.actionId || entry.actionId !== btnCmd.dataset.actionId) return;
                    if (entry.status === 'completed') {
                        socket.off('sound_assistant_action_result', onResult);
                        btnCmd.disabled = true;
                        btnCmd.textContent = 'Ajuste aplicado';
                        btnCmd.className = 'mt-3 w-full py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest';
                    } else if (entry.status === 'failed') {
                        socket.off('sound_assistant_action_result', onResult);
                        btnCmd.disabled = true;
                        btnCmd.textContent = 'Falha: ' + (entry.error || 'não aplicado');
                    }
                };

                socket.on('sound_assistant_action_pending', onPending);
                socket.on('sound_assistant_action_rejected', onRejected);
                socket.on('sound_assistant_action_result', onResult);
                socket.emit('sound_assistant_propose_action', {
                    clientRequestId,
                    command: data.command,
                    reason: data.text || data.command.desc,
                    origin: 'ai-chat',
                    evidence: { source: 'mobile' }
                });
            });
        }

        aiChatBox.appendChild(aiRow);
        aiChatBox.scrollTop = aiChatBox.scrollHeight;
    } catch (err) {
        document.getElementById(loadingId)?.remove();
        const errMsg = document.createElement('div');
        errMsg.className = 'text-center text-[10px] text-red-500 uppercase font-black my-2';
        errMsg.innerText = 'Erro de conexão com o servidor de IA.';
        aiChatBox.appendChild(errMsg);
    }
}

// NOTA: O mobile não tem UI de conexão manual — o mixer é conectado via desktop.
// Listeners removidos: btnConnect, btnDisconnect (elementos inexistentes no HTML).

masterDown?.addEventListener('click', () => {
    const next = Math.max(0, latestMasterPercent - 1) / 100;
    setMasterLevel(next);
});

masterUp?.addEventListener('click', () => {
    const next = Math.min(100, latestMasterPercent + 1) / 100;
    setMasterLevel(next);
});

presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const preset = Number(button.dataset.masterPreset) / 100;
        setMasterLevel(preset);
        appendMobileLog(`Preset aplicado: ${button.innerText} (${Math.round(preset * 100)}%).`);
    });
});

btnStartMic?.addEventListener('click', startMic);
btnStopMic?.addEventListener('click', stopMic);

btnCutFeedback?.addEventListener('click', () => {
    if (!currentPeakHz) return;
    const hz = Math.round(currentPeakHz);
    emitMobileTool('cut_feedback', { hz }, `Solicitado corte do pico em ${hz} Hz.`);
    btnCutFeedback.disabled = true;
});

// -------------------------------------------------------------------------
// Ferramentas do Técnico (Mobile Manual)
// -------------------------------------------------------------------------
const mobilePinkToggle = document.getElementById('mobile-pink-toggle');
const mobilePinkLevel = document.getElementById('mobile-pink-level');
const mobilePinkVal = document.getElementById('mobile-pink-val');
const mobileBtnPulse = document.getElementById('mobile-btn-pulse');

mobilePinkToggle?.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    isPinkNoiseActive = enabled;
    const level = mobilePinkLevel ? mobilePinkLevel.value : -20;
    emitMobileTool('set_oscillator', { enabled, type: 1, level }, `Ruído Rosa ${enabled ? 'LIGADO' : 'DESLIGADO'}.`);
});

mobilePinkLevel?.addEventListener('input', (e) => {
    const level = e.target.value;
    if (mobilePinkVal) mobilePinkVal.innerText = `${level}dB`;
    if (mobilePinkToggle?.checked) {
        emitMobileTool('set_oscillator', { enabled: true, type: 1, level });
    }
});

mobileBtnPulse?.addEventListener('click', () => {
    triggerHaptic('medium');
    emitMobileTool('set_oscillator', { enabled: true, type: 1, level: -10 }, 'Disparando pulso de medição manual...');
    setTimeout(() => {
        emitMobileTool('set_oscillator', { enabled: false, type: 1, level: -10 });
    }, 200);
});

btnMobileCleanChannel?.addEventListener('click', () => {
    triggerHaptic('medium');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('run_clean_sound_preset', { channel }, `Preset de som limpo no canal ${channel}.`);
});

btnMobileHpf?.addEventListener('click', () => {
    triggerHaptic('light');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('apply_channel_hpf', { channel, hz: 100 }, `HPF 100Hz no canal ${channel}.`);
});

btnMobileGate?.addEventListener('click', () => {
    triggerHaptic('light');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('apply_channel_gate', { channel, enabled: 1, threshold: -52 }, `Gate leve no canal ${channel}.`);
});

btnMobileCompressor?.addEventListener('click', () => {
    triggerHaptic('light');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('apply_channel_compressor', { channel, ratio: 2.5, threshold: -18 }, `Compressor leve no canal ${channel}.`);
});

btnMobileEqMud?.addEventListener('click', () => {
    triggerHaptic('medium');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('apply_eq_cut', { target: 'channel', channel, hz: 250, gain: -3, q: 1.1, band: 2 }, `Corte 250Hz no canal ${channel}.`);
});

btnMobileEqHarsh?.addEventListener('click', () => {
    triggerHaptic('medium');
    const channel = getTargetChannel();
    if (!channel) return;
    emitMobileTool('apply_eq_cut', { target: 'channel', channel, hz: 3200, gain: -2.5, q: 1.5, band: 3 }, `Corte 3.2kHz no canal ${channel}.`);
});

btnMobileAfsOn?.addEventListener('click', () => {
    triggerHaptic('heavy');
    emitMobileTool('set_afs_enabled', { enabled: 1 }, 'Solicitado AFS2 global ligado.');
});

btnMobileAfsOff?.addEventListener('click', () => {
    triggerHaptic('light');
    emitMobileTool('set_afs_enabled', { enabled: 0 }, 'Solicitado AFS2 global desligado.');
});

// Listeners de Ação Rápida
btnMuteAll?.addEventListener('click', () => {
    triggerHaptic('heavy');
    // Muta o grupo 'all'
    emitMobileTool('mute_group_cmd', { id: 'all', enabled: 1 }, '🚨 PANICO: Mute All ativado!');
    // Limpa após 3 segundos (opcional, ou deixa mutado até o técnico agir)
    appendMobileLog('Sistema mutado. Use a mesa física ou desktop para desmutar canais individuais.');
});

// Mute Groups Mobile
document.querySelectorAll('.mobile-mute-group').forEach(btn => {
    btn.addEventListener('click', () => {
        triggerHaptic('medium');
        const groupId = btn.dataset.group;
        const active = btn.classList.contains('active-mix');
        emitMobileTool('mute_group_cmd', { id: groupId, enabled: active ? 0 : 1 }, `Mute Group ${groupId} ${active ? 'Desativado' : 'Ativado'}`);
        btn.classList.toggle('active-mix', !active);
    });
});

btnRecToggle?.addEventListener('click', () => {
    triggerHaptic('medium');
    emitMobileTool('recorder_cmd', { action_type: 'recordToggle' }, 'Alternando estado da gravação...');
});

btnAiSend?.addEventListener('click', () => {
    const text = aiInput?.value?.trim();
    if (!text) return;
    askAI(text);
    aiInput.value = '';
});

btnMobileSavePeak?.addEventListener('click', saveCurrentPeak);

aiQuickTags.forEach(tag => {
    tag.addEventListener('click', () => {
        const query = tag.getAttribute('data-query');
        askAI(query);
    });
});

aiInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') btnAiSend.click();
});

// Startup
window.addEventListener('resize', resizeCanvasForDisplay);
resizeCanvasForDisplay();

// Pre-nav setup
setupMobileTouchFader();
initMixSelector();

})();

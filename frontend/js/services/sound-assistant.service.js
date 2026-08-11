(function () {
    'use strict';

    const DEFAULT_CONFIG = Object.freeze({
        minFrameIntervalMs: 80,
        clippingConsecutiveFrames: 3,
        clippingThresholdDbfs: -0.18,
        clippingResolveMs: 3000,
        feedbackWindowMs: 1800,
        feedbackMinFrames: 8,
        feedbackMinDb: -24,
        feedbackMinProminenceDb: 7,
        feedbackConfidence: 0.82,
        feedbackResolveMs: 5000,
        alertUpdateIntervalMs: 1000,
        maxAlerts: 40,
    });

    const SETTINGS_KEY = 'sm-soundAssistantSettings';
    const DEFAULT_SETTINGS = Object.freeze({
        sourceMode: 'main-lr',
        sensitivity: 'balanced',
        confirmationPolicy: 'always',
        categories: {
            clipping: true,
            feedback: true,
            noise: true,
            signal: true,
            dynamics: true,
            eq: true,
        },
    });

    let _config = { ...DEFAULT_CONFIG };
    let _sequence = 0;
    let _lastIngestAt = null;
    const _listeners = new Set();
    const _activeByCode = new Map();
    const _alerts = [];
    const _actions = new Map();
    let _currentTask = null;
    let _latestFrame = null;
    let _socketBound = false;
    const _detectors = {
        clippingFrames: 0,
        feedbackHistory: [],
        highLevelFrames: 0,
        lowEndFrames: 0,
        harshFrames: 0,
        compressedFrames: 0,
        noiseFrames: 0,
        silenceFrames: 0,
    };

    let _mode = 'shadow';
    let _settings = _loadSettings();
    let _sourceMode = _settings.sourceMode;

    function _clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function _number(value, fallback) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function _copy(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function _loadSettings() {
        try {
            const saved = JSON.parse(window.localStorage?.getItem(SETTINGS_KEY) || 'null');
            if (!saved || typeof saved !== 'object') return _copy(DEFAULT_SETTINGS);
            return {
                ..._copy(DEFAULT_SETTINGS),
                ...saved,
                categories: { ...DEFAULT_SETTINGS.categories, ...(saved.categories || {}) },
                confirmationPolicy: 'always',
            };
        } catch (_) {
            return _copy(DEFAULT_SETTINGS);
        }
    }

    function _persistSettings() {
        try { window.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(_settings)); } catch (_) { }
    }

    function _activeAlerts() {
        return _alerts.filter(function (alert) { return alert.status === 'active'; });
    }

    function _actionList() {
        return Array.from(_actions.values())
            .sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); })
            .map(_copy);
    }

    function _publish(alert, isNew) {
        const snapshot = getState();
        if (window.AppStore && typeof window.AppStore.setState === 'function') {
            window.AppStore.setState({
                soundAssistantMode: snapshot.mode,
                soundAssistantSource: snapshot.sourceMode,
                soundAssistantAlerts: snapshot.alerts,
                soundAssistantActiveCount: snapshot.activeCount,
                soundAssistantActions: snapshot.actions,
                soundAssistantPendingCount: snapshot.pendingCount,
                soundAssistantTask: snapshot.currentTask,
                soundAssistantSettings: snapshot.settings,
            });
        }

        _listeners.forEach(function (listener) {
            try { listener(_copy(alert), snapshot); } catch (_) { }
        });

        if (typeof window.CustomEvent === 'function' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('sound-assistant-alert', {
                detail: { alert: _copy(alert), isNew: Boolean(isNew), state: snapshot },
            }));
        }

        if (isNew && window.SoundMasterToast && typeof window.SoundMasterToast.showToast === 'function') {
            const type = alert.severity === 'critical' ? 'error' : 'warning';
            window.SoundMasterToast.showToast(alert.title + ': ' + alert.message, type, 6000);
        }
    }

    function _buildAlert(definition, now) {
        return {
            id: definition.code + '-' + now + '-' + (++_sequence),
            code: definition.code,
            category: definition.category,
            severity: definition.severity,
            status: 'active',
            title: definition.title,
            message: definition.message,
            confidence: _clamp(_number(definition.confidence, 0), 0, 1),
            source: {
                mode: definition.sourceMode || _sourceMode,
                target: definition.target || 'main',
            },
            evidence: _copy(definition.evidence || {}),
            proposedAction: _copy(definition.proposedAction || null),
            requiresConfirmation: true,
            executionAllowed: false,
            firstSeenAt: now,
            lastSeenAt: now,
            lastPublishedAt: now,
            resolvedAt: null,
            occurrences: 1,
        };
    }

    function _upsertAlert(definition, now) {
        const existing = _activeByCode.get(definition.code);
        if (existing) {
            existing.lastSeenAt = now;
            existing.occurrences += 1;
            existing.confidence = _clamp(Math.max(existing.confidence, _number(definition.confidence, 0)), 0, 1);
            existing.message = definition.message || existing.message;
            existing.evidence = _copy(definition.evidence || existing.evidence);
            existing.proposedAction = _copy(definition.proposedAction || existing.proposedAction);
            if (now - existing.lastPublishedAt >= _config.alertUpdateIntervalMs) {
                existing.lastPublishedAt = now;
                _publish(existing, false);
            }
            return existing;
        }

        const alert = _buildAlert(definition, now);
        _alerts.unshift(alert);
        _activeByCode.set(alert.code, alert);
        if (_alerts.length > _config.maxAlerts) _alerts.length = _config.maxAlerts;
        _publish(alert, true);
        return alert;
    }

    function resolveAlert(code, reason, timestamp) {
        const alert = _activeByCode.get(code);
        if (!alert) return false;
        const now = _number(timestamp, Date.now());
        alert.status = 'resolved';
        alert.resolvedAt = now;
        alert.resolution = reason || 'Condição não observada novamente.';
        _activeByCode.delete(code);
        _publish(alert, false);
        return true;
    }

    function _feedbackConfidence(history, modelScore) {
        if (!history.length) return 0;
        const meanLog = history.reduce(function (sum, item) {
            return sum + Math.log2(item.peakHz);
        }, 0) / history.length;
        const variance = history.reduce(function (sum, item) {
            const distance = Math.log2(item.peakHz) - meanLog;
            return sum + distance * distance;
        }, 0) / history.length;
        const deviation = Math.sqrt(variance);
        const stability = _clamp(1 - (deviation / (1 / 18)), 0, 1);
        const persistence = _clamp(history.length / _config.feedbackMinFrames, 0, 1);
        const avgProminence = history.reduce(function (sum, item) {
            return sum + item.prominenceDb;
        }, 0) / history.length;
        const prominence = _clamp((avgProminence - _config.feedbackMinProminenceDb) / 12, 0, 1);
        const classifier = _clamp(_number(modelScore, 0), 0, 1);
        return _clamp((0.45 * persistence) + (0.30 * stability) + (0.20 * prominence) + (0.05 * classifier), 0, 1);
    }

    function _detectClipping(frame, now) {
        const clipping = Boolean(frame.isClipping) || frame.truePeakDb >= _config.clippingThresholdDbfs;
        _detectors.clippingFrames = clipping
            ? _detectors.clippingFrames + 1
            : Math.max(0, _detectors.clippingFrames - 1);

        if (_detectors.clippingFrames >= _config.clippingConsecutiveFrames) {
            const confidence = _clamp(0.75 + (_detectors.clippingFrames * 0.05), 0, 1);
            _upsertAlert({
                code: 'MAIN_CLIPPING',
                category: 'level',
                severity: 'critical',
                title: 'Clipping no Main L/R',
                message: 'Picos digitais consecutivos foram detectados. Revise ganhos e buses antes de elevar o master.',
                confidence,
                evidence: {
                    truePeakDb: Number(frame.truePeakDb.toFixed(2)),
                    rmsDb: Number(frame.rmsDb.toFixed(2)),
                    consecutiveFrames: _detectors.clippingFrames,
                },
                proposedAction: {
                    type: 'review_gain_structure',
                    target: 'main',
                    executable: false,
                    reason: 'O Main L/R não identifica sozinho qual canal originou o clipping.',
                },
            }, now);
        }
    }

    function _detectFeedback(frame, now) {
        const prominenceDb = frame.peakDb - frame.localFloorDb;
        const validPeak = frame.peakHz >= 40 && frame.peakHz <= 16000 &&
            frame.peakDb >= _config.feedbackMinDb &&
            prominenceDb >= _config.feedbackMinProminenceDb;

        if (validPeak) {
            _detectors.feedbackHistory.push({
                at: now,
                peakHz: frame.peakHz,
                peakDb: frame.peakDb,
                prominenceDb,
            });
        }

        const cutoff = now - _config.feedbackWindowMs;
        _detectors.feedbackHistory = _detectors.feedbackHistory.filter(function (item) {
            return item.at >= cutoff;
        });

        if (_detectors.feedbackHistory.length < _config.feedbackMinFrames) return;

        const classifierLooksLikeFeedback = /feedback|howl|squeal|oscillation/i.test(frame.classification || '');
        const modelScore = classifierLooksLikeFeedback ? frame.classificationScore : 0;
        const confidence = _feedbackConfidence(_detectors.feedbackHistory, modelScore);
        if (confidence < _config.feedbackConfidence) return;

        const meanHz = _detectors.feedbackHistory.reduce(function (sum, item) {
            return sum + item.peakHz;
        }, 0) / _detectors.feedbackHistory.length;
        const avgPeakDb = _detectors.feedbackHistory.reduce(function (sum, item) {
            return sum + item.peakDb;
        }, 0) / _detectors.feedbackHistory.length;
        const avgProminenceDb = _detectors.feedbackHistory.reduce(function (sum, item) {
            return sum + item.prominenceDb;
        }, 0) / _detectors.feedbackHistory.length;

        _upsertAlert({
            code: 'MAIN_FEEDBACK_RISK',
            category: 'feedback',
            severity: confidence >= 0.92 ? 'critical' : 'warning',
            title: 'Risco de microfonia no Main L/R',
            message: 'Um pico tonal estreito e persistente foi detectado. Confirme a origem antes de aplicar qualquer corte.',
            confidence,
            evidence: {
                frequencyHz: Math.round(meanHz),
                peakDb: Number(avgPeakDb.toFixed(1)),
                prominenceDb: Number(avgProminenceDb.toFixed(1)),
                observedFrames: _detectors.feedbackHistory.length,
                classifier: frame.classification || null,
                classifierScore: Number(frame.classificationScore.toFixed(3)),
            },
            proposedAction: {
                type: 'apply_eq_cut',
                target: 'main',
                parameters: {
                    frequencyHz: Math.round(meanHz),
                    gainDb: -3,
                    q: 10,
                },
                executable: false,
                reason: 'Modo sombra: a proposta deve ser validada e confirmada pelo operador.',
            },
        }, now);
    }

    function _trackCounter(key, condition) {
        _detectors[key] = condition ? _detectors[key] + 1 : Math.max(0, _detectors[key] - 2);
        return _detectors[key];
    }

    function _detectLevelAndDynamics(frame, now) {
        const highLevel = _trackCounter('highLevelFrames', frame.rmsDb > -10 && !frame.isClipping);
        if (highLevel >= 25) {
            _upsertAlert({
                code: 'MAIN_HEADROOM_LOW',
                category: 'dynamics',
                severity: 'warning',
                title: 'Pouca margem no Main L/R',
                message: 'O nível médio permaneceu alto por vários segundos. Revise a estrutura de ganho antes que ocorram picos de clipping.',
                confidence: _clamp(0.70 + highLevel / 200, 0, 0.95),
                evidence: { rmsDb: Number(frame.rmsDb.toFixed(1)), crestFactor: Number(frame.crestFactor.toFixed(1)), observedFrames: highLevel },
                proposedAction: { type: 'review_gain_structure', target: 'main', executable: false, reason: 'O Main L/R não identifica com certeza o canal responsável.' },
            }, now);
        }

        const classificationIsProgram = /speech|voice|music|instrument|sing/i.test(frame.classification);
        const overCompressed = _trackCounter('compressedFrames', classificationIsProgram && frame.rmsDb > -36 && frame.crestFactor > 0 && frame.crestFactor < 3.5);
        if (overCompressed >= 75) {
            _upsertAlert({
                code: 'MAIN_DYNAMICS_FLAT',
                category: 'dynamics',
                severity: 'warning',
                title: 'Dinâmica excessivamente comprimida',
                message: 'O fator de crista permaneceu muito baixo. Verifique compressor e limiter antes de aumentar volume.',
                confidence: _clamp(0.68 + overCompressed / 300, 0, 0.93),
                evidence: { rmsDb: Number(frame.rmsDb.toFixed(1)), crestFactor: Number(frame.crestFactor.toFixed(1)), observedFrames: overCompressed },
                proposedAction: { type: 'review_compression', target: 'main', executable: false },
            }, now);
        }
    }

    function _detectTonalBalance(frame, now) {
        const bands = frame.bands;
        const valid = frame.rmsDb > -55 && bands.mid > -115;
        const lowExcess = _trackCounter('lowEndFrames', valid && bands.low > bands.mid + 10);
        if (lowExcess >= 50) {
            _upsertAlert({
                code: 'MAIN_LOW_END_EXCESS',
                category: 'eq',
                severity: 'warning',
                title: 'Excesso persistente de graves',
                message: 'A energia de graves permaneceu muito acima dos médios. Confirme se é conteúdo musical ou acúmulo da sala antes de equalizar.',
                confidence: _clamp(0.65 + lowExcess / 250, 0, 0.92),
                evidence: { lowDb: Number(bands.low.toFixed(1)), midDb: Number(bands.mid.toFixed(1)), differenceDb: Number((bands.low - bands.mid).toFixed(1)), observedFrames: lowExcess },
                proposedAction: { type: 'apply_eq_cut', target: 'main', parameters: { frequencyHz: 200, gainDb: -2, q: 0.9 }, executable: false, requiresConfirmation: true },
            }, now);
        }

        const harsh = _trackCounter('harshFrames', valid && (bands.highMid > bands.mid + 9 || bands.high > bands.mid + 11));
        if (harsh >= 50) {
            _upsertAlert({
                code: 'MAIN_HARSHNESS',
                category: 'eq',
                severity: 'warning',
                title: 'Médio-agudos agressivos',
                message: 'A faixa de presença permaneceu elevada. Verifique sibilância, microfones e PA antes de aplicar um corte.',
                confidence: _clamp(0.65 + harsh / 250, 0, 0.92),
                evidence: { midDb: Number(bands.mid.toFixed(1)), highMidDb: Number(bands.highMid.toFixed(1)), highDb: Number(bands.high.toFixed(1)), observedFrames: harsh },
                proposedAction: { type: 'apply_eq_cut', target: 'main', parameters: { frequencyHz: 3200, gainDb: -2, q: 1.4 }, executable: false, requiresConfirmation: true },
            }, now);
        }
    }

    function _detectNoiseAndSignal(frame, now) {
        const noiseClass = /hum|buzz|rumble|noise|static/i.test(frame.classification) && frame.classificationScore >= 0.20;
        const tonalRumble = frame.rmsDb > -60 && frame.rmsDb < -35 && frame.bands.low > frame.bands.mid + 14;
        const noiseFrames = _trackCounter('noiseFrames', noiseClass || tonalRumble);
        if (_settings.categories.noise && noiseFrames >= 75) {
            _upsertAlert({
                code: 'MAIN_NOISE_OR_HUM',
                category: 'noise',
                severity: 'warning',
                title: 'Ruído ou hum persistente',
                message: 'O sinal apresenta ruído de baixa frequência ou classificação de hum persistente. Verifique cabos, aterramento e canais abertos.',
                confidence: _clamp(0.62 + noiseFrames / 250 + (noiseClass ? frame.classificationScore * 0.1 : 0), 0, 0.94),
                evidence: { rmsDb: Number(frame.rmsDb.toFixed(1)), classification: frame.classification || null, classifierScore: Number(frame.classificationScore.toFixed(2)), lowMidDifferenceDb: Number((frame.bands.low - frame.bands.mid).toFixed(1)), observedFrames: noiseFrames },
                proposedAction: { type: 'inspect_signal_path', target: 'main', executable: false },
            }, now);
        }

        const mixerState = window.AppStore?.getState?.() || {};
        const expectedSignal = mixerState.mixerConnected && !mixerState.masterMute && Number(mixerState.masterLevel || 0) > 0.05;
        const silenceFrames = _trackCounter('silenceFrames', expectedSignal && frame.rmsDb < -75);
        if (_settings.categories.signal && silenceFrames >= 125) {
            _upsertAlert({
                code: 'MAIN_SIGNAL_MISSING',
                category: 'signal',
                severity: 'warning',
                title: 'Sinal ausente no Main L/R',
                message: 'A mesa está conectada e o master está aberto, mas a entrada USB permaneceu silenciosa. Verifique roteamento, dispositivo selecionado e retorno USB.',
                confidence: _clamp(0.72 + silenceFrames / 500, 0, 0.95),
                evidence: { rmsDb: Number(frame.rmsDb.toFixed(1)), masterLevel: Number(mixerState.masterLevel || 0), observedFrames: silenceFrames },
                proposedAction: { type: 'inspect_usb_routing', target: 'main', executable: false },
            }, now);
        }
    }

    function _resolveStale(now) {
        const clipping = _activeByCode.get('MAIN_CLIPPING');
        if (clipping && now - clipping.lastSeenAt >= _config.clippingResolveMs) {
            resolveAlert('MAIN_CLIPPING', 'O nível permaneceu abaixo do limite de clipping.', now);
        }

        const feedback = _activeByCode.get('MAIN_FEEDBACK_RISK');
        if (feedback && now - feedback.lastSeenAt >= _config.feedbackResolveMs) {
            resolveAlert('MAIN_FEEDBACK_RISK', 'O pico tonal não permaneceu estável.', now);
        }

        ['MAIN_HEADROOM_LOW', 'MAIN_DYNAMICS_FLAT', 'MAIN_LOW_END_EXCESS', 'MAIN_HARSHNESS', 'MAIN_NOISE_OR_HUM', 'MAIN_SIGNAL_MISSING']
            .forEach(function (code) {
                const alert = _activeByCode.get(code);
                if (alert && now - alert.lastSeenAt >= 7000) {
                    resolveAlert(code, 'A condição não permaneceu presente.', now);
                }
            });
    }

    function ingestFrame(input) {
        const frame = input || {};
        const now = _number(frame.timestamp, Date.now());
        if (_lastIngestAt !== null && now - _lastIngestAt < _config.minFrameIntervalMs) return null;
        _lastIngestAt = now;

        const normalized = {
            sourceMode: frame.sourceMode || _sourceMode,
            truePeakDb: _number(frame.truePeakDb, -120),
            rmsDb: _number(frame.rmsDb, -120),
            isClipping: Boolean(frame.isClipping),
            peakHz: _number(frame.peakHz, 0),
            peakDb: _number(frame.peakDb, -120),
            localFloorDb: _number(frame.localFloorDb, -120),
            classification: String(frame.classification || ''),
            classificationScore: _number(frame.classificationScore, 0),
            bands: {
                low: _number(frame.bands?.low, -120),
                lowMid: _number(frame.bands?.lowMid, -120),
                mid: _number(frame.bands?.mid, -120),
                highMid: _number(frame.bands?.highMid, -120),
                high: _number(frame.bands?.high, -120),
            },
            crestFactor: _number(frame.crestFactor, 0),
        };
        _latestFrame = { ..._copy(normalized), timestamp: now };

        if (_settings.categories.clipping) _detectClipping(normalized, now);
        if (_settings.categories.feedback) _detectFeedback(normalized, now);
        if (_settings.categories.dynamics) _detectLevelAndDynamics(normalized, now);
        if (_settings.categories.eq) _detectTonalBalance(normalized, now);
        if (_settings.categories.noise || _settings.categories.signal) _detectNoiseAndSignal(normalized, now);
        _resolveStale(now);
        return getState();
    }

    function ingestServerRisk(payload) {
        const data = payload || {};
        const risk = _clamp(_number(data.risk, 0), 0, 1);
        if (risk < 0.75) return null;
        const now = _number(data.timestamp, Date.now());
        return _upsertAlert({
            code: 'MAIN_FEEDBACK_RISK',
            category: 'feedback',
            severity: risk >= 0.92 ? 'critical' : 'warning',
            title: 'Risco de microfonia no Main L/R',
            message: 'O diagnóstico do servidor confirmou risco elevado. Nenhum ajuste foi executado.',
            confidence: risk,
            evidence: {
                frequencyHz: Math.round(_number(data.hz, 0)),
                serverRisk: risk,
                source: 'server',
            },
            proposedAction: {
                type: 'apply_eq_cut',
                target: 'main',
                parameters: {
                    frequencyHz: Math.round(_number(data.hz, 0)),
                    gainDb: -3,
                    q: 10,
                },
                executable: false,
                reason: 'Modo sombra: requer validação e confirmação do operador.',
            },
        }, now);
    }

    function _upsertAction(entry) {
        if (!entry) return;
        const key = entry.actionId || entry.clientRequestId;
        if (!key) return;
        const previous = _actions.get(key) || {};
        _actions.set(key, { ...previous, ..._copy(entry) });
        _publish(null, false);
    }

    function _verifyActionAfterAudio(actionId) {
        setTimeout(function () {
            const action = _actions.get(actionId);
            if (!action || action.status !== 'completed' || !action.baselineAudio || !_latestFrame) return;
            const before = action.baselineAudio;
            const after = _copy(_latestFrame);
            let assessment = 'neutral';
            if (before.isClipping && !after.isClipping) assessment = 'improved';
            else if (!before.isClipping && after.isClipping) assessment = 'regressed';
            else if (after.truePeakDb <= before.truePeakDb - 1) assessment = 'improved';
            else if (after.truePeakDb >= before.truePeakDb + 3) assessment = 'regressed';

            _actions.set(actionId, {
                ...action,
                verification: {
                    assessment,
                    measuredAt: Date.now(),
                    before: { truePeakDb: before.truePeakDb, rmsDb: before.rmsDb, crestFactor: before.crestFactor, isClipping: before.isClipping },
                    after: { truePeakDb: after.truePeakDb, rmsDb: after.rmsDb, crestFactor: after.crestFactor, isClipping: after.isClipping },
                },
            });
            _publish(null, false);
        }, 2500);
    }

    function bindSocket() {
        if (_socketBound || !window.SocketService) return;

        window.SocketService.on('sound_assistant_action_pending', function (entry) {
            if (entry?.clientRequestId) _actions.delete(entry.clientRequestId);
            _upsertAction(entry);
        });
        window.SocketService.on('sound_assistant_action_result', function (entry) {
            _upsertAction(entry);
            if (entry?.status === 'completed' && entry.actionId && !entry.undoneAt) {
                _verifyActionAfterAudio(entry.actionId);
            }
        });
        window.SocketService.on('sound_assistant_action_rejected', function (entry) {
            const key = entry?.clientRequestId;
            if (key && _actions.has(key)) {
                _actions.set(key, { ..._actions.get(key), ..._copy(entry), status: 'rejected' });
                _publish(null, false);
            } else {
                _upsertAction(entry);
            }
        });
        window.SocketService.on('sound_assistant_state', function (payload) {
            const serverActions = payload?.actions || [];
            const serverIds = new Set(serverActions.map(function (entry) { return entry.actionId; }).filter(Boolean));
            serverActions.forEach(_upsertAction);
            _actions.forEach(function (entry, key) {
                if (entry.actionId && ['pending', 'confirming', 'processing'].includes(entry.status) && !serverIds.has(entry.actionId)) {
                    _actions.set(key, { ...entry, status: 'expired', error: 'Ação não existe mais no servidor.' });
                }
            });
            _publish(null, false);
        });
        window.SocketService.on('sound_assistant_alert', function (payload) {
            if (!payload || payload.code !== 'MAIN_FEEDBACK_RISK') return;
            ingestServerRisk({
                hz: payload.evidence?.frequencyHz,
                risk: payload.confidence,
                timestamp: payload.timestamp,
            });
        });
        window.SocketService.on('connect', function () {
            window.SocketService.emit('sound_assistant_get_state');
        });

        _socketBound = true;
        window.SocketService.emit('sound_assistant_get_state');
    }

    function proposeAction(command, context) {
        bindSocket();
        const details = context || {};
        const clientRequestId = 'assistant-' + Date.now() + '-' + (++_sequence);
        const placeholder = {
            actionId: null,
            clientRequestId,
            command: _copy(command),
            reason: details.reason || command?.desc || 'Ajuste sugerido pela IA.',
            origin: details.origin || 'ai-chat',
            evidence: _copy(details.evidence || {}),
            status: 'proposing',
            risk: 'pending',
            createdAt: Date.now(),
            expiresAt: null,
            undoAvailable: false,
        };
        _actions.set(clientRequestId, placeholder);
        _publish(null, false);

        if (!window.SocketService || !window.SocketService.isConnected()) {
            _actions.set(clientRequestId, { ...placeholder, status: 'failed', error: 'Servidor em tempo real desconectado.' });
            _publish(null, false);
            return clientRequestId;
        }

        window.SocketService.emit('sound_assistant_propose_action', {
            clientRequestId,
            command: _copy(command),
            reason: placeholder.reason,
            origin: placeholder.origin,
            evidence: placeholder.evidence,
        });
        return clientRequestId;
    }

    function confirmAction(actionId) {
        bindSocket();
        const action = _actions.get(actionId);
        if (!action || action.status !== 'pending') return false;
        _actions.set(actionId, { ...action, status: 'confirming', baselineAudio: _copy(_latestFrame) });
        _publish(null, false);
        window.SocketService.emit('sound_assistant_confirm_action', { actionId });
        return true;
    }

    function rejectAction(actionId) {
        bindSocket();
        const action = _actions.get(actionId);
        if (!action || action.status !== 'pending') return false;
        _actions.set(actionId, { ...action, status: 'rejecting' });
        _publish(null, false);
        window.SocketService.emit('sound_assistant_reject_action', { actionId });
        return true;
    }

    function undoAction(actionId) {
        bindSocket();
        const action = _actions.get(actionId);
        if (!action || action.status !== 'completed' || !action.undoAvailable || action.undoneAt) return false;
        _actions.set(actionId, { ...action, status: 'undoing' });
        _publish(null, false);
        window.SocketService.emit('sound_assistant_undo_action', { actionId });
        return true;
    }

    function beginTask(type, label, origin) {
        _currentTask = {
            id: 'task-' + Date.now() + '-' + (++_sequence),
            type,
            label: label || type,
            origin: origin || 'ai-chat',
            status: 'running',
            progress: 0,
            message: 'Iniciando...',
            startedAt: Date.now(),
            completedAt: null,
            result: null,
            error: null,
        };
        _publish(null, false);
        return _currentTask.id;
    }

    function updateTask(taskId, patch) {
        if (!_currentTask || _currentTask.id !== taskId) return false;
        _currentTask = { ..._currentTask, ..._copy(patch || {}) };
        _publish(null, false);
        return true;
    }

    function completeTask(taskId, result) {
        return updateTask(taskId, {
            status: 'completed',
            progress: 100,
            message: 'Concluído.',
            completedAt: Date.now(),
            result: _copy(result || null),
        });
    }

    function failTask(taskId, error) {
        return updateTask(taskId, {
            status: 'failed',
            message: error?.message || String(error || 'Falha desconhecida.'),
            completedAt: Date.now(),
            error: error?.message || String(error || 'Falha desconhecida.'),
        });
    }

    function _sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function _waitForSocketEvent(eventName, timeoutMs) {
        if (!window.SocketService) return null;
        return new Promise(function (resolve) {
            let finished = false;
            const finish = function (payload) {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                window.SocketService.off(eventName, finish);
                resolve(payload || null);
            };
            const timer = setTimeout(function () { finish(null); }, timeoutMs);
            window.SocketService.on(eventName, finish);
        });
    }

    async function runTask(type, options) {
        const opts = options || {};
        const taskId = beginTask(type, opts.label || type, opts.origin || 'ai-chat');
        const analyzer = window.SoundMasterAnalyzer;
        try {
            if (!analyzer) throw new Error('Analisador de áudio indisponível.');
            if (!analyzer.isAnalyzing()) {
                updateTask(taskId, { progress: 10, message: 'Abrindo a fonte de áudio...' });
                await analyzer.start();
            }

            let payload = {};
            if (type === 'measure') {
                updateTask(taskId, { progress: 25, message: 'Executando sweep e medição RT60...' });
                const waitResult = _waitForSocketEvent('sweep_analysis_result', 30000);
                await analyzer.triggerImpulse();
                await waitResult;
                const rt60 = analyzer.getLastRt60();
                if (!rt60 || !Number.isFinite(Number(rt60.rt60))) throw new Error('Medição RT60 não retornou um valor válido.');
                const analysis = analyzer.getLastAnalysis();
                payload = {
                    summary: analysis?.text || '',
                    spectrum_db: analysis?.details?.spectrum_v11 || {},
                    bands: analysis?.details?.bands || {},
                    rt60_measured: Number(rt60.rt60),
                    rt60_multiband: rt60.multiband || null,
                };
                updateTask(taskId, { progress: 75, message: 'Medição concluída. Gerando interpretação...' });
            } else if (type === 'classify') {
                updateTask(taskId, { progress: 25, message: 'Capturando amostra para classificação...' });
                await _sleep(opts.captureMs || 2500);
                const samples = analyzer.getTimeData();
                if (!samples || !samples.length) throw new Error('Nenhuma amostra de áudio disponível.');
                const sampleRate = analyzer.getFreqData()?.sampleRate || 48000;
                const classification = await window.AIService.classifyAudio(samples, sampleRate, 5, 0.1);
                payload = { classification };
                updateTask(taskId, { progress: 75, message: 'Classificação concluída. Gerando interpretação...' });
            } else {
                updateTask(taskId, { progress: 25, message: 'Capturando e analisando o Main L/R...' });
                await _sleep(opts.captureMs || 4000);
                const analysis = analyzer.getLastAnalysis();
                if (!analysis) throw new Error('Nenhuma análise de áudio disponível.');
                const rt60 = analyzer.getLastRt60();
                payload = {
                    summary: analysis.text,
                    spectrum_db: analysis.details?.spectrum_v11 || {},
                    bands: analysis.details?.bands || {},
                    peakHz: analysis.details?.peakHz,
                    peakDb: analysis.details?.peakDb,
                    rms: analysis.details?.rmsDb,
                    rt60_multiband: rt60?.multiband || null,
                };
                updateTask(taskId, { progress: 75, message: 'Análise concluída. Gerando recomendações...' });
            }

            const mixerState = window.AppStore?.getState?.() || {};
            const channel = Number(opts.channel || 1);
            payload.mixer_context = {
                connected: Boolean(mixerState.mixerConnected),
                masterLevel: Number(mixerState.masterLevel || 0),
                masterDb: mixerState.masterDb,
                masterMute: Boolean(mixerState.masterMute),
                targetChannel: channel,
                channelName: mixerState[`ch_${channel}_name`] || `Canal ${channel}`,
                channelLevel: Number(mixerState[`ch_${channel}_level`] || 0),
                channelMute: Boolean(mixerState[`mute_ch_${channel}`]),
                channelGainDb: mixerState[`hw_${channel}_gain_db`],
            };

            const prompt = opts.prompt || (type === 'measure'
                ? 'Interprete a medição RT60 e sugira melhorias seguras.'
                : type === 'classify'
                    ? 'Interprete a classificação do áudio capturado.'
                    : 'Analise o áudio capturado e sugira melhorias seguras.');
            const result = await window.AIService.ask(prompt, opts.channel || 1, payload);
            if (result?.command && !['start_live_analysis', 'trigger_sweep', 'log'].includes(result.command.action)) {
                proposeAction(result.command, {
                    origin: opts.origin || 'ai-chat',
                    reason: result.text,
                    evidence: payload,
                });
            }
            completeTask(taskId, { type, payload, response: result });
            return result;
        } catch (error) {
            failTask(taskId, error);
            throw error;
        }
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return function () { };
        _listeners.add(listener);
        return function () { _listeners.delete(listener); };
    }

    function configure(patch) {
        const next = patch || {};
        _config = { ..._config, ...next };
        return { ..._config };
    }

    function setSourceMode(mode) {
        if (mode !== 'main-lr' && mode !== 'multichannel') {
            throw new Error('Modo de fonte inválido.');
        }
        _sourceMode = mode;
        _settings.sourceMode = mode;
        _persistSettings();
        _publish(null, false);
    }

    function updateSettings(patch) {
        const next = patch || {};
        const sensitivity = ['conservative', 'balanced', 'sensitive'].includes(next.sensitivity)
            ? next.sensitivity
            : _settings.sensitivity;
        const sourceMode = ['main-lr', 'multichannel'].includes(next.sourceMode)
            ? next.sourceMode
            : _settings.sourceMode;
        const categories = { ..._settings.categories };
        Object.keys(categories).forEach(function (key) {
            if (next.categories && typeof next.categories[key] === 'boolean') categories[key] = next.categories[key];
        });
        _settings = {
            ..._settings,
            sensitivity,
            sourceMode,
            categories,
            confirmationPolicy: 'always',
        };
        _sourceMode = sourceMode;
        const presets = {
            conservative: { feedbackMinFrames: 12, feedbackMinProminenceDb: 10, feedbackConfidence: 0.90 },
            balanced: { feedbackMinFrames: 8, feedbackMinProminenceDb: 7, feedbackConfidence: 0.82 },
            sensitive: { feedbackMinFrames: 6, feedbackMinProminenceDb: 5, feedbackConfidence: 0.76 },
        };
        _config = { ..._config, ...presets[sensitivity] };
        _persistSettings();
        _publish(null, false);
        return _copy(_settings);
    }

    function getSettings() {
        return _copy(_settings);
    }

    function getAlerts() {
        return _alerts.map(_copy);
    }

    function getActions() {
        return _actionList();
    }

    function getState() {
        return {
            mode: _mode,
            sourceMode: _sourceMode,
            activeCount: _activeAlerts().length,
            alerts: getAlerts(),
            actions: getActions(),
            pendingCount: getActions().filter(function (entry) { return ['pending', 'proposing', 'confirming', 'processing'].includes(entry.status); }).length,
            currentTask: _copy(_currentTask),
            settings: getSettings(),
            config: { ..._config },
        };
    }

    function reset() {
        _alerts.length = 0;
        _activeByCode.clear();
        Object.keys(_detectors).forEach(function (key) {
            _detectors[key] = key === 'feedbackHistory' ? [] : 0;
        });
        _lastIngestAt = null;
        _publish(null, false);
    }

    window.SoundAssistantService = {
        ingestFrame,
        ingestServerRisk,
        subscribe,
        resolveAlert,
        configure,
        bindSocket,
        proposeAction,
        confirmAction,
        rejectAction,
        undoAction,
        beginTask,
        updateTask,
        completeTask,
        failTask,
        runTask,
        setSourceMode,
        updateSettings,
        getSettings,
        getAlerts,
        getActions,
        getState,
        reset,
    };

    updateSettings(_settings);
    setTimeout(bindSocket, 0);
})();

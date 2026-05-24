/**
 * SoundMaster Page Bridge
 * Bridges global services and state stores from the parent Shell context
 * into the isolated iframe window context.
 */

'use strict';

(function () {
    if (window.self !== window.parent) {
        console.log('[PageBridge] Bridging parent context services...');

        // List of all services, singletons, and global variables to bridge
        const servicesToBridge = [
            'store',
            // AppStore uses a custom proxy below for cross-frame sync
            'socket',
            'router',
            'AuthService',
            'SocketService',
            'MixerService',
            'SignalGeneratorService',
            'SoundMasterAnalyzer',
            'SimulationService',
            'SoundMasterVisualizer',
            'Crosshair',
            'AcousticCalibration',
            'ChartExport',
            'SoundMasterLayout',
            'SoundMasterMixerPanel',
            'SoundMasterTour',
            'SoundMasterAIChat',
            'OnboardingService',
            'AIService',
            'SpatialAverager',
            'SpatialAveragerService',
            'SchroederRenderer',
            'SchroederRendererService',
            'HeatmapRenderer',
            'HeatmapRendererService',
            'AutoEqRenderer',
            'AutoEqRendererService',
            'AutoEQ',
            'AutoEqService',
            'FeedbackDetectorService',
            'MtwManager',
            'MtwManagerService',
            'SceneBuilderService',
            'AutoMixerService',
            'AutomixerService',
            'SplLogger',
            'SplLoggerService',
            'UpdaterService',
            'VolunteerPage',
            'VolunteerMode',
            'RT60Mapping',
            'SoundMasterMapping',
            'SoundMasterHeatmap',
            'eqData',
            '_sendAnalysisToAI',
            'FeedbackDetectorModule',
            'SignalGeneratorController',
            'SplDisplayModule',
            'AutomixController',
            'currentGlobalRMS'
        ];

        servicesToBridge.forEach(serviceName => {
            Object.defineProperty(window, serviceName, {
                get: () => window.parent[serviceName],
                set: (value) => { window.parent[serviceName] = value; },
                configurable: true,
                enumerable: true
            });
        });

        // Bridge standard global dialog redirects for UI consistency
        window.alert = function (message) {
            if (window.parent && window.parent.alert) {
                window.parent.alert(message);
            } else {
                alert(message);
            }
        };

        window.confirm = function (message) {
            if (window.parent && window.parent.confirm) {
                return window.parent.confirm(message);
            }
            return confirm(message);
        };

        // Estado local no iframe sincronizado com o parent
        const _localState = { ...window.parent.AppStore.getState() };
        const _localListeners = {};

        // Escutar atualizações do parent e replicar localmente
        window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'APPSTORE_UPDATE') {
                Object.assign(_localState, e.data.patch);
                e.data.keys.forEach(function (key) {
                    if (_localListeners[key]) {
                        _localListeners[key].forEach(function (fn) {
                            try { fn(_localState[key], _localState); } catch (err) {
                                console.error('[PageBridge] Erro no subscriber local de "' + key + '":', err);
                            }
                        });
                    }
                });
            }
        });

        // Proxy para AppStore: cross-frame sync via postMessage sem reter referências de callbacks
        Object.defineProperty(window, 'AppStore', {
            get: () => {
                const parentStore = window.parent.AppStore;
                if (!parentStore) return undefined;

                return {
                    subscribe: function (key, fn) {
                        if (!_localListeners[key]) _localListeners[key] = [];
                        _localListeners[key].push(fn);
                        return function unsubscribe() {
                            _localListeners[key] = _localListeners[key].filter(function (f) { return f !== fn; });
                        };
                    },
                    setState: function (patch) {
                        // Envia para o parent aplicar e disparar APPSTORE_UPDATE de volta
                        window.parent.postMessage({ type: 'APPSTORE_PATCH', patch: patch }, '*');
                    },
                    getState: function () {
                        return _localState;
                    },
                    addLog: function (text) {
                        parentStore.addLog(text);
                    },
                    addAISuggestion: function (s) {
                        parentStore.addAISuggestion(s);
                    }
                };
            },
            configurable: true,
            enumerable: true
        });
    }
})();

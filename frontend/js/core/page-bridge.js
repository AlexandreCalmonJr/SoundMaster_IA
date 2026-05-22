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
            'SoundMasterChurchTools',
            'RT60Mapping',
            'SoundMasterMappings',
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

        // Proxy para AppStore: cross-frame sync via postMessage
        // - setState() no iframe → postMessage para o parent → parent aplica e notifica todos
        // - setState() no parent → postMessage para o iframe → iframe aplica localmente
        Object.defineProperty(window, 'AppStore', {
            get: () => {
                const parentStore = window.parent.AppStore;
                if (!parentStore) return undefined;

                return {
                    subscribe: function (key, fn) {
                        // Subscreve no parent diretamente (o parent já notifica via postMessage)
                        return parentStore.subscribe(key, fn);
                    },
                    setState: function (patch) {
                        // Envia para o parent aplicar
                        window.parent.postMessage({ type: 'APPSTORE_PATCH', patch: patch }, '*');
                        // Aplica localmente também para reatividade imediata
                        parentStore.setState(patch);
                    },
                    getState: function () {
                        return parentStore.getState();
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

        // Escutar atualizações do parent e replicar localmente
        window.addEventListener('message', function (e) {
            if (e.data && e.data.type === 'APPSTORE_UPDATE') {
                const parentStore = window.parent.AppStore;
                if (parentStore) {
                    // O parentStore setState já notifica subscribers locais via message
                    // mas precisamos garantir que o estado interno do parent foi atualizado
                    // O parent já fez setState, então os subscribers locais já foram notificados
                }
            }
        });
    }
})();

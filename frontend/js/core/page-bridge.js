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
            'AppStore',
            'socket',
            'router',
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
            'SemanticEqUI',
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
            '_sendAnalysisToAI'
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
    }
})();

(function () {
    'use strict';

    const STORAGE_KEY = 'soundmaster_scenes';
    let _scenesCache = null;
    let _cacheValid = false;

    function _invalidateCache() { _cacheValid = false; }

    function loadScenes() {
        if (_cacheValid && _scenesCache) return _scenesCache;
        try { 
            _scenesCache = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; 
            _cacheValid = true;
            return _scenesCache; 
        } catch (_) { 
            _scenesCache = []; 
            _cacheValid = true;
            return _scenesCache; 
        }
    }

    function saveScenes(scenes) {
        try { 
            _scenesCache = scenes;
            _cacheValid = true;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes)); 
        }
        catch (e) { AppStore.addLog('⚠️ Falha ao salvar cenas: ' + e.message); }
    }

    function createScene(data) {
        const scenes = loadScenes();
        const scene = Object.assign({
            name: 'Nova Cena',
            genre: 'geral',
            description: '',
            mixType: 'Estereo',
            channels: 16,
            timestamp: Date.now(),
            id: Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)
        }, data);
        scenes.push(scene);
        saveScenes(scenes);
        return scene;
    }

    function updateScene(id, data) {
        const scenes = loadScenes();
        const idx = scenes.findIndex(function (s) { return s.id === id; });
        if (idx > -1) {
            scenes[idx] = Object.assign(scenes[idx], data, { timestamp: Date.now() });
            saveScenes(scenes);
            return scenes[idx];
        }
        return null;
    }

    function deleteScene(id) {
        const scenes = loadScenes();
        const filtered = scenes.filter(function (s) { return s.id !== id; });
        saveScenes(filtered);
    }

    async function generateWithAI(prompt, instruments) {
        if (!window.AIService) {
            throw new Error('AIService não disponível');
        }
        const instArray = Array.isArray(instruments) ? instruments : Array.from(instruments || []);
        const instList = instArray.join(', ');
        const fullPrompt = 'Gere uma cena de mixer completa para: ' + prompt + '. Instrumentos presentes: ' + instList + '. Retorne o nome da cena, genre, descrição e comandos de mixer.';
        let result;
        try {
            result = await AIService.ask(fullPrompt, 1);
        } catch (err) {
            console.error('[SceneBuilder] Erro na geração IA:', err);
            AppStore.addLog('⚠️ IA offline. Cena não gerada.');
            return createScene({ name: 'IA: ' + prompt.substring(0, 25), genre: 'louvor', description: prompt });
        }
        const scene = createScene({
            name: 'IA: ' + prompt.substring(0, 25),
            genre: 'louvor',
            description: prompt,
            aiData: result.text,
            mixerCommand: result.command || null
        });
        return scene;
    }

    function applyScene(scene) {
        if (!scene) {
            AppStore.addLog('⚠️ Cena inválida para aplicar.');
            return false;
        }
        if (window.MixerService && scene.mixerCommand) {
            MixerService.executeAICommand(scene.mixerCommand);
        }
        AppStore.addLog('[Scene Builder] Cena "' + scene.name + '" aplicada.');
        return true;
    }

    function getSceneById(id) {
        return loadScenes().find(function (s) { return s.id === id; }) || null;
    }

    function getScenesByGenre(genre) {
        return loadScenes().filter(function (s) { return s.genre === genre; });
    }

    window.SceneBuilderService = {
        loadScenes,
        createScene,
        updateScene,
        deleteScene,
        generateWithAI,
        applyScene,
        getSceneById,
        getScenesByGenre
    };
})();

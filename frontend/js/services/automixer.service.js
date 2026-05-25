(function () {
    'use strict';

    const STORAGE_KEY = 'sm_automix_state';

    function saveState(state) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {}
    }

    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) { return {}; }
    }

    function setGroupEnabled(group, enabled) {
        if (!SocketService.isConnected()) {
            AppStore.addLog('⚠️ Conecte-se à mesa para usar o Auto-Mixer.');
            return;
        }
        const action = (enabled ? 'enable_' : 'disable_') + group;
        SocketService.emit('automix_cmd', { action_type: action });
        const state = loadState();
        state['group_' + group] = enabled;
        saveState(state);
    }

    function assignChannel(channel, group, weight) {
        if (!SocketService.isConnected()) {
            AppStore.addLog('⚠️ Conecte-se à mesa para atribuir canais.');
            return;
        }
        SocketService.emit('automix_cmd', {
            action_type: 'assign_channel',
            channel: channel,
            group: group,
            weight: (weight != null && !isNaN(weight)) ? weight : 0.5
        });
        const state = loadState();
        if (!state.assignments) state.assignments = {};
        state.assignments[channel] = { group: group, weight: (weight != null && !isNaN(weight)) ? weight : 0.5 };
        saveState(state);
    }

    function setResponseTime(ms) {
        if (!SocketService.isConnected()) return;
        MixerService.automixControl('set_response', ms);
        const state = loadState();
        state.responseTime = ms;
        saveState(state);
    }

    function activateAll(group) {
        if (!SocketService.isConnected()) return;
        SocketService.emit('automix_cmd', { action_type: 'enable_' + group });
    }

    function deactivateAll() {
        if (!SocketService.isConnected()) return;
        SocketService.emit('automix_cmd', { action_type: 'disable_a' });
        SocketService.emit('automix_cmd', { action_type: 'disable_b' });
    }

    function resetWeights() {
        if (!SocketService.isConnected()) return;
        SocketService.emit('automix_cmd', { action_type: 'reset_weights' });
        saveState({});
    }

    window.AutoMixerService = {
        setGroupEnabled,
        assignChannel,
        setResponseTime,
        activateAll,
        deactivateAll,
        resetWeights,
        loadState
    };
})();

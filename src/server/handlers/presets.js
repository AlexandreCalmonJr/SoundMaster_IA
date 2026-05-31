function registerPresetHandlers(io, socket, deps) {
    const { actions, logger, mixerSingleton, rateLimiter, db, globalHistoryStack, globalRedoStack } = deps;

    socket.on('save_preset', (data) => {
        if (!rateLimiter(socket, 'save_preset')) return;
        const preset = {
            name: data.name || `Preset ${new Date().toLocaleString()}`,
            timestamp: Date.now(),
            state: JSON.parse(JSON.stringify(mixerSingleton.getState()))
        };
        db.presets.insert(preset, (err, doc) => {
            if (err) {
                logger.error(socket.id, 'SAVE_PRESET_ERROR', { error: err.message });
                socket.emit('mixer_status', { connected: true, msg: 'Erro ao salvar preset' });
            } else {
                logger.info(socket.id, 'PRESET_SAVED', { name: preset.name });
                socket.emit('preset_saved', doc);
            }
        });
    });

    socket.on('list_presets', () => {
        db.presets.find({}).sort({ timestamp: -1 }).exec((err, docs) => {
            if (err) {
                logger.error(socket.id, 'LIST_PRESETS_ERROR', { error: err.message });
                socket.emit('presets_error', { message: 'Failed to load presets' });
            } else {
                socket.emit('presets_list', docs);
            }
        });
    });

    socket.on('load_preset', (id) => {
        if (!rateLimiter(socket, 'load_preset')) return;
        if (!actions.ensureMixer(socket)) return;
        db.presets.findOne({ _id: id }, (err, doc) => {
            if (!err && doc) {
                try {
                    logger.info(socket.id, 'LOAD_PRESET_START', { name: doc.name });
                    if (doc.state.master) {
                        const mixer = mixerSingleton.getMixer();
                        mixer.master.setFaderLevel(doc.state.master.level);
                    }
                    if (doc.state.inputs && Array.isArray(doc.state.inputs)) {
                        doc.state.inputs.forEach((inputState, idx) => {
                            const ch = idx + 1;
                            if (ch > 24) return;
                            const mixer = mixerSingleton.getMixer();
                            const input = mixer.master.input(ch);
                            if (!input) return;
                            if (inputState.level !== undefined) input.setFaderLevel(inputState.level);
                            if (inputState.mute !== undefined) {
                                if (inputState.mute) input.mute(); else input.unmute();
                            }
                        });
                    }
                    logger.info(socket.id, 'LOAD_PRESET_SUCCESS', { name: doc.name });
                    socket.emit('feedback_cut_success', { msg: `Preset "${doc.name}" carregado com sucesso!` });
                    socket.emit('mixer_log', `Preset "${doc.name}" aplicado.`);
                } catch (e) {
                    logger.error(socket.id, 'LOAD_PRESET_ERROR', { name: doc.name, error: e.message });
                    socket.emit('mixer_status', { connected: true, msg: 'Erro ao aplicar preset: ' + e.message });
                }
            }
        });
    });

    socket.on('undo_command', () => {
        const cmd = globalHistoryStack.pop();
        if (cmd) {
            globalRedoStack.push(cmd);
            socket.emit('mixer_log', 'Undo: Comando revertido (Simulado/Visual)');
        }
    });
}

module.exports = { registerPresetHandlers };
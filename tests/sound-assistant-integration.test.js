import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(path) {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('Sound Assistant end-to-end module integration', () => {
    it('loads the central service and global center in the shell', () => {
        const index = read('frontend/index.html');
        const bridge = read('frontend/js/core/page-bridge.js');
        expect(index).toContain('js/services/sound-assistant.service.js');
        expect(index).toContain('js/ui/sound-assistant-center.js');
        expect(bridge).toContain("'SoundAssistantService'");
        expect(bridge).toContain("'SoundAssistantCenter'");
    });

    it('connects analyzer frames and AI analysis tasks to the assistant', () => {
        const analyzer = read('frontend/js/core/analyzer.js');
        const aiService = read('frontend/js/services/ai.service.js');
        const aiChat = read('frontend/js/pages/ai-chat-page.js');
        expect(analyzer).toContain('window.SoundAssistantService.ingestFrame({');
        expect(aiService).toContain("SoundAssistantService.runTask('analyze'");
        expect(aiChat).toContain("SoundAssistantService.runTask('measure'");
        expect(aiChat).toContain("SoundAssistantService.runTask('classify'");
    });

    it('routes mixer AI commands to proposal and confirmation instead of direct execution', () => {
        const mixerService = read('frontend/js/services/mixer.service.js');
        const mixerHandlers = read('src/server/handlers/mixer-commands.js');
        const assistantHandler = read('src/server/handlers/sound-assistant.js');
        expect(mixerService).toContain('assistant.proposeAction(command');
        expect(mixerService).not.toContain("_emit('execute_ai_command', command");
        expect(mixerHandlers).toContain('DIRECT_AI_COMMAND_BLOCKED');
        expect(assistantHandler).toContain("socket.on('sound_assistant_confirm_action'");
        expect(assistantHandler).toContain("socket.on('sound_assistant_undo_action'");
    });

    it('integrates measurement corrections and settings with the global center', () => {
        const rt60 = read('frontend/js/pages/rt60-page.js');
        const settings = read('frontend/pages/settings.html');
        const settingsPage = read('frontend/js/pages/settings-page.js');
        const mixerPage = read('frontend/js/pages/mixer-input-page.js');
        expect(rt60).toContain('SoundAssistantService.proposeAction(command');
        expect(rt60).not.toContain("socket.emit('rt60_apply_all'");
        expect(settings).toContain('sound-assistant-sensitivity');
        expect(settings).toContain('Sempre pedir confirmação');
        expect(settingsPage).toContain('assistant.updateSettings({');
        expect(mixerPage).toContain("mountSummary(pm._el('mixer-assistant-summary'))");
    });

    it('keeps autonomous AI execution disabled in home and chat', () => {
        const store = read('frontend/js/store/app.store.js');
        const home = read('frontend/pages/home.html');
        const chat = read('frontend/pages/ai-chat.html');
        expect(store).toContain('aiAutonomousMode: false');
        expect(home).toContain('Confirmação obrigatória');
        expect(chat).toContain('Confirmação obrigatória');
        expect(home).not.toContain('home-toggle-autonomous');
        expect(chat).not.toContain('chat-toggle-autonomous');
    });
});

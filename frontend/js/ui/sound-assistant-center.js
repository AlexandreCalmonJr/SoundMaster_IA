(function () {
    'use strict';

    let _drawer = null;
    let _backdrop = null;
    let _headerButton = null;
    let _badge = null;
    let _unsubscribe = null;
    const _summaryMounts = new Set();

    function _doc() { return document; }

    function _style(element, styles) {
        Object.assign(element.style, styles);
        return element;
    }

    function _button(text, action, primary) {
        const button = _doc().createElement('button');
        button.type = 'button';
        button.textContent = text;
        button.dataset.assistantAction = action;
        _style(button, {
            border: primary ? '1px solid var(--sm-accent-border)' : '1px solid var(--sm-border-strong)',
            background: primary ? 'var(--sm-accent-soft)' : 'var(--sm-bg-control)',
            color: primary ? 'var(--sm-accent)' : 'var(--sm-text-primary)',
            borderRadius: 'var(--sm-radius-sm)',
            minHeight: '40px',
            padding: '8px 12px',
            fontSize: '12px',
            fontWeight: '700',
            cursor: 'pointer',
        });
        return button;
    }

    function _sectionTitle(text, count) {
        const row = _doc().createElement('div');
        _style(row, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' });
        const title = _doc().createElement('h3');
        title.textContent = text;
        _style(title, { margin: '0', color: 'var(--sm-text-primary)', fontSize: '11px', fontWeight: '750', textTransform: 'uppercase', letterSpacing: '.08em' });
        row.appendChild(title);
        if (count !== undefined) {
            const badge = _doc().createElement('span');
            badge.textContent = String(count);
            _style(badge, { color: 'var(--sm-accent)', background: 'var(--sm-accent-soft)', border: '1px solid var(--sm-accent-border)', borderRadius: 'var(--sm-radius-pill)', padding: '3px 8px', fontSize: '10px', fontWeight: '800' });
            row.appendChild(badge);
        }
        return row;
    }

    function _formatCommand(command) {
        if (!command) return 'Comando não informado';
        const fields = [];
        if (command.target) fields.push(command.target);
        if (command.channel) fields.push('canal ' + command.channel);
        if (command.aux) fields.push('aux ' + command.aux);
        if (Number.isFinite(command.hz)) fields.push(Math.round(command.hz) + ' Hz');
        if (Number.isFinite(command.gain)) fields.push(command.gain + ' dB');
        if (Number.isFinite(command.level)) fields.push(Math.round(command.level * 100) + '%');
        if (Number.isFinite(command.levelDb)) fields.push(command.levelDb + ' dB');
        if (Number.isFinite(command.ms)) fields.push(command.ms + ' ms');
        return (command.desc || command.action || 'Ajuste') + (fields.length ? ' · ' + fields.join(' · ') : '');
    }

    function _cardBase() {
        const card = _doc().createElement('article');
        _style(card, {
            border: '1px solid var(--sm-border)',
            background: 'var(--sm-bg-panel)',
            borderRadius: 'var(--sm-radius-lg)',
            padding: '14px',
            boxShadow: 'var(--sm-shadow-card)',
            marginBottom: '8px',
        });
        return card;
    }

    function _renderAlert(alert) {
        const card = _cardBase();
        card.style.borderColor = alert.severity === 'critical' ? 'rgba(248,113,113,.35)' : 'rgba(251,191,36,.28)';
        const title = _doc().createElement('strong');
        title.textContent = alert.title || alert.code;
        _style(title, { display: 'block', color: alert.severity === 'critical' ? '#fca5a5' : '#fcd34d', fontSize: '12px' });
        const message = _doc().createElement('p');
        message.textContent = alert.message || '';
        _style(message, { color: 'var(--sm-text-secondary)', fontSize: '12px', lineHeight: '1.55', margin: '7px 0' });
        const meta = _doc().createElement('div');
        const confidence = Math.round(Number(alert.confidence || 0) * 100);
        const frequency = alert.evidence?.frequencyHz ? ' · ' + Math.round(alert.evidence.frequencyHz) + ' Hz' : '';
        meta.textContent = confidence + '% de confiança' + frequency + ' · nenhum ajuste executado';
        _style(meta, { color: 'var(--sm-text-muted)', fontSize: '10px', fontFamily: 'var(--sm-font-mono)' });
        card.append(title, message, meta);

        if (alert.proposedAction?.type === 'apply_eq_cut' && alert.proposedAction?.parameters) {
            const review = _button('Revisar ajuste sugerido', 'prepare-alert', false);
            review.dataset.alertCode = alert.code;
            review.style.marginTop = '10px';
            card.appendChild(review);
        }
        return card;
    }

    function _renderAction(entry) {
        const card = _cardBase();
        const pending = entry.status === 'pending';
        const failed = entry.status === 'failed' || entry.status === 'rejected';
        card.style.borderColor = pending ? 'rgba(34,211,238,.32)' : failed ? 'rgba(248,113,113,.28)' : 'rgba(74,222,128,.22)';

        const header = _doc().createElement('div');
        _style(header, { display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start' });
        const title = _doc().createElement('strong');
        title.textContent = _formatCommand(entry.command);
        _style(title, { color: 'var(--sm-text-strong)', fontSize: '13px', lineHeight: '1.4' });
        const status = _doc().createElement('span');
        status.textContent = entry.status || 'pendente';
        _style(status, { color: pending ? '#67e8f9' : failed ? '#fca5a5' : '#86efac', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase' });
        header.append(title, status);
        card.appendChild(header);

        if (entry.reason) {
            const reason = _doc().createElement('p');
            reason.textContent = entry.reason;
            _style(reason, { color: 'var(--sm-text-secondary)', fontSize: '11px', lineHeight: '1.55', margin: '8px 0' });
            card.appendChild(reason);
        }
        if (entry.result || entry.error) {
            const result = _doc().createElement('p');
            result.textContent = entry.error || entry.result;
            _style(result, { color: entry.error ? 'var(--sm-danger)' : 'var(--sm-success)', fontSize: '11px', lineHeight: '1.5', margin: '8px 0' });
            card.appendChild(result);
        }
        if (entry.verification) {
            const verification = _doc().createElement('p');
            const labels = { improved: 'melhora observada', neutral: 'efeito neutro ou inconclusivo', regressed: 'possível regressão' };
            verification.textContent = 'Verificação pós-ajuste: ' + (labels[entry.verification.assessment] || entry.verification.assessment) + '.';
            _style(verification, { color: entry.verification.assessment === 'regressed' ? 'var(--sm-danger)' : entry.verification.assessment === 'improved' ? 'var(--sm-success)' : 'var(--sm-warning)', fontSize: '11px', lineHeight: '1.5', margin: '8px 0' });
            card.appendChild(verification);
        }

        const actions = _doc().createElement('div');
        _style(actions, { display: 'flex', gap: '7px', marginTop: '10px', flexWrap: 'wrap' });
        if (pending) {
            const reject = _button('Ignorar', 'reject', false);
            reject.dataset.actionId = entry.actionId;
            const confirm = _button(entry.risk === 'high' ? 'Confirmar ajuste de alto impacto' : 'Confirmar e aplicar', 'confirm', true);
            confirm.dataset.actionId = entry.actionId;
            actions.append(reject, confirm);
        } else if (entry.status === 'completed' && entry.undoAvailable && !entry.undoneAt) {
            const undo = _button('Desfazer', 'undo', false);
            undo.dataset.actionId = entry.actionId;
            actions.appendChild(undo);
        }
        if (actions.childNodes.length) card.appendChild(actions);
        return card;
    }

    function _renderTask(task) {
        const box = _doc().createElement('div');
        _style(box, { border: '1px solid var(--sm-accent-border)', background: 'var(--sm-accent-soft)', borderRadius: 'var(--sm-radius-lg)', padding: '14px', marginBottom: '16px' });
        const title = _doc().createElement('strong');
        title.textContent = task.label || task.type || 'Tarefa da IA';
        _style(title, { display: 'block', color: '#cffafe', fontSize: '12px' });
        const message = _doc().createElement('p');
        message.textContent = task.message || task.status;
        _style(message, { color: 'var(--sm-text-secondary)', fontSize: '11px', lineHeight: '1.5', margin: '6px 0 9px' });
        const track = _doc().createElement('div');
        _style(track, { height: '5px', borderRadius: '999px', background: '#1e293b', overflow: 'hidden' });
        const fill = _doc().createElement('div');
        _style(fill, { height: '100%', width: Math.max(2, Number(task.progress || 0)) + '%', background: task.status === 'failed' ? '#f87171' : '#22d3ee', transition: 'width .25s ease' });
        track.appendChild(fill);
        box.append(title, message, track);
        return box;
    }

    function _renderSummaryMount(mount, state) {
        if (!mount?.isConnected) { _summaryMounts.delete(mount); return; }
        mount.replaceChildren();
        const row = _doc().createElement('div');
        _style(row, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: '1px solid var(--sm-accent-border)', background: 'var(--sm-bg-panel)', borderRadius: 'var(--sm-radius-lg)', padding: '13px 15px', boxShadow: 'var(--sm-shadow-card)' });
        const text = _doc().createElement('div');
        const title = _doc().createElement('strong');
        title.textContent = 'Assistente de operação sonora';
        _style(title, { color: 'var(--sm-text-strong)', display: 'block', fontSize: '12px' });
        const meta = _doc().createElement('span');
        meta.textContent = state.activeCount + ' alertas · ' + state.pendingCount + ' ações pendentes · confirmação obrigatória';
        _style(meta, { color: 'var(--sm-text-muted)', fontSize: '10px', lineHeight: '1.4' });
        text.append(title, meta);
        const openButton = _button('Abrir central', 'open', false);
        openButton.addEventListener('click', open);
        row.append(text, openButton);
        mount.appendChild(row);
    }

    function render(_event, suppliedState) {
        const service = window.SoundAssistantService;
        const state = suppliedState || service?.getState?.();
        if (!state || !_drawer) return;

        const count = state.activeCount + state.pendingCount;
        if (_badge) {
            _badge.textContent = String(count);
            _badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }

        const content = _drawer.querySelector('[data-assistant-content]');
        if (!content) return;
        content.replaceChildren();

        if (state.currentTask && state.currentTask.status === 'running') content.appendChild(_renderTask(state.currentTask));

        const activeAlerts = (state.alerts || []).filter((alert) => alert.status === 'active');
        const pendingActions = (state.actions || []).filter((entry) => ['pending', 'proposing', 'confirming', 'processing'].includes(entry.status));
        const historyActions = (state.actions || []).filter((entry) => !['pending', 'proposing', 'confirming', 'processing'].includes(entry.status)).slice(0, 10);

        const alertsSection = _doc().createElement('section');
        alertsSection.appendChild(_sectionTitle('Alertas ativos', activeAlerts.length));
        if (activeAlerts.length) activeAlerts.forEach((alert) => alertsSection.appendChild(_renderAlert(alert)));
        else {
            const empty = _doc().createElement('p');
            empty.textContent = 'Nenhum alerta ativo.';
            _style(empty, { color: '#64748b', fontSize: '11px', margin: '0 0 18px' });
            alertsSection.appendChild(empty);
        }
        content.appendChild(alertsSection);

        const pendingSection = _doc().createElement('section');
        _style(pendingSection, { marginTop: '18px' });
        pendingSection.appendChild(_sectionTitle('Aguardando confirmação', pendingActions.length));
        if (pendingActions.length) pendingActions.forEach((entry) => pendingSection.appendChild(_renderAction(entry)));
        else {
            const empty = _doc().createElement('p');
            empty.textContent = 'Nenhum ajuste aguardando confirmação.';
            _style(empty, { color: '#64748b', fontSize: '11px', margin: '0' });
            pendingSection.appendChild(empty);
        }
        content.appendChild(pendingSection);

        if (historyActions.length) {
            const history = _doc().createElement('section');
            _style(history, { marginTop: '18px' });
            history.appendChild(_sectionTitle('Histórico recente', historyActions.length));
            historyActions.forEach((entry) => history.appendChild(_renderAction(entry)));
            content.appendChild(history);
        }

        _summaryMounts.forEach((mount) => _renderSummaryMount(mount, state));
    }

    function open() {
        if (!_drawer || !_backdrop) return;
        _backdrop.hidden = false;
        _drawer.hidden = false;
        requestAnimationFrame(function () {
            _backdrop.style.opacity = '1';
            _drawer.style.transform = 'translateX(0)';
        });
        _drawer.setAttribute('aria-hidden', 'false');
    }

    function close() {
        if (!_drawer || !_backdrop) return;
        _backdrop.style.opacity = '0';
        _drawer.style.transform = 'translateX(100%)';
        _drawer.setAttribute('aria-hidden', 'true');
        setTimeout(function () {
            _backdrop.hidden = true;
            _drawer.hidden = true;
        }, 180);
    }

    function toggle() {
        if (_drawer?.hidden) open(); else close();
    }

    function mountSummary(target) {
        const element = typeof target === 'string' ? _doc().getElementById(target) : target;
        if (!element) return function () { };
        _summaryMounts.add(element);
        render();
        return function () { _summaryMounts.delete(element); };
    }

    function _handleActionClick(event) {
        const button = event.target.closest('[data-assistant-action]');
        if (!button) return;
        const action = button.dataset.assistantAction;
        const actionId = button.dataset.actionId;
        const service = window.SoundAssistantService;
        if (action === 'open') open();
        else if (action === 'close') close();
        else if (action === 'confirm' && actionId) service.confirmAction(actionId);
        else if (action === 'reject' && actionId) service.rejectAction(actionId);
        else if (action === 'undo' && actionId) service.undoAction(actionId);
        else if (action === 'prepare-alert') {
            const alertCode = button.dataset.alertCode;
            const alert = service.getAlerts().find(function (item) { return item.code === alertCode && item.status === 'active'; });
            const proposal = alert?.proposedAction;
            if (alert && proposal?.type === 'apply_eq_cut' && proposal.parameters) {
                service.proposeAction({
                    action: 'eq_cut',
                    desc: alert.title,
                    target: proposal.target === 'channel' ? 'channel' : 'master',
                    channel: proposal.channel || undefined,
                    hz: Number(proposal.parameters.frequencyHz),
                    gain: Number(proposal.parameters.gainDb),
                    q: Number(proposal.parameters.q || 1),
                    band: Number(proposal.parameters.band || 4),
                }, {
                    origin: 'alert-center',
                    reason: alert.message,
                    evidence: alert.evidence || {},
                });
            }
        }
        else if (action === 'settings') {
            close();
            window.router?.navigate?.('settings');
        }
    }

    function init() {
        if (_drawer || !window.SoundAssistantService) return;
        const doc = _doc();
        const headerRight = doc.querySelector('.header-right');

        _headerButton = doc.createElement('button');
        _headerButton.type = 'button';
        _headerButton.className = 'header-btn';
        _headerButton.title = 'Assistente de operação sonora';
        _headerButton.setAttribute('aria-label', 'Abrir central do assistente de operação sonora');
        _headerButton.dataset.assistantAction = 'open';
        _headerButton.textContent = 'AI';
        _style(_headerButton, { position: 'relative', fontSize: '10px', fontWeight: '900', letterSpacing: '.04em' });
        _badge = doc.createElement('span');
        _style(_badge, { display: 'none', position: 'absolute', top: '-5px', right: '-5px', minWidth: '17px', height: '17px', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--sm-radius-pill)', background: 'var(--sm-danger)', color: '#fff', fontSize: '10px', fontWeight: '800', padding: '0 4px' });
        _headerButton.appendChild(_badge);
        headerRight?.insertBefore(_headerButton, headerRight.firstChild);

        _backdrop = doc.createElement('div');
        _backdrop.hidden = true;
        _backdrop.dataset.assistantAction = 'close';
        _style(_backdrop, { position: 'fixed', inset: '0', background: 'rgba(2,6,23,.72)', zIndex: '99990', opacity: '0', transition: 'opacity .18s ease' });

        _drawer = doc.createElement('aside');
        _drawer.hidden = true;
        _drawer.setAttribute('aria-hidden', 'true');
        _drawer.setAttribute('aria-label', 'Central do assistente de operação sonora');
        _style(_drawer, { position: 'fixed', top: '0', right: '0', bottom: '0', width: 'min(440px, 96vw)', background: 'var(--sm-bg-shell)', borderLeft: '1px solid var(--sm-border-strong)', boxShadow: 'var(--sm-shadow-raised)', zIndex: '99991', transform: 'translateX(100%)', transition: 'transform var(--sm-transition)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--sm-font-sans)' });

        const header = doc.createElement('header');
        _style(header, { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px', padding: '20px', borderBottom: '1px solid var(--sm-border)' });
        const headingWrap = doc.createElement('div');
        const heading = doc.createElement('h2');
        heading.textContent = 'Assistente de operação sonora';
        _style(heading, { color: 'var(--sm-text-strong)', fontSize: '17px', lineHeight: '1.25', margin: '0 0 5px', fontWeight: '750', letterSpacing: '-.015em' });
        const sub = doc.createElement('p');
        sub.textContent = 'Main L/R · confirmação obrigatória';
        _style(sub, { color: 'var(--sm-text-muted)', fontSize: '11px', lineHeight: '1.4', margin: '0' });
        headingWrap.append(heading, sub);
        const headerActions = doc.createElement('div');
        _style(headerActions, { display: 'flex', gap: '7px' });
        headerActions.append(_button('Configurar', 'settings', false), _button('Fechar', 'close', false));
        header.append(headingWrap, headerActions);

        const content = doc.createElement('div');
        content.dataset.assistantContent = 'true';
        _style(content, { padding: '16px 18px 28px', overflowY: 'auto', flex: '1' });
        _drawer.append(header, content);
        doc.body.append(_backdrop, _drawer);

        doc.addEventListener('click', _handleActionClick);
        doc.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
        _unsubscribe = window.SoundAssistantService.subscribe(render);
        window.SoundAssistantService.bindSocket();
        render();
    }

    window.SoundAssistantCenter = { init, open, close, toggle, render, mountSummary };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

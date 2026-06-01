document.getElementById('btn-hotkeys-help')?.addEventListener('click', function() {
    const modal = document.getElementById('hotkeys-modal');
    if (modal) modal.classList.remove('hidden');
});
document.getElementById('btn-hotkeys-close')?.addEventListener('click', function() {
    const modal = document.getElementById('hotkeys-modal');
    if (modal) modal.classList.add('hidden');
});
document.getElementById('hotkeys-modal')?.addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
});

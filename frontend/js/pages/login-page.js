'use strict';
(function () {
    var pm = createPageModule();

    function init() {
        // auth-forms.js (carregado no HTML) já inicializa o formulário
    }

    function destroy() {
        pm.destroy();
    }

    window.LoginPage = { init: init, destroy: destroy };
})();

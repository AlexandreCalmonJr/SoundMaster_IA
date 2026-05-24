// Base de conhecimento local do SoundMaster

const eqData = {
    "voz": {
        title: "Voz / Pregação",
        icon: "🎤",
        hpf: "100Hz – 150Hz",
        mud: "Cortar em 200Hz – 400Hz",
        presence: "Realçar em 2kHz – 4kHz",
        tips: "A voz precisa de clareza (inteligibilidade). O HPF (High-Pass Filter) é crucial para remover ruído de palco e pufes no microfone."
    },
    "violao": {
        title: "Violão Acústico",
        icon: "🎸",
        hpf: "100Hz – 120Hz",
        mud: "Cortar em ~200Hz",
        presence: "Realçar em 2kHz – 3kHz",
        tips: "O violão pode embolar a mixagem se tiver muito corpo (200Hz). O realce nos agudos ajuda a ouvir a palhetada."
    },
    "baixo": {
        title: "Baixo Elétrico",
        icon: "🎸",
        hpf: "Não usar (ou < 40Hz)",
        mud: "Cortar em 250Hz",
        presence: "Realçar em 1kHz – 4kHz",
        tips: "A base do baixo fica em 60Hz-120Hz. Se o baixo estiver sumindo, não aumente os graves, aumente os médios-agudos (ataque da corda)."
    },
    "bumbo": {
        title: "Bateria (Bumbo / Kick)",
        icon: "🥁",
        hpf: "30Hz – 40Hz",
        mud: "Cortar em 400Hz – 500Hz",
        presence: "Realçar em 2kHz – 4kHz",
        tips: "O bumbo tem o grave (60Hz) e o ataque do pedal (3kHz). Remover o meio (400Hz) abre espaço para a voz e outros instrumentos."
    },
    "teclado": {
        title: "Teclado / Synth",
        icon: "🎹",
        hpf: "80Hz – 100Hz",
        mud: "Cortar em 300Hz – 500Hz",
        presence: "Realçar em ~3kHz",
        tips: "Teclados ocupam muito espaço na mix. Use HPF para não brigar com o baixo e corte o 'mud' para não brigar com guitarras."
    }
};

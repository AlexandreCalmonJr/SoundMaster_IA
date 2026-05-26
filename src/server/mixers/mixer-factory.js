const { SoundcraftUI } = require('soundcraft-ui-connection');
const { buildSimulatedMixer } = require('./simulated-driver');
const { buildBehringerMixer } = require('./behringer-driver');
const { buildYamahaMixer } = require('./yamaha-driver');

const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

const SIMULATED_IPS = ['offline', 'simulado', '127.0.0.1'];

const BRAND_PORTS = {
    soundcraft: 10024,
    behringer: 10023,
    yamaha: 49280
};

function isSimulatedIp(ip) {
    return SIMULATED_IPS.includes(ip);
}

function createMixer(ip, options = {}) {
    const { socket, mixerSingleton } = options;

    if (isSimulatedIp(ip)) {
        return buildSimulatedMixer(socket, mixerSingleton);
    }

    const brand = options.brand || detectBrand(ip);
    switch (brand) {
        case 'soundcraft': {
            const mixer = new SoundcraftUI(ip);
            mixer.brand = 'soundcraft';
            mixer.model = 'Soundcraft Ui24R';
            return mixer;
        }
        case 'behringer':
            return buildBehringerMixer(ip, { socket, mixerSingleton });
        case 'yamaha':
            return buildYamahaMixer(ip, { socket, mixerSingleton });
        default: {
            const mixer = new SoundcraftUI(ip);
            mixer.brand = 'soundcraft';
            mixer.model = 'Soundcraft Ui24R';
            return mixer;
        }
    }
}

function detectBrand(ip) {
    if (!ipRegex.test(ip)) return 'soundcraft';
    return 'soundcraft';
}

module.exports = { createMixer, isSimulatedIp, SIMULATED_IPS, detectBrand, BRAND_PORTS };

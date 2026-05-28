const Datastore = require('@seald-io/nedb');
const path = require('path');

class HistoryService {
    constructor() {
        this.db = null;
    }

    normalizeSnapshot(data = {}) {
        const spectrum = data.spectrum_db || data.spectrum || {};
        const position = data.position || data.location || null;
        const normalized = {
            type: data.type || 'acoustic_measurement',
            schema_version: data.schema_version || '1.1',
            name: data.name || 'Medição Acústica',
            summary: data.summary || null,
            timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
            measurementType: data.measurementType || 'manual',
            peakHz: data.peakHz ?? data.hz ?? null,
            peakDb: data.peakDb ?? data.db ?? null,
            rms: data.rms ?? data.rmsDb ?? null,
            spl: data.spl ?? data.db ?? data.rms ?? data.rmsDb ?? null,
            rt60: data.rt60 ?? null,
            rt60_multiband: data.rt60_multiband || data.rt60_s || null,
            spectrum_db: spectrum,
            bands: data.bands || null,
            position: position,
            crowdStatus: data.crowdStatus || 'empty',
            points: Array.isArray(data.points) ? data.points : undefined,
            bgImageSrc: data.bgImageSrc || undefined,
            snapshot: data.snapshot || undefined
        };
        if (normalized.snapshot && !normalized.snapshot.spectrum_db) {
            normalized.snapshot = Object.assign({}, normalized.snapshot, {
                spectrum_db: normalized.spectrum_db,
                rt60_multiband: normalized.rt60_multiband,
                crowdStatus: normalized.crowdStatus
            });
        }
        return normalized;
    }

    init(dbDir) {
        this.db = new Datastore({
            filename: path.join(dbDir, 'acoustic_history.db'),
            autoload: true
        });
        console.log('[History] Banco de histórico acústico carregado.');
    }

    async saveSnapshot(data) {
        const snapshot = this.normalizeSnapshot(data);
        return new Promise((resolve, reject) => {
            this.db.insert(snapshot, (err, doc) => {
                if (err) reject(err);
                else resolve(doc);
            });
        });
    }

    async updateSnapshot(id, data) {
        const snapshot = this.normalizeSnapshot(data);
        return new Promise((resolve, reject) => {
            this.db.update({ _id: id }, { $set: snapshot }, {}, (err) => {
                if (err) return reject(err);
                this.db.findOne({ _id: id }, (findErr, doc) => {
                    if (findErr) reject(findErr);
                    else resolve(doc);
                });
            });
        });
    }

    async getComparison(limit = 10) {
        return new Promise((resolve, reject) => {
            this.db.find({ type: 'acoustic_measurement' }).sort({ timestamp: -1 }).limit(limit).exec((err, docs) => {
                if (err) reject(err);
                else resolve(docs);
            });
        });
    }

    async getBenchmark() {
        // Retorna médias para comparação Vazio vs Cheio
        // ✅ T7: Limita a 90 dias e máximo 500 documentos para evitar memory leak (P25)
        const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        return new Promise((resolve, reject) => {
            this.db.find({ type: 'acoustic_measurement', timestamp: { $gt: cutoff } }).limit(500).exec((err, docs) => {
                if (err) return reject(err);
                
                const stats = {
                    empty: { rt60: 0, count: 0 },
                    full: { rt60: 0, count: 0 }
                };

                if (!docs || docs.length === 0) {
                    return resolve(stats);
                }

                docs.forEach(doc => {
                    // Normalização robusta do status (vazio/empty vs cheio/full)
                    let rawStatus = (doc.crowdStatus || 'empty').toLowerCase().trim();
                    let status = 'empty';
                    if (rawStatus.startsWith('v') || rawStatus === 'empty') status = 'empty';
                    else if (rawStatus.startsWith('c') || rawStatus === 'full' || rawStatus.startsWith('f')) status = 'full';
                    
                    if (stats[status] && doc.rt60) {
                        const val = parseFloat(doc.rt60);
                        if (!isNaN(val)) {
                            stats[status].rt60 += val;
                            stats[status].count++;
                        }
                    }
                });

                if (stats.empty.count > 0) stats.empty.rt60 = Number((stats.empty.rt60 / stats.empty.count).toFixed(2));
                if (stats.full.count > 0) stats.full.rt60 = Number((stats.full.rt60 / stats.full.count).toFixed(2));

                resolve(stats);
            });
        });
    }
}

module.exports = new HistoryService();

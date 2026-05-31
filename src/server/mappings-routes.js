function registerMappingsRoutes(app, db, authenticateToken) {
    app.get('/api/mappings', (req, res) => {
        db.find({}, (err, docs) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(docs);
        });
    });

    app.post('/api/mappings', authenticateToken, (req, res) => {
        db.insert(req.body, (err, newDoc) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(newDoc);
        });
    });

    app.delete('/api/mappings/:id', authenticateToken, (req, res) => {
        db.remove({ _id: req.params.id }, {}, (err, numRemoved) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ removed: numRemoved });
        });
    });
}

module.exports = { registerMappingsRoutes };

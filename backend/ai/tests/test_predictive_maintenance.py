import json
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from predictive_maintenance import PredictiveMaintenanceEngine, Diagnosis
from predictive_maintenance import OCTAVE_BANDS, HF_BANDS_HZ, THRESHOLDS


def _make_snapshot(hz_levels: dict, ts: str = None):
    """Helper: cria um snapshot com espectro dict e timestamp opcional."""
    from datetime import datetime, timezone
    return {
        "timestamp": ts or datetime.now(timezone.utc).isoformat(),
        "spectrum_db": hz_levels,
    }


class TestExtractBands:
    def test_dict_input(self):
        engine = PredictiveMaintenanceEngine()
        snap = _make_snapshot({"1000": -20, "2000": -25, "4000": -30})
        bands = engine._extract_bands(snap)
        assert len(bands) == len(OCTAVE_BANDS)
        assert all(isinstance(v, float) for v in bands)

    def test_list_input(self):
        engine = PredictiveMaintenanceEngine()
        snap = {"timestamp": "2025-01-01T00:00:00Z", "spectrum_db": [[1000, -20], [2000, -25]]}
        bands = engine._extract_bands(snap)
        assert len(bands) == len(OCTAVE_BANDS)

    def test_fallback_on_bad_data(self):
        engine = PredictiveMaintenanceEngine()
        snap = {"timestamp": "2025-01-01T00:00:00Z", "spectrum_db": {}}
        bands = engine._extract_bands(snap)
        assert len(bands) == len(OCTAVE_BANDS)
        # Todos -60 dB como fallback
        assert all(b == -60.0 for b in bands)


class TestAnalyzeBands:
    def test_trend_detection(self):
        engine = PredictiveMaintenanceEngine()
        # 10 snapshots com degradação progressiva de HF (4kHz)
        snapshots = []
        for i in range(10):
            snapshots.append(_make_snapshot({
                "125": -30, "250": -28, "500": -27,
                "1000": -26, "2000": -28, "4000": -30 - i * 1.5,
                "8000": -35 - i * 2, "16000": -40 - i * 2.5,
            }))
        diagnosis = engine.analyze("Test", snapshots, months=24)
        assert diagnosis.code is not None
        assert diagnosis.severity in ("ok", "warn", "critical")
        assert len(diagnosis.bands) == len(OCTAVE_BANDS)


class TestHfLoss:
    def test_critical_hf_loss(self):
        engine = PredictiveMaintenanceEngine(thresholds={"hf_slope_crit_db_per_month": 2.0})
        bands = []
        for i, hz in enumerate(OCTAVE_BANDS):
            slope = -3.0 if hz in HF_BANDS_HZ else 0.0
            bands.append(type("Band", (), {"hz": hz, "slope_per_month": slope})())
        result = engine._diagnose_hf_loss(bands)
        assert result["severity"] == "critical"

    def test_ok_no_hf_loss(self):
        engine = PredictiveMaintenanceEngine()
        bands = []
        for hz in OCTAVE_BANDS:
            bands.append(type("Band", (), {"hz": hz, "slope_per_month": 0.5})())
        result = engine._diagnose_hf_loss(bands)
        assert result["severity"] == "ok"


class TestSpectralTilt:
    def test_critical_tilt(self):
        engine = PredictiveMaintenanceEngine(thresholds={"tilt_crit_db": 8.0})
        n_bands = len(OCTAVE_BANDS)
        n_samples = 5
        spectra = np.zeros((n_samples, n_bands))
        # LF = -20, HF = -40 → tilt = 20 dB
        for i, hz in enumerate(OCTAVE_BANDS):
            if 63 <= hz <= 500:
                spectra[:, i] = -20
            elif hz >= 4000:
                spectra[:, i] = -40
            else:
                spectra[:, i] = -30
        result = engine._diagnose_spectral_tilt(spectra)
        assert result["severity"] == "critical"


class TestBroadbandDrift:
    def test_drift_detected(self):
        engine = PredictiveMaintenanceEngine(thresholds={"broadband_drift_db": 3.0})
        n_bands = len(OCTAVE_BANDS)
        n_samples = 10
        spectra = np.zeros((n_samples, n_bands))
        # Baseline: primeiras 2 = -20
        for i in range(2):
            spectra[i, :] = -20
        # Recent: últimas 2 = -30 (drift -10 dB)
        for i in range(8, 10):
            spectra[i, :] = -30
        # Meio: transição
        for i in range(2, 8):
            spectra[i, :] = -20 - (i - 2) * 2
        result = engine._diagnose_broadband_drift(spectra)
        assert result["severity"] != "ok"


class TestInsufficientData:
    def test_few_snapshots(self):
        engine = PredictiveMaintenanceEngine()
        snapshots = [_make_snapshot({"1000": -20}) for _ in range(3)]
        diagnosis = engine.analyze("Ch", snapshots)
        assert diagnosis.code == "DADOS_INSUFICIENTES"
        assert diagnosis.severity == "ok"


class TestFullDiagnosis:
    def test_normal_returns_ok(self):
        engine = PredictiveMaintenanceEngine()
        snapshots = [_make_snapshot({"1000": -20, "4000": -25}) for _ in range(10)]
        diagnosis = engine.analyze("Ch", snapshots, months=24)
        assert diagnosis.code == "NORMAL"
        assert diagnosis.severity == "ok"


class TestParseTimestamp:
    def test_iso_string(self):
        from predictive_maintenance import PredictiveMaintenanceEngine
        dt = PredictiveMaintenanceEngine._parse_ts({"timestamp": "2025-06-01T12:00:00Z"})
        assert dt.year == 2025
        assert dt.month == 6

    def test_epoch_ms(self):
        from predictive_maintenance import PredictiveMaintenanceEngine
        dt = PredictiveMaintenanceEngine._parse_ts({"ts": 1748000000000})
        assert dt.year == 2025

    def test_epoch_s(self):
        from predictive_maintenance import PredictiveMaintenanceEngine
        dt = PredictiveMaintenanceEngine._parse_ts({"ts": 1748000000})
        assert dt.year == 2025

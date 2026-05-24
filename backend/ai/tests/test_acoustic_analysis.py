import numpy as np
import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from acoustic_analysis import (
    deconvolve_sweep, calculate_reverberation_params,
    calculate_sti, analyze_sweep, _next_pow2, _find_level_idx,
    _sti_label, _sti_to_cis,
)


class TestNextPow2:
    def test_power_of_two(self):
        assert _next_pow2(1) == 1
        assert _next_pow2(2) == 2
        assert _next_pow2(1024) == 1024

    def test_non_power_of_two(self):
        assert _next_pow2(3) == 4
        assert _next_pow2(100) == 128
        assert _next_pow2(2000) == 2048


class TestFindLevelIdx:
    def test_finds_crossing(self):
        arr = np.array([0, -2, -5, -10, -20])
        assert _find_level_idx(arr, -5) == 2
        assert _find_level_idx(arr, -10) == 3

    def test_returns_none_when_not_found(self):
        arr = np.array([0, -1, -2])
        assert _find_level_idx(arr, -60) is None


class TestStiLabel:
    def test_labels(self):
        assert _sti_label(0.80) == "Excelente"
        assert _sti_label(0.65) == "Bom"
        assert _sti_label(0.50) == "Regular"
        assert _sti_label(0.35) == "Pobre"
        assert _sti_label(0.20) == "Péssimo"


class TestStiToCis:
    def test_cis_range(self):
        c = _sti_to_cis(0.5)
        assert 1.0 <= c <= 5.0

    def test_cis_monotonic(self):
        assert _sti_to_cis(0.3) < _sti_to_cis(0.7)


class TestDeconvolveSweep:
    def test_returns_dict_keys(self):
        sr = 48000
        dur = 0.5
        t = np.linspace(0, dur, int(sr * dur))
        # Sweep simples
        ref = np.sin(2 * np.pi * 100 * t + 2 * np.pi * 10 * t ** 2)
        rec = np.concatenate([np.zeros(int(sr * 0.1)), ref[:int(sr * 0.4)] * 0.5])

        result = deconvolve_sweep(rec, ref, sr)
        assert "ir" in result
        assert "ir_db" in result
        assert "schroeder" in result
        assert "sample_rate" in result
        assert result["sample_rate"] == sr
        assert result["snr_db"] >= 0
        assert result["duration_s"] > 0

    def test_empty_recording(self):
        sr = 48000
        ref = np.ones(1000)
        rec = np.zeros(1000)
        result = deconvolve_sweep(rec, ref, sr)
        # SNR deve ser baixo ou NaN (sinal zero)
        assert result["snr_db"] is None or result["snr_db"] < 10


class TestCalculateReverberationParams:
    def test_basic_parameters(self):
        sr = 48000
        dur = 1.0
        n = int(sr * dur)
        # Decaimento exponencial simulado
        t = np.arange(n) / sr
        ir = np.exp(-5 * t) * np.random.randn(n) * 0.01
        ir[0] = 1.0
        ir_sq = ir ** 2
        sch_raw = np.cumsum(ir_sq[::-1])[::-1]
        sch_db = 10 * np.log10(sch_raw / (sch_raw[0] + 1e-30) + 1e-30)
        ir_data = {
            "ir": ir,
            "schroeder": sch_db,
            "sample_rate": sr,
            "snr_db": 50,
            "peak_idx": 0,
            "duration_s": dur,
            "n_samples": n,
        }
        rev = calculate_reverberation_params(ir_data)
        assert "edt" in rev
        assert "t20" in rev
        assert "t30" in rev
        assert "rt60_est" in rev
        assert "c50" in rev
        assert "c80" in rev
        assert "d50" in rev
        assert "d80" in rev
        assert "warning" in rev


class TestCalculateSti:
    def test_sti_returns_expected_keys(self):
        sr = 48000
        n = int(sr * 0.5)
        ir = np.zeros(n)
        ir[0] = 1.0
        ir[1] = 0.5
        result = calculate_sti(ir, sr, gender="male")
        assert "sti" in result
        assert "sti_label" in result
        assert "cis" in result
        assert "mti" in result
        assert "bands_hz" in result
        assert 0 <= result["sti"] <= 1

    def test_sti_different_genders(self):
        sr = 48000
        n = int(sr * 0.5)
        ir = np.zeros(n)
        ir[0] = 1.0
        r_m = calculate_sti(ir, sr, gender="male")
        r_f = calculate_sti(ir, sr, gender="female")
        assert r_m["sti"] > 0
        assert r_f["sti"] > 0


class TestAnalyzeSweep:
    def test_full_pipeline(self):
        sr = 48000
        dur = 0.3
        n = int(sr * dur)
        t = np.linspace(0, dur, n)
        ref = np.sin(2 * np.pi * 200 * t)
        rec = np.concatenate([np.zeros(int(sr * 0.05)), ref[:int(sr * 0.25)] * 0.3])
        result = analyze_sweep(rec, ref, sr, compute_sti=True, compute_multiband=False)
        assert result["status"] == "ok"
        assert result["snr_db"] is not None
        assert "edt" in result
        assert "t20" in result
        assert "t30" in result
        assert "rt60_est" in result
        assert result.get("c50") is not None
        assert result.get("c80") is not None
        assert result.get("d50") is not None
        assert "sti" in result

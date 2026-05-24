import pytest
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from acoustics.processor import AcousticProcessor


class TestEyringRt60:
    def test_basic(self):
        rt = AcousticProcessor.eyring_rt60(1000, 600, 0.1)
        assert rt > 0
        assert rt < 10

    def test_high_alpha(self):
        rt = AcousticProcessor.eyring_rt60(1000, 600, 0.99)
        assert rt > 0

    def test_low_alpha(self):
        rt = AcousticProcessor.eyring_rt60(1000, 600, 0.01)
        assert rt > 0

    def test_zero_surface(self):
        rt = AcousticProcessor.eyring_rt60(1000, 0, 0.1)
        assert rt == 0


class TestClassifyRoom:
    def test_dead_room(self):
        cls = AcousticProcessor.classify_room(0.2)
        assert "Sala morta" in cls["status"]

    def test_ideal_for_speech(self):
        cls = AcousticProcessor.classify_room(0.5)
        assert "Ideal para Voz" in cls["status"]

    def test_ideal_for_music(self):
        cls = AcousticProcessor.classify_room(1.2)
        assert "Ideal para Música" in cls["status"]

    def test_challenging(self):
        cls = AcousticProcessor.classify_room(2.0)
        assert "Desafiadora" in cls["status"]

    def test_very_reverberant(self):
        cls = AcousticProcessor.classify_room(2.8)
        assert "Muito Reverberante" in cls["status"]

    def test_critical(self):
        cls = AcousticProcessor.classify_room(3.5)
        assert "Crítico" in cls["status"]


class TestEstimateSti:
    def test_good_sti(self):
        sti = AcousticProcessor.estimate_sti(0.5, 30)
        assert 0 < sti <= 1

    def test_poor_sti(self):
        sti = AcousticProcessor.estimate_sti(4.0, 15)
        assert sti < 0.5

    def test_range_clamping(self):
        sti = AcousticProcessor.estimate_sti(10, 5)
        assert 0 <= sti <= 1


class TestCriticalDistance:
    def test_basic(self):
        dc = AcousticProcessor.calculate_critical_distance(1000, 1.2)
        assert dc > 0

    def test_directivity(self):
        dc_omni = AcousticProcessor.calculate_critical_distance(1000, 1.2)
        dc_directional = AcousticProcessor.calculate_critical_distance(1000, 1.2, q=8)
        assert dc_directional > dc_omni

    def test_zero_rt60(self):
        dc = AcousticProcessor.calculate_critical_distance(1000, 0)
        assert dc == 0


class TestDiagnosePatterns:
    def test_empty_history(self):
        result = AcousticProcessor.diagnose_patterns([])
        assert result == []

    def test_no_peaks(self):
        result = AcousticProcessor.diagnose_patterns([{}])
        assert result == []

    def test_detects_pattern(self):
        history = [{"peakHz": 120}] * 5
        result = AcousticProcessor.diagnose_patterns(history)
        assert len(result) >= 1
        assert "hz" in result[0]
        assert "confidence" in result[0]

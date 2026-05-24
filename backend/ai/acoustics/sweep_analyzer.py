"""
SoundMaster Pro - Sweep Acoustic Analyzer (Python/Numpy/Scipy)
Deconvolução de Log-Sine Sweep delegada a acoustic_analysis.
Mantém: C50, C80, D50, D80, generate_sweep_signal, quality_flags.

Engenharia DSP: Alexandre Calmon Jr.
"""

import numpy as np
from scipy import signal
import json
import math
import os
import sys

# Importa o módulo core de análise acústica
_script_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_script_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

import acoustic_analysis


class SweepAnalyzer:

    def __init__(self, sample_rate=48000):
        self.fs = sample_rate

    def generate_sweep_signal(self, duration=12, start_freq=20, end_freq=20000,
                               amplitude=0.8, fade_out_ms=500):
        """Recria o sinal de sweep para deconvolução (AudioWorklet JS compat)."""
        fs = self.fs
        total_samples = int(fs * duration)
        fade_out_samples = int(fs * (fade_out_ms / 1000))
        t = np.arange(total_samples) / fs
        f0, f1 = start_freq, end_freq
        ln_f0, ln_f1 = np.log(f0), np.log(f1)
        instantaneous_freq = f0 * np.exp(((ln_f1 - ln_f0) / duration) * t)
        phase = 2 * np.pi * np.cumsum(instantaneous_freq) / fs
        sweep = np.sin(phase) * amplitude
        fade_in_samples = int(fs * 0.015)
        fade_in = 0.5 * (1 - np.cos(np.pi * np.linspace(0, 1, fade_in_samples)))
        sweep[:fade_in_samples] *= fade_in
        if fade_out_samples > 0:
            fade_out = np.exp(-8 * np.linspace(0, 1, fade_out_samples))
            sweep[-fade_out_samples:] *= fade_out
        return sweep

    def analyze(self, recording, sample_rate=None, sweep_params=None):
        """
        Pipeline completo de análise acústica.
        Delega deconvolução e parâmetros de reverberação ao módulo core.
        Adiciona: C50, C80, D50, D80, quality_flags.
        """
        if sample_rate is None:
            sample_rate = self.fs
        recording = np.array(recording, dtype=np.float64)

        if sweep_params is None:
            sweep_params = {
                'start_freq': 20, 'end_freq': 20000,
                'duration': 12, 'amplitude': 0.8, 'fade_out_ms': 500
            }
        sweep = self.generate_sweep_signal(**sweep_params)

        # Usa o módulo core para deconvolução e decay params
        ir_data = acoustic_analysis.deconvolve_sweep(recording, sweep, sample_rate)
        rev = acoustic_analysis.calculate_reverberation_params(ir_data)

        ir = ir_data["ir"]
        snr_db = ir_data["snr_db"]
        rt60_est = rev.get("rt60_est") or rev.get("t30") or rev.get("t20") or 0

        downsample_factor = max(1, len(ir_data["schroeder"]) // 512)
        schroeder_downsampled = ir_data["schroeder"][::downsample_factor].tolist()

        return {
            'edt': rev["edt"],
            't20': rev["t20"],
            't30': rev["t30"],
            'c50': rev["c50"],
            'c80': rev["c80"],
            'd50': rev["d50"],
            'd80': rev["d80"],
            'sti': None,
            'sti_raw': None,
            'sti_category': 'N/A',
            'sti_per_band': {},
            'snr_db': round(snr_db, 1),
            'schroeder_curve': schroeder_downsampled,
            'peak_index_ms': round(ir_data["peak_idx"] / sample_rate * 1000, 2),
            'quality_flags': self._quality_flags(snr_db, rt60_est, rev)
        }

    def _quality_flags(self, snr_db, rt60, rev):
        flags = []
        if snr_db < 25:
            flags.append('SNR_BAIXO')
        elif snr_db > 50:
            flags.append('SNR_EXCELENTE')
        if rt60 == 0 or (rev.get('t20') or 0) == 0:
            flags.append('SINAL_FRACO')
        if rt60 > 4.0:
            flags.append('SALA_MUITO_REVERBERANTE')
        if rev.get('t30', 0) and rev.get('t20', 0) and rev['t30'] > rev['t20'] * 2:
            flags.append('DECAIMENTO_IRREGULAR')
        return flags


def main():
    import sys
    from scipy.io import wavfile
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: python sweep_analyzer.py <recording_wav>'}, indent=2))
        return
    try:
        sr, data = wavfile.read(sys.argv[1])
        if len(data.shape) > 1:
            data = data[:, 0]
        data = data.astype(np.float64) / 32768.0
        analyzer = SweepAnalyzer(sample_rate=sr)
        result = analyzer.analyze(data, sample_rate=sr)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}, indent=2))


if __name__ == '__main__':
    main()

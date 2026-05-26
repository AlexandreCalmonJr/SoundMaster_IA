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
            fade_out[-1] = 0
            sweep[-fade_out_samples:] *= fade_out
        return sweep

    def _align_reference(self, recording, reference, n_pre_samples):
        """Alinha recording com reference: trunca silêncio inicial do recording."""
        if n_pre_samples > 0 and n_pre_samples < len(recording):
            recording = recording[n_pre_samples:]
        # Garantir mesmo comprimento mínimo
        min_len = min(len(recording), len(reference))
        return recording[:min_len], reference[:min_len]

    def analyze(self, recording, reference=None, sample_rate=None, sweep_params=None):
        """
        Pipeline completo de análise acústica.
        Se reference for fornecido (do AudioWorklet JS), usa-o como sweep real,
        garantindo que a deconvolução use o sinal exato que foi reproduzido.
        Caso contrário, gera sweep internamente (fallback).
        Inclui multiband RT60 no resultado.
        """
        if sample_rate is None:
            sample_rate = self.fs
        recording = np.array(recording, dtype=np.float64)

        if reference is not None:
            reference = np.array(reference, dtype=np.float64)
            # Alinhar: trunca silêncio pré-sweep do recording
            n_pre = int((sweep_params or {}).get('silencePre', 0) * sample_rate)
            rec_aligned, ref_aligned = self._align_reference(recording, reference, n_pre)
            sweep = ref_aligned
            recording_used = rec_aligned
        else:
            if sweep_params is None:
                sweep_params = {
                    'start_freq': 20, 'end_freq': 20000,
                    'duration': 12, 'amplitude': 0.8, 'fade_out_ms': 500
                }
            sweep = self.generate_sweep_signal(**sweep_params)
            recording_used = recording

        ir_data = acoustic_analysis.deconvolve_sweep(recording_used, sweep, sample_rate)
        rev = acoustic_analysis.calculate_reverberation_params(ir_data)

        snr_db = ir_data["snr_db"]
        rt60_est = rev.get("rt60_est") or rev.get("t30") or rev.get("t20") or 0

        # Multiband RT60 nas bandas de oitava
        multiband = acoustic_analysis.calculate_multiband_rt60(
            recording_used, sweep, sample_rate
        ) if hasattr(acoustic_analysis, 'calculate_multiband_rt60') else {}

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
            'multiband': {
                band: {
                    'edt': m.get('edt', 0),
                    't20': m.get('t20', 0),
                    't30': m.get('t30', 0),
                    'rt60': m.get('rt60_est', m.get('t30', m.get('t20', 0))),
                }
                for band, m in (multiband or {}).items()
            },
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
    import argparse
    from scipy.io import wavfile

    parser = argparse.ArgumentParser(description='Sweep Acoustic Analyzer')
    parser.add_argument('recording', help='Path to recording WAV file')
    parser.add_argument('--reference', help='Path to reference WAV file (from AudioWorklet)')
    parser.add_argument('--sweep-params', help='JSON string of sweep parameters')
    args = parser.parse_args()

    try:
        sr, data = wavfile.read(args.recording)
        if len(data.shape) > 1:
            data = data[:, 0]
        data = data.astype(np.float64) / 32768.0

        sweep_params = json.loads(args.sweep_params) if args.sweep_params else None

        reference = None
        if args.reference:
            ref_sr, ref_data = wavfile.read(args.reference)
            if len(ref_data.shape) > 1:
                ref_data = ref_data[:, 0]
            reference = ref_data.astype(np.float64) / 32768.0

        analyzer = SweepAnalyzer(sample_rate=sr)
        result = analyzer.analyze(data, reference=reference, sample_rate=sr, sweep_params=sweep_params)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({'error': str(e)}, indent=2))


if __name__ == '__main__':
    main()

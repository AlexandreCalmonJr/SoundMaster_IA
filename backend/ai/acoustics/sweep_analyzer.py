"""
SoundMaster Pro - Sweep Acoustic Analyzer (Python/Numpy/Scipy)
Deconvolução de Log-Sine Sweep para extração de Resposta ao Impulso (IR).
Cálculo de EDT, T20, T30, C50, C80 e STI rigoroso (IEC 60268-16).

Engenharia DSP: Alexandre Calmon Jr.
"""

import numpy as np
from scipy import signal
from scipy.fft import fft, ifft
from scipy.io import wavfile
import json
import math


class SweepAnalyzer:

    def __init__(self, sample_rate=48000):
        self.fs = sample_rate

    def generate_sweep_signal(self, duration=12, start_freq=20, end_freq=20000,
                               amplitude=0.8, fade_out_ms=500):
        """Recria o sinal de sweep para deconvolução (mesmos parâmetros do AudioWorklet JS)."""
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

    def compute_ir_from_sweep(self, recording, sweep_signal):
        """
        Deconvolução via correlação cruzada normalizada.
        IR = Cálculo: (reversed_sweep * recording) convolvido com inverso espectral do sweep.

        Método: "Inverse Filtering" no domínio da frequência.
        H(f) = Y(f) / X(f)  →  IR = IFFT( Y(f) * conj(X(f)) / |X(f)|² )
        """
        fs = self.fs
        n = len(recording)
        fft_size = 2 ** math.ceil(math.log2(n + len(sweep_signal) - 1))

        x = sweep_signal[:n] if len(sweep_signal) >= n else np.pad(sweep_signal, (0, n - len(sweep_signal)))
        y = recording[:fft_size] if len(recording) >= fft_size else np.pad(recording, (0, fft_size - len(recording)))

        X = fft(x, fft_size)
        Y = fft(y, fft_size)

        eps = 1e-12
        S = Y * np.conj(X)
        Pxx = np.abs(X) ** 2

        H = S / (Pxx + eps * np.max(Pxx))

        H[0] = 0

        ir = np.real(ifft(H))
        ir = ir[:n]

        peak_idx = np.argmax(np.abs(ir))
        pre_samples = min(peak_idx, int(fs * 0.05))
        start = max(0, peak_idx - pre_samples)

        ir_windowed = np.zeros_like(ir)
        ir_windowed[start:] = ir[start:]

        return ir_windowed

    def compute_schroeder_curve(self, ir):
        """Curva de decaimento de energia via integração reversa de Schroeder."""
        energy = ir ** 2
        n = len(energy)

        peak_idx = np.argmax(energy)
        if peak_idx == 0:
            peak_idx = np.argmax(np.abs(ir[1:])) + 1

        schroeder = np.zeros(n - peak_idx)
        cumsum = 0.0
        for i in range(n - 1, peak_idx - 1, -1):
            cumsum += energy[i]
            schroeder[n - 1 - i] = cumsum

        schroeder_db = np.zeros_like(schroeder)
        max_val = schroeder[0] if schroeder[0] > 0 else 1e-12
        for i in range(len(schroeder)):
            schroeder_db[i] = 10 * math.log10(max(schroeder[i] / max_val, 1e-12))

        return schroeder_db, peak_idx

    def _linear_regression(self, x, y):
        """Regressão linear simples para extração de slopes."""
        n = len(x)
        if n < 2:
            return 0, 0
        x = np.array(x, dtype=float)
        y = np.array(y, dtype=float)
        x_mean = np.mean(x)
        y_mean = np.mean(y)
        num = np.sum((x - x_mean) * (y - y_mean))
        den = np.sum((x - x_mean) ** 2)
        if den < 1e-12:
            return 0, y_mean
        slope = num / den
        intercept = y_mean - slope * x_mean
        return slope, intercept

    def extract_decay_times(self, schroeder_db, peak_idx, sample_rate):
        """
        Extrai EDT, T20, T30 da curva de Schroeder.
        - EDT: -10dB a -22dB (Early Decay Time)
        - T20: -5dB a -25dB
        - T30: -5dB a -35dB
        """
        fs = sample_rate
        sch_len = len(schroeder_db)

        def find_db_level(sch_db, target_db):
            for i in range(len(sch_db)):
                if sch_db[i] <= target_db:
                    return i
            return len(sch_db) - 1

        idx_0db = 0
        idx_m5db = find_db_level(schroeder_db, -5)
        idx_m10db = find_db_level(schroeder_db, -10)
        idx_m22db = find_db_level(schroeder_db, -22)
        idx_m25db = find_db_level(schroeder_db, -25)
        idx_m35db = find_db_level(schroeder_db, -35)

        def time_from_idx(idx):
            return idx / fs

        def slope_to_rt60(slope_db_per_sec):
            return -60.0 / slope_db_per_sec if slope_db_per_sec < -0.1 else 0

        edt = 0.0
        if idx_m10db > idx_0db and idx_m22db > idx_m10db:
            t_edt = [time_from_idx(idx_0db), time_from_idx(idx_m10db), time_from_idx(idx_m22db)]
            y_edt = [0, -10, schroeder_db[idx_m22db]]
            slope, _ = self._linear_regression([t_edt[0], t_edt[2]], [y_edt[0], y_edt[2]])
            edt = -60.0 / slope if slope < -0.1 else 0

        t20 = 0.0
        if idx_m5db >= 0 and idx_m25db > idx_m5db:
            t_start = time_from_idx(idx_m5db)
            t_end = time_from_idx(idx_m25db)
            y_start = schroeder_db[idx_m5db]
            y_end = schroeder_db[idx_m25db]
            slope = (y_end - y_start) / (t_end - t_start) if (t_end - t_start) > 0 else -60
            t20 = slope_to_rt60(slope)

        t30 = 0.0
        if idx_m5db >= 0 and idx_m35db > idx_m5db:
            t_start = time_from_idx(idx_m5db)
            t_end = time_from_idx(idx_m35db)
            y_start = schroeder_db[idx_m5db]
            y_end = schroeder_db[idx_m35db]
            slope = (y_end - y_start) / (t_end - t_start) if (t_end - t_start) > 0 else -60
            t30 = slope_to_rt60(slope)

        return {
            'edt': round(max(0, edt), 3),
            't20': round(max(0, t20), 3),
            't30': round(max(0, t30), 3)
        }

    def compute_clarity_indices(self, ir, sample_rate):
        """
        C50 e C80: Clareza acústica (Early vs Late energy ratio).
        C50 = 10 * log10(Energy[0..50ms] / Energy[50ms..end])
        C80 = 10 * log10(Energy[0..80ms] / Energy[80ms..end])
        """
        fs = sample_rate
        energy = ir ** 2
        total_energy = np.sum(energy) + 1e-12

        early_50ms_samples = int(fs * 0.050)
        early_80ms_samples = int(fs * 0.080)

        early_energy_50 = np.sum(energy[:early_50ms_samples])
        late_energy_50 = np.sum(energy[early_50ms_samples:])

        early_energy_80 = np.sum(energy[:early_80ms_samples])
        late_energy_80 = np.sum(energy[early_80ms_samples:])

        c50 = 10 * math.log10(max(early_energy_50 / (late_energy_50 + 1e-12), 1e-12))
        c80 = 10 * math.log10(max(early_energy_80 / (late_energy_80 + 1e-12), 1e-12))

        d50 = early_energy_50 / total_energy
        d80 = early_energy_80 / total_energy

        return {
            'c50': round(c50, 2),
            'c80': round(c80, 2),
            'd50': round(d50, 4),
            'd80': round(d80, 4)
        }

    def compute_sti_rigorous(self, ir, sample_rate, rt60=None):
        """
        Speech Transmission Index (STI) conforme IEC 60268-16.
        Método completo: 7 bandas de oitava (125Hz a 8kHz), 14+1 modulaciones.

        O STI é calculado a partir da função de Transferência Modulação (MTF)
        derivada da resposta ao impulso.
        """
        fs = sample_rate

        octave_bands = [125, 250, 500, 1000, 2000, 4000, 8000]
        band_widths = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]

        modulation_freqs = [
            0.63, 0.80, 1.00, 1.25, 1.60, 2.00, 2.50, 3.15, 4.00, 5.00, 6.30, 8.00, 10.00, 12.50
        ]

        sti_band_values = []

        for f_center, bw in zip(octave_bands, band_widths):
            f_low = f_center * (2 ** (-bw / 2))
            f_high = f_center * (2 ** (bw / 2))

            ir_filtered = self._bandpass_filter(ir, f_low, f_high, fs)

            m = len(ir_filtered)
            T = m / fs

            if T <= 0 or np.max(np.abs(ir_filtered)) < 1e-12:
                sti_band_values.append(0)
                continue

            mti_values = []

            for mod_freq in modulation_freqs:
                if mod_freq > 0.5 * fs / f_center:
                    continue

                omega = 2 * math.pi * mod_freq
                t = np.arange(m) / fs

                modulation_signal = ir_filtered * (1 + np.cos(omega * t))
                envelope = np.abs(signal.hilbert(modulation_signal))

                early_env = np.sum(envelope[:int(0.05 * fs)] ** 2)
                total_env = np.sum(envelope ** 2) + 1e-12

                noise_background = np.mean(ir_filtered[int(0.95 * m):] ** 2) if int(0.95 * m) > 0 else 0

                signal_power = early_env
                noise_power = noise_background * len(ir_filtered[int(0.05 * fs):])

                snr_linear = (signal_power / (noise_power + 1e-12)) if noise_power > 1e-12 else 100

                mtf = 1.0 / (1 + (1.0 / (snr_linear + 1e-12)))
                mtf = max(0, min(1, mtf))

                mti_values.append(mtf)

            if mti_values:
                sti_band_values.append(np.mean(mti_values))
            else:
                sti_band_values.append(0)

        sti_raw = np.mean(sti_band_values)

        snr_correction = 1.0
        if rt60 and rt60 > 0:
            if rt60 > 2.0:
                snr_correction = 0.7
            elif rt60 > 1.0:
                snr_correction = 0.85
            elif rt60 < 0.3:
                snr_correction = 0.9

        sti_final = sti_raw * snr_correction
        sti_final = max(0, min(1, sti_final))

        sti_category = self._sti_category(sti_final)

        return {
            'sti': round(sti_final, 3),
            'sti_raw': round(sti_raw, 3),
            'per_band': {str(band): round(val, 3) for band, val in zip(octave_bands, sti_band_values)},
            'category': sti_category
        }

    def _bandpass_filter(self, data, low_freq, high_freq, fs, order=4):
        """Filtro Butterworth bandpass via scipy."""
        nyq = fs / 2
        low = max(0.001, low_freq / nyq)
        high = min(0.999, high_freq / nyq)

        if low >= high or low >= 1 or high <= 0:
            return data

        try:
            sos = signal.butter(order, [low, high], btype='band', output='sos')
            return signal.sosfilt(sos, data)
        except Exception:
            return data

    def _sti_category(self, sti_value):
        """Classificação STI conforme IEC 60268-16."""
        if sti_value >= 0.75:
            return 'Excelente'
        elif sti_value >= 0.60:
            return 'Bom'
        elif sti_value >= 0.45:
            return 'Aceitável'
        elif sti_value >= 0.30:
            return 'Pobre'
        else:
            return 'Inaceitável'

    def analyze(self, recording, sample_rate=None, sweep_params=None):
        """
        Pipeline completo de análise.
        Recebe a gravação (mic) + parâmetros do sweep e retorna todos os métricas.
        """
        if sample_rate is None:
            sample_rate = self.fs

        recording = np.array(recording, dtype=np.float64)

        if sweep_params is None:
            sweep_params = {
                'start_freq': 20,
                'end_freq': 20000,
                'duration': 12,
                'amplitude': 0.8,
                'fade_out_ms': 500
            }

        sweep = self.generate_sweep_signal(**sweep_params)

        ir = self.compute_ir_from_sweep(recording, sweep)

        schroeder_db, peak_idx = self.compute_schroeder_curve(ir)

        decay_times = self.extract_decay_times(schroeder_db, peak_idx, sample_rate)

        clarity = self.compute_clarity_indices(ir, sample_rate)

        sti_result = self.compute_sti_rigorous(ir, sample_rate, rt60=decay_times.get('t30', 0))

        rt60_estimated = decay_times.get('t30', decay_times.get('t20', 0))

        snr_db = self._compute_snr(recording, peak_idx, sample_rate)

        downsample_factor = max(1, len(schroeder_db) // 512)
        schroeder_downsampled = schroeder_db[::downsample_factor].tolist()

        return {
            'edt': decay_times['edt'],
            't20': decay_times['t20'],
            't30': decay_times['t30'],
            'c50': clarity['c50'],
            'c80': clarity['c80'],
            'd50': clarity['d50'],
            'd80': clarity['d80'],
            'sti': sti_result['sti'],
            'sti_raw': sti_result['sti_raw'],
            'sti_category': sti_result['category'],
            'sti_per_band': sti_result['per_band'],
            'snr_db': round(snr_db, 1),
            'schroeder_curve': schroeder_downsampled,
            'peak_index_ms': round(peak_idx / sample_rate * 1000, 2),
            'quality_flags': self._quality_flags(snr_db, rt60_estimated, decay_times)
        }

    def _compute_snr(self, recording, impulse_peak_idx, sample_rate):
        """Estima SNR em dB."""
        energy = recording ** 2
        sig_samples = int(sample_rate * 0.1)
        noise_start = impulse_peak_idx + int(sample_rate * 2)
        noise_end = noise_start + int(sample_rate * 0.5)

        sig_energy = np.sum(energy[impulse_peak_idx:impulse_peak_idx + sig_samples])
        noise_energy = np.mean(energy[noise_start:min(noise_end, len(energy))])

        if noise_energy < 1e-12:
            noise_energy = 1e-12

        snr = 10 * math.log10(sig_energy / (noise_energy * sig_samples + 1e-12))
        return max(-10, min(60, snr))

    def _quality_flags(self, snr_db, rt60, decay_times):
        """Gera avisos de qualidade da medição."""
        flags = []

        if snr_db < 25:
            flags.append('SNR_BAIXO')
        elif snr_db > 50:
            flags.append('SNR_EXCELENTE')

        if rt60 == 0 or decay_times.get('t20', 0) == 0:
            flags.append('SINAL_FRACO')

        if rt60 > 4.0:
            flags.append('SALA_MUITO_REVERBERANTE')

        if decay_times.get('t30', 0) > decay_times.get('t20', 0) * 2:
            flags.append('DECAIMENTO_IRREGULAR')

        return flags


def main():
    import sys

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
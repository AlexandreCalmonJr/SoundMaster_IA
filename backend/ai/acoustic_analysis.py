"""
SoundMaster Pro — Acoustic Analysis Engine
==========================================
Deconvolução de Exponential Sine Sweep (ESS) → Resposta ao Impulso (IR)
Extração de parâmetros acústicos: EDT, T20, T30, RT60
Estimativa de STI (Speech Transmission Index) conforme IEC 60268-16

Dependências: numpy, scipy

Autor: Alexandre Calmon Jr.
"""

import numpy as np
from scipy.signal import fftconvolve
from scipy.stats import linregress
import logging

logger = logging.getLogger(__name__)


# ─── Constantes STI (IEC 60268-16:2011) ─────────────────────────────────────

# Bandas de oitava centradas em 125, 250, 500, 1k, 2k, 4k, 8k Hz
_STI_OCTAVE_BANDS = [125, 250, 500, 1000, 2000, 4000, 8000]

# Frequências de modulação (m = 1..14) conforme Tabela 1 da norma
_STI_MOD_FREQS = [0.63, 0.8, 1.0, 1.25, 1.6, 2.0, 2.5, 3.15, 4.0, 5.0, 6.3, 8.0, 10.0, 12.5]

# Pesos por banda de oitava para MTI masculino e feminino (Tabela 4)
_STI_WEIGHTS = {
    'male':   np.array([0.085, 0.127, 0.230, 0.233, 0.309, 0.224, 0.173]),
    'female': np.array([0.000, 0.117, 0.223, 0.216, 0.328, 0.250, 0.194]),
}

# Correções de nível por banda (Tabela B.1) para STI simplificado
_ALPHA = np.array([0.085, 0.127, 0.230, 0.233, 0.309, 0.224, 0.173])
_BETA  = np.array([0.085, 0.000, 0.032, 0.023, 0.000, 0.000, 0.000])


# ─── Deconvolução ESS → Resposta ao Impulso ──────────────────────────────────

def deconvolve_sweep(recording: np.ndarray,
                    reference: np.ndarray,
                    sample_rate: int) -> dict:
    """
    Deconvolução linear do ESS para obter a Resposta ao Impulso (IR).

    Para o método ESS de Farina (2000), o filtro inverso ideal é:
        X_inv(f) = conj(X(f)) / |X(f)|²  ≈  1/X(f)  para SNR alto

    Na prática, usamos deconvolução espectral com regularização de Tikhonov
    para estabilidade numérica no caso de energia baixa em algumas frequências.

    Parâmetros
    ----------
    recording   : sinal capturado pelo microfone (Float32/Float64)
    reference   : sweep original gerado (mesmo comprimento ou menor)
    sample_rate : fs em Hz

    Retorna
    -------
    dict com:
        ir          : np.ndarray — Resposta ao Impulso
        ir_db       : np.ndarray — IR em dB (para plotagem)
        schroeder   : np.ndarray — Curva de Schroeder em dB
        sample_rate : int
        peak_idx    : int — índice do pico (onset acústico)
        duration_s  : float — duração da IR em segundos
        snr_db      : float — SNR estimado
    """
    rec = np.array(recording, dtype=np.float64)
    ref = np.array(reference, dtype=np.float64)

    # Garantir mesmo comprimento via zero-padding
    n_fft = _next_pow2(len(rec) + len(ref) - 1)

    REC = np.fft.rfft(rec, n=n_fft)
    REF = np.fft.rfft(ref, n=n_fft)

    # Regularização Tikhonov: ε = 1e-4 × max(|REF|²)
    ref_pwr = np.abs(REF) ** 2
    eps = 1e-4 * np.max(ref_pwr)

    # Filtro inverso: H(f) = conj(REF) / (|REF|² + ε)
    H = np.conj(REF) / (ref_pwr + eps)

    # IR no domínio do tempo
    ir_full = np.fft.irfft(REC * H, n=n_fft)
    ir_full = ir_full[: len(rec)]   # trunca ao comprimento original

    # Localiza o pico (onset acústico = chegada do som direto)
    peak_idx = int(np.argmax(np.abs(ir_full)))

    # Trunca IR: 50 ms antes do pico até o final (preserva pré-eco)
    pre_samples = min(peak_idx, int(0.05 * sample_rate))
    ir = ir_full[peak_idx - pre_samples:]

    # SNR: razão entre pico e noise floor (primeiros 50 ms antes do pico)
    if peak_idx <= 1:
        snr_db = 0.0
    else:
        noise_floor = float(np.mean(rec[:peak_idx] ** 2))
        signal_peak = float(np.max(ir ** 2))
        if noise_floor <= 0 or signal_peak <= 0:
            snr_db = 0.0
        else:
            snr_db = 10 * np.log10(signal_peak / noise_floor)
    snr_db = round(float(snr_db), 1)

    # Schroeder backward integration
    ir_sq = ir ** 2
    schroeder = np.cumsum(ir_sq[::-1])[::-1]
    schroeder_db = 10 * np.log10(schroeder / (schroeder[0] + 1e-30) + 1e-30)

    # IR em dB (magnitude absoluta normalizada)
    ir_norm = ir / (np.max(np.abs(ir)) + 1e-30)
    ir_db = 20 * np.log10(np.abs(ir_norm) + 1e-30)

    return {
        "ir":           ir,
        "ir_db":        ir_db,
        "schroeder":    schroeder_db,
        "schroeder_raw": schroeder,
        "sample_rate":  sample_rate,
        "peak_idx":     pre_samples,  # posição do pico na IR truncada
        "duration_s":   len(ir) / sample_rate,
        "snr_db":       round(float(snr_db), 1),
        "n_samples":    len(ir),
    }


# ─── Parâmetros de Reverberação ───────────────────────────────────────────────

def calculate_reverberation_params(ir_data: dict) -> dict:
    """
    Calcula EDT, T20, T30, T60 (extrapolado), C50, C80, D50, D80
    a partir da curva de Schroeder e IR.

    Definições (ISO 3382-1):
        EDT  : tempo para a curva cair de 0 dB a -10 dB (×6 → RT60 equiv.)
        T20  : regressão linear entre -5 dB e -25 dB (×3 → RT60)
        T30  : regressão linear entre -5 dB e -35 dB (×2 → RT60)
        C50  : 10*log10(E[0..50ms] / E[50ms..end])
        C80  : 10*log10(E[0..80ms] / E[80ms..end])
        D50  : E[0..50ms] / E_total
        D80  : E[0..80ms] / E_total

    Retorna
    -------
    dict: edt, t20, t30, rt60_est, c50, c80, d50, d80, snr_db, warning
    """
    sch  = ir_data["schroeder"]   # em dB, starts at 0
    fs   = ir_data["sample_rate"]
    n    = len(sch)
    time = np.arange(n) / fs

    def _slope_regression(db_start: float, db_end: float) -> float:
        """Regressão linear no intervalo [db_start, db_end] da curva Schroeder."""
        i0 = _find_level_idx(sch, db_start)
        i1 = _find_level_idx(sch, db_end)
        if i0 is None or i1 is None or i1 <= i0 + 3:
            return None
        t_seg  = time[i0:i1]
        db_seg = sch[i0:i1]
        slope, intercept, r, *_ = linregress(t_seg, db_seg)
        if abs(slope) < 1e-6:
            return None
        # Tempo para cair 60 dB a partir desta inclinação
        return round(abs(-60 / slope), 3)

    edt  = _slope_regression(  0, -10)   # EDT: ×6
    t20  = _slope_regression( -5, -25)   # T20: ×3
    t30  = _slope_regression( -5, -35)   # T30: ×2

    # RT60 estimado: preferência T30 > T20 > EDT (maior precisão com SNR alto)
    snr = ir_data["snr_db"]
    if snr >= 45 and t30 is not None:
        rt60_est = t30
    elif snr >= 30 and t20 is not None:
        rt60_est = t20
    elif edt is not None:
        rt60_est = edt * 6.0  # extrapolação bruta
    else:
        rt60_est = None

    # C50, C80, D50, D80 (utilizam a IR directa, se disponível em ir_data)
    ir  = ir_data.get("ir")
    fs  = ir_data["sample_rate"]
    if ir is not None:
        ir_sq = ir ** 2
        total = np.sum(ir_sq) + 1e-30
        c50ms = min(int(0.050 * fs), len(ir))
        c80ms = min(int(0.080 * fs), len(ir))

        early50 = np.sum(ir_sq[:c50ms]) + 1e-30
        late50  = np.sum(ir_sq[c50ms:]) + 1e-30
        early80 = np.sum(ir_sq[:c80ms]) + 1e-30
        late80  = np.sum(ir_sq[c80ms:]) + 1e-30

        c50 = float(10 * np.log10(early50 / late50)) if late50 > 1e-30 else float(10 * np.log10(early50 / 1e-30))
        c80 = float(10 * np.log10(early80 / late80)) if late80 > 1e-30 else float(10 * np.log10(early80 / 1e-30))
        d50 = float(early50 / total)
        d80 = float(early80 / total)
    else:
        c50 = c80 = None
        d50 = d80 = None

    warning = None
    if snr < 35:
        warning = f"SNR baixo ({snr:.1f} dB): T30/T20 podem estar subestimados. Reduza o ruído ambiente."
    if rt60_est is not None and rt60_est > 10:
        warning = "RT60 acima de 10 s: verifique a captura (possível artefato)."

    return {
        "edt":     edt,
        "t20":     t20,
        "t30":     t30,
        "rt60_est": rt60_est,
        "c50":     c50,
        "c80":     c80,
        "d50":     d50,
        "d80":     d80,
        "snr_db":  snr,
        "warning": warning,
    }


def calculate_multiband_rt60(recording: np.ndarray,
                            reference: np.ndarray,
                            sample_rate: int) -> dict:
    """
    Calcula T20 e T30 por banda de oitava (125 Hz – 4 kHz).
    Usa filtros FIR passa-banda via FFT para cada oitava.
    """
    from scipy.signal import butter, sosfilt

    bands = [125, 250, 500, 1000, 2000, 4000]
    results = {}

    # Obter IR broadband primeiro
    ir_data = deconvolve_sweep(recording, reference, sample_rate)
    ir = ir_data["ir"]

    for fc in bands:
        f_low  = fc / np.sqrt(2)
        f_high = fc * np.sqrt(2)
        nyq    = sample_rate / 2

        f_low  = max(f_low,  20)
        f_high = min(f_high, nyq * 0.99)

        # Butterworth passa-banda de 4ª ordem
        sos = butter(4, [f_low / nyq, f_high / nyq], btype='band', output='sos')
        ir_band = sosfilt(sos, ir)

        # Schroeder da banda filtrada
        ir_sq = ir_band ** 2
        sch_raw = np.cumsum(ir_sq[::-1])[::-1]
        sch_db  = 10 * np.log10(sch_raw / (sch_raw[0] + 1e-30) + 1e-30)

        ir_band_data = {
            "schroeder":  sch_db,
            "sample_rate": sample_rate,
            "snr_db":      ir_data["snr_db"],
        }

        params = calculate_reverberation_params(ir_band_data)
        results[str(fc)] = {
            "t20": params["t20"],
            "t30": params["t30"],
            "edt": params["edt"],
        }

    return results


# ─── STI (Speech Transmission Index) ─────────────────────────────────────────

def calculate_sti(ir: np.ndarray,
                sample_rate: int,
                snr_per_band_db: dict | None = None,
                gender: str = "male") -> dict:
    """
    Estima o STI (Speech Transmission Index) conforme IEC 60268-16:2011.

    Método: STI from IR (Schroeder 1981 / Houtgast-Steeneken).
    Para cada banda de oitava e cada frequência de modulação, calcula o
    Modulation Transfer Function (MTF) m(F, f_oct) diretamente a partir da IR.

    Parâmetros
    ----------
    ir            : Resposta ao Impulso broadband (já deconvoluída)
    sample_rate   : fs em Hz
    snr_per_band_db : SNR em dB por banda (opcional; None = sem correção de ruído)
    gender        : 'male' ou 'female' (afeta os pesos das bandas)

    Retorna
    -------
    dict com:
        sti        : float 0–1
        sti_label  : str ('Péssimo'…'Excelente')
        cis        : float — Common Intelligibility Scale (1–5)
        mti        : list[float] — MTI por banda de oitava
        mtf_matrix : list[list[float]] — MTF[oitava][mod_freq]
        bands_hz   : list[int]
    """
    weights = _STI_WEIGHTS.get(gender, _STI_WEIGHTS['male'])
    n_bands = len(_STI_OCTAVE_BANDS)
    n_mf    = len(_STI_MOD_FREQS)

    ir_f64 = np.array(ir, dtype=np.float64)
    ir_sq  = ir_f64 ** 2
    energy_total = np.sum(ir_sq) + 1e-30

    mtf_matrix = np.zeros((n_bands, n_mf))

    for bi, fc_oct in enumerate(_STI_OCTAVE_BANDS):
        # Filtra a IR na banda de oitava
        ir_band = _bandpass_ir(ir_f64, sample_rate, fc_oct)
        ir_band_sq = ir_band ** 2
        e_band = np.sum(ir_band_sq) + 1e-30

        # Correção de SNR por banda (quando disponível)
        snr_db_band = None
        if snr_per_band_db and str(fc_oct) in snr_per_band_db:
            snr_db_band = snr_per_band_db[str(fc_oct)]

        for mi, F in enumerate(_STI_MOD_FREQS):
            # MTF calculado pela integral da IR com o kernel de modulação
            # m(F) = |∫ h²(t) · e^{-j2πFt} dt| / ∫ h²(t) dt
            t  = np.arange(len(ir_band_sq)) / sample_rate
            kernel = np.exp(-1j * 2 * np.pi * F * t)
            numerator = np.abs(np.sum(ir_band_sq * kernel))
            m = numerator / e_band

            # Correção de SNR (Houtgast-Steeneken, eq. 4):
            # m_corrected = m / (1 + 10^(-SNR/10))
            if snr_db_band is not None:
                snr_linear = 10 ** (snr_db_band / 10)
                m = m / (1 + 1 / (snr_linear + 1e-30))

            m = np.clip(m, 0, 1)
            mtf_matrix[bi, mi] = float(m)

    # MTI por banda: média aritmética dos m(F) para cada banda
    mti = np.mean(mtf_matrix, axis=1)

    # Conversão MTI → TI (Transmission Index) via função sigmoidal (IEC eq. 3)
    # TI_i = (SNR_eff_i + 15) / 30,  onde SNR_eff = 10·log10(m/(1-m))
    mti_safe = np.clip(mti, 1e-6, 1 - 1e-6)
    snr_eff  = 10 * np.log10(mti_safe / (1 - mti_safe))
    ti       = np.clip((snr_eff + 15) / 30, 0, 1)

    # STI = soma ponderada dos TI com correção de redundância (IEC eq. 5)
    w = weights / weights.sum()
    sti_raw = float(np.dot(w, ti))

    # Correção de redundância (correção p/ correlação entre bandas adj.)
    sti = _apply_redundancy_correction(ti, w, _ALPHA[:n_bands], _BETA[:n_bands])
    sti = float(np.clip(sti, 0, 1))

    return {
        "sti":        round(sti, 3),
        "sti_label":  _sti_label(sti),
        "cis":        round(_sti_to_cis(sti), 2),
        "mti":        [round(float(v), 4) for v in mti],
        "ti":         [round(float(v), 4) for v in ti],
        "mtf_matrix": [[round(float(v), 4) for v in row] for row in mtf_matrix],
        "bands_hz":   _STI_OCTAVE_BANDS,
        "mod_freqs":  _STI_MOD_FREQS,
    }


# ─── Ponto de entrada principal ──────────────────────────────────────────────

def analyze_sweep(recording: np.ndarray,
                  reference: np.ndarray,
                  sample_rate: int,
                  compute_sti: bool = True,
                  compute_multiband: bool = True,
                  gender: str = "male") -> dict:
    """
    Pipeline completo: gravação ESS → IR → EDT/T20/T30 → STI.

    Parâmetros
    ----------
    recording       : sinal capturado pelo microfone (raw PCM Float32)
    reference       : sweep de referência (gerado pelo frontend)
    sample_rate     : fs em Hz
    compute_sti     : incluir cálculo de STI
    compute_multiband : incluir RT60 por banda de oitava
    gender          : 'male'|'female' para pesos STI

    Retorna
    -------
    dict completo com todos os parâmetros acústicos
    """
    logger.info(f"[Acoustic] Iniciando análise: rec={len(recording)} ref={len(reference)} fs={sample_rate}")

    # 1. Deconvolução
    ir_data = deconvolve_sweep(recording, reference, sample_rate)
    ir      = ir_data["ir"]
    logger.info(f"[Acoustic] IR gerada: {len(ir)} samples, SNR={ir_data['snr_db']} dB")

    # 2. Parâmetros de reverberação (broadband)
    rev = calculate_reverberation_params(ir_data)

    # 3. RT60 multibanda (opcional)
    multiband = {}
    if compute_multiband:
        try:
            multiband = calculate_multiband_rt60(recording, reference, sample_rate)
        except Exception as ex:
            logger.warning(f"[Acoustic] Multibanda falhou: {ex}")

    # 4. STI (opcional)
    sti_result = {}
    if compute_sti:
        try:
            sti_result = calculate_sti(ir, sample_rate, gender=gender)
        except Exception as ex:
            logger.warning(f"[Acoustic] STI falhou: {ex}")

    # 5. Downsample da curva de Schroeder para transmissão ao frontend
    sch_downsampled = ir_data["schroeder"][::max(1, len(ir_data["schroeder"]) // 1000)].tolist()
    ir_db_downsampled = ir_data["ir_db"][::max(1, len(ir_data["ir_db"]) // 2000)].tolist()

    result = {
        "status":    "ok",
        "snr_db":    ir_data["snr_db"],
        "ir_db":     ir_db_downsampled,
        "schroeder": sch_downsampled,
        "edt":       rev["edt"],
        "t20":       rev["t20"],
        "t30":       rev["t30"],
        "rt60_est":  rev["rt60_est"],
        "c50":       rev["c50"],
        "c80":       rev["c80"],
        "d50":       rev["d50"],
        "d80":       rev["d80"],
        "warning":   rev["warning"],
        "multiband": multiband,
        "sti":       sti_result,
        "duration_s": ir_data["duration_s"],
    }

    logger.info(f"[Acoustic] EDT={rev['edt']}s T20={rev['t20']}s T30={rev['t30']}s STI={sti_result.get('sti','N/A')}")
    return result


# ─── Helpers privados ─────────────────────────────────────────────────────────

def _next_pow2(n: int) -> int:
    """Menor potência de 2 >= n."""
    p = 1
    while p < n:
        p <<= 1
    return p


def _find_level_idx(schroeder_db: np.ndarray, target_db: float):
    """Retorna o índice onde a curva de Schroeder cruza target_db."""
    for i, v in enumerate(schroeder_db):
        if v <= target_db:
            return i
    return None


def _bandpass_ir(ir: np.ndarray, fs: int, fc: int) -> np.ndarray:
    """Filtra a IR em uma banda de oitava centrada em fc Hz."""
    from scipy.signal import butter, sosfilt
    nyq   = fs / 2
    f_low  = max(fc / np.sqrt(2), 20)
    f_high = min(fc * np.sqrt(2), nyq * 0.99)
    sos = butter(4, [f_low / nyq, f_high / nyq], btype='band', output='sos')
    return sosfilt(sos, ir)


def _apply_redundancy_correction(ti: np.ndarray,
                                  w: np.ndarray,
                                  alpha: np.ndarray,
                                  beta: np.ndarray) -> float:
    """
    Correção de redundância conforme IEC 60268-16:2011, eq. 5.
    STI = Σ(αi·TIi·wi) - Σ(βi·√(TIi·TI(i+1))·wi)
    """
    n   = len(ti)
    s1  = np.sum(alpha[:n] * ti * w)
    s2  = 0.0
    for i in range(n - 1):
        s2 += beta[i] * np.sqrt(ti[i] * ti[i + 1]) * w[i]
    return s1 - s2


def _sti_label(sti: float) -> str:
    if sti >= 0.75: return "Excelente"
    if sti >= 0.60: return "Bom"
    if sti >= 0.45: return "Regular"
    if sti >= 0.30: return "Pobre"
    return "Péssimo"


def _sti_to_cis(sti: float) -> float:
    """Converte STI para Common Intelligibility Scale (1–5)."""
    # CIS = 1 + 4 × STI^0.6 (aproximação polinomial da curva IEC)
    return 1.0 + 4.0 * (sti ** 0.6)

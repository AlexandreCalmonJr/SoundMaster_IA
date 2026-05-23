"""
SoundMaster Pro — Hardware Predictive Maintenance Engine
=========================================================
Analisa o histórico de snapshots acústicos de um canal para detetar
degradação progressiva do sinal ao longo do tempo.

Algoritmos:
  1. Regressão linear por banda de oitava (tendência temporal dB/mês)
  2. Z-score para deteção de anomalias pontuais
  3. Análise de inclinação espectral (tilt HF) para cabos/conectores
  4. Comparação com baseline (primeiros 10% das medições)

Diagnósticos gerados:
  - CABO_DEGRADADO      → perda HF progressiva (>10kHz) > 3dB/mês
  - CONECTOR_OXIDADO    → queda abrupta em frequências específicas
  - CAPSULA_DESGASTE    → alteração de timbre broadband + perda de presença
  - NORMAL              → sem anomalias detetadas

Uso standalone:
  python predictive_maintenance.py --channel "Microfone Púlpito" --db-path ./history.db

Uso via API (endpoint /hardware_diagnosis):
  POST { "channel": str, "snapshots": [...], "months": 6 }
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
from scipy import stats

# ─── Constantes ────────────────────────────────────────────────────────────────

# Bandas de oitava standard (Hz) — usadas para agrupar o espectro
OCTAVE_BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]

# Bandas consideradas "altas frequências" para diagnóstico de cabos/conectores
HF_BANDS_HZ = [4000, 8000, 16000]

# Thresholds de diagnóstico (dB por mês)
THRESHOLDS = {
    "hf_slope_warn_db_per_month":  1.5,   # perda HF progressiva — AVISO
    "hf_slope_crit_db_per_month":  3.0,   # perda HF progressiva — CRÍTICO (cabo/conector)
    "broadband_drift_db":          4.0,   # drift broadband vs baseline — desgaste de cápsula
    "anomaly_z_score":             3.0,   # desvio > 3σ = anomalia pontual
    "tilt_warn_db":                6.0,   # inclinação espectral anormal (HF vs LF) — AVISO
    "tilt_crit_db":               12.0,   # inclinação espectral crítica — CRÍTICO
    "min_snapshots":               5,     # mínimo de medições para análise fiável
}

# ─── Modelos de dados ──────────────────────────────────────────────────────────

@dataclass
class BandAnalysis:
    hz:           float
    label:        str
    mean_db:      float
    baseline_db:  float
    drift_db:     float          # mean_db - baseline_db
    slope_per_month: float       # regressão linear (dB/mês)
    r_squared:    float          # qualidade do fit
    anomalies:    list[int]      # índices de medições anómalas

@dataclass
class Diagnosis:
    channel:      str
    code:         str            # NORMAL | CABO_DEGRADADO | CONECTOR_OXIDADO | CAPSULA_DESGASTE
    severity:     str            # ok | warn | critical
    confidence:   float          # 0–1
    summary:      str
    recommendations: list[str]   = field(default_factory=list)
    bands:        list[dict]     = field(default_factory=list)
    stats:        dict           = field(default_factory=dict)
    generated_at: str            = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# ─── Motor principal ───────────────────────────────────────────────────────────

class PredictiveMaintenanceEngine:
    """
    Recebe snapshots acústicos de um canal e produz um diagnóstico de hardware.

    Cada snapshot deve conter:
      - timestamp: ISO 8601 string ou epoch ms
      - spectrum_db: dict {"hz": dB, ...} ou list [[hz, dB], ...]
    """

    def __init__(self, thresholds: dict | None = None):
        self.t = {**THRESHOLDS, **(thresholds or {})}

    # ── API pública ────────────────────────────────────────────────────────────

    def analyze(
        self,
        channel: str,
        snapshots: list[dict],
        months: int = 6,
    ) -> Diagnosis:
        """
        Ponto de entrada principal.

        :param channel:   nome do canal (ex: "Microfone Púlpito")
        :param snapshots: lista de dicts com 'timestamp' e 'spectrum_db'
        :param months:    janela temporal de análise (padrão: 6 meses)
        :returns:         Diagnosis com código, severidade e recomendações
        """
        # Filtra pelo período e ordena cronologicamente
        cutoff = datetime.now(timezone.utc) - timedelta(days=30 * months)
        valid  = [s for s in snapshots if self._parse_ts(s) >= cutoff]
        valid.sort(key=self._parse_ts)

        if len(valid) < self.t["min_snapshots"]:
            return Diagnosis(
                channel=channel,
                code="DADOS_INSUFICIENTES",
                severity="ok",
                confidence=0.0,
                summary=(
                    f"Apenas {len(valid)} medições disponíveis nos últimos {months} meses. "
                    f"São necessárias pelo menos {self.t['min_snapshots']} para análise preditiva."
                ),
                recommendations=["Realizar medições mensais regulares para acumular histórico."],
            )

        # Extrai matriz de espectro: shape (N_snapshots, N_bands)
        times    = np.array([self._parse_ts(s).timestamp() for s in valid], dtype=float)
        spectra  = np.array([self._extract_bands(s) for s in valid], dtype=float)  # (N, B)

        # Análise por banda
        band_analyses = self._analyze_bands(times, spectra)

        # Diagnósticos específicos
        hf_diag    = self._diagnose_hf_loss(band_analyses)
        tilt_diag  = self._diagnose_spectral_tilt(spectra)
        broad_diag = self._diagnose_broadband_drift(spectra)
        anomalies  = self._find_anomalies(spectra)

        return self._build_diagnosis(
            channel, band_analyses, hf_diag, tilt_diag, broad_diag, anomalies, len(valid)
        )

    # ── Extração de espectro ───────────────────────────────────────────────────

    def _extract_bands(self, snapshot: dict) -> np.ndarray:
        """
        Converte spectrum_db (dict ou list) para um array de valores
        por banda de oitava, usando interpolação log-linear.
        """
        raw = snapshot.get("spectrum_db") or snapshot.get("spectrum") or {}

        # Normaliza para lista de (hz, dB)
        if isinstance(raw, dict):
            points = [(float(k), float(v)) for k, v in raw.items()
                      if self._is_numeric(k) and self._is_numeric(v)]
        elif isinstance(raw, list):
            points = [(float(p[0]), float(p[1])) for p in raw if len(p) >= 2]
        else:
            return np.full(len(OCTAVE_BANDS), -60.0)

        if not points:
            return np.full(len(OCTAVE_BANDS), -60.0)

        points.sort(key=lambda p: p[0])
        freqs = np.array([p[0] for p in points])
        dbs   = np.array([p[1] for p in points])

        # Interpolação log-linear para cada banda de oitava
        log_freqs = np.log10(np.maximum(freqs, 1))
        result    = np.zeros(len(OCTAVE_BANDS))

        for i, band_hz in enumerate(OCTAVE_BANDS):
            log_f = math.log10(band_hz)
            if log_f <= log_freqs[0]:
                result[i] = dbs[0]
            elif log_f >= log_freqs[-1]:
                result[i] = dbs[-1]
            else:
                # Busca binária + interpolação
                idx = np.searchsorted(log_freqs, log_f) - 1
                idx = max(0, min(idx, len(log_freqs) - 2))
                t   = (log_f - log_freqs[idx]) / (log_freqs[idx + 1] - log_freqs[idx] + 1e-10)
                result[i] = dbs[idx] + t * (dbs[idx + 1] - dbs[idx])

        return result

    # ── Análise de tendência por banda ────────────────────────────────────────

    def _analyze_bands(self, times: np.ndarray, spectra: np.ndarray) -> list[BandAnalysis]:
        """
        Regressão linear OLS para cada banda de oitava.
        Converte o coeficiente angular de dB/segundo para dB/mês.
        """
        n_bands   = spectra.shape[1]
        baseline  = spectra[:max(1, len(spectra) // 5)].mean(axis=0)  # primeiros 20%
        t_months  = (times - times[0]) / (30 * 86400)                 # segundos → meses

        analyses = []
        for b in range(n_bands):
            col = spectra[:, b]

            # Regressão linear (scipy)
            if len(col) >= 2 and np.var(t_months) > 1e-6:
                slope, intercept, r, p, se = stats.linregress(t_months, col)
            else:
                slope, r = 0.0, 0.0

            # Anomalias via Z-score
            z_scores = np.abs(stats.zscore(col)) if len(col) > 2 and np.std(col) > 1e-6 else np.zeros_like(col)
            anomaly_idx = np.where(z_scores > self.t["anomaly_z_score"])[0].tolist()

            hz = OCTAVE_BANDS[b]
            analyses.append(BandAnalysis(
                hz=hz,
                label=self._hz_label(hz),
                mean_db=float(col.mean()),
                baseline_db=float(baseline[b]),
                drift_db=float(col.mean() - baseline[b]),
                slope_per_month=float(slope),
                r_squared=float(r ** 2),
                anomalies=anomaly_idx,
            ))

        return analyses

    # ── Diagnósticos específicos ───────────────────────────────────────────────

    def _diagnose_hf_loss(self, bands: list[BandAnalysis]) -> dict:
        """
        Perda progressiva de altas frequências (>4kHz):
          - Indica oxidação de conector, cabo coaxial danificado ou
            cápsula com desgaste de membrana por humidade.
        Usa a média ponderada das tendências das bandas HF.
        """
        hf_bands = [b for b in bands if b.hz in HF_BANDS_HZ]
        if not hf_bands:
            return {"slope": 0, "severity": "ok"}

        # Média ponderada: bandas mais altas têm mais peso (mais sensíveis a cabos)
        weights = [b.hz for b in hf_bands]
        w_sum   = sum(weights)
        avg_slope = sum(b.slope_per_month * w for b, w in zip(hf_bands, weights)) / w_sum

        # Só conta como perda se a tendência for negativa (atenuação progressiva)
        if avg_slope >= 0:
            return {"slope": avg_slope, "severity": "ok"}

        slope_abs = abs(avg_slope)
        if slope_abs >= self.t["hf_slope_crit_db_per_month"]:
            return {"slope": avg_slope, "severity": "critical",
                    "detail": f"Perda HF: {slope_abs:.2f} dB/mês (limite crítico: {self.t['hf_slope_crit_db_per_month']} dB/mês)"}
        if slope_abs >= self.t["hf_slope_warn_db_per_month"]:
            return {"slope": avg_slope, "severity": "warn",
                    "detail": f"Perda HF: {slope_abs:.2f} dB/mês (limite aviso: {self.t['hf_slope_warn_db_per_month']} dB/mês)"}

        return {"slope": avg_slope, "severity": "ok"}

    def _diagnose_spectral_tilt(self, spectra: np.ndarray) -> dict:
        """
        Inclinação espectral (Spectral Tilt):
          Calcula a diferença média entre as bandas LF (63–500Hz) e HF (4k–16kHz).
          Um tilt crescente ao longo do tempo indica perda de brilho/presença.
        """
        lf_idx = [i for i, hz in enumerate(OCTAVE_BANDS) if 63 <= hz <= 500]
        hf_idx = [i for i, hz in enumerate(OCTAVE_BANDS) if hz >= 4000]

        if not lf_idx or not hf_idx:
            return {"tilt_db": 0, "severity": "ok"}

        lf_mean   = spectra[:, lf_idx].mean()
        hf_mean   = spectra[:, hf_idx].mean()
        tilt_db   = float(lf_mean - hf_mean)  # positivo = HF mais baixo que LF

        if tilt_db >= self.t["tilt_crit_db"]:
            severity = "critical"
        elif tilt_db >= self.t["tilt_warn_db"]:
            severity = "warn"
        else:
            severity = "ok"

        return {"tilt_db": tilt_db, "severity": severity}

    def _diagnose_broadband_drift(self, spectra: np.ndarray) -> dict:
        """
        Drift broadband: compara o nível médio actual com o baseline.
        Um drift negativo uniforme em todas as bandas sugere:
          - Desgaste de cápsula de microfone dinâmico
          - Problema de pré-amplificador ou fonte phantom
        """
        n          = len(spectra)
        baseline   = spectra[:max(1, n // 5)].mean(axis=0)
        recent     = spectra[max(0, n - max(1, n // 5)):].mean(axis=0)
        drift      = float((recent - baseline).mean())
        drift_abs  = abs(drift)

        if drift_abs >= self.t["broadband_drift_db"] and drift < 0:
            severity = "critical" if drift_abs >= self.t["broadband_drift_db"] * 1.5 else "warn"
        else:
            severity = "ok"

        return {"drift_db": drift, "severity": severity}

    def _find_anomalies(self, spectra: np.ndarray) -> list[int]:
        """
        Deteção de medições anómalas (outliers) no nível médio broadband.
        Uma anomalia pode indicar uma queda súbita (conector solto) ou
        um pico (oscilação de ganho).
        """
        mean_levels = spectra.mean(axis=1)
        if len(mean_levels) < 3:
            return []
        z = np.abs(stats.zscore(mean_levels))
        return np.where(z > self.t["anomaly_z_score"])[0].tolist()

    # ── Diagnóstico final ──────────────────────────────────────────────────────

    def _build_diagnosis(
        self,
        channel:     str,
        bands:       list[BandAnalysis],
        hf_diag:     dict,
        tilt_diag:   dict,
        broad_diag:  dict,
        anomalies:   list[int],
        n_snapshots: int,
    ) -> Diagnosis:
        """
        Combina todos os diagnósticos numa decisão final.
        Prioridade: critical > warn > ok
        """
        recs  = []
        code  = "NORMAL"
        sev   = "ok"
        conf  = 0.0

        hf_sev     = hf_diag.get("severity",    "ok")
        tilt_sev   = tilt_diag.get("severity",  "ok")
        broad_sev  = broad_diag.get("severity", "ok")

        # ── Cabo degradado / Conector oxidado ─────────────────────────────────
        if hf_sev == "critical":
            code = "CABO_DEGRADADO"
            sev  = "critical"
            conf = min(0.95, 0.6 + abs(hf_diag["slope"]) * 0.1)
            recs += [
                "🔴 URGENTE: Substituir o cabo XLR do microfone.",
                "Inspecionar e limpar os conectores com spray de contato.",
                "Verificar se o cabo está dobrado, comprimido ou enrolado sobre si mesmo.",
            ]
        elif hf_sev == "warn":
            code = "CONECTOR_SUSPEITO"
            sev  = "warn"
            conf = min(0.8, 0.4 + abs(hf_diag["slope"]) * 0.1)
            recs += [
                "🟡 Inspecionar o cabo XLR e os conectores.",
                "Limpar contatos com spray dielétrico (WD-40 Contact ou CRC Contact Cleaner).",
                "Testar com um cabo de substituição para isolar o problema.",
            ]

        # ── Inclinação espectral anormal ──────────────────────────────────────
        if tilt_sev == "critical" and sev != "critical":
            code = "TILT_ESPECTRAL_CRITICO"
            sev  = "critical"
            conf = max(conf, 0.75)
            recs += [
                "🔴 Inclinação espectral crítica detetada.",
                "Verificar o filtro passa-alta (HPF) do canal — pode estar demasiado agressivo.",
                "Inspecionar o equalizador do canal por configurações de corte excessivo.",
            ]
        elif tilt_sev == "warn" and sev == "ok":
            sev  = "warn"
            conf = max(conf, 0.5)
            recs += [
                "🟡 Leve perda de brilho detetada.",
                "Rever configurações de EQ do canal.",
                "Considerar um EQ de compensação suave (+2dB a 10kHz).",
            ]

        # ── Desgaste de cápsula (drift broadband) ─────────────────────────────
        if broad_sev != "ok":
            drift = broad_diag["drift_db"]
            if broad_sev == "critical" or (broad_sev == "warn" and sev != "critical"):
                if sev == "ok":
                    code = "CAPSULA_DESGASTE"
                    sev  = broad_sev
                conf = max(conf, 0.65)
                recs += [
                    f"📉 Queda de nível broadband: {drift:.1f} dB vs baseline.",
                    "Inspecionar a cápsula do microfone por humidade, poeira ou deformação.",
                    "Verificar o ganho de pré-amplificador e a fonte de alimentação Phantom.",
                    "Considerar a substituição da cápsula se o microfone tiver >3 anos de uso intensivo.",
                ]

        # ── Anomalias pontuais ────────────────────────────────────────────────
        if anomalies:
            recs.append(
                f"⚠️ {len(anomalies)} medição(ões) anómala(s) detetada(s) — "
                "pode indicar conexão intermitente ou problema de pré-amplificador."
            )

        # ── Resumo ────────────────────────────────────────────────────────────
        summary_map = {
            "NORMAL":                "Equipamento sem anomalias detetadas. Funcionamento dentro dos parâmetros esperados.",
            "CABO_DEGRADADO":        f"Perda progressiva de altas frequências: {hf_diag.get('slope', 0):.2f} dB/mês. Provável degradação de cabo ou conector.",
            "CONECTOR_SUSPEITO":     f"Tendência de perda HF de {hf_diag.get('slope', 0):.2f} dB/mês. Inspecionar conectores.",
            "TILT_ESPECTRAL_CRITICO": f"Inclinação espectral de {tilt_diag.get('tilt_db', 0):.1f} dB. Verificar EQ e cabos.",
            "CAPSULA_DESGASTE":      f"Queda de nível broadband de {broad_diag.get('drift_db', 0):.1f} dB vs baseline. Inspecionar cápsula.",
        }
        summary = summary_map.get(code, "Análise concluída.")

        if not recs:
            recs.append("✅ Nenhuma ação de manutenção necessária neste momento.")

        return Diagnosis(
            channel=channel,
            code=code,
            severity=sev,
            confidence=round(conf, 3),
            summary=summary,
            recommendations=list(dict.fromkeys(recs)),  # remove duplicados, preserva ordem
            bands=[asdict(b) for b in bands],
            stats={
                "n_snapshots":      n_snapshots,
                "hf_slope_db_month": round(hf_diag.get("slope", 0), 3),
                "spectral_tilt_db":  round(tilt_diag.get("tilt_db", 0), 2),
                "broadband_drift_db": round(broad_diag.get("drift_db", 0), 2),
                "anomaly_count":     len(anomalies),
            },
        )

    # ── Utilitários ───────────────────────────────────────────────────────────

    @staticmethod
    def _parse_ts(snapshot: dict) -> datetime:
        ts = snapshot.get("timestamp") or snapshot.get("ts") or 0
        if isinstance(ts, (int, float)):
            # epoch ms (JavaScript) ou epoch s
            if ts > 1e10:
                ts = ts / 1000
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except Exception:
            return datetime.now(timezone.utc)

    @staticmethod
    def _is_numeric(v: Any) -> bool:
        try:
            float(v)
            return True
        except (TypeError, ValueError):
            return False

    @staticmethod
    def _hz_label(hz: float) -> str:
        if hz >= 1000:
            return f"{hz/1000:.0f}kHz" if hz % 1000 == 0 else f"{hz/1000:.1f}kHz"
        return f"{hz:.0f}Hz"


# ─── CLI standalone ───────────────────────────────────────────────────────────

def _cli():
    parser = argparse.ArgumentParser(description="SoundMaster Pro — Predictive Maintenance")
    parser.add_argument("--channel", default="Canal 1", help="Nome do canal a analisar")
    parser.add_argument("--input",   default="-",       help="Ficheiro JSON de snapshots (- para stdin)")
    parser.add_argument("--months",  type=int, default=6, help="Janela temporal em meses")
    parser.add_argument("--thresholds", default="{}", help="JSON de thresholds customizados")
    args = parser.parse_args()

    if args.input == "-":
        raw = sys.stdin.read()
    else:
        with open(args.input) as f:
            raw = f.read()

    snapshots  = json.loads(raw)
    thresholds = json.loads(args.thresholds)

    engine = PredictiveMaintenanceEngine(thresholds)
    result = engine.analyze(args.channel, snapshots, args.months)
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    _cli()

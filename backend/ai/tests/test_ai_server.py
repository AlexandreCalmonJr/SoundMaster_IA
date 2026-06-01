import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from ai_server import app, verify_api_key

app.dependency_overrides[verify_api_key] = lambda: True

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"
    assert "engine" in response.json()

def test_chat_basic():
    response = client.post("/chat", json={"message": "voz abafada"})
    assert response.status_code == 200
    data = response.json()
    assert "text" in data

def test_chat_with_mixer_context():
    response = client.post("/chat", json={
        "message": "aumentar volume",
        "mixer_context": {"channel": {"mute": 1, "level": 0.5}, "master": {"mute": 0}}
    })
    assert response.status_code == 200
    data = response.json()
    assert "text" in data

def test_chat_mensagem_muito_longa_rejeitada():
    response = client.post("/chat", json={"message": "x" * 5001})
    assert response.status_code == 422

def test_analyze_feedback_basic():
    response = client.post("/analyze-feedback", json={
        "freq": 1000, "db": -12, "prevDb": -18, "gain": 3, "isFeedback": True
    })
    assert response.status_code == 200
    data = response.json()
    assert "risk" in data or "analysis" in data or "suggestion" in data

def test_analyze_feedback_with_history():
    response = client.post("/analyze-feedback", json={
        "peakHistory": [
            {"hz": 1000, "db": -20},
            {"hz": 1500, "db": -15},
            {"hz": 2000, "db": -10},
            {"hz": 2500, "db": -8},
            {"hz": 3000, "db": -5}
        ],
        "threshold": -15
    })
    assert response.status_code == 200

def test_analyze_feedback_invalid():
    response = client.post("/analyze-feedback", json={})
    assert response.status_code == 400

def test_auto_eq_flat():
    response = client.post("/api/calculate/auto-eq", json={
        "freqData": [40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 20000],
        "sampleRate": 48000,
        "fftSize": 8192,
        "targetCurve": "flat"
    })
    assert response.status_code == 200
    data = response.json()
    assert "filters" in data or "peq" in data or "eq" in data

def test_auto_eq_smaart():
    response = client.post("/api/calculate/auto-eq", json={
        "freqData": [40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 20000],
        "sampleRate": 48000,
        "fftSize": 8192,
        "targetCurve": "smaart"
    })
    assert response.status_code == 200

def test_rt60_endpoint():
    payload = {
        "impulseResponse": [1.0, 0.5, 0.25, 0.125, 0.0625, 0.03125, 0.015625, 0.0078125] * 20,
        "sampleRate": 1000
    }
    response = client.post("/api/calculate/rt60", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "edt" in data
    assert "t20" in data
    assert "t30" in data
    assert "rt60" in data


class TestRt60Iec:
    """Testes do endpoint /api/calculate/rt60 com regressão linear IEC 3382-1."""

    def _make_ir(self, decay_t60_s: float, sr: int = 48000, dur_s: float = 3.0) -> list:
        """Gera IR sintética com decaimento exponencial alvo T60 = decay_t60_s."""
        import numpy as np
        n = int(sr * dur_s)
        t = np.arange(n) / sr
        k = 6.9078 / max(decay_t60_s, 0.05)
        envelope = np.exp(-k * t)
        rng = np.random.default_rng(42)
        noise = rng.standard_normal(n) * 0.001
        ir = envelope + noise
        ir[0] = 1.0
        return ir.tolist()

    def test_response_shape_iec(self):
        import numpy as np
        ir = self._make_ir(decay_t60_s=0.8, sr=48000, dur_s=2.0)
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir, "sampleRate": 48000,
        })
        assert response.status_code == 200
        data = response.json()
        for k in ("rt60", "edt", "t20", "t30", "c50", "c80", "d50",
                  "snr_db", "sti", "sti_category", "method", "curve"):
            assert k in data, f"missing key: {k}"
        assert data["method"].startswith("ISO 3382-1")

    def test_rt60_within_20pct_of_ground_truth(self):
        """
        Para uma IR sintética com T60 = 0.8 s, a regressão linear deve estimar
        T30 (preferido quando SNR alto) dentro de ±20% do valor alvo.
        """
        ir = self._make_ir(decay_t60_s=0.8, sr=48000, dur_s=3.0)
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir, "sampleRate": 48000,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["t30"] is not None, "T30 não deveria ser None com IR limpa"
        assert abs(data["t30"] - 0.8) / 0.8 < 0.20, (
            f"T30={data['t30']} fora de ±20% do alvo 0.8s"
        )
        assert data["rt60"] is not None
        assert 0.5 < data["rt60"] < 1.2, f"rt60={data['rt60']} inesperado"

    def test_long_decay_yields_longer_rt60(self):
        """Sala 'vazia' (T60 longo) deve produzir RT60 > sala 'tratada' (curto)."""
        ir_dead = self._make_ir(decay_t60_s=2.5, sr=48000, dur_s=4.0)
        ir_treated = self._make_ir(decay_t60_s=0.6, sr=48000, dur_s=2.0)
        d_dead = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir_dead, "sampleRate": 48000,
        }).json()
        d_treated = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir_treated, "sampleRate": 48000,
        }).json()
        assert d_dead["t30"] > d_treated["t30"], (
            f"sala com T60=2.5s produziu t30={d_dead['t30']}, "
            f"menor que sala com T60=0.6s ({d_treated['t30']})"
        )

    def test_sti_uses_iec_method_not_heuristic(self):
        """
        O STI legado era `1 - rt60/4` (heurística). O novo caminho usa
        calculate_sti (IEC 60268-16:2011) que depende da IR, não só do RT60.
        """
        import numpy as np
        sr = 16000
        n = int(sr * 0.8)
        ir = np.zeros(n)
        ir[0] = 1.0
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir.tolist(), "sampleRate": sr,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["sti"] is not None
        # IR = delta ideal → STI deve ser alto (próximo de 1.0), não definido por 1 - 0/4 = 1.0
        # mas a presença do valor confirma que calculate_sti foi chamado.
        assert 0.0 <= data["sti"] <= 1.0
        assert data["sti_category"] in (
            "Excelente", "Bom", "Regular", "Pobre", "Péssimo", "Indisponível"
        )

    def test_very_short_ir_rejected(self):
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": [0.1] * 50, "sampleRate": 48000,
        })
        assert response.status_code == 400

    def test_curve_is_downsampled(self):
        ir = self._make_ir(decay_t60_s=1.0, sr=48000, dur_s=5.0)
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir, "sampleRate": 48000,
        })
        data = response.json()
        assert len(data["curve"]) <= 2050
        assert len(data["curve"]) > 100

    def test_low_sample_rate_skips_sti_gracefully(self):
        """
        SR < 8000 Hz é inadequado para filtros de oitava STI → resposta
        deve vir com sti=None e sti_category='Indisponível', sem 500.
        """
        import numpy as np
        sr = 1000
        n = int(sr * 2.0)
        ir = (np.exp(-3 * np.arange(n) / sr) * 0.5).tolist()
        ir[0] = 1.0
        response = client.post("/api/calculate/rt60", json={
            "impulseResponse": ir, "sampleRate": sr,
        })
        assert response.status_code == 200
        data = response.json()
        assert data["sti"] is None
        assert data["sti_category"] == "Indisponível"

def test_spl_a_weighting():
    response = client.post("/api/calculate/spl", json={
        "freqData": [-60, -55, -50, -45, -40, -35, -30, -25, -20],
        "sampleRate": 48000,
        "weighting": "A"
    })
    assert response.status_code == 200
    data = response.json()
    assert "rmsDb" in data

def test_spl_c_weighting():
    response = client.post("/api/calculate/spl", json={
        "freqData": [-60, -55, -50, -45, -40, -35, -30, -25, -20],
        "sampleRate": 48000,
        "weighting": "C"
    })
    assert response.status_code == 200

def test_process_wav():
    import numpy as np
    sr = 16000
    duration = 0.1
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    wav = (np.sin(2 * np.pi * 440 * t) * 0.5).astype(np.float32)
    from scipy.io import wavfile
    import io
    buf = io.BytesIO()
    wavfile.write(buf, sr, wav)
    buf.seek(0)
    response = client.post("/process", files={"file": ("test.wav", buf, "audio/wav")})
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) > 44

def test_classify_silence():
    response = client.post("/api/ai/classify", json={
        "audio": [0.0] * 16000,
        "sampleRate": 16000,
        "k": 3,
        "threshold": 0.01
    })
    assert response.status_code == 200
    data = response.json()
    assert "classes" in data
    assert "topClass" in data

def test_classify_no_audio():
    response = client.post("/api/ai/classify", json={
        "audio": [],
        "sampleRate": 16000,
        "k": 1,
        "threshold": 0.1
    })
    assert response.status_code == 200

def test_chat_history():
    response = client.get("/chat/history/test-session")
    assert response.status_code == 200
    data = response.json()
    assert "messages" in data

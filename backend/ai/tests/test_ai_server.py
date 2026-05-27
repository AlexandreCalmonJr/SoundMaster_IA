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

def test_chat_history():
    response = client.get("/chat/history/test-session")
    assert response.status_code == 200
    data = response.json()
    assert "messages" in data

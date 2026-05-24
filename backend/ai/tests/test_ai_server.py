import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient
from ai_server import app, verify_api_key

# Sobrescrever a dependência de autenticação para os testes
app.dependency_overrides[verify_api_key] = lambda: True

client = TestClient(app)

def test_read_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["status"] == "online"
    assert "engine" in response.json()

def test_rt60_endpoint():
    # Enviar uma resposta ao impulso simulada curta para testar o cálculo de RT60
    # e garantir que não há erros de importação (numpy/math) em runtime.
    # Usando 160 samples (8 * 20) para passar da validação de n >= 100.
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

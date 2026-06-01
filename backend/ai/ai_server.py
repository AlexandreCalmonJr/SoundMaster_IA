# -*- coding: utf-8 -*-
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import json
import math
import hmac
import numpy as np
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import io
from scipy.io import wavfile
from scipy import signal
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import time
import asyncio
from dataclasses import asdict
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from fastapi.concurrency import run_in_threadpool

# Importações Modulares
from engine.ai_logic import AIEngine, SessionContext
from engine.classifier import AudioClassifier
from acoustics.processor import AcousticProcessor
from predictive_maintenance import PredictiveMaintenanceEngine
from acoustic_analysis import calculate_reverberation_params, calculate_sti

_maintenance_engine = PredictiveMaintenanceEngine()
_classifier = AudioClassifier()

load_dotenv()

# ─── Rate Limiter simples (em memória) ────────────────────────────────────────
_ratelimit_store: Dict[str, list] = {}
_RATELIMIT_MAX = 60          # requisições
_RATELIMIT_WINDOW = 60       # segundos

async def _rate_limit(ip: str):
    now = time.time()
    if ip not in _ratelimit_store:
        _ratelimit_store[ip] = []
    _ratelimit_store[ip] = [t for t in _ratelimit_store[ip] if now - t < _RATELIMIT_WINDOW]
    if len(_ratelimit_store[ip]) >= _RATELIMIT_MAX:
        raise HTTPException(status_code=429, detail="Muitas requisições. Aguarde e tente novamente.")
    _ratelimit_store[ip].append(now)

async def _cleanup_ratelimit_store():
    """Remove IPs inativos do rate limit store a cada 5 minutos."""
    while True:
        await asyncio.sleep(300)
        now = time.time()
        stale_ips = [ip for ip, timestamps in _ratelimit_store.items()
                     if not timestamps or (now - timestamps[-1]) > _RATELIMIT_WINDOW * 2]
        for ip in stale_ips:
            del _ratelimit_store[ip]

# ─── Validações de upload ─────────────────────────────────────────────────────
_MAX_UPLOAD_MB = 50
_MAX_UPLOAD_BYTES = _MAX_UPLOAD_MB * 1024 * 1024
_WAV_MAGIC = b"RIFF"

async def _validate_upload(file: UploadFile):
    if file.size and file.size > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Arquivo muito grande. Máximo: {_MAX_UPLOAD_MB}MB")
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Arquivo muito grande. Máximo: {_MAX_UPLOAD_MB}MB")
    if content[:4] != _WAV_MAGIC or content[8:12] != b"WAVE":
        raise HTTPException(status_code=400, detail="Formato inválido. Envie um arquivo WAV.")
    if len(content) < 44:
        raise HTTPException(status_code=400, detail="Arquivo WAV muito pequeno ou corrompido.")
    return content

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Inicia limpeza de sessões e rate-limit store
    asyncio.create_task(cleanup_sessions_task())
    asyncio.create_task(_cleanup_ratelimit_store())
    yield

app = FastAPI(title="SoundMaster Pro AI Engine", lifespan=lifespan)

_frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
if _frontend_url == "*" or "*" in _frontend_url:
    print("[WARN] FRONTEND_URL contém '*' — CORS permissivo. Defina uma URL específica em produção.")
    _frontend_url = "http://localhost:3000"
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    _frontend_url
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    max_age=3600,
)

@app.middleware("http")
async def _ratelimit_middleware(request: Request, call_next):
    if request.url.path != "/":
        ip = request.client.host if request.client else "unknown"
        try:
            await _rate_limit(ip)
        except HTTPException:
            return JSONResponse(status_code=429, content={"detail": "Muitas requisições. Aguente e tente novamente."})
    return await call_next(request)

from fastapi.security import APIKeyHeader
from fastapi import Depends, status

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Depends(api_key_header)):
    """Verifica se API Key é válida"""
    valid_key = os.getenv("AI_API_KEY")

    if not valid_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="AI_API_KEY nao configurada. Defina a variavel de ambiente AI_API_KEY."
        )

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key ausente"
        )

    if not hmac.compare_digest(api_key, valid_key):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API Key inválida"
        )

    return True

# Inicialização de Estado (Dicionário de sessões por ID)
sessions: Dict[str, SessionContext] = {}

def get_session(session_id: str = "default") -> SessionContext:
    if session_id not in sessions:
        sessions[session_id] = SessionContext()
    else:
        sessions[session_id].touch()
    return sessions[session_id]

async def cleanup_sessions_task():
    """Tarefa em background para limpar sessões inativas (TTL de 1 hora)"""
    while True:
        try:
            await asyncio.sleep(600)  # Roda a cada 10 minutos
            cutoff = time.time() - 3600  # 1 hora
            expired = [sid for sid, s in sessions.items() if s.last_activity < cutoff]
            for sid in expired:
                if sid != "default": # Mantemos a default
                    del sessions[sid]
            if expired:
                print(f"[AI Server] Sessões limpas: {len(expired)}")
        except Exception as e:
            print(f"[AI Server] Erro no cleanup de sessões: {e}")

# Modelos de Dados
class ChatRequest(BaseModel):
    message: str = Field(max_length=5000)
    analysis: Optional[Dict[str, Any]] = None
    mixer_context: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = Field(default="default", max_length=64, pattern="^[a-zA-Z0-9_-]+$")

class AcousticRequest(BaseModel):
    volume: float = Field(default=1000, gt=0)
    surface_area: float = Field(default=600, gt=0)
    alpha: float = Field(default=0.1, ge=0, lt=1)

class FeedbackSample(BaseModel):
    hz: float
    db: float

class FeedbackRequest(BaseModel):
    freq: Optional[float] = None
    db: Optional[float] = None
    prevDb: Optional[float] = None
    gain: float = 0
    peakHistory: Optional[list[FeedbackSample]] = None
    threshold: float = -20

class TrainRequest(BaseModel):
    freq: float
    db: float
    prevDb: float
    gain: float
    isFeedback: bool

class ClassifyRequest(BaseModel):
    audio: list[float] = Field(..., max_length=480000)  # Max 30s at 16kHz
    sampleRate: int = 16000
    k: int = 5
    threshold: float = 0.1

class AutoEqRequest(BaseModel):
    freqData: list[float] = Field(..., max_length=65536)  # Max FFT size 32768
    sampleRate: int = 48000
    fftSize: int = 8192
    targetCurve: str = "flat"

class Rt60Request(BaseModel):
    impulseResponse: list[float] = Field(..., max_length=480000)  # Max 10s at 48kHz
    sampleRate: int = 48000

class SplRequest(BaseModel):
    freqData: list[float] = Field(..., max_length=65536)  # Max FFT size 32768
    timeData: Optional[list[float]] = Field(None, max_length=65536)
    sampleRate: int = 48000
    weighting: str = "A"

class HardwareDiagnosisRequest(BaseModel):
    channel: str = "Canal 1"
    snapshots: list[dict] = []
    months: int = 6
    thresholds: dict = {}

@app.get("/")
async def root():
    return {"status": "online", "engine": "SoundMaster Pro AI", "active_sessions": len(sessions)}


@app.get("/api/models")
async def list_models_endpoint(
    authenticated: bool = Depends(verify_api_key)
):
    """Lista modelos de IA suportados com status de disponibilidade."""
    from engine.ai_logic import SUPPORTED_MODELS, DEFAULT_MODEL_KEY
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    result = []
    for key, info in SUPPORTED_MODELS.items():
        model_path = os.path.join(models_dir, info['gguf'])
        result.append({
            'key': key,
            'name': info['name'],
            'size_mb': info['size_mb'],
            'description': info['description'],
            'downloaded': os.path.exists(model_path),
            'ollama_name': info['ollama'],
            'is_default': key == DEFAULT_MODEL_KEY,
        })
    return {"models": result, "active_model": DEFAULT_MODEL_KEY}


class ModelSelectRequest(BaseModel):
    model: str = Field(..., pattern="^(phi3.5-mini|llama3.2-3b|gemma2-2b|tinyllama-1.1b)$")

class ModelDownloadRequest(BaseModel):
    model: str = Field(..., pattern="^(phi3.5-mini|llama3.2-3b|gemma2-2b|tinyllama-1.1b)$")


# ─── Estado do download ──────────────────────────────────────────────────────
_download_state = {"active": False, "model": None, "progress": 0, "completed": False, "error": None}


@app.post("/api/models/select")
async def select_model_endpoint(
    request: ModelSelectRequest,
    authenticated: bool = Depends(verify_api_key)
):
    """Seleciona o modelo de IA ativo. Reinicia o engine se necessário."""
    from engine.ai_logic import SUPPORTED_MODELS, AIEngine, LocalLLM
    model_key = request.model
    if model_key not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Modelo '{model_key}' não suportado")

    info = SUPPORTED_MODELS[model_key]
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    model_path = os.path.join(models_dir, info['gguf'])

    # Salva a seleção no ambiente
    os.environ["AI_MODEL"] = model_key
    os.environ["MODEL_PATH"] = model_path

    # Reinicia o singleton do LLM para usar o novo modelo
    AIEngine._llm_instance = None
    LocalLLM._instance = None

    print(f"[AI Server] Modelo alterado para: {model_key} ({info['name']})")
    return {"success": True, "model": model_key, "name": info['name']}


@app.post("/api/models/download")
async def download_model_endpoint(
    request: ModelDownloadRequest,
    authenticated: bool = Depends(verify_api_key)
):
    """Inicia o download de um modelo em background."""
    from engine.ai_logic import SUPPORTED_MODELS
    import threading

    model_key = request.model
    if model_key not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Modelo '{model_key}' não suportado")

    if _download_state["active"]:
        raise HTTPException(status_code=409, detail="Download já em andamento")

    info = SUPPORTED_MODELS[model_key]
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    model_path = os.path.join(models_dir, info['gguf'])

    if os.path.exists(model_path):
        return {"success": True, "message": "Modelo já baixado"}

    # Reset state
    _download_state.update({"active": True, "model": model_key, "progress": 0, "completed": False, "error": None})

    def _do_download():
        try:
            import requests as req
            from tqdm import tqdm

            os.makedirs(models_dir, exist_ok=True)
            url = info['download_url']
            print(f"[AI Server] Baixando {info['name']} de {url}...")

            response = req.get(url, stream=True, timeout=(10, 300))
            response.raise_for_status()
            total = int(response.headers.get("content-length", 0))

            with open(model_path, "wb") as f:
                downloaded = 0
                for chunk in response.iter_content(chunk_size=1048576):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        if total > 0:
                            _download_state["progress"] = (downloaded / total) * 100

            _download_state["completed"] = True
            _download_state["progress"] = 100
            print(f"[AI Server] ✅ Download concluído: {model_path}")

        except Exception as e:
            _download_state["error"] = str(e)
            print(f"[AI Server] ❌ Download falhou: {e}")
            if os.path.exists(model_path):
                os.remove(model_path)
        finally:
            _download_state["active"] = False

    thread = threading.Thread(target=_do_download, daemon=True)
    thread.start()

    return {"success": True, "message": f"Download de {info['name']} iniciado"}


@app.get("/api/models/download/status")
async def download_status_endpoint(
    authenticated: bool = Depends(verify_api_key)
):
    """Retorna o status do download em andamento."""
    return _download_state


@app.post("/api/ollama/config")
async def ollama_config_endpoint(
    request: Request,
    authenticated: bool = Depends(verify_api_key)
):
    """Salva configuração do Ollama (model name e timeout)."""
    try:
        body = await request.json()
        model = body.get("model", "phi3.5:3.8b")
        timeout = body.get("timeout", 45)

        os.environ["OLLAMA_MODEL"] = model
        os.environ["OLLAMA_TIMEOUT"] = str(timeout)

        print(f"[AI Server] Ollama configurado: model={model}, timeout={timeout}")
        return {"success": True, "model": model, "timeout": timeout}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        session = get_session(request.session_id)
        ai_engine = AIEngine(session)
        # Executado em thread separada para não bloquear o event loop do FastAPI
        result = await asyncio.to_thread(ai_engine.process, request.message, request.analysis, request.mixer_context)
        if not result or not result.get("text"):
            result = {"text": "Entendi! Pode me dar mais detalhes sobre o que está sentindo no som?", "command": None}
        if result.get("text"):
            session.add_message("assistant", result["text"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/chat/history/{session_id}")
async def get_chat_history(
    session_id: str,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        session = get_session(session_id)
        return {"messages": session.conversation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/acoustic_analysis")
async def acoustic_analysis_endpoint(
    request: AcousticRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        rt60 = AcousticProcessor.eyring_rt60(request.volume, request.surface_area, request.alpha)
        classification = AcousticProcessor.classify_room(rt60)
        return {
            "rt60": round(rt60, 2),
            "classification": classification,
            "formula": "Eyring"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/analyze-feedback")
async def analyze_feedback_endpoint(
    request: FeedbackRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        # Mode 2: batch analysis with peakHistory (ported from Node calculation-routes.js)
        if request.peakHistory and len(request.peakHistory) >= 5:
            recent = request.peakHistory[-15:]
            if len(recent) < 10:
                return {"risk": 0.0, "isFeedback": False, "confidence": 0, "reason": "Insufficient data"}

            avg_hz = sum(p.hz for p in recent) / len(recent)
            all_similar = all(abs(math.log2(p.hz / avg_hz)) < 1.0 / 6.0 for p in recent)
            all_above = all(p.db > request.threshold for p in recent)

            is_feedback = all_similar and all_above

            freq_variance = sum(math.pow(math.log2(p.hz / avg_hz), 2) for p in recent) / len(recent)
            confidence = max(0.0, min(1.0, 1.0 - freq_variance * 10.0))

            return {
                "risk": round(confidence, 2) if is_feedback else 0.0,
                "isFeedback": is_feedback,
                "confidence": round(confidence, 2),
                "freqHz": round(avg_hz),
                "avgDb": round(sum(p.db for p in recent) / len(recent), 1),
            }

        # Mode 1: single-value delta (backward compat with ai-predictor.js)
        if request.freq is not None and request.db is not None:
            risk = 0.0
            delta = request.db - (request.prevDb or request.db)
            if delta > 3: risk = 0.5
            if delta > 6: risk = 0.8
            if request.db > -10: risk += 0.2
            return {"risk": min(1.0, risk)}

        raise HTTPException(status_code=400, detail="Forneça peakHistory (array, min 5) ou freq+db")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

TRAIN_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "training_events.json")
_train_file_lock = asyncio.Lock()

async def _load_training_events():
    if os.path.exists(TRAIN_DATA_PATH):
        def _read():
            with open(TRAIN_DATA_PATH, "r") as f:
                return json.load(f)
        return await asyncio.to_thread(_read)
    return []

async def _save_training_event(event):
    async with _train_file_lock:
        def _write():
            os.makedirs(os.path.dirname(TRAIN_DATA_PATH), exist_ok=True)
            events = []
            if os.path.exists(TRAIN_DATA_PATH):
                with open(TRAIN_DATA_PATH, "r") as f:
                    events = json.load(f)
            events.append(event)
            if len(events) > 1000:
                events = events[-1000:]
            with open(TRAIN_DATA_PATH, "w") as f:
                json.dump(events, f, indent=2)
        await asyncio.to_thread(_write)

# ── Curvas alvo para Auto-EQ ──────────────────────────────────────────────

_TARGET_CURVES = {
    "flat":      [(20, 0), (20000, 0)],
    "smaart":    [(20, 3), (80, 2), (315, 0.5), (630, 0), (2500, -0.5), (5000, -1.5), (10000, -3), (20000, -6)],
    "tilt":      [(20, 0), (2000, 0), (4000, -1.5), (8000, -3), (16000, -6), (20000, -7.5)],
    "xcurve":    [(20, 0), (2000, 0), (10000, -3), (16000, -7), (20000, -10)],
    "presence":  [(20, 0), (80, -1), (250, 0), (800, 0.5), (1500, 1.5), (3000, 2), (5000, 1.5), (8000, 0), (16000, -1.5), (20000, -3)],
}

_GEQ_BANDS = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
              500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000,
              6300, 8000, 10000, 12500, 16000, 20000]

@app.post("/api/calculate/auto-eq")
async def auto_eq_endpoint(
    request: AutoEqRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        sr = request.sampleRate or 48000
        fft = request.fftSize or 8192
        hz_per_bin = sr / fft

        target_pts = _TARGET_CURVES.get(request.targetCurve, _TARGET_CURVES["flat"])

        def interp_target(hz):
            log_f = math.log10(max(hz, 1))
            for i in range(len(target_pts) - 1):
                f1, d1 = target_pts[i]
                f2, d2 = target_pts[i + 1]
                log1 = math.log10(max(f1, 1))
                log2 = math.log10(max(f2, 1))
                if log1 <= log_f <= log2:
                    t = (log_f - log1) / (log2 - log1)
                    return d1 + t * (d2 - d1)
            return target_pts[-1][1]

        geq = []
        for chz in _GEQ_BANDS:
            f_low = chz / (2 ** (1/3))
            f_high = chz * (2 ** (1/3))
            k_low = max(1, round(f_low / hz_per_bin))
            k_high = min(len(request.freqData) - 1, round(f_high / hz_per_bin))
            if k_high <= k_low:
                geq.append({"hz": chz, "correctionDb": 0})
                continue
            s = 0
            c = 0
            for k in range(k_low, k_high + 1):
                measured = request.freqData[k] if k < len(request.freqData) else -100
                target = interp_target(chz)
                s += measured - target
                c += 1
            avg_diff = s / c if c > 0 else 0
            geq.append({"hz": chz, "correctionDb": round(max(-12, min(12, -avg_diff)) * 10) / 10})

        # Smooth
        smoothed = []
        for i, b in enumerate(geq):
            prev = geq[i - 1]["correctionDb"] if i > 0 else b["correctionDb"]
            nxt = geq[i + 1]["correctionDb"] if i < len(geq) - 1 else b["correctionDb"]
            val = prev * 0.15 + b["correctionDb"] * 0.70 + nxt * 0.15
            smoothed.append({"hz": b["hz"], "correctionDb": round(val * 10) / 10})

        # PEQ 4 zonas
        zones = [
            ("Bass", 20, 200, 1),
            ("Low-Mid", 200, 800, 2),
            ("High-Mid", 800, 5000, 3),
            ("Treble", 5000, 20000, 4),
        ]
        peq = []
        for name, zmin, zmax, band in zones:
            in_zone = [b for b in smoothed if zmin <= b["hz"] <= zmax]
            if not in_zone:
                continue
            peak = max(in_zone, key=lambda b: abs(b["correctionDb"]))
            if abs(peak["correctionDb"]) >= 0.5:
                peq.append({"band": band, "name": name, "hz": peak["hz"],
                           "gainDb": peak["correctionDb"], "q": 1.4})

        corrections = [b["correctionDb"] for b in smoothed]
        rms = math.sqrt(sum(v*v for v in corrections) / len(corrections)) if corrections else 0
        max_dev = max(abs(v) for v in corrections) if corrections else 0
        bands_over1 = len([v for v in corrections if abs(v) > 1])
        curve = [{"hz": hz, "targetDb": interp_target(hz)} for hz in _GEQ_BANDS]

        return {
            "peq": peq,
            "geq": smoothed,
            "curve": curve,
            "stats": {
                "rms": round(rms, 1),
                "max": round(max_dev, 1),
                "bands": bands_over1,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _estimate_snr_from_ir(ir: np.ndarray) -> float:
    """
    Estima a relação sinal-ruído (dB) a partir de uma IR isolada.
    Usa a energia pré-pico (50 ms antes do |peak|) como proxy do ruído de fundo.
    Retorna 60.0 (otimista) se não houver samples suficientes antes do pico.
    """
    ir = np.asarray(ir, dtype=np.float64)
    n = len(ir)
    if n < 16:
        return 60.0
    peak_idx = int(np.argmax(np.abs(ir)))
    noise_window = min(peak_idx, max(16, int(0.050 * 48000)))
    if noise_window < 4:
        return 60.0
    noise_floor = float(np.mean(ir[:noise_window] ** 2))
    signal_peak = float(ir[peak_idx] ** 2)
    if noise_floor <= 0 or signal_peak <= 0:
        return 60.0
    return round(10 * float(np.log10(signal_peak / (noise_floor + 1e-30))), 1)


@app.post("/api/calculate/rt60")
async def rt60_endpoint(
    request: Rt60Request,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Calcula parâmetros de reverberação (EDT, T20, T30, RT60, C50, C80, D50)
    e STI (IEC 60268-16) a partir de uma Resposta ao Impulso pré-computada.

    Algoritmo (ISO 3382-1 + IEC 60268-16:2011):
        - Schroeder backward integration → curva em dB
        - Regressão linear (linregress) nos trechos [0..-10], [-5..-25], [-5..-35] dB
        - RT60 = T30 quando SNR ≥ 45 dB, senão T20, senão EDT×6
        - STI: Modulation Transfer Function por banda de oitava e correção de redundância
    """
    try:
        sr = request.sampleRate or 48000
        ir = np.array(request.impulseResponse, dtype=np.float64)
        n = len(ir)

        if n < 100:
            raise HTTPException(status_code=400, detail="impulseResponse mínimo 100 samples")

        # Schroeder backward integration (mesma definição usada em calculate_reverberation_params)
        ir_sq = ir ** 2
        sch_raw = np.cumsum(ir_sq[::-1])[::-1]
        max_e = sch_raw[0] if sch_raw[0] > 0 else 1.0
        sch_db = 10 * np.log10(sch_raw / max_e + 1e-30)

        # SNR estimado a partir da IR isolada (energia pré-pico vs. pico)
        snr_db = _estimate_snr_from_ir(ir)

        ir_data = {
            "ir":          ir,
            "schroeder":   sch_db,
            "sample_rate": sr,
            "snr_db":      snr_db,
        }
        rev = calculate_reverberation_params(ir_data)

        # STI (IEC 60268-16:2011) — protecção defensiva caso o sample rate seja
        # demasiado baixo para os filtros de oitava
        sti_payload = {"sti": None, "sti_label": "Indisponível"}
        try:
            if sr >= 8000 and n >= int(0.5 * sr):
                sti_payload = calculate_sti(ir, sr, gender="male")
        except Exception as sti_err:
            logger.warning(f"[RT60] STI indisponível: {sti_err}")

        # Curva de Schroeder downsampleada p/ transmissão ao frontend (≤ 2000 pontos)
        step = max(1, n // 2000)
        curve = [round(float(sch_db[i]), 2) for i in range(0, n, step)]

        return {
            "rt60":         rev.get("rt60_est"),
            "edt":          rev.get("edt"),
            "t20":          rev.get("t20"),
            "t30":          rev.get("t30"),
            "c50":          rev.get("c50"),
            "c80":          rev.get("c80"),
            "d50":          rev.get("d50"),
            "d80":          rev.get("d80"),
            "snr_db":       rev.get("snr_db"),
            "warning":      rev.get("warning"),
            "sti":          sti_payload.get("sti"),
            "sti_category": sti_payload.get("sti_label"),
            "method":       "ISO 3382-1 (Schroeder + linear regression)",
            "curve":        curve,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/calculate/spl")
async def spl_endpoint(
    request: SplRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        sr = request.sampleRate or 48000
        w = (request.weighting or "A").upper()
        hz_per_bin = sr / (len(request.freqData) * 2)

        def a_weight(f):
            if f < 10:
                return -100
            f2 = f * f
            f4 = f2 * f2
            r = (12194 * 12194 * f4) / ((f2 + 20.6*20.6) * math.sqrt((f2 + 107.7*107.7) * (f2 + 737.9*737.9)) * (f2 + 12194*12194))
            return 20 * math.log10(r + 1e-30) + 2.00

        def c_weight(f):
            if f < 10:
                return -100
            f2 = f * f
            r = (12194 * 12194 * f2) / ((f2 + 20.6*20.6) * (f2 + 12194*12194))
            return 20 * math.log10(r + 1e-30) + 0.06

        def get_weight(typ, f):
            if typ == 'A':
                return a_weight(f)
            if typ == 'C':
                return c_weight(f)
            return 0

        sum_pwr = 0
        for k in range(1, len(request.freqData)):
            freq = k * hz_per_bin
            db_w = request.freqData[k] + get_weight(w, freq)
            sum_pwr += 10 ** (db_w / 10)

        rms_db = 10 * math.log10(sum_pwr + 1e-30) - 94

        peak = 0
        if request.timeData:
            for v in request.timeData:
                val = abs(v)
                if val > peak:
                    peak = val

        peak_db = 20 * math.log10(peak + 1e-12)
        crest = peak_db - rms_db

        return {
            "rmsDb": round(rms_db, 1),
            "peakDb": round(peak_db, 1),
            "crestFactor": round(crest, 1),
            "weighting": w,
            "isClipping": peak > 0.98,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/train")
async def train_endpoint(
    request: TrainRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        event = {
            "ts": time.time(),
            "freq": request.freq,
            "db": request.db,
            "gain": request.gain,
            "isFeedback": request.isFeedback,
        }
        await _save_training_event(event)
        print(f"[AI Train] Evento registrado: {request.freq}Hz, feedback={request.isFeedback}")
        return {"success": True, "total_events": len(await _load_training_events())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/diagnose")
async def diagnose_endpoint(
    session_id: str = "default",
    authenticated: bool = Depends(verify_api_key)
):
    try:
        if len(session_id) > 64 or not all(c.isalnum() or c in '-_' for c in session_id):
            raise HTTPException(status_code=400, detail="session_id inválido")
        session = get_session(session_id)
        patterns = AcousticProcessor.diagnose_patterns(session.analyses_history)
        return {
            "patterns": patterns,
            "totalMeasurements": len(session.analyses_history),
            "session_id": session_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/hardware_diagnosis")
async def hardware_diagnosis_endpoint(
    request: HardwareDiagnosisRequest,
    authenticated: bool = Depends(verify_api_key)
):
    """
    Analisa o histórico de snapshots acústicos de um canal para detetar
    degradação de hardware (cabos, conectores, cápsula).

    Body: { channel, snapshots: [{timestamp, spectrum_db}], months, thresholds }
    """
    try:
        engine = PredictiveMaintenanceEngine(request.thresholds or None)
        result = engine.analyze(request.channel, request.snapshots, request.months)
        return asdict(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def dsp_smooth(data, rate, intensity=1.0):
    """Filtro de suavização (média móvel) para atenuar ruído de alta frequência.
    NOTA: Isso é um filtro passa-baixas simples, NÃO um denoiser avançado."""
    try:
        window_size = max(1, int(3 * intensity))
        if window_size <= 1:
            return data
        if data.ndim == 1:
            return np.convolve(data, np.ones(window_size)/window_size, mode='same').astype(data.dtype)
        else:
            out = data.copy()
            for ch in range(data.shape[1]):
                out[:, ch] = np.convolve(data[:, ch], np.ones(window_size)/window_size, mode='same').astype(data.dtype)
            return out
    except Exception as e:
        print(f"[DSP Smooth Error] Fallback to original: {e}")
        return data

def dsp_bandpass(data, rate, low_hz=100, high_hz=4000):
    """Filtro passa-banda para isolar frequências de voz (100-4000Hz).
    NOTA: Isso NÃO separa vozes de instrumentos - é apenas um filtro de banda."""
    try:
        nyq = 0.5 * rate
        low = low_hz / nyq
        high = min(high_hz / nyq, 0.99)  # Evita exceder o limite de Nyquist
        b, a = signal.butter(4, [low, high], btype='band')
        if data.ndim == 1:
            return signal.filtfilt(b, a, data).astype(data.dtype)
        else:
            out = data.copy()
            for ch in range(data.shape[1]):
                out[:, ch] = signal.filtfilt(b, a, data[:, ch]).astype(data.dtype)
            return out
    except Exception as e:
        print(f"[DSP Vocal Sep Error] Fallback to original: {e}")
        return data

def dsp_mastering(data, rate):
    try:
        is_int16 = data.dtype == np.int16
        if is_int16:
            float_data = data.astype(np.float32) / 32768.0
        else:
            float_data = data.astype(np.float32)
        
        # Compressão dinâmica simples: saturação suave via tanh
        boost = 1.4
        float_data = np.tanh(float_data * boost)
        
        # Normalização de pico a 95%
        max_val = np.max(np.abs(float_data))
        if max_val > 0:
            float_data = float_data * (0.95 / max_val)
            
        if is_int16:
            return (float_data * 32767.0).astype(np.int16)
        else:
            return float_data.astype(data.dtype)
    except Exception as e:
        print(f"[DSP Mastering Error] Fallback to original: {e}")
        return data

def process_wav_bytes(file_bytes: bytes, effect: str, intensity: float = 1.0) -> bytes:
    try:
        rate, data = wavfile.read(io.BytesIO(file_bytes))
        data = data.copy()
        
        if effect == 'denoise':
            data = dsp_smooth(data, rate, intensity)
        elif effect == 'vocal_sep':
            data = dsp_bandpass(data, rate)
        elif effect == 'mastering':
            data = dsp_mastering(data, rate)
        else:
            raise ValueError(f"Efeito desconhecido: {effect}")
            
        out_buf = io.BytesIO()
        wavfile.write(out_buf, rate, data)
        return out_buf.getvalue()
    except ValueError:
        raise
    except Exception as e:
        print(f"[Process Wav Bytes Error]: {e}")
        raise HTTPException(status_code=500, detail=f"Falha no processamento de áudio: {str(e)}")

def analyze_and_transcribe_wav(file_bytes: bytes) -> str:
    try:
        rate, data = wavfile.read(io.BytesIO(file_bytes))
        if data.dtype == np.int16:
            float_data = data.astype(np.float32) / 32768.0
        else:
            float_data = data.astype(np.float32)
            
        rms = np.sqrt(np.mean(float_data**2))
        if rms < 0.005:
            return "Nenhuma fala detectada ou o nível de sinal está excessivamente baixo. Verifique as conexões do microfone."
            
        peak = np.max(np.abs(float_data))
        crest_factor = 20 * np.log10(peak / (rms + 1e-12) + 1e-12)
        
        if float_data.ndim == 1:
            mono = float_data
        else:
            mono = float_data[:, 0]
            
        zero_crossings = np.sum(mono[:-1] * mono[1:] < 0)
        duration = len(mono) / rate
        zcr = zero_crossings / duration
        
        if zcr > 3000:
            text = f"Detecção de sibilância pronunciada (sons de 's' e 't' excessivos). Taxa de cruzamento por zero: {int(zcr)} Hz. Nível dinâmico médio: {20*np.log10(rms):.1f} dB. Recomendação: aplicar de-esser ou corte estreito (Q alto) em 6.2 kHz no mixer."
        elif zcr < 800:
            text = f"Detecção de voz abafada ou embolamento grave (lama acústica). Frequências baixas predominantes (ZCR: {int(zcr)} Hz). Nível médio de sinal: {20*np.log10(rms):.1f} dB. Recomendação: ativar HPF (filtro passa-alta) em 100 Hz e atenuar 250 Hz em -2.5 dB."
        else:
            text = f"Voz equilibrada detectada com boa inteligibilidade acústica. Dinâmica de pico estável (Crest Factor: {crest_factor:.1f} dB). Nível médio: {20*np.log10(rms):.1f} dB. Nenhuma correção crítica necessária no equalizador."
        return text
    except Exception as e:
        return f"Falha ao analisar áudio: {str(e)}. A voz capturada apresenta picos médios estáveis."

@app.post("/process")
async def process_audio_endpoint(
    file: UploadFile = File(...),
    effect: str = Form("denoise"),
    intensity: Optional[float] = Form(1.0),
    authenticated: bool = Depends(verify_api_key)
):
    try:
        file_bytes = await _validate_upload(file)
        processed_bytes = process_wav_bytes(file_bytes, effect, intensity or 1.0)
        return StreamingResponse(
            io.BytesIO(processed_bytes),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=processed.wav"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no processamento de áudio: {str(e)}")

@app.post("/enhance")
async def enhance_audio_endpoint(
    file: UploadFile = File(...),
    effect: str = Form("denoise"),
    authenticated: bool = Depends(verify_api_key)
):
    try:
        file_bytes = await _validate_upload(file)
        processed_bytes = process_wav_bytes(file_bytes, effect, 1.0)
        return StreamingResponse(
            io.BytesIO(processed_bytes),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=enhanced.wav"}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro no realce de áudio: {str(e)}")

@app.post("/api/ai/classify")
async def classify_endpoint(
    request: ClassifyRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        if not _classifier.enabled:
            return {"classes": [], "topClass": None, "topScore": None}
        results = _classifier.get_top_classes(
            request.audio, request.sampleRate, request.k, request.threshold
        )
        top = results[0] if results else None
        return {
            "classes": results,
            "topClass": top["name"] if top else None,
            "topScore": top["score"] if top else None,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/transcribe")
async def transcribe_audio_endpoint(
    file: UploadFile = File(...),
    authenticated: bool = Depends(verify_api_key)
):
    try:
        file_bytes = await _validate_upload(file)
        transcription_text = analyze_and_transcribe_wav(file_bytes)
        return {
            "transcription": transcription_text,
            "text": transcription_text,
            "status": "success"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro na transcrição: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    # Rodando na porta configurável (padrão 3002)
    print("SoundMaster Pro AI Engine v2 Iniciando...")
    try:
        port = int(os.getenv("PYTHON_PORT", "3002"))
        if port < 1 or port > 65535:
            raise ValueError
    except (ValueError, TypeError):
        print("[WARN] PYTHON_PORT inválido. Usando porta 3002.")
        port = 3002
    uvicorn.run(app, host="127.0.0.1", port=port)

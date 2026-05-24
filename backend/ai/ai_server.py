import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import time
import asyncio
from dotenv import load_dotenv
from contextlib import asynccontextmanager

# Importações Modulares
from engine.ai_logic import AIEngine, SessionContext
from acoustics.processor import AcousticProcessor
from predictive_maintenance import PredictiveMaintenanceEngine

_maintenance_engine = PredictiveMaintenanceEngine()

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Inicia limpeza de sessões
    asyncio.create_task(cleanup_sessions_task())
    yield
    # Shutdown logic here if needed

app = FastAPI(title="SoundMaster Pro AI Engine", lifespan=lifespan)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    os.getenv("FRONTEND_URL", "http://localhost:3000")
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    max_age=3600,
)

from fastapi.security import APIKeyHeader
from fastapi import Depends, status

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

async def verify_api_key(api_key: str = Depends(api_key_header)):
    """Verifica se API Key é válida"""
    valid_key = os.getenv("AI_API_KEY")

    if not valid_key:
        if os.getenv("NODE_ENV") == "production":
              raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Servidor não configurado (AI_API_KEY faltando)"
            )
        return True

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API Key ausente"
        )

    if api_key != valid_key:
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
    message: str = Field(max_length=2000)  # ✅ T12: Limita tamanho da mensagem (Original #13)
    analysis: Optional[Dict[str, Any]] = None
    mixer_context: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = "default"

class AcousticRequest(BaseModel):
    volume: float = 1000
    surface_area: float = 600
    alpha: float = 0.1

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

class AutoEqRequest(BaseModel):
    freqData: list[float]
    sampleRate: int = 48000
    fftSize: int = 8192
    targetCurve: str = "flat"

class Rt60Request(BaseModel):
    impulseResponse: list[float]
    sampleRate: int = 48000

class SplRequest(BaseModel):
    freqData: list[float]
    timeData: Optional[list[float]] = None
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

@app.post("/chat")
async def chat_endpoint(
    request: ChatRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        session = get_session(request.session_id)
        ai_engine = AIEngine(session)
        result = ai_engine.process(request.message, request.analysis, request.mixer_context)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/acoustic_analysis")
async def acoustic_analysis_endpoint(
    request: AcousticRequest,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        if request.surface_area <= 0:
            raise HTTPException(status_code=400, detail="surface_area deve ser maior que zero")
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
        import math

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

def _load_training_events():
    if os.path.exists(TRAIN_DATA_PATH):
        with open(TRAIN_DATA_PATH, "r") as f:
            return json.load(f)
    return []

def _save_training_event(event):
    os.makedirs(os.path.dirname(TRAIN_DATA_PATH), exist_ok=True)
    events = _load_training_events()
    events.append(event)
    if len(events) > 1000:
        events = events[-1000:]
    with open(TRAIN_DATA_PATH, "w") as f:
        json.dump(events, f, indent=2)

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
        import math
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


@app.post("/api/calculate/rt60")
async def rt60_endpoint(
    request: Rt60Request,
    authenticated: bool = Depends(verify_api_key)
):
    try:
        sr = request.sampleRate or 48000
        ir = np.array(request.impulseResponse, dtype=np.float64)
        n = len(ir)

        if n < 100:
            raise HTTPException(status_code=400, detail="impulseResponse mínimo 100 samples")

        energy = ir ** 2
        sch_raw = np.cumsum(energy[::-1])[::-1]
        max_e = sch_raw[0] if sch_raw[0] > 0 else 1
        sch_db = 10 * np.log10(sch_raw / max_e + 1e-30)

        peak_idx = 0
        for i in range(n):
            if sch_db[i] > -5:
                peak_idx = i
                break

        rt60_idx = n - 1
        for i in range(peak_idx, n):
            if sch_db[i] <= -60:
                rt60_idx = i
                break
        rt60 = (rt60_idx - peak_idx) / sr

        def find_decay(start_db, end_db):
            si = ei = -1
            for i in range(peak_idx, n):
                if si == -1 and sch_db[i] <= start_db:
                    si = i
                if si != -1 and ei == -1 and sch_db[i] <= end_db:
                    ei = i
                    break
            if si == -1 or ei == -1:
                return None
            span = start_db - end_db
            return (ei - si) / sr * (60 / span)

        edt = find_decay(0, -10)
        t20 = find_decay(-5, -25)
        t30 = find_decay(-5, -35)

        def calc_clarity(early, late):
            if late <= 0 and early <= 0:
                return 0
            if late <= 0:
                return 100
            if early <= 0:
                return -100
            ratio = early / late
            return 10 * math.log10(max(ratio, 1e-30))

        c50ms = round(0.050 * sr)
        e50 = energy[:c50ms].sum() if c50ms < n else energy.sum()
        l50 = energy[c50ms:].sum() if c50ms < n else 0
        c50 = calc_clarity(e50, l50)

        c80ms = round(0.080 * sr)
        e80 = energy[:c80ms].sum() if c80ms < n else energy.sum()
        l80 = energy[c80ms:].sum() if c80ms < n else 0
        c80 = calc_clarity(e80, l80)

        d50 = (e50 / (energy.sum() + 1e-30)) * 100

        sti = max(0, min(1, 1 - rt60 / 4))
        sti_cat = 'Excelente' if sti >= 0.75 else 'Bom' if sti >= 0.6 else 'Razoável' if sti >= 0.45 else 'Ruim'

        step = max(1, n // 2000)
        curve = [round(float(sch_db[i]), 2) for i in range(0, n, step)]

        return {
            "rt60": round(rt60, 3),
            "edt": round(edt, 3) if edt is not None else None,
            "t20": round(t20, 3) if t20 is not None else None,
            "t30": round(t30, 3) if t30 is not None else None,
            "c50": round(c50, 1),
            "c80": round(c80, 1),
            "d50": round(d50, 1),
            "sti": round(sti, 2),
            "sti_category": sti_cat,
            "curve": curve,
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
        import math
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


TRAIN_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "training_events.json")

def _load_training_events():
    if os.path.exists(TRAIN_DATA_PATH):
        with open(TRAIN_DATA_PATH, "r") as f:
            return json.load(f)
    return []

def _save_training_event(event):
    os.makedirs(os.path.dirname(TRAIN_DATA_PATH), exist_ok=True)
    events = _load_training_events()
    events.append(event)
    if len(events) > 1000:
        events = events[-1000:]
    with open(TRAIN_DATA_PATH, "w") as f:
        json.dump(events, f, indent=2)

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
        _save_training_event(event)
        print(f"[AI Train] Evento registrado: {request.freq}Hz, feedback={request.isFeedback}")
        return {"success": True, "total_events": len(_load_training_events())}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/diagnose")
async def diagnose_endpoint(
    session_id: str = "default",
    authenticated: bool = Depends(verify_api_key)
):
    try:
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
        # dataclass -> dict via asdict
        from dataclasses import asdict
        return asdict(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Rodando na porta configurável (padrão 3002)
    print("SoundMaster Pro AI Engine v2 Iniciando...")
    port = int(os.getenv("PYTHON_PORT", "3002"))
    uvicorn.run(app, host="127.0.0.1", port=port)

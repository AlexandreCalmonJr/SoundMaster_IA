# -*- coding: utf-8 -*-
import re
import unicodedata
import time
import os
import hashlib
from collections import deque

CHURCH_PROFILES = {
    'janelas_vidro': {
        'problematic_ranges': [(2000, 4000)],
        'suggestion': 'Corte suave em 2.5-3.2kHz no Master para reduzir brilho excessivo do vidro.'
    },
    'teto_alto': {
        'problematic_ranges': [(80, 160)],
        'suggestion': 'HPF agressivo em 120Hz. Subgraves se acumulam neste ambiente com pé direito alto.'
    },
    'paredes_paralelas': {
        'problematic_ranges': [(400, 800)],
        'suggestion': 'Difusores nas laterais recomendados. Corte em 500Hz no Master para limpar o "embolado".'
    }
}

RT60_STANDARDS = {
    'spoken_word': {'ideal': (0.8, 1.2), 'acceptable': (1.2, 1.5)},
    'live_music': {'ideal': (1.2, 1.6), 'acceptable': (1.6, 2.0)}
}

PROFILE_NAMES = {
    'janelas_vidro': 'Janelas/Vidro',
    'teto_alto': 'Teto Alto',
    'paredes_paralelas': 'Paredes Paralelas'
}

# ─── Catálogo de modelos suportados ──────────────────────────────────────────
SUPPORTED_MODELS = {
    'phi3.5-mini': {
        'name': 'Phi-3.5 Mini 3.8B',
        'ollama': 'phi3.5:3.8b',
        'gguf': 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
        'download_url': 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
        'size_mb': 2300,
        'n_ctx': 4096,
        'description': 'Melhor qualidade geral. Bom PT-BR. Recomendado para PCs com 8GB+ RAM.',
    },
    'llama3.2-3b': {
        'name': 'Llama 3.2 3B',
        'ollama': 'llama3.2:3b',
        'gguf': 'llama-3.2-3b-instruct.Q4_K_M.gguf',
        'download_url': 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/llama-3.2-3b-instruct.Q4_K_M.gguf',
        'size_mb': 2000,
        'n_ctx': 4096,
        'description': 'Upgrade natural do 1B. Ótimo equilíbrio entre velocidade e qualidade.',
    },
    'gemma2-2b': {
        'name': 'Gemma 2 2B',
        'ollama': 'gemma2:2b',
        'gguf': 'gemma-2-2b-it.Q4_K_M.gguf',
        'download_url': 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf',
        'size_mb': 1600,
        'n_ctx': 4096,
        'description': 'Leve e rápido. Bom para PT-BR. Ideal para PCs com 4-8GB RAM.',
    },
    'tinyllama-1.1b': {
        'name': 'TinyLlama 1.1B',
        'ollama': 'llama3.2:1b',
        'gguf': 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'download_url': 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'size_mb': 670,
        'n_ctx': 2048,
        'description': 'Mais leve. Respostas básicas. Para PCs muito limitados.',
    },
}

# Modelo padrão (Phi-3.5 Mini é o melhor custo-benefício)
DEFAULT_MODEL_KEY = os.getenv("AI_MODEL", "phi3.5-mini")

class SessionContext:
    def __init__(self):
        self.history = []
        self.conversation = deque(maxlen=50)
        self.room_profile = 'janelas_vidro'
        self.analyses_history = deque(maxlen=50)
        self.last_activity = time.time()
    
    def touch(self):
        self.last_activity = time.time()
    
    def add_analysis(self, analysis):
        self.touch()
        self.analyses_history.append(analysis)

    def add_message(self, role, content):
        self.touch()
        self.conversation.append({
            "role": role,
            "content": content,
            "ts": time.time()
        })

def build_system_prompt(context_data=None):
    """Constrói o system prompt unificado para todos os backends LLM."""
    profile_label = PROFILE_NAMES.get(
        context_data.get('room_profile', ''),
        context_data.get('room_profile', 'desconhecido') if context_data else 'desconhecido'
    )
    system = (
        "Você é o SoundMaster IA — assistente amigável de som para igrejas. "
        "Fale de forma simples, calorosa e acolhedora, como um colega ajudando outro. "
        "EVITE jargão técnico. Use palavras do dia a dia. "
        "Exemplos: 'som abafado' ao invés de 'excesso de energia subsônica'; "
        "'chiado' ao invés de 'sibilância'; 'o som está estranho' ao invés de 'anomalia espectral'. "
        "Cumprimente com 'Bom dia!', 'Olá!', 'Tudo bem?'. "
        "Seja paciente e encorajador. Seu objetivo é ajudar voluntários de igreja a terem um som melhor. "
        f"Perfil ativo da sala: {profile_label}. "
        "Sugira ações práticas de forma simples."
    )
    if context_data:
        master_eq_info = context_data.get('master_eq', 'nenhum corte ativo')
        system += (
            f" Contexto Atual: RT60={context_data.get('rt60')}s, "
            f"Pico={context_data.get('peakHz')}Hz, RMS={context_data.get('rms')}dB. "
            f"EQ Master atual: {master_eq_info}."
        )
    return system


class OllamaLLM:
    """Gerenciador de modelo via Ollama (download automático + API REST)."""
    _instance = None
    _instance_lock = None
    _OLLAMA_HOST = "http://127.0.0.1:11434"
    _OLLAMA_URL = "https://ollama.com/download/OllamaSetup.exe"

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            import threading
            if cls._instance_lock is None:
                cls._instance_lock = threading.Lock()
            with cls._instance_lock:
                if cls._instance is None:
                    instance = super().__new__(cls)
                    instance._initialized = False
                    cls._instance = instance
        return cls._instance

    def __init__(self, model_name=None):
        if self._initialized:
            return
        self._initialized = True
        import threading
        self._lock = threading.Lock()
        self.model_name = model_name or os.getenv("OLLAMA_MODEL", self._resolve_model_ollama())
        self._timeout = int(os.getenv("OLLAMA_TIMEOUT", "45"))
        self.enabled = False
        self._proc = None

        if self._ensure_ollama():
            self.enabled = True
            print(f"[Ollama] Modelo pronto: {self.model_name}")
        else:
            print("[Ollama] Não disponível. Usando fallback.")

    @staticmethod
    def _resolve_model_ollama():
        """Resolve o nome do modelo Ollama com base na configuração AI_MODEL."""
        model_key = DEFAULT_MODEL_KEY
        if model_key in SUPPORTED_MODELS:
            return SUPPORTED_MODELS[model_key]['ollama']
        return "llama3.2:1b"

    def _find_ollama(self):
        import shutil, os
        # Caminhos comuns no Windows
        candidates = [
            shutil.which("ollama"),
            os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\Ollama\ollama.exe"),
            r"C:\Program Files\Ollama\ollama.exe",
        ]
        for c in candidates:
            if c and os.path.exists(c):
                return c
        return None

    def _download_ollama(self):
        import urllib.request, os, sys
        installer = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "OllamaSetup.exe")
        if os.path.exists(installer):
            print("[Ollama] Instalador já baixado. Instalando...")
        else:
            print(f"[Ollama] Baixando Ollama de {self._OLLAMA_URL}...")
            try:
                urllib.request.urlretrieve(self._OLLAMA_URL, installer)
                print("[Ollama] Download concluído.")
            except Exception as e:
                print(f"[Ollama] Falha no download: {e}")
                return False
        try:
            import subprocess
            subprocess.run([installer, "/S"], check=True, timeout=120)
            print("[Ollama] Instalação concluída.")
            return True
        except Exception as e:
            print(f"[Ollama] Falha na instalação: {e}")
            return False

    def _start_ollama(self):
        import subprocess, time
        ollama_path = self._find_ollama()
        if not ollama_path:
            return False
        try:
            self._proc = subprocess.Popen(
                [ollama_path, "serve"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            time.sleep(3)
            return True
        except Exception as e:
            print(f"[Ollama] Falha ao iniciar servidor: {e}")
            return False

    def _pull_model(self):
        import subprocess, time
        ollama_path = self._find_ollama()
        if not ollama_path:
            return False
        try:
            print(f"[Ollama] Baixando modelo {self.model_name} (primeira vez pode levar minutos)...")
            result = subprocess.run(
                [ollama_path, "pull", self.model_name],
                capture_output=True, text=True, timeout=300
            )
            if result.returncode == 0:
                print(f"[Ollama] Modelo {self.model_name} pronto.")
                return True
            print(f"[Ollama] Falha ao baixar modelo: {result.stderr}")
            return False
        except subprocess.TimeoutExpired:
            print("[Ollama] Timeout ao baixar modelo.")
            return False
        except Exception as e:
            print(f"[Ollama] Erro ao baixar modelo: {e}")
            return False

    def _ollama_online(self):
        import urllib.request, json
        try:
            req = urllib.request.Request(f"{self._OLLAMA_HOST}/api/tags", method="GET")
            resp = urllib.request.urlopen(req, timeout=5)
            return resp.status == 200
        except Exception:
            return False

    def _ensure_ollama(self):
        """Garante que Ollama está disponível. Falha rápido se não estiver."""
        import time
        deadline = time.time() + 8
        if self._ollama_online():
            return self._has_model()
        ollama_path = self._find_ollama()
        if not ollama_path:
            return False
        if not self._ollama_online():
            print("[Ollama] Iniciando servidor...")
            if not self._start_ollama():
                return False
            while time.time() < deadline:
                if self._ollama_online():
                    break
                time.sleep(1)
        if not self._has_model():
            if time.time() < deadline:
                return self._pull_model()
            return False
        return True

    def _has_model(self):
        import urllib.request, json
        try:
            req = urllib.request.Request(f"{self._OLLAMA_HOST}/api/tags")
            resp = urllib.request.urlopen(req, timeout=5)
            data = json.loads(resp.read())
            for m in data.get("models", []):
                if self.model_name in m.get("name", ""):
                    return True
            return False
        except Exception:
            return False

    def query(self, prompt, context_data=None, conversation=None):
        if not self.enabled:
            return None
        system = build_system_prompt(context_data)
        messages = [{"role": "system", "content": system}]
        if conversation:
            for msg in list(conversation)[-10:]:
                role = "user" if msg["role"] == "user" else "assistant"
                messages.append({"role": role, "content": msg["content"]})
        messages.append({"role": "user", "content": prompt})
        import json, urllib.request
        payload = json.dumps({
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            "options": {"num_predict": 512}
        }).encode()
        try:
            with self._lock:
                req = urllib.request.Request(
                    f"{self._OLLAMA_HOST}/api/chat",
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                resp = urllib.request.urlopen(req, timeout=self._timeout)
                data = json.loads(resp.read())
            return data.get("message", {}).get("content", "").strip()
        except urllib.request.HTTPError as e:
            print(f"[Ollama] HTTP {e.code}: {e.read().decode()[:200]}")
            return None
        except Exception as e:
            print(f"[Ollama] Erro na consulta: {e}")
            return None

import threading

class LlamaLLM:
    """Gerenciador de modelo local via llama-cpp-python (modelo GGUF)."""
    _lock = threading.Lock()

    def __init__(self, model_path, n_ctx=2048, n_threads=4):
        from llama_cpp import Llama
        with LlamaLLM._lock:
            self.model = Llama(model_path=model_path, n_ctx=n_ctx, n_threads=n_threads, verbose=False)
        self.enabled = True

    def query(self, prompt, context_data=None, conversation=None):
        if not self.enabled:
            return None
        system = build_system_prompt(context_data)
        messages = [{"role": "system", "content": system}]
        if conversation:
            for msg in list(conversation)[-10:]:
                role = "user" if msg["role"] == "user" else "assistant"
                messages.append({"role": role, "content": msg["content"]})
        messages.append({"role": "user", "content": prompt})

        with LlamaLLM._lock:
            try:
                response = self.model.create_chat_completion(
                    messages=messages,
                    max_tokens=512,
                    temperature=0.7
                )
                return response["choices"][0]["message"]["content"].strip()
            except Exception as e:
                print(f"[Llama] Erro na consulta: {e}")
                return None

    def reload_if_needed(self):
        return self.enabled

class LocalLLM:
    """Gerenciador de Modelo Local — tenta Ollama primeiro, depois llama-cpp."""
    _instance = None
    _llama_crash_cache = None

    def __init__(self, model_path=None):
        self.llm = None
        self.enabled = False
        import threading
        self._lock = threading.Lock()

        # Tenta Ollama primeiro
        print("[AI Engine] Tentando Ollama...")
        ollama = OllamaLLM()
        if ollama.enabled:
            self.llm = ollama
            self.enabled = True
            print("[AI Engine] Usando Ollama como backend LLM.")
            return

        # Fallback: llama-cpp-python com modelo configurável
        if not model_path:
            model_path = self._resolve_model_path()
        if not os.path.isabs(model_path):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            potential_path = os.path.join(os.path.dirname(script_dir), model_path)
            if os.path.exists(potential_path):
                model_path = potential_path
        self.model_path = model_path

        if os.path.exists(model_path) and self._test_llama_crash_cached():
            model_info = self._get_model_info(model_path)
            n_ctx = model_info.get('n_ctx', 2048) if model_info else 2048
            try:
                self.llm = LlamaLLM(model_path=model_path, n_ctx=n_ctx, n_threads=4)
                self.enabled = True
                print(f"[AI Engine] Modelo llama-cpp carregado: {model_path}")
                return
            except ImportError:
                print("[AI Engine] llama-cpp-python não instalado.")
            except Exception as e:
                print(f"[AI Engine] Falha ao carregar modelo llama-cpp: {e}")
                self.llm = None
                import gc; gc.collect()

        if not self.enabled:
            print("[AI Engine] Nenhum LLM local disponível. Usando regras + simulação.")

    @staticmethod
    def _resolve_model_path():
        """Resolve o caminho do modelo GGUF com base na configuração AI_MODEL."""
        model_key = DEFAULT_MODEL_KEY
        env_path = os.getenv("MODEL_PATH")
        if env_path:
            return env_path
        if model_key in SUPPORTED_MODELS:
            return f"models/{SUPPORTED_MODELS[model_key]['gguf']}"
        return "models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"

    @staticmethod
    def _get_model_info(model_path):
        """Retorna informações do modelo baseado no nome do arquivo."""
        filename = os.path.basename(model_path).lower()
        for key, info in SUPPORTED_MODELS.items():
            if info['gguf'].lower() in filename:
                return info
        return None

    @classmethod
    def _test_llama_crash_cached(cls):
        """Testa compatibilidade do llama_cpp com cache (executa 1x por processo)."""
        if cls._llama_crash_cache is not None:
            return cls._llama_crash_cache
        cls._llama_crash_cache = cls._test_llama_crash()
        return cls._llama_crash_cache

    @staticmethod
    def _test_llama_crash():
        import subprocess, sys
        test_code = (
            "import sys, os\n"
            "try:\n"
            "    from llama_cpp import Llama\n"
            "    print('OK')\n"
            "except Exception as e:\n"
            "    print('ERR:' + str(e))"
        )
        try:
            script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            result = subprocess.run(
                [sys.executable, '-c', test_code],
                capture_output=True, text=True, timeout=15, cwd=script_dir
            )
            if result.returncode != 0:
                print(f"[AI Engine] llama_cpp incompatível com esta CPU (código {result.returncode}).")
                return False
            output = result.stdout.strip()
            if output.startswith('ERR:'):
                print(f"[AI Engine] Teste llama_cpp: {output}")
                return False
            if output == 'OK':
                return True
            return False
        except subprocess.TimeoutExpired:
            print("[AI Engine] Teste llama_cpp: timeout")
            return False

    def reload_if_needed(self):
        return self.enabled

    def query(self, prompt, context_data=None, conversation=None):
        if not self.enabled or not self.llm:
            return None
        return self.llm.query(prompt, context_data=context_data, conversation=conversation)

    @staticmethod
    def list_models():
        """Retorna lista de modelos suportados com status de disponibilidade."""
        result = []
        for key, info in SUPPORTED_MODELS.items():
            model_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                'models', info['gguf']
            )
            result.append({
                'key': key,
                'name': info['name'],
                'size_mb': info['size_mb'],
                'description': info['description'],
                'downloaded': os.path.exists(model_path),
                'ollama_name': info['ollama'],
            })
        return result

class AIEngine:
    _llm_instance = None

    def __init__(self, session):
        self.session = session
        if AIEngine._llm_instance is None:
            # Singleton para evitar carregar o modelo várias vezes na memória
            AIEngine._llm_instance = LocalLLM()
        self.llm = AIEngine._llm_instance

    def command(self, action, desc, **kwargs):
        payload = {"action": action, "desc": desc}
        payload.update(kwargs)
        return payload

    def _safe_float(self, value, default=0.0):
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _normalize_rt60_bands(self, analysis):
        if not analysis:
            return {}
        raw = analysis.get('rt60_multiband') or analysis.get('rt60_s') or {}
        if not isinstance(raw, dict):
            return {}
        normalized = {}
        key_map = {
            '1k': '1000',
            '4k': '4000'
        }
        for key, value in raw.items():
            canonical = key_map.get(str(key), str(key))
            normalized[canonical] = self._safe_float(value, 0.0)
        return normalized

    def _get_existing_eq_bands(self, mixer_state, target="master", channel_num=None):
        if not mixer_state or not isinstance(mixer_state, dict):
            return []
        full_state = mixer_state.get('full_state')
        if not full_state or not isinstance(full_state, dict):
            return []
        if target == "master":
            master = full_state.get('master', {})
            if not isinstance(master, dict):
                return []
            eq_data = master.get('eq')
            return list(eq_data.values()) if isinstance(eq_data, dict) else []
        elif target == "channel" and channel_num:
            inputs = full_state.get('inputs', [])
            if not isinstance(inputs, list) or not (0 <= channel_num - 1 < len(inputs)):
                return []
            ch = inputs[channel_num - 1]
            if not isinstance(ch, dict):
                return []
            eq_data = ch.get('eq')
            return list(eq_data.values()) if isinstance(eq_data, dict) else []
        return []

    def _has_eq_near(self, mixer_state, hz, target="master", channel_num=None, tolerance=0.15):
        bands = self._get_existing_eq_bands(mixer_state, target, channel_num)
        for band in bands:
            existing_hz = self._safe_float(band.get('hz', 0))
            if existing_hz > 0 and abs(existing_hz - hz) / max(hz, 1) < tolerance:
                gain = self._safe_float(band.get('gain', 0))
                return f"{existing_hz:.0f}Hz ({gain:+.0f}dB)"
        return None

    def _eq_summary_str(self, mixer_state, target="master", channel_num=None):
        bands = self._get_existing_eq_bands(mixer_state, target, channel_num)
        if not bands:
            return "nenhum corte aplicado"
        parts = []
        for band in bands:
            hz = self._safe_float(band.get('hz', 0))
            gain = self._safe_float(band.get('gain', 0))
            if hz > 0:
                parts.append(f"{hz:.0f}Hz ({gain:+.0f}dB)")
        return ", ".join(parts) if parts else "nenhum corte aplicado"

    def _normalize_spectrum(self, analysis):
        if not analysis:
            return {}
        raw = analysis.get('spectrum_db') or analysis.get('bands') or {}
        if not isinstance(raw, dict):
            return {}
        return {str(key): self._safe_float(value, -100.0) for key, value in raw.items()}

    def _get_channel_name(self, mixer_state, channel_num):
        if not mixer_state or not isinstance(mixer_state, dict):
            return None
        full_state = mixer_state.get('full_state')
        if not full_state or not isinstance(full_state, dict):
            ch_state = mixer_state.get('channel')
            if ch_state and isinstance(ch_state, dict):
                return ch_state.get('name')
            return None
        inputs = full_state.get('inputs', [])
        if not isinstance(inputs, list) or not (1 <= channel_num <= len(inputs)):
            return None
        ch = inputs[channel_num - 1]
        if not isinstance(ch, dict):
            return None
        return ch.get('name')

    def extract_channel(self, text):
        channel_match = re.search(r'(?:canal|ch)\s*(\d{1,2})', text)
        if not channel_match:
            return None
        channel_num = int(channel_match.group(1))
        if channel_num < 1 or channel_num > 24:
            print(f"[AI Engine] Canal {channel_num} fora do range 1-24, ajustando.")
            channel_num = max(1, min(24, channel_num))
        return channel_num

    def _smart_fallback(self, text, analysis, mixer_state):
        """Fallback inteligente quando nenhum LLM está disponível. Fornece respostas úteis."""
        palavras = [p for p in text.split() if len(p) > 3]
        encontradas = [p for p in palavras if re.search(
            r'(voz|som|canal|microfone|palco|sala|abafad|estranh|baixo|alto|grave|agudo|'
            r'apito|eco|retorno|monitor|auditoria|ajud[oa]|problema|volume|fader|mute|'
            r'compressor|equalizador|hpf|gate|delay|reverb|preset|cena|feedback|igreja|'
            r'som|audio|mix|mixer|mesa|caixa|alto-falante|parlante)', p
        )]

        # Respostas contextuais por categoria de problema
        categorias = {
            'grave': {
                'keywords': r'(grave|pesad[oa]|gross[oa]|embolad[oa]|bumbo|sub|tremend[oa])',
                'text': 'Parece que tem muito grave acumulado! Isso pode deixar o som "embolado". '
                        'Sugestão: tente um HPF em 80-100Hz no canal de voz e um corte suave em 125Hz no Master.',
                'command': self.command("eq_cut", "Limpeza de Graves", target="master", hz=125, gain=-3, q=1.0),
            },
            'agudo': {
                'keywords': r'(agud[oa]|fin[oa]|sibil[âa]ncia|brilho|chiado)',
                'text': 'Os agudos podem estar incomodando! Sugestão: suavize em 6kHz com Q de 1.5 no Master.',
                'command': self.command("eq_cut", "Suavizar Agudos", target="master", hz=6000, gain=-2, q=1.5),
            },
            'apito': {
                'keywords': r'(apito|apitando|microfonia|zumbido|realimenta)',
                'text': 'Microfonia detectada! Vou aplicar um notch na frequência problemática.',
                'command': self.command("eq_cut", "Corte de Apito", target="master", hz=1000, gain=-8, q=3.0),
            },
            'eco': {
                'keywords': r'(eco|reverberando|espaco|vazio|acustica)',
                'text': 'A sala parece ter muito eco. Uma opção é cortar um pouco em 800Hz no Master para melhorar a inteligibilidade.',
                'command': self.command("eq_cut", "Melhorar Inteligibilidade", target="master", hz=800, gain=-2, q=1.0),
            },
            'voz': {
                'keywords': r'(voz|pregador|pastor|prega[cç][aã]o|fala|microfone)',
                'text': 'Vou ajudar com a voz! Sugestão: ative o HPF em 100Hz e aplique um corte suave em 250Hz para limpar.',
                'command': self.command("run_clean_sound_preset", "Voz Clara", channel=1),
            },
            'alto': {
                'keywords': r'(alto demais|estourando|muito alto|ta doendo|forte)',
                'text': 'O volume está alto demais! Vou abaixar o Master em 3dB para proteger as caixas.',
                'command': self.command("volume_down", "Abaixar volume geral", target="master", val=3),
            },
            'baixo': {
                'keywords': r'(baixo|fraco|pouco som|quase nao ouve|fraco)',
                'text': 'O som está baixo? Verifique se algum canal está mutado ou com o fader no mínimo.',
                'command': None,
            },
            'mute': {
                'keywords': r'(mutado|mute|sem som|silencio)',
                'text': 'Parece que tem canal mutado! Verifique os mutes na mesa.',
                'command': None,
            },
        }

        # Verificar cada categoria
        for cat_key, cat in categorias.items():
            if re.search(cat['keywords'], text):
                return {"text": cat['text'], "command": cat['command']}

        # Se tem palavras-chave mas nenhuma categoria específica
        if encontradas:
            dica = f"Entendi! Você falou sobre: {', '.join(encontradas[:3])}. "
            dica += "Infelizmente o modelo de IA local não está disponível para analisar isso em detalhes. "
            dica += "Tente descrever o problema (ex: 'som abafado', 'apito chato', 'eco muito forte')."
            return {"text": dica, "command": None, "context": {"keywords": encontradas}}

        # Mensagem genérica amigável
        return {
            "text": "Olá! 😊 Me diga o que você está sentindo no som: "
                    "está abafado, estranho, com apito, muito alto, muito baixo? "
                    "Quanto mais detalhes, melhor posso ajudar!",
            "command": None
        }

    def generate_technical_report(self, analysis=None):
        from acoustics.processor import AcousticProcessor
        
        # Pega dados mais recentes: parâmetro > sessão > vazio
        analysis = analysis or (self.session.analyses_history[-1] if self.session.analyses_history else {})
        
        # Se não tem dados reais, retorna None para pedir medição
        has_real_data = bool(
            analysis.get('rt60') or 
            analysis.get('rt60_multiband') or 
            analysis.get('rt60_measured') or
            analysis.get('rms') or
            analysis.get('peakHz')
        )
        if not has_real_data:
            return None
        
        # Usar RT60 medido se disponível, senão estimar do multiband
        rt60_avg = self._safe_float(analysis.get('rt60_measured'), 0)
        if rt60_avg <= 0:
            rt60_mb = analysis.get('rt60_multiband', {})
            if rt60_mb and isinstance(rt60_mb, dict):
                vals = [self._safe_float(v, 0) for v in rt60_mb.values() if self._safe_float(v, 0) > 0]
                rt60_avg = sum(vals) / len(vals) if vals else 0
        if rt60_avg <= 0:
            rt60_avg = self._safe_float(analysis.get('rt60', 0), 0)
        if rt60_avg <= 0:
            return None
        
        rt60_info = AcousticProcessor.classify_room(rt60_avg)
        
        rms_noise = self._safe_float(analysis.get('rms', -45), -45)
        snr_calc = max(5, -18 - rms_noise)
        sti = AcousticProcessor.estimate_sti(rt60_avg, snr=snr_calc)
        
        room_vol = self._safe_float(analysis.get('room_vol', analysis.get('volume', 900)), 900)
        dc = AcousticProcessor.calculate_critical_distance(room_vol, rt60_avg)
        
        patterns = AcousticProcessor.diagnose_patterns(self.session.analyses_history)
        
        peak_hz = analysis.get('peakHz', '--')
        peak_db = analysis.get('peakDb', '--')
        
        report = f"""
# 📊 RELATÓRIO TÉCNICO: AUDITORIA ACÚSTICA AI

## 1. Análise de Reverberação (RT60)
- **Tempo Médio (RT60):** {rt60_avg:.2f}s
- **Status:** {rt60_info['status']}
- **Diagnóstico:** {rt60_info['desc']}
- **Pontuação:** {rt60_info['rating']}/5

## 2. Qualidade de Transmissão (STI)
- **STI Estimado:** {sti:.2f}
- **Avaliação:** {"Excelente" if sti > 0.75 else "Bom" if sti > 0.6 else "Razoável" if sti > 0.45 else "Pobre"}

## 3. Cobertura e Distância Crítica
- **Distância Crítica (Dc):** {dc:.1f} metros

## 4. Espectro Detectado
- **Frequência Pico:** {peak_hz}Hz
- **Nível do Pico:** {peak_db}dB
- **RMS:** {rms_noise:.1f}dB

## 5. Ressonâncias e Feedback
{chr(10).join([f"- **{p['hz']}Hz:** {p['suggestion']} (Confiança: {int(p['confidence']*100)}%)" for p in patterns]) if patterns else "Nenhuma ressonância crítica recorrente detectada."}

## 6. Perfil da Sala
- **Perfil Ativo:** {PROFILE_NAMES.get(self.session.room_profile, self.session.room_profile)}
"""
        return report

    def process(self, text, analysis=None, mixer_state=None):
        text = unicodedata.normalize('NFC', text.strip()).lower()
        
        # Se veio analysis do frontend (com dados reais de áudio), usa ela
        if analysis and isinstance(analysis, dict) and analysis.get('schema_version') == '1.1':
            self.session.add_analysis(analysis)
        
        # Fallback para histórico se não veio dados novos
        if not analysis or not isinstance(analysis, dict):
            analysis = self.session.analyses_history[-1] if self.session.analyses_history else {}
        
        self.session.add_message("user", text)

        classification = None
        if mixer_state and isinstance(mixer_state, dict):
            classification = mixer_state.get('classification')

        # Saudação inicial
        if re.search(r'^(bom dia|boa tarde|boa noite|olá|ola|oi|oie|fala|e aí|e ai|tudo bem|hello|hey)', text):
            return {"text": "Bom dia! 😊 Como posso ajudar com o som hoje? Pode me falar o que está achando — se está abafado, estranho, baixo demais... estou aqui pra ajudar!", "command": None}

        if re.search(r'(obrigado|valeu|brigado|thanks|muito obrigado)', text):
            return {"text": "Por nada! Fico feliz em ajudar. Qualquer coisa é só chamar! 😊", "command": None}

        # 0.1. Auditoria do Mixer
        if re.search(r'(auditar|auditoria|verificar mesa|status da mesa|analise da mesa|diagnostico da mesa|audit)', text):
            alerts = []
            suggested_cmds = []
            
            full_state = mixer_state.get('full_state') if mixer_state else None
            inputs = full_state.get('inputs', []) if full_state else []
            all_vus = mixer_state.get('all_vus') if mixer_state else None
            
            # A) Verificar Master Mutado
            master_state = mixer_state.get('master') if mixer_state else None
            if not master_state and full_state:
                master_state = full_state.get('master')
            
            if master_state and master_state.get('mute') == 1:
                alerts.append("- **Master sem som:** O volume geral da mesa esta mutado! Nada vai sair para as caixas de som.")
                suggested_cmds.append(self.command("master_mute", "Tirar mute do Master", enabled=False))
            
            # B) Verificar Master Clipando
            if all_vus and 'master' in all_vus:
                master_vu = self._safe_float(all_vus.get('master'), 0.0)
                if master_vu > 0.98:
                    alerts.append(f"- **Som distorcendo:** O volume geral esta muito alto ({int(master_vu*100)}%). O som pode estar estourando.")
                    suggested_cmds.append(self.command("volume_down", "Abaixar Master em 3dB", target="master", val=3))
            
            # C) Canais Mutados com VU ativo
            for idx, ch in enumerate(inputs):
                ch_idx = idx + 1
                mute = ch.get('mute', 0)
                ch_name = ch.get('name', f"Canal {ch_idx}")
                
                vu_val = 0.0
                if all_vus and 'channels' in all_vus:
                    vu_val = self._safe_float(all_vus['channels'].get(str(ch_idx)) or all_vus['channels'].get(ch_idx), 0.0)
                
                if mute == 1 and vu_val > 0.05:
                    alerts.append(f"- **Mudo mas com som:** O canal {ch_idx} ({ch_name}) esta mutado, mas tem gente falando/tocando nele ({int(vu_val*100)}% de sinal).")
                    suggested_cmds.append(self.command("channel_mute", f"Tirar mute do {ch_name}", channel=ch_idx, enabled=False))
            
            # D) Vozes sem HPF
            for idx, ch in enumerate(inputs):
                ch_idx = idx + 1
                ch_name = ch.get('name', '')
                ch_name_lower = ch_name.lower()
                hpf = self._safe_float(ch.get('hpf', 0), 0.0)
                
                if any(k in ch_name_lower for k in ['voz', 'past', 'mic', 'preg', 'minist', 'cant', 'lead', 'coral']):
                    if hpf <= 50:
                        alerts.append(f"- **Voz sem filtro de graves:** O canal {ch_idx} ({ch_name}) nao tem o filtro de graves ligado. Pode estar pegando muito som grosso.")
                        suggested_cmds.append(self.command("apply_channel_hpf", f"Ligar filtro de graves no {ch_name}", channel=ch_idx, hz=100))
            
            # E) Sem Compressao em Canais Criticos (Canais de voz ativos sem compressor)
            for idx, ch in enumerate(inputs):
                ch_idx = idx + 1
                ch_name = ch.get('name', '')
                ch_name_lower = ch_name.lower()
                comp = ch.get('comp', 0)
                
                vu_val = 0.0
                if all_vus and 'channels' in all_vus:
                    vu_val = self._safe_float(all_vus['channels'].get(str(ch_idx)) or all_vus['channels'].get(ch_idx), 0.0)
                
                if any(k in ch_name_lower for k in ['voz', 'past', 'mic', 'preg']):
                    if comp == 0 and vu_val > 0.1:
                        alerts.append(f"- **Voz sem proteção de volume:** Canal {ch_idx} ({ch_name}) ta com som mas sem compressor ligado. Pode dar picos de volume repentinos.")
            
            if not alerts:
                report_md = """
# Auditoria da Mesa

Tudo certo! Nao encontrei nenhum problema. :)
"""
                return {
                    "text": "Fiz uma varredura rápida na mesa e está tudo beleza! Nenhum canal mutado sem querer, nada estranho. Pode ficar tranquilo! 😊",
                    "report": report_md,
                    "command": None
                }
            else:
                report_md = f"""
# Auditoria de Mesa Soundcraft

Identifiquei os seguintes pontos de atencao na mesa de som:

{chr(10).join(alerts)}

Deseja aplicar a correcao recomendada?
"""
                # Retorna o comando mais crítico (Master Mutado > Master Clipando > HPF > Mute > Compressor)
                priority = {"master_mute": 0, "volume_down": 1, "apply_channel_hpf": 2, "channel_mute": 3}
                suggested_cmds.sort(key=lambda c: priority.get(c["action"], 99))
                return {
                    "text": "Auditoria concluida. Identifiquei alguns pontos de atencao na mesa de som. Veja o relatorio no chat.",
                    "report": report_md,
                    "command": suggested_cmds[0] if suggested_cmds else None
                }

        # 0.2. Analise Dinamica do Fader e Ganho
        channel = self.extract_channel(text)
        is_increase = any(k in text for k in ['aumentar', 'subir', 'mais volume', 'mais som', 'dar ganho'])
        if is_increase:
            ch_state = mixer_state.get('channel') if mixer_state else None
            if ch_state:
                mute = ch_state.get('mute', 0)
                level = self._safe_float(ch_state.get('level', 0.0), 0.0)
                ch_name = ch_state.get('name', f"Canal {channel}")
                
                if mute == 1:
                    return {
                        "text": f"O canal {channel} ({ch_name}) esta mutado. Recomendo desmutar antes de ajustar o volume.",
                        "command": self.command("channel_mute", f"Desmutar {ch_name}", channel=channel, enabled=False)
                    }
                
                if level > 0.85:
                    return {
                        "text": f"O fader do canal {channel} ({ch_name}) ja esta muito alto ({int(level*100)}%). Recomendo aumentar o ganho de entrada (preamp) do canal ou atenuar outros instrumentos para dar destaque.",
                        "command": None
                    }

        # 0. Verificacao de Estado de Hardware (Context Aware)
        hw_note = ""
        if mixer_state:
            ch_state = mixer_state.get('channel')
            if ch_state:
                if ch_state.get('mute') == 1:
                    hw_note = "Observei que o canal selecionado esta mutado na mesa."
                elif ch_state.get('level', 0) < 0.1:
                    hw_note = "O fader deste canal esta quase no minimo."
            
            master_state = mixer_state.get('master')
            if master_state and master_state.get('mute') == 1:
                hw_note += " (O MASTER também esta mutado!)"

        # 1. Gatilhos de Saudação Inteligente (Context Aware)
        greetings = [r'\boi\b', r'\bolá\b', r'\btudo bem\b', r'\bom dia\b', r'\boa tarde\b', r'\boa noite\b']
        if any(re.search(g, text) for g in greetings):
            rt60 = analysis.get('rt60', '--')
            peak = analysis.get('peakHz', '--')
            rms = analysis.get('rms', '--')
            profile_label = PROFILE_NAMES.get(self.session.room_profile, self.session.room_profile)
            
            status_msg = f"Olá! SoundMaster operacional. {hw_note}"
            if rt60 != '--':
                status_msg += f"Sala com RT60 de {rt60}s, nível médio {rms}dB. Perfil ativo: {profile_label}. "
            else:
                status_msg += "Aguardando primeira medição para análise completa. "
            
            if len(self.session.analyses_history) >= 3:
                recent = self.session.analyses_history[-3:]
                rt60s = [a.get('rt60', 0) for a in recent if a.get('rt60')]
                if rt60s:
                    avg_rt60 = sum(rt60s) / len(rt60s)
                    status_msg += f"Média RT60 das últimas 3 medições: {avg_rt60:.2f}s. "
            
            if classification and 'topClass' in classification:
                detected = classification['topClass']
                score = classification.get('topScore', 0)
                if score > 0.3:
                    status_msg += f"Som detectado: {detected} ({score:.0%} confiança). "
            
            status_msg += "Como posso ajudar no seu mix hoje?"
            
            return {
                "text": status_msg,
                "command": None,
                "context": {"rt60": rt60, "peak": peak, "room_profile": self.session.room_profile, "classification": classification}
            }

        # 1. Gatilho de Relatório Completo
        if re.search(r'(relat[oó]rio|resumo|estat[ií]stica|cen[aá]rio)', text):
            report_md = self.generate_technical_report(analysis)
            if report_md is None:
                return {
                    "text": "Não encontrei dados acústicos armazenados no momento. Sem problemas! Estou ativando o analisador de som ambiente para captar o áudio da sala e gerar seu relatório em instantes. Por favor, aguarde alguns segundos... 🎙️",
                    "command": self.command("start_live_analysis", "Iniciar análise do som ambiente", channel=channel)
                }
            return {
                "text": "Claro! Vou preparar um resumo do som da sua sala pra você. Só um instante...",
                "report": report_md,
                "command": self.command("log", "Relatório Gerado: Relatório técnico enviado ao usuário")
            }

        # Se o usuário não citar canal, tentamos deduzir pelo contexto ou agir no Master
        channel = self.extract_channel(text)
        has_specific_channel = bool(re.search(r'(canal|ch|ch\s*\d)', text))
        
        analysis = analysis or {}
        rt60_response = None
        fft_response = None
        if 'peakHz' in analysis and analysis.get('peakHz', 0) > 0:
            peak = int(analysis.get('peakHz'))
            is_pink = analysis.get('isPinkNoise', False)
            
            profile = CHURCH_PROFILES.get(self.session.room_profile, {})
            room_suggestion = ""
            for min_hz, max_hz in profile.get('problematic_ranges', []):
                if min_hz <= peak <= max_hz:
                    room_suggestion = profile.get('suggestion', '')

            if is_pink or "rosa" in text:
                fft_response = {
                    "text": f"Estou ouvindo o som geral da sala. Tem uma frequência em {peak}Hz que está aparecendo mais. {room_suggestion or 'Vou dar uma ajustada fina ali.'}",
                    "command": self.command("eq_cut", f"Ajuste Geral {peak}Hz", target="master", hz=peak, gain=-3, q=1.0)
                }
            elif "microfonia" in text or "apito" in text:
                 fft_response = {
                    "text": f"Puxa, detectei aquele apinho chato em {peak}Hz! Vou aplicar um corte ali pra resolver.",
                    "command": self.command("eq_cut", f"Notch Global {peak}Hz", target="master", hz=peak, gain=-8, q=5.0, band=4)
                }
            elif not has_specific_channel:
                fft_response = {
                    "text": f"Olha só, reparei que tem uma frequência em {peak}Hz que está acumulando no som. {room_suggestion or 'Vou dar uma limpada lá.'}",
                    "command": self.command("eq_cut", f"Limpeza Sala {peak}Hz", target="master", hz=peak, gain=-2, q=1.5)
                }

        # 1.5 Processamento de Schema v1.1 (Recomendado)
        if analysis and analysis.get('schema_version') == '1.1':
            spec = self._normalize_spectrum(analysis)
            rt60 = self._normalize_rt60_bands(analysis)
            
            # Analise de Perfil por Reverb (RT60 real em segundos)
            if rt60:
                detected_profile = None
                r125 = self._safe_float(rt60.get('125', 0), 0)
                r1k = self._safe_float(rt60.get('1000', 0), 0)
                r4k = self._safe_float(rt60.get('4000', 0), 0)
                
                if r125 > 2.0:
                    return {
                        "text": f"O som grave está demorando muito pra sumir na sala ({r125} segundos). Isso deixa o som 'embolado'. Vou dar um ajuste no grave do equalizador geral pra melhorar.",
                        "command": self.command("eq_cut", "Corte RT60 Grave 125Hz", target="master", hz=125, gain=-4, q=1.0, band=1)
                    }
                
                if r125 > 1.8 and r125 > r1k * 1.5:
                    detected_profile = 'teto_alto'
                elif self._safe_float(rt60.get('500', 0), 0) > 1.5 and self._safe_float(rt60.get('500', 0), 0) > r4k * 1.3:
                    detected_profile = 'paredes_paralelas'
                elif r4k > 1.2:
                    detected_profile = 'janelas_vidro'

                if detected_profile and detected_profile != self.session.room_profile:
                    self.session.room_profile = detected_profile
                    return {
                        "text": f"Ah, percebi! Pela forma como o som se comporta, sua sala parece ser do tipo 'perfil de {PROFILE_NAMES[detected_profile]}'. Já ajustei minhas sugestões pra esse tipo de ambiente.",
                        "command": self.command("set_room_profile", f"Perfil: {detected_profile}", profile=detected_profile)
                    }

            # Análise de EQ por Spectrum (dB)
            if spec:
                s125 = self._safe_float(spec.get('125', -100), -100)
                s1k = self._safe_float(spec.get('1000', -100), -100)
                if s125 > s1k + 10:
                    return {
                        "text": "Estou sentindo que tem muito som grosso, grave demais. Isso pode estar 'embolando' o som. Vou sugerir um ajuste pra limpar isso.",
                        "command": self.command("eq_cut", "Limpeza 125Hz", target="master", hz=125, gain=-3, q=1.0)
                    }
        
        # 1.6 Legado: Análise de RT60 Multibanda (Removido Mismatch)
        # Mantido apenas como fallback básico se não for v1.1
        elif analysis and 'rt60_multiband' in analysis:
            bands = self._normalize_rt60_bands(analysis)
            
            detected_profile = None
            if bands.get('125', 0) > 1.8 and bands.get('125', 0) > bands.get('1000', 0) * 1.5:
                detected_profile = 'teto_alto'
            elif bands.get('500', 0) > 1.5 and bands.get('500', 0) > bands.get('4000', 0) * 1.3:
                detected_profile = 'paredes_paralelas'
            elif bands.get('4000', 0) > 1.2:
                detected_profile = 'janelas_vidro'

            if detected_profile and detected_profile != self.session.room_profile:
                rt60_response = {
                    "text": f"Pelo som, acho que sua sala se parece com um ambiente do tipo '{PROFILE_NAMES[detected_profile]}'. Já ajustei minhas dicas pra isso!",
                    "command": self.command("set_room_profile", f"Mudar perfil para {detected_profile}", profile=detected_profile)
                }
                self.session.room_profile = detected_profile
                return rt60_response

            if bands.get('125', 0) > 2.0:
                rt60_response = {
                    "text": f"O som grave tá demorando muito pra sumir na sala ({bands['125']}s). Isso deixa o som 'sujo'. Vou sugerir um corte no equalizador geral.",
                    "command": self.command("eq_cut", "Corte RT60 Grave 125Hz", target="master", hz=125, gain=-4, q=1.0, band=1)
                }
            else:
                avg_mid = (bands.get('500', 0) + bands.get('1000', 0)) / 2
                if avg_mid > 1.5:
                    rt60_response = {
                        "text": f"O som está 'ecoando' mais que o normal na sala ({avg_mid:.1f}s). As palavras podem ficar meio embaralhadas. Vou dar uma ajustada.",
                        "command": self.command("eq_cut", "Melhorar Inteligibilidade", target="master", hz=800, gain=-3, q=1.2)
                    }

        if rt60_response is not None: return rt60_response
        if fft_response: return fft_response

        # 2. Respostas por Texto
        if re.search(r'(voz|pregador|pregação|pastor|pregar|fala)', text):
            ch_name = self._get_channel_name(mixer_state, channel)
            target = f"'{ch_name}' (canal {channel})" if ch_name else f"canal {channel}"
            if not has_specific_channel:
                target = f"'{ch_name}'" if ch_name else "canal de voz principal"
            return {
                "text": f"Vou dar uma ajustada no {target} pra voz ficar mais clara e presente!",
                "command": self.command("run_clean_sound_preset", f"Voz {target}", channel=channel)
            }
        
        if re.search(r'(instrumentos|banda|musical|louvor|ministério|ministerio)', text):
            return {
                "text": "Vou ouvir a banda e dar uma equilibrada geral pro som ficar bonito!",
                "command": self.command("eq_cut", "Espaço Banda", target="master", hz=400, gain=-2, q=0.8)
            }

        if re.search(r'(delay|atraso|distancia|metros|distância)', text):
            dist_match = re.search(r'(\d+(?:[.,]\d+)?)\s*(?:m|metro)', text)
            if dist_match:
                meters = float(dist_match.group(1).replace(',', '.'))
                ms = round(meters * 2.915, 1)
                return {
                    "text": f"Pra {meters} metros de distância, o delay ideal é de {ms}ms no retorno. Vou aplicar!",
                    "command": self.command("set_delay", f"Delay {meters}m", aux=9, ms=ms)
                }

        if re.search(r'(retorno|monitor|auxiliar|volta|ouvir no palco)', text):
            aux_match = re.search(r'(?:aux|monitor|auxiliar|retorno)\s*(\d{1,2})', text)
            aux_ch = int(aux_match.group(1)) if aux_match else 1
            if "mais" in text or "aumentar" in text:
                return {"text": f"Beleza! Vou aumentar o canal {channel} no retorno {aux_ch}.", "command": self.command("set_aux_level", "Aumentar Aux", channel=channel, aux=aux_ch, level=0.8)}
            if "mudo" in text or "mutar" in text or "tira" in text:
                return {"text": f"Ok, vou tirar o canal {channel} do retorno {aux_ch}.", "command": self.command("set_aux_level", "Mute Aux", channel=channel, aux=aux_ch, level=0)}

        # Entender linguagem do dia a dia (não técnica)
        if re.search(r'(abafad[oa]|embolad[oa]|suj[oa]|estranh[oa]|estourando|ruim|horr[ií]vel|piorou|n[aã]o.*legal|est[áa].*estranho)', text):
            eq_exists = self._has_eq_near(mixer_state, 400, "master")
            if eq_exists:
                alt_hz = 600 if self._has_eq_near(mixer_state, 600, "master") else 300
                alt_exists = self._has_eq_near(mixer_state, alt_hz, "master")
                return {
                    "text": f"Poxa, que pena que o som não tá legal! 😕 Já tem um ajuste em {eq_exists}. Vou sugerir uma limpeza em {alt_hz}Hz pra não acumular cortes na mesma frequência." if not alt_exists else f"Poxa, que pena que o som não tá legal! 😕 Já tem cortes em várias frequências. Pode ser um problema de acústica da sala mesmo.",
                    "command": self.command("eq_cut", f"Limpeza Alternativa {alt_hz}Hz", target="master", hz=alt_hz, gain=-2, q=1.0) if not alt_exists else self.command("log", "Múltiplos EQs já existentes, ação ignorada")
                }
            return {
                "text": "Poxa, que pena que o som não tá legal! 😕 Pode ser que tenha algum acúmulo de frequência. Vou dar uma olhada no equalizador e sugerir uma limpeza.",
                "command": self.command("eq_cut", "Limpeza Geral", target="master", hz=400, gain=-2, q=1.0)
            }
        if re.search(r'(baixo|frac[oa]|pouco som|quase nao ouve|nao ta saindo)', text):
            return {
                "text": "Vou dar uma verificada! Pode ser que algum canal esteja com volume baixo ou mute ligado sem querer. Deixa comigo!",
                "command": self.command("log", "Verificação de volume solicitada")
            }
        if re.search(r'(alto demais|estourando|muito alto|ta doendo)', text):
            return {
                "text": "Nossa, vou baixar um pouco então! Melhor prevenir do que estourar as caixas de som e incomodar a galera. 😅",
                "command": self.command("volume_down", "Abaixar volume geral", target="master", val=3)
            }
        if re.search(r'(apito|apitando|microfonia|chiado|zumbido|assovio|guincho|realimenta)', text):
            apito_hz = 1000
            eq_exists = self._has_eq_near(mixer_state, apito_hz, "master")
            if eq_exists:
                return {
                    "text": f"Ah, esse apito chato! 😬 Mas já tem um corte em {eq_exists}. Vou procurar outra frequência ou aumentar o corte atual pra resolver de vez.",
                    "command": self.command("eq_cut", "Reforço Corte Apito", target="master", hz=apito_hz, gain=-8, q=3.0)
                }
            return {
                "text": "Ah, esse apito chato! 😬 Vou procurar a frequência e dar um corte pra resolver. Pode ficar tranquilo!",
                "command": self.command("eq_cut", "Corte de Apito", target="master", hz=1000, gain=-5, q=3.0)
            }
        if re.search(r'(eco|reverberando|soando|espaco|vazio|acustica)', text):
            return {
                "text": "Parece que a sala está muito 'viva', com muito eco. Infelizmente não posso mudar a construção da sala, mas posso ajudar com ajustes no equalizador pra melhorar!",
                "command": self.command("eq_cut", "Melhorar acústica", target="master", hz=800, gain=-2, q=1.0)
            }
        if re.search(r'(gross[oa]|pesad[oa]|grave demais|bumbo|sub|tremend[oa])', text):
            grave_hz = 125
            eq_exists = self._has_eq_near(mixer_state, grave_hz, "master")
            if eq_exists:
                alt_hz = 250 if not self._has_eq_near(mixer_state, 250, "master") else 80
                return {
                    "text": f"Já tem um ajuste em {eq_exists}. Vou tentar limpar em {alt_hz}Hz pra complementar sem exagerar nos graves.",
                    "command": self.command("eq_cut", f"Limpeza Grave {alt_hz}Hz", target="master", hz=alt_hz, gain=-2, q=1.0)
                }
            return {
                "text": "Tem muito grave acumulado, né? Vou limpar as frequências graves pra não ficar 'embolado'. O som vai ficar mais limpo!",
                "command": self.command("eq_cut", "Limpeza de Graves", target="master", hz=125, gain=-3, q=1.0)
            }
        if re.search(r'(fin[oa]|agud[oa]|fino demais|sibil[âa]ncia|brilho)', text):
            agudo_hz = 6000
            eq_exists = self._has_eq_near(mixer_state, agudo_hz, "master")
            if eq_exists:
                alt_hz = 4000
                return {
                    "text": f"Já tem um ajuste em {eq_exists}. Vou tentar suavizar em {alt_hz}Hz que também ajuda nos agudos sem criar cortes repetidos.",
                    "command": self.command("eq_cut", f"Suavizar Agudos {alt_hz}Hz", target="master", hz=alt_hz, gain=-2, q=1.5)
                }
            return {
                "text": "Os agudos estão incomodando? Vou suavizar as frequências mais altas pra ficar mais confortável.",
                "command": self.command("eq_cut", "Suavizar Agudos", target="master", hz=6000, gain=-2, q=1.5)
            }
        if re.search(r'(clar[oa]|entender|intelig[ií]vel|entendo|entender as palavras)', text):
            ch_name = self._get_channel_name(mixer_state, channel)
            target = f"'{ch_name}' (canal {channel})" if ch_name else f"canal {channel}"
            return {
                "text": f"A clareza da voz é super importante! Vou dar uma ajustada nas frequências do {target} pra ficar mais nítido. 😊",
                "command": self.command("run_clean_sound_preset", f"Melhorar clareza {target}", channel=channel)
            }

        # 2.5. Presets e Cenas
        if re.search(r'(salvar preset|salvar cena|guardar config|salvar config)', text):
            name_match = re.search(r'(?:como|nome|chamar)\s*["\']?([^"\'.,!?]+)', text)
            preset_name = re.sub(r'[^\w\s\-]', '', name_match.group(1).strip())[:50] if name_match else f"Preset {time.strftime('%d/%m %H:%M', time.gmtime())}"
            return {
                "text": f"Beleza! Vou salvar o estado atual da mesa como '{preset_name}' pra você. 😊",
                "command": self.command("save_preset", f"Salvar preset: {preset_name}", name=preset_name)
            }
        if re.search(r'(carregar preset|carregar cena|aplicar preset|restaurar preset)', text):
            return {
                "text": "Claro! Vou listar os presets salvos pra você escolher qual quer carregar.",
                "command": self.command("list_presets", "Listar presets salvos")
            }
        if re.search(r'(criar cena|nova cena|capture scene)', text):
            scene_name_match = re.search(r'(?:como|nome|chamar)\s*["\']?([^"\'.,!?]+)', text)
            scene_name = re.sub(r'[^\w\s\-]', '', scene_name_match.group(1).strip())[:50] if scene_name_match else f"Cena {time.strftime('%d/%m %H:%M', time.gmtime())}"
            return {
                "text": f"Vou criar uma nova cena '{scene_name}' com o estado atual da mesa! 🎯",
                "command": self.command("save_scene", f"Criar cena: {scene_name}", name=scene_name)
            }

        # 3. Fallback: IA Local (Modelo Leve)
        if self.llm:
            self.llm.reload_if_needed()
        if self.llm and self.llm.enabled:
            print(f"[AI Engine] Usando modelo local para: {text}")
            ctx = {
                "rt60": self._safe_float(analysis.get('rt60', 1.2), 1.2),
                "peakHz": self._safe_float(analysis.get('peakHz', 0), 0),
                "rms": self._safe_float(analysis.get('rms', -45), -45),
                "room_profile": self.session.room_profile,
                "master_eq": self._eq_summary_str(mixer_state, "master"),
            }
            if classification:
                ctx["classification"] = classification
            llm_response = self.llm.query(text, context_data=ctx, conversation=list(self.session.conversation))
            if llm_response:
                return {"text": llm_response, "command": None, "source": "local_llm"}

        # 4. Fallback inteligente sem LLM — respostas úteis baseadas em contexto
        return self._smart_fallback(text, analysis, mixer_state)

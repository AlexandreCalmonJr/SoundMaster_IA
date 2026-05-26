import re
import time
import os

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

class SessionContext:
    def __init__(self):
        self.history = []
        self.room_profile = 'janelas_vidro'
        self.analyses_history = []
        self.last_activity = time.time()
    
    def touch(self):
        self.last_activity = time.time()
    
    def add_analysis(self, analysis):
        self.touch()
        self.analyses_history.append(analysis)
        if len(self.analyses_history) > 50:
            self.analyses_history.pop(0)

class LocalLLM:
    """Gerenciador de Modelo Leve Local (TinyLlama/Gemma via Llama-cpp)"""
    _instance = None
    
    def __init__(self, model_path=None):
        # Caminho configurável via env var MODEL_PATH, fallback hardcoded
        if not model_path:
            model_path = os.getenv("MODEL_PATH", "models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf")
        # Resolve caminho relativo ao script para robustez
        if not os.path.isabs(model_path):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            # ai_logic.py está em engine/, models está em ../models/
            potential_path = os.path.join(os.path.dirname(script_dir), model_path)
            if os.path.exists(potential_path):
                model_path = potential_path

        self.model_path = model_path
        self.llm = None
        self.enabled = False
        import threading
        self._lock = threading.Lock()
        
        if os.path.exists(model_path):
            try:
                # pyrefly: ignore [missing-import]
                from llama_cpp import Llama
                self.llm = Llama(model_path=model_path, n_ctx=512, n_threads=4, verbose=False)
                self.enabled = True
                print(f"[AI Engine] Modelo Local carregado: {model_path}")
                print("[AI Engine] READY")
            except ImportError:
                print("[AI Engine] llama-cpp-python não instalado. Chat IA offline.")
                print("[AI Engine] Para ativar: pip install llama-cpp-python")
                print("[AI Engine] Nota: no Windows, instale primeiro: https://github.com/abetlen/llama-cpp-python#installation")
            except Exception as e:
                print(f"[AI Engine] Falha ao carregar modelo: {e}")

    def reload_if_needed(self):
        if self.enabled:
            return True
        if not os.path.exists(self.model_path):
            return False
        try:
            from llama_cpp import Llama
            self.llm = Llama(model_path=self.model_path, n_ctx=512, n_threads=4, verbose=False)
            self.enabled = True
            print(f"[AI Engine] Modelo carregado após download: {self.model_path}")
            return True
        except Exception as e:
            print(f"[AI Engine] Falha ao carregar modelo após download: {e}")
            return False

    def query(self, prompt, context_data=None):
        if not self.enabled:
            return None
        if not self.llm:
            return None

        profile_names = {'janelas_vidro': 'Janelas/Vidro', 'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas'}
        system_prompt = (
            "Você é o SoundMaster IA, engenheiro de som especialista em igrejas e auditórios. "
            "Seja conciso, técnico e direto ao ponto. "
            "Use termos técnicos em português (ganho, equalização, reverberação, microfonia, retorno). "
            f"Perfil ativo da sala: {profile_names.get(context_data.get('room_profile'), context_data.get('room_profile', 'desconhecido')) if context_data else 'desconhecido'}. "
            "Sugira ações práticas no mixer digital quando aplicável."
        )
        if context_data:
            system_prompt += f" Contexto Atual: RT60={context_data.get('rt60')}s, Pico={context_data.get('peakHz')}Hz, RMS={context_data.get('rms')}dB."

        full_prompt = f"<|system|>\n{system_prompt}</s>\n<|user|>\n{prompt}</s>\n<|assistant|>\n"
        try:
            with self._lock:
                output = self.llm(full_prompt, max_tokens=128, stop=["</s>"], echo=False)
            return output['choices'][0]['text'].strip()
        except Exception as e:
            print(f"[AI Engine] Erro no query LLM: {e}")
            return None

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

    def _normalize_spectrum(self, analysis):
        if not analysis:
            return {}
        raw = analysis.get('spectrum_db') or analysis.get('bands') or {}
        if not isinstance(raw, dict):
            return {}
        return {str(key): self._safe_float(value, -100.0) for key, value in raw.items()}

    def extract_channel(self, text):
        channel_match = re.search(r'(?:canal|ch)\s*(\d{1,2})', text)
        if not channel_match:
            return 1
        channel_num = int(channel_match.group(1))
        if channel_num < 1 or channel_num > 24:
            print(f"[AI Engine] Canal {channel_num} fora do range 1-24, ajustando.")
            channel_num = max(1, min(24, channel_num))
        return channel_num

    def generate_technical_report(self, analysis=None):
        from acoustics.processor import AcousticProcessor
        
        analysis = analysis or (self.session.analyses_history[-1] if self.session.analyses_history else {})
        rt60_avg = self._safe_float(analysis.get('rt60', 1.2), 1.2)
        rt60_info = AcousticProcessor.classify_room(rt60_avg)
        
        # Calibração de SNR baseada em RMS (se disponível)
        # Assumimos nível de fala alvo de -18dBFS
        rms_noise = self._safe_float(analysis.get('rms', -45), -45) # Nível médio de ruído de fundo
        snr_calc = max(5, -18 - rms_noise) # SNR = Sinal - Ruído
        sti = AcousticProcessor.estimate_sti(rt60_avg, snr=snr_calc)
        
        room_vol = self._safe_float(analysis.get('room_vol', analysis.get('volume', 900)), 900)
        dc = AcousticProcessor.calculate_critical_distance(room_vol, rt60_avg)
        
        patterns = AcousticProcessor.diagnose_patterns(self.session.analyses_history)
        
        report = f"""
# 📊 RELATÓRIO TÉCNICO: AUDITORIA ACÚSTICA AI

## 1. Análise de Reverberação (RT60)
- **Tempo Médio (RT60):** {rt60_avg}s
- **Status:** {rt60_info['status']}
- **Diagnóstico:** {rt60_info['desc']}
- **Pontuação de Inteligibilidade:** {rt60_info['rating']}/5

## 2. Qualidade de Transmissão (STI)
- **STI Estimado:** {sti}
- **Avaliação:** {"Excelente" if sti > 0.75 else "Bom" if sti > 0.6 else "Razoável" if sti > 0.45 else "Pobre"}
- **Impacto:** O índice STI de {sti} indica que a mensagem falada é {"clara e fácil de entender" if sti > 0.6 else "difícil de compreender em longas distâncias"}.

## 3. Cobertura e Distância Crítica
- **Distância Crítica (Dc):** {dc} metros
- **Recomendação:** Ouvintes além de {dc}m do PA ouvirão mais som reverberado (eco) do que som direto. Considere caixas de reforço (delay) se o ambiente for maior.

## 4. Ressonâncias e Feedback
{chr(10).join([f"- **{p['hz']}Hz:** {p['suggestion']} (Confiança: {int(p['confidence']*100)}%)" for p in patterns]) if patterns else "Nenhuma ressonância crítica recorrente detectada até o momento."}

## 5. Sugestão de Configuração Master
- **Perfil Ativo:** {self.session.room_profile}
- **Ação Recomendada:** Aplicar curva de equalização corretiva baseada no RT60 multibanda detectado.
"""
        return report

    def process(self, text, analysis=None, mixer_state=None):
        text = text.lower().strip()
        analysis = analysis or (self.session.analyses_history[-1] if self.session.analyses_history else {})
        if analysis and isinstance(analysis, dict):
            self.session.add_analysis(analysis)

        classification = None
        if mixer_state and isinstance(mixer_state, dict):
            classification = mixer_state.get('classification')

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
                alerts.append("- **Master Mutado:** O Master geral da mesa esta mutado. Nenhum som saira para os PAs.")
                suggested_cmds.append(self.command("master_mute", "Desmutar Master", enabled=False))
            
            # B) Verificar Master Clipando
            if all_vus and 'master' in all_vus:
                master_vu = self._safe_float(all_vus.get('master'), 0.0)
                if master_vu > 0.98:
                    alerts.append(f"- **Master Clipando:** O volume geral esta muito alto (VU em {int(master_vu*100)}%). Risco de distorcao.")
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
                    alerts.append(f"- **Mute com Sinal:** O canal {ch_idx} ({ch_name}) esta mutado, mas recebendo sinal ativo (VU em {int(vu_val*100)}%).")
                    suggested_cmds.append(self.command("channel_mute", f"Desmutar {ch_name}", channel=ch_idx, enabled=False))
            
            # D) Vozes sem HPF
            for idx, ch in enumerate(inputs):
                ch_idx = idx + 1
                ch_name = ch.get('name', '')
                ch_name_lower = ch_name.lower()
                hpf = self._safe_float(ch.get('hpf', 0), 0.0)
                
                if any(k in ch_name_lower for k in ['voz', 'past', 'mic', 'preg', 'minist', 'cant', 'lead', 'coral']):
                    if hpf <= 50:
                        alerts.append(f"- **Voz sem HPF:** O canal {ch_idx} ({ch_name}) esta sem filtro passa-altas (HPF em {int(hpf)}Hz). Risco de embolamento de graves.")
                        suggested_cmds.append(self.command("apply_channel_hpf", f"Ativar HPF 100Hz no {ch_name}", channel=ch_idx, hz=100))
            
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
                        alerts.append(f"- **Voz sem Compressor:** Canal {ch_idx} ({ch_name}) esta recebendo sinal ativo mas esta sem compressor. Risco de picos de volume.")
            
            if not alerts:
                report_md = """
# Auditoria de Mesa Soundcraft

Tudo certo! Nao detectei nenhum problema critico de mutes, EQs ou filtros nas vozes ativas.
"""
                return {
                    "text": "Auditoria concluida. Todos os canais estao configurados corretamente.",
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
            profile_names = {'janelas_vidro': 'Janelas/Vidro', 'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas'}
            profile_label = profile_names.get(self.session.room_profile, self.session.room_profile)
            
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
        if re.search(r'(relatorio|auditoria|resumo técnico|estatistica)', text):
            report_md = self.generate_technical_report(analysis)
            return {
                "text": "Gerando seu relatório técnico detalhado agora. Analisando inteligibilidade (STI) e distância crítica...",
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
                    "text": f"Ouvindo a mesa completa: Pico em {peak}Hz. {room_suggestion}",
                    "command": self.command("eq_cut", f"Ajuste Geral {peak}Hz", target="master", hz=peak, gain=-3, q=1.0)
                }
            elif "microfonia" in text or "apito" in text:
                 fft_response = {
                    "text": f"ALERTA GERAL: Microfonia em {peak}Hz. Aplicando Notch no Master.",
                    "command": self.command("eq_cut", f"Notch Global {peak}Hz", target="master", hz=peak, gain=-8, q=5.0, band=4)
                }
            elif not has_specific_channel:
                fft_response = {
                    "text": f"Análise Global: Identifiquei acúmulo em {peak}Hz no som da sala. {room_suggestion or 'Sugiro limpar o Master.'}",
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
                        "text": f"O tempo de reverberacao RT60 em 125Hz esta muito alto ({r125}s), gerando ressonancia de graves na sala. Sugiro aplicar um corte corretivo no equalizador Master.",
                        "command": self.command("eq_cut", "Corte RT60 Grave 125Hz", target="master", hz=125, gain=-4, q=1.0, band=1)
                    }
                
                if r125 > 1.8 and r125 > r1k * 1.5:
                    detected_profile = 'teto_alto'
                elif self._safe_float(rt60.get('500', 0), 0) > 1.5 and self._safe_float(rt60.get('500', 0), 0) > r4k * 1.3:
                    detected_profile = 'paredes_paralelas'
                elif r4k > 1.2:
                    detected_profile = 'janelas_vidro'

                if detected_profile and detected_profile != self.session.room_profile:
                    profile_names = {'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas', 'janelas_vidro': 'Janelas/Vidro'}
                    self.session.room_profile = detected_profile
                    return {
                        "text": f"Assinatura acustica de {profile_names[detected_profile]} detectada via RT60. Perfil atualizado.",
                        "command": self.command("set_room_profile", f"Perfil: {detected_profile}", profile=detected_profile)
                    }

            # Análise de EQ por Spectrum (dB)
            if spec:
                s125 = self._safe_float(spec.get('125', -100), -100)
                s1k = self._safe_float(spec.get('1000', -100), -100)
                if s125 > s1k + 10:
                    return {
                        "text": "Excesso de energia subsônica (125Hz) detectado no espectro. Sugiro HPF.",
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
                profile_names = {'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas', 'janelas_vidro': 'Janelas/Vidro'}
                rt60_response = {
                    "text": f"Detectei assinatura de {profile_names[detected_profile]}. Alterando perfil.",
                    "command": self.command("set_room_profile", f"Mudar perfil para {detected_profile}", profile=detected_profile)
                }
                self.session.room_profile = detected_profile
                return rt60_response

            if bands.get('125', 0) > 2.0:
                rt60_response = {
                    "text": f"RT60 em 125Hz critico ({bands['125']}s). Sugiro corte no Master.",
                    "command": self.command("eq_cut", "Corte RT60 Grave 125Hz", target="master", hz=125, gain=-4, q=1.0, band=1)
                }
            else:
                avg_mid = (bands.get('500', 0) + bands.get('1000', 0)) / 2
                if avg_mid > 1.5:
                    rt60_response = {
                        "text": f"Reverberação média alta ({avg_mid:.1f}s). Sugiro reduzir 800Hz no Master.",
                        "command": self.command("eq_cut", "Melhorar Inteligibilidade", target="master", hz=800, gain=-3, q=1.2)
                    }

        if 'rt60_response' in locals() and rt60_response: return rt60_response
        if fft_response: return fft_response

        # 2. Respostas por Texto
        if re.search(r'(voz|pregador|pregação|pastor)', text):
            target = f"canal {channel}" if has_specific_channel else "canal de voz principal"
            return {
                "text": f"Otimizando {target}. Aplicando clareza.",
                "command": self.command("run_clean_sound_preset", f"Voz {target}", channel=channel)
            }
        
        if re.search(r'(instrumentos|banda|musical)', text):
            return {
                "text": "Ouvindo a banda. Equilibrando Master.",
                "command": self.command("eq_cut", "Espaço Banda", target="master", hz=400, gain=-2, q=0.8)
            }

        if re.search(r'(delay|atraso|distancia|metros)', text):
            dist_match = re.search(r'(\d+(?:[.,]\d+)?)\s*(?:m|metro)', text)
            if dist_match:
                meters = float(dist_match.group(1).replace(',', '.'))
                ms = round(meters * 2.915, 1)
                return {
                    "text": f"Para {meters}m, delay ideal: {ms}ms no Aux 9.",
                    "command": self.command("set_delay", f"Delay {meters}m", aux=9, ms=ms)
                }

        if re.search(r'(retorno|monitor|auxiliar)', text):
            aux_match = re.search(r'(?:aux|monitor|auxiliar)\s*(\d{1,2})', text)
            aux_ch = int(aux_match.group(1)) if aux_match else 1
            if "mais" in text or "aumentar" in text:
                return {"text": f"Aumentando canal {channel} no Aux {aux_ch}.", "command": self.command("set_aux_level", "Aumentar Aux", channel=channel, aux=aux_ch, level=0.8)}
            if "mudo" in text or "mutar" in text:
                return {"text": f"Mutando canal {channel} no Aux {aux_ch}.", "command": self.command("set_aux_level", "Mute Aux", channel=channel, aux=aux_ch, level=0)}

        # 3. Fallback: IA Local (Modelo Leve)
        if self.llm:
            self.llm.reload_if_needed()
        if self.llm and self.llm.enabled:
            print(f"[AI Engine] Usando modelo local para: {text}")
            # Passamos o contexto atual para o modelo
            ctx = {
                "rt60": self._safe_float(analysis.get('rt60', 1.2), 1.2),
                "peakHz": self._safe_float(analysis.get('peakHz', 0), 0),
                "rms": self._safe_float(analysis.get('rms', -45), -45),
                "room_profile": self.session.room_profile
            }
            if classification:
                ctx["classification"] = classification
            llm_response = self.llm.query(text, context_data=ctx)
            if llm_response:
                return {"text": llm_response, "command": None, "source": "local_llm"}

        return {"text": "Estou ouvindo. Posso sugerir ajustes técnicos, aplicar presets de voz ou gerar um relatório detalhado da sua acústica.", "command": None}

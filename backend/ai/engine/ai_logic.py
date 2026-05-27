# -*- coding: utf-8 -*-
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
        self.conversation = []
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

    def add_message(self, role, content):
        self.touch()
        self.conversation.append({
            "role": role,
            "content": content,
            "ts": time.time()
        })
        if len(self.conversation) > 20:
            self.conversation.pop(0)

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
                self.llm = Llama(model_path=model_path, n_ctx=2048, n_threads=4, verbose=False)
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
            self.llm = Llama(model_path=self.model_path, n_ctx=2048, n_threads=4, verbose=False)
            self.enabled = True
            print(f"[AI Engine] Modelo carregado após download: {self.model_path}")
            return True
        except Exception as e:
            print(f"[AI Engine] Falha ao carregar modelo após download: {e}")
            return False

    def query(self, prompt, context_data=None, conversation=None):
        if not self.enabled:
            return None
        if not self.llm:
            return None

        profile_names = {'janelas_vidro': 'Janelas/Vidro', 'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas'}
        system_prompt = (
            "Você é o SoundMaster IA — assistente amigável de som para igrejas. "
            "Fale de forma simples, calorosa e acolhedora, como um colega ajudando outro. "
            "EVITE jargão técnico. Use palavras do dia a dia. "
            "Exemplos: 'som abafado' ao invés de 'excesso de energia subsônica'; "
            "'chiado' ao invés de 'sibilância'; 'o som está estranho' ao invés de 'anomalia espectral'. "
            "Cumprimente com 'Bom dia!', 'Olá!', 'Tudo bem?'. "
            "Seja paciente e encorajador. Seu objetivo é ajudar voluntários de igreja a terem um som melhor. "
            f"Perfil ativo da sala: {profile_names.get(context_data.get('room_profile'), context_data.get('room_profile', 'desconhecido')) if context_data else 'desconhecido'}. "
            "Sugira ações práticas de forma simples."
        )
        if context_data:
            master_eq_info = context_data.get('master_eq', 'nenhum corte ativo')
            system_prompt += f" Contexto Atual: RT60={context_data.get('rt60')}s, Pico={context_data.get('peakHz')}Hz, RMS={context_data.get('rms')}dB. EQ Master atual: {master_eq_info}."

        history_text = ""
        if conversation:
            for msg in conversation[-10:]:
                tag = "<|user|>" if msg["role"] == "user" else "<|assistant|>"
                history_text += f"{tag}\n{msg['content']}</s>\n"

        full_prompt = f"<|system|>\n{system_prompt}</s>\n{history_text}<|user|>\n{prompt}</s>\n<|assistant|>\n"
        try:
            with self._lock:
                output = self.llm(full_prompt, max_tokens=512, stop=["</s>"], echo=False)
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
            return 1
        channel_num = int(channel_match.group(1))
        if channel_num < 1 or channel_num > 24:
            print(f"[AI Engine] Canal {channel_num} fora do range 1-24, ajustando.")
            channel_num = max(1, min(24, channel_num))
        return channel_num

    def generate_technical_report(self, analysis=None):
        from acoustics.processor import AcousticProcessor
        
        analysis = analysis or (self.session.analyses_history[-1] if self.session.analyses_history else {})
        
        # Se não há dados reais de análise, pede medição primeiro
        has_data = bool(analysis.get('rt60') or analysis.get('rt60_multiband') or analysis.get('rms'))
        if not has_data and not self.session.analyses_history:
            return None
        
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
        if re.search(r'(relat[oó]rio|resumo|estat[ií]stica|cen[aá]rio)', text):
            report_md = self.generate_technical_report(analysis)
            if report_md is None:
                return {
                    "text": "Ainda não tenho dados acústicos para gerar um relatório. Primeiro ative o analisador e faça uma medição de ruído rosa ou aguarde o microfone captar o som ambiente. Depois peça o relatório novamente! 😊",
                    "command": None
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
                    profile_names = {'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas', 'janelas_vidro': 'Janelas/Vidro'}
                    self.session.room_profile = detected_profile
                    return {
                        "text": f"Ah, percebi! Pela forma como o som se comporta, sua sala parece ser do tipo 'perfil de {profile_names[detected_profile]}'. Já ajustei minhas sugestões pra esse tipo de ambiente.",
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
                profile_names = {'teto_alto': 'Teto Alto', 'paredes_paralelas': 'Paredes Paralelas', 'janelas_vidro': 'Janelas/Vidro'}
                rt60_response = {
                    "text": f"Pelo som, acho que sua sala se parece com um ambiente do tipo '{profile_names[detected_profile]}'. Já ajustei minhas dicas pra isso!",
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

        if 'rt60_response' in locals() and rt60_response: return rt60_response
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
            preset_name = name_match.group(1).strip() if name_match else f"Preset {time.strftime('%d/%m %H:%M')}"
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
            scene_name = scene_name_match.group(1).strip() if scene_name_match else f"Cena {time.strftime('%d/%m %H:%M')}"
            return {
                "text": f"Vou criar uma nova cena '{scene_name}' com o estado atual da mesa! 🎯",
                "command": self.command("save_scene", f"Criar cena: {scene_name}", name=scene_name)
            }

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
                "room_profile": self.session.room_profile,
                "master_eq": self._eq_summary_str(mixer_state, "master"),
            }
            if classification:
                ctx["classification"] = classification
            llm_response = self.llm.query(text, context_data=ctx, conversation=self.session.conversation)
            if llm_response:
                return {"text": llm_response, "command": None, "source": "local_llm"}

        # Fallback: mostra as palavras-chave detectadas para dar feedback ao usuário
        palavras = [p for p in text.split() if len(p) > 3]
        encontradas = [p for p in palavras if re.search(r'(voz|som|canal|microfone|palco|sala|abafad|estranh|baixo|alto|grave|agudo|apito|eco|retorno|monitor|auditoria|ajud[oa]|problema|volume|fader|mute|compressor|equalizador|hpf|gate|delay|reverb|preset|cena|feedback)', p)]
        if encontradas:
            dica = f"Entendi! Você falou sobre: {', '.join(encontradas[:5])}. "
            dica += "Vou analisar e sugerir ajustes. Pode me dar mais detalhes?"
            return {"text": dica, "command": None, "context": {"keywords": encontradas}}
        return {"text": "Olá! 😊 Me diga o que você está sentindo no som: está baixo, estranho, abafado, apitando? Pode falar do seu jeito que eu entendo e ajudo!", "command": None}

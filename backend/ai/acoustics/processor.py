import math
import time

class AcousticProcessor:
    @staticmethod
    def eyring_rt60(volume, surface_area, alpha):
        """Mais preciso que Sabine para alpha > 0.2 (salas tratadas ou muito absortivas)"""
        if surface_area <= 0:
            return 0 # Evita divisão por zero
        if alpha >= 1: alpha = 0.99
        if alpha <= 0: alpha = 0.01 # Evita math.log(1) = 0
        return (-0.161 * volume) / (surface_area * math.log(1 - alpha))

    @staticmethod
    def classify_room(rt60):
        # ✅ Correção Auditoria: Gradação mais justa e precisa para grandes espaços (Igrejas/Auditórios)
        if rt60 < 0.3: return {"status": "Sala morta", "desc": "Excesso de absorção. O som pode parecer sem vida.", "rating": 2}
        if 0.3 <= rt60 <= 0.8: return {"status": "Ideal para Voz", "desc": "Inteligibilidade máxima para pregação e palestras.", "rating": 5}
        if 0.8 < rt60 <= 1.6: return {"status": "Ideal para Música", "desc": "Boa sustentação harmônica para louvor congregacional.", "rating": 4}
        if 1.6 < rt60 <= 2.4: return {"status": "Desafiadora", "desc": "Sala reverberante. Requer cuidado extremo com o volume e delays.", "rating": 3}
        if 2.4 < rt60 <= 3.2: return {"status": "Muito Reverberante", "desc": "Baixa inteligibilidade. Considere tratamento acústico nas superfícies paralelas.", "rating": 2}
        return {"status": "Crítico", "desc": "Ambiente extremamente reflexivo. Inteligibilidade comprometida.", "rating": 1}

    @staticmethod
    def estimate_sti(rt60, snr=25):
        """
        Estimativa simplificada do Speech Transmission Index (IEC 60268-16)
        Baseado na relação RT60 e Relação Sinal-Ruído (SNR)
        """
        # Simplificação: STI ≈ (1 / (1 + (RT60 / 0.5))) * (SNR / 30)
        # Valores entre 0 (pessimo) e 1 (excelente)
        sti = (1.0 / (1.0 + (rt60 / 0.6))) * (min(snr, 30) / 30.0)
        return round(max(0, min(1, sti)), 2)

    @staticmethod
    def calculate_critical_distance(volume, rt60, q=None):
        """
        Calcula a Distância Crítica (Dc) - onde o som direto é igual ao reverberante.
        Parâmetros de Q (Diretividade):
        - Q=2: Caixas convencionais / Point Source
        - Q=5: Caixas de alta diretividade (Horns estreitos)
        - Q=8-12: Line Arrays ou Colunas de som
        """
        if rt60 <= 0: return 0
        # Q default se não fornecido
        q_val = q if q is not None else 2
        dc = 0.057 * math.sqrt((q_val * volume) / rt60)
        return round(dc, 2)

    @staticmethod
    def diagnose_patterns(analyses_history):
        if not analyses_history:
            return []
            
        peak_frequencies = [a.get('peakHz', 0) for a in analyses_history if a.get('peakHz')]
        if not peak_frequencies:
             return []

        from collections import Counter
        # Ajuste: Frequências abaixo de 100Hz usam baldes de 10Hz, acima usam 50Hz
        buckets = []
        for f in peak_frequencies:
            if f < 100:
                buckets.append(round(f / 10) * 10)
            else:
                buckets.append(round(f / 50) * 50)
        
        freq_counter = Counter(buckets)
        most_common = freq_counter.most_common(3)
        
        patterns = []
        for freq_bucket, count in most_common:
            if count >= 3:
                patterns.append({
                    'hz': freq_bucket,
                    'confidence': round(count / len(peak_frequencies), 2),
                    'suggestion': f"Ressonância em {freq_bucket}Hz. Sugerimos filtro Notch."
                })
        return patterns

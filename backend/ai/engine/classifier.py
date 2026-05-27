# -*- coding: utf-8 -*-
import os
import csv
import numpy as np

CLASS_MAP_URL = "https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv"

class AudioClassifier:
    def __init__(self, models_dir=None):
        if models_dir is None:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            models_dir = os.path.join(os.path.dirname(script_dir), 'models')
        self.models_dir = models_dir
        self.class_map_path = os.path.join(models_dir, 'yamnet_class_map.csv')
        self.class_names = []
        self.model = None
        self.enabled = False
        self._backend = None  # 'tflite' ou 'tfhub' após _setup()
        self._setup()


    def _download(self, url, dest):
        try:
            import urllib.request
            urllib.request.urlretrieve(url, dest)
            return True
        except Exception as e:
            print(f"[Classifier] Falha ao baixar {url}: {e}")
            return False

    def _ensure_class_map(self):
        if os.path.exists(self.class_map_path):
            return True
        os.makedirs(self.models_dir, exist_ok=True)
        if self._download(CLASS_MAP_URL, self.class_map_path):
            return True
        self._write_embedded_class_map()

    def _write_embedded_class_map(self):
        with open(self.class_map_path, 'w', encoding='utf-8', newline='') as f:
            w = csv.writer(f)
            w.writerow(['index', 'mid', 'display_name'])
            for i, name in enumerate(_EMBEDDED_CLASSES):
                w.writerow([i, f'/m/{i:05d}', name])

    def _load_class_map(self):
        self.class_names = []
        if not os.path.exists(self.class_map_path):
            return
        with open(self.class_map_path, encoding='utf-8') as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) >= 3:
                    self.class_names.append(row[2].strip())

    # URL do modelo TFLite do YAMNet (Google)
    _YAMNET_TFLITE_URL = (
        "https://storage.googleapis.com/download.tensorflow.org"
        "/models/tflite/task_library/audio_classification"
        "/android/lite-model_yamnet_classification_tflite_1.tflite"
    )

    def _setup(self):
        self._ensure_class_map()
        self._load_class_map()
        # Tenta tflite-runtime primeiro (leve, ~20MB, sem internet no runtime)
        if self._setup_tflite():
            return
        # Fallback: tensorflow_hub completo (online no 1º start, ~500MB)
        self._setup_tfhub()

    def _setup_tflite(self):
        """Carrega YAMNet via tflite-runtime (opção leve e offline)."""
        tflite_path = os.path.join(self.models_dir, 'yamnet.tflite')
        # Baixa o modelo TFLite se não existir
        if not os.path.exists(tflite_path):
            print("[Classifier] Baixando YAMNet TFLite (~3MB)...")
            if not self._download(self._YAMNET_TFLITE_URL, tflite_path):
                return False
        try:
            import tflite_runtime.interpreter as tflite
            interp = tflite.Interpreter(model_path=tflite_path)
            interp.allocate_tensors()
            self.model = interp
            self._backend = 'tflite'
            self.enabled = True
            print(f"[Classifier] YAMNet TFLite carregado ({len(self.class_names)} classes). Backend: tflite-runtime")
            return True
        except ImportError:
            print("[Classifier] tflite-runtime não instalado. Tentando tensorflow_hub...")
            return False
        except Exception as e:
            print(f"[Classifier] Falha ao carregar YAMNet TFLite: {e}")
            return False

    def _setup_tfhub(self):
        """Fallback: carrega YAMNet via tensorflow_hub (online no 1º start)."""
        try:
            import tensorflow_hub as hub
            print("[Classifier] Carregando YAMNet do TF Hub (requer internet)...")
            self.model = hub.load('https://tfhub.dev/google/yamnet/1')
            self._backend = 'tfhub'
            self.enabled = True
            print(f"[Classifier] YAMNet TF Hub carregado ({len(self.class_names)} classes).")
        except ImportError:
            print("[Classifier] Nenhum backend disponível (tflite-runtime nem tensorflow-hub).")
            print("[Classifier] Execute: pip install tflite-runtime")
        except Exception as e:
            print(f"[Classifier] Erro ao carregar YAMNet via TF Hub: {e}")

    def _resample(self, audio, orig_sr, target_sr=16000):
        if orig_sr == target_sr:
            return audio.astype(np.float32)
        ratio = target_sr / orig_sr
        new_len = int(len(audio) * ratio)
        if new_len < 1:
            return np.zeros(1, dtype=np.float32)
        resampled = np.interp(
            np.linspace(0, len(audio) - 1, new_len),
            np.arange(len(audio)),
            audio
        )
        return resampled.astype(np.float32)

    def _classify_tflite(self, audio):
        """Executa inferência via tflite-runtime."""
        input_details = self.model.get_input_details()
        output_details = self.model.get_output_details()
        # YAMNet TFLite espera [1, N] float32
        wav_input = audio.reshape(1, -1)
        self.model.resize_input_tensor(input_details[0]['index'], wav_input.shape)
        self.model.allocate_tensors()
        self.model.set_tensor(input_details[0]['index'], wav_input)
        self.model.invoke()
        scores = self.model.get_tensor(output_details[0]['index'])  # shape [frames, 521]
        return np.mean(scores, axis=0)

    def _classify_tfhub(self, audio):
        """Executa inferência via tensorflow_hub."""
        import tensorflow as tf
        result = self.model(audio)
        if isinstance(result, (list, tuple)):
            scores = result[0]
        elif isinstance(result, dict):
            scores = result.get('scores', list(result.values())[0])
        else:
            scores = result
        return tf.reduce_mean(scores, axis=0).numpy()

    def classify(self, audio_data, sample_rate=16000):
        if not self.enabled:
            return []
        audio = np.array(audio_data, dtype=np.float64)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = self._resample(audio, sample_rate)
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak

        if self._backend == 'tflite':
            avg_scores = self._classify_tflite(audio)
        else:
            avg_scores = self._classify_tfhub(audio)

        indices = np.argsort(avg_scores)[::-1]
        results = []
        for idx in indices:
            name = self.class_names[idx] if idx < len(self.class_names) else f"Class_{idx}"
            results.append({'index': int(idx), 'name': name, 'score': float(avg_scores[idx])})
        return results


    def get_top_classes(self, audio_data, sample_rate=16000, k=5, threshold=0.1):
        results = self.classify(audio_data, sample_rate)
        return [r for r in results if r['score'] >= threshold][:k]

    def get_tag(self, audio_data, sample_rate=16000):
        top = self.get_top_classes(audio_data, sample_rate, k=1, threshold=0.3)
        if top:
            return top[0]['name']
        return None

_EMBEDDED_CLASSES = [
    "Speech", "Music", "Song", "Musical instrument", "Silence",
    "Telephone", "Dial tone", "Alarm", "Bell", "Siren",
    "Vehicle", "Engine", "Helicopter", "Airplane", "Train",
    "Water", "Rain", "Wind", "Thunder", "Fire",
    "Animal", "Dog", "Cat", "Bird", "Cattle",
    "Footsteps", "Clapping", "Laughter", "Cough", "Sneeze",
    "Drums", "Guitar", "Piano", "Bass guitar", "Violin",
    "Flute", "Trumpet", "Saxophone", "Organ", "Synthesizer",
    "Microphone", "Loudspeaker", "Public address", "Amplifier", "Feedback",
    "Distortion", "Noise", "Hum", "Click", "Pop",
    "Reverberation", "Echo", "Room acoustics", "Choir", "Congregation",
    "Preacher", "Sermon", "Prayer", "Worship music", "Contemporary worship",
    "Hymn", "Praise", "Announcement", "Offering", "Bible reading",
    "Electric guitar", "Acoustic guitar", "Keyboard", "Cymbal", "Snare drum",
    "Bass drum", "Hi-hat", "Tambourine", "Shaker", "Hands",
    "Applause", "Cheers", "Amen", "Hallelujah", "Whistle",
    "Beatbox", "Scat singing", "Yodeling", "Vocal", "Chant",
    "Acoustic environment", "Concert hall", "Church", "Stadium", "Outdoor",
    "Indoor", "Live performance", "Recording", "Broadcast", "Streaming",
]

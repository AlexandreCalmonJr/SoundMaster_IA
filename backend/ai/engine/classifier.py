# -*- coding: utf-8 -*-
import os
# Silencia logs redundantes do TensorFlow/oneDNN antes de qualquer import
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

import csv
import warnings
warnings.filterwarnings("ignore", category=UserWarning)

# pyrefly: ignore [missing-import]
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
        """Carrega YAMNet via tflite-runtime ou tensorflow.lite (opçao leve e offline)."""
        tflite_path = os.path.join(self.models_dir, 'yamnet.tflite')
        # Baixa o modelo TFLite se não existir
        if not os.path.exists(tflite_path):
            print("[Classifier] Baixando YAMNet TFLite (~3MB)...")
            if not self._download(self._YAMNET_TFLITE_URL, tflite_path):
                return False
        try:
            try:
                import importlib
                tflite = importlib.import_module("tflite_runtime.interpreter")
                backend_name = 'tflite-runtime'
            except ImportError:
                import importlib
                # Importa explicitamente tensorflow.lite para registrar o Interpreter
                tflite = importlib.import_module("tensorflow.lite")
                backend_name = 'tensorflow.lite'
                
            interp = tflite.Interpreter(model_path=tflite_path)
            interp.allocate_tensors()
            self.model = interp
            self._backend = 'tflite'
            self.enabled = True
            print(f"[Classifier] YAMNet TFLite carregado ({len(self.class_names)} classes). Backend: {backend_name}")
            return True
        except ImportError:
            print("[Classifier] tflite-runtime e tensorflow nao instalados. Tentando tensorflow_hub...")
            return False
        except Exception as e:
            print(f"[Classifier] Falha ao carregar YAMNet TFLite: {e}")
            return False

    def _setup_tfhub(self):
        """Fallback: carrega YAMNet via tensorflow_hub (online no 1º start)."""
        try:
            import importlib
            hub = importlib.import_module("tensorflow_hub")
            print("[Classifier] Carregando YAMNet do TF Hub (requer internet)...")
            self.model = hub.load('https://tfhub.dev/google/yamnet/1')
            self._backend = 'tfhub'
            self.enabled = True
            print(f"[Classifier] YAMNet TF Hub carregado ({len(self.class_names)} classes).")
        except ImportError:
            import platform
            print("[Classifier] Nenhum backend disponivel (tflite-runtime nem tensorflow).")
            if platform.system() == 'Windows' or platform.system() == 'Darwin':
                print("[Classifier] Execute: pip install tensorflow")
            else:
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
        """Executa inferência via tflite-runtime ou tensorflow.lite."""
        if self.model is None:
            raise RuntimeError("YAMNet TFLite interpreter is not loaded.")
        input_details = self.model.get_input_details()
        output_details = self.model.get_output_details()
        expected_shape = tuple(input_details[0]['shape'])  # e.g. (15600,) ou (1, 15600)
        total_samples = int(np.prod(expected_shape))
        if len(audio) == 0:
            audio = np.zeros(total_samples, dtype=np.float64)
        elif len(audio) > total_samples:
            audio = audio[:total_samples]
        elif len(audio) < total_samples:
            audio = np.pad(audio, (0, total_samples - len(audio)))
        wav_input = audio.reshape(expected_shape).astype(np.float32)
        if hasattr(self.model, 'resize_input_tensor'):
            self.model.resize_input_tensor(input_details[0]['index'], wav_input.shape)
            self.model.allocate_tensors()
        self.model.set_tensor(input_details[0]['index'], wav_input)
        self.model.invoke()
        scores = self.model.get_tensor(output_details[0]['index'])  # shape [frames, 521]
        # scores pode ser [1, 521] ou [521]; achatar para média
        scores = np.atleast_2d(scores)
        return np.mean(scores, axis=0)

    def _classify_tfhub(self, audio):
        """Executa inferência via tensorflow_hub."""
        import importlib
        tf = importlib.import_module("tensorflow")
        if self.model is None or not callable(self.model):
            raise RuntimeError("YAMNet TF Hub model is not loaded or not callable.")
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
        try:
            audio = np.array(audio_data, dtype=np.float64)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            audio = self._resample(audio, sample_rate)
            if len(audio) == 0:
                return []
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
        except Exception as e:
            print(f"[Classifier] Erro durante a classificação de áudio: {e}")
            return []


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

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

    def _setup(self):
        self._ensure_class_map()
        self._load_class_map()
        try:
            import tensorflow_hub as hub
            import tensorflow as tf
            print("[Classifier] Carregando YAMNet do TF Hub...")
            self.model = hub.load('https://tfhub.dev/google/yamnet/1')
            self.enabled = True
            print(f"[Classifier] YAMNet carregado ({len(self.class_names)} classes).")
        except ImportError:
            print("[Classifier] tensorflow-hub ou tensorflow não instalados.")
        except Exception as e:
            print(f"[Classifier] Erro ao carregar YAMNet: {e}")

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

    def classify(self, audio_data, sample_rate=16000):
        if not self.enabled:
            return []
        import tensorflow as tf
        audio = np.array(audio_data, dtype=np.float64)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        audio = self._resample(audio, sample_rate)
        peak = np.max(np.abs(audio))
        if peak > 0:
            audio = audio / peak
        result = self.model(audio)
        if isinstance(result, (list, tuple)):
            scores = result[0]
        elif isinstance(result, dict):
            scores = result.get('scores', list(result.values())[0])
        else:
            scores = result
        avg_scores = tf.reduce_mean(scores, axis=0).numpy()
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

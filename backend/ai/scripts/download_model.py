import os
import hashlib
import subprocess
import sys

try:
    import requests
    from tqdm import tqdm
except ImportError:
    print("Instalando dependências necessárias (requests, tqdm)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "tqdm"])
    import requests
    from tqdm import tqdm

MODEL_URL = "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
MODEL_FILENAME = "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf"
# Se vazio, o hash é computado após o download e salvo num sidecar .sha256
EXPECTED_SHA256 = ""

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def _sha256_sidecar_path(model_path):
    return model_path + ".sha256"

def _verify_or_save_hash(model_path):
    actual = sha256_file(model_path)
    sidecar = _sha256_sidecar_path(model_path)

    if EXPECTED_SHA256:
        if actual == EXPECTED_SHA256:
            print("SHA256 OK.")
            return True
        print(f"⚠️ SHA256 mismatch (esperado={EXPECTED_SHA256}, obtido={actual})")
        return False

    # Sem hash pré-definido: usa sidecar cache
    if os.path.exists(sidecar):
        with open(sidecar) as f:
            cached = f.read().strip()
        if actual == cached:
            print("SHA256 OK (cache sidecar).")
            return True
        print(f"⚠️ SHA256 mismatch vs sidecar (cached={cached}, actual={actual})")
        return False

    # Primeira vez: salva o hash no sidecar
    with open(sidecar, "w") as f:
        f.write(actual)
    print(f"SHA256 salvo em sidecar: {actual}")
    return True

def download_model():
    target_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    target_path = os.path.join(target_dir, MODEL_FILENAME)

    os.makedirs(target_dir, exist_ok=True)

    if os.path.exists(target_path):
        print(f"Modelo já existe em: {target_path}")
        _verify_or_save_hash(target_path)
        return

    print("Iniciando download do modelo leve (TinyLlama 1.1B)...")
    print("Aprox. 670MB — pode levar alguns minutos.")

    response = requests.get(MODEL_URL, stream=True, timeout=(10, 300))
    response.raise_for_status()
    total_size = int(response.headers.get("content-length", 0))

    with open(target_path, "wb") as f, tqdm(
        desc="Progresso",
        total=total_size,
        unit="iB",
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for data in response.iter_content(chunk_size=1048576):
            if data:
                f.write(data)
                bar.update(len(data))

    print(f"\nSucesso! Modelo salvo em: {target_path}")
    _verify_or_save_hash(target_path)

if __name__ == "__main__":
    download_model()

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

MODEL_URL = "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat.v1.0.Q4_K_M.gguf"
MODEL_FILENAME = "tinyllama-1.1b-chat.Q4_K_M.gguf"
EXPECTED_SHA256 = ""  # Opcional: preencha com o SHA256 conhecido

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def download_model():
    target_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    target_path = os.path.join(target_dir, MODEL_FILENAME)

    os.makedirs(target_dir, exist_ok=True)

    if os.path.exists(target_path):
        print(f"Modelo já existe em: {target_path}")
        if EXPECTED_SHA256:
            actual = sha256_file(target_path)
            if actual == EXPECTED_SHA256:
                print("SHA256 OK.")
            else:
                print(f"SHA256 mismatch (esperado={EXPECTED_SHA256}, obtido={actual})")
        return

    print("Iniciando download do modelo leve (TinyLlama 1.1B)...")
    print("Aprox. 670MB — pode levar alguns minutos.")

    response = requests.get(MODEL_URL, stream=True, timeout=30)
    response.raise_for_status()
    total_size = int(response.headers.get("content-length", 0))

    with open(target_path, "wb") as f, tqdm(
        desc="Progresso",
        total=total_size,
        unit="iB",
        unit_scale=True,
        unit_divisor=1024,
    ) as bar:
        for data in response.iter_content(chunk_size=1024):
            f.write(data)
            bar.update(len(data))

    print(f"\nSucesso! Modelo salvo em: {target_path}")

    if EXPECTED_SHA256:
        actual = sha256_file(target_path)
        if actual == EXPECTED_SHA256:
            print("SHA256 OK.")
        else:
            print(f"⚠️ SHA256 mismatch: esperado={EXPECTED_SHA256}, obtido={actual}")

if __name__ == "__main__":
    download_model()

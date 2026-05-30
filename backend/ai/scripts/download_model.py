# -*- coding: utf-8 -*-
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

# ─── Catálogo de modelos suportados ──────────────────────────────────────────
SUPPORTED_MODELS = {
    'phi3.5-mini': {
        'name': 'Phi-3.5 Mini 3.8B',
        'gguf': 'Phi-3.5-mini-instruct-Q4_K_M.gguf',
        'url': 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
        'size_mb': 2300,
        'description': 'Melhor qualidade geral. Bom PT-BR. Recomendado para PCs com 8GB+ RAM.',
    },
    'llama3.2-3b': {
        'name': 'Llama 3.2 3B',
        'gguf': 'llama-3.2-3b-instruct.Q4_K_M.gguf',
        'url': 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/llama-3.2-3b-instruct.Q4_K_M.gguf',
        'size_mb': 2000,
        'description': 'Upgrade natural do 1B. Ótimo equilíbrio entre velocidade e qualidade.',
    },
    'gemma2-2b': {
        'name': 'Gemma 2 2B',
        'gguf': 'gemma-2-2b-it.Q4_K_M.gguf',
        'url': 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it.Q4_K_M.gguf',
        'size_mb': 1600,
        'description': 'Leve e rápido. Bom para PT-BR. Ideal para PCs com 4-8GB RAM.',
    },
    'tinyllama-1.1b': {
        'name': 'TinyLlama 1.1B',
        'gguf': 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'url': 'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
        'size_mb': 670,
        'description': 'Mais leve. Respostas básicas. Para PCs muito limitados.',
    },
}

DEFAULT_MODEL = os.getenv("AI_MODEL", "phi3.5-mini")

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

    if os.path.exists(sidecar):
        with open(sidecar) as f:
            cached = f.read().strip()
        if actual == cached:
            print("SHA256 OK (cache sidecar).")
            return True
        print(f"[WARN] SHA256 mismatch vs sidecar (cached={cached}, actual={actual})")
        return False

    # Primeira vez: salva o hash no sidecar
    with open(sidecar, "w") as f:
        f.write(actual)
    print(f"SHA256 salvo em sidecar: {actual}")
    return True

def download_model(model_key=None):
    """Baixa o modelo especificado (ou o padrão)."""
    if model_key is None:
        model_key = DEFAULT_MODEL

    if model_key not in SUPPORTED_MODELS:
        print(f"[ERRO] Modelo '{model_key}' não suportado.")
        print(f"   Modelos disponíveis: {', '.join(SUPPORTED_MODELS.keys())}")
        return False

    info = SUPPORTED_MODELS[model_key]
    target_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    target_path = os.path.join(target_dir, info['gguf'])

    os.makedirs(target_dir, exist_ok=True)

    if os.path.exists(target_path):
        print(f"[OK] Modelo já existe: {target_path}")
        _verify_or_save_hash(target_path)
        return True

    print(f"[DOWNLOAD] Baixando {info['name']} (~{info['size_mb']}MB)...")
    print(f"   {info['description']}")
    print(f"   URL: {info['url']}")

    try:
        response = requests.get(info['url'], stream=True, timeout=(10, 300))
        response.raise_for_status()
        total_size = int(response.headers.get("content-length", 0))

        with open(target_path, "wb") as f, tqdm(
            desc=info['name'],
            total=total_size,
            unit="iB",
            unit_scale=True,
            unit_divisor=1024,
        ) as bar:
            for data in response.iter_content(chunk_size=1048576):
                if data:
                    f.write(data)
                    bar.update(len(data))

        print(f"\n[OK] Sucesso! Modelo salvo em: {target_path}")
        _verify_or_save_hash(target_path)
        return True

    except Exception as e:
        print(f"\n[ERRO] Falha no download: {e}")
        if os.path.exists(target_path):
            os.remove(target_path)
        return False

def list_models():
    """Lista todos os modelos suportados com status."""
    target_dir = os.path.join(os.path.dirname(__file__), "..", "models")
    print("\nModelos suportados:")
    print("-" * 60)
    for key, info in SUPPORTED_MODELS.items():
        model_path = os.path.join(target_dir, info['gguf'])
        status = "[OK] Baixado" if os.path.exists(model_path) else "[--] Não baixado"
        marker = " (padrão)" if key == DEFAULT_MODEL else ""
        print(f"  {key}{marker}: {info['name']} - {info['size_mb']}MB - {status}")
        print(f"    {info['description']}")
    print("-" * 60)
    print(f"  Modelo padrão: {DEFAULT_MODEL}")
    print(f"  Alterar: defina AI_MODEL no .env ou variável de ambiente\n")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "list":
            list_models()
        elif cmd in SUPPORTED_MODELS:
            sys.exit(0 if download_model(cmd) else 1)
        else:
            print(f"Comando desconhecido: {cmd}")
            print("Uso: python download_model.py [list|modelo]")
            print(f"Modelos: {', '.join(SUPPORTED_MODELS.keys())}")
            sys.exit(2)
    else:
        sys.exit(0 if download_model() else 1)

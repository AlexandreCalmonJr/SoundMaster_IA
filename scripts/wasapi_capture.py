import sys
import struct
import argparse

try:
    import pyaudio
    import numpy as np
    HAS_PYAUDIO = True
except ImportError:
    HAS_PYAUDIO = False

try:
    import sounddevice as sd
    HAS_SOUNDDEVICE = True
except ImportError:
    HAS_SOUNDDEVICE = False

def main():
    parser = argparse.ArgumentParser(description='Captura WASAPI e envia áudio via stdout')
    parser.add_argument('--rate', type=int, default=48000)
    parser.add_argument('--channels', type=int, default=2)
    parser.add_argument('--buffer', type=int, default=256)
    parser.add_argument('--device', type=int, default=None)
    args = parser.parse_args()

    if not HAS_PYAUDIO and not HAS_SOUNDDEVICE:
        print("ERROR: Nenhuma biblioteca de áudio disponível. Instale pyaudio ou sounddevice.", file=sys.stderr)
        sys.exit(1)

    if HAS_SOUNDDEVICE:
        _capture_sounddevice(args)
    elif HAS_PYAUDIO:
        _capture_pyaudio(args)

def _capture_sounddevice(args):
    with sd.InputStream(
        samplerate=args.rate,
        channels=args.channels,
        blocksize=args.buffer,
        device=args.device,
        dtype='float32'
    ) as stream:
        while True:
            data, _ = stream.read(args.buffer)
            sys.stdout.buffer.write(data.tobytes())
            sys.stdout.flush()

def _capture_pyaudio(args):
    pa = pyaudio.PyAudio()
    device_index = args.device
    if device_index is None:
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            if info['maxInputChannels'] > 0 and 'WASAPI' in info['name']:
                device_index = i
                break
        if device_index is None:
            device_index = pa.get_default_input_device_info()['index']

    stream = pa.open(
        format=pyaudio.paFloat32,
        channels=args.channels,
        rate=args.rate,
        input=True,
        input_device_index=device_index,
        frames_per_buffer=args.buffer,
        stream_callback=None
    )
    while True:
        data = stream.read(args.buffer)[1]
        sys.stdout.buffer.write(data)
        sys.stdout.flush()

if __name__ == '__main__':
    main()

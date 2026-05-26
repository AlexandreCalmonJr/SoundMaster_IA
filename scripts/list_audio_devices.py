import json
import sys

devices = []

try:
    import sounddevice as sd
    for i, d in enumerate(sd.query_devices()):
        if d['max_input_channels'] > 0:
            devices.append({
                'id': i,
                'name': str(d['name']),
                'channels': int(d['max_input_channels']),
                'rate': int(d['default_samplerate']),
                'isDefault': i == sd.default.device[0]
            })
except ImportError:
    try:
        import pyaudio
        pa = pyaudio.PyAudio()
        for i in range(pa.get_device_count()):
            info = pa.get_device_info_by_index(i)
            if info['maxInputChannels'] > 0:
                devices.append({
                    'id': i,
                    'name': str(info['name']),
                    'channels': int(info['maxInputChannels']),
                    'rate': int(info['defaultSampleRate']),
                    'isDefault': i == pa.get_default_input_device_info()['index']
                })
        pa.terminate()
    except ImportError:
        devices.append({
            'id': None,
            'name': 'WASAPI (instale pyaudio ou sounddevice)',
            'channels': 0,
            'rate': 0,
            'isDefault': True
        })

print(json.dumps(devices))
sys.stdout.flush()

import torch
import torchaudio
import ffmpeg
import whisper
from silero_vad import get_speech_timestamps

# === 1. 경로 설정 ===
input_path = "/home/master2/Desktop/keyhyun/KoAD/breaking_bed.mp4"
audio_path = "breaking_bed.wav"

# === 2. mp4 → wav 변환 (모노, 16kHz) ===
(
    ffmpeg
    .input(input_path)
    .output(audio_path, ac=1, ar=16000)
    .overwrite_output()
    .run(quiet=True)
)

# === 3. 오디오 불러오기 ===
wav, sr = torchaudio.load(audio_path)

# === 4. Silero VAD 로드 ===
model, utils = torch.hub.load(
    repo_or_dir='snakers4/silero-vad',
    model='silero_vad',
    force_reload=False,
    trust_repo=True
)
get_speech_timestamps, save_audio, read_audio, VADIterator, collect_chunks = utils

# === 5. 발화 구간 탐지 ===
speech_timestamps = get_speech_timestamps(wav[0], model, sampling_rate=sr)

# === 6. Whisper 로드 ===
model_whisper = whisper.load_model("base")

# === 7. 발화 + 무음 구간 계산 및 출력 ===
print("===== 발화 및 무음 구간 탐지 결과 =====")

prev_end = 0
for i, seg in enumerate(speech_timestamps):
    start = seg["start"] / sr
    end = seg["end"] / sr

    # (1) 무음 구간 출력
    if start - prev_end > 0.5:  # 0.5초 이상 조용하면 무음으로 간주
        print(f"[SILENCE] {prev_end:.2f}s ~ {start:.2f}s ({start - prev_end:.2f}s)")

    # (2) 해당 발화 구간 잘라 Whisper로 인식
    clip = wav[:, seg["start"]:seg["end"]]
    temp_path = f"temp_{i}.wav"
    torchaudio.save(temp_path, clip, sr)

    result = model_whisper.transcribe(temp_path, language="en")  # 영어라면 en, 한국어면 ko
    text = result["text"].strip()

    print(f"[SPEECH]  {start:.2f}s ~ {end:.2f}s ({end - start:.2f}s) | {text}")

    prev_end = end

print("\n=== 완료 ===")

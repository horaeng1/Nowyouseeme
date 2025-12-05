import io
import json
import time
from google import genai
from google.genai import types
from google.genai.errors import ServerError



# ==============================================================================
# Config
# ==============================================================================
VIDEO_PATH = "./sample_video/data.mp4"
GEMINI_MODEL_VISION = "gemini-3-pro-preview"
GEMINI_MODEL_TEXT = "gemini-3-pro-preview"
use_gemini_for_final = True  # 최종 후보정에 Gemini 사용 여부


# -------------------------------------------------------
# Gemini Client 생성
# -------------------------------------------------------
client_gemini = genai.Client(api_key=API_KEY_GEMINI)

# -------------------------------------------------------
# Gemini 호출 기본 Config
# -------------------------------------------------------
BASE_CONFIG = {
    "temperature": 0,
    "system_instruction": "이전 api 사용으로 인한 대화 절대 참조 금지",
    "top_k": 1,
    "top_p": 0.1,  # 결정적 출력
    "thinking_config": {"thinking_budget": 8192},  # 사고 모드 OFF (low : 1024 / middle : 8192 / high : 24,576) 기본값 : 1024 ~ 8192 사이 값으로 할당
    # 사고 모드가 높을 수록 깔끔하게 출력되지만, 출력이 짤릴 수 있음. 낮으면 반대.
}

# -------------------------------------------------------
# Gemini 호출 재시도 Wrapper (사고 모드 OFF)
# -------------------------------------------------------
def gemini_run_retry(contents, model, retries=3, delay=5, temp=0):
    config = BASE_CONFIG.copy()
    config["temperature"] = temp


    for attempt in range(retries):
        try:
            response = client_gemini.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return response.text
        except ServerError as e:
            print(f"Gemini ServerError: {e} → Retry {attempt+1}/{retries}")
            time.sleep(delay)
    raise Exception("Gemini request failed after retries.")



# -------------------------------------------------------
# File Upload + ACTIVE 상태 대기
# -------------------------------------------------------
def wait_for_file_active(file_obj, timeout=120, interval=3):
    start = time.time()
    while time.time() - start < timeout:
        f = client_gemini.files.get(name=file_obj.name)
        if f.state == "ACTIVE":
            return f
        print(f"Waiting for ACTIVE: {file_obj.name} ...")
        time.sleep(interval)
    raise TimeoutError("File did not become ACTIVE in time.")

print("\n📌 Uploading Video...")
with open(VIDEO_PATH, "rb") as f:
    uploaded = client_gemini.files.upload(
        file=f,
        config={"mime_type": "video/mp4", "display_name": VIDEO_PATH}
    )

uploaded = wait_for_file_active(uploaded)
video_ref = types.Part(
    file_data=types.FileData(file_uri=uploaded.uri, mime_type="video/mp4")
)

# -------------------------------------------------------
# Core Prompt 정의 (metadata + core AD)
# -------------------------------------------------------
PROMPT_METADATA = """
You are a video story analyst.

Goal:
Extract visually verifiable core metadata from the video and output it
as JSON to support high-quality Audio Description production.

Rules:
- Character names must be included only when they are visually identifiable.
- If a name cannot be determined from the video, use generic labels such as "speaker".
- Only use the title if it is explicitly shown; no assumptions.
- Do NOT generate any information that cannot be visually confirmed.
- Emotional or internal state descriptions are allowed only when there is a clear visual basis (e.g., facial expression).
- Output must be ONLY JSON — no additional text, comments, or explanation.

Output format (strictly unchanged):
{
  "video_title": "Include only if visibly confirmed, otherwise "null"",
  "overall_summary": "Concise visual summary of the entire video",
  "scenes": [
    {
      "scene_id": "Scene-1",
      "start_time": "0:00.0",
      "end_time": "0:05.8",
      "summary": "Summary of visually essential story information",
      "characters": [
        {
          "id": "char_1",
          "name": "Visually confirmed name (null if unknown)",
          "appearance": "Visible physical features",
          "visible_emotion": "Emotion based on clear facial expression only"
        }
      ],
      "visible_actions": [
        "Major clearly visible actions"
      ],
      "relationships": [
        "Only relationships with clear visual evidence"
      ],
      "visual_focus": "Primary visual focus of the scene"
    }
  ]
}
"""



PROMPT_AD = """
Your primary objective is to accurately detect all silent segments in the video
based on audio analysis, excluding any portion containing dialogue or speech.

[RULES]

Silent Segment Detection
1) Exclude any segment containing speech, narration, or human vocal sounds
2) Detect every silent segment lasting at least 2.5 seconds and include them in a JSON array
3) Segments shorter than 2.5 seconds may be merged only if they naturally connect with adjacent silent regions
4) Do not select, shorten, or omit any valid silent segment
5) Do not modify or invent start/end times

Timestamps
6) Use the exact start_time and end_time of each silent segment
7) duration_sec must be calculated precisely as end_time - start_time
8) Timestamps must follow chronological order without overlap or missing time

Audio Description Creation
9) Describe only the essential on-screen visual information occurring during silence
10) Metadata (characters, setting, context) may be used only if visually verified
11) If multiple visual changes occur, avoid squeezing them into a single sentence — prioritize clarity
12) No emotional or internal state assumptions (only describe visible facial expressions or actions)
13) Ensure the description length is readable within the segment duration
14) Never invent details not seen on screen

Information Use
15) Spoken content before/after the silent segment may be referenced only to enhance clarity,
    but do not introduce new events or characters not visually confirmed
16) Actively include visible changes such as camera movement (zoom, panning),
    gestures, facial expressions, and interaction with objects

Output Format
17) Output must be strictly JSON — no explanations, comments, or headers
18) "audio_descriptions" must be an array containing multiple items (not length 1)

[OUTPUT JSON SAMPLE]
"audio_descriptions": [
  {
    "start_time": "0:03.5",
    "end_time": "0:06.1",
    "duration_sec": 2.6,
    "description": "A character lifts a coffee mug and quietly takes a sip."
  }
]
"""


# -------------------------------------------------------
# 1️⃣ Metadata 생성
# -------------------------------------------------------
print("\n=== Metadata Step ===")
contents_meta = [types.Part(text=PROMPT_METADATA), video_ref]
metadata_result = gemini_run_retry(contents_meta, GEMINI_MODEL_VISION)
print(metadata_result)

# -------------------------------------------------------
# 2️⃣ Core AD 생성 (temp=0, 단일)
# -------------------------------------------------------
print("\n=== Core AD Step ===")
contents_ad = [types.Part(text=PROMPT_AD), video_ref]
core_ad = gemini_run_retry(contents_ad, GEMINI_MODEL_VISION)
print(core_ad)

# -------------------------------------------------------
# 3️⃣ STT (대사) 추출용 Prompt
# -------------------------------------------------------
PROMPT_STT = """
**MISSION:**
Analyze the given video and extract all spoken dialogue and relevant sound events.
Record them in JSON format.
Include silent segments longer than 2.5 seconds as well.
Output must be JSON only.

Example:
{
  "full_transcript": [
    {"time": "0:01.2", "speaker": "Speaker 1", "text": "Dialogue content"},
    {"time": "0:06.6", "speaker": "[Sound]", "text": "Car door closing"}
  ]
}
"""


print("\n=== STT Step ===")
contents_stt = [types.Part(text=PROMPT_STT), video_ref]
stt_result = gemini_run_retry(contents_stt, GEMINI_MODEL_TEXT)
print(stt_result)

# -------------------------------------------------------
# 4️⃣ Final Integration Prompt
# -------------------------------------------------------
FINAL_PROMPT = f"""
INPUT:
1) Video Metadata — scene elements, characters, objects, visual focus, changes
2) Core AD — existing Audio Description for silent segments
3) STT Result — transcript of spoken lines and significant sounds

OBJECTIVE:
- Generate FINAL Audio Description JSON by integrating Core AD, Metadata, and STT
- Describe visual details during silent segments (actions, props, expressions, camera motion)
- Use Metadata to enrich context and recover missing elements
- Use STT dialogue only for context; ignore short meaningless exclamations or non-informative sounds
- Remove redundancy, write readable sentences fitting within duration_sec
- Maintain exact start_time, end_time, duration_sec
- Screen-visible info only, no guesses
- Output strictly JSON

RULES:
1) Include details missing in Core AD if visible in Metadata or visual focus
2) Reference STT silent sections to complement Core AD
3) Merge repeated content, keep essentials
4) No inferred emotions or inner thoughts
5) Generate descriptions **only for segments without spoken dialogue ≥2.5 seconds**
6) Treat meaningless exclamations or non-informative sounds as silence

OUTPUT EXAMPLE:
"audio_descriptions": [
  {{
    "start_time": "0:03.5",
    "end_time": "0:06.1",
    "duration_sec": 2.6,
    "description": "A person lifts a coffee cup and takes a sip."
  }}
]

[VIDEO METADATA]
{metadata_result}

[CORE AD]
{core_ad}

[STT RESULT]
{stt_result}
"""



print("\n=== Final AD Result ===")
if use_gemini_for_final:
    final_response_text = gemini_run_retry([types.Part(text=FINAL_PROMPT)], GEMINI_MODEL_TEXT)
else:
    client_gpt = OpenAI(api_key=API_KEY_GPT)
    final_res = client_gpt.chat.completions.create(
        model=GPT_MODEL_TEXT,
        messages=[{"role": "user", "content": FINAL_PROMPT}],
        temperature=0
    )
    final_response_text = final_res.choices[0].message.content

print(final_response_text)



# ------------------------
# Stage 2: Duration-based compression (TTS time-based)
# ------------------------
import re

def extract_json_from_text(text: str):
    """
    기본 가정: final_response_text가 순수 JSON 형태일 때는 바로 반환.
    혹시 앞뒤에 설명/코드블록/마크다운이 붙어있으면 중괄호로 감싼 첫 JSON 블록을 추출.
    """
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        return text
    match = re.search(r'\{[\s\S]*\}', text)
    if not match:
        raise ValueError("Valid JSON structure not found in final response text.")
    return match.group(0)

def stage2_compress_description(ad_segments, chars_per_sec=7.0):
    compressed = []

    for seg in ad_segments:
        # Safe extraction of description and duration
        description = seg.get("description", "")
        duration_sec = seg.get("duration_sec", 0)

        current_chars = len(description)
        # Ensure at least 1 character allowed to avoid zero
        max_chars = max(1, int(duration_sec * chars_per_sec))

        if current_chars > max_chars:
            prompt = f"""
You are an expert in Audio Description.
Respond only in English.

Compress the following description to fit within the given time.
Required conditions:
- Third-person objective narration
- Must be a complete sentence ending with a period (.)
- Must not exceed the allowed character count
- Keep only the essential visual information
- Do not include unseen thoughts or assumptions
- Output exactly one sentence, nothing else

Original description: "{description}"
Restriction:
- Allowed character count: {max_chars} characters
"""

            # Call Gemini for compression
            comp = gemini_run_retry(
                contents=[types.Part(text=prompt)],
                model=GEMINI_MODEL_TEXT,
                temp=0.2
            )

            # Fallback if Gemini fails
            if not comp or not isinstance(comp, str):
                comp = description
            else:
                # Only take the first line in case of multiline response
                comp = comp.strip().splitlines()[0].strip()

            final_chars = len(comp)

            compressed.append({
                "start_time": seg.get("start_time"),
                "end_time": seg.get("end_time"),
                "duration_sec": duration_sec,
                "description": comp,
                "exceeds_limit": True,
                "allowed_chars": max_chars,
                "current_chars_before": current_chars,
                "current_chars_after": final_chars,
                "compressed_by_chars": True
            })

        else:
            compressed.append({
                **seg,
                "exceeds_limit": False,
                "allowed_chars": max_chars,
                "current_chars_before": current_chars,
                "current_chars_after": current_chars,
                "compressed_by_chars": False
            })

    return compressed


# 🔹 Stage2 실행
try:
    # 안전하게 JSON 문자열 확보
    json_str = extract_json_from_text(final_response_text)

    # 파싱
    final_json = json.loads(json_str)

    # audio_descriptions 추출 (없으면 빈 리스트)
    ad_segments = final_json.get("audio_descriptions", [])

    # Stage2 압축 적용
    stage2_result = stage2_compress_description(ad_segments, chars_per_sec=15.0)
    final_json["audio_descriptions"] = stage2_result

    print("\n=== Final Compressed Output ===")
    print(json.dumps(final_json, ensure_ascii=False, indent=2))

except Exception as e:
    print(f"[Stage2 Error] {e}")

# -------------------------------------------------------
# 5️⃣ Gemini 파일 삭제 함수 (옵션)
# -------------------------------------------------------
async def delete_all_gemini_files():
    try:
        files = await run_async(client_gemini.files.list)
        if not files:
            print("[DEBUG] No files on Gemini server to delete.")
            return
        for f in files:
            try:
                await run_async(client_gemini.files.delete, name=f.name)
                print(f"[DEBUG] Deleted file: {f.name}")
            except Exception as e:
                print(f"[WARN] Failed to delete file {f.name}: {e}")
        print("[DEBUG] All deletable Gemini server files have been removed.")
    except Exception as e:
        print(f"[ERROR] Failed to list or delete files: {e}")

# 🔹 삭제 실행
# await delete_all_gemini_files()  # 필요 시 호출

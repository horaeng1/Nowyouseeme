import io
import json
import time
import re
from google import genai
from google.genai import types
from google.genai.errors import ServerError

# OpenAI는 선택적 의존성으로, 설치되어 있을 때만 import


VIDEO_PATH = "./sample_video/korean_data.mp4"
GEMINI_MODEL_VISION = "gemini-3-pro-preview"
GEMINI_MODEL_TEXT = "gemini-3-pro-preview"
use_gemini_for_final = True  # 최종 후보정에 Gemini 사용 여부

API_KEY_GEMINI = api_key

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
    "top_p": 0.00001,  # 결정적 출력
    "thinking_config": {"thinking_budget": 8192},
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
당신은 영상 스토리 분석가입니다.

목표:
영상에서 시각적으로 확인 가능한 핵심 메타데이터를 추출하여,
고품질 Audio Description 제작 참고용 JSON으로 출력하십시오.

규칙:
- 등장인물 이름은 화면에서 식별 가능한 경우에만 기입.
- 이름을 알 수 없으면 "화자" 등 일반 명칭 사용.
- 제목은 제공된 경우만 참고, 추측 금지.
- 영상에서 확인 불가한 정보 절대 생성 금지.
- 감정·내면 묘사는 시각적 근거가 명확할 때만 제한적으로 허용.
- JSON 외 텍스트, 주석, 설명 출력 금지.

출력 형식(변경 불가):
{
  "video_title": "제공된 경우에만 기입, 없으면 "null"",
  "overall_summary": "영상 전체 흐름을 시각 기반으로 간결하게 설명",
  "scenes": [
    {
      "scene_id": "Scene-1",
      "start_time": "0:00.0",
      "end_time": "0:05.8",
      "summary": "스토리 이해에 필요한 시각 정보 요약",
      "characters": [
        {
          "id": "char_1",
          "name": "화면에서 식별된 이름(불가 시 "null")",
          "appearance": "외형 정보",
          "visible_emotion": "표정 기반 감정(명확 시만)"
        }
      ],
      "visible_actions": [
        "확실히 보이는 주요 행동"
      ],
      "relationships": [
        "시각 근거 있는 관계만"
      ],
      "visual_focus": "장면에서 시각적 중심 요소"
    }
  ]
}
"""

PROMPT_AD = """
당신의 최우선 임무는 영상의 오디오 분석을 기반으로,
대사가 포함되지 않은 모든 무음 구간을 정확히 탐지하는 것입니다.

[규칙]

무음 구간 탐지
1) 오디오 신호 분석을 기준으로 대사·내레이션·말소리 포함 구간은 제외
2) 2.5초 이상 지속된 무음 구간은 반드시 모두 탐지하여 JSON 배열에 포함
3) 2.5초 미만 구간은 인접 구간과 자연스럽게 연결될 경우에만 병합 가능
4) 무음 구간을 하나만 선택하거나 임의로 축소 또는 생략 금지
5) 무음 구간의 시작/끝 시각을 임의로 조정하거나 생성 금지

타임스탬프
6) start_time, end_time을 실제 무음 시작과 끝으로 정확하게 기입
7) duration_sec = end_time - start_time을 반드시 정확하게 계산하여 기입
8) 타임스탬프의 순서가 실제 영상 진행과 동일해야 하며, 겹치거나 누락된 시간 존재 금지

음성해설(Description) 작성
9) 무음 구간 동안 화면에서 직접 확인 가능한 핵심 시각정보를 상세하게 묘사
10) 메타데이터(등장인물, 배경, 상황)는 화면으로 검증되는 경우에만 활용
11) 장면 내 변화가 있으면 한 문장에 압축하지 말고 핵심 요소 우선 배치
12) 감정·내면 묘사 금지 (표정, 행동 등 시각적 근거가 있을 경우만 제한적으로 허용)
13) duration 내에서 자연스럽게 읽을 수 있는 분량으로 작성
14) 화면에 없는 정보 창작 금지

정보 활용 범위
15) 주변 대화 전후 맥락을 참고해 장면의 이해도를 높일 수 있으나
    새로운 사건, 인물 정보는 추가 금지
16) 카메라 움직임(줌, 패닝), 소품 사용, 몸짓·행동·표정 등
    시각적 변화는 적극적으로 기술

출력 형식
17) JSON 외 다른 텍스트, 주석, 헤더 절대 금지
18) audio_descriptions 항목은 반드시 배열 형태로 제공 (길이 1 금지)

[출력 JSON 샘플]
"audio_descriptions": [
  {
    "start_time": "0:03.5",
    "end_time": "0:06.1",
    "duration_sec": 2.6,
    "description": "인물이 커피잔을 들어 입에 가져가고 조용히 한 모금 마신다."
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
**미션(MISSION):**
입력 비디오를 분석하여 영상 내 모든 음성 대사와 사운드를 JSON으로 기록하시오.
무음 구간(2.5초 이상)과 함께 Audio Description을 생성.
JSON 형식만 출력.

예시:
{
  "full_transcript": [
    {"time": "0:01.2", "speaker": "화자1", "text": "대사 내용"},
    {"time": "0:06.6", "speaker": "[Sound]", "text": "차 문 닫히는 소리"}
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
입력:
1) 영상 메타데이터 — 장면 요소, 등장인물, 소품, 시각적 포커스, 변화 정보
2) 기존 Audio Description — 무음 구간 중심
3) STT 결과 — 발화 및 주요 소리 전체 기록

목표:
- Core AD, 메타데이터, STT 정보를 종합하여 최종 Audio Description JSON 생성
- 무음 구간 동안 화면에서 확인 가능한 시각적 세부 정보 묘사 (행동, 소품, 표정, 카메라 움직임 등)
- 메타데이터 활용해 맥락 풍부화 및 누락 요소 보완
- STT 발화는 맥락 참고용으로만 활용, 짧은 의미 없는 감탄사나 효과음 무시
- 중복 제거, duration_sec 내 자연스럽게 읽히도록 문장 작성
- start_time, end_time, duration_sec 정확히 유지
- 화면에서 확인 가능한 정보만 사용, 추측 금지
- 출력은 반드시 JSON만

규칙:
1) Core AD에서 누락된 요소는 메타데이터/시각 포커스에서 확인 가능하면 반드시 포함
2) STT 무음 구간을 참조해 Core AD 보완
3) 반복 내용 통합, 핵심 정보만 유지
4) 추정 감정이나 내면 묘사 금지
5) **발화가 없는 구간 ≥2.5초에 대해서만 description 생성**
6) 의미 없는 감탄사나 비정보성 효과음은 무음으로 간주

출력 예시:
"audio_descriptions": [
  {{
    "start_time": "0:03.5",
    "end_time": "0:06.1",
    "duration_sec": 2.6,
    "description": "한 사람이 커피잔을 들어 한 모금 마신다."
  }}
]

[영상 메타데이터]
{metadata_result}

[기존 AD]
{core_ad}

[STT 결과]
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


# -------------------------------------------------------
# 6️⃣ Stage2: Duration 기반 압축 / 문자 수 정제
# -------------------------------------------------------

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
        current_chars = len(seg.get("description", ""))
        # 최소 허용 글자 수는 1로 보장
        max_chars = max(1, int(seg.get("duration_sec", 0) * chars_per_sec))

        if current_chars > max_chars:
            description = seg["description"]

            prompt = f"""
당신은 한국어 Audio Description 전문가입니다.

아래 설명을 주어진 시간 안에 맞게 압축하세요.
필수 조건:
- 3인칭 객관적 서술
- 완전한 문장 형태 ("~다.")
- 허용된 글자 수를 반드시 초과하지 않는다
- 핵심적인 시각 정보만 유지한다
- 보이지 않는 생각, 추측은 포함하지 않는다
- 한 문장만 출력한다
- 출력은 오직 최종 문장만!

원본 설명: "{description}"

제한 정보:
- 허용 글자 수: {max_chars}자
"""

            # Gemini 호출로 압축 요청 (결정적 출력을 위해 temp 낮게 설정)
            comp = gemini_run_retry(
                contents=[types.Part(text=prompt)],
                model=GEMINI_MODEL_TEXT,
                temp=0.2
            )

            # 만약 Gemini가 설명을 섞어 반환한 경우, JSON처럼 보이는 부분만 취하거나 원문 유지
            if not comp or not isinstance(comp, str):
                comp = description
            else:
                # 응답이 여러 줄이라면 첫 줄(최종 문장)만 취하는 안전장치
                comp = comp.strip().splitlines()[0].strip()

            final_chars = len(comp)

            compressed.append({
                "start_time": seg.get("start_time"),
                "end_time": seg.get("end_time"),
                "duration_sec": seg.get("duration_sec"),
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
    stage2_result = stage2_compress_description(ad_segments)
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
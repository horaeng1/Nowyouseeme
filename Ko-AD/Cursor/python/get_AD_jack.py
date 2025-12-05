"""
Jack AD Generation Module
=========================
High-quality Audio Description generation using Gemini 3 Pro Preview.

Pipeline:
1. Metadata extraction (scene analysis)
2. Core AD generation (silent segment detection + description)
3. STT extraction (dialogue transcription)
4. Final Integration (combine all three)
5. Stage2 compression (TTS duration-based)

Based on: jack_ad_en.py, jack_ad_ko.py (2024-12)
Model: Gemini 3 Pro Preview (gemini-3-pro-preview)
"""

import logging
import os
import json
import re
import asyncio
import time
import argparse
from typing import List, Dict, Any, Tuple
from concurrent.futures import ThreadPoolExecutor

try:
    from google import genai
    from google.genai import types
    from google.genai.errors import ServerError
except ImportError as e:
    try:
        import google.generativeai as genai
        import google.generativeai.types as types
        ServerError = Exception  # Fallback
    except ImportError:
        raise ImportError(
            "google-genai package is not installed. "
            "Please install it with: pip install google-genai"
        ) from e


logger = logging.getLogger(__name__)

# ==============================================================================
# Configuration
# ==============================================================================
GEMINI_MODEL_VISION = "gemini-3-pro-preview"
GEMINI_MODEL_TEXT = "gemini-3-pro-preview"

# Thread pool for async operations
executor = ThreadPoolExecutor(max_workers=4)

# ==============================================================================
# Prompts - Korean (synced with jack_ad_ko.py)
# ==============================================================================
PROMPT_METADATA_KO = """
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
  "video_title": "제공된 경우에만 기입, 없으면 null",
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
          "name": "화면에서 식별된 이름(불가 시 null)",
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

PROMPT_AD_KO = """
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

PROMPT_STT_KO = """
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

FINAL_PROMPT_KO = """
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
{metadata}

[기존 AD]
{core_ad}

[STT 결과]
{stt_result}
"""

COMPRESS_PROMPT_KO = """
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

# ==============================================================================
# Prompts - English (synced with jack_ad_en.py)
# ==============================================================================
PROMPT_METADATA_EN = """
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
  "video_title": "Include only if visibly confirmed, otherwise null",
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

PROMPT_AD_EN = """
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

PROMPT_STT_EN = """
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

FINAL_PROMPT_EN = """
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
{metadata}

[CORE AD]
{core_ad}

[STT RESULT]
{stt_result}
"""

COMPRESS_PROMPT_EN = """
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


# ==============================================================================
# Async Helpers
# ==============================================================================
def get_gemini_client():
    """Get Gemini client with API key from environment."""
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_API_KEY environment variable is required")
    return genai.Client(api_key=api_key)


async def run_async(func, *args, **kwargs):
    """Run a synchronous function in thread pool."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        executor, lambda: func(*args, **kwargs)
    )


async def gemini_call(client, contents, model, temp=0, retries=3, delay=5):
    """Call Gemini API with retries.
    
    Config synced with jack_ad_ko.py:
    - temperature: 0 (default)
    - top_k: 1
    - top_p: 0.00001 (결정적 출력)
    - thinking_config: {"thinking_budget": 8192}
    - system_instruction: "이전 api 사용으로 인한 대화 절대 참조 금지"
    """
    for attempt in range(retries):
        try:
            # Build config synced with jack_ad_ko.py BASE_CONFIG
            config_kwargs = {
                "temperature": temp,
                "system_instruction": "이전 api 사용으로 인한 대화 절대 참조 금지",
                "top_k": 1,
                "top_p": 0.00001,  # Deterministic output
                "thinking_config": {"thinking_budget": 8192},
            }
            
            response = await run_async(
                client.models.generate_content,
                model=model,
                contents=contents,
                config=config_kwargs,
            )
            
            if response is None:
                raise ValueError("Gemini returned None response object")
            
            response_text = response.text
            if response_text is None or not response_text.strip():
                raise ValueError("Gemini returned empty response")
            
            return response_text
            
        except (ServerError, Exception) as e:
            error_msg = str(e)
            if attempt < retries - 1:
                logger.warning(f"[Jack] Gemini retry {attempt+1}/{retries}: {error_msg}")
                await asyncio.sleep(delay)
            else:
                raise Exception(f"Gemini failed after {retries} retries: {error_msg}")


async def wait_for_file_active(client, file_obj, timeout=120, interval=3):
    """Wait for uploaded file to become active."""
    start = time.time()
    while time.time() - start < timeout:
        f = await run_async(client.files.get, name=file_obj.name)
        if f.state == "ACTIVE":
            logger.info(f"[Jack] File {file_obj.name} is now ACTIVE")
            return f
        logger.info(f"[Jack] Waiting for file to become ACTIVE: {file_obj.name}")
        await asyncio.sleep(interval)
    raise TimeoutError(f"File {file_obj.name} did not become ACTIVE within {timeout}s")


# ==============================================================================
# JSON Extraction
# ==============================================================================
def extract_json_from_response(text: str) -> Dict:
    """Extract JSON from API response text."""
    if not text:
        raise ValueError("Empty response text")
    
    text = text.strip()
    
    # If already pure JSON
    if text.startswith("{") and text.endswith("}"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass
    
    # Remove markdown code fences
    fence_match = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence_match:
        candidate = fence_match.group(1).strip()
    else:
        candidate = text
    
    # Find JSON object
    match = re.search(r'\{[\s\S]*\}', candidate)
    if match:
        json_str = match.group(0)
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning(f"[Jack] JSON parse error: {e}")
            # Try to repair
            json_str = repair_json(json_str)
            return json.loads(json_str)
    
    raise ValueError("No JSON object found in response")


def repair_json(json_str: str) -> str:
    """Attempt to repair truncated or malformed JSON."""
    brace_count = json_str.count('{') - json_str.count('}')
    bracket_count = json_str.count('[') - json_str.count(']')
    
    json_str = re.sub(r',\s*$', '', json_str.rstrip())
    json_str += ']' * bracket_count
    json_str += '}' * brace_count
    
    return json_str


# ==============================================================================
# Stage2: Duration-based compression (TTS time-based)
# ==============================================================================
async def stage2_compress_description_async(
    client,
    ad_segments: List[Dict],
    lang: str = "ko",
    chars_per_sec: float = None
) -> List[Dict]:
    """
    Stage2: Compress descriptions to fit within TTS duration.
    
    Args:
        client: Gemini client
        ad_segments: List of AD segments with description, duration_sec
        lang: Language ('ko' or 'en')
        chars_per_sec: Characters per second rate (default: 7.0 for ko, 15.0 for en)
    
    Returns:
        List of compressed AD segments with metadata
    """
    if chars_per_sec is None:
        chars_per_sec = 7.0 if lang == "ko" else 15.0
    
    compress_prompt_template = COMPRESS_PROMPT_KO if lang == "ko" else COMPRESS_PROMPT_EN
    compressed = []
    
    for seg in ad_segments:
        description = seg.get("description", "")
        duration_sec = seg.get("duration_sec", 0)
        
        current_chars = len(description)
        max_chars = max(1, int(duration_sec * chars_per_sec))
        
        if current_chars > max_chars and description:
            # Need compression
            prompt = compress_prompt_template.format(
                description=description,
                max_chars=max_chars
            )
            
            try:
                comp = await gemini_call(
                    client,
                    [types.Part(text=prompt)],
                    GEMINI_MODEL_TEXT,
                    temp=0.2
                )
                
                if comp and isinstance(comp, str):
                    comp = comp.strip().splitlines()[0].strip()
                else:
                    comp = description
                    
            except Exception as e:
                logger.warning(f"[Jack] Stage2 compression failed: {e}")
                comp = description
            
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


def stage2_compress_description_sync(
    ad_segments: List[Dict],
    lang: str = "ko",
    chars_per_sec: float = None
) -> List[Dict]:
    """
    Synchronous version of Stage2 compression (without Gemini calls).
    Fallback when async compression is not desired.
    """
    if chars_per_sec is None:
        chars_per_sec = 7.0 if lang == "ko" else 15.0
    
    compressed = []
    
    for seg in ad_segments:
        description = seg.get("description", "")
        duration_sec = seg.get("duration_sec", 0)
        
        current_chars = len(description)
        max_chars = max(1, int(duration_sec * chars_per_sec))
        
        compressed.append({
            **seg,
            "exceeds_limit": current_chars > max_chars,
            "allowed_chars": max_chars,
            "current_chars_before": current_chars,
            "current_chars_after": current_chars,
            "compressed_by_chars": False
        })
    
    return compressed


# ==============================================================================
# Main Processing
# ==============================================================================
async def process_video_async(video_path: str, lang: str = "ko") -> Tuple[Dict, List[Dict]]:
    """
    Process video with Jack AD pipeline.
    
    Pipeline:
    1. Upload video to Gemini
    2. Metadata extraction (temp=0)
    3. Core AD generation (temp=0)
    4. STT extraction (temp=0)
    5. Final Integration (temp=0)
    6. Stage2 compression
    
    Args:
        video_path: Path to video file
        lang: Language for output ('ko' or 'en')
    
    Returns:
        Tuple of (full_data, segments_list)
    """
    logger.info(f"[Jack] Starting AD generation for: {video_path}")
    logger.info(f"[Jack] Language: {lang}")
    
    client = get_gemini_client()
    
    # Select prompts based on language
    if lang == "ko":
        prompt_metadata = PROMPT_METADATA_KO
        prompt_ad = PROMPT_AD_KO
        prompt_stt = PROMPT_STT_KO
        final_prompt_template = FINAL_PROMPT_KO
    else:
        prompt_metadata = PROMPT_METADATA_EN
        prompt_ad = PROMPT_AD_EN
        prompt_stt = PROMPT_STT_EN
        final_prompt_template = FINAL_PROMPT_EN
    
    # =========================================================================
    # Step 1: Upload video
    # =========================================================================
    logger.info("[Jack] 📌 Uploading video to Gemini...")
    with open(video_path, "rb") as f:
        uploaded = await run_async(
            client.files.upload,
            file=f,
            config={"mime_type": "video/mp4", "display_name": os.path.basename(video_path)},
        )
    
    uploaded = await wait_for_file_active(client, uploaded)
    video_ref = types.Part(
        file_data=types.FileData(file_uri=uploaded.uri, mime_type="video/mp4")
    )
    
    # =========================================================================
    # Step 2: Metadata extraction
    # =========================================================================
    logger.info("[Jack] === Metadata Step ===")
    contents_meta = [types.Part(text=prompt_metadata), video_ref]
    metadata_result = await gemini_call(client, contents_meta, GEMINI_MODEL_VISION, temp=0)
    logger.info(f"[Jack] Metadata length: {len(metadata_result)} chars")
    
    # =========================================================================
    # Step 3: Core AD generation
    # =========================================================================
    logger.info("[Jack] === Core AD Step ===")
    contents_ad = [types.Part(text=prompt_ad), video_ref]
    core_ad = await gemini_call(client, contents_ad, GEMINI_MODEL_VISION, temp=0)
    logger.info(f"[Jack] Core AD length: {len(core_ad)} chars")
    
    # =========================================================================
    # Step 4: STT extraction
    # =========================================================================
    logger.info("[Jack] === STT Step ===")
    contents_stt = [types.Part(text=prompt_stt), video_ref]
    stt_result = await gemini_call(client, contents_stt, GEMINI_MODEL_TEXT, temp=0)
    logger.info(f"[Jack] STT length: {len(stt_result)} chars")
    
    # =========================================================================
    # Step 5: Final Integration
    # =========================================================================
    logger.info("[Jack] === Final Integration Step ===")
    final_prompt = final_prompt_template.format(
        metadata=metadata_result,
        core_ad=core_ad,
        stt_result=stt_result,
    )
    
    final_response = await gemini_call(
        client,
        [types.Part(text=final_prompt)],
        GEMINI_MODEL_TEXT,
        temp=0
    )
    logger.info(f"[Jack] Final response length: {len(final_response)} chars")
    
    # Parse final result
    try:
        final_data = extract_json_from_response(final_response)
    except Exception as e:
        logger.error(f"[Jack] Failed to parse final response: {e}")
        logger.warning("[Jack] Falling back to core AD result")
        final_data = extract_json_from_response(core_ad)
    
    # Extract segments
    segments = final_data.get("audio_descriptions", [])
    if not segments and isinstance(final_data, list):
        segments = final_data
    
    # =========================================================================
    # Step 6: Stage2 compression
    # =========================================================================
    logger.info(f"[Jack] === Stage2 Compression (lang={lang}) ===")
    try:
        chars_per_sec = 7.0 if lang == "ko" else 15.0
        segments = await stage2_compress_description_async(
            client, segments, lang=lang, chars_per_sec=chars_per_sec
        )
        
        compressed_count = sum(1 for s in segments if s.get("compressed_by_chars", False))
        logger.info(f"[Jack] Stage2 completed: {compressed_count}/{len(segments)} segments compressed")
        
    except Exception as e:
        logger.warning(f"[Jack] Stage2 compression failed, using original: {e}")
        segments = stage2_compress_description_sync(segments, lang=lang)
    
    # =========================================================================
    # Format output
    # =========================================================================
    def parse_time_string(time_str) -> float:
        """Parse time string like '0:04.0' or '1:30.5' to seconds."""
        try:
            if isinstance(time_str, (int, float)):
                return float(time_str)
            if not time_str:
                return 0.0
            time_str = str(time_str).strip()
            parts = time_str.split(':')
            if len(parts) == 2:
                return float(parts[0]) * 60 + float(parts[1])
            if len(parts) == 3:
                return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
            return float(time_str)
        except (ValueError, AttributeError):
            return 0.0
    
    formatted_segments = []
    for idx, seg in enumerate(segments, start=1):
        start_time = seg.get("start_time") or seg.get("start") or "0:00.0"
        end_time = seg.get("end_time") or seg.get("end") or "0:00.0"
        
        formatted_seg = {
            "id": idx,
            "start": parse_time_string(start_time),
            "end": parse_time_string(end_time),
            "text": seg.get("description") or seg.get("text") or "",
        }
        
        # Include compression metadata if available
        if seg.get("compressed_by_chars"):
            formatted_seg["_compression"] = {
                "exceeds_limit": seg.get("exceeds_limit", False),
                "allowed_chars": seg.get("allowed_chars"),
                "chars_before": seg.get("current_chars_before"),
                "chars_after": seg.get("current_chars_after"),
            }
        
        formatted_segments.append(formatted_seg)
    
    logger.info(f"[Jack] Generated {len(formatted_segments)} AD segments")
    
    # Cleanup uploaded file
    try:
        await run_async(client.files.delete, name=uploaded.name)
        logger.info(f"[Jack] Cleaned up uploaded file: {uploaded.name}")
    except Exception as e:
        logger.warning(f"[Jack] Failed to cleanup file: {e}")
    
    return {"audio_descriptions": formatted_segments}, formatted_segments


def generate_ad_for_video(video_path: str, lang: str = "ko") -> Tuple[Dict, List[Dict]]:
    """
    Synchronous wrapper for async processing.
    
    Args:
        video_path: Path to video file
        lang: Language for output ('ko' or 'en')
    
    Returns:
        Tuple of (full_data, segments_list)
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    
    if loop and loop.is_running():
        import nest_asyncio
        nest_asyncio.apply()
        return asyncio.run(process_video_async(video_path, lang))
    else:
        return asyncio.run(process_video_async(video_path, lang))


def save_ad_json(video_id: str, data: Any, output_dir: str) -> str:
    """Save AD data to JSON file."""
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f"{video_id}.ad.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    logger.info(f"[Jack] JSON saved to: {output_path}")
    return output_path


# ==============================================================================
# CLI Entry Point
# ==============================================================================
def main():
    """CLI entry point for Jack AD generation."""
    parser = argparse.ArgumentParser(description="Jack AD Generation")
    parser.add_argument("video_path", help="Path to input video file")
    parser.add_argument("--lang", choices=["ko", "en"], default="ko", help="Output language")
    parser.add_argument("--output", help="Output directory for JSON")
    parser.add_argument("--video-id", help="Video ID for output filename")
    
    args = parser.parse_args()
    
    logging.basicConfig(
        level=logging.INFO,
        format="[%(levelname)s] %(message)s"
    )
    
    try:
        full_data, segments = generate_ad_for_video(args.video_path, args.lang)
        
        if args.output and args.video_id:
            save_ad_json(args.video_id, full_data, args.output)
        
        result = {
            "success": True,
            "segments": segments,
            "model": "jack"
        }
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        import traceback
        result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
            "model": "jack"
        }
        print(json.dumps(result, ensure_ascii=False))
        exit(1)


if __name__ == "__main__":
    main()

# eval_metric - Audio Description Evaluation Toolkit

AI 생성 오디오 설명(AD)을 참조 AD와 비교하여 품질을 평가하는 모듈식 툴킷입니다.

## 설치

```bash
# 기본 설치 (BERTScore, METEOR, CIDEr)
pip install bert-score nltk pandas numpy pyyaml tqdm

# LLM 평가 (Gemini)
pip install google-generativeai

# CRITIC 평가 (캐릭터 식별)
pip install fastcoref
```

## 빠른 시작

### CLI 사용

```bash
# BERTScore로 평가 (클러스터 매칭)
python -m eval_metric -g generated.json -r reference.csv -m bertscore

# DP 매칭으로 METEOR 평가
python -m eval_metric -g generated.json -r reference.csv -m meteor --matcher dp

# 여러 메트릭 동시 실행
python -m eval_metric -g generated.json -r reference.csv -m bertscore meteor cider

# 모든 메트릭 실행
python -m eval_metric -g generated.json -r reference.csv --all-metrics

# 설정 파일 사용
python -m eval_metric --config config.yaml
```

### Python API 사용

```python
from eval_metric import load_generated_ad, load_reference_ad, get_matcher
from eval_metric.evaluators import BERTScoreEvaluator

# 데이터 로드
gen_events = load_generated_ad("generated.json")
ref_events = load_reference_ad("reference.csv")

# 매칭
matcher = get_matcher("cluster", min_overlap_sec=0.5)
matched_pairs = matcher.match(gen_events, ref_events)

# 평가
evaluator = BERTScoreEvaluator(model="roberta-large")
result = evaluator.evaluate_batch(matched_pairs)

# 결과 출력
evaluator.print_summary(result)
result.save("output.csv")
```

## 모듈 구조

```
eval_metric/
├── __init__.py          # 패키지 진입점
├── __main__.py          # python -m eval_metric 지원
├── utils.py             # 공통 유틸리티 (로딩, 변환)
├── config.py            # YAML 설정 관리
├── matchers.py          # 매칭 알고리즘
├── cli.py               # CLI 인터페이스
├── default_config.yaml  # 기본 설정 파일
├── README.md            # 이 문서
└── evaluators/
    ├── __init__.py
    ├── base.py          # BaseEvaluator 추상 클래스
    ├── llm_eval.py      # Gemini LLM 평가
    ├── bertscore.py     # BERTScore
    ├── meteor.py        # METEOR
    ├── cider.py         # CIDEr
    └── critic.py        # CRITIC (캐릭터 식별)
```

## 매칭 알고리즘

### 1. Cluster 매칭 (기본, N:M)
시간 오버랩 기반으로 이벤트를 클러스터링합니다. 여러 생성 AD가 여러 참조 AD와 매칭될 수 있습니다.

```bash
python -m eval_metric -g ad.json -r ad.csv --matcher cluster
```

### 2. DP 매칭 (1:1)
Dynamic Programming 기반 시퀀스 정렬. 순서를 보존하며 1:1 매칭을 수행합니다.

```bash
python -m eval_metric -g ad.json -r ad.csv --matcher dp --w-time 0.3 --w-text 0.7
```

### 3. Overlap 매칭 (1:N)
각 생성 AD에 대해 오버랩되는 모든 참조 AD를 찾습니다.

```bash
python -m eval_metric -g ad.json -r ad.csv --matcher overlap
```

## 평가 메트릭

| 메트릭 | 설명 | 범위 | 특징 |
|--------|------|------|------|
| **BERTScore** | BERT 임베딩 기반 의미 유사도 | 0-1 | 의미적 유사성 측정, 패러프레이즈 인식 |
| **METEOR** | 동의어/어간 고려 텍스트 매칭 | 0-1 | 동의어 인식, 어순 고려 |
| **CIDEr** | TF-IDF n-gram 유사도 | 0-10 | 문서 빈도 기반, 희귀 단어 강조 |
| **LLM** | Gemini API 기반 평가 | 0-5 | 시각적 요소 중심 평가 |
| **CRITIC** | 캐릭터 식별 정확도 | 0-1 | 공동참조 해결 기반 |

## 설정 파일 예시

```yaml
# config.yaml
generated_file: generated.json
reference_file: reference.csv

matcher:
  method: cluster
  min_overlap_sec: 0.5

bertscore:
  model: roberta-large
  device: cuda:0

output:
  output_dir: ./results
  save_summary_json: true

evaluators:
  - bertscore
  - meteor
```

## 출력 형식

### CSV 결과
각 매칭된 쌍에 대한 상세 점수:
```
gen_indices,ref_indices,gen_start,gen_end,text_gen,text_ref,score,...
```

### JSON 요약
```json
{
  "metric": "BERTScore",
  "mean_score": 0.8234,
  "median_score": 0.8456,
  "total_pairs": 25,
  "coverage": {...}
}
```

## 환경 변수

```bash
# Gemini API 키 (LLM 평가용)
export GEMINI_API_KEY='your-api-key'
```

## 입력 파일 형식

### 생성 AD (JSON)
```json
{
  "audio_descriptions": [
    {
      "start_time": "0:05.2",
      "end_time": "0:10.5",
      "description": "A man walks..."
    }
  ]
}
```

### 참조 AD (CSV)
```csv
text,start,end,speech_type
"A man walks through...",5.2,10.5,ad
```

## 라이선스

MIT License


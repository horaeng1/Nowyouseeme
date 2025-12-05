# Ko-AD RLHF 학습 가이드

이 문서는 Ko-AD 시스템에서 수집된 사용자 평가 데이터를 활용하여 화면해설(Audio Description) 생성 모델을 RLHF(Reinforcement Learning from Human Feedback) 방식으로 개선하는 방법을 설명합니다.

---

## 목차

1. [수집 데이터 구조](#1-수집-데이터-구조)
2. [데이터 전처리](#2-데이터-전처리)
3. [RLHF 학습 데이터 변환](#3-rlhf-학습-데이터-변환)
4. [학습 파이프라인](#4-학습-파이프라인)
5. [모델 Fine-tuning 방법](#5-모델-fine-tuning-방법)
6. [평가 및 검증](#6-평가-및-검증)

---

## 1. 수집 데이터 구조

### 1.1 저장 위치

```
Cursor/server/storage/ratings/
├── {videoId}_ratings.json          # 원본 버전 평가
├── {videoId}_edited_ratings.json   # 편집 버전 평가
└── ...
```

### 1.2 JSON 스키마

```json
{
  "videoId": "uuid-string",
  "videoInfo": {
    "fileName": "example_video.mp4",
    "duration": 180.5,
    "width": 1920,
    "height": 1080
  },
  "segments": [
    {
      "id": 1,
      "start": 5.0,
      "end": 12.5,
      "text": "화면해설 텍스트...",
      "rating": "like"
    }
  ],
  "version": "original",
  "createdAt": "2025-12-03T10:30:00.000Z",
  "updatedAt": "2025-12-03T10:35:00.000Z"
}
```

### 1.3 Rating 값 의미

| Rating | 의미 | RLHF 활용 |
|--------|------|-----------|
| `like` (👍) | 좋은 화면해설 | Positive sample (reward = +1) |
| `dislike` (👎) | 개선 필요 | Negative sample (reward = -1) |
| `neutral` | 평가 안함 | 학습 제외 또는 중립 (reward = 0) |

### 1.4 버전별 데이터 의미

- **original**: AI가 생성한 원본 화면해설에 대한 평가
- **edited**: 사용자가 수정한 화면해설 (수정된 세그먼트는 자동으로 `like` 처리)

---

## 2. 데이터 전처리

### 2.1 데이터 수집 스크립트

```python
# scripts/collect_ratings.py
import os
import json
from pathlib import Path
from typing import List, Dict, Any

RATINGS_DIR = Path("Cursor/server/storage/ratings")

def collect_all_ratings() -> List[Dict[str, Any]]:
    """모든 평가 데이터를 수집합니다."""
    all_ratings = []
    
    for json_file in RATINGS_DIR.glob("*.json"):
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            all_ratings.append(data)
    
    return all_ratings

def filter_rated_segments(ratings_list: List[Dict]) -> List[Dict]:
    """평가된 세그먼트만 필터링합니다 (neutral 제외)."""
    filtered = []
    
    for rating_data in ratings_list:
        video_id = rating_data['videoId']
        version = rating_data.get('version', 'original')
        
        for segment in rating_data['segments']:
            if segment['rating'] != 'neutral':
                filtered.append({
                    'video_id': video_id,
                    'version': version,
                    'segment_id': segment['id'],
                    'start_time': segment['start'],
                    'end_time': segment['end'],
                    'text': segment['text'],
                    'rating': segment['rating'],
                    'reward': 1 if segment['rating'] == 'like' else -1
                })
    
    return filtered

if __name__ == "__main__":
    ratings = collect_all_ratings()
    filtered = filter_rated_segments(ratings)
    
    # 통계 출력
    likes = sum(1 for s in filtered if s['rating'] == 'like')
    dislikes = sum(1 for s in filtered if s['rating'] == 'dislike')
    
    print(f"총 평가 데이터: {len(filtered)}")
    print(f"  - Like: {likes}")
    print(f"  - Dislike: {dislikes}")
    
    # 학습 데이터로 저장
    with open('training_data.json', 'w', encoding='utf-8') as f:
        json.dump(filtered, f, ensure_ascii=False, indent=2)
```

### 2.2 Preference Pair 생성

RLHF에서는 "선호 쌍(Preference Pair)"이 필요합니다. 편집된 데이터를 활용하여 생성합니다.

```python
# scripts/create_preference_pairs.py
import json
from pathlib import Path
from typing import List, Dict, Tuple

def create_preference_pairs(ratings_dir: Path) -> List[Dict]:
    """원본-편집 쌍을 비교하여 Preference Pair를 생성합니다."""
    preference_pairs = []
    
    # 비디오별로 원본/편집 버전 매칭
    video_ratings = {}
    
    for json_file in ratings_dir.glob("*.json"):
        with open(json_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
            video_id = data['videoId']
            version = data.get('version', 'original')
            
            if video_id not in video_ratings:
                video_ratings[video_id] = {}
            video_ratings[video_id][version] = data
    
    # Preference Pair 생성
    for video_id, versions in video_ratings.items():
        if 'original' not in versions or 'edited' not in versions:
            continue
        
        original = versions['original']
        edited = versions['edited']
        
        # 세그먼트별 비교
        orig_segments = {s['id']: s for s in original['segments']}
        edit_segments = {s['id']: s for s in edited['segments']}
        
        for seg_id in orig_segments:
            if seg_id not in edit_segments:
                continue
            
            orig_seg = orig_segments[seg_id]
            edit_seg = edit_segments[seg_id]
            
            # 텍스트가 다른 경우 = 사용자가 수정함 = 편집 버전 선호
            if orig_seg['text'] != edit_seg['text']:
                preference_pairs.append({
                    'video_id': video_id,
                    'segment_id': seg_id,
                    'start_time': orig_seg['start'],
                    'end_time': orig_seg['end'],
                    'chosen': edit_seg['text'],      # 선호됨 (편집된 버전)
                    'rejected': orig_seg['text'],    # 거부됨 (원본 버전)
                    'chosen_rating': edit_seg.get('rating', 'like'),
                    'rejected_rating': orig_seg.get('rating', 'dislike')
                })
    
    return preference_pairs

if __name__ == "__main__":
    ratings_dir = Path("Cursor/server/storage/ratings")
    pairs = create_preference_pairs(ratings_dir)
    
    print(f"생성된 Preference Pairs: {len(pairs)}")
    
    with open('preference_pairs.json', 'w', encoding='utf-8') as f:
        json.dump(pairs, f, ensure_ascii=False, indent=2)
```

---

## 3. RLHF 학습 데이터 변환

### 3.1 OpenAI Fine-tuning 형식

```python
# scripts/convert_to_openai_format.py
import json

def convert_to_openai_format(preference_pairs: list) -> list:
    """OpenAI Fine-tuning JSONL 형식으로 변환합니다."""
    training_examples = []
    
    for pair in preference_pairs:
        # 시스템 프롬프트
        system_prompt = """당신은 시각장애인을 위한 화면해설(Audio Description) 전문가입니다.
영상의 특정 구간에 대해 적절한 화면해설을 생성해야 합니다.
화면해설은 간결하고 명확하며, 시각적 정보를 청각적으로 전달해야 합니다."""

        # 사용자 프롬프트 (영상 구간 정보)
        user_prompt = f"""다음 영상 구간에 대한 화면해설을 작성해주세요.

구간: {pair['start_time']:.1f}초 ~ {pair['end_time']:.1f}초

좋은 화면해설의 예시를 참고하세요."""

        # 선호된 응답 (chosen)
        training_examples.append({
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
                {"role": "assistant", "content": pair['chosen']}
            ]
        })
    
    return training_examples

def save_as_jsonl(examples: list, output_path: str):
    """JSONL 형식으로 저장합니다."""
    with open(output_path, 'w', encoding='utf-8') as f:
        for example in examples:
            f.write(json.dumps(example, ensure_ascii=False) + '\n')

if __name__ == "__main__":
    with open('preference_pairs.json', 'r', encoding='utf-8') as f:
        pairs = json.load(f)
    
    examples = convert_to_openai_format(pairs)
    save_as_jsonl(examples, 'openai_training.jsonl')
    print(f"저장 완료: {len(examples)} examples")
```

### 3.2 DPO (Direct Preference Optimization) 형식

```python
# scripts/convert_to_dpo_format.py
import json

def convert_to_dpo_format(preference_pairs: list) -> list:
    """DPO 학습을 위한 형식으로 변환합니다."""
    dpo_examples = []
    
    for pair in preference_pairs:
        prompt = f"""[영상 구간: {pair['start_time']:.1f}초 ~ {pair['end_time']:.1f}초]
이 구간에 대한 화면해설을 작성하세요."""

        dpo_examples.append({
            "prompt": prompt,
            "chosen": pair['chosen'],
            "rejected": pair['rejected']
        })
    
    return dpo_examples

if __name__ == "__main__":
    with open('preference_pairs.json', 'r', encoding='utf-8') as f:
        pairs = json.load(f)
    
    dpo_data = convert_to_dpo_format(pairs)
    
    with open('dpo_training.json', 'w', encoding='utf-8') as f:
        json.dump(dpo_data, f, ensure_ascii=False, indent=2)
    
    print(f"DPO 데이터 저장 완료: {len(dpo_data)} examples")
```

### 3.3 Reward Model 학습 데이터

```python
# scripts/create_reward_data.py
import json

def create_reward_model_data(filtered_segments: list) -> list:
    """Reward Model 학습용 데이터를 생성합니다."""
    reward_data = []
    
    for seg in filtered_segments:
        reward_data.append({
            "text": seg['text'],
            "start_time": seg['start_time'],
            "end_time": seg['end_time'],
            "reward": seg['reward'],  # 1 (like) or -1 (dislike)
            "label": 1 if seg['reward'] > 0 else 0  # Binary classification
        })
    
    return reward_data

if __name__ == "__main__":
    with open('training_data.json', 'r', encoding='utf-8') as f:
        segments = json.load(f)
    
    reward_data = create_reward_model_data(segments)
    
    with open('reward_model_data.json', 'w', encoding='utf-8') as f:
        json.dump(reward_data, f, ensure_ascii=False, indent=2)
    
    print(f"Reward Model 데이터: {len(reward_data)} samples")
```

---

## 4. 학습 파이프라인

### 4.1 전체 RLHF 파이프라인

```
┌─────────────────┐
│  사용자 평가     │  Ko-AD Upload/Editor 페이지
│  (👍/👎)        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  평가 JSON 수집  │  storage/ratings/*.json
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  데이터 전처리   │  Preference Pairs 생성
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌───────────┐
│  SFT  │ │ Reward    │  1. Supervised Fine-tuning
│       │ │ Model     │  2. Reward Model 학습
└───┬───┘ └─────┬─────┘
    │           │
    └─────┬─────┘
          ▼
┌─────────────────┐
│  PPO / DPO      │  3. RL Fine-tuning
│  Training       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  개선된 AD 모델  │
└─────────────────┘
```

### 4.2 실행 순서

```bash
# 1. 데이터 수집
python scripts/collect_ratings.py

# 2. Preference Pairs 생성
python scripts/create_preference_pairs.py

# 3. 형식 변환 (목적에 맞게 선택)
python scripts/convert_to_openai_format.py  # OpenAI Fine-tuning
python scripts/convert_to_dpo_format.py     # DPO Training
python scripts/create_reward_data.py        # Reward Model

# 4. 학습 실행
python scripts/train_model.py
```

---

## 5. 모델 Fine-tuning 방법

### 5.1 OpenAI GPT Fine-tuning

```python
# scripts/finetune_openai.py
import openai
import os

openai.api_key = os.getenv("OPENAI_API_KEY")

# 1. 학습 파일 업로드
def upload_training_file(file_path: str) -> str:
    with open(file_path, "rb") as f:
        response = openai.File.create(
            file=f,
            purpose="fine-tune"
        )
    return response.id

# 2. Fine-tuning 작업 생성
def create_finetune_job(training_file_id: str, model: str = "gpt-3.5-turbo"):
    response = openai.FineTuningJob.create(
        training_file=training_file_id,
        model=model,
        hyperparameters={
            "n_epochs": 3,
            "batch_size": 4,
            "learning_rate_multiplier": 0.1
        }
    )
    return response

# 3. 학습 상태 확인
def check_finetune_status(job_id: str):
    return openai.FineTuningJob.retrieve(job_id)

if __name__ == "__main__":
    # 학습 파일 업로드
    file_id = upload_training_file("openai_training.jsonl")
    print(f"업로드된 파일 ID: {file_id}")
    
    # Fine-tuning 시작
    job = create_finetune_job(file_id)
    print(f"Fine-tuning Job ID: {job.id}")
    print(f"상태: {job.status}")
```

### 5.2 Hugging Face DPO Training

```python
# scripts/train_dpo.py
from datasets import Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import DPOTrainer, DPOConfig
import json

def load_dpo_dataset(file_path: str) -> Dataset:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return Dataset.from_list(data)

def train_dpo_model(
    model_name: str = "beomi/KoAlpaca-Polyglot-5.8B",
    output_dir: str = "./ko-ad-dpo-model"
):
    # 모델 및 토크나이저 로드
    model = AutoModelForCausalLM.from_pretrained(model_name)
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    
    # 데이터셋 로드
    dataset = load_dpo_dataset("dpo_training.json")
    
    # DPO 설정
    training_args = DPOConfig(
        output_dir=output_dir,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        learning_rate=5e-5,
        num_train_epochs=3,
        beta=0.1,  # DPO beta parameter
        logging_steps=10,
        save_steps=100,
        evaluation_strategy="steps",
        eval_steps=50,
    )
    
    # DPO Trainer 초기화
    trainer = DPOTrainer(
        model=model,
        args=training_args,
        train_dataset=dataset,
        tokenizer=tokenizer,
    )
    
    # 학습 시작
    trainer.train()
    
    # 모델 저장
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    print(f"모델 저장 완료: {output_dir}")

if __name__ == "__main__":
    train_dpo_model()
```

### 5.3 Reward Model 학습

```python
# scripts/train_reward_model.py
import torch
from torch import nn
from transformers import AutoModel, AutoTokenizer, Trainer, TrainingArguments
from datasets import Dataset
import json

class RewardModel(nn.Module):
    def __init__(self, base_model_name: str):
        super().__init__()
        self.base_model = AutoModel.from_pretrained(base_model_name)
        self.reward_head = nn.Linear(self.base_model.config.hidden_size, 1)
    
    def forward(self, input_ids, attention_mask):
        outputs = self.base_model(input_ids=input_ids, attention_mask=attention_mask)
        last_hidden_state = outputs.last_hidden_state
        # [CLS] 토큰의 hidden state 사용
        cls_output = last_hidden_state[:, 0, :]
        reward = self.reward_head(cls_output)
        return reward

def load_reward_dataset(file_path: str) -> Dataset:
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return Dataset.from_list(data)

def train_reward_model(
    model_name: str = "klue/bert-base",
    output_dir: str = "./ko-ad-reward-model"
):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = RewardModel(model_name)
    
    dataset = load_reward_dataset("reward_model_data.json")
    
    def tokenize_function(examples):
        return tokenizer(
            examples["text"],
            padding="max_length",
            truncation=True,
            max_length=256
        )
    
    tokenized_dataset = dataset.map(tokenize_function, batched=True)
    
    training_args = TrainingArguments(
        output_dir=output_dir,
        per_device_train_batch_size=16,
        num_train_epochs=5,
        learning_rate=2e-5,
        logging_steps=50,
        save_steps=200,
        evaluation_strategy="steps",
        eval_steps=100,
    )
    
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset,
    )
    
    trainer.train()
    trainer.save_model(output_dir)
    
    print(f"Reward Model 저장 완료: {output_dir}")

if __name__ == "__main__":
    train_reward_model()
```

---

## 6. 평가 및 검증

### 6.1 자동 평가 지표

```python
# scripts/evaluate_model.py
from bert_score import score as bert_score
from nltk.translate.meteor_score import meteor_score
import json

def evaluate_ad_quality(predictions: list, references: list) -> dict:
    """화면해설 품질을 자동 평가합니다."""
    
    # BERTScore
    P, R, F1 = bert_score(predictions, references, lang="ko")
    
    # METEOR Score
    meteor_scores = [
        meteor_score([ref.split()], pred.split())
        for pred, ref in zip(predictions, references)
    ]
    
    return {
        "bert_score_precision": P.mean().item(),
        "bert_score_recall": R.mean().item(),
        "bert_score_f1": F1.mean().item(),
        "meteor_score": sum(meteor_scores) / len(meteor_scores)
    }

if __name__ == "__main__":
    # 테스트 데이터 로드
    with open('test_predictions.json', 'r', encoding='utf-8') as f:
        test_data = json.load(f)
    
    predictions = [d['prediction'] for d in test_data]
    references = [d['reference'] for d in test_data]
    
    results = evaluate_ad_quality(predictions, references)
    print("평가 결과:")
    for metric, value in results.items():
        print(f"  {metric}: {value:.4f}")
```

### 6.2 A/B 테스트 설정

```python
# Ko-AD 시스템에서 A/B 테스트 설정 예시
AB_TEST_CONFIG = {
    "enabled": True,
    "models": {
        "control": "gemini-2.0-flash",      # 기존 모델
        "treatment": "ko-ad-dpo-v1"          # Fine-tuned 모델
    },
    "traffic_split": 0.5,  # 50% 사용자에게 새 모델 적용
    "metrics_to_track": [
        "like_rate",
        "dislike_rate", 
        "edit_rate",
        "time_to_approve"
    ]
}
```

### 6.3 지속적 개선 루프

```
┌──────────────────────────────────────────────────────┐
│                    Ko-AD 시스템                       │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐         │
│  │ Upload  │ -> │ Editor  │ -> │ Export  │         │
│  │ Page    │    │ Page    │    │         │         │
│  └────┬────┘    └────┬────┘    └─────────┘         │
│       │              │                              │
│       ▼              ▼                              │
│  ┌─────────────────────────┐                       │
│  │   평가 데이터 수집        │                       │
│  │   (👍/👎/편집)           │                       │
│  └───────────┬─────────────┘                       │
└──────────────│──────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────┐
│              LLMOps 파이프라인                        │
│                                                      │
│  1. 주간 데이터 수집 (자동화)                         │
│  2. 데이터 품질 검증                                  │
│  3. Preference Pair 생성                             │
│  4. 모델 재학습 (DPO/PPO)                            │
│  5. A/B 테스트 배포                                  │
│  6. 성능 모니터링                                    │
│  7. 새 모델 프로덕션 적용                             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 부록: 유용한 리소스

### A. 필요 라이브러리

```bash
# requirements-rlhf.txt
transformers>=4.35.0
datasets>=2.14.0
trl>=0.7.0          # DPO, PPO Trainer
peft>=0.5.0         # LoRA 지원
accelerate>=0.24.0
bitsandbytes>=0.41.0
bert-score>=0.3.13
nltk>=3.8.0
openai>=1.0.0
```

### B. 참고 논문

1. **RLHF**: "Training language models to follow instructions with human feedback" (InstructGPT)
2. **DPO**: "Direct Preference Optimization: Your Language Model is Secretly a Reward Model"
3. **PPO**: "Proximal Policy Optimization Algorithms"

### C. 데이터 품질 가이드라인

- **최소 데이터량**: Preference Pair 1,000개 이상 권장
- **균형**: Like/Dislike 비율 균형 유지 (이상적으로 40-60%)
- **다양성**: 다양한 영상 장르, 길이, 장면 유형 포함
- **일관성**: 평가 기준 일관성 확보 (가이드라인 제공)

---

## 문의

Ko-AD RLHF 학습에 대한 문의사항은 이슈를 통해 남겨주세요.


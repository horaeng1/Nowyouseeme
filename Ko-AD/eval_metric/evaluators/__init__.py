"""
Evaluators for Audio Description quality assessment.

Available evaluators:
    - LLMEvaluator: LLM-based evaluation using Gemini API
    - BERTScoreEvaluator: Semantic similarity using BERTScore
    - METEOREvaluator: METEOR score for text matching
    - CIDErEvaluator: CIDEr score using TF-IDF n-grams
    - CRITICEvaluator: Character identification evaluation
"""

from .base import BaseEvaluator
from .llm_eval import LLMEvaluator
from .bertscore import BERTScoreEvaluator
from .meteor import METEOREvaluator
from .cider import CIDErEvaluator
from .critic import CRITICEvaluator

__all__ = [
    "BaseEvaluator",
    "LLMEvaluator",
    "BERTScoreEvaluator",
    "METEOREvaluator",
    "CIDErEvaluator",
    "CRITICEvaluator",
]


def get_evaluator(name: str) -> type:
    """Get evaluator class by name."""
    evaluators = {
        "llm": LLMEvaluator,
        "bertscore": BERTScoreEvaluator,
        "meteor": METEOREvaluator,
        "cider": CIDErEvaluator,
        "critic": CRITICEvaluator,
    }
    name_lower = name.lower()
    if name_lower not in evaluators:
        raise ValueError(f"Unknown evaluator: {name}. Available: {list(evaluators.keys())}")
    return evaluators[name_lower]

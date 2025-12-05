"""
eval_metric - Audio Description Evaluation Toolkit

A modular toolkit for evaluating AI-generated audio descriptions
against human-written reference audio descriptions.

Modules:
    - matchers: Sequence matching algorithms (Cluster, DP, Overlap)
    - evaluators: Evaluation metrics (LLM, BERTScore, METEOR, CIDEr, CRITIC)
    - config: YAML configuration management
    - utils: Common utility functions
"""

from .config import load_config, EvalConfig
from .utils import (
    timestamp_to_seconds,
    load_generated_ad,
    load_reference_ad,
    generate_output_filename,
    extract_characters_from_csv,
    ADEvent,
)
from .matchers import (
    ClusterMatcher,
    DPMatcher,
    OverlapMatcher,
    get_matcher,
)

__version__ = "1.0.0"
__all__ = [
    # Config
    "load_config",
    "EvalConfig",
    # Utils
    "timestamp_to_seconds",
    "load_generated_ad", 
    "load_reference_ad",
    "generate_output_filename",
    "extract_characters_from_csv",
    "ADEvent",
    # Matchers
    "ClusterMatcher",
    "DPMatcher",
    "OverlapMatcher",
    "get_matcher",
]

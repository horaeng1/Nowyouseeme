"""
Configuration management for Audio Description evaluation.

Supports loading configuration from YAML files with sensible defaults.
"""

import os
import yaml
from dataclasses import dataclass, field, asdict
from typing import Dict, Any, Optional, List


@dataclass
class MatcherConfig:
    """Configuration for matcher algorithms."""
    method: str = "cluster"  # cluster, dp, overlap
    min_overlap_sec: float = 0.5
    
    # DP-specific parameters
    w_time: float = 0.3
    w_text: float = 0.7
    gap_penalty_gen: float = -0.2
    gap_penalty_ref: float = -0.2
    time_scale: float = 10.0
    time_soft: bool = True


@dataclass
class LLMEvalConfig:
    """Configuration for LLM-based evaluation."""
    api_key: Optional[str] = None  # If None, uses GEMINI_API_KEY env var
    model: str = "gemini-2.5-flash"
    max_retries: int = 3
    retry_delay: float = 2.0


@dataclass
class BERTScoreConfig:
    """Configuration for BERTScore evaluation."""
    model: str = "roberta-large"
    device: Optional[str] = None  # auto-detect if None
    batch_size: int = 64
    rescale_with_baseline: bool = False


@dataclass
class METEORConfig:
    """Configuration for METEOR evaluation."""
    alpha: float = 0.9
    beta: float = 3.0
    gamma: float = 0.5


@dataclass
class CIDErConfig:
    """Configuration for CIDEr evaluation."""
    n_gram: int = 4
    sigma: float = 6.0


@dataclass
class CRITICConfig:
    """Configuration for CRITIC evaluation."""
    characters: List[str] = field(default_factory=list)
    characters_file: Optional[str] = None  # JSON file with character list
    device: str = "cpu"  # cuda:0 for GPU


@dataclass
class OutputConfig:
    """Configuration for output files."""
    output_dir: Optional[str] = None  # If None, uses same dir as generated file
    save_detailed_csv: bool = True
    save_summary_json: bool = True
    include_timestamp: bool = True


@dataclass
class EvalConfig:
    """Main configuration for AD evaluation."""
    # Input files
    generated_file: Optional[str] = None
    reference_file: Optional[str] = None
    
    # Matcher configuration
    matcher: MatcherConfig = field(default_factory=MatcherConfig)
    
    # Evaluator configurations
    llm: LLMEvalConfig = field(default_factory=LLMEvalConfig)
    bertscore: BERTScoreConfig = field(default_factory=BERTScoreConfig)
    meteor: METEORConfig = field(default_factory=METEORConfig)
    cider: CIDErConfig = field(default_factory=CIDErConfig)
    critic: CRITICConfig = field(default_factory=CRITICConfig)
    
    # Output configuration
    output: OutputConfig = field(default_factory=OutputConfig)
    
    # Which evaluators to run (if empty, runs all)
    evaluators: List[str] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'EvalConfig':
        """Create config from dictionary."""
        config = cls()
        
        # Simple fields
        if 'generated_file' in data:
            config.generated_file = data['generated_file']
        if 'reference_file' in data:
            config.reference_file = data['reference_file']
        if 'evaluators' in data:
            config.evaluators = data['evaluators']
        
        # Nested configs
        if 'matcher' in data:
            for key, value in data['matcher'].items():
                if hasattr(config.matcher, key):
                    setattr(config.matcher, key, value)
        
        if 'llm' in data:
            for key, value in data['llm'].items():
                if hasattr(config.llm, key):
                    setattr(config.llm, key, value)
        
        if 'bertscore' in data:
            for key, value in data['bertscore'].items():
                if hasattr(config.bertscore, key):
                    setattr(config.bertscore, key, value)
        
        if 'meteor' in data:
            for key, value in data['meteor'].items():
                if hasattr(config.meteor, key):
                    setattr(config.meteor, key, value)
        
        if 'cider' in data:
            for key, value in data['cider'].items():
                if hasattr(config.cider, key):
                    setattr(config.cider, key, value)
        
        if 'critic' in data:
            for key, value in data['critic'].items():
                if hasattr(config.critic, key):
                    setattr(config.critic, key, value)
        
        if 'output' in data:
            for key, value in data['output'].items():
                if hasattr(config.output, key):
                    setattr(config.output, key, value)
        
        return config


def load_config(config_path: Optional[str] = None) -> EvalConfig:
    """
    Load configuration from YAML file.
    
    Args:
        config_path: Path to YAML config file. If None, returns default config.
        
    Returns:
        EvalConfig object
    """
    if config_path is None:
        return EvalConfig()
    
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Config file not found: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)
    
    if data is None:
        return EvalConfig()
    
    return EvalConfig.from_dict(data)


def save_config(config: EvalConfig, config_path: str) -> None:
    """
    Save configuration to YAML file.
    
    Args:
        config: EvalConfig object to save
        config_path: Path to output YAML file
    """
    data = config.to_dict()
    
    with open(config_path, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def merge_config_with_args(config: EvalConfig, args) -> EvalConfig:
    """
    Merge configuration with command-line arguments.
    CLI arguments take precedence over config file.
    
    Args:
        config: Base EvalConfig object
        args: Argparse namespace object
        
    Returns:
        Merged EvalConfig object
    """
    # Override with CLI arguments if provided
    if hasattr(args, 'generated') and args.generated:
        config.generated_file = args.generated
    if hasattr(args, 'reference') and args.reference:
        config.reference_file = args.reference
    if hasattr(args, 'output') and args.output:
        config.output.output_dir = args.output
    
    # Matcher options
    if hasattr(args, 'matcher') and args.matcher:
        config.matcher.method = args.matcher
    if hasattr(args, 'min_overlap') and args.min_overlap is not None:
        config.matcher.min_overlap_sec = args.min_overlap
    
    # DP options
    if hasattr(args, 'w_time') and args.w_time is not None:
        config.matcher.w_time = args.w_time
    if hasattr(args, 'w_text') and args.w_text is not None:
        config.matcher.w_text = args.w_text
    
    # Evaluator options
    if hasattr(args, 'metric') and args.metric:
        config.evaluators = [args.metric] if isinstance(args.metric, str) else args.metric
    
    # LLM options
    if hasattr(args, 'api_key') and args.api_key:
        config.llm.api_key = args.api_key
    if hasattr(args, 'model') and args.model:
        config.llm.model = args.model
    
    # BERTScore options
    if hasattr(args, 'bert_model') and args.bert_model:
        config.bertscore.model = args.bert_model
    if hasattr(args, 'device') and args.device:
        config.bertscore.device = args.device
        config.critic.device = args.device
    
    # CRITIC options
    if hasattr(args, 'characters') and args.characters:
        config.critic.characters_file = args.characters
    
    return config


# Default config as YAML string (for reference)
DEFAULT_CONFIG_YAML = """
# Audio Description Evaluation Configuration

# Input files (can be overridden via CLI)
generated_file: null
reference_file: null

# Matcher configuration
matcher:
  method: cluster  # cluster, dp, overlap
  min_overlap_sec: 0.5
  
  # DP-specific parameters
  w_time: 0.3
  w_text: 0.7
  gap_penalty_gen: -0.2
  gap_penalty_ref: -0.2
  time_scale: 10.0
  time_soft: true

# LLM Evaluation (Gemini)
llm:
  api_key: null  # Uses GEMINI_API_KEY env var if null
  model: gemini-2.5-flash
  max_retries: 3
  retry_delay: 2.0

# BERTScore
bertscore:
  model: roberta-large
  device: null  # auto-detect
  batch_size: 64
  rescale_with_baseline: false

# METEOR
meteor:
  alpha: 0.9
  beta: 3.0
  gamma: 0.5

# CIDEr
cider:
  n_gram: 4
  sigma: 6.0

# CRITIC (Character Identification)
critic:
  characters: []  # List of character names
  characters_file: null  # Or path to JSON with character list
  device: cpu  # cuda:0 for GPU

# Output configuration
output:
  output_dir: null  # Uses input file directory if null
  save_detailed_csv: true
  save_summary_json: true
  include_timestamp: true

# Evaluators to run (empty = all)
evaluators: []
"""

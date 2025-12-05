"""
METEOR evaluator for Audio Description quality assessment.

METEOR considers synonyms, stemming, and word order for text comparison.
"""

from typing import Dict, Any, Optional

from .base import BaseEvaluator

# Optional imports
try:
    import nltk
    from nltk.translate.meteor_score import meteor_score
    from nltk.tokenize import word_tokenize
    NLTK_AVAILABLE = True
except ImportError:
    NLTK_AVAILABLE = False


def ensure_nltk_data():
    """Download required NLTK data if not available."""
    if not NLTK_AVAILABLE:
        return
    
    required = ['punkt', 'wordnet', 'punkt_tab']
    for item in required:
        try:
            if 'punkt' in item:
                nltk.data.find(f'tokenizers/{item}')
            else:
                nltk.data.find(f'corpora/{item}')
        except LookupError:
            print(f"Downloading NLTK data: {item}...")
            nltk.download(item, quiet=True)


class METEOREvaluator(BaseEvaluator):
    """
    METEOR evaluator for text matching with synonym/stemming support.
    
    Returns METEOR score in range [0, 1].
    """
    
    def __init__(
        self,
        alpha: float = 0.9,
        beta: float = 3.0,
        gamma: float = 0.5,
        config: Any = None,
    ):
        """
        Initialize METEOR evaluator.
        
        Args:
            alpha: Weight parameter for precision
            beta: Weight parameter for recall
            gamma: Fragmentation penalty parameter
            config: Optional METEORConfig object
        """
        super().__init__(config)
        
        if not NLTK_AVAILABLE:
            raise ImportError("nltk is required. Install with: pip install nltk")
        
        ensure_nltk_data()
        
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
    
    @property
    def metric_name(self) -> str:
        return "METEOR"
    
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Evaluate a single pair using METEOR."""
        # Tokenize
        ref_tokens = word_tokenize(ref_text.lower())
        gen_tokens = word_tokenize(gen_text.lower())
        
        # METEOR expects reference as list of tokens
        score = meteor_score([ref_tokens], gen_tokens)
        
        return {'score': float(score)}

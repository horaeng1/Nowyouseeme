"""
BERTScore evaluator for Audio Description quality assessment.

Uses BERT embeddings to compute semantic similarity between texts.
"""

from typing import Dict, Any, Optional, List
import numpy as np

from .base import BaseEvaluator, EvaluationResult
from ..utils import MatchedPair

# Optional imports
try:
    from bert_score import score as bert_score_func
    BERTSCORE_AVAILABLE = True
except ImportError:
    BERTSCORE_AVAILABLE = False


class BERTScoreEvaluator(BaseEvaluator):
    """
    BERTScore evaluator for semantic text similarity.
    
    Returns precision, recall, and F1 scores based on BERT embeddings.
    """
    
    def __init__(
        self,
        model: str = "roberta-large",
        device: Optional[str] = None,
        batch_size: int = 64,
        rescale_with_baseline: bool = False,
        config: Any = None,
    ):
        """
        Initialize BERTScore evaluator.
        
        Args:
            model: BERT model to use
            device: Device to use (cuda/cpu, auto if None)
            batch_size: Batch size for encoding
            rescale_with_baseline: Whether to rescale scores with baseline
            config: Optional BERTScoreConfig object
        """
        super().__init__(config)
        
        if not BERTSCORE_AVAILABLE:
            raise ImportError("bert-score is required. Install with: pip install bert-score")
        
        self.model = model
        self.device = device
        self.batch_size = batch_size
        self.rescale_with_baseline = rescale_with_baseline
    
    @property
    def metric_name(self) -> str:
        return "BERTScore"
    
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Evaluate a single pair using BERTScore."""
        P, R, F1 = bert_score_func(
            [gen_text], [ref_text],
            model_type=self.model,
            device=self.device,
            verbose=False,
            rescale_with_baseline=self.rescale_with_baseline,
        )
        
        return {
            'score': float(F1[0]),
            'precision': float(P[0]),
            'recall': float(R[0]),
            'f1': float(F1[0]),
        }
    
    def evaluate_batch(
        self,
        matched_pairs: List[MatchedPair],
        show_progress: bool = True
    ) -> EvaluationResult:
        """
        Evaluate all matched pairs using batch processing.
        
        More efficient than individual pair evaluation.
        """
        pairs_to_eval = [p for p in matched_pairs if p.matched]
        
        if not pairs_to_eval:
            return EvaluationResult(
                pairs=[],
                statistics=self._calculate_statistics([], matched_pairs),
                metric_name=self.metric_name,
            )
        
        # Extract texts
        gen_texts = [p.combined_gen_text for p in pairs_to_eval]
        ref_texts = [p.combined_ref_text for p in pairs_to_eval]
        
        # Compute BERTScore in batch
        print(f"Computing BERTScore for {len(gen_texts)} pairs...")
        P, R, F1 = bert_score_func(
            gen_texts, ref_texts,
            model_type=self.model,
            device=self.device,
            verbose=show_progress,
            rescale_with_baseline=self.rescale_with_baseline,
        )
        
        # Convert to numpy
        P = P.numpy()
        R = R.numpy()
        F1 = F1.numpy()
        
        # Build results
        results = []
        for i, pair in enumerate(pairs_to_eval):
            pair_result = pair.to_dict()
            pair_result.update({
                'score': float(F1[i]),
                'precision': float(P[i]),
                'recall': float(R[i]),
                'f1': float(F1[i]),
            })
            results.append(pair_result)
        
        # Calculate statistics using F1 as the main score
        scores = F1.tolist()
        stats = self._calculate_statistics(scores, matched_pairs)
        
        # Add BERTScore-specific stats
        stats.update({
            'mean_precision': float(np.mean(P)),
            'mean_recall': float(np.mean(R)),
            'mean_f1': float(np.mean(F1)),
            'model': self.model,
        })
        
        return EvaluationResult(
            pairs=results,
            statistics=stats,
            metric_name=self.metric_name,
        )

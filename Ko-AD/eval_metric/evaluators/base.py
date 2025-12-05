"""
Base evaluator class for Audio Description evaluation.

All evaluators inherit from BaseEvaluator and implement the evaluate() method.
"""

import os
import json
import pandas as pd
import numpy as np
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass

from ..utils import MatchedPair, generate_output_filename


@dataclass
class EvaluationResult:
    """Container for evaluation results."""
    pairs: List[Dict[str, Any]]  # Per-pair results
    statistics: Dict[str, Any]   # Aggregate statistics
    metric_name: str
    
    def to_dataframe(self) -> pd.DataFrame:
        """Convert pairs to DataFrame."""
        return pd.DataFrame(self.pairs)
    
    def save(self, output_path: str, save_summary: bool = True) -> Tuple[str, Optional[str]]:
        """
        Save results to CSV and optionally JSON summary.
        
        Returns:
            Tuple of (csv_path, summary_path or None)
        """
        # Save detailed CSV
        df = self.to_dataframe()
        df.to_csv(output_path, index=False)
        
        # Save summary JSON
        summary_path = None
        if save_summary:
            summary_path = output_path.replace('.csv', '_summary.json')
            with open(summary_path, 'w', encoding='utf-8') as f:
                json.dump(self.statistics, f, indent=2, ensure_ascii=False)
        
        return output_path, summary_path


class BaseEvaluator(ABC):
    """
    Abstract base class for all evaluators.
    
    Subclasses must implement:
        - evaluate_pair(): Score a single matched pair
        - metric_name: Property returning the metric name
    """
    
    def __init__(self, config: Any = None):
        """
        Initialize evaluator.
        
        Args:
            config: Optional configuration object (evaluator-specific)
        """
        self.config = config
    
    @property
    @abstractmethod
    def metric_name(self) -> str:
        """Return the name of this metric."""
        pass
    
    @abstractmethod
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Evaluate a single pair of texts.
        
        Args:
            gen_text: Generated AD text
            ref_text: Reference AD text
            **kwargs: Additional arguments (e.g., metadata)
            
        Returns:
            Dictionary with at least 'score' key
        """
        pass
    
    def evaluate_batch(
        self,
        matched_pairs: List[MatchedPair],
        show_progress: bool = True
    ) -> EvaluationResult:
        """
        Evaluate all matched pairs.
        
        Args:
            matched_pairs: List of MatchedPair objects
            show_progress: Whether to show progress bar
            
        Returns:
            EvaluationResult object
        """
        from tqdm import tqdm
        
        results = []
        scores = []
        
        # Filter to only matched pairs
        pairs_to_eval = [p for p in matched_pairs if p.matched]
        
        iterator = tqdm(pairs_to_eval, desc=f"Evaluating {self.metric_name}") if show_progress else pairs_to_eval
        
        for pair in iterator:
            try:
                result = self.evaluate_pair(
                    gen_text=pair.combined_gen_text,
                    ref_text=pair.combined_ref_text,
                )
                
                # Build result dict
                pair_result = pair.to_dict()
                pair_result.update(result)
                results.append(pair_result)
                
                if 'score' in result and result['score'] is not None:
                    scores.append(result['score'])
                    
            except Exception as e:
                print(f"Error evaluating pair: {e}")
                pair_result = pair.to_dict()
                pair_result['score'] = None
                pair_result['error'] = str(e)
                results.append(pair_result)
        
        # Calculate statistics
        stats = self._calculate_statistics(scores, matched_pairs)
        
        return EvaluationResult(
            pairs=results,
            statistics=stats,
            metric_name=self.metric_name,
        )
    
    def _calculate_statistics(
        self,
        scores: List[float],
        matched_pairs: List[MatchedPair]
    ) -> Dict[str, Any]:
        """Calculate aggregate statistics."""
        total_pairs = len(matched_pairs)
        matched_count = sum(1 for p in matched_pairs if p.matched)
        unmatched_count = total_pairs - matched_count
        
        stats = {
            'metric': self.metric_name,
            'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            'total_pairs': total_pairs,
            'evaluated_pairs': len(scores),
            'matched_pairs': matched_count,
            'unmatched_pairs': unmatched_count,
        }
        
        if scores:
            stats.update({
                'mean_score': float(np.mean(scores)),
                'median_score': float(np.median(scores)),
                'std_score': float(np.std(scores)),
                'min_score': float(np.min(scores)),
                'max_score': float(np.max(scores)),
            })
        else:
            stats.update({
                'mean_score': 0.0,
                'median_score': 0.0,
                'std_score': 0.0,
                'min_score': 0.0,
                'max_score': 0.0,
            })
        
        return stats
    
    def print_summary(self, result: EvaluationResult) -> None:
        """Print evaluation summary to console."""
        stats = result.statistics
        
        print(f"\n{'='*60}")
        print(f"{self.metric_name} Evaluation Results")
        print(f"{'='*60}")
        print(f"Total pairs: {stats['total_pairs']}")
        print(f"Evaluated pairs: {stats['evaluated_pairs']}")
        print(f"\nScore Statistics:")
        print(f"  Mean:   {stats['mean_score']:.4f}")
        print(f"  Median: {stats['median_score']:.4f}")
        print(f"  Std:    {stats['std_score']:.4f}")
        print(f"  Min:    {stats['min_score']:.4f}")
        print(f"  Max:    {stats['max_score']:.4f}")
        print(f"{'='*60}")
        print(f"{self.metric_name} Score (Mean): {stats['mean_score']:.4f}")
        print(f"{'='*60}\n")

"""
CIDEr evaluator for Audio Description quality assessment.

CIDEr uses TF-IDF weighted n-gram similarity.
"""

import math
from typing import Dict, Any, Optional, List
from collections import defaultdict

from .base import BaseEvaluator, EvaluationResult
from ..utils import MatchedPair

# Optional imports
try:
    from nltk.tokenize import word_tokenize
    from nltk.util import ngrams
    import nltk
    NLTK_AVAILABLE = True
except ImportError:
    NLTK_AVAILABLE = False


def ensure_nltk_data():
    """Download required NLTK data if not available."""
    if not NLTK_AVAILABLE:
        return
    
    try:
        nltk.data.find('tokenizers/punkt')
    except LookupError:
        nltk.download('punkt', quiet=True)
    try:
        nltk.data.find('tokenizers/punkt_tab')
    except LookupError:
        nltk.download('punkt_tab', quiet=True)


class CIDErScorer:
    """
    CIDEr scorer implementation.
    
    Computes CIDEr score based on TF-IDF weighted n-gram matching.
    """
    
    def __init__(self, n: int = 4, sigma: float = 6.0):
        """
        Initialize CIDEr scorer.
        
        Args:
            n: Maximum n-gram size
            sigma: Gaussian penalty sigma for length difference
        """
        self.n = n
        self.sigma = sigma
        self.document_frequency = defaultdict(float)
        self.ref_len = None
    
    def _get_ngrams(self, text: str, n: int) -> list:
        """Get n-grams from text."""
        tokens = word_tokenize(text.lower())
        return list(ngrams(tokens, n)) if len(tokens) >= n else []
    
    def _count_ngrams(self, text: str) -> dict:
        """Count n-grams for all n from 1 to self.n."""
        counts = {}
        for n in range(1, self.n + 1):
            ngram_list = self._get_ngrams(text, n)
            counts[n] = defaultdict(int)
            for ng in ngram_list:
                counts[n][ng] += 1
        return counts
    
    def compute_doc_freq(self, references: List[str]) -> None:
        """
        Compute document frequency from all reference texts.
        
        Args:
            references: List of reference texts
        """
        self.ref_len = len(references)
        
        for ref in references:
            seen = set()
            for n in range(1, self.n + 1):
                ngram_list = self._get_ngrams(ref, n)
                for ng in ngram_list:
                    if ng not in seen:
                        self.document_frequency[ng] += 1
                        seen.add(ng)
    
    def _compute_tfidf(self, counts: dict, ref_len: int) -> dict:
        """Compute TF-IDF vector for n-gram counts."""
        vec = defaultdict(float)
        norm = 0.0
        
        for n in range(1, self.n + 1):
            for ng, count in counts[n].items():
                tf = count / max(sum(counts[n].values()), 1)
                df = self.document_frequency.get(ng, 0)
                idf = math.log((ref_len + 1.0) / (df + 1.0))
                vec[ng] = tf * idf
                norm += vec[ng] ** 2
        
        norm = math.sqrt(norm)
        if norm > 0:
            for ng in vec:
                vec[ng] /= norm
        
        return vec
    
    def _cosine_similarity(self, vec1: dict, vec2: dict) -> float:
        """Compute cosine similarity between two vectors."""
        score = 0.0
        for ng in vec1:
            if ng in vec2:
                score += vec1[ng] * vec2[ng]
        return score
    
    def compute_score(self, reference: str, hypothesis: str) -> float:
        """
        Compute CIDEr score for a single pair.
        
        Args:
            reference: Reference text
            hypothesis: Hypothesis text
            
        Returns:
            CIDEr score (0-10 scale)
        """
        ref_counts = self._count_ngrams(reference)
        hyp_counts = self._count_ngrams(hypothesis)
        
        ref_vec = self._compute_tfidf(ref_counts, self.ref_len or 1)
        hyp_vec = self._compute_tfidf(hyp_counts, self.ref_len or 1)
        
        score = self._cosine_similarity(ref_vec, hyp_vec)
        
        # Length penalty
        ref_len = len(word_tokenize(reference.lower()))
        hyp_len = len(word_tokenize(hypothesis.lower()))
        
        if self.sigma > 0:
            length_diff = hyp_len - ref_len
            penalty = math.exp(-(length_diff ** 2) / (2 * self.sigma ** 2))
            score *= penalty
        
        return score * 10.0


class CIDErEvaluator(BaseEvaluator):
    """
    CIDEr evaluator using TF-IDF weighted n-grams.
    
    Returns CIDEr score in range [0, 10].
    """
    
    def __init__(
        self,
        n_gram: int = 4,
        sigma: float = 6.0,
        config: Any = None,
    ):
        """
        Initialize CIDEr evaluator.
        
        Args:
            n_gram: Maximum n-gram size
            sigma: Length penalty sigma
            config: Optional CIDErConfig object
        """
        super().__init__(config)
        
        if not NLTK_AVAILABLE:
            raise ImportError("nltk is required. Install with: pip install nltk")
        
        ensure_nltk_data()
        
        self.n_gram = n_gram
        self.sigma = sigma
        self._scorer = None
    
    @property
    def metric_name(self) -> str:
        return "CIDEr"
    
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Evaluate a single pair using CIDEr."""
        if self._scorer is None:
            # Create scorer with single reference
            self._scorer = CIDErScorer(n=self.n_gram, sigma=self.sigma)
            self._scorer.compute_doc_freq([ref_text])
        
        score = self._scorer.compute_score(ref_text, gen_text)
        return {'score': float(score)}
    
    def evaluate_batch(
        self,
        matched_pairs: List[MatchedPair],
        show_progress: bool = True
    ) -> EvaluationResult:
        """
        Evaluate all matched pairs with shared document frequency.
        """
        from tqdm import tqdm
        
        pairs_to_eval = [p for p in matched_pairs if p.matched]
        
        if not pairs_to_eval:
            return EvaluationResult(
                pairs=[],
                statistics=self._calculate_statistics([], matched_pairs),
                metric_name=self.metric_name,
            )
        
        # Compute document frequency from all references
        all_refs = [p.combined_ref_text for p in pairs_to_eval]
        scorer = CIDErScorer(n=self.n_gram, sigma=self.sigma)
        scorer.compute_doc_freq(all_refs)
        
        # Evaluate pairs
        results = []
        scores = []
        
        iterator = tqdm(pairs_to_eval, desc=f"Evaluating {self.metric_name}") if show_progress else pairs_to_eval
        
        for pair in iterator:
            score = scorer.compute_score(pair.combined_ref_text, pair.combined_gen_text)
            
            pair_result = pair.to_dict()
            pair_result['score'] = float(score)
            results.append(pair_result)
            scores.append(score)
        
        stats = self._calculate_statistics(scores, matched_pairs)
        stats['n_gram'] = self.n_gram
        
        return EvaluationResult(
            pairs=results,
            statistics=stats,
            metric_name=self.metric_name,
        )

"""
CRITIC evaluator for Audio Description quality assessment.

CRITIC (Co-Referencing In Text for Identifying Characters) evaluates
character identification accuracy between generated and reference AD.
"""

import json
from typing import Dict, Any, Optional, List
import numpy as np

from .base import BaseEvaluator, EvaluationResult
from ..utils import MatchedPair

# Optional imports
try:
    from fastcoref import FCoref
    FCOREF_AVAILABLE = True
except ImportError:
    FCOREF_AVAILABLE = False


class CRITICEvaluator(BaseEvaluator):
    """
    CRITIC evaluator for character identification.
    
    Uses coreference resolution to identify character mentions and computes
    IoU between character sets in generated and reference AD.
    """
    
    def __init__(
        self,
        characters: Optional[List[str]] = None,
        characters_file: Optional[str] = None,
        device: str = "cpu",
        config: Any = None,
    ):
        """
        Initialize CRITIC evaluator.
        
        Args:
            characters: List of character names
            characters_file: Path to JSON file with character list
            device: Device for FCoref model ('cpu' or 'cuda:0')
            config: Optional CRITICConfig object
        """
        super().__init__(config)
        
        if not FCOREF_AVAILABLE:
            raise ImportError("fastcoref is required. Install with: pip install fastcoref")
        
        self.device = device
        self.coref_model = None
        
        # Load character list
        if characters_file:
            with open(characters_file, 'r') as f:
                self.characters = json.load(f)
        elif characters:
            self.characters = characters
        else:
            self.characters = []
        
        if not self.characters:
            print("Warning: No character list provided. CRITIC evaluation may be less accurate.")
    
    @property
    def metric_name(self) -> str:
        return "CRITIC"
    
    def _init_coref_model(self):
        """Initialize FCoref model lazily."""
        if self.coref_model is None:
            try:
                self.coref_model = FCoref(device=self.device, enable_progress_bar=False)
                print(f"FCoref model initialized on {self.device}")
            except Exception as e:
                print(f"Failed to use {self.device}: {e}")
                print("Falling back to CPU...")
                self.coref_model = FCoref(device='cpu', enable_progress_bar=False)
    
    def _build_synonym(
        self,
        coref_data,
        source_idx: List[int],
        role_names: List[str],
        drop_pronouns: bool = True
    ) -> tuple:
        """Extract clusters containing character names."""
        coref_text = coref_data.text
        total_rows = int(np.max(source_idx) + 1)
        synonym_rows = {idx: [] for idx in range(total_rows)}
        synonym_rows_cid = {idx: [] for idx in range(total_rows)}
        synonym_rows_origin = {idx: [] for idx in range(total_rows)}
        
        for cluster in coref_data.get_clusters(as_strings=False):
            cluster_name = None
            cluster_str_origin = [coref_text[x[0]:x[1]] for x in cluster]
            cluster_str = [coref_text[x[0]:x[1]] for x in cluster]
            match_role_set = set(cluster_str).intersection(set(role_names))
            
            if len(match_role_set) > 0:
                if len(match_role_set) != 1:
                    continue
                
                cluster_name = list(match_role_set)[0]
                cluster_source_idx = [source_idx[x[0]:x[1]] for x in cluster]
                
                if len(cluster_name.split()) > 1:
                    cluster_str.extend([
                        cluster_name.split()[0], cluster_name.split()[-1],
                        cluster_name.split()[0].lower(), cluster_name.split()[-1].lower(),
                        cluster_name.split()[0].upper(), cluster_name.split()[-1].upper()
                    ])
                
                synonym_set = list(set(cluster_str))
                if drop_pronouns:
                    synonym_set = [i for i in synonym_set if i.lower() not in 
                                   ['she', 'he', 'her', 'his', 'they', 'him']]
                
                for item, text in zip(cluster_source_idx, cluster_str_origin):
                    if np.mean(item) != np.max(item):
                        continue
                    if item[0] != -1:
                        if cluster_name not in synonym_rows_cid[int(item[0])]:
                            synonym_rows[int(item[0])].append(synonym_set)
                            synonym_rows_cid[int(item[0])].append(cluster_name)
                            synonym_rows_origin[int(item[0])].append(text)
        
        return synonym_rows, synonym_rows_origin, synonym_rows_cid
    
    @staticmethod
    def _get_iou(list1: List[str], list2: List[str]) -> float:
        """Compute IoU of two lists."""
        intersection = set(list1).intersection(set(list2))
        union = set(list1).union(set(list2))
        if len(union) == 0:
            return 0.0
        return len(intersection) / len(union)
    
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """
        Evaluate a single pair using CRITIC.
        
        Note: For efficiency, use evaluate_batch() instead.
        """
        # This is a simplified version - full CRITIC requires batch processing
        self._init_coref_model()
        
        roles_str = ""
        if len(self.characters) > 1:
            roles_str = ', '.join(self.characters[:-1]) + ' and '
        if len(self.characters) > 0:
            roles_str += self.characters[-1] + '.'
        
        # Predict coreference
        ref_pred = self.coref_model.predict(texts=[f"{roles_str} {ref_text}"])[0]
        gen_pred = self.coref_model.predict(texts=[f"{roles_str} {gen_text}"])[0]
        
        # Extract character mentions (simplified)
        ref_chars = set()
        gen_chars = set()
        
        for cluster in ref_pred.get_clusters(as_strings=True):
            for mention in cluster:
                if mention in self.characters:
                    ref_chars.add(mention)
        
        for cluster in gen_pred.get_clusters(as_strings=True):
            for mention in cluster:
                if mention in self.characters:
                    gen_chars.add(mention)
        
        iou = self._get_iou(list(ref_chars), list(gen_chars))
        
        return {
            'score': iou,
            'ref_characters': list(ref_chars),
            'gen_characters': list(gen_chars),
        }
    
    def evaluate_batch(
        self,
        matched_pairs: List[MatchedPair],
        show_progress: bool = True
    ) -> EvaluationResult:
        """
        Evaluate all matched pairs using CRITIC.
        
        More efficient than individual pair evaluation due to batch coreference.
        """
        from tqdm import tqdm
        
        self._init_coref_model()
        
        pairs_to_eval = [p for p in matched_pairs if p.matched]
        
        if not pairs_to_eval:
            return EvaluationResult(
                pairs=[],
                statistics=self._calculate_statistics([], matched_pairs),
                metric_name=self.metric_name,
            )
        
        # Prepare character list string
        roles_str = ""
        if len(self.characters) > 1:
            roles_str = ', '.join(self.characters[:-1]) + ' and '
        if len(self.characters) > 0:
            roles_str += self.characters[-1] + '.'
        
        # Prepare texts
        ref_texts = [p.combined_ref_text for p in pairs_to_eval]
        gen_texts = [p.combined_gen_text for p in pairs_to_eval]
        
        # Build source indices for batch processing
        ref_text_combined = ' '.join(ref_texts)
        gen_text_combined = ' '.join(gen_texts)
        
        ref_source_idx_list = [[i]*len(x) for i, x in enumerate(ref_texts)]
        gen_source_idx_list = [[i]*len(x) for i, x in enumerate(gen_texts)]
        
        ref_source_idx = []
        for i, item in enumerate(ref_source_idx_list):
            if i != 0:
                item = [-1] + item
            ref_source_idx.extend(item)
        
        gen_source_idx = []
        for i, item in enumerate(gen_source_idx_list):
            if i != 0:
                item = [-1] + item
            gen_source_idx.extend(item)
        
        # Add prefix for character list
        ref_source_idx = [-1] * (len(roles_str) + 1) + ref_source_idx
        gen_source_idx = [-1] * (len(roles_str) + 1) + gen_source_idx
        
        # Run coreference
        print("Running coreference analysis on reference texts...")
        ref_coref = self.coref_model.predict(texts=[f"{roles_str} {ref_text_combined}"])[0]
        
        print("Running coreference analysis on generated texts...")
        gen_coref = self.coref_model.predict(texts=[f"{roles_str} {gen_text_combined}"])[0]
        
        # Build synonym sets
        print("Building synonym sets...")
        ref_synonyms, ref_origins, ref_cids = self._build_synonym(ref_coref, ref_source_idx, self.characters)
        gen_synonyms, gen_origins, gen_cids = self._build_synonym(gen_coref, gen_source_idx, self.characters)
        
        # Compute IoU for each pair
        print("Computing character IoU for each pair...")
        results = []
        scores = []
        
        for idx, pair in enumerate(tqdm(pairs_to_eval) if show_progress else pairs_to_eval):
            ref_chars = ref_cids.get(idx, [])
            gen_chars = gen_cids.get(idx, [])
            
            if len(ref_chars) > 0:
                iou = self._get_iou(ref_chars, gen_chars)
                scores.append(iou)
            else:
                iou = None  # No characters in reference
            
            pair_result = pair.to_dict()
            pair_result.update({
                'score': iou,
                'ref_characters': ref_chars,
                'gen_characters': gen_chars,
            })
            results.append(pair_result)
        
        stats = self._calculate_statistics(scores, matched_pairs)
        stats['pairs_with_characters'] = len(scores)
        stats['characters_used'] = self.characters[:10]  # First 10 for reference
        
        return EvaluationResult(
            pairs=results,
            statistics=stats,
            metric_name=self.metric_name,
        )

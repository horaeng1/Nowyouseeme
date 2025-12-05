"""
Matching algorithms for aligning generated AD with reference AD.

This module provides three matching strategies:
1. ClusterMatcher: Time-overlap based clustering (N:M matching)
2. DPMatcher: Dynamic Programming based alignment (1:1 matching with gaps)
3. OverlapMatcher: Simple time-overlap matching (1:N matching)

All matchers return a list of MatchedPair objects.
"""

import math
import numpy as np
from abc import ABC, abstractmethod
from typing import List, Tuple, Optional, Callable, Dict, Any
from dataclasses import dataclass

from .utils import ADEvent, MatchedPair, combine_texts


# ============================================================
# Base Matcher Class
# ============================================================

class BaseMatcher(ABC):
    """Abstract base class for all matchers."""
    
    @abstractmethod
    def match(
        self,
        gen_events: List[ADEvent],
        ref_events: List[ADEvent]
    ) -> List[MatchedPair]:
        """
        Match generated events to reference events.
        
        Args:
            gen_events: List of generated AD events
            ref_events: List of reference AD events
            
        Returns:
            List of MatchedPair objects
        """
        pass
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Return the name of this matcher."""
        pass


# ============================================================
# Union-Find for Cluster Matcher
# ============================================================

class UnionFind:
    """Disjoint Set Union data structure for clustering."""
    
    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n
    
    def find(self, x: int) -> int:
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]
    
    def union(self, x: int, y: int) -> None:
        px, py = self.find(x), self.find(y)
        if px == py:
            return
        if self.rank[px] < self.rank[py]:
            px, py = py, px
        self.parent[py] = px
        if self.rank[px] == self.rank[py]:
            self.rank[px] += 1


# ============================================================
# Cluster Matcher (N:M Matching)
# ============================================================

class ClusterMatcher(BaseMatcher):
    """
    Cluster-based matcher using time overlap.
    
    Groups generated and reference events into clusters based on time overlap.
    Supports N:M matching where multiple generated items can match multiple reference items.
    """
    
    def __init__(self, min_overlap_sec: float = 0.5):
        """
        Initialize ClusterMatcher.
        
        Args:
            min_overlap_sec: Minimum overlap in seconds to consider events as related
        """
        self.min_overlap_sec = min_overlap_sec
    
    @property
    def name(self) -> str:
        return "cluster"
    
    def match(
        self,
        gen_events: List[ADEvent],
        ref_events: List[ADEvent]
    ) -> List[MatchedPair]:
        """Match using cluster-based grouping."""
        # Create unified event list
        events = []
        
        # Add generated events
        for event in gen_events:
            events.append({
                'event': event,
                'source': 'generated',
            })
        
        # Add reference events
        for event in ref_events:
            events.append({
                'event': event,
                'source': 'reference',
            })
        
        n = len(events)
        if n == 0:
            return []
        
        # Build clusters using Union-Find
        uf = UnionFind(n)
        
        for i in range(n):
            for j in range(i + 1, n):
                e1 = events[i]['event']
                e2 = events[j]['event']
                if e1.overlaps_with(e2, self.min_overlap_sec):
                    uf.union(i, j)
        
        # Group events by cluster
        clusters: Dict[int, List[dict]] = {}
        for i in range(n):
            root = uf.find(i)
            if root not in clusters:
                clusters[root] = []
            clusters[root].append(events[i])
        
        # Create matched pairs from clusters
        matched_pairs = []
        
        for cluster_events in clusters.values():
            gen_in_cluster = [e['event'] for e in cluster_events if e['source'] == 'generated']
            ref_in_cluster = [e['event'] for e in cluster_events if e['source'] == 'reference']
            
            if gen_in_cluster and ref_in_cluster:
                # Matched cluster
                gen_sorted = sorted(gen_in_cluster, key=lambda e: e.start)
                ref_sorted = sorted(ref_in_cluster, key=lambda e: e.start)
                
                matched_pairs.append(MatchedPair(
                    gen_events=gen_sorted,
                    ref_events=ref_sorted,
                    gen_indices=[e.index for e in gen_sorted],
                    ref_indices=[e.index for e in ref_sorted],
                    combined_gen_text=combine_texts(gen_sorted),
                    combined_ref_text=combine_texts(ref_sorted),
                    gen_start=min(e.start for e in gen_sorted),
                    gen_end=max(e.end for e in gen_sorted),
                    ref_start=min(e.start for e in ref_sorted),
                    ref_end=max(e.end for e in ref_sorted),
                    matched=True,
                    match_type='cluster',
                ))
            elif gen_in_cluster:
                # Generated-only cluster (no matching reference)
                for event in gen_in_cluster:
                    matched_pairs.append(MatchedPair(
                        gen_events=[event],
                        ref_events=[],
                        gen_indices=[event.index],
                        ref_indices=[],
                        combined_gen_text=event.text,
                        combined_ref_text='',
                        gen_start=event.start,
                        gen_end=event.end,
                        ref_start=None,
                        ref_end=None,
                        matched=False,
                        match_type='generated_only',
                    ))
            elif ref_in_cluster:
                # Reference-only cluster (no matching generated)
                for event in ref_in_cluster:
                    matched_pairs.append(MatchedPair(
                        gen_events=[],
                        ref_events=[event],
                        gen_indices=[],
                        ref_indices=[event.index],
                        combined_gen_text='',
                        combined_ref_text=event.text,
                        gen_start=None,
                        gen_end=None,
                        ref_start=event.start,
                        ref_end=event.end,
                        matched=False,
                        match_type='reference_only',
                    ))
        
        # Sort by time (gen_start for matched/gen_only, ref_start for ref_only)
        def sort_key(p):
            if p.gen_start is not None:
                return (p.gen_start, 0)
            elif p.ref_start is not None:
                return (p.ref_start, 1)
            return (0, 2)
        
        matched_pairs.sort(key=sort_key)
        
        return matched_pairs


# ============================================================
# Overlap Matcher (1:N Matching)
# ============================================================

class OverlapMatcher(BaseMatcher):
    """
    Simple overlap-based matcher.
    
    For each generated event, finds all overlapping reference events.
    Supports 1:N matching where one generated item matches multiple reference items.
    """
    
    def __init__(self, min_overlap_sec: float = 0.5):
        """
        Initialize OverlapMatcher.
        
        Args:
            min_overlap_sec: Minimum overlap in seconds to consider a match
        """
        self.min_overlap_sec = min_overlap_sec
    
    @property
    def name(self) -> str:
        return "overlap"
    
    def match(
        self,
        gen_events: List[ADEvent],
        ref_events: List[ADEvent]
    ) -> List[MatchedPair]:
        """Match using simple time overlap."""
        matched_pairs = []
        
        for gen_event in gen_events:
            # Find overlapping reference events
            overlapping = []
            for ref_event in ref_events:
                overlap = gen_event.overlap_duration(ref_event)
                if overlap >= self.min_overlap_sec:
                    overlapping.append((ref_event, overlap))
            
            if overlapping:
                # Sort by overlap duration
                overlapping.sort(key=lambda x: -x[1])
                ref_sorted = [r for r, _ in overlapping]
                
                matched_pairs.append(MatchedPair(
                    gen_events=[gen_event],
                    ref_events=ref_sorted,
                    gen_indices=[gen_event.index],
                    ref_indices=[r.index for r in ref_sorted],
                    combined_gen_text=gen_event.text,
                    combined_ref_text=combine_texts(ref_sorted),
                    gen_start=gen_event.start,
                    gen_end=gen_event.end,
                    ref_start=min(r.start for r in ref_sorted),
                    ref_end=max(r.end for r in ref_sorted),
                    matched=True,
                    match_type='overlap',
                ))
            else:
                # No match found
                matched_pairs.append(MatchedPair(
                    gen_events=[gen_event],
                    ref_events=[],
                    gen_indices=[gen_event.index],
                    ref_indices=[],
                    combined_gen_text=gen_event.text,
                    combined_ref_text='',
                    gen_start=gen_event.start,
                    gen_end=gen_event.end,
                    ref_start=None,
                    ref_end=None,
                    matched=False,
                    match_type='no_overlap',
                ))
        
        return matched_pairs


# ============================================================
# DP Matcher (1:1 Matching with Gaps)
# ============================================================

class DPMatcher(BaseMatcher):
    """
    Dynamic Programming based matcher (Needleman-Wunsch variant).
    
    Aligns generated and reference sequences considering both temporal and
    textual similarity. Produces 1:1 matching with gap handling.
    """
    
    def __init__(
        self,
        w_time: float = 0.3,
        w_text: float = 0.7,
        gap_penalty_gen: float = -0.2,
        gap_penalty_ref: float = -0.2,
        time_scale: float = 10.0,
        time_soft: bool = True,
        text_sim_func: Optional[Callable[[str, str], float]] = None,
    ):
        """
        Initialize DPMatcher.
        
        Args:
            w_time: Weight for time similarity
            w_text: Weight for text similarity
            gap_penalty_gen: Penalty for skipping a generated item
            gap_penalty_ref: Penalty for skipping a reference item
            time_scale: Scale for soft time similarity
            time_soft: If True, use soft time similarity; else use temporal IoU
            text_sim_func: Function for text similarity (default: token overlap)
        """
        self.w_time = w_time
        self.w_text = w_text
        self.gap_penalty_gen = gap_penalty_gen
        self.gap_penalty_ref = gap_penalty_ref
        self.time_scale = time_scale
        self.time_soft = time_soft
        self.text_sim_func = text_sim_func or self._token_overlap_similarity
    
    @property
    def name(self) -> str:
        return "dp"
    
    @staticmethod
    def _token_overlap_similarity(a: str, b: str) -> float:
        """Simple Jaccard similarity based on token overlap."""
        sa = set(a.lower().split())
        sb = set(b.lower().split())
        if not sa or not sb:
            return 0.0
        inter = len(sa & sb)
        union = len(sa | sb)
        return inter / union
    
    @staticmethod
    def _temporal_iou(g: ADEvent, r: ADEvent) -> float:
        """Calculate temporal Intersection over Union."""
        inter_start = max(g.start, r.start)
        inter_end = min(g.end, r.end)
        intersection = max(0, inter_end - inter_start)
        union = (g.end - g.start) + (r.end - r.start) - intersection
        if union <= 0:
            return 0.0
        return intersection / union
    
    def _soft_time_similarity(self, g: ADEvent, r: ADEvent) -> float:
        """Soft time similarity based on start time difference."""
        dt = abs(g.start - r.start)
        return math.exp(-dt / self.time_scale)
    
    def _combined_similarity(self, g: ADEvent, r: ADEvent) -> float:
        """Combined similarity using time and text."""
        # Text similarity
        s_text = self.text_sim_func(g.text, r.text)
        
        # Time similarity
        if self.time_soft:
            s_time = self._soft_time_similarity(g, r)
        else:
            s_time = self._temporal_iou(g, r)
        
        return self.w_time * s_time + self.w_text * s_text
    
    def _build_similarity_matrix(
        self,
        gen_events: List[ADEvent],
        ref_events: List[ADEvent]
    ) -> np.ndarray:
        """Build similarity matrix between events."""
        n, m = len(gen_events), len(ref_events)
        S = np.zeros((n, m), dtype=float)
        
        for i, g in enumerate(gen_events):
            for j, r in enumerate(ref_events):
                S[i, j] = self._combined_similarity(g, r)
        
        return S
    
    def _dp_align(
        self,
        sim_matrix: np.ndarray
    ) -> List[Tuple[Optional[int], Optional[int], float]]:
        """Run DP alignment and return alignment list."""
        n, m = sim_matrix.shape
        
        # DP table
        dp = np.full((n + 1, m + 1), -1e9, dtype=float)
        bt = np.zeros((n + 1, m + 1), dtype=int)  # 0=diagonal, 1=up, 2=left
        
        dp[0, 0] = 0.0
        
        # Initialize
        for i in range(1, n + 1):
            dp[i, 0] = dp[i - 1, 0] + self.gap_penalty_gen
            bt[i, 0] = 1
        for j in range(1, m + 1):
            dp[0, j] = dp[0, j - 1] + self.gap_penalty_ref
            bt[0, j] = 2
        
        # Fill DP table
        for i in range(1, n + 1):
            for j in range(1, m + 1):
                match_score = dp[i - 1, j - 1] + sim_matrix[i - 1, j - 1]
                skip_gen_score = dp[i - 1, j] + self.gap_penalty_gen
                skip_ref_score = dp[i, j - 1] + self.gap_penalty_ref
                
                best = match_score
                bt[i, j] = 0
                if skip_gen_score > best:
                    best = skip_gen_score
                    bt[i, j] = 1
                if skip_ref_score > best:
                    best = skip_ref_score
                    bt[i, j] = 2
                dp[i, j] = best
        
        # Backtracking
        alignment = []
        i, j = n, m
        while i > 0 or j > 0:
            move = bt[i, j]
            if i > 0 and j > 0 and move == 0:
                score = sim_matrix[i - 1, j - 1]
                alignment.append((i - 1, j - 1, score))
                i -= 1
                j -= 1
            elif i > 0 and (j == 0 or move == 1):
                alignment.append((i - 1, None, self.gap_penalty_gen))
                i -= 1
            else:
                alignment.append((None, j - 1, self.gap_penalty_ref))
                j -= 1
        
        alignment.reverse()
        return alignment
    
    def match(
        self,
        gen_events: List[ADEvent],
        ref_events: List[ADEvent]
    ) -> List[MatchedPair]:
        """Match using DP alignment."""
        if not gen_events or not ref_events:
            return []
        
        # Build similarity matrix
        sim_matrix = self._build_similarity_matrix(gen_events, ref_events)
        
        # Run DP alignment
        alignment = self._dp_align(sim_matrix)
        
        # Convert to MatchedPair objects
        matched_pairs = []
        
        for g_idx, r_idx, score in alignment:
            if g_idx is not None and r_idx is not None:
                # Matched pair
                g = gen_events[g_idx]
                r = ref_events[r_idx]
                
                matched_pairs.append(MatchedPair(
                    gen_events=[g],
                    ref_events=[r],
                    gen_indices=[g.index],
                    ref_indices=[r.index],
                    combined_gen_text=g.text,
                    combined_ref_text=r.text,
                    gen_start=g.start,
                    gen_end=g.end,
                    ref_start=r.start,
                    ref_end=r.end,
                    matched=True,
                    match_type='dp_match',
                    score=score,
                ))
            elif g_idx is not None:
                # Unmatched generated
                g = gen_events[g_idx]
                matched_pairs.append(MatchedPair(
                    gen_events=[g],
                    ref_events=[],
                    gen_indices=[g.index],
                    ref_indices=[],
                    combined_gen_text=g.text,
                    combined_ref_text='',
                    gen_start=g.start,
                    gen_end=g.end,
                    ref_start=None,
                    ref_end=None,
                    matched=False,
                    match_type='dp_gen_gap',
                    score=score,
                ))
            else:
                # Unmatched reference
                r = ref_events[r_idx]
                matched_pairs.append(MatchedPair(
                    gen_events=[],
                    ref_events=[r],
                    gen_indices=[],
                    ref_indices=[r.index],
                    combined_gen_text='',
                    combined_ref_text=r.text,
                    gen_start=None,
                    gen_end=None,
                    ref_start=r.start,
                    ref_end=r.end,
                    matched=False,
                    match_type='dp_ref_gap',
                    score=score,
                ))
        
        return matched_pairs


# ============================================================
# Matcher Factory
# ============================================================

def get_matcher(
    method: str = "cluster",
    **kwargs
) -> BaseMatcher:
    """
    Get a matcher instance by name.
    
    Args:
        method: Matcher method name ('cluster', 'dp', 'overlap')
        **kwargs: Additional arguments passed to the matcher constructor
        
    Returns:
        BaseMatcher instance
    """
    matchers = {
        'cluster': ClusterMatcher,
        'dp': DPMatcher,
        'overlap': OverlapMatcher,
    }
    
    method_lower = method.lower()
    if method_lower not in matchers:
        raise ValueError(f"Unknown matcher: {method}. Available: {list(matchers.keys())}")
    
    return matchers[method_lower](**kwargs)

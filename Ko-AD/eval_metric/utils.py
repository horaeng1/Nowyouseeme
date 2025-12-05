"""
Common utility functions for audio description evaluation.

This module provides shared functionality used across matchers and evaluators:
- Timestamp conversion
- Data loading (JSON/CSV)
- Output filename generation
- Data classes
"""

import os
import json
import pandas as pd
from datetime import datetime
from dataclasses import dataclass
from typing import List, Tuple, Optional, Dict, Any


@dataclass
class ADEvent:
    """Audio Description Event with start time, end time, and text."""
    start: float
    end: float
    text: str
    index: int = -1  # Original index in the list
    
    def duration(self) -> float:
        """Return duration of the event in seconds."""
        return self.end - self.start
    
    def overlaps_with(self, other: 'ADEvent', min_overlap: float = 0.0) -> bool:
        """Check if this event overlaps with another by at least min_overlap seconds."""
        overlap_start = max(self.start, other.start)
        overlap_end = min(self.end, other.end)
        overlap_duration = max(0, overlap_end - overlap_start)
        return overlap_duration >= min_overlap
    
    def overlap_duration(self, other: 'ADEvent') -> float:
        """Calculate overlap duration with another event."""
        overlap_start = max(self.start, other.start)
        overlap_end = min(self.end, other.end)
        return max(0, overlap_end - overlap_start)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            'start': self.start,
            'end': self.end,
            'text': self.text,
            'index': self.index,
        }


@dataclass
class MatchedPair:
    """A matched pair of generated and reference AD events."""
    gen_events: List[ADEvent]
    ref_events: List[ADEvent]
    gen_indices: List[int]
    ref_indices: List[int]
    combined_gen_text: str
    combined_ref_text: str
    gen_start: float
    gen_end: float
    ref_start: Optional[float]
    ref_end: Optional[float]
    matched: bool
    match_type: str
    score: Optional[float] = None
    
    @property
    def num_gen_items(self) -> int:
        return len(self.gen_events)
    
    @property
    def num_ref_items(self) -> int:
        return len(self.ref_events)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for DataFrame/JSON output."""
        return {
            'gen_indices': ','.join(map(str, self.gen_indices)),
            'ref_indices': ','.join(map(str, self.ref_indices)),
            'gen_start': self.gen_start,
            'gen_end': self.gen_end,
            'ref_start': self.ref_start,
            'ref_end': self.ref_end,
            'text_gen': self.combined_gen_text,
            'text_ref': self.combined_ref_text,
            'num_gen_items': self.num_gen_items,
            'num_ref_items': self.num_ref_items,
            'matched': self.matched,
            'match_type': self.match_type,
            'score': self.score,
        }


def timestamp_to_seconds(timestamp_str: str) -> float:
    """
    Convert timestamp string from various formats to seconds.
    
    Supports:
        - "분:초.밀리초" format (e.g., "7:01.7" -> 421.7)
        - Plain seconds (e.g., "421.7" -> 421.7)
        - HH:MM:SS format (e.g., "1:23:45" -> 5025.0)
    
    Args:
        timestamp_str: Timestamp string to convert
        
    Returns:
        Time in seconds as float
    """
    if not isinstance(timestamp_str, str):
        return float(timestamp_str)
    
    parts = timestamp_str.split(':')
    
    if len(parts) == 3:
        # HH:MM:SS format
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = float(parts[2])
        return hours * 3600 + minutes * 60 + seconds
    elif len(parts) == 2:
        # MM:SS.ms format
        minutes = int(parts[0])
        seconds = float(parts[1])
        return minutes * 60 + seconds
    else:
        # Plain seconds
        return float(timestamp_str)


def load_generated_ad(file_path: str) -> List[ADEvent]:
    """
    Load AI-generated AD from JSON file.
    
    Expected JSON structure:
    {
        "audio_descriptions": [
            {
                "start_time": "0:05.2",
                "end_time": "0:10.5",
                "description": "A man walks..."
            },
            ...
        ]
    }
    
    Args:
        file_path: Path to JSON file
        
    Returns:
        List of ADEvent objects sorted by start time
    """
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    events = []
    for idx, item in enumerate(data.get('audio_descriptions', [])):
        start = timestamp_to_seconds(item['start_time'])
        end = timestamp_to_seconds(item['end_time'])
        text = item.get('description', item.get('text', ''))
        events.append(ADEvent(start=start, end=end, text=text, index=idx))
    
    return sorted(events, key=lambda x: x.start)


def load_reference_ad(
    file_path: str, 
    time_range: Optional[Tuple[float, float]] = None,
    filter_ad_only: bool = True
) -> List[ADEvent]:
    """
    Load reference AD from CSV file.
    
    Expected CSV columns:
        - text: AD text content
        - start: Start time in seconds
        - end: End time in seconds
        - speech_type (optional): 'ad' for audio descriptions
    
    Args:
        file_path: Path to CSV file
        time_range: Optional (min_time, max_time) tuple to filter events
        filter_ad_only: If True and speech_type column exists, filter to 'ad' only
        
    Returns:
        List of ADEvent objects sorted by start time
    """
    df = pd.read_csv(file_path)
    
    # Filter only AD rows if speech_type column exists
    if filter_ad_only and 'speech_type' in df.columns:
        df = df[df['speech_type'] == 'ad'].copy()
    
    # Filter by time range if specified
    if time_range:
        min_time, max_time = time_range
        df = df[(df['start'] <= max_time) & (df['end'] >= min_time)].copy()
    
    events = []
    for idx, (_, row) in enumerate(df.iterrows()):
        events.append(ADEvent(
            start=float(row['start']),
            end=float(row['end']),
            text=str(row['text']),
            index=idx
        ))
    
    return sorted(events, key=lambda x: x.start)


def get_time_range(events: List[ADEvent]) -> Tuple[float, float]:
    """
    Get the time range covered by a list of events.
    
    Args:
        events: List of ADEvent objects
        
    Returns:
        Tuple of (min_start_time, max_end_time)
    """
    if not events:
        return (0.0, 0.0)
    
    min_start = min(e.start for e in events)
    max_end = max(e.end for e in events)
    return (min_start, max_end)


def generate_output_filename(
    gen_path: str,
    ref_path: str,
    output_arg: Optional[str] = None,
    prefix: str = "eval",
    extension: str = ".csv"
) -> str:
    """
    Generate output filename with timestamp and input file names.
    
    Args:
        gen_path: Path to generated AD file
        ref_path: Path to reference AD file
        output_arg: User-specified output path (if any)
        prefix: Filename prefix (e.g., 'eval', 'bertscore', 'meteor')
        extension: File extension (default: '.csv')
        
    Returns:
        Generated output file path
    """
    # If user specified a full path, use it
    if output_arg and not output_arg.endswith('/'):
        return output_arg
    
    # Extract base names (truncate if too long)
    gen_name = os.path.splitext(os.path.basename(gen_path))[0][:40]
    ref_name = os.path.splitext(os.path.basename(ref_path))[0][:25]
    
    # Generate timestamp
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Build filename
    filename = f"{prefix}_{gen_name}_vs_{ref_name}_{timestamp}{extension}"
    
    # Determine output directory
    output_dir = output_arg if output_arg else os.path.dirname(gen_path)
    if not output_dir:
        output_dir = '.'
    
    return os.path.join(output_dir, filename)


def combine_texts(events: List[ADEvent], separator: str = ' ') -> str:
    """
    Combine text from multiple events into a single string.
    
    Args:
        events: List of ADEvent objects
        separator: String to use between texts (default: space)
        
    Returns:
        Combined text string
    """
    if not events:
        return ''
    
    # Sort by start time and combine
    sorted_events = sorted(events, key=lambda e: e.start)
    return separator.join(e.text for e in sorted_events)


def calculate_coverage_stats(
    gen_events: List[ADEvent],
    ref_events: List[ADEvent],
    matched_pairs: List[MatchedPair]
) -> Dict[str, Any]:
    """
    Calculate coverage statistics for matched pairs.
    
    Args:
        gen_events: All generated AD events
        ref_events: All reference AD events (should be filtered to gen time range)
        matched_pairs: List of MatchedPair objects
        
    Returns:
        Dictionary with coverage statistics
    """
    gen_time_range = get_time_range(gen_events)
    
    # Count generated items
    gen_total = len(gen_events)
    gen_matched_indices = set()
    for pair in matched_pairs:
        if pair.matched:
            gen_matched_indices.update(pair.gen_indices)
    gen_matched = len(gen_matched_indices)
    gen_unmatched = gen_total - gen_matched
    
    # Count reference items
    ref_total = len(ref_events)
    ref_matched_indices = set()
    for pair in matched_pairs:
        if pair.matched:
            ref_matched_indices.update(pair.ref_indices)
    ref_matched = len(ref_matched_indices)
    ref_unmatched = ref_total - ref_matched
    
    return {
        'gen_time_start': gen_time_range[0],
        'gen_time_end': gen_time_range[1],
        'gen_total': gen_total,
        'gen_matched': gen_matched,
        'gen_unmatched': gen_unmatched,
        'gen_coverage_pct': (gen_matched / gen_total * 100) if gen_total > 0 else 0.0,
        'ref_in_range': ref_total,
        'ref_matched': ref_matched,
        'ref_unmatched': ref_unmatched,
        'ref_coverage_pct': (ref_matched / ref_total * 100) if ref_total > 0 else 0.0,
    }


def format_time(seconds: float) -> str:
    """
    Format seconds as readable time string.
    
    Args:
        seconds: Time in seconds
        
    Returns:
        Formatted string like "1:23.5" or "1:23:45.0"
    """
    if seconds >= 3600:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours}:{minutes:02d}:{secs:05.2f}"
    else:
        minutes = int(seconds // 60)
        secs = seconds % 60
        return f"{minutes}:{secs:05.2f}"


# ============================================================
# Character Extraction for CRITIC Evaluation
# ============================================================

def extract_characters_from_texts(
    texts: List[str],
    min_count: int = 2,
    use_spacy: bool = True,
    spacy_model: str = "en_core_web_sm"
) -> List[str]:
    """
    Extract character names from AD texts using NER or pattern matching.
    
    Args:
        texts: List of AD text strings
        min_count: Minimum occurrences to include a character
        use_spacy: If True, use spaCy NER; else use pattern matching
        spacy_model: spaCy model name to use
        
    Returns:
        List of character names sorted by frequency
    """
    import re
    from collections import Counter
    
    if use_spacy:
        try:
            import spacy
            try:
                nlp = spacy.load(spacy_model)
            except OSError:
                print(f"Downloading spaCy model: {spacy_model}...")
                from spacy.cli import download
                download(spacy_model)
                nlp = spacy.load(spacy_model)
            
            # Extract PERSON entities
            character_counter = Counter()
            for doc in nlp.pipe(texts, batch_size=50):
                for ent in doc.ents:
                    if ent.label_ == "PERSON":
                        name = ent.text.strip()
                        if len(name) >= 2:
                            character_counter[name] += 1
            
            characters = [name for name, count in character_counter.most_common() 
                         if count >= min_count]
            
        except ImportError:
            print("spaCy not available, falling back to pattern matching")
            characters = _extract_characters_pattern(texts, min_count)
    else:
        characters = _extract_characters_pattern(texts, min_count)
    
    # Clean up possessive forms
    characters = _merge_similar_names(characters)
    
    return characters


def _extract_characters_pattern(texts: List[str], min_count: int = 2) -> List[str]:
    """Fallback pattern-based character extraction."""
    import re
    from collections import Counter
    
    # Common words to exclude
    common_words = {
        'The', 'A', 'An', 'He', 'She', 'They', 'It', 'His', 'Her', 'Their',
        'This', 'That', 'These', 'Those', 'Now', 'Then', 'Later', 'Morning',
        'Night', 'Day', 'Inside', 'Outside', 'In', 'On', 'At', 'As', 'And',
        'But', 'Or', 'For', 'With', 'To', 'From', 'By', 'Up', 'Down', 'Out',
        'Back', 'Away', 'Over', 'Under', 'Through', 'After', 'Before', 'Into',
        'During', 'While', 'Meanwhile', 'Suddenly', 'Finally', 'Eventually',
        'Smiling', 'Standing', 'Sitting', 'Walking', 'Running', 'Looking',
        'Holding', 'Wearing', 'Moving', 'Turning', 'Leaving', 'Entering',
        'Opening', 'Closing', 'Watching', 'Listening', 'Speaking', 'Talking',
        'Credits', 'Cast', 'Music', 'Director', 'Producer', 'Written', 'Produced',
    }
    
    name_pattern = re.compile(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b')
    name_counter = Counter()
    
    for text in texts:
        matches = name_pattern.findall(text)
        for match in matches:
            if match.split()[0] not in common_words:
                name_counter[match] += 1
    
    return [name for name, count in name_counter.most_common() if count >= min_count]


def _merge_similar_names(characters: List[str]) -> List[str]:
    """Merge similar character names (e.g., Tim and Tim's)."""
    import re
    
    cleaned = []
    seen_base = set()
    
    for name in characters:
        base_name = re.sub(r"['']s$", "", name)
        if base_name.lower() not in seen_base:
            cleaned.append(base_name)
            seen_base.add(base_name.lower())
    
    return cleaned


def extract_characters_from_csv(
    csv_path: str,
    min_count: int = 2,
    use_spacy: bool = True
) -> List[str]:
    """
    Extract character names from an AD CSV file.
    
    Args:
        csv_path: Path to reference AD CSV file
        min_count: Minimum occurrences to include
        use_spacy: Use spaCy NER if available
        
    Returns:
        List of character names
    """
    df = pd.read_csv(csv_path)
    
    # Filter AD rows
    if 'speech_type' in df.columns:
        df = df[df['speech_type'] == 'ad'].copy()
    
    if 'text' not in df.columns:
        raise ValueError("CSV must have 'text' column")
    
    texts = df['text'].dropna().tolist()
    
    return extract_characters_from_texts(texts, min_count=min_count, use_spacy=use_spacy)

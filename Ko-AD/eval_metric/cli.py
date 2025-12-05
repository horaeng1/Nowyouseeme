"""
Command-line interface for Audio Description evaluation.

Usage:
    python -m eval_metric --generated ad.json --reference ad.csv --metric bertscore
    python -m eval_metric --config config.yaml
"""

import os
import argparse
import json
import pandas as pd
from datetime import datetime
from typing import List, Dict, Any, Optional

from .config import load_config, merge_config_with_args, EvalConfig
from .utils import (
    load_generated_ad,
    load_reference_ad,
    get_time_range,
    generate_output_filename,
    calculate_coverage_stats,
    extract_characters_from_csv,
    MatchedPair,
)
from .matchers import get_matcher
from .evaluators import get_evaluator


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Audio Description Evaluation Toolkit",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Evaluate with BERTScore using cluster matching
    python -m eval_metric -g ad.json -r ad.csv -m bertscore
    
    # Use DP matching with METEOR metric
    python -m eval_metric -g ad.json -r ad.csv -m meteor --matcher dp
    
    # Run multiple metrics
    python -m eval_metric -g ad.json -r ad.csv -m bertscore meteor cider
    
    # Use configuration file
  python -m eval_metric --config config.yaml

    # Run all basic metrics (BERTScore, METEOR, CIDEr)
    python -m eval_metric -g ad.json -r ad.csv --all-metrics
    
    # Include LLM evaluation (requires API key)
    python -m eval_metric -g ad.json -r ad.csv --all-metrics --include-llm
    
    # Include CRITIC evaluation (requires character list)
    python -m eval_metric -g ad.json -r ad.csv --all-metrics --include-critic --characters chars.json
        """
    )
    
    # Input files
    parser.add_argument('--generated', '-g', type=str,
                        help='Path to generated AD JSON file')
    parser.add_argument('--reference', '-r', type=str,
                        help='Path to reference AD CSV file')
    
    # Config file
    parser.add_argument('--config', '-c', type=str,
                        help='Path to YAML configuration file')
    
    # Output
    parser.add_argument('--output', '-o', type=str,
                        help='Output directory or file path')
    
    # Metrics
    parser.add_argument('--metric', '-m', type=str, nargs='+',
                        choices=['llm', 'bertscore', 'meteor', 'cider', 'critic'],
                        help='Evaluation metric(s) to use')
    parser.add_argument('--all-metrics', action='store_true',
                        help='Run basic metrics (BERTScore, METEOR, CIDEr)')
    parser.add_argument('--include-llm', action='store_true',
                        help='Include LLM evaluation (requires GEMINI_API_KEY)')
    parser.add_argument('--include-critic', action='store_true',
                        help='Include CRITIC evaluation (requires --characters)')
    
    # Matcher options
    parser.add_argument('--matcher', type=str, default='cluster',
                        choices=['cluster', 'dp', 'overlap'],
                        help='Matching method (default: cluster)')
    parser.add_argument('--min-overlap', type=float, default=0.5,
                        help='Minimum overlap in seconds for matching (default: 0.5)')
    
    # DP matcher options
    parser.add_argument('--w-time', type=float, default=0.3,
                        help='Weight for time similarity in DP (default: 0.3)')
    parser.add_argument('--w-text', type=float, default=0.7,
                        help='Weight for text similarity in DP (default: 0.7)')
    
    # LLM options
    parser.add_argument('--api-key', type=str,
                        help='Gemini API key (or use GEMINI_API_KEY env var)')
    parser.add_argument('--model', type=str, default='gemini-2.5-flash',
                        help='LLM model name (default: gemini-2.5-flash)')
    
    # BERTScore options
    parser.add_argument('--bert-model', type=str, default='roberta-large',
                        help='BERT model for BERTScore (default: roberta-large)')
    parser.add_argument('--device', type=str,
                        help='Device for neural models (cuda/cpu)')
    
    # CRITIC options
    parser.add_argument('--characters', type=str,
                        help='Path to JSON file with character list')
    
    # Other options
    parser.add_argument('--quiet', '-q', action='store_true',
                        help='Suppress progress output')
    parser.add_argument('--save-config', type=str,
                        help='Save current configuration to YAML file')
    
    return parser.parse_args()


def run_evaluation(
    config: EvalConfig,
    metrics: List[str],
    show_progress: bool = True
) -> Dict[str, Any]:
    """
    Run evaluation with given configuration.
    
    Args:
        config: EvalConfig object
        metrics: List of metric names to run
        show_progress: Whether to show progress bars
        
    Returns:
        Dictionary with 'results' (per metric) and 'combined' (unified data)
    """
    # Validate inputs
    if not config.generated_file:
        raise ValueError("Generated AD file is required (--generated or in config)")
    if not config.reference_file:
        raise ValueError("Reference AD file is required (--reference or in config)")
    
    # Load data
    print(f"\n{'='*60}")
    print("Audio Description Evaluation")
    print(f"{'='*60}")
    print(f"Generated: {config.generated_file}")
    print(f"Reference: {config.reference_file}")
    print(f"Matcher: {config.matcher.method}")
    print(f"Metrics: {', '.join(metrics)}")
    print(f"{'='*60}\n")
    
    print("Loading generated AD...")
    gen_events = load_generated_ad(config.generated_file)
    print(f"  Loaded {len(gen_events)} generated AD events")
    
    # Get time range for filtering reference
    gen_time_range = get_time_range(gen_events)
    print(f"  Time range: {gen_time_range[0]:.1f}s - {gen_time_range[1]:.1f}s")
    
    print("Loading reference AD...")
    ref_events = load_reference_ad(config.reference_file, time_range=gen_time_range)
    print(f"  Loaded {len(ref_events)} reference AD events in time range")
    
    # Create matcher
    print(f"\nMatching using {config.matcher.method} method...")
    matcher_kwargs = {'min_overlap_sec': config.matcher.min_overlap_sec}
    if config.matcher.method == 'dp':
        matcher_kwargs.update({
            'w_time': config.matcher.w_time,
            'w_text': config.matcher.w_text,
            'gap_penalty_gen': config.matcher.gap_penalty_gen,
            'gap_penalty_ref': config.matcher.gap_penalty_ref,
            'time_scale': config.matcher.time_scale,
            'time_soft': config.matcher.time_soft,
        })
    
    matcher = get_matcher(config.matcher.method, **matcher_kwargs)
    matched_pairs = matcher.match(gen_events, ref_events)
    
    # Calculate coverage and precision/recall
    coverage = calculate_coverage_stats(gen_events, ref_events, matched_pairs)
    
    # Count different types
    matched_count = sum(1 for p in matched_pairs if p.matched)
    gen_only_count = sum(1 for p in matched_pairs if p.match_type == 'generated_only')
    ref_only_count = sum(1 for p in matched_pairs if p.match_type == 'reference_only')
    
    # Calculate Precision and Recall
    # Precision: matched gen items / total gen items
    # Recall: matched ref items / total ref items (in time range)
    total_gen = len(gen_events)
    total_ref = len(ref_events)
    matched_gen = coverage['gen_matched']
    matched_ref = coverage['ref_matched']
    
    precision = matched_gen / total_gen if total_gen > 0 else 0.0
    recall = matched_ref / total_ref if total_ref > 0 else 0.0
    f1_score = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    
    print(f"\n=== MATCHING RESULTS ===")
    print(f"  Matched pairs: {matched_count}")
    print(f"  Generated-only (unmatched): {gen_only_count}")
    print(f"  Reference-only (unmatched): {ref_only_count}")
    print(f"\n=== PRECISION / RECALL ===")
    print(f"  Precision (gen matched / total gen): {matched_gen}/{total_gen} = {precision:.4f}")
    print(f"  Recall (ref matched / total ref): {matched_ref}/{total_ref} = {recall:.4f}")
    print(f"  F1 Score: {f1_score:.4f}")
    
    if matched_count == 0:
        print("\nWARNING: No matched pairs found. Scores will be empty.")
    
    # Build base DataFrame from ALL pairs (matched + unmatched)
    pairs_to_eval = [p for p in matched_pairs if p.matched]  # For evaluation
    base_data = []
    for pair in matched_pairs:  # All pairs for CSV
        base_data.append({
            'matched': pair.matched,
            'match_type': pair.match_type,
            'gen_indices': ','.join(map(str, pair.gen_indices)) if pair.gen_indices else '',
            'ref_indices': ','.join(map(str, pair.ref_indices)) if pair.ref_indices else '',
            'gen_start': pair.gen_start,
            'gen_end': pair.gen_end,
            'ref_start': pair.ref_start,
            'ref_end': pair.ref_end,
            'text_gen': pair.combined_gen_text,
            'text_ref': pair.combined_ref_text,
            'num_gen_items': pair.num_gen_items,
            'num_ref_items': pair.num_ref_items,
        })
    combined_df = pd.DataFrame(base_data)
    
    # Run evaluators and collect scores
    results = {}
    summary_stats = {
        'timestamp': datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        'generated_file': config.generated_file,
        'reference_file': config.reference_file,
        'matcher': config.matcher.method,
        'total_gen_events': total_gen,
        'total_ref_events': total_ref,
        'matched_pairs': matched_count,
        'unmatched_gen': gen_only_count,
        'unmatched_ref': ref_only_count,
        'precision': round(precision, 4),
        'recall': round(recall, 4),
        'f1_score': round(f1_score, 4),
        'coverage': coverage,
        'metrics': {},
    }
    
    for metric_name in metrics:
        print(f"\n{'='*60}")
        print(f"Running {metric_name.upper()} evaluation...")
        print(f"{'='*60}")
        
        try:
            # Create evaluator
            evaluator_class = get_evaluator(metric_name)
            
            evaluator_kwargs = {}
            if metric_name == 'llm':
                evaluator_kwargs = {
                    'api_key': config.llm.api_key,
                    'model': config.llm.model,
                    'max_retries': config.llm.max_retries,
                    'retry_delay': config.llm.retry_delay,
                }
            elif metric_name == 'bertscore':
                evaluator_kwargs = {
                    'model': config.bertscore.model,
                    'device': config.bertscore.device,
                    'rescale_with_baseline': config.bertscore.rescale_with_baseline,
                }
            elif metric_name == 'cider':
                evaluator_kwargs = {
                    'n_gram': config.cider.n_gram,
                    'sigma': config.cider.sigma,
                }
            elif metric_name == 'critic':
                # Auto-extract characters from reference if not provided
                characters = config.critic.characters
                if not characters and not config.critic.characters_file:
                    print("  Auto-extracting characters from reference AD...")
                    try:
                        characters = extract_characters_from_csv(
                            config.reference_file, 
                            min_count=2,
                            use_spacy=True
                        )
                        print(f"  Extracted {len(characters)} characters: {characters[:5]}{'...' if len(characters) > 5 else ''}")
                    except Exception as e:
                        print(f"  WARNING: Failed to extract characters: {e}")
                        characters = []
                
                evaluator_kwargs = {
                    'characters': characters,
                    'characters_file': config.critic.characters_file,
                    'device': config.critic.device,
                }
            
            evaluator = evaluator_class(**evaluator_kwargs)
            
            # Run evaluation (only on matched pairs)
            result = evaluator.evaluate_batch(matched_pairs, show_progress=show_progress)
            
            # Print summary
            evaluator.print_summary(result)
            
            # Add scores to combined DataFrame (match indices with all pairs)
            # result.pairs only contains matched pairs, so we need to align with full DataFrame
            score_column = [None] * len(matched_pairs)
            eval_idx = 0
            for i, pair in enumerate(matched_pairs):
                if pair.matched and eval_idx < len(result.pairs):
                    score_column[i] = result.pairs[eval_idx].get('score')
                    eval_idx += 1
            combined_df[f'score_{metric_name}'] = score_column
            
            # Add BERTScore-specific columns
            if metric_name == 'bertscore':
                prec_column = [None] * len(matched_pairs)
                rec_column = [None] * len(matched_pairs)
                f1_column = [None] * len(matched_pairs)
                eval_idx = 0
                for i, pair in enumerate(matched_pairs):
                    if pair.matched and eval_idx < len(result.pairs):
                        prec_column[i] = result.pairs[eval_idx].get('precision')
                        rec_column[i] = result.pairs[eval_idx].get('recall')
                        f1_column[i] = result.pairs[eval_idx].get('f1')
                        eval_idx += 1
                combined_df['bertscore_precision'] = prec_column
                combined_df['bertscore_recall'] = rec_column
                combined_df['bertscore_f1'] = f1_column
            
            # Add CRITIC-specific columns
            if metric_name == 'critic':
                ref_chars_column = [None] * len(matched_pairs)
                gen_chars_column = [None] * len(matched_pairs)
                eval_idx = 0
                for i, pair in enumerate(matched_pairs):
                    if pair.matched and eval_idx < len(result.pairs):
                        ref_chars_column[i] = str(result.pairs[eval_idx].get('ref_characters', []))
                        gen_chars_column[i] = str(result.pairs[eval_idx].get('gen_characters', []))
                        eval_idx += 1
                combined_df['critic_ref_chars'] = ref_chars_column
                combined_df['critic_gen_chars'] = gen_chars_column
            
            # Collect summary statistics
            summary_stats['metrics'][metric_name] = {
                'mean': result.statistics.get('mean_score', 0),
                'median': result.statistics.get('median_score', 0),
                'std': result.statistics.get('std_score', 0),
                'min': result.statistics.get('min_score', 0),
                'max': result.statistics.get('max_score', 0),
            }
            
            results[metric_name] = result
            
        except Exception as e:
            print(f"ERROR: Failed to run {metric_name}: {e}")
            import traceback
            traceback.print_exc()
            combined_df[f'score_{metric_name}'] = None
            summary_stats['metrics'][metric_name] = {'error': str(e)}
    
    # Save combined results (single CSV + single JSON)
    output_path = generate_output_filename(
        config.generated_file,
        config.reference_file,
        config.output.output_dir,
        prefix="eval_combined",
    )
    
    # Save combined CSV
    combined_df.to_csv(output_path, index=False)
    print(f"\n{'='*60}")
    print(f"Combined results saved to: {output_path}")
    
    # Save combined JSON summary
    summary_path = output_path.replace('.csv', '_summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary_stats, f, indent=2, ensure_ascii=False)
    print(f"Summary saved to: {summary_path}")
    
    return {'results': results, 'combined_df': combined_df, 'summary': summary_stats}


def main():
    """Main entry point."""
    args = parse_args()
    
    # Load configuration
    if args.config:
        config = load_config(args.config)
    else:
        config = EvalConfig()
    
    # Merge with CLI arguments
    config = merge_config_with_args(config, args)
    
    # Save config if requested
    if args.save_config:
        from .config import save_config
        save_config(config, args.save_config)
        print(f"Configuration saved to: {args.save_config}")
        return
    
    # Determine which metrics to run
    if args.all_metrics:
        metrics = ['bertscore', 'meteor', 'cider']
        
        # Auto-include LLM if API key is available (from CLI, env, or YAML)
        api_key = args.api_key or os.environ.get('GEMINI_API_KEY') or config.llm.api_key
        if api_key and api_key != "YOUR_GEMINI_API_KEY_HERE":  # Skip placeholder
            metrics.append('llm')
            config.llm.api_key = api_key
            print(f"INFO: LLM evaluation enabled (API key found)")
        elif args.include_llm:
            print("WARNING: --include-llm specified but no valid API key found. Skipping LLM.")
        
        # Auto-include CRITIC - always include with --all-metrics (auto-extract if no chars provided)
        has_characters = (
            args.characters or 
            config.critic.characters_file or 
            (config.critic.characters and len(config.critic.characters) > 0)
        )
        # Always include CRITIC with --all-metrics (will auto-extract if needed)
        metrics.append('critic')
        if args.characters:
            config.critic.characters_file = args.characters
        if has_characters:
            print(f"INFO: CRITIC evaluation enabled (character list provided)")
        else:
            print(f"INFO: CRITIC evaluation enabled (will auto-extract characters from reference)")
                
    elif args.metric:
        metrics = args.metric
    elif config.evaluators:
        metrics = config.evaluators
    else:
        print("ERROR: No metrics specified. Use --metric or --all-metrics")
        return
    
    # Run evaluation
    show_progress = not args.quiet
    
    try:
        eval_result = run_evaluation(config, metrics, show_progress)
        
        # Print final summary
        if eval_result and eval_result.get('results'):
            results = eval_result['results']
            print(f"\n{'='*60}")
            print("FINAL SUMMARY")
            print(f"{'='*60}")
            for metric, result in results.items():
                mean_score = result.statistics.get('mean_score', 0)
                print(f"  {metric.upper()}: {mean_score:.4f}")
            print(f"{'='*60}\n")
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0


if __name__ == '__main__':
    exit(main() or 0)

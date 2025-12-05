"""
LLM-based evaluator for Audio Description quality assessment.

Uses Google Gemini API to evaluate generated AD against reference AD.
"""

import os
import re
import ast
import time
from typing import Dict, Any, Optional, List

from .base import BaseEvaluator, EvaluationResult
from ..utils import MatchedPair

# Optional imports
try:
    from google import genai
    from google.genai.types import Content, Part
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


class LLMEvaluator(BaseEvaluator):
    """
    LLM-based evaluator using Google Gemini API.
    
    Scores AD pairs on a 0-5 scale based on visual content matching.
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-2.5-flash",
        max_retries: int = 3,
        retry_delay: float = 2.0,
        config: Any = None,
    ):
        """
        Initialize LLM evaluator.
        
        Args:
            api_key: Gemini API key (uses GEMINI_API_KEY env var if None)
            model: Gemini model name
            max_retries: Number of retries for API calls
            retry_delay: Delay between retries in seconds
            config: Optional LLMEvalConfig object
        """
        super().__init__(config)
        
        if not GENAI_AVAILABLE:
            raise ImportError("google-genai is required. Install with: pip install google-generativeai")
        
        self.api_key = api_key or os.environ.get('GEMINI_API_KEY')
        if not self.api_key:
            raise ValueError("Gemini API key is required. Set GEMINI_API_KEY env var or pass api_key.")
        
        self.model = model
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        
        # System prompt for evaluation
        self.system_prompt = (
            "You are an intelligent chatbot designed for evaluating the quality of generative outputs for movie audio descriptions. "
            "Your task is to compare the predicted audio descriptions with the correct audio descriptions and determine its level of match, considering mainly the visual elements like actions, objects and interactions. Here's how you can accomplish the task:"
            "------"
            "##INSTRUCTIONS: "
            "- Check if the predicted audio description covers the main visual events from the movie, especially focusing on the verbs and nouns.\n"
            "- Evaluate whether the predicted audio description includes specific details rather than just generic points. It should provide comprehensive information that is tied to specific elements of the video.\n"
            "- Consider synonyms or paraphrases as valid matches. Consider pronouns like 'he' or 'she' as valid matches with character names. Consider different character names as valid matches. \n"
            "- Provide a single evaluation score that reflects the level of match of the prediction, considering the visual elements like actions, objects and interactions."
        )
    
    @property
    def metric_name(self) -> str:
        return "LLM"
    
    def _call_api(self, gen_text: str, ref_text: str) -> Dict[str, Any]:
        """Make API call to Gemini."""
        client = genai.Client(api_key=self.api_key)
        
        user_prompt = (
            "Please evaluate the following movie audio description pair:\n\n"
            f"Correct Audio Description: {ref_text}\n"
            f"Predicted Audio Description: {gen_text}\n\n"
            "Provide your evaluation only as a matching score where the matching score is an integer value between 0 and 5, with 5 indicating the highest level of match. "
            "Please generate the response in the form of a Python dictionary string with keys 'score', where its value is the matching score in INTEGER, not STRING."
            "DO NOT PROVIDE ANY OTHER OUTPUT TEXT OR EXPLANATION. Only provide the Python dictionary string. "
            "For example, your response should look like this: {'score': 4}."
        )
        
        full_prompt = f"{self.system_prompt}\n\n{user_prompt}"
        
        input_content = Content(parts=[Part(text=full_prompt)])
        
        response = client.models.generate_content(
            model=self.model,
            contents=input_content,
        )
        
        response_message = response.text.strip()
        
        # Extract dictionary from response
        if '```' in response_message:
            match = re.search(r'```(?:python|json)?\s*(\{.*?\})\s*```', response_message, re.DOTALL)
            if match:
                response_message = match.group(1)
            else:
                match = re.search(r'(\{.*?\})', response_message, re.DOTALL)
                if match:
                    response_message = match.group(1)
        
        response_dict = ast.literal_eval(response_message)
        return response_dict
    
    def evaluate_pair(
        self,
        gen_text: str,
        ref_text: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Evaluate a single pair using Gemini API."""
        for attempt in range(self.max_retries):
            try:
                result = self._call_api(gen_text, ref_text)
                return {'score': result.get('score', 0)}
            except Exception as e:
                if attempt < self.max_retries - 1:
                    time.sleep(self.retry_delay)
                else:
                    print(f"LLM evaluation failed after {self.max_retries} attempts: {e}")
                    return {'score': 0, 'error': str(e)}
        
        return {'score': 0}
    
    def evaluate_batch(
        self,
        matched_pairs: List[MatchedPair],
        show_progress: bool = True,
        chunk_size: int = 200,
    ) -> EvaluationResult:
        """
        Evaluate all matched pairs with chunked saving.
        
        Args:
            matched_pairs: List of MatchedPair objects
            show_progress: Whether to show progress bar
            chunk_size: Save progress every chunk_size evaluations
            
        Returns:
            EvaluationResult object
        """
        import json
        import os
        from tqdm import tqdm
        import numpy as np
        
        results = []
        scores = []
        
        pairs_to_eval = [p for p in matched_pairs if p.matched]
        
        # Create temp directory for intermediate saves
        os.makedirs('tmp', exist_ok=True)
        
        iterator = tqdm(pairs_to_eval, desc=f"Evaluating {self.metric_name}") if show_progress else pairs_to_eval
        
        for idx, pair in enumerate(iterator):
            try:
                result = self.evaluate_pair(
                    gen_text=pair.combined_gen_text,
                    ref_text=pair.combined_ref_text,
                )
                
                pair_result = pair.to_dict()
                pair_result.update(result)
                results.append(pair_result)
                
                if 'score' in result and result['score'] is not None:
                    scores.append(result['score'])
                
                # Save checkpoint
                if (idx + 1) % chunk_size == 0:
                    with open(f'tmp/llm_checkpoint_{idx+1}.json', 'w') as f:
                        json.dump(results, f)
                        
            except Exception as e:
                print(f"Error evaluating pair {idx}: {e}")
                pair_result = pair.to_dict()
                pair_result['score'] = 0
                pair_result['error'] = str(e)
                results.append(pair_result)
        
        stats = self._calculate_statistics(scores, matched_pairs)
        
        return EvaluationResult(
            pairs=results,
            statistics=stats,
            metric_name=self.metric_name,
        )

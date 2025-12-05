"""
Entry point for running as module: python -m eval_metric
"""

from .cli import main

if __name__ == '__main__':
    exit(main() or 0)

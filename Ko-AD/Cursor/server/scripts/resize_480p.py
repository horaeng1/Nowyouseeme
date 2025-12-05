import argparse
import os
from moviepy.editor import VideoFileClip


def ensure_parent(path):
    parent = os.path.dirname(path)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


def convert(input_path: str, output_path: str, height: int):
    clip = VideoFileClip(input_path)
    clip_resized = clip.resize(height=height)
    ensure_parent(output_path)
    clip_resized.write_videofile(
        output_path,
        codec="libx264",
        audio_codec="aac",
        bitrate="2000k",
        preset="medium",
        threads=2,
        logger=None,
    )
    clip_resized.close()
    clip.close()


def main():
    parser = argparse.ArgumentParser(description="Resize video to target height (default 480p).")
    parser.add_argument("--input", required=True, help="Input video path")
    parser.add_argument("--output", required=True, help="Output video path")
    parser.add_argument("--height", type=int, default=480, help="Target height in pixels")
    args = parser.parse_args()

    if not os.path.exists(args.input):
        raise FileNotFoundError(f"Input file not found: {args.input}")

    convert(args.input, args.output, args.height)
    print(f"Saved resized video → {args.output}")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
"""Build the email-safe, one-play reward celebration animation."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


WIDTH = 520
HEIGHT = 218
FRAME_COUNT = 10
SPARKLES = (
    (65, 54, 10),
    (131, 198, 8),
    (208, 43, 7),
    (426, 45, 8),
    (493, 198, 7),
    (559, 62, 11),
)


def cover(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    resized = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def draw_sparkle(layer: Image.Image, x: int, y: int, radius: int, alpha: int) -> None:
    draw = ImageDraw.Draw(layer)
    colour = (255, 188, 41, alpha)
    glow = (255, 229, 142, max(0, alpha // 3))
    draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=glow)
    draw.polygon(
        (
            (x, y - radius),
            (x + max(1, radius // 4), y - max(1, radius // 4)),
            (x + radius, y),
            (x + max(1, radius // 4), y + max(1, radius // 4)),
            (x, y + radius),
            (x - max(1, radius // 4), y + max(1, radius // 4)),
            (x - radius, y),
            (x - max(1, radius // 4), y - max(1, radius // 4)),
        ),
        fill=colour,
    )


def build_frames(source: Image.Image) -> list[Image.Image]:
    base = cover(source.convert("RGB"), WIDTH, HEIGHT)
    frames: list[Image.Image] = []

    for frame_index in range(FRAME_COUNT):
        phase = frame_index / max(1, FRAME_COUNT - 1)
        frame = base.convert("RGBA")
        sparkle_layer = Image.new("RGBA", frame.size, (255, 255, 255, 0))

        for sparkle_index, (x, y, radius) in enumerate(SPARKLES):
            pulse = max(
                0.0,
                math.sin((phase * 2.2 * math.pi) + (sparkle_index * 0.85)),
            )
            if pulse > 0.18:
                draw_sparkle(
                    sparkle_layer,
                    x,
                    y,
                    max(2, round(radius * pulse)),
                    round(210 * pulse),
                )

        sparkle_layer = sparkle_layer.filter(ImageFilter.GaussianBlur(0.25))
        frames.append(Image.alpha_composite(frame, sparkle_layer).convert("RGB"))

    return frames


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("gif_output", type=Path)
    parser.add_argument("static_output", type=Path)
    args = parser.parse_args()

    source = Image.open(args.source)
    frames = build_frames(source)
    args.gif_output.parent.mkdir(parents=True, exist_ok=True)
    args.static_output.parent.mkdir(parents=True, exist_ok=True)

    master_palette = frames[0].quantize(
        colors=64,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    palette_frames = [
        frame.quantize(palette=master_palette, dither=Image.Dither.NONE)
        for frame in frames
    ]
    palette_frames[0].save(
        args.gif_output,
        save_all=True,
        append_images=palette_frames[1:],
        duration=[125] * (FRAME_COUNT - 1) + [900],
        optimize=True,
        disposal=1,
    )
    frames[0].save(args.static_output, format="JPEG", quality=88, optimize=True)


if __name__ == "__main__":
    main()

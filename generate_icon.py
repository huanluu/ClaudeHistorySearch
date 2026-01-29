#!/usr/bin/env python3
"""Generate Claude History Search app icon."""

from PIL import Image, ImageDraw
import math

def create_app_icon(size=1024):
    # Create image with transparent background (iOS applies rounded corners)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Claude-inspired coral/orange gradient colors
    color_top = (217, 119, 87)      # #D97757 - Claude coral
    color_bottom = (196, 88, 54)    # #C45836 - Darker coral

    # Draw gradient background
    for y in range(size):
        ratio = y / size
        r = int(color_top[0] + (color_bottom[0] - color_top[0]) * ratio)
        g = int(color_top[1] + (color_bottom[1] - color_top[1]) * ratio)
        b = int(color_top[2] + (color_bottom[2] - color_top[2]) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b, 255))

    # Magnifying glass parameters
    center_x = size * 0.42
    center_y = size * 0.42
    glass_radius = size * 0.24
    ring_width = size * 0.055
    handle_width = size * 0.07
    handle_length = size * 0.28

    # Draw magnifying glass ring (white with slight transparency for depth)
    white = (255, 255, 255, 255)

    # Outer circle
    draw.ellipse(
        [center_x - glass_radius - ring_width/2,
         center_y - glass_radius - ring_width/2,
         center_x + glass_radius + ring_width/2,
         center_y + glass_radius + ring_width/2],
        fill=white
    )

    # Inner circle (cut out) - use gradient color to create ring effect
    inner_color = (
        int(color_top[0] * 0.95 + color_bottom[0] * 0.05),
        int(color_top[1] * 0.95 + color_bottom[1] * 0.05),
        int(color_top[2] * 0.95 + color_bottom[2] * 0.05),
        255
    )
    draw.ellipse(
        [center_x - glass_radius + ring_width/2,
         center_y - glass_radius + ring_width/2,
         center_x + glass_radius - ring_width/2,
         center_y + glass_radius - ring_width/2],
        fill=inner_color
    )

    # Draw handle at 45 degree angle
    angle = math.radians(45)
    handle_start_x = center_x + glass_radius * math.cos(angle)
    handle_start_y = center_y + glass_radius * math.sin(angle)
    handle_end_x = handle_start_x + handle_length * math.cos(angle)
    handle_end_y = handle_start_y + handle_length * math.sin(angle)

    # Draw handle with rounded ends
    draw.line(
        [(handle_start_x, handle_start_y), (handle_end_x, handle_end_y)],
        fill=white,
        width=int(handle_width)
    )

    # Round the handle end
    draw.ellipse(
        [handle_end_x - handle_width/2,
         handle_end_y - handle_width/2,
         handle_end_x + handle_width/2,
         handle_end_y + handle_width/2],
        fill=white
    )

    # Add subtle shine/highlight on glass
    shine_color = (255, 255, 255, 60)
    shine_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shine_draw = ImageDraw.Draw(shine_img)
    shine_offset = glass_radius * 0.25
    shine_radius = glass_radius * 0.15
    shine_draw.ellipse(
        [center_x - shine_offset - shine_radius,
         center_y - shine_offset - shine_radius,
         center_x - shine_offset + shine_radius,
         center_y - shine_offset + shine_radius],
        fill=shine_color
    )
    img = Image.alpha_composite(img, shine_img)

    return img

if __name__ == '__main__':
    icon = create_app_icon(1024)
    output_path = 'ClaudeHistorySearch/Assets.xcassets/AppIcon.appiconset/AppIcon.png'
    icon.save(output_path, 'PNG')
    print(f'Icon saved to {output_path}')

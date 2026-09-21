from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

import comfy.model_management


MAX_IMAGE_PIXELS = 64 * 1024 * 1024


def mask_metrics(mask):
    if mask.ndim != 2 or not mask.any():
        raise ValueError("Cutout mask is empty or invalid")
    height, width = mask.shape
    y, x = np.nonzero(mask)
    return {
        "alpha_coverage": float(mask.mean()),
        "alpha_bbox": [
            float(x.min() / width),
            float(y.min() / height),
            float((x.max() + 1) / width),
            float((y.max() + 1) / height),
        ],
    }


def normalize_cutout_bbox(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("Cutout bbox must contain four normalized values")
    try:
        x1, y1, x2, y2 = (float(item) for item in value)
    except (TypeError, ValueError) as error:
        raise ValueError("Cutout bbox values must be numbers") from error
    x1 = min(1.0, max(0.0, x1))
    y1 = min(1.0, max(0.0, y1))
    x2 = min(1.0, max(0.0, x2))
    y2 = min(1.0, max(0.0, y2))
    if x2 - x1 < 0.01 or y2 - y1 < 0.01:
        raise ValueError("Cutout selection is too small")
    return [x1, y1, x2, y2]


def apply_cutout_mask(image, mask, feather):
    if mask.shape != (image.height, image.width):
        raise ValueError("SAM mask size does not match the source image")
    alpha = Image.fromarray(mask.astype(np.uint8) * 255, mode="L")
    feather = min(16.0, max(0.0, float(feather)))
    if feather:
        alpha = ImageChops.multiply(alpha.filter(ImageFilter.GaussianBlur(feather)), alpha)
    output = image.convert("RGBA")
    output.putalpha(alpha)
    return output


def clean_sam_mask(mask):
    import cv2

    binary = mask.astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    if count <= 1:
        return binary.astype(bool)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    binary = (labels == largest).astype(np.uint8)

    radius = max(1, round(min(binary.shape) * 0.002))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius * 2 + 1, radius * 2 + 1))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    inverse = 1 - binary
    hole_count, hole_labels, hole_stats, _ = cv2.connectedComponentsWithStats(inverse, connectivity=8)
    max_hole_area = max(32, round(binary.size * 0.0005))
    height, width = binary.shape
    for label in range(1, hole_count):
        x, y, component_width, component_height, area = hole_stats[label]
        touches_edge = x == 0 or y == 0 or x + component_width == width or y + component_height == height
        if not touches_edge and area <= max_hole_area:
            binary[hole_labels == label] = 1
    return binary.astype(bool)


def create_sam_cutout(source_path, checkpoint_path, bbox, feather, output_path):
    source_path = Path(source_path)
    checkpoint_path = Path(checkpoint_path)
    output_path = Path(output_path)
    if not source_path.is_file():
        raise FileNotFoundError("Source image was not found")
    if not checkpoint_path.is_file():
        raise FileNotFoundError("SAM ViT-B checkpoint was not found")
    bbox = normalize_cutout_bbox(bbox)

    with Image.open(source_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise ValueError("Source image is too large")

    from segment_anything import SamPredictor, sam_model_registry

    model = sam_model_registry["vit_b"](checkpoint=str(checkpoint_path))
    predictor = None
    try:
        device = comfy.model_management.get_torch_device()
        model.to(device=device)
        predictor = SamPredictor(model)
        pixels = np.asarray(image)
        predictor.set_image(pixels)
        x1, y1, x2, y2 = bbox
        box = np.array([x1 * image.width, y1 * image.height, x2 * image.width, y2 * image.height], dtype=np.float32)
        center = np.array([[(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]], dtype=np.float32)
        masks, scores, _ = predictor.predict(point_coords=center, point_labels=np.array([1], dtype=np.int32), box=box, multimask_output=True)
        selected = int(np.argmax(scores))
        mask = clean_sam_mask(masks[selected])
        if not mask.any():
            raise RuntimeError("SAM did not find a subject inside the selection")
        output = apply_cutout_mask(image, mask, feather)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output.save(output_path, format="PNG", optimize=True)
        return {"score": float(scores[selected]), **mask_metrics(mask)}
    finally:
        predictor = None
        model.to(device="cpu")
        del model
        comfy.model_management.soft_empty_cache()

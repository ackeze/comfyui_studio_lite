import json

import node_helpers


MAX_OBJECTS = 64
MAX_RELATIONS = 128


def _number(value, default, minimum, maximum):
    try:
        value = float(value)
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _integer(value, default, minimum, maximum):
    try:
        value = int(value)
    except (TypeError, ValueError):
        value = default
    return min(maximum, max(minimum, value))


def _text(value, limit=4096):
    return value.strip()[:limit] if isinstance(value, str) else ""


def _normalize_bbox(value):
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        value = (0.1, 0.1, 0.9, 0.9)
    x1 = _number(value[0], 0.1, 0.0, 1.0)
    y1 = _number(value[1], 0.1, 0.0, 1.0)
    x2 = _number(value[2], 0.9, 0.0, 1.0)
    y2 = _number(value[3], 0.9, 0.0, 1.0)
    if x2 <= x1:
        x2 = min(1.0, x1 + 0.01)
    if y2 <= y1:
        y2 = min(1.0, y1 + 0.01)
    return [x1, y1, x2, y2]


def _normalize_pose(value):
    value = value if isinstance(value, dict) else {}
    preset = value.get("preset", "standing")
    if preset not in ("standing", "sitting"):
        preset = "standing"
    keypoints = []
    raw_keypoints = value.get("keypoints", [])
    if isinstance(raw_keypoints, list):
        for point in raw_keypoints[:17]:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                keypoints.append([_number(point[0], 0.5, 0.0, 1.0), _number(point[1], 0.5, 0.0, 1.0)])
    return {"preset": preset, "keypoints": keypoints}


def normalize_scene(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid scene JSON: {error.msg}") from error
    if not isinstance(value, dict):
        raise ValueError("Scene must be a JSON object")

    width = _integer(value.get("width"), 1024, 64, 8192)
    height = _integer(value.get("height"), 1024, 64, 8192)
    raw_objects = value.get("objects", [])
    if not isinstance(raw_objects, list):
        raise ValueError("Scene objects must be a list")
    if len(raw_objects) > MAX_OBJECTS:
        raise ValueError(f"Scene supports at most {MAX_OBJECTS} objects")

    mode = "artist" if value.get("mode") == "artist" else "composer"
    objects = []
    seen_ids = set()
    for index, raw in enumerate(raw_objects):
        if not isinstance(raw, dict):
            raise ValueError(f"Scene object {index + 1} must be a JSON object")
        object_id = _text(raw.get("id"), 80) or f"object_{index + 1:02d}"
        if object_id in seen_ids:
            raise ValueError(f"Duplicate scene object id: {object_id}")
        seen_ids.add(object_id)
        region_mode = raw.get("region_mode", "soft")
        if region_mode not in ("soft", "hard"):
            region_mode = "soft"
        kind = raw.get("kind", "background" if raw.get("role") == "background" else "prop")
        if kind not in ("background", "character", "prop"):
            kind = "prop"
        generation_state = raw.get("generation_state", "empty")
        if generation_state not in ("empty", "planned", "generating", "generated", "failed"):
            generation_state = "empty"
        objects.append(
            {
                "id": object_id,
                "name": _text(raw.get("name"), 120) or object_id,
                "prompt": _text(raw.get("prompt")),
                "negative_prompt": _text(raw.get("negative_prompt")),
                "bbox": _normalize_bbox(raw.get("bbox")),
                "rotation": _number(raw.get("rotation"), 0.0, -360.0, 360.0),
                "depth": _number(raw.get("depth"), 0.5, 0.0, 1.0),
                "z_index": _integer(raw.get("z_index"), index, -10000, 10000),
                "seed": _integer(raw.get("seed"), -1, -1, 0xFFFFFFFFFFFFFFFF),
                "locked": bool(raw.get("locked", False)),
                "visible": bool(raw.get("visible", True)),
                "region_mode": region_mode,
                "control_strength": _number(raw.get("control_strength"), 1.0, 0.0, 10.0),
                "feather": _number(raw.get("feather"), 0.04, 0.0, 0.25),
                "aspect_ratio": _number(raw.get("aspect_ratio"), 0.0, 0.0, 100.0),
                "role": "background" if raw.get("role") == "background" else "object",
                "kind": kind,
                "generation_state": generation_state,
                "pose": _normalize_pose(raw.get("pose")),
                "image_full_canvas": bool(raw.get("image_full_canvas", False)),
                "has_transparency": raw.get("has_transparency") if isinstance(raw.get("has_transparency"), bool) else None,
                "image": raw.get("image") if isinstance(raw.get("image"), dict) else {},
            }
        )

    relations = []
    raw_relations = value.get("relations", [])
    if not isinstance(raw_relations, list):
        raise ValueError("Scene relations must be a list")
    if len(raw_relations) > MAX_RELATIONS:
        raise ValueError(f"Scene supports at most {MAX_RELATIONS} relations")
    relation_ids = set()
    for index, raw in enumerate(raw_relations):
        if not isinstance(raw, dict):
            raise ValueError(f"Scene relation {index + 1} must be a JSON object")
        source = _text(raw.get("source"), 80)
        target = _text(raw.get("target"), 80)
        if source not in seen_ids or target not in seen_ids or source == target:
            continue
        relation_id = _text(raw.get("id"), 80) or f"relation_{index + 1:02d}"
        if relation_id in relation_ids:
            relation_id = f"{relation_id}_{index + 1}"
        relation_ids.add(relation_id)
        relations.append(
            {
                "id": relation_id,
                "source": source,
                "target": target,
                "description": _text(raw.get("description"), 240) or f"{source} 位于 {target} 附近",
                "source_anchor": _text(raw.get("source_anchor"), 40) or "center",
                "target_anchor": _text(raw.get("target_anchor"), 40) or "center",
            }
        )

    raw_artist = value.get("artist", {}) if isinstance(value.get("artist"), dict) else {}
    pose_model = raw_artist.get("pose_model", "preview2")
    if pose_model not in ("preview2", "lllite"):
        pose_model = "preview2"

    return {
        "version": "0.3",
        "mode": mode,
        "width": width,
        "height": height,
        "background": _text(value.get("background"), 32) or "#808080",
        "global_prompt": _text(value.get("global_prompt")),
        "global_negative_prompt": _text(value.get("global_negative_prompt")),
        "objects": objects,
        "relations": relations,
        "artist": {
            "pose_model": pose_model,
            "preview_lora": _text(raw_artist.get("preview_lora"), 240),
            "pose_patch": _text(raw_artist.get("pose_patch"), 240),
            "character_denoise": _number(raw_artist.get("character_denoise"), 0.9, 0.2, 1.0),
        },
    }


def _encode(clip, text):
    if clip is None:
        raise RuntimeError("CLIP input is required")
    return clip.encode_from_tokens_scheduled(clip.tokenize(text))


def _area_values(scene_object):
    x1, y1, x2, y2 = scene_object["bbox"]
    if scene_object["region_mode"] == "soft":
        feather = scene_object["feather"]
        x1 = max(0.0, x1 - feather)
        y1 = max(0.0, y1 - feather)
        x2 = min(1.0, x2 + feather)
        y2 = min(1.0, y2 + feather)
    return {
        "area": ("percentage", 1.0, y2 - y1, x2 - x1, 0.0, y1, x1),
        "strength": scene_object["control_strength"],
        "set_area_to_bounds": scene_object["region_mode"] == "hard",
    }


class AkiAnimaSceneFromJSON:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "scene_json": (
                    "STRING",
                    {
                        "default": '{"version":"0.3","mode":"composer","width":1024,"height":1024,"objects":[],"relations":[]}',
                        "multiline": True,
                        "dynamicPrompts": False,
                    },
                )
            }
        }

    RETURN_TYPES = ("ANIMA_SCENE", "STRING")
    RETURN_NAMES = ("scene", "normalized_json")
    FUNCTION = "load_scene"
    CATEGORY = "Comfy Studio/Anima Scene"

    def load_scene(self, scene_json):
        scene = normalize_scene(scene_json)
        return scene, json.dumps(scene, ensure_ascii=False, indent=2)


class AkiAnimaSceneConditioning:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"scene": ("ANIMA_SCENE",), "clip": ("CLIP",)}}

    RETURN_TYPES = ("CONDITIONING", "CONDITIONING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "build_conditioning"
    CATEGORY = "Comfy Studio/Anima Scene"

    def build_conditioning(self, scene, clip):
        scene = normalize_scene(scene)
        positive = _encode(clip, scene["global_prompt"])
        negative = _encode(clip, scene["global_negative_prompt"])
        for scene_object in scene["objects"]:
            if not scene_object["visible"]:
                continue
            values = _area_values(scene_object)
            if scene_object["prompt"]:
                regional = _encode(clip, scene_object["prompt"])
                positive += node_helpers.conditioning_set_values(regional, values)
            if scene_object["negative_prompt"]:
                regional_negative = _encode(clip, scene_object["negative_prompt"])
                negative += node_helpers.conditioning_set_values(regional_negative, values)
        return positive, negative


NODE_CLASS_MAPPINGS = {
    "AkiAnimaSceneFromJSON": AkiAnimaSceneFromJSON,
    "AkiAnimaSceneConditioning": AkiAnimaSceneConditioning,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AkiAnimaSceneFromJSON": "Anima Scene from JSON",
    "AkiAnimaSceneConditioning": "Anima Scene Regional Conditioning",
}

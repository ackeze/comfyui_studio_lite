import importlib.util
import json
from pathlib import Path
import unittest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scene_nodes.py"
SPEC = importlib.util.spec_from_file_location("aki_scene_nodes", MODULE_PATH)
scene_nodes = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scene_nodes)


class FakeClip:
    def tokenize(self, text):
        return text

    def encode_from_tokens_scheduled(self, tokens):
        return [[tokens, {"text": tokens}]]


class SceneNodeTests(unittest.TestCase):
    def test_normalize_scene_clamps_values_and_preserves_image_reference(self):
        scene = scene_nodes.normalize_scene(
            {
                "width": 32,
                "height": 9000,
                "objects": [
                    {
                        "id": "girl",
                        "bbox": [-1, 0.2, 2, 0.8],
                        "depth": 2,
                        "region_mode": "hard",
                        "aspect_ratio": 1.5,
                        "role": "background",
                        "has_transparency": False,
                        "image": {"filename": "girl.png", "type": "input"},
                    }
                ],
            }
        )
        self.assertEqual((scene["width"], scene["height"]), (64, 8192))
        self.assertEqual(scene["objects"][0]["bbox"], [0.0, 0.2, 1.0, 0.8])
        self.assertEqual(scene["objects"][0]["depth"], 1.0)
        self.assertEqual(scene["objects"][0]["aspect_ratio"], 1.5)
        self.assertEqual(scene["objects"][0]["role"], "background")
        self.assertFalse(scene["objects"][0]["has_transparency"])
        self.assertEqual(scene["objects"][0]["image"]["filename"], "girl.png")

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Duplicate scene object id"):
            scene_nodes.normalize_scene({"objects": [{"id": "same"}, {"id": "same"}]})

    def test_json_node_returns_normalized_json(self):
        scene, normalized = scene_nodes.AkiAnimaSceneFromJSON().load_scene('{"objects": []}')
        self.assertEqual(scene["version"], "0.3")
        self.assertEqual(json.loads(normalized), scene)

    def test_artist_scene_normalizes_pose_and_relations(self):
        scene = scene_nodes.normalize_scene(
            {
                "mode": "artist",
                "objects": [
                    {"id": "table", "kind": "prop"},
                    {"id": "girl", "kind": "character", "pose": {"preset": "sitting", "keypoints": [[2, -1]] * 17}},
                ],
                "relations": [{"source": "girl", "target": "table", "description": "girl sits beside table"}],
                "artist": {"pose_model": "preview2", "character_denoise": 2},
            }
        )
        self.assertEqual(scene["mode"], "artist")
        self.assertEqual(scene["objects"][1]["pose"]["preset"], "sitting")
        self.assertEqual(scene["objects"][1]["pose"]["keypoints"][0], [1.0, 0.0])
        self.assertEqual(scene["relations"][0]["source"], "girl")
        self.assertEqual(scene["artist"]["character_denoise"], 1.0)

    def test_artist_scene_drops_relations_with_missing_objects(self):
        scene = scene_nodes.normalize_scene({"objects": [{"id": "girl"}], "relations": [{"source": "girl", "target": "missing"}]})
        self.assertEqual(scene["relations"], [])

    def test_conditioning_adds_soft_and_hard_regions(self):
        scene = {
            "global_prompt": "global",
            "global_negative_prompt": "bad",
            "objects": [
                {"id": "soft", "prompt": "white hair", "bbox": [0.1, 0.2, 0.4, 0.8], "feather": 0.05},
                {"id": "hard", "prompt": "black hair", "bbox": [0.6, 0.2, 0.9, 0.8], "region_mode": "hard"},
            ],
        }
        positive, negative = scene_nodes.AkiAnimaSceneConditioning().build_conditioning(scene, FakeClip())
        self.assertEqual(len(positive), 3)
        self.assertEqual(len(negative), 1)
        self.assertEqual(positive[1][1]["area"], ("percentage", 1.0, 0.7000000000000001, 0.4, 0.0, 0.15000000000000002, 0.05))
        self.assertFalse(positive[1][1]["set_area_to_bounds"])
        self.assertTrue(positive[2][1]["set_area_to_bounds"])


if __name__ == "__main__":
    unittest.main()

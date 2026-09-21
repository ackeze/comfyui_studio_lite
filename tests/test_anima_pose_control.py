import importlib.util
import json
from pathlib import Path
import unittest

import torch


MODULE_PATH = Path(__file__).resolve().parents[1] / "anima_pose_control.py"
SPEC = importlib.util.spec_from_file_location("aki_anima_pose_control", MODULE_PATH)
pose_control = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pose_control)


class AnimaPoseControlTests(unittest.TestCase):
    def test_control_embedder_matches_anima_token_layout(self):
        embedder = pose_control.ControlEmbedder(in_channels=16, model_channels=32)
        control = torch.zeros((1, 16, 1, 8, 12))
        self.assertEqual(tuple(embedder(control).shape), (1, 1, 4, 6, 32))

    def test_control_embedder_accepts_image_latent_layout(self):
        embedder = pose_control.ControlEmbedder(in_channels=16, model_channels=32)
        control = torch.zeros((1, 16, 8, 12))
        self.assertEqual(tuple(embedder(control).shape), (1, 1, 4, 6, 32))

    def test_control_embedder_rejects_invalid_layout(self):
        embedder = pose_control.ControlEmbedder(in_channels=16, model_channels=32)
        with self.assertRaisesRegex(ValueError, "4D or 5D"):
            embedder(torch.zeros((16, 8, 12)))

    def test_node_uses_installed_preview_model_by_default(self):
        required = pose_control.AnimaControlApply.INPUT_TYPES()["required"]
        self.assertEqual(required["control_embedder_path"][1]["default"], "anima_pose_preview2.safetensors")

    def test_official_renderer_requires_wholebody_133(self):
        renderer = pose_control.AnimaPoseRenderOfficial()
        with self.assertRaisesRegex(ValueError, "exactly 133"):
            renderer.render(json.dumps({"canvas": 64, "points": [[0, 0, 1]] * 17}), 64)

    def test_official_renderer_draws_body_face_hands_and_feet(self):
        points = [[32, 32, 0] for _ in range(133)]
        for index in range(17):
            points[index] = [16 + index % 4 * 10, 8 + index // 4 * 11, 1]
        for index in range(17, 23):
            points[index] = [10 + (index - 17) * 8, 58, 1]
        for index in range(23, 91):
            points[index] = [24 + (index - 23) % 17, 12 + (index - 23) // 17, 1]
        for index in range(91, 133):
            points[index] = [5 + (index - 91) % 21, 45 + (index - 91) // 21 * 8, 1]
        image = pose_control.AnimaPoseRenderOfficial().render(json.dumps({"canvas": 64, "points": points}), 64)[0]
        self.assertEqual(tuple(image.shape), (1, 64, 64, 3))
        self.assertGreater(float(image.max()), 0)
        self.assertGreater(float(image[0, 45, 5, 1]), 0)

    def test_renderer_rejects_face_only_detection(self):
        points = [[32, 32, 0] for _ in range(133)]
        for index in range(23, 91):
            points[index][2] = 1
        with self.assertRaisesRegex(ValueError, "No visible body skeleton"):
            pose_control.AnimaPoseRenderOfficial().render(json.dumps({"canvas": 64, "points": points}), 64)


if __name__ == "__main__":
    unittest.main()

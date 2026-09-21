import importlib.util
from pathlib import Path
import unittest

import numpy as np
from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "sam_cutout.py"
SPEC = importlib.util.spec_from_file_location("aki_sam_cutout", MODULE_PATH)
sam_cutout = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sam_cutout)


class SamCutoutTests(unittest.TestCase):
    def test_normalize_bbox_clamps_values(self):
        self.assertEqual(sam_cutout.normalize_cutout_bbox([-1, 0.2, 2, 0.8]), [0.0, 0.2, 1.0, 0.8])

    def test_normalize_bbox_rejects_tiny_selection(self):
        with self.assertRaisesRegex(ValueError, "too small"):
            sam_cutout.normalize_cutout_bbox([0.2, 0.2, 0.205, 0.8])

    def test_apply_mask_outputs_transparent_png_pixels(self):
        image = Image.new("RGB", (4, 4), "red")
        mask = np.zeros((4, 4), dtype=bool)
        mask[1:3, 1:3] = True
        output = sam_cutout.apply_cutout_mask(image, mask, 0)
        self.assertEqual(output.mode, "RGBA")
        self.assertEqual(output.getpixel((0, 0))[3], 0)
        self.assertEqual(output.getpixel((1, 1))[3], 255)

    def test_mask_metrics_returns_normalized_subject_bounds(self):
        mask = np.zeros((10, 20), dtype=bool)
        mask[2:8, 5:15] = True
        metrics = sam_cutout.mask_metrics(mask)
        self.assertEqual(metrics["alpha_coverage"], 0.3)
        self.assertEqual(metrics["alpha_bbox"], [0.25, 0.2, 0.75, 0.8])

    def test_clean_mask_keeps_main_subject_and_repairs_small_hole(self):
        mask = np.zeros((20, 20), dtype=bool)
        mask[3:17, 5:15] = True
        mask[8, 9] = False
        mask[1, 1] = True
        cleaned = sam_cutout.clean_sam_mask(mask)
        self.assertTrue(cleaned[8, 9])
        self.assertFalse(cleaned[1, 1])


if __name__ == "__main__":
    unittest.main()

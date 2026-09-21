import importlib.util
import tempfile
import unittest
from pathlib import Path


SPEC = importlib.util.spec_from_file_location('studio_install', Path(__file__).parents[1] / 'install.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        (self.root / 'models' / 'unet').mkdir(parents=True)
        (self.root / 'models' / 'vae').mkdir(parents=True)
        (self.root / 'models' / 'text_encoders').mkdir(parents=True)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.root, ignore_errors=True)

    def test_manifest_has_required_downloads(self):
        ids = {item['id'] for item in INSTALL.load_resources()}
        self.assertTrue({'anima-unet', 'anima-clip', 'anima-vae', 'pose-preview2', 'sam-vit-b'} <= ids)
        for item in INSTALL.load_resources():
            self.assertTrue(item['url'].startswith('https://'))
            self.assertGreater(item['size'], 0)

    def test_existing_anima_unet_alias_is_detected(self):
        (self.root / 'models' / 'unet' / 'waiANIMA_v10Base10.safetensors').write_bytes(b'x')
        resource = next(item for item in INSTALL.load_resources() if item['id'] == 'anima-unet')
        self.assertTrue(INSTALL.existing_path(self.root, resource).name.startswith('waiANIMA'))

    def test_vae_prefix_accepts_renamed_file(self):
        (self.root / 'models' / 'vae' / 'qwen_image_vae.safetensors_..safetensors').write_bytes(b'x')
        resource = next(item for item in INSTALL.load_resources() if item['id'] == 'anima-vae')
        self.assertIsNotNone(INSTALL.existing_path(self.root, resource))

    def test_missing_clip_is_reported(self):
        resource = next(item for item in INSTALL.load_resources() if item['id'] == 'anima-clip')
        self.assertIsNone(INSTALL.existing_path(self.root, resource))

    def test_mirror_urls_include_hf_mirror(self):
        urls = INSTALL.mirror_urls('https://huggingface.co/circlestone-labs/Anima/resolve/main/file.safetensors')
        self.assertIn('https://hf-mirror.com/circlestone-labs/Anima/resolve/main/file.safetensors', urls)

    def test_default_selection_skips_nothing_required(self):
        chosen = {item['id'] for item in INSTALL.selected(INSTALL.load_resources(), 'recommended')}
        self.assertIn('anima-unet', chosen)
        self.assertIn('sam-vit-b', chosen)


if __name__ == '__main__':
    unittest.main()

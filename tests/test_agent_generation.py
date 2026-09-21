import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.models = {'diffusion_models': ['nested/anima-base-v1.0.safetensors'], 'text_encoders': ['qwen_3_06b_base.safetensors'], 'vae': ['qwen_image_vae.safetensors_..safetensors'], 'loras': ['nested/hansanima-guizhencaolora.safetensors']}
        spec = importlib.util.spec_from_file_location('agent_generation_test', Path(__file__).parents[1] / 'agent_generation.py')
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'folder_paths': types.SimpleNamespace(get_filename_list=lambda category: self.models[category])}):
            spec.loader.exec_module(self.module)
        self.arguments = {'model': self.models['diffusion_models'][0], 'prompt': 'An adult woman with white hair.', 'width': 1024, 'height': 768}
        self.lora = self.models['loras'][0]

    def test_actual_companion_names_and_landscape(self):
        graph, settings = self.module.build_generation(self.arguments)
        self.assertEqual(graph['10']['inputs']['type'], 'stable_diffusion')
        self.assertEqual(graph['11']['inputs']['vae_name'], self.models['vae'][0])
        self.assertEqual(graph['5']['inputs'], {'width': 1024, 'height': 768, 'batch_size': 1})
        self.assertEqual(graph['6']['inputs']['text'], self.arguments['prompt'])
        self.assertEqual(graph['3']['inputs']['sampler_name'], 'euler')
        self.assertEqual(graph['3']['inputs']['steps'], 35)
        self.assertEqual(graph['3']['inputs']['cfg'], 4.0)
        self.assertGreaterEqual(settings['seed'], 0)

    def test_every_generation_parameter_is_applied(self):
        loras = [{'name': self.lora, 'model_strength': 0.8}, {'name': self.lora, 'clip_strength': 0.5}]
        graph, settings = self.module.build_generation(dict(self.arguments, steps=40, cfg=5.5, sampler='dpmpp_2m_sde', scheduler='karras', batch_size=3, weight_dtype='fp8_e4m3fn', clip_type='qwen_image', seed=42, loras=loras))
        self.assertEqual(graph['4']['inputs'], {'unet_name': self.arguments['model'], 'weight_dtype': 'fp8_e4m3fn'})
        self.assertEqual(graph['10']['inputs']['type'], 'qwen_image')
        self.assertEqual(graph['20']['inputs'], {'model': ['4', 0], 'clip': ['10', 0], 'lora_name': self.lora, 'strength_model': 0.8, 'strength_clip': 1.0})
        self.assertEqual(graph['21']['inputs']['model'], ['20', 0])
        self.assertEqual(graph['21']['inputs']['strength_clip'], 0.5)
        self.assertEqual(graph['3']['inputs']['model'], ['21', 0])
        self.assertEqual(graph['6']['inputs']['clip'], ['21', 1])
        self.assertEqual(graph['7']['inputs']['clip'], ['21', 1])
        self.assertEqual(graph['5']['inputs']['batch_size'], 3)
        self.assertEqual(graph['3']['inputs']['steps'], 40)
        self.assertEqual(graph['3']['inputs']['cfg'], 5.5)
        self.assertEqual(graph['3']['inputs']['sampler_name'], 'dpmpp_2m_sde')
        self.assertEqual(graph['3']['inputs']['scheduler'], 'karras')
        self.assertEqual(graph['3']['inputs']['seed'], 42)
        self.assertEqual(settings['loras'][0]['model_strength'], 0.8)

    def test_camera_weights_are_injected_into_prompts(self):
        graph, settings = self.module.build_generation(dict(self.arguments, camera={'enabled': True, 'azimuth': 225, 'elevation': -60, 'distance': 2, 'weight': 1.35, 'distance_weight': 0.5}))
        positive = graph['6']['inputs']['text']
        self.assertTrue(positive.startswith(self.arguments['prompt'] + ', (from behind:0.60), (facing right:0.60)'))
        self.assertIn('(low angle:0.90)', positive)
        self.assertIn('(from below:0.90)', positive)
        self.assertIn('(close-up:0.50)', positive)
        self.assertEqual(graph['7']['inputs']['text'], 'multiple views, character sheet, reference sheet, panorama')
        self.assertEqual(settings['camera']['azimuth'], 225)

    def test_camera_accepts_editor_distance_weight_key(self):
        graph, _ = self.module.build_generation(dict(self.arguments, camera={'enabled': True, 'azimuth': 225, 'elevation': -60, 'distance': 2, 'distanceWeight': 0.5}))
        self.assertIn('(close-up:0.50)', graph['6']['inputs']['text'])

    def test_negative_prompt_drops_censorship_tags(self):
        graph, _ = self.module.build_generation(dict(self.arguments, negative_prompt='nsfw, worst quality, rating_safe, blurry, nude, safe'))
        self.assertEqual(graph['7']['inputs']['text'], 'worst quality, blurry')
        self.assertEqual(self.module.clean_negative('sfw, censored, extra limbs, mosaic'), 'extra limbs')

    def test_camera_disabled_keeps_prompts_untouched(self):
        graph, _ = self.module.build_generation(dict(self.arguments, camera={'enabled': False, 'azimuth': 90}))
        self.assertEqual(graph['6']['inputs']['text'], self.arguments['prompt'])
        self.assertEqual(graph['7']['inputs']['text'], '')

    def test_invalid_models_and_sizes(self):
        for changes in ({'model': '../anima.safetensors'}, {'width': 999}, {'height': 4096}, {'steps': 999}, {'cfg': float('nan')}):
            with self.assertRaises(ValueError):
                self.module.build_generation(dict(self.arguments, **changes))
        self.models['vae'] = []
        with self.assertRaises(ValueError):
            self.module.build_generation(self.arguments)

    def test_invalid_parameters(self):
        for changes in (
            {'loras': [{'name': 'missing.safetensors'}]},
            {'loras': [{'name': self.lora, 'model_strength': 'high'}]},
            {'loras': [self.lora]},
            {'loras': [{'name': self.lora}] * 9},
            {'weight_dtype': 'bf16'},
            {'clip_type': ''},
            {'sampler': ' '},
            {'scheduler': 'x' * 80},
            {'batch_size': 0},
            {'batch_size': 1.5},
            {'steps': True},
            {'seed': 2**53},
        ):
            with self.assertRaises(ValueError):
                self.module.build_generation(dict(self.arguments, **changes))


if __name__ == '__main__':
    unittest.main()


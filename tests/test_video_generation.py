import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


class VideoTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / 'first.png').touch()
        (self.root / 'last.png').touch()
        self.files = {
            'diffusion_models': ['minimax_h3_fl2va_pruned_int8_convrot.safetensors', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'],
            'text_encoders': ['qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'],
            'vae': ['minimax_h3_video_vae_fp16.safetensors', 'minimax_h3_audio_vae_fp32.safetensors'],
            'loras': ['minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'],
        }
        sampler = types.SimpleNamespace(INPUT_TYPES=lambda: {'required': {'sampler_name': (['euler'],), 'scheduler': (['simple'],)}})
        self.mapping = dict.fromkeys(['UNETLoader', 'LoraLoaderModelOnly', 'MiniMaxH3SigmaShift', 'CLIPLoader', 'VAELoader', 'LoadImage', 'MiniMaxH3ImageToVideo', 'MiniMaxH3ReferenceToVideo', 'ConditioningZeroOut', 'LTXVSeparateAVLatent', 'VAEDecode', 'VAEDecodeAudio', 'CreateVideo', 'SaveVideo'], object)
        self.mapping['KSampler'] = sampler
        folders = types.SimpleNamespace(get_filename_list=lambda category: self.files[category], get_input_directory=lambda: self.root,
                                        get_annotated_filepath=lambda name: self.root / name.removesuffix(' [input]'))
        spec = importlib.util.spec_from_file_location('studio_video_test', Path(__file__).parents[1] / 'video_generation.py')
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'folder_paths': folders, 'nodes': types.SimpleNamespace(NODE_CLASS_MAPPINGS=self.mapping)}):
            spec.loader.exec_module(self.module)

    def build(self, **arguments):
        return self.module.build_video({'prompt': 'integrated_multimodal_description: [Shot 1] A boat drifts across a pond.', 'seed': 42, **arguments})

    def node(self, graph, kind):
        return next((key, node['inputs']) for key, node in graph.items() if node['class_type'] == kind)

    def test_text_has_joint_sampling_and_real_audio_video_output(self):
        graph, settings = self.build()
        self.assertEqual(settings['length'], 124)
        self.assertEqual(settings['duration'], 124 / 24)
        self.assertEqual(settings['seed'], 42)
        self.assertEqual(self.node(graph, 'CLIPLoader')[1]['type'], 'minimax')
        cond_id, cond = self.node(graph, 'MiniMaxH3ImageToVideo')
        self.assertNotIn('first_frame', cond)
        sampled_id, sampled = self.node(graph, 'KSampler')
        self.assertEqual(sampled['latent_image'], [cond_id, 1])
        split_id, split = self.node(graph, 'LTXVSeparateAVLatent')
        self.assertEqual(split['av_latent'], [sampled_id, 0])
        self.assertEqual(self.node(graph, 'VAEDecode')[1]['samples'], [split_id, 0])
        self.assertEqual(self.node(graph, 'VAEDecodeAudio')[1]['samples'], [split_id, 1])
        self.assertIn('audio', self.node(graph, 'CreateVideo')[1])
        self.assertEqual(self.node(graph, 'SaveVideo')[1]['format'], 'mp4')
        self.assertFalse(any(node['class_type'] == 'SaveImage' for node in graph.values()))

    def test_frames_turbo_and_silent_output(self):
        graph, settings = self.build(mode='frames', first_frame='first.png', last_frame='last.png', turbo=True, audio=False, duration=15)
        self.assertEqual(settings['length'], 362)
        self.assertEqual(settings['steps'], 8)
        self.assertEqual(settings['cfg'], 1)
        inputs = self.node(graph, 'MiniMaxH3ImageToVideo')[1]
        self.assertEqual(graph[inputs['first_frame'][0]]['inputs']['image'], 'first.png')
        self.assertEqual(graph[inputs['last_frame'][0]]['inputs']['image'], 'last.png')
        self.assertEqual(self.node(graph, 'LoraLoaderModelOnly')[1]['strength_model'], 1)
        self.assertNotIn('audio', self.node(graph, 'CreateVideo')[1])

    def test_reference_images_use_v3_autogrow_inputs(self):
        graph, settings = self.build(mode='reference', reference_images=['first.png', 'last.png'])
        self.assertIn('ref2va', settings['model'])
        inputs = self.node(graph, 'MiniMaxH3ReferenceToVideo')[1]
        self.assertEqual(set(key for key in inputs if key.startswith('ref_images.')), {'ref_images.ref_image_0', 'ref_images.ref_image_1'})
        self.assertNotIn('first_frame', inputs)

    def test_modes_cannot_silently_drop_references(self):
        for args in [{'mode': 'frames'}, {'mode': 'reference'}, {'first_frame': 'first.png'}, {'mode': 'frames', 'first_frame': 'first.png', 'reference_images': ['last.png']}, {'mode': 'reference', 'reference_images': ['first.png'], 'turbo': True}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.build(**args)

    def test_input_containment_and_model_compatibility(self):
        for name in ['../outside.png', 'missing.png', 'first.png [output]', 'first.png [temp]']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.build(mode='frames', first_frame=name)
        with self.assertRaises(ValueError):
            self.build(model=self.files['diffusion_models'][1])
        self.files['text_encoders'].append('other_minimax_h3.safetensors')
        with self.assertRaises(ValueError):
            self.build()

    def test_invalid_dimensions_numbers_and_missing_nodes(self):
        for args in [{'width': 1025}, {'width': 1536, 'height': 1536}, {'duration': float('nan')}, {'seed': 2**53}, {'audio': 1}, {'steps': True}]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                self.build(**args)
        del self.mapping['SaveVideo']
        with self.assertRaisesRegex(ValueError, 'SaveVideo'):
            self.build()


class VideoRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_shared_builder_route_and_origin(self):
        helper = VideoTests()
        helper.setUp()
        self.addCleanup(helper.doCleanups)
        routes = web.RouteTableDef()
        helper.module.install_video(routes)
        app = web.Application()
        app.add_routes(routes)
        async with TestClient(TestServer(app)) as client:
            response = await client.post('/launcher/video/workflow', json={'prompt': 'A boat on a pond.'})
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())['settings']['media'], 'video')
            response = await client.post('/launcher/video/workflow', json={'prompt': ''})
            self.assertEqual(response.status, 400)
            response = await client.post('/launcher/video/workflow', json={'prompt': 'A boat.'}, headers={'Origin': 'https://example.invalid'})
            self.assertEqual(response.status, 403)


if __name__ == '__main__':
    unittest.main()

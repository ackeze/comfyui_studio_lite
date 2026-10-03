import asyncio
import base64
import copy
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image


class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        folders = types.SimpleNamespace(get_user_directory=lambda: self.directory.name, get_folder_paths=lambda category: [self.directory.name], get_filename_list=lambda category: ['test.safetensors'], get_input_directory=lambda: self.directory.name, get_output_directory=lambda: self.directory.name, get_annotated_filepath=lambda name: str(Path(self.directory.name) / name))
        spec = importlib.util.spec_from_file_location('studio_agent_test', Path(__file__).parents[1] / 'agent.py')
        self.agent = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'folder_paths': folders}):
            spec.loader.exec_module(self.agent)
        self.replies = []
        self.payloads = []
        self.generations = []
        self.queue_actions = []
        self.queue = {'queue_running': [], 'queue_pending': []}
        self.history = {}
        owner = self

        class Response:
            status = 200
            headers = {'Content-Type': 'application/json'}

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def json(self, **kwargs):
                reply = owner.replies.pop(0)
                if isinstance(reply, Exception):
                    raise reply
                return {'choices': [{'message': reply}]}

        class Payload:
            headers = {'Content-Type': 'application/json'}

            def __init__(self, payload, status=200):
                self.payload = payload
                self.status = status

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def json(self, **kwargs):
                return self.payload

        class Submitted(Response):
            async def json(self, **kwargs):
                return {'prompt_id': owner.generations[-1]['prompt_id']}

        class Provider:
            def __init__(self, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            def post(self, url, **kwargs):
                if url.endswith('/queue') or url.endswith('/interrupt'):
                    owner.queue_actions.append((url.rsplit('/', 1)[1], kwargs['json']))
                    return Payload({})
                if url == 'http://127.0.0.1:8188/prompt':
                    owner.generations.append(kwargs['json'])
                    return Submitted()
                owner.payloads.append(copy.deepcopy(kwargs['json']))
                return Response()

            def get(self, url, **kwargs):
                if url.endswith('/queue'):
                    return Payload(owner.queue)
                if '/history/' in url:
                    key = url.rsplit('/', 1)[1]
                    return Payload({key: owner.history[key]} if key in owner.history else {})
                raise ConnectionError('mock resource unavailable')

        self.agent.aiohttp = types.SimpleNamespace(ClientSession=Provider, ClientTimeout=lambda **kwargs: None, ClientError=ConnectionError)
        routes = web.RouteTableDef()
        self.config = {'api_base': 'https://example.invalid', 'model': 'test'}
        self.agent.install_agent(routes, lambda: self.config, lambda: 'sk-test-private-123', lambda arguments: ({'test': {}}, arguments), video_builder=lambda arguments: ({'video': {'class_type': 'SaveVideo', 'inputs': {}}}, {**arguments, 'media': 'video'}))
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self):
        await self.client.close()
        self.directory.cleanup()

    async def wait_state(self, identity, expected):
        for _ in range(50):
            response = await self.client.get('/launcher/agent/sessions/' + identity)
            state = await response.json()
            if state['status'] == expected:
                return state
            await asyncio.sleep(.01)
        self.fail(state)

    def discover(self, *names):
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'discover_' + str(len(self.replies)), 'type': 'function', 'function': {'name': 'discover_tools', 'arguments': json.dumps({'names': list(names)})}}]})

    def jpeg(self):
        data = BytesIO()
        Image.new('RGB', (8, 12)).save(data, format='JPEG')
        return 'data:image/jpeg;base64,' + base64.b64encode(data.getvalue()).decode()

    def call(self, name, arguments, identity='call_video'):
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': identity, 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}]})

    async def test_multimodal_routing_and_followup_keep_images(self):
        self.config.update(api_base='https://api.deepseek.com', model='deepseek-v4-pro')
        self.replies.append({'role': 'assistant', 'content': '看到了图片'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '描述图片', 'images': [self.jpeg()]})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'done')
        self.assertEqual(self.payloads[-1]['model'], 'deepseek-flash')
        self.assertEqual(state['events'][0]['images'], [self.jpeg()])
        self.replies.append({'role': 'assistant', 'content': '图片里没有文字'})
        await self.client.post('/launcher/agent/sessions/' + identity + '/messages', json={'text': '里面有没有文字'})
        await self.wait_state(identity, 'done')
        self.assertEqual(self.payloads[-1]['model'], 'deepseek-flash')
        self.assertEqual(self.payloads[-1]['messages'][1]['content'][1]['type'], 'image_url')
        self.config.update(vision_model='custom-vision')
        self.assertEqual(self.agent.chat_model(self.config, self.payloads[-1]['messages']), 'custom-vision')
        self.assertEqual(self.agent.chat_model(self.config, [{'role': 'user', 'content': '文字'}]), 'deepseek-v4-pro')
        self.config = {'api_base': 'http://localhost:1234/v1', 'model': 'local-vl'}
        self.assertEqual(self.agent.chat_model(self.config, self.payloads[-1]['messages']), 'local-vl')

    async def test_view_generated_image_sends_pixels_after_tool_result(self):
        self.config.update(api_base='https://api.deepseek.com', model='deepseek-v4-pro')
        Image.new('RGBA', (40, 20), (255, 0, 0, 255)).save(Path(self.directory.name) / 'result.png')
        self.discover('view_images')
        self.call('view_images', {'images': [{'filename': 'result.png', 'type': 'output'}]}, 'see_result')
        self.replies.append({'role': 'assistant', 'content': '红色的图片'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '看一下生成的 result.png'})
        state = await self.wait_state((await response.json())['id'], 'done')
        messages = self.payloads[-1]['messages']
        self.assertEqual(messages[-2]['role'], 'tool')
        self.assertEqual(messages[-2]['tool_call_id'], 'see_result')
        self.assertEqual(messages[-1]['role'], 'user')
        url = messages[-1]['content'][1]['image_url']['url']
        with Image.open(BytesIO(base64.b64decode(url.split(',', 1)[1]))) as image:
            self.assertEqual(image.size, (40, 20))
            self.assertGreater(image.getpixel((0, 0))[0], 240)
        self.assertEqual(self.payloads[-1]['model'], 'deepseek-flash')
        self.assertEqual(sum(event['type'] == 'user' for event in state['events']), 1)
        self.assertNotIn('base64', json.dumps(state['events']))

    async def test_view_images_rejects_escape_and_nonimages(self):
        for file in [{'filename': '../private.png', 'type': 'input'}, {'filename': 'secret.yaml', 'type': 'output'}, {'filename': 'missing.png', 'type': 'output'}]:
            with self.assertRaises(ValueError):
                self.agent.local_image_part(file)
        outside = Path(self.directory.name).parent / (Path(self.directory.name).name + '-outside.png')
        Image.new('RGB', (8, 8)).save(outside)
        try:
            link = Path(self.directory.name) / 'link.png'
            try:
                link.symlink_to(outside)
            except OSError:
                return
            with self.assertRaises(ValueError):
                self.agent.local_image_part({'filename': 'link.png', 'type': 'input'})
        finally:
            outside.unlink()

    async def test_retry_after_viewing_image_resubmits_generation(self):
        Image.new('RGB', (8, 8)).save(Path(self.directory.name) / 'result.png')
        arguments = {'model': 'anima.safetensors', 'prompt': 'A red circle.', 'width': 768, 'height': 1024}
        self.discover('generate_image', 'view_images')
        self.call('generate_image', arguments, 'generate_once')
        self.call('view_images', {'images': [{'filename': 'result.png', 'type': 'output'}]}, 'see_once')
        self.replies.append({'role': 'assistant', 'content': '看到了结果'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '生成并检查图片'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.discover('generate_image')
        self.call('generate_image', arguments, 'duplicate')
        self.replies.append({'role': 'assistant', 'content': '沿用已有结果'})
        response = await self.client.post('/launcher/agent/sessions/' + state['id'] + '/fork', json={'action': 'retry', 'message_index': state['events'][-1]['message_index']})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 2)
        self.assertNotEqual(branch['jobs'][0]['prompt_id'], state['jobs'][0]['prompt_id'])
        self.assertTrue(any(event.get('id') == 'duplicate' and event['status'] == 'done' for event in branch['events']))

    async def test_attached_original_thumbnail_uses_local_url(self):
        Image.new('RGB', (8, 12)).save(Path(self.directory.name) / 'original.png')
        self.replies.append({'role': 'assistant', 'content': '看到了'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '看图', 'images': [self.jpeg()], 'image_files': ['original.png']})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertIn('filename=original.png', state['events'][0]['images'][0])
        self.assertIn('type=input', state['events'][0]['images'][0])
        stored = json.loads((Path(self.directory.name) / 'comfy_studio_agent' / (state['id'] + '.json')).read_text(encoding='utf-8'))
        self.assertNotIn('images', stored['events'][0])

    async def test_video_retry_keeps_original_chat_image_and_queues_new_job(self):
        Image.new('RGB', (800, 1000)).save(Path(self.directory.name) / 'reference.png')
        arguments = {'prompt': 'A tree sways.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 1, 'last_frame_image': 1}
        self.discover('generate_video')
        self.call('generate_video', arguments, 'original_video')
        self.replies.append({'role': 'assistant', 'content': '已入队'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '用这张图做视频', 'images': [self.jpeg()], 'image_files': ['reference.png']})
        original = await self.wait_state((await response.json())['id'], 'done')
        self.discover('generate_video')
        self.call('generate_video', arguments, 'retry_video')
        self.replies.append({'role': 'assistant', 'content': '重新生成已入队'})
        response = await self.client.post(f"/launcher/agent/sessions/{original['id']}/fork", json={'action': 'retry', 'message_index': original['events'][-1]['message_index']})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 2)
        self.assertEqual(branch['jobs'][0]['settings']['first_frame'], 'reference.png')
        self.assertEqual(branch['jobs'][0]['settings']['last_frame'], 'reference.png')
        self.assertNotEqual(branch['jobs'][0]['prompt_id'], original['jobs'][0]['prompt_id'])
        saved = json.loads(Path(self.directory.name, 'comfy_studio_agent', branch['id'] + '.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['image_inputs'], {'1': ['reference.png']})

    async def test_retry_only_reexecutes_selected_turn_preserving_earlier_jobs(self):
        arguments = {'model': 'anima.safetensors', 'prompt': 'A city.', 'width': 768, 'height': 1024}
        for turn in range(2):
            self.discover('generate_image')
            self.call('generate_image', arguments, 'generation_' + str(turn))
            self.replies.append({'role': 'assistant', 'content': '已入队'})
            if turn == 0:
                response = await self.client.post('/launcher/agent/sessions', json={'text': '第一张图片'})
                identity = (await response.json())['id']
            else:
                await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '第二张图片'})
            original = await self.wait_state(identity, 'done')
        target = original['events'][-1]['message_index']
        self.replies.append({'role': 'assistant', 'content': '未来消息'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '后续问题'})
        source = await self.wait_state(identity, 'done')
        self.discover('generate_image')
        self.call('generate_image', arguments, 'new_second_image')
        self.replies.append({'role': 'assistant', 'content': '第二张已重新生成'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry', 'message_index': target})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 3)
        self.assertEqual(branch['jobs'][0], original['jobs'][0])
        self.assertNotEqual(branch['jobs'][1]['prompt_id'], original['jobs'][1]['prompt_id'])
        self.assertEqual([event['text'] for event in branch['events'] if event['type'] == 'user'], ['第一张图片', '第二张图片'])
        self.assertEqual(await (await self.client.get(f'/launcher/agent/sessions/{identity}')).json(), source)

    async def test_video_uses_original_chat_image_for_both_frames(self):
        Image.new('RGB', (1600, 2000)).save(Path(self.directory.name) / 'original.png')
        self.discover('generate_video')
        self.call('generate_video', {'prompt': 'The chair rocks gently.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 1, 'last_frame_image': 1, 'audio': False})
        self.replies.append({'role': 'assistant', 'content': '视频已入队'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '用这张图做首尾帧', 'images': [self.jpeg()], 'image_files': ['original.png']})
        state = await self.wait_state((await response.json())['id'], 'done')
        settings = state['jobs'][0]['settings']
        self.assertEqual(settings['first_frame'], 'original.png')
        self.assertEqual(settings['last_frame'], 'original.png')
        self.assertEqual(settings['mode'], 'frames')
        self.assertEqual((settings['width'], settings['height']), (768, 960))
        self.assertNotIn('first_frame_image', settings)

    async def test_video_old_chat_image_resolves_without_reupload(self):
        self.discover('generate_video')
        self.call('generate_video', {'prompt': 'A tree moves gently.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 1, 'last_frame_image': 1})
        self.replies.append({'role': 'assistant', 'content': '已入队'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '制作视频', 'images': [self.jpeg()]})
        state = await self.wait_state((await response.json())['id'], 'done')
        settings = state['jobs'][0]['settings']
        self.assertEqual(settings['first_frame'], settings['last_frame'])
        self.assertTrue(Path(self.directory.name, settings['first_frame']).is_file())

    async def test_phone_orientation_controls_video_canvas_ratio(self):
        exif = Image.Exif()
        exif[274] = 6
        Image.new('RGB', (1200, 800)).save(Path(self.directory.name) / 'phone.jpg', exif=exif)
        self.discover('generate_video')
        self.call('generate_video', {'prompt': 'A quiet moment.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 1})
        self.replies.append({'role': 'assistant', 'content': '已入队'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '制作视频', 'images': [self.jpeg()], 'image_files': ['phone.jpg']})
        state = await self.wait_state((await response.json())['id'], 'done')
        settings = state['jobs'][0]['settings']
        self.assertEqual((settings['width'], settings['height']), (768, 1152))

    async def test_video_configuration_never_enqueues_and_can_target_cancel(self):
        self.discover('video_editor')
        self.call('video_editor', {'mode': 'frames', 'first_frame_image': 1, 'last_frame_image': 1, 'duration': 5, 'width': 768, 'height': 992, 'audio': False})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '准备这张图的视频设置', 'images': [self.jpeg()]})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertEqual(state['pending']['action'], 'configure')
        self.assertEqual(state['pending']['video']['first_frame'], state['pending']['video']['last_frame'])
        item = {'workflow': {'1': {'class_type': 'SaveVideo', 'inputs': {}}}, 'settings': {}}
        rejected = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'call_video', 'result': {'workflows': [item]}})
        self.assertEqual(rejected.status, 400)
        self.replies.append({'role': 'assistant', 'content': '设置已准备，没有提交生成'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'call_video', 'result': {'settings': state['pending']['video'], 'jobs': [{'prompt_id': 'browser-job', 'status': 'queued'}]}})
        self.assertEqual(response.status, 200)
        await self.wait_state(identity, 'done')
        self.assertEqual(self.generations, [])
        self.queue['queue_running'] = [[1, 'browser-job'], [2, 'unrelated-job']]
        self.discover('cancel_generation')
        self.call('cancel_generation', {'prompt_id': 'browser-job'}, 'cancel_one')
        self.replies.append({'role': 'assistant', 'content': '已请求取消指定任务'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '取消这个视频任务'})
        await self.wait_state(identity, 'done')
        self.assertEqual(self.queue_actions, [('queue', {'delete': ['browser-job']}), ('interrupt', {'prompt_id': 'browser-job'})])

    async def test_video_editor_override_selects_chat_images_without_manual_steps(self):
        self.discover('generate_from_editor')
        self.call('generate_from_editor', {'media': 'video', 'prompt': 'A chair rocks gently.', 'video': {'first_frame_image': 1, 'last_frame_image': 1, 'duration': 5, 'width': 768, 'height': 992, 'turbo': True, 'audio': False}})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '用同图首尾帧直接生成', 'images': [self.jpeg()]})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'waiting')
        patch = state['pending']['video']
        self.assertEqual(patch['mode'], 'frames')
        self.assertEqual(patch['first_frame'], patch['last_frame'])
        self.assertEqual((patch['width'], patch['height']), (768, 992))
        self.assertTrue(patch['turbo'])
        self.assertFalse(patch['audio'])
        self.assertEqual(self.generations, [])

    async def test_chat_originals_survive_user_message_edit(self):
        Image.new('RGB', (512, 768)).save(Path(self.directory.name) / 'original.png')
        self.replies.append({'role': 'assistant', 'content': '收到图片'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '看看图片', 'images': [self.jpeg()], 'image_files': ['original.png']})
        identity = (await response.json())['id']
        await self.wait_state(identity, 'done')
        self.discover('generate_video')
        self.call('generate_video', {'prompt': 'A gentle movement.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 1})
        self.replies.append({'role': 'assistant', 'content': '已入队'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'edit', 'message_index': 1, 'text': '改为生成视频'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(state['jobs'][0]['settings']['first_frame'], 'original.png')

    async def test_invalid_chat_reference_and_unknown_cancel_do_nothing(self):
        self.discover('generate_video', 'cancel_generation')
        self.call('generate_video', {'prompt': 'A tree.', 'model': 'minimax_h3_fl2va.safetensors', 'first_frame_image': 2})
        self.call('cancel_generation', {'prompt_id': 'unrelated-job'}, 'cancel_invalid')
        self.replies.append({'role': 'assistant', 'content': '图片编号不正确，没有操作队列'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '制作视频', 'images': [self.jpeg()]})
        await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(self.generations, [])
        self.assertEqual(self.queue_actions, [])

    async def test_video_tool_tracks_playable_files_without_image_thumbnails(self):
        self.discover('generate_video')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'video_call', 'type': 'function', 'function': {'name': 'generate_video', 'arguments': json.dumps({'prompt': 'A boat drifts.', 'model': 'minimax_h3_fl2va.safetensors'})}}]})
        self.replies.append({'role': 'assistant', 'content': '视频已入队'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '生成视频'})
        identity = (await created.json())['id']
        state = await self.wait_state(identity, 'done')
        prompt_id = state['jobs'][0]['prompt_id']
        self.assertEqual(state['jobs'][0]['settings']['media'], 'video')
        self.assertEqual(self.generations[0]['prompt']['video']['class_type'], 'SaveVideo')
        file = {'filename': 'ComfyStudio-H3_00001_.mp4', 'subfolder': 'video', 'type': 'output'}
        self.history[prompt_id] = {'outputs': {'14': {'images': [file], 'animated': [True]}}, 'status': {'status_str': 'success'}}
        state = await (await self.client.get('/launcher/agent/sessions/' + identity + '/outputs')).json()
        self.assertEqual(state['jobs'][0]['videos'], [file])
        self.assertEqual(state['jobs'][0]['images'], [])
        self.assertEqual(state['jobs'][0]['status'], 'done')

    async def test_video_editor_automatic_submission_preserves_settings(self):
        self.discover('generate_from_editor')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'video_editor', 'type': 'function', 'function': {'name': 'generate_from_editor', 'arguments': '{"media":"video","prompt":"A boat drifts."}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '按我的视频编辑器生成'})
        identity = (await created.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertEqual(state['pending']['feature'], 'video')
        self.assertTrue(state['pending']['auto_submit'])
        item = {'workflow': {'1': {'class_type': 'SaveVideo', 'inputs': {'format': 'mp4'}}}, 'settings': {'media': 'video', 'duration': 124 / 24, 'first_frame': 'uploaded.png', 'seed': 42}}
        self.replies.append({'role': 'assistant', 'content': '视频已入队'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'video_editor', 'result': {'workflows': [item]}})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual(state['jobs'][0]['settings'], item['settings'])
        self.assertEqual(self.generations[0]['prompt'], item['workflow'])
        self.assertEqual(len(self.generations), 1)
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'video_editor', 'result': {'workflows': [item]}})
        self.assertEqual(response.status, 409)

    async def test_editor_resume_conversation_and_persistence(self):
        self.discover('request_editor')
        self.replies.append({'role': 'assistant', 'content': '请调整机位', 'tool_calls': [{'id': 'call_1', 'type': 'function', 'function': {'name': 'request_editor', 'arguments': '{"feature":"camera","instruction":"调整后提交"}'}}]})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '调整机位'})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertEqual(state['pending']['id'], 'call_1')
        self.replies.append({'role': 'assistant', 'content': '设置已收到'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'call_1', 'result': {'camera': {'azimuth': 35}}})
        self.assertEqual(response.status, 200)
        await self.wait_state(identity, 'done')
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'call_1', 'result': {}})
        self.assertEqual(response.status, 409)
        self.replies.append({'role': 'assistant', 'content': '继续对话'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '继续'})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual(len([event for event in state['events'] if event['type'] == 'user']), 2)
        saved = Path(self.directory.name, 'comfy_studio_agent', identity + '.json').read_text(encoding='utf-8')
        self.assertIn('azimuth', saved)
        self.assertNotIn('sk-test-private-123', saved)

    async def test_stream_delivers_final_state_and_closes(self):
        self.replies.append({'role': 'assistant', 'content': '流式回复完成'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '你好'})
        identity = (await created.json())['id']
        await self.wait_state(identity, 'done')
        response = await self.client.get(f'/launcher/agent/sessions/{identity}/stream')
        self.assertEqual(response.content_type, 'text/event-stream')
        payload = await asyncio.wait_for(response.text(), 2)
        state = json.loads(payload.strip().removeprefix('data: '))
        self.assertEqual(state['status'], 'done')
        self.assertEqual(state['events'][-1]['text'], '流式回复完成')

    def test_policy_allows_adult_nsfw(self):
        self.assertIn('Adult NSFW is in scope', self.agent.POLICY)
        self.assertIn('never add nsfw', self.agent.POLICY)
        self.assertIn('studio_resources', self.agent.POLICY)
        self.assertIn('loli', self.agent.POLICY)

    async def test_studio_install_waits_for_confirmation(self):
        self.discover('studio_resources', 'prepare_studio_install')
        root = Path(self.directory.name)
        (root / 'models').mkdir()
        self.agent.studio_install.find_comfy_root = lambda: root
        self.agent.studio_install.python_dep_missing = lambda: False
        downloaded = []

        def fake_download(url, destination, size):
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b'x')
            downloaded.append(destination.name)

        self.agent.studio_install.download = fake_download
        self.replies.extend([
            {'role': 'assistant', 'content': '先检查', 'tool_calls': [{'id': 's', 'type': 'function', 'function': {'name': 'studio_resources', 'arguments': '{"group":"required"}'}}]},
            {'role': 'assistant', 'content': '需要安装', 'tool_calls': [{'id': 'p', 'type': 'function', 'function': {'name': 'prepare_studio_install', 'arguments': '{"group":"required"}'}}]},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '帮我安装模型和依赖'})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertEqual(state['pending']['feature'], 'studio_install')
        self.assertEqual(set(state['pending']['ids']), {'anima-unet', 'anima-clip', 'anima-vae'})
        self.replies.append({'role': 'assistant', 'content': '已经装好'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': state['pending']['id'], 'result': {'approved': True}})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual(sorted(downloaded), ['anima-base-v1.0.safetensors', 'qwen_3_06b_base.safetensors', 'qwen_image_vae.safetensors'])
        self.assertIn('已经装好', [event['text'] for event in state['events'] if event['type'] == 'assistant'])

    async def test_studio_install_skips_when_complete(self):
        self.discover('prepare_studio_install')
        root = Path(self.directory.name)
        (root / 'models' / 'unet').mkdir(parents=True)
        (root / 'models' / 'unet' / 'waiANIMA.safetensors').write_bytes(b'x')
        (root / 'models' / 'text_encoders').mkdir()
        (root / 'models' / 'text_encoders' / 'qwen_3_06b_base.safetensors').write_bytes(b'x')
        (root / 'models' / 'vae').mkdir()
        (root / 'models' / 'vae' / 'qwen_image_vae.safetensors').write_bytes(b'x')
        self.agent.studio_install.find_comfy_root = lambda: root
        self.agent.studio_install.python_dep_missing = lambda: False
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'p', 'type': 'function', 'function': {'name': 'prepare_studio_install', 'arguments': '{"group":"required"}'}}]},
            {'role': 'assistant', 'content': '已经齐了'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '检查安装'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertIsNone(state['pending'])
        self.assertEqual([event['text'] for event in state['events'] if event['type'] == 'assistant'], ['已经齐了'])

    async def test_validation_and_cancel(self):
        response = await self.client.post('/launcher/agent/sessions', json={'text': ''})
        self.assertEqual(response.status, 400)
        response = await self.client.post('/launcher/agent/sessions', json={'text': 'x'}, headers={'Origin': 'https://attacker.invalid'})
        self.assertEqual(response.status, 403)
        self.discover('request_editor')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'c', 'type': 'function', 'function': {'name': 'request_editor', 'arguments': '{"feature":"pose","instruction":"确认"}'}}]})
        response = await self.client.post('/launcher/agent/sessions', json={'text': 'pose'})
        identity = (await response.json())['id']
        await self.wait_state(identity, 'waiting')
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/stop', json={})
        self.assertEqual((await response.json())['status'], 'cancelled')

    async def test_download_paths(self):
        for filename in ('../bad.safetensors', 'C:/bad.safetensors', 'bad.exe', 'foo\\bad.safetensors'):
            with self.assertRaises(ValueError):
                self.agent.download_target('loras', filename)
        self.assertFalse(self.agent.valid_repository('../repo'))
        self.assertFalse(self.agent.valid_repository('https://example.com/repo'))
        self.assertTrue(self.agent.valid_repository('owner/model'))
        self.assertEqual(self.agent.download_target('loras', 'folder/model.safetensors').name, 'model.safetensors')
        Path(self.directory.name, 'existing.safetensors').touch()
        with self.assertRaises(ValueError):
            self.agent.download_target('loras', 'existing.safetensors')

    async def test_tool_failure_does_not_abort_and_reasoning_is_preserved(self):
        self.discover('local_models', 'search_models')
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'reasoning_content': 'private-provider-state', 'tool_calls': [
                {'id': 'local', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}},
            ]},
            {'role': 'assistant', 'content': '', 'tool_calls': [
                {'id': 'remote', 'type': 'function', 'function': {'name': 'search_models', 'arguments': '{"query":"anima"}'}},
            ]},
            {'role': 'assistant', 'content': '远程搜索失败，可以使用本地模型。'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '检查模型'})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'done')
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['done', 'done', 'error'])
        self.assertNotIn('private-provider-state', json.dumps(state))
        self.assertEqual(self.payloads[2]['messages'][4]['reasoning_content'], 'private-provider-state')
        listing = await (await self.client.get('/launcher/agent/sessions')).json()
        self.assertEqual(listing['sessions'][0]['id'], identity)

    async def test_stream_assembles_text_and_tool_arguments(self):
        owner = self
        chunks = [
            {'reasoning_content': 'provider-state'},
            {'content': '正在检查'},
            {'tool_calls': [{'index': 0, 'id': 's1', 'function': {'name': 'discover_tools', 'arguments': '{"names":'}}]},
            {'tool_calls': [{'index': 0, 'function': {'arguments': '["local_models"]}'}}]},
        ]
        class Stream:
            async def __aiter__(self):
                for delta in chunks:
                    yield ('data: ' + json.dumps({'choices': [{'delta': delta}]}) + '\n').encode()
                yield b'data: [DONE]\n'
        class Response:
            status = 200
            headers = {'Content-Type': 'text/event-stream'}
            content = Stream()
            async def __aenter__(self):
                return self
            async def __aexit__(self, *args):
                pass
        original = self.agent.aiohttp.ClientSession
        class Provider(original):
            def post(self, url, **kwargs):
                if not owner.payloads:
                    owner.payloads.append(kwargs['json'])
                    return Response()
                return super().post(url, **kwargs)
        self.agent.aiohttp.ClientSession = Provider
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'local', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}}]},
            {'role': 'assistant', 'content': '完成'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '流式检查'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual([e['text'] for e in state['events'] if e['type'] == 'assistant'], ['正在检查', '完成'])
        self.assertEqual(self.payloads[1]['messages'][2]['tool_calls'][0]['function']['arguments'], '{"names":["local_models"]}')

    async def test_generation_is_submitted_without_editor(self):
        self.discover('generate_image')
        arguments = {'model': 'anima.safetensors', 'prompt': 'A white-haired adult woman.', 'width': 1024, 'height': 768}
        self.replies.extend([
            {'role': 'assistant', 'content': '开始生成', 'tool_calls': [{'id': 'g', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '已入队'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '生成一张图'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertIsNone(state['pending'])
        self.assertEqual(len(self.generations), 1)
        self.assertEqual(state['jobs'][0]['status'], 'queued')
        self.assertEqual(state['jobs'][0]['settings']['width'], 1024)


    async def test_generation_accepts_full_parameter_set(self):
        self.discover('generate_image')
        arguments = {'model': 'anima.safetensors', 'prompt': 'A white-haired adult woman.', 'width': 768, 'height': 1024, 'steps': 40, 'cfg': 5.5, 'sampler': 'dpmpp_2m_sde', 'scheduler': 'karras', 'batch_size': 3, 'loras': [{'name': 'lora.safetensors', 'model_strength': 0.8}], 'camera': {'enabled': True, 'azimuth': 225, 'distance': 2}}
        self.replies.extend([
            {'role': 'assistant', 'content': '开始生成', 'tool_calls': [{'id': 'g2', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '已入队'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '用 LoRA 加机位生成'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 1)
        self.assertEqual(state['jobs'][0]['settings'], arguments)
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['done', 'done'])

    async def test_generation_rejects_wrong_parameter_types(self):
        self.discover('generate_image')
        arguments = {'model': 'anima.safetensors', 'prompt': 'x', 'width': 768, 'height': 1024, 'loras': [{'name': 'lora.safetensors', 'model_strength': 'high'}]}
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'bad', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '参数无效'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '错误参数'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(self.generations, [])
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['done', 'error'])


    async def test_dropped_images_are_forwarded_as_message_parts(self):
        image = 'data:image/jpeg;base64,' + 'A' * 64
        self.replies.append({'role': 'assistant', 'content': '收到图片'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '', 'images': [image, image]})
        self.assertEqual(response.status, 200)
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(state['events'][0]['text'], '请看这张图片。')
        parts = self.payloads[0]['messages'][1]['content']
        self.assertEqual([part['type'] for part in parts], ['text', 'image_url', 'image_url'])
        self.assertEqual(parts[1]['image_url']['url'], image)
        rejected = await self.client.post('/launcher/agent/sessions', json={'text': 'x', 'images': [image] * 5})
        self.assertEqual(rejected.status, 400)
        broken = await self.client.post('/launcher/agent/sessions', json={'text': 'x', 'images': ['data:image/png;base64,AAAA']})
        self.assertEqual(broken.status, 400)
        empty = await self.client.post('/launcher/agent/sessions', json={'text': ''})
        self.assertEqual(empty.status, 400)


    async def test_outputs_track_queue_position_and_finished_images(self):
        self.discover('generate_image')
        arguments = {'model': 'anima.safetensors', 'prompt': 'A white-haired adult woman.', 'width': 768, 'height': 1024}
        self.replies.extend([
            {'role': 'assistant', 'content': '开始生成', 'tool_calls': [{'id': 'g', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '已入队'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '生成一张图'})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'done')
        prompt_id = state['jobs'][0]['prompt_id']
        self.queue = {'queue_running': [], 'queue_pending': [[7, prompt_id, {}, {}, []]]}
        state = await (await self.client.get(f'/launcher/agent/sessions/{identity}/outputs')).json()
        self.assertEqual(state['jobs'][0]['status'], 'queued')
        self.assertEqual(state['jobs'][0]['position'], 1)
        self.queue = {'queue_running': [[7, prompt_id, {}, {}, []]], 'queue_pending': []}
        state = await (await self.client.get(f'/launcher/agent/sessions/{identity}/outputs')).json()
        self.assertEqual(state['jobs'][0]['status'], 'running')
        self.assertEqual(state['jobs'][0]['position'], 0)
        self.history[prompt_id] = {'status': {'status_str': 'success'}, 'outputs': {'9': {'images': [{'filename': 'ComfyStudio_Agent_00001_.png', 'subfolder': '', 'type': 'output'}]}}}
        state = await (await self.client.get(f'/launcher/agent/sessions/{identity}/outputs')).json()
        self.assertEqual(state['jobs'][0]['status'], 'done')
        self.assertEqual(state['jobs'][0]['images'][0]['filename'], 'ComfyStudio_Agent_00001_.png')

    async def test_plain_chat_does_not_load_or_execute_tools(self):
        self.replies.append({'role': 'assistant', 'content': '可以让夕阳与城市形成冷暖对比。'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '帮我完善画面描述'})
        state = await self.wait_state((await created.json())['id'], 'done')
        self.assertEqual(len(self.payloads), 1)
        self.assertEqual([tool['function']['name'] for tool in self.payloads[0]['tools']], ['discover_tools'])
        self.assertEqual(self.payloads[0]['tool_choice'], 'auto')
        self.assertFalse(any(event['type'] == 'tool' for event in state['events']))
        self.assertEqual(self.generations, [])

    async def test_tools_expand_only_after_model_discovery(self):
        self.discover('local_models')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'l', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}}]})
        self.discover('generation_status')
        self.replies.append({'role': 'assistant', 'content': '已检查本地模型'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '检查本地模型'})
        state = await self.wait_state((await created.json())['id'], 'done')
        self.assertEqual([[tool['function']['name'] for tool in payload['tools']] for payload in self.payloads], [
            ['discover_tools'], ['discover_tools', 'local_models'], ['discover_tools', 'local_models'], ['discover_tools', 'local_models', 'generation_status'],
        ])
        self.assertEqual([event['text'] for event in state['events'] if event['type'] == 'tool'], ['discover_tools', 'local_models', 'discover_tools'])
        self.assertEqual(self.generations, [])

    async def test_unloaded_and_batched_tools_are_not_executed(self):
        generation = {'id': 'g', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': '{"model":"anima.safetensors","prompt":"A city.","width":768,"height":1024}'}}
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [generation]})
        self.discover('local_models', 'generate_image')
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{**generation, 'id': 'g2'}, {'id': 'l', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}}]},
            {'role': 'assistant', 'content': '需要分步处理。'},
        ])
        created = await self.client.post('/launcher/agent/sessions', json={'text': '检查后生成'})
        state = await self.wait_state((await created.json())['id'], 'done')
        self.assertEqual(self.generations, [])
        tools = [event for event in state['events'] if event['type'] == 'tool']
        self.assertEqual([event['status'] for event in tools], ['error', 'done', 'error', 'error'])
        self.assertIn('discover_tools', tools[0]['result']['message'])
        self.assertIn('此批次未执行', tools[2]['result']['message'])

    async def test_edit_user_forks_prefix_and_preserves_images_and_preferences(self):
        image = 'data:image/jpeg;base64,' + 'A' * 64
        self.replies.append({'role': 'assistant', 'content': '第一次回复'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '原来的想法', 'images': [image], 'system_prompt': '中文简短回答'})
        identity = (await created.json())['id']
        await self.wait_state(identity, 'done')
        self.replies.append({'role': 'assistant', 'content': '第二次回复'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '后续问题'})
        original = await self.wait_state(identity, 'done')
        self.replies.append({'role': 'assistant', 'content': '修改后的回复'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'edit', 'message_index': 1, 'text': '改为夜景'})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertNotEqual(branch['id'], identity)
        self.assertEqual(branch['parent_id'], identity)
        self.assertEqual([event['text'] for event in branch['events']], ['改为夜景', '修改后的回复'])
        self.assertEqual(await (await self.client.get(f'/launcher/agent/sessions/{identity}')).json(), original)
        self.assertEqual(self.payloads[-1]['messages'][1]['content'], [{'type': 'text', 'text': '改为夜景'}, {'type': 'image_url', 'image_url': {'url': image}}])
        self.assertIn('中文简短回答', self.payloads[-1]['messages'][0]['content'])
        saved = json.loads(Path(self.directory.name, 'comfy_studio_agent', branch['id'] + '.json').read_text(encoding='utf-8'))
        self.assertEqual(saved['parent_id'], identity)
        self.assertNotIn('sk-test-private', json.dumps(saved))

    async def test_message_retry_submits_new_job_and_recovery_keeps_it(self):
        self.discover('generate_image')
        self.replies.extend([
            {'role': 'assistant', 'content': '正在提交', 'tool_calls': [{'id': 'g', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': '{"model":"anima.safetensors","prompt":"A city.","width":768,"height":1024}'}}]},
            {'role': 'assistant', 'content': '作品已入队'},
        ])
        created = await self.client.post('/launcher/agent/sessions', json={'text': '生成夜景'})
        identity = (await created.json())['id']
        original = await self.wait_state(identity, 'done')
        self.discover('generate_image')
        self.call('generate_image', {'model': 'anima.safetensors', 'prompt': 'A city.', 'width': 768, 'height': 1024}, 'regenerate')
        self.replies.append({'role': 'assistant', 'content': '新作品已入队'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry', 'message_index': original['events'][-1]['message_index']})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 2)
        self.assertEqual(len(branch['jobs']), 1)
        self.assertNotEqual(branch['jobs'][0]['prompt_id'], original['jobs'][0]['prompt_id'])
        self.assertEqual(self.payloads[-3]['messages'][-1]['role'], 'user')
        self.assertFalse(any(message['role'] == 'tool' for message in self.payloads[-3]['messages']))
        self.assertNotIn('作品已入队', [event['text'] for event in branch['events']])
        self.assertEqual(await (await self.client.get(f'/launcher/agent/sessions/{identity}')).json(), original)
        await self.client.post(f'/launcher/agent/sessions/{identity}/stop')
        self.discover('generate_image')
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'duplicate', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': '{"model":"anima.safetensors","prompt":"A city.","width":768,"height":1024}'}}]},
            {'role': 'assistant', 'content': '继续使用已有的任务。'},
        ])
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry'})
        guarded = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 2)
        duplicate = next(event for event in guarded['events'] if event.get('id') == 'duplicate')
        self.assertEqual(duplicate['status'], 'error')
        self.assertIn('不要重新提交', duplicate['result']['message'])

    async def test_assistant_edit_and_branch_do_not_run_or_copy_future_messages(self):
        self.replies.append({'role': 'assistant', 'content': '原回复'})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '想法'})
        identity = (await created.json())['id']
        first = await self.wait_state(identity, 'done')
        index = first['events'][-1]['message_index']
        self.replies.append({'role': 'assistant', 'content': '后续回复'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '后续问题'})
        await self.wait_state(identity, 'done')
        calls = len(self.payloads)
        edited = await (await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'edit', 'message_index': index, 'text': '手动修订的回复'})).json()
        self.assertEqual(edited['status'], 'done')
        self.assertEqual([event['text'] for event in edited['events']], ['想法', '手动修订的回复'])
        branched = await (await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'message_index': index})).json()
        self.assertEqual([event['text'] for event in branched['events']], ['想法', '原回复'])
        self.assertEqual(len(self.payloads), calls)
        listed = await (await self.client.get('/launcher/agent/sessions')).json()
        self.assertEqual(sum(item['parent_id'] == identity for item in listed['sessions']), 2)

    async def test_failed_response_can_retry_in_branch_or_continue_same_session(self):
        self.replies.append(ValueError('模型暂不可用'))
        created = await self.client.post('/launcher/agent/sessions', json={'text': '你好'})
        identity = (await created.json())['id']
        await self.wait_state(identity, 'error')
        self.replies.append({'role': 'assistant', 'content': '重试成功'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry'})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(branch['events'][-1]['text'], '重试成功')
        self.replies.append({'role': 'assistant', 'content': '可以继续'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '继续'})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual([event['text'] for event in state['events'] if event['type'] == 'user'], ['你好', '继续'])

    async def test_legacy_session_branch_and_interrupted_tool_protocol(self):
        identity = 'a' * 32
        session = {'id': identity, 'status': 'cancelled', 'pending': None, 'events': [{'type': 'user', 'text': '检查模型'}, {'type': 'assistant', 'text': '检查中'}, {'type': 'tool', 'id': 'l', 'text': 'local_models', 'status': 'running'}], 'messages': [
            {'role': 'system', 'content': self.agent.POLICY}, {'role': 'user', 'content': '检查模型'},
            {'role': 'assistant', 'content': '检查中', 'tool_calls': [{'id': 'l', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}}]},
        ]}
        directory = Path(self.directory.name, 'comfy_studio_agent')
        directory.mkdir()
        (directory / (identity + '.json')).write_text(json.dumps(session), encoding='utf-8')
        original = await (await self.client.get(f'/launcher/agent/sessions/{identity}')).json()
        self.assertEqual(original['events'][1]['message_index'], 2)
        self.assertFalse(original['events'][1]['retryable'])
        self.replies.append({'role': 'assistant', 'content': '上次操作中断，可以重新检查。'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry'})
        branch = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(self.payloads[-1]['messages'][-1]['tool_call_id'], 'l')
        self.assertTrue(json.loads(self.payloads[-1]['messages'][-1]['content'])['interrupted'])
        self.assertEqual(branch['events'][2]['status'], 'error')
        self.assertEqual(original, await (await self.client.get(f'/launcher/agent/sessions/{identity}')).json())

    async def test_fork_validation_and_waiting_conflict(self):
        self.discover('request_editor')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'e', 'type': 'function', 'function': {'name': 'request_editor', 'arguments': '{"feature":"camera","instruction":"调整"}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '调整机位'})
        identity = (await created.json())['id']
        await self.wait_state(identity, 'waiting')
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'edit', 'message_index': 1, 'text': 'x'})
        self.assertEqual(response.status, 409)
        await self.client.post(f'/launcher/agent/sessions/{identity}/stop', json={})
        for body in ({'action': 'invalid', 'message_index': 1}, {'message_index': True}, {'message_index': 999}, {'action': 'edit', 'message_index': 1, 'text': ''}, {'action': 'retry', 'message_index': 1}):
            response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json=body)
            self.assertEqual(response.status, 400, body)
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'message_index': 1}, headers={'Origin': 'https://attacker.invalid'})
        self.assertEqual(response.status, 403)

    async def test_editor_generation_preserves_workflows_and_tracks_batch(self):
        self.discover('generate_from_editor')
        self.replies.append({'role': 'assistant', 'content': '沿用当前编辑器', 'tool_calls': [{'id': 'editor', 'type': 'function', 'function': {'name': 'generate_from_editor', 'arguments': '{"prompt":"A city at sunset."}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '用我的编辑器生成'})
        identity = (await created.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertTrue(state['pending']['auto_submit'])
        self.assertEqual(state['pending']['prompt'], 'A city at sunset.')
        items = [{'workflow': {'1': {'class_type': 'LoadImage', 'inputs': {'image': 'reference.png'}}}, 'settings': {'model': 'user-model.safetensors', 'seed': seed, 'img2img': {'enabled': True, 'image': 'reference.png', 'denoise': .45}, 'cameraControl': {'azimuth': 75}}} for seed in (41, 42)]
        self.replies.append({'role': 'assistant', 'content': '两张作品已入队'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'editor', 'result': {'workflows': items}})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual([item['prompt'] for item in self.generations], [item['workflow'] for item in items])
        self.assertEqual([job['settings'] for job in state['jobs']], [item['settings'] for item in items])
        self.assertEqual([job['tool_call_id'] for job in state['jobs']], ['editor', 'editor'])
        self.assertEqual([job['status'] for job in state['jobs']], ['queued', 'queued'])
        result = next(event['result'] for event in state['events'] if event.get('id') == 'editor')
        self.assertEqual(result['prompt_ids'], [job['prompt_id'] for job in state['jobs']])
        self.assertFalse(result['completed'])
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'editor', 'result': {'workflows': items}})
        self.assertEqual(response.status, 409)
        self.assertEqual(len(self.generations), 2)
        self.discover('generate_from_editor')
        self.call('generate_from_editor', {'prompt': 'A city at sunset.'}, 'retry_editor')
        fork = await self.client.post(f'/launcher/agent/sessions/{identity}/fork', json={'action': 'retry', 'message_index': state['events'][-1]['message_index']})
        branch = await self.wait_state((await fork.json())['id'], 'waiting')
        self.assertTrue(branch['pending']['auto_submit'])
        self.assertEqual(branch['pending']['id'], 'retry_editor')
        self.assertEqual(branch['jobs'], [])
        self.replies.append({'role': 'assistant', 'content': '已重新提交两张作品'})
        response = await self.client.post(f"/launcher/agent/sessions/{branch['id']}/submit", json={'id': 'retry_editor', 'result': {'workflows': items}})
        self.assertEqual(response.status, 200)
        regenerated = await self.wait_state(branch['id'], 'done')
        self.assertEqual(len(self.generations), 4)
        self.assertEqual([job['settings'] for job in regenerated['jobs']], [item['settings'] for item in items])
        self.assertTrue(set(job['prompt_id'] for job in state['jobs']).isdisjoint(job['prompt_id'] for job in regenerated['jobs']))
        repeated = await self.client.post(f"/launcher/agent/sessions/{branch['id']}/submit", json={'id': 'retry_editor', 'result': {'workflows': items}})
        self.assertEqual(repeated.status, 409)
        self.assertEqual(len(self.generations), 4)

    async def test_editor_review_can_submit_generation_or_cancel(self):
        self.discover('request_editor')
        self.replies.append({'role': 'assistant', 'content': '请检查设置', 'tool_calls': [{'id': 'review', 'type': 'function', 'function': {'name': 'request_editor', 'arguments': '{"feature":"generation","instruction":"检查后提交生成"}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '先让我调整一下再生成'})
        identity = (await created.json())['id']
        state = await self.wait_state(identity, 'waiting')
        self.assertNotIn('auto_submit', state['pending'])
        items = [{'workflow': {'1': {'class_type': 'EmptyLatentImage', 'inputs': {'width': 768, 'height': 1024, 'batch_size': 1}}}, 'settings': {'seed': 12}}]
        for invalid in ([], items * 17, [{'workflow': {}, 'settings': {}}], [{'workflow': {'1': {}}, 'settings': {}}], [{'workflow': items[0]['workflow']}], 'wrong'):
            response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'review', 'result': {'workflows': invalid}})
            self.assertEqual(response.status, 400)
        self.assertEqual(self.generations, [])
        self.replies.append({'role': 'assistant', 'content': '用户取消，本次不生成'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'review', 'result': {'cancelled': True}})
        await self.wait_state(identity, 'done')
        self.assertEqual(self.generations, [])

    async def test_editor_preparation_error_is_reported_to_model(self):
        self.discover('generate_from_editor')
        self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'editor', 'type': 'function', 'function': {'name': 'generate_from_editor', 'arguments': '{}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '用参考图生成'})
        identity = (await created.json())['id']
        await self.wait_state(identity, 'waiting')
        self.replies.append({'role': 'assistant', 'content': '请先上传参考图'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'editor', 'result': {'error': '编辑器生成准备失败', 'message': '请先上传图生图参考图'}})
        state = await self.wait_state(identity, 'done')
        self.assertEqual(self.generations, [])
        self.assertEqual(next(event for event in state['events'] if event.get('id') == 'editor')['status'], 'error')
        self.assertIn('请先上传图生图参考图', self.payloads[-1]['messages'][-1]['content'])

    async def test_model_limit_spans_automatic_editor_resumes(self):
        for index in range(6):
            self.discover('generate_from_editor')
            self.replies.append({'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'editor' + str(index), 'type': 'function', 'function': {'name': 'generate_from_editor', 'arguments': '{}'}}]})
        created = await self.client.post('/launcher/agent/sessions', json={'text': '按当前编辑器生成'})
        identity = (await created.json())['id']
        for index in range(6):
            await self.wait_state(identity, 'waiting')
            await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'editor' + str(index), 'result': {'error': '准备失败', 'message': '缺少输入'}})
        state = await self.wait_state(identity, 'error')
        self.assertIn('调用上限', state['error'])
        self.assertEqual(len(self.payloads), 12)
        self.assertEqual(self.generations, [])

    async def project_proposal(self):
        root = Path(self.directory.name)
        self.agent.studio_install.find_comfy_root = lambda: root
        target = root / 'settings.json'
        target.write_text('{"steps":1}\n', encoding='utf-8')
        self.discover('project_read', 'prepare_project_edit')
        self.call('project_read', {'path': 'settings.json'}, 'read_file')
        self.call('prepare_project_edit', {'reason': '调整配置', 'changes': [{'path': 'settings.json', 'old_text': '1', 'new_text': '2'}]}, 'edit_file')
        created = await self.client.post('/launcher/agent/sessions', json={'text': '检查并修复配置'})
        identity = (await created.json())['id']
        state = await self.wait_state(identity, 'waiting')
        return identity, state, target

    async def test_project_edit_uses_server_plan_and_requires_explicit_confirmation(self):
        identity, state, target = await self.project_proposal()
        self.assertEqual(target.read_text(), '{"steps":1}\n')
        self.assertEqual(state['pending']['feature'], 'project_edit')
        self.assertNotIn('plan', state['pending'])
        self.assertIn('-{"steps":1}', state['pending']['instruction'])
        for result in ({'approved': 1}, {'approved': True, 'plan': {'files': []}}, {}, {'changed': True}):
            response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': result})
            self.assertEqual(response.status, 400)
            self.assertEqual(target.read_text(), '{"steps":1}\n')
        self.replies.append({'role': 'assistant', 'content': '文件已写入，请重启后验证。'})
        response = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'approved': True}, 'plan': {'files': []}})
        self.assertEqual(response.status, 200)
        state = await self.wait_state(identity, 'done')
        self.assertEqual(target.read_text(), '{"steps":2}\n')
        event = next(event for event in state['events'] if event.get('id') == 'edit_file')
        self.assertTrue(event['result']['ok'])
        self.assertEqual(len(event['result']['record_id']), 32)
        repeated = await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'approved': True}})
        self.assertEqual(repeated.status, 409)

    async def test_project_cancellation_and_conflict_do_not_overwrite(self):
        identity, _, target = await self.project_proposal()
        self.replies.append({'role': 'assistant', 'content': '已取消，没有修改文件。'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'cancelled': True}})
        state = await self.wait_state(identity, 'done')
        self.assertEqual(target.read_text(), '{"steps":1}\n')
        self.assertTrue(next(event for event in state['events'] if event.get('id') == 'edit_file')['result']['cancelled'])
        identity, _, target = await self.project_proposal()
        target.write_text('{"steps":3}\n', encoding='utf-8')
        self.replies.append({'role': 'assistant', 'content': '检测到手动修改，需重新读取。'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'approved': True}})
        state = await self.wait_state(identity, 'done')
        self.assertEqual(target.read_text(), '{"steps":3}\n')
        event = next(event for event in state['events'] if event.get('id') == 'edit_file')
        self.assertEqual(event['status'], 'error')
        self.assertIn('已改变', event['result']['message'])

    async def test_project_undo_waits_then_restores(self):
        identity, _, target = await self.project_proposal()
        self.replies.append({'role': 'assistant', 'content': '已修改'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'approved': True}})
        state = await self.wait_state(identity, 'done')
        record_id = next(event for event in state['events'] if event.get('id') == 'edit_file')['result']['record_id']
        self.discover('prepare_project_undo')
        self.call('prepare_project_undo', {'record_id': record_id}, 'undo_file')
        await self.client.post(f'/launcher/agent/sessions/{identity}/messages', json={'text': '撤销刚才的修改'})
        state = await self.wait_state(identity, 'waiting')
        self.assertEqual(state['pending']['action'], 'undo')
        self.assertEqual(target.read_text(), '{"steps":2}\n')
        self.replies.append({'role': 'assistant', 'content': '已撤销'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'undo_file', 'result': {'approved': True}})
        await self.wait_state(identity, 'done')
        self.assertEqual(target.read_text(), '{"steps":1}\n')

    async def test_project_tools_cannot_expand_scope_or_read_secrets(self):
        root = Path(self.directory.name)
        self.agent.studio_install.find_comfy_root = lambda: root
        (root / 'ai_key.txt').write_text('SECRET_NEVER_SEND', encoding='utf-8')
        self.discover('project_read')
        self.call('project_read', {'path': '../secret.py'}, 'outside')
        self.call('project_read', {'path': 'ai_key.txt'}, 'secret')
        self.call('project_read', {'path': 'settings.json', 'root': 'D:/'}, 'expanded')
        self.replies.append({'role': 'assistant', 'content': '这些路径不允许访问'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '检查目录'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertTrue(all(event['status'] == 'error' for event in state['events'] if event.get('id') in ('outside', 'secret', 'expanded')))
        self.assertNotIn('SECRET_NEVER_SEND', json.dumps(self.payloads))

    async def test_project_pending_survives_backend_restart(self):
        identity, _, target = await self.project_proposal()
        await self.client.close()
        routes = web.RouteTableDef()
        self.agent.install_agent(routes, lambda: self.config, lambda: 'sk-test-private-123')
        app = web.Application()
        app.add_routes(routes)
        self.client = TestClient(TestServer(app))
        await self.client.start_server()
        state = await self.wait_state(identity, 'waiting')
        self.assertNotIn('plan', state['pending'])
        self.replies.append({'role': 'assistant', 'content': '已确认并写入'})
        await self.client.post(f'/launcher/agent/sessions/{identity}/submit', json={'id': 'edit_file', 'result': {'approved': True}})
        await self.wait_state(identity, 'done')
        self.assertEqual(target.read_text(), '{"steps":2}\n')

if __name__ == '__main__':
    unittest.main()

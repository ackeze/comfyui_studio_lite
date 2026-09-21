import asyncio
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer


class AgentTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        folders = types.SimpleNamespace(get_user_directory=lambda: self.directory.name, get_folder_paths=lambda category: [self.directory.name], get_filename_list=lambda category: ['test.safetensors'])
        spec = importlib.util.spec_from_file_location('studio_agent_test', Path(__file__).parents[1] / 'agent.py')
        self.agent = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'folder_paths': folders}):
            spec.loader.exec_module(self.agent)
        self.replies = []
        self.payloads = []
        self.generations = []
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
                return {'choices': [{'message': owner.replies.pop(0)}]}

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
                if url == 'http://127.0.0.1:8188/prompt':
                    owner.generations.append(kwargs['json'])
                    return Submitted()
                owner.payloads.append(kwargs['json'])
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
        self.agent.install_agent(routes, lambda: {'api_base': 'https://example.invalid', 'model': 'test'}, lambda: 'sk-test-private-123', lambda arguments: ({'test': {}}, arguments))
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

    async def test_editor_resume_conversation_and_persistence(self):
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

    async def test_validation_and_cancel(self):
        response = await self.client.post('/launcher/agent/sessions', json={'text': ''})
        self.assertEqual(response.status, 400)
        response = await self.client.post('/launcher/agent/sessions', json={'text': 'x'}, headers={'Origin': 'https://attacker.invalid'})
        self.assertEqual(response.status, 403)
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
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'reasoning_content': 'private-provider-state', 'tool_calls': [
                {'id': 'local', 'type': 'function', 'function': {'name': 'local_models', 'arguments': '{}'}},
                {'id': 'remote', 'type': 'function', 'function': {'name': 'search_models', 'arguments': '{"query":"anima"}'}},
            ]},
            {'role': 'assistant', 'content': '远程搜索失败，可以使用本地模型。'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '检查模型'})
        identity = (await response.json())['id']
        state = await self.wait_state(identity, 'done')
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['done', 'error'])
        self.assertNotIn('private-provider-state', json.dumps(state))
        self.assertEqual(self.payloads[1]['messages'][2]['reasoning_content'], 'private-provider-state')
        listing = await (await self.client.get('/launcher/agent/sessions')).json()
        self.assertEqual(listing['sessions'][0]['id'], identity)

    async def test_stream_assembles_text_and_tool_arguments(self):
        owner = self
        chunks = [
            {'reasoning_content': 'provider-state'},
            {'content': '正在检查'},
            {'tool_calls': [{'index': 0, 'id': 's1', 'function': {'name': 'local_models', 'arguments': '{'}}]},
            {'tool_calls': [{'index': 0, 'function': {'arguments': '}'}}]},
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
        self.replies.append({'role': 'assistant', 'content': '完成'})
        response = await self.client.post('/launcher/agent/sessions', json={'text': '流式检查'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual([e['text'] for e in state['events'] if e['type'] == 'assistant'], ['正在检查', '完成'])
        self.assertEqual(self.payloads[1]['messages'][2]['tool_calls'][0]['function']['arguments'], '{}')

    async def test_generation_is_submitted_without_editor(self):
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
        arguments = {'model': 'anima.safetensors', 'prompt': 'A white-haired adult woman.', 'width': 768, 'height': 1024, 'steps': 40, 'cfg': 5.5, 'sampler': 'dpmpp_2m_sde', 'scheduler': 'karras', 'batch_size': 3, 'loras': [{'name': 'lora.safetensors', 'model_strength': 0.8}], 'camera': {'enabled': True, 'azimuth': 225, 'distance': 2}}
        self.replies.extend([
            {'role': 'assistant', 'content': '开始生成', 'tool_calls': [{'id': 'g2', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '已入队'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '用 LoRA 加机位生成'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(len(self.generations), 1)
        self.assertEqual(state['jobs'][0]['settings'], arguments)
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['done'])

    async def test_generation_rejects_wrong_parameter_types(self):
        arguments = {'model': 'anima.safetensors', 'prompt': 'x', 'width': 768, 'height': 1024, 'loras': [{'name': 'lora.safetensors', 'model_strength': 'high'}]}
        self.replies.extend([
            {'role': 'assistant', 'content': '', 'tool_calls': [{'id': 'bad', 'type': 'function', 'function': {'name': 'generate_image', 'arguments': json.dumps(arguments)}}]},
            {'role': 'assistant', 'content': '参数无效'},
        ])
        response = await self.client.post('/launcher/agent/sessions', json={'text': '错误参数'})
        state = await self.wait_state((await response.json())['id'], 'done')
        self.assertEqual(self.generations, [])
        self.assertEqual([event['status'] for event in state['events'] if event['type'] == 'tool'], ['error'])


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


if __name__ == '__main__':
    unittest.main()

import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestServer

spec = importlib.util.spec_from_file_location("interrogate_test_target", Path(__file__).parents[1] / "interrogate.py")
module = importlib.util.module_from_spec(spec)
stub = SimpleNamespace(PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=web.RouteTableDef())))
with patch.dict(sys.modules, {"server": stub}):
    spec.loader.exec_module(module)


class InterrogateTest(unittest.IsolatedAsyncioTestCase):
    async def test_empty_and_truncated_responses(self):
        result = {}

        async def caption(request):
            return web.json_response(result)

        app = web.Application()
        app.router.add_post("/chat/completions", caption)
        async with TestServer(app) as upstream:
            async def body():
                return {"action": "caption", "api_base": str(upstream.make_url("")).rstrip("/"), "model": "vision", "image": "data:image/jpeg;base64,/9j/2Q=="}

            for reason, expected in [("length", "长度上限"), ("stop", "未返回最终答案"), ("content_filter", "过滤")]:
                result["choices"] = [{"finish_reason": reason, "message": {"content": "", "reasoning_content": "not a final prompt"}}]
                response = await module.interrogate(SimpleNamespace(headers={}, host="localhost", json=body))
                self.assertEqual(response.status, 502)
                self.assertIn(expected, json.loads(response.text)["error"])
                self.assertNotIn("prompt", json.loads(response.text))

    async def test_models_and_caption(self):
        received = []

        async def models(request):
            self.assertEqual(request.headers["Authorization"], "Bearer test-key")
            return web.json_response({"data": [{"id": "vision"}, {"id": "vision"}, {"id": "text"}]})

        async def caption(request):
            received.append(await request.json())
            return web.json_response({"choices": [{"message": {"content": "masterpiece, 1girl"}}]})

        app = web.Application()
        app.router.add_get("/v1/models", models)
        app.router.add_post("/v1/chat/completions", caption)
        async with TestServer(app) as upstream:
            async def call(action):
                async def body():
                    return {"action": action, "api_base": str(upstream.make_url("/v1")), "api_key": "test-key", "model": "vision", "image": "data:image/jpeg;base64,/9j/2Q=="}
                response = await module.interrogate(SimpleNamespace(headers={}, host="localhost", json=body))
                self.assertEqual(response.status, 200)
                return json.loads(response.text)

            self.assertEqual((await call("models"))["models"], ["text", "vision"])
            self.assertEqual((await call("caption"))["prompt"], "masterpiece, 1girl")
            self.assertIn("Anima Base v1.0", received[0]["messages"][0]["content"])
            system_prompt = received[0]["messages"][0]["content"]
            self.assertIn("quality prefix on its own line: masterpiece, best quality, score_7", system_prompt)
            self.assertIn("exclusively in fluent English natural-language sentences", system_prompt)
            self.assertIn("Do not use booru tags", system_prompt)
            self.assertIn("Do not clothe, blur, euphemize, or omit adult sexual content", system_prompt)
            self.assertIn("Do not add nsfw, sfw, safe, censored, or rating tags", system_prompt)
            self.assertIn("mature woman (成女), young woman (少女), petite loli-type adult (萝莉)", system_prompt)
            self.assertIn("breast size and shape", system_prompt)
            self.assertIn("All characters are adults", system_prompt)
            self.assertNotIn("Then give accurate subject-count tags", system_prompt)
            self.assertIn("adult body type (成女 / 少女 / 萝莉), figure such as breasts", received[0]["messages"][1]["content"][0]["text"])
            self.assertEqual(received[0]["model"], "vision")
            self.assertEqual(received[0]["messages"][1]["content"][1]["type"], "image_url")


if __name__ == "__main__":
    unittest.main()

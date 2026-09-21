import ast
import asyncio
import importlib.util
import json
import re
import socket
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from aiohttp import web

ROOT = Path(__file__).parents[1]
spec = importlib.util.spec_from_file_location("discovery", ROOT / "discovery.py")
discovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(discovery)


class DiscoveryTest(unittest.IsolatedAsyncioTestCase):
    async def test_handshake(self):
        tree = ast.parse((ROOT / "__init__.py").read_text(encoding="utf-8-sig"))
        function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "get_launcher_discover")
        function.decorator_list = []
        scope = {"web": web, "re": re, "socket": socket, "args": SimpleNamespace(port=9199), "_lan_ips": lambda: ["192.168.1.2"]}
        exec(compile(ast.Module(body=[function], type_ignores=[]), "<handshake>", "exec"), scope)
        result = await scope["get_launcher_discover"](SimpleNamespace(query={"challenge": "a" * 32}))
        data = json.loads(result.text)
        self.assertEqual((data["app"], data["protocol"], data["port"], data["challenge"]), ("comfy-studio", 1, 9199, "a" * 32))
        result = await scope["get_launcher_discover"](SimpleNamespace(query={"challenge": "<invalid>"}))
        self.assertEqual(result.status, 400)

    async def test_advertise_and_cleanup(self):
        server = SimpleNamespace(app=web.Application())
        args = SimpleNamespace(listen="0.0.0.0", port=9199, tls_certfile=None)
        discovery.install_discovery(server, args, lambda: ["192.168.1.2"])
        instance = SimpleNamespace(async_register_service=AsyncMock(), async_unregister_service=AsyncMock(), async_close=AsyncMock())
        with patch.object(discovery, "AsyncZeroconf", return_value=instance):
            lifecycle = server.app.cleanup_ctx[0](server.app)
            await anext(lifecycle)
            service = instance.async_register_service.call_args.args[0]
            self.assertEqual(service.port, 9199)
            self.assertEqual(service.properties[b"protocol"], b"1")
            await lifecycle.aclose()
            instance.async_unregister_service.assert_awaited_once()
            instance.async_close.assert_awaited_once()

    async def test_loopback_not_advertised(self):
        server = SimpleNamespace(app=web.Application())
        discovery.install_discovery(server, SimpleNamespace(listen="127.0.0.1", port=8188, tls_certfile=None), lambda: [])
        with patch.object(discovery, "AsyncZeroconf") as constructor:
            lifecycle = server.app.cleanup_ctx[0](server.app)
            await anext(lifecycle)
            await lifecycle.aclose()
            constructor.assert_not_called()


if __name__ == "__main__":
    unittest.main()

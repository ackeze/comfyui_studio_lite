import asyncio
import json
import logging
import os
from pathlib import Path

import aiohttp
import yaml
from aiohttp import web

from server import PromptServer


LAUNCHER_ROOT = Path(__file__).resolve().parents[2] / "web" / "launcher"

# Machine-local AI settings, stored as YAML next to the ComfyUI installation
# (created automatically on first load). The file is gitignored; empty fields
# fall back to the DEEPSEEK_* environment variables.
AI_CONFIG_FILE = Path(__file__).resolve().parents[2] / "comfy_studio.yaml"

# Legacy single-key file, still honored as a lower-priority fallback.
AI_KEY_FILE = Path(__file__).resolve().parent / "ai_key.txt"

DEFAULT_AI_CONFIG = {
    "api_key": "",
    "model": "deepseek-v4-pro",
    "api_base": "https://api.deepseek.com",
}


def load_ai_config():
    config = dict(DEFAULT_AI_CONFIG)
    if AI_CONFIG_FILE.is_file():
        try:
            data = yaml.safe_load(AI_CONFIG_FILE.read_text(encoding="utf-8", errors="ignore"))
        except yaml.YAMLError:
            data = None
        if isinstance(data, dict):
            for key in DEFAULT_AI_CONFIG:
                value = data.get(key)
                if isinstance(value, str):
                    config[key] = value.strip()
    return config


def save_ai_config(config):
    body = yaml.safe_dump(
        {key: value for key, value in config.items() if value},
        allow_unicode=True,
        sort_keys=False,
    )
    temp_path = AI_CONFIG_FILE.with_suffix(".yaml.tmp")
    temp_path.write_text(body, encoding="utf-8")
    temp_path.replace(AI_CONFIG_FILE)


if not AI_CONFIG_FILE.is_file():
    try:
        save_ai_config(DEFAULT_AI_CONFIG)
    except OSError:
        pass


def server_api_key():
    api_key = load_ai_config()["api_key"]
    if not api_key:
        api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key and AI_KEY_FILE.is_file():
        api_key = AI_KEY_FILE.read_text(encoding="utf-8", errors="ignore").strip()
    return api_key


@PromptServer.instance.routes.get("/launcher")
async def get_launcher(request):
    response = web.FileResponse(LAUNCHER_ROOT / "index.html")
    response.headers["Cache-Control"] = "no-store, must-revalidate"
    response.headers["Expires"] = "0"
    return response


@PromptServer.instance.routes.get("/launcher/assets/{path:.*}")
async def get_launcher_asset(request):
    asset_root = (LAUNCHER_ROOT / "assets").resolve()
    asset_path = (asset_root / request.match_info.get("path", "")).resolve()
    if not asset_path.is_relative_to(asset_root):
        return web.Response(status=403)
    if not asset_path.is_file():
        return web.Response(status=404)
    return web.FileResponse(asset_path)


@PromptServer.instance.routes.get("/launcher/presets")
async def get_presets(request):
    preset_path = LAUNCHER_ROOT / "presets.json"
    if preset_path.exists():
        return web.FileResponse(preset_path)
    return web.json_response({})


@PromptServer.instance.routes.post("/launcher/presets")
async def save_presets(request):
    if request.content_length and request.content_length > 2 * 1024 * 1024:
        return web.json_response({"error": "Preset payload is too large"}, status=413)

    try:
        presets = await request.json()
        if not isinstance(presets, dict):
            raise ValueError("Preset data must be a JSON object")
        body = json.dumps(presets, ensure_ascii=False, indent=2).encode("utf-8")
        preset_path = LAUNCHER_ROOT / "presets.json"
        temp_path = preset_path.with_suffix(".json.tmp")
        temp_path.write_bytes(body)
        temp_path.replace(preset_path)
        return web.json_response({"ok": True, "count": len(presets)})
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.get("/launcher/ai/config")
async def get_launcher_ai_config(request):
    config = load_ai_config()
    return web.json_response(
        {
            "configured": bool(server_api_key()),
            "model": config["model"],
            "api_base": config["api_base"],
        }
    )


@PromptServer.instance.routes.post("/launcher/ai/settings")
async def save_launcher_ai_settings(request):
    try:
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError("Settings must be a JSON object")
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)

    config = load_ai_config()
    if isinstance(body.get("api_key"), str):
        api_key = body["api_key"].strip()
        if len(api_key) > 512:
            return web.json_response({"error": "API Key is too long"}, status=400)
        config["api_key"] = api_key
    if isinstance(body.get("model"), str):
        model = body["model"].strip()
        if len(model) > 128:
            return web.json_response({"error": "Model name is too long"}, status=400)
        config["model"] = model
    if isinstance(body.get("api_base"), str):
        api_base = body["api_base"].strip().rstrip("/")
        if api_base and not api_base.startswith(("http://", "https://")):
            return web.json_response({"error": "API base must be an http(s) URL"}, status=400)
        if len(api_base) > 512:
            return web.json_response({"error": "API base is too long"}, status=400)
        config["api_base"] = api_base

    try:
        save_ai_config(config)
    except OSError as error:
        return web.json_response({"error": f"Failed to write config: {error}"}, status=500)
    config = load_ai_config()
    return web.json_response(
        {
            "ok": True,
            "model": config["model"],
            "api_base": config["api_base"],
            "api_key_set": bool(server_api_key()),
        }
    )


@PromptServer.instance.routes.post("/launcher/ai/chat")
async def launcher_ai_chat(request):
    try:
        body = await request.json()
        # The key and model come from the machine-local config.yaml (or the
        # DEEPSEEK_* environment variables as a fallback), so the key never
        # has to travel to any client.
        api_key = server_api_key()
        if not api_key:
            return web.json_response({"error": "DeepSeek API Key is not configured"}, status=503)

        messages = body.get("messages", [])
        if not isinstance(messages, list) or not messages:
            return web.json_response({"error": "messages must be a non-empty list"}, status=400)
        messages = messages[-24:]
        system_prompt = str(body.get("system_prompt", "")).strip()
        if system_prompt:
            messages = [{"role": "system", "content": system_prompt}] + messages

        config = load_ai_config()
        payload = {
            "model": config["model"],
            "messages": messages,
            "stream": True,
        }
        api_base = config["api_base"].rstrip("/")
        timeout = aiohttp.ClientTimeout(total=180, connect=20, sock_read=120)
        session = aiohttp.ClientSession(timeout=timeout)
        try:
            upstream = await session.post(
                f"{api_base}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            if upstream.status >= 400:
                error_text = (await upstream.text())[:500]
                upstream.release()
                await session.close()
                return web.json_response({"error": f"AI provider returned {upstream.status}: {error_text}"}, status=502)

            response = web.StreamResponse(
                status=200,
                headers={
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache",
                    "X-Accel-Buffering": "no",
                },
            )
            await response.prepare(request)
            async for chunk in upstream.content.iter_any():
                await response.write(chunk)
            await response.write_eof()
            return response
        finally:
            if not session.closed:
                await session.close()
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
        logging.warning("[Launcher AI] request failed: %s", error)
        return web.json_response({"error": "AI provider is unavailable"}, status=502)


@PromptServer.instance.routes.get("/ai-chat")
async def get_ai_chat(request):
    raise web.HTTPFound("/launcher#ai")


NODE_CLASS_MAPPINGS = {}


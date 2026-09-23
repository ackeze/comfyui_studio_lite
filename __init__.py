import asyncio
import json
import logging
import os
import re
import socket
import uuid
from pathlib import Path

import aiohttp
import folder_paths
import yaml
from aiohttp import web

from comfy.cli_args import args
from server import PromptServer

from .anima_pose_control import NODE_CLASS_MAPPINGS as POSE_NODE_CLASS_MAPPINGS
from .anima_pose_control import NODE_DISPLAY_NAME_MAPPINGS as POSE_NODE_DISPLAY_NAME_MAPPINGS
from .scene_nodes import NODE_CLASS_MAPPINGS as SCENE_NODE_CLASS_MAPPINGS
from .scene_nodes import NODE_DISPLAY_NAME_MAPPINGS as SCENE_NODE_DISPLAY_NAME_MAPPINGS
from .sam_cutout import create_sam_cutout, normalize_cutout_bbox
from . import interrogate
from .agent import install_agent
from .agent_generation import build_generation


NODE_CLASS_MAPPINGS = {**SCENE_NODE_CLASS_MAPPINGS, **POSE_NODE_CLASS_MAPPINGS}
NODE_DISPLAY_NAME_MAPPINGS = {**SCENE_NODE_DISPLAY_NAME_MAPPINGS, **POSE_NODE_DISPLAY_NAME_MAPPINGS}


def launcher_root():
    bundled = Path(__file__).resolve().parent / "web"
    if (bundled / "index.html").is_file():
        return bundled
    return Path(__file__).resolve().parents[2] / "web" / "launcher"


LAUNCHER_ROOT = launcher_root()

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

SAM_CUTOUT_LOCK = asyncio.Lock()


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


def _usable_lan_ip(ip):
    if not ip or ":" in ip or ip.startswith("127.") or ip.startswith("169.254."):
        return False
    try:
        parts = [int(item) for item in ip.split(".")]
    except ValueError:
        return False
    if len(parts) != 4 or any(item < 0 or item > 255 for item in parts):
        return False
    return parts[0] == 10 or (parts[0] == 192 and parts[1] == 168) or (parts[0] == 172 and 16 <= parts[1] <= 31)


def _lan_ips():
    ips = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if _usable_lan_ip(ip):
                ips.add(ip)
    except OSError:
        pass
    for target in ("192.168.1.1", "192.168.0.1", "192.168.31.1", "10.0.0.1", "172.16.0.1", "192.0.2.1"):
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            probe.connect((target, 80))
            ip = probe.getsockname()[0]
            if _usable_lan_ip(ip):
                ips.add(ip)
        except OSError:
            pass
        finally:
            probe.close()
    return sorted(ips)


@PromptServer.instance.routes.get("/launcher/discover")
async def get_launcher_discover(request):
    """Handshake endpoint used by the mobile app's LAN scanner to confirm a
    host runs Comfy Studio and to learn its address before auto-connecting."""
    challenge = request.query.get("challenge", "")
    if challenge and not re.fullmatch(r"[a-f0-9]{32}", challenge):
        return web.json_response({"error": "Invalid discovery challenge"}, status=400)
    return web.json_response(
        {
            "app": "comfy-studio",
            "protocol": 1,
            "challenge": challenge,
            "name": socket.gethostname(),
            "port": args.port,
            "addresses": _lan_ips(),
        }
    )


try:
    from .discovery import install_discovery
except ModuleNotFoundError as error:
    if error.name != "zeroconf":
        raise
    logging.warning("Install aki_launcher/requirements.txt to enable LAN discovery.")
else:
    install_discovery(PromptServer.instance, args, _lan_ips)


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
    response = web.FileResponse(asset_path)
    response.headers["Cache-Control"] = "no-store, must-revalidate"
    response.headers["Expires"] = "0"
    return response


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


@PromptServer.instance.routes.post("/launcher/scene/cutout")
async def create_launcher_scene_cutout(request):
    if request.content_length and request.content_length > 1024 * 1024:
        return web.json_response({"error": "Cutout request is too large"}, status=413)
    try:
        body = await request.json()
        image = body.get("image")
        if not isinstance(image, dict) or image.get("type", "input") != "input":
            raise ValueError("Cutout source must be a ComfyUI input image")
        filename = str(image.get("filename", "")).strip()
        subfolder = str(image.get("subfolder", "")).strip()
        if not filename or Path(filename).name != filename:
            raise ValueError("Invalid source filename")
        bbox = normalize_cutout_bbox(body.get("bbox"))
        feather = min(16.0, max(0.0, float(body.get("feather", 2.0))))

        input_root = Path(folder_paths.get_input_directory()).resolve()
        source_path = (input_root / subfolder / filename).resolve()
        if not source_path.is_relative_to(input_root):
            raise ValueError("Invalid source path")
        if not source_path.is_file():
            return web.json_response({"error": "Source image was not found"}, status=404)

        checkpoint = Path(folder_paths.models_dir) / "sams" / "sam_vit_b_01ec64.pth"
        output_subfolder = Path("comfy_studio_scenes") / "cutouts"
        output_folder = input_root / output_subfolder
        stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(filename).stem)[:64] or "scene-object"
        output_name = f"{stem}-cutout-{uuid.uuid4().hex[:8]}.png"
        output_path = output_folder / output_name
        async with SAM_CUTOUT_LOCK:
            result = await asyncio.to_thread(create_sam_cutout, source_path, checkpoint, bbox, feather, output_path)
        return web.json_response(
            {
                "filename": output_name,
                "subfolder": output_subfolder.as_posix(),
                "type": "input",
                **result,
            }
        )
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except FileNotFoundError as error:
        return web.json_response({"error": str(error)}, status=503)
    except RuntimeError as error:
        logging.warning("[Scene Cutout] SAM failed: %s", error)
        return web.json_response({"error": str(error)}, status=500)


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


install_agent(PromptServer.instance.routes, load_ai_config, server_api_key, build_generation, args.port)


@PromptServer.instance.routes.get("/ai-chat")
async def get_ai_chat(request):
    raise web.HTTPFound("/launcher#ai")

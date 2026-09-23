import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


PLUGIN_DIR = Path(__file__).resolve().parent
RESOURCES_FILE = PLUGIN_DIR / 'resources.json'
REPO = os.environ.get('COMFY_STUDIO_REPO', 'https://github.com/ackeze/comfyui_studio_lite.git')
CHUNK = 1024 * 1024


def is_comfy(path):
    return (path / 'main.py').is_file() and (path / 'folder_paths.py').is_file()


def find_comfy_root():
    env = os.environ.get('COMFYUI_PATH')
    if env:
        path = Path(env).expanduser().resolve()
        if is_comfy(path):
            return path
    for path in (PLUGIN_DIR, *PLUGIN_DIR.parents, Path.cwd(), Path.cwd().parent):
        if is_comfy(path):
            return path
    raise FileNotFoundError('未找到 ComfyUI 根目录。请把本插件放到 custom_nodes 下，或设置 COMFYUI_PATH。')


def find_python(comfy):
    for relative in ('python/python.exe', 'python_embeded/python.exe', 'venv/Scripts/python.exe', '.venv/Scripts/python.exe', 'venv/bin/python', '.venv/bin/python'):
        path = comfy / relative
        if path.is_file():
            return path
    return Path(sys.executable)


def load_resources():
    return json.loads(RESOURCES_FILE.read_text(encoding='utf-8'))['resources']


def selected(resources, mode):
    if mode == 'all':
        return resources
    if mode == 'required':
        return [item for item in resources if item['group'] == 'required']
    return [item for item in resources if item['group'] in ('required', 'recommended')]


def iter_model_files(comfy, folders):
    models = comfy / 'models'
    for folder in folders:
        directory = models / folder
        if not directory.is_dir():
            continue
        for path in directory.rglob('*'):
            if path.is_file():
                yield path


def existing_path(comfy, resource):
    name = resource['name'].lower()
    kind = resource.get('match', 'name')
    prefix = resource.get('prefix', '').lower()
    contains = resource.get('contains', '').lower()
    for path in iter_model_files(comfy, resource.get('search', [resource['folder']])):
        filename = path.name.lower()
        if kind == 'name' and filename == name:
            return path
        if kind == 'prefix' and filename.startswith(prefix):
            return path
        if kind == 'contains' and contains in filename and filename.endswith('.safetensors'):
            return path
    return None


def mirror_urls(url):
    urls = [url]
    if 'huggingface.co' not in url:
        return urls
    path = url.split('huggingface.co', 1)[1]
    for base in (os.environ.get('HF_ENDPOINT', '').rstrip('/'), 'https://huggingface.co', 'https://hf-mirror.com', 'https://alpha.hf-mirror.com'):
        if not base:
            continue
        candidate = base + path
        if candidate not in urls:
            urls.append(candidate)
    return urls


def open_download(url, headers, timeout=60):
    current = url
    for _ in range(8):
        request = urllib.request.Request(current, headers=headers)
        try:
            return urllib.request.urlopen(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            location = error.headers.get('Location') if error.code in (301, 302, 303, 307, 308) else None
            error.close()
            if not location:
                raise
            current = urllib.parse.urljoin(current, location)
    raise OSError('下载重定向次数过多')


def format_bytes(value):
    if value >= 1024 ** 3:
        return '%.2f GiB' % (value / 1024 ** 3)
    if value >= 1024 ** 2:
        return '%.1f MiB' % (value / 1024 ** 2)
    return '%s B' % value


def download(url, destination, expected):
    destination.parent.mkdir(parents=True, exist_ok=True)
    part = destination.with_name(destination.name + '.part')
    offset = part.stat().st_size if part.is_file() else 0
    last_error = None
    for candidate in mirror_urls(url):
        try:
            headers = {'User-Agent': 'ComfyStudioLite-installer'}
            if offset:
                headers['Range'] = 'bytes=%s-' % offset
            with open_download(candidate, headers) as response, open(part, 'ab' if offset else 'wb') as handle:
                total = expected or int(response.headers.get('Content-Length') or 0) + offset
                done = offset
                while True:
                    chunk = response.read(CHUNK)
                    if not chunk:
                        break
                    handle.write(chunk)
                    done += len(chunk)
                    if total:
                        print('\r  %s / %s' % (format_bytes(done), format_bytes(total)), end='', flush=True)
            print()
            if expected and part.stat().st_size != expected:
                raise OSError('下载大小不符：期望 %s，实际 %s' % (expected, part.stat().st_size))
            part.replace(destination)
            return
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
            print('\n  源失败 %s：%s' % (candidate, error))
            offset = part.stat().st_size if part.is_file() else 0
    raise OSError('下载失败：%s' % last_error)


def python_dep_missing():
    try:
        import zeroconf
        return False
    except ImportError:
        return True


def resource_report(comfy, mode='recommended'):
    items = []
    for resource in selected(load_resources(), mode):
        found = existing_path(comfy, resource)
        items.append({
            'id': resource['id'],
            'title': resource['title'],
            'group': resource['group'],
            'folder': resource['folder'],
            'name': resource['name'],
            'size': resource.get('size') or 0,
            'present': found is not None,
            'path': None if found is None else str(found.relative_to(comfy)),
        })
    return items


def catalog():
    return {item['id']: item for item in load_resources()}


def install_python_deps(python):
    requirement = PLUGIN_DIR / 'requirements.txt'
    print('安装 Python 依赖：%s' % requirement)
    subprocess.check_call([str(python), '-s', '-m', 'pip', 'install', '-r', str(requirement)])


def is_plugin(path):
    return path.is_dir() and (path / '__init__.py').is_file() and (path / 'web' / 'index.html').is_file()


def ensure_plugin(comfy):
    custom = comfy / 'custom_nodes'
    if is_plugin(PLUGIN_DIR):
        return PLUGIN_DIR
    if custom.is_dir():
        for path in sorted(custom.iterdir()):
            if is_plugin(path):
                return path
    target = custom / 'comfyui_studio_lite'
    if is_plugin(target):
        return target
    print('本地没有完整插件，正在从 Git 拉取：%s' % REPO)
    custom.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise SystemExit('目录已存在但不是完整插件：%s' % target)
    subprocess.check_call(['git', 'clone', '--depth', '1', REPO, str(target)])
    nested = target / 'custom_nodes' / 'aki_launcher'
    if is_plugin(target):
        return target
    if is_plugin(nested):
        return nested
    raise SystemExit('仓库根目录没有 web/index.html，不是标准插件仓库')


def parse_args():
    parser = argparse.ArgumentParser(description='安装 Comfy Studio Lite 并补齐缺失模型')
    parser.add_argument('--required', action='store_true', help='只下载生图必需的 Anima UNET / CLIP / VAE')
    parser.add_argument('--all', action='store_true', help='下载清单中的全部资源')
    parser.add_argument('--skip-pip', action='store_true', help='跳过 pip 安装')
    parser.add_argument('--dry-run', action='store_true', help='只检查缺失项，不下载')
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        comfy = find_comfy_root()
    except FileNotFoundError as error:
        raise SystemExit(str(error))
    python = find_python(comfy)
    plugin = ensure_plugin(comfy)
    print('ComfyUI：%s' % comfy)
    print('Python：%s' % python)
    print('插件：%s' % plugin)
    if not args.skip_pip:
        install_python_deps(python)
    mode = 'all' if args.all else 'required' if args.required else 'recommended'
    missing = []
    for resource in selected(load_resources(), mode):
        found = existing_path(comfy, resource)
        if found:
            print('已有 %s → %s' % (resource['title'], found.relative_to(comfy)))
        else:
            missing.append(resource)
            print('缺少 %s（%s）' % (resource['title'], format_bytes(resource.get('size') or 0)))
    if not missing:
        print('资源已齐，打开 http://127.0.0.1:8188/launcher')
        return
    if args.dry_run:
        print('缺失 %s 个文件。去掉 --dry-run 后会自动下载。' % len(missing))
        return
    for resource in missing:
        destination = comfy / 'models' / resource['folder'] / resource['name']
        print('下载 %s → models/%s/%s' % (resource['title'], resource['folder'], resource['name']))
        download(resource['url'], destination, resource.get('size'))
    print('安装完成。重启 ComfyUI 后打开 /launcher')


if __name__ == '__main__':
    main()

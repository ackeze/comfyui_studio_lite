import math
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
import folder_paths
import nodes


def build_video(arguments):
    def model_file(category, supplied, marker):
        files = [name for name in folder_paths.get_filename_list(category) if marker in name.lower()]
        if not supplied and len(files) == 1:
            return files[0]
        if not isinstance(supplied, str) or supplied not in files:
            raise ValueError(f'请选择已安装的 {marker} 配套文件（{category}）')
        return supplied

    def number(name, default, low, high, integer=False):
        value = arguments.get(name, default)
        if type(value) not in ((int,) if integer else (int, float)) or not low <= value <= high:
            raise ValueError(f'{name} 必须在 {low}–{high} 范围内')
        return value

    def image(name):
        if not isinstance(name, str) or not name or name.endswith(('[output]', '[temp]')):
            raise ValueError('视频参考图须来自上传到 input 的图片')
        path = Path(folder_paths.get_annotated_filepath(name)).resolve()
        if not path.is_relative_to(Path(folder_paths.get_input_directory()).resolve()) or not path.is_file():
            raise ValueError('视频参考图不存在，请重新上传')
        return name

    mode = arguments.get('mode', 'text')
    if mode not in ('text', 'frames', 'reference'):
        raise ValueError('视频模式须为 text、frames 或 reference')
    model = model_file('diffusion_models', arguments.get('model'), 'minimax_h3_ref2va' if mode == 'reference' else 'minimax_h3_fl2va')
    clip = model_file('text_encoders', arguments.get('clip'), 'minimax_h3')
    vae = model_file('vae', arguments.get('vae'), 'minimax_h3_video_vae')
    audio_vae = model_file('vae', arguments.get('audio_vae'), 'minimax_h3_audio_vae')
    prompt = arguments.get('prompt')
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000:
        raise ValueError('视频描述须为 1–16000 字')
    width, height = number('width', 1344, 256, 1536, True), number('height', 768, 256, 1536, True)
    if width % 32 or height % 32 or width * height > 768 * 1344:
        raise ValueError('视频宽高须为 32 的倍数，面积不超过 1344 × 768')
    seconds = number('duration', 5, 2, 15)
    length = math.ceil(seconds * 24)
    length += (5 - length) % 17
    turbo = arguments.get('turbo', False)
    sound = arguments.get('audio', True)
    if type(turbo) is not bool or type(sound) is not bool:
        raise ValueError('turbo 和 audio 须为布尔值')
    if turbo and mode == 'reference':
        raise ValueError('当前 Turbo LoRA 只用于 H3 首尾帧模型')
    steps = number('steps', 8 if turbo else 30, 1, 80, True)
    cfg = number('cfg', 1 if turbo else 3, 1, 10)
    seed = number('seed', -1, -1, 2**53 - 1, True)
    if seed == -1:
        seed = secrets.randbelow(2**53)
    sampler = arguments.get('sampler', 'euler')
    scheduler = arguments.get('scheduler', 'simple')
    required = nodes.NODE_CLASS_MAPPINGS['KSampler'].INPUT_TYPES()['required']
    if sampler not in required['sampler_name'][0] or scheduler not in required['scheduler'][0]:
        raise ValueError('不支持的视频采样器或调度器')
    first, last = arguments.get('first_frame'), arguments.get('last_frame')
    refs = arguments.get('reference_images', [])
    if not isinstance(refs, list) or len(refs) > 4:
        raise ValueError('最多使用 4 张视频参考图')
    if mode == 'text' and (first or last or refs) or mode == 'frames' and refs or mode == 'reference' and (first or last):
        raise ValueError('参考图与视频模式不匹配，请选择对应模式')
    if mode == 'frames' and not (first or last) or mode == 'reference' and not refs:
        raise ValueError('请先上传当前视频模式所需的参考图')
    graph = {}

    def add(kind, **inputs):
        if kind not in nodes.NODE_CLASS_MAPPINGS:
            raise ValueError(f'缺少视频节点 {kind}，请重启已内置 H3 的 ComfyUI')
        key = str(len(graph) + 1)
        graph[key] = {'class_type': kind, 'inputs': inputs}
        return [key, 0]

    loaded = add('UNETLoader', unet_name=model, weight_dtype='default')
    if turbo:
        lora = model_file('loras', arguments.get('turbo_lora'), 'minimax_h3_fl2v_turbo')
        loaded = add('LoraLoaderModelOnly', model=loaded, lora_name=lora, strength_model=1.0)
    loaded = add('MiniMaxH3SigmaShift', model=loaded, shift_video=12.0, shift_audio=3.0)
    encoded = add('CLIPLoader', clip_name=clip, type='minimax', device='default')
    video_vae = add('VAELoader', vae_name=vae)
    sound_vae = add('VAELoader', vae_name=audio_vae)
    conditioning = dict(clip=encoded, vae=video_vae, prompt=prompt, width=width, height=height, length=length)
    if mode == 'reference':
        conditioning.update(audio_vae=sound_vae, ref_image_size='match')
        for index, name in enumerate(refs):
            conditioning[f'ref_images.ref_image_{index}'] = add('LoadImage', image=image(name))
        positive = add('MiniMaxH3ReferenceToVideo', **conditioning)
    else:
        for key, name in (('first_frame', first), ('last_frame', last)):
            if name:
                conditioning[key] = add('LoadImage', image=image(name))
        positive = add('MiniMaxH3ImageToVideo', **conditioning)
    negative = add('ConditioningZeroOut', conditioning=positive)
    sampled = add('KSampler', model=loaded, seed=seed, steps=steps, cfg=cfg, sampler_name=sampler,
                  scheduler=scheduler, positive=positive, negative=negative, latent_image=[positive[0], 1], denoise=1.0)
    split = add('LTXVSeparateAVLatent', av_latent=sampled)
    frames = add('VAEDecode', samples=split, vae=video_vae)
    video_inputs = dict(images=frames, fps=24.0)
    if sound:
        video_inputs['audio'] = add('VAEDecodeAudio', samples=[split[0], 1], vae=sound_vae)
    video = add('CreateVideo', **video_inputs)
    add('SaveVideo', video=video, filename_prefix='video/ComfyStudio-H3', format='mp4', codec='h264')
    settings = {**arguments, 'media': 'video', 'mode': mode, 'model': model, 'clip': clip, 'vae': vae,
                'audio_vae': audio_vae, 'width': width, 'height': height, 'length': length, 'fps': 24,
                'duration': length / 24, 'steps': steps, 'cfg': cfg, 'seed': seed, 'audio': sound, 'turbo': turbo}
    return graph, settings


def install_video(routes):
    @routes.post('/launcher/video/workflow')
    async def video_workflow(request):
        origin = request.headers.get('Origin')
        if origin and urlsplit(origin).netloc != request.host:
            raise web.HTTPForbidden()
        try:
            arguments = await request.json()
            if not isinstance(arguments, dict):
                raise ValueError('视频参数须为对象')
            workflow, settings = build_video(arguments)
            return web.json_response({'workflow': workflow, 'settings': settings})
        except ValueError as error:
            return web.json_response({'error': str(error)}, status=400)

import math
import secrets

import folder_paths

WEIGHT_DTYPES = ('default', 'fp8_e4m3fn', 'fp8_e4m3fn_fast', 'fp8_e5m2')
MAX_LORAS = 8
CENSOR_NEGATIVE_TAGS = {
    'nsfw', 'sfw', 'explicit', 'nude', 'naked', 'censored', 'uncensored', 'mosaic', 'safe',
    'rating safe', 'rating questionable', 'rating explicit', 'bar censor', 'convenient censor',
}


def clean_negative(text):
    parts = []
    for part in text.replace('，', ',').replace('；', ',').replace(';', ',').replace('\n', ',').split(','):
        tag = ' '.join(part.strip().lower().replace('-', ' ').replace('_', ' ').replace(':', ' ').split())
        if part.strip() and tag not in CENSOR_NEGATIVE_TAGS:
            parts.append(part.strip())
    return ', '.join(parts)


def camera_number(value, key, fallback, low, high):
    raw = value.get(key) if isinstance(value, dict) else None
    if type(raw) not in (int, float) or raw != raw:
        raw = fallback
    return min(high, max(low, float(raw)))


def camera_values(value):
    source = dict(value) if isinstance(value, dict) else {}
    if 'distance_weight' not in source and 'distanceWeight' in source:
        source['distance_weight'] = source['distanceWeight']
    return {
        'enabled': isinstance(value, dict) and value.get('enabled') is True,
        'azimuth': (camera_number(source, 'azimuth', 0, -360, 360) + 180) % 360 - 180,
        'elevation': camera_number(source, 'elevation', 0, -80, 80),
        'distance': camera_number(source, 'distance', 4, 1.5, 9),
        'weight': camera_number(source, 'weight', 1.35, .5, 2),
        'distance_weight': camera_number(source, 'distance_weight', 1, 0, 2.5),
    }


def camera_prompt(value):
    camera = camera_values(value)
    if not camera['enabled']:
        return ''
    angle = math.radians(camera['azimuth'])
    front = max(0.0, math.cos(angle))
    back = max(0.0, -math.cos(angle))
    face_left = max(0.0, math.sin(angle))
    face_right = max(0.0, -math.sin(angle))
    total = front + back + face_left + face_right
    if total > 0:
        front, back, face_left, face_right = front / total, back / total, face_left / total, face_right / total
    scale = camera['weight'] / 1.35
    budget = 1.2 * scale * max(0.0, min(1.0, 10 * (1 - abs(camera['elevation']) / 80)))
    parts = []

    def emit(tag, weight):
        if weight >= .05:
            parts.append('(%s:%.2f)' % (tag, min(2.5, max(.1, weight))))

    emit('from front', front * budget)
    emit('from behind', back * budget)
    emit('facing left', face_left * budget)
    emit('facing right', face_right * budget)
    tilt = camera['elevation'] / 80
    if abs(tilt) > .2:
        tilt_weight = abs(tilt) * 1.2 * scale
        emit('high angle' if tilt > 0 else 'low angle', tilt_weight)
        emit('from above' if tilt > 0 else 'from below', tilt_weight)
    distance = camera['distance']
    emit('close-up' if distance < 2.4 else 'medium shot' if distance < 5.2 else 'cowboy shot' if distance < 7 else 'full body' if distance < 8.2 else 'wide shot', camera['distance_weight'])
    return ', '.join(parts)


def camera_negative(value):
    return 'multiple views, character sheet, reference sheet, panorama' if camera_values(value)['enabled'] else ''


def build_generation(arguments):
    def installed(category, name):
        if not isinstance(name, str) or name not in folder_paths.get_filename_list(category):
            raise ValueError(f'模型文件不存在：{category}/{name}')
        return name

    def companion(category, supplied, prefix):
        if supplied:
            return installed(category, supplied)
        matches = [name for name in folder_paths.get_filename_list(category) if name.replace('\\', '/').split('/')[-1].lower().startswith(prefix)]
        if len(matches) != 1:
            raise ValueError(f'无法唯一确定 {category} 的 {prefix}，请查询本地模型后明确指定')
        return matches[0]

    def whole(value, name, low, high):
        if type(value) is not int or not low <= value <= high:
            raise ValueError(f'{name}必须是 {low}–{high} 之间的整数')
        return value

    def fraction(value, name, low, high):
        if type(value) not in (int, float) or not low <= value <= high:
            raise ValueError(f'{name}必须是 {low}–{high} 之间的数值')
        return float(value)

    def keyword(value, name, limit=64):
        if not isinstance(value, str) or not 0 < len(value) <= limit or value != value.strip():
            raise ValueError(f'{name}无效')
        return value

    def lora_stack(items):
        if items is None:
            return []
        if not isinstance(items, list) or len(items) > MAX_LORAS:
            raise ValueError(f'LoRA 最多 {MAX_LORAS} 个')
        stack = []
        for item in items:
            if not isinstance(item, dict):
                raise ValueError('每个 LoRA 需要用 name 指定文件')
            stack.append({
                'name': installed('loras', item.get('name')),
                'model_strength': fraction(item.get('model_strength', 1), 'LoRA 模型权重', -5, 5),
                'clip_strength': fraction(item.get('clip_strength', 1), 'LoRA 文本编码器权重', -5, 5),
            })
        return stack

    model = installed('diffusion_models', arguments['model'])
    if 'anima' not in model.lower():
        raise ValueError('自动生成工具当前支持 Anima 分体模型，请明确选择 Anima diffusion model')
    clip = companion('text_encoders', arguments.get('clip'), 'qwen_3_06b_base')
    vae = companion('vae', arguments.get('vae'), 'qwen_image_vae')
    if not clip.replace('\\', '/').split('/')[-1].lower().startswith('qwen_3_06b_base') or not vae.replace('\\', '/').split('/')[-1].lower().startswith('qwen_image_vae'):
        raise ValueError('Anima 自动生成需要已识别的 Qwen3 0.6B 编码器和 Qwen-Image VAE，不接受其他架构的配套文件')
    clip_type = keyword(arguments.get('clip_type', 'stable_diffusion'), '文本编码器类型', 32)
    weight_dtype = arguments.get('weight_dtype', 'default')
    if weight_dtype not in WEIGHT_DTYPES:
        raise ValueError('权重精度只支持 ' + '、'.join(WEIGHT_DTYPES))
    loras = lora_stack(arguments.get('loras'))
    width, height = arguments['width'], arguments['height']
    if any(type(size) is not int or not 256 <= size <= 1536 or size % 16 for size in (width, height)):
        raise ValueError('宽高必须为 256–1536 范围的 16 倍数')
    steps = whole(arguments.get('steps', 35), '步数', 1, 80)
    cfg = fraction(arguments.get('cfg', 4.0), 'CFG', 1, 10)
    batch_size = whole(arguments.get('batch_size', 1), '批次数量', 1, 16)
    sampler = keyword(arguments.get('sampler', 'euler'), '采样器')
    scheduler = keyword(arguments.get('scheduler', 'simple'), '调度器')
    prompt = arguments['prompt']
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 16000:
        raise ValueError('提示词为空或过长')
    negative = arguments.get('negative_prompt', '')
    if not isinstance(negative, str) or len(negative) > 16000:
        raise ValueError('负面提示词无效')
    negative = clean_negative(negative)
    seed = arguments.get('seed', -1)
    if type(seed) is not int or not -1 <= seed <= 2**53-1:
        raise ValueError('种子无效')
    if seed == -1:
        seed = secrets.randbelow(2**53)
    graph = {
        '4': {'class_type': 'UNETLoader', 'inputs': {'unet_name': model, 'weight_dtype': weight_dtype}},
        '10': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': clip, 'type': clip_type}},
        '11': {'class_type': 'VAELoader', 'inputs': {'vae_name': vae}},
    }
    model_ref, clip_ref = ['4', 0], ['10', 0]
    for index, lora in enumerate(loras):
        node = str(20 + index)
        graph[node] = {'class_type': 'LoraLoader', 'inputs': {'model': model_ref, 'clip': clip_ref, 'lora_name': lora['name'], 'strength_model': lora['model_strength'], 'strength_clip': lora['clip_strength']}}
        model_ref, clip_ref = [node, 0], [node, 1]
    graph['6'] = {'class_type': 'CLIPTextEncode', 'inputs': {'clip': clip_ref, 'text': ', '.join(part for part in (prompt, camera_prompt(arguments.get('camera'))) if part)}}
    graph['7'] = {'class_type': 'CLIPTextEncode', 'inputs': {'clip': clip_ref, 'text': ', '.join(part for part in (negative, camera_negative(arguments.get('camera'))) if part)}}
    graph['5'] = {'class_type': 'EmptyLatentImage', 'inputs': {'width': width, 'height': height, 'batch_size': batch_size}}
    graph['3'] = {'class_type': 'KSampler', 'inputs': {'model': model_ref, 'positive': ['6', 0], 'negative': ['7', 0], 'latent_image': ['5', 0], 'seed': seed, 'steps': steps, 'cfg': cfg, 'sampler_name': sampler, 'scheduler': scheduler, 'denoise': 1}}
    graph['8'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['3', 0], 'vae': ['11', 0]}}
    graph['9'] = {'class_type': 'SaveImage', 'inputs': {'filename_prefix': 'ComfyStudio_Agent', 'images': ['8', 0]}}
    settings = dict(arguments, clip=clip, clip_type=clip_type, vae=vae, weight_dtype=weight_dtype, loras=loras, seed=seed, steps=steps, cfg=cfg, sampler=sampler, scheduler=scheduler, batch_size=batch_size)
    return graph, settings


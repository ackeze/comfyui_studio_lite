export const REPAIR_PRESETS = {
  body: { detector:'segm/person_yolov8m-seg.pt', steps:40, positive:'best quality, detailed, natural anatomy', negative:'bad anatomy, extra limbs, malformed limbs' },
  head: { detector:'bbox/face_yolov8m.pt', steps:30, positive:'best quality, detailed face, detailed eyes', negative:'deformed face, malformed eyes, blurry face' },
  hands: { detector:'bbox/hand_yolov8s.pt', steps:30, positive:'detailed hands, anatomically correct hands', negative:'bad hands, extra fingers, missing fingers, fused fingers' },
};

export function addRepair(workflow, source, model, clip, vae, seed) {
  const parts = Array.isArray(source.repair) ? source.repair : [source.repair];
  if (!parts.length || parts.some(part => !Object.hasOwn(REPAIR_PRESETS,part))) throw new Error('请至少勾选一个修复部位');
  workflow['110'] = {class_type:'LoadImage', inputs:{image:source.image}};
  workflow['121'] = {class_type:'SAMLoader', inputs:{model_name:'sam_vit_b_01ec64.pth', device_mode:'AUTO'}};
  let image = ['110',0];
  Object.keys(REPAIR_PRESETS).filter(part => parts.includes(part)).forEach((part,index) => {
  const preset = REPAIR_PRESETS[part], offset=index*10;
  const positive=index ? 'repair_positive_'+part : '6', negative=index ? 'repair_negative_'+part : '7', detector=String(120+offset), detailer=String(122+offset);
  workflow[positive] = {class_type:'CLIPTextEncode', inputs:{clip, text:preset.positive}};
  workflow[negative] = {class_type:'CLIPTextEncode', inputs:{clip, text:preset.negative}};
  workflow[detector] = {class_type:'UltralyticsDetectorProvider', inputs:{model_name:preset.detector}};
  workflow[detailer] = {class_type:'FaceDetailer', inputs:{
    image, model, clip, vae, positive:[positive,0], negative:[negative,0],
    bbox_detector:[detector,0], sam_model_opt:['121',0],
    guide_size:512, guide_size_for:true, max_size:1024, seed, steps:preset.steps,
    cfg:4, sampler_name:'euler', scheduler:'simple', denoise:.5, feather:5,
    noise_mask:true, force_inpaint:true, bbox_threshold:.5, bbox_dilation:10,
    bbox_crop_factor:3, sam_detection_hint:'center-1', sam_dilation:0,
    sam_threshold:.93, sam_bbox_expansion:0, sam_mask_hint_threshold:.7,
    sam_mask_hint_use_negative:'False', drop_size:10, wildcard:'', cycle:1,
    inpaint_model:false, noise_mask_feather:20, tiled_encode:false, tiled_decode:false,
  }};
  image = [detailer,0];
  });
  workflow['9'] = {class_type:'SaveImage', inputs:{filename_prefix:'ComfyUI_Repair', images:image}};
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorkflow } from '../../../web/launcher/assets/js/core.js';

const settings = { mode: 'unet', unet: 'anima-base-v1.0.safetensors', clip: 'qwen.safetensors', clipType: 'anima', vae: 'wan.safetensors',
  width: 768, height: 1024, seed: 42, batchSize: 2, steps: 30, cfg: 4, sampler: 'euler', scheduler: 'simple',
  prompt: 'a garden', negPrompt: 'blurry', loraStack: [{ name: 'style.safetensors', modelStr: .7, clipStr: .5 }],
  img2img: { enabled: true, image: 'img2img-test.png', denoise: .45 } };

for (const [repair,detector] of [['body','segm/person_yolov8m-seg.pt'],['head','bbox/face_yolov8m.pt'],['hands','bbox/hand_yolov8s.pt']]) {
  test(repair + ': repair presets bypass free prompts and full-frame sampling', () => {
    const {workflow:w}=buildWorkflow({...settings,img2img:{...settings.img2img,repair}});
    assert.equal(w['120'].inputs.model_name,detector);
    assert.equal(w['122'].class_type,'FaceDetailer');
    assert.deepEqual(w['122'].inputs.image,['110',0]);
    assert.deepEqual(w['122'].inputs.model,['20',0]);
    assert.deepEqual(w['9'].inputs.images,['122',0]);
    assert.equal(w['122'].inputs.denoise,.5);
    assert.equal(w['3'],undefined);
    assert.equal(w['5'],undefined);
    assert.notEqual(w['6'].inputs.text,settings.prompt);
    assert.notEqual(w['7'].inputs.text,settings.negPrompt);
  });
}

for (const mode of ['unet', 'checkpoint']) {
  test(`${mode}: source pixels are encoded and repeated, not replaced by empty noise`, () => {
    const { workflow: w, seed } = buildWorkflow({ ...settings, mode });
    assert.equal(seed, 42);
    assert.equal(w['110'].inputs.image, 'img2img-test.png');
    assert.deepEqual(w['111'].inputs, { pixels: ['110', 0], vae: mode === 'unet' ? ['11', 0] : ['4', 2] });
    assert.equal(w['5'].class_type, 'RepeatLatentBatch');
    assert.equal(w['5'].inputs.amount, 2);
    assert.deepEqual(w['5'].inputs.samples, ['111', 0]);
    assert.deepEqual(w['3'].inputs.latent_image, ['5', 0]);
    assert.equal(w['3'].inputs.denoise, .45);
    assert.deepEqual(w['3'].inputs.model, ['20', 0]);
    assert.equal(w['20'].inputs.strength_model, .7);
    assert.equal(w['6'].inputs.text, settings.prompt);
    assert.equal(w['7'].inputs.text, settings.negPrompt);
    assert.equal(w['3'].inputs.steps, 30);
    assert.equal(w['9'].inputs.filename_prefix, 'ComfyUI_Img2Img');
    assert.ok(!Object.values(w).some(n => /Pose|AnimaControl|ImageScale/.test(n.class_type)));
  });
}

test('multi repair chains body then head then hands and rejects empty selection', () => {
 const {workflow:w}=buildWorkflow({...settings,img2img:{...settings.img2img,repair:['hands','head','body']}});
 assert.deepEqual(w['132'].inputs.image,['122',0]);
 assert.deepEqual(w['142'].inputs.image,['132',0]);
 assert.deepEqual(w['9'].inputs.images,['142',0]);
 assert.equal(w['120'].inputs.model_name,'segm/person_yolov8m-seg.pt');
 assert.equal(w['130'].inputs.model_name,'bbox/face_yolov8m.pt');
 assert.equal(w['140'].inputs.model_name,'bbox/hand_yolov8s.pt');
 assert.throws(()=>buildWorkflow({...settings,img2img:{...settings.img2img,repair:[]}}),/至少勾选/);
});

test('disabled img2img does not affect text to image', () => {
  const { workflow: w } = buildWorkflow({ ...settings, img2img: { ...settings.img2img, enabled: false } });
  assert.equal(w['110'], undefined);
  assert.equal(w['5'].class_type, 'EmptyLatentImage');
  assert.equal(w['3'].inputs.denoise, 1);
});

test('missing source, invalid denoise and mixed pose are rejected', () => {
  assert.throws(() => buildWorkflow({ ...settings, img2img: { enabled: true } }), /参考图/);
  for (const denoise of [-1, 0, NaN, 1.1]) assert.throws(() => buildWorkflow({ ...settings, img2img: { ...settings.img2img, denoise } }), /重绘强度/);
  assert.throws(() => buildWorkflow({ ...settings, poseControl: { poseJson: '{}' } }), /同时/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraPrompt, cameraNegative, cameraPosition, normalizeCamera, wrapAzimuth, sphereOrbit, shotView, shotRegion, shotCoords } from '../../../web/launcher/assets/js/camera.js';
import { buildWorkflow } from '../../../web/launcher/assets/js/core.js';

test('camera defaults, bounds and semantic directions', () => {
  assert.equal(cameraPrompt(), '');
  assert.equal(cameraPrompt({enabled:true}).includes('solo'), false);
  assert.equal(shotView({azimuth:0}), 'from front');
  assert.equal(shotView({azimuth:55}), 'facing left');
  assert.equal(shotView({azimuth:90}), 'facing left');
  assert.equal(shotView({azimuth:-90}), 'facing right');
  assert.ok(shotCoords({azimuth:-90}).x < 0);
  assert.ok(shotCoords({azimuth:90}).x > 0);
  assert.match(cameraPrompt({enabled:true}), /\(from front:1\.20\)/);
  assert.match(cameraPrompt({enabled:true}), /medium shot/);
  assert.match(cameraPrompt({enabled:true,azimuth:90,weight:1.35}), /facing left/);
  assert.doesNotMatch(cameraPrompt({enabled:true,azimuth:90,weight:1.35}), /from front|from behind|facing right/);
  assert.match(cameraPrompt({enabled:true,azimuth:-90,weight:1.35}), /facing right/);
  const rearLow = cameraPrompt({enabled:true,azimuth:-170,elevation:-40,distance:8});
  assert.match(rearLow, /from behind/);
  assert.match(rearLow, /facing right/);
  assert.match(cameraPrompt({enabled:true,azimuth:-170,elevation:-40,distance:8}), /low angle/);
  assert.match(cameraPrompt({enabled:true,azimuth:-170,elevation:-40,distance:8}), /from below/);
  assert.match(cameraPrompt({enabled:true,distance:8}), /full body/);
  assert.match(cameraPrompt({enabled:true}), /\(medium shot:1\.00\)/);
  assert.match(cameraPrompt({enabled:true,distanceWeight:2}), /\(medium shot:2\.00\)/);
  assert.doesNotMatch(cameraPrompt({enabled:true,distanceWeight:0}), /medium shot|close-up|cowboy shot|full body|wide shot/);
  assert.match(cameraPrompt({enabled:true,weight:2,distanceWeight:0.5}), /\(medium shot:0\.50\)/);
  assert.equal(normalizeCamera({distance:0,weight:99}).distance,1.5);
  assert.equal(normalizeCamera({weight:99}).weight,2);
  assert.equal(normalizeCamera({distanceWeight:99}).distanceWeight,2.5);
  assert.deepEqual(normalizeCamera(null),normalizeCamera());
  assert.deepEqual(cameraPosition({distance:4}),[0,0,4]);
});

test('left and right stay distinct behind the subject and azimuth wraps', () => {
  assert.equal(wrapAzimuth(190), -170);
  assert.equal(wrapAzimuth(-190), 170);
  assert.equal(wrapAzimuth(180), 180);
  assert.equal(normalizeCamera({azimuth:190}).azimuth, -170);
  assert.equal(shotRegion({azimuth:150}), '左后方');
  assert.equal(shotRegion({azimuth:-150}), '右后方');
  assert.equal(shotView({azimuth:150}), 'from behind');
  assert.equal(shotView({azimuth:-150}), 'from behind');
  assert.equal(shotView({azimuth:180}), 'from behind');
  const leftRear = cameraPrompt({enabled:true, azimuth:150});
  const rightRear = cameraPrompt({enabled:true, azimuth:-150});
  assert.match(leftRear, /from behind/);
  assert.match(leftRear, /facing left/);
  assert.match(rightRear, /from behind/);
  assert.match(rightRear, /facing right/);
  assert.notEqual(leftRear, rightRear);
  assert.match(cameraPrompt({enabled:true,azimuth:55}), /facing left/);
  assert.match(cameraPrompt({enabled:true,azimuth:-55}), /facing right/);
  assert.match(cameraNegative({enabled:true}), /multiple views/);
  assert.match(cameraNegative({enabled:true}), /panorama/);
  assert.equal(/2girls|2boys|solo|extra person|1girl|1boy|multiple people/.test(cameraPrompt({enabled:true}) + cameraNegative({enabled:true})), false);
  const back = cameraPosition({azimuth:180, distance:4});
  const towardPlusX = sphereOrbit(back, [1, 0, 0]);
  const towardMinusX = sphereOrbit(back, [-1, 0, 0]);
  assert.ok(towardPlusX.azimuth > 0 && towardPlusX.azimuth < 180);
  assert.ok(towardMinusX.azimuth < 0);
  assert.equal(shotRegion({azimuth:towardPlusX.azimuth}), '左后方');
  assert.equal(shotRegion({azimuth:towardMinusX.azimuth}), '右后方');
});

test('only normal mode injects once; raw prompt, LoRA, seed and negative stay unchanged', () => {
  const settings={mode:'checkpoint',checkpoint:'anima.safetensors',seed:42,width:768,height:1024,steps:30,cfg:4,batchSize:1,prompt:'a ceramic vase',negPrompt:'blurry',cameraControl:{enabled:true},loraStack:[{name:'style',modelStr:.5,clipStr:.5}]};
  const before=JSON.stringify(settings);
  const graph=buildWorkflow(settings).workflow;
  assert.equal(graph['6'].inputs.text, 'a ceramic vase, '+cameraPrompt(settings.cameraControl));
  assert.equal(buildWorkflow(settings).workflow['6'].inputs.text,graph['6'].inputs.text);
  assert.equal(graph['7'].inputs.text,'blurry, '+cameraNegative(settings.cameraControl));
  assert.equal(graph['3'].inputs.seed,42);
  assert.deepEqual(graph['6'].inputs.clip,['20',1]);
  assert.equal(JSON.stringify(settings),before);
  for (const extra of [{cameraControl:{enabled:false}}, {pose:{enabled:true}}, {img2img:{enabled:true,image:'test.png',denoise:.5}}, {poseControl:{image:'pose.png',lora:'pose'}}]) {
    assert.equal(buildWorkflow({...settings,...extra}).workflow['6'].inputs.text, settings.prompt);
  }
});

test('Anima 4-way mix: 55° is from front + facing left, weights stay mild', () => {
  assert.match(cameraPrompt({enabled:true}), /\(from front:1\.20\)/);
  assert.match(cameraPrompt({enabled:true,azimuth:45}), /from front/);
  assert.match(cameraPrompt({enabled:true,azimuth:45}), /facing left/);
  assert.match(cameraPrompt({enabled:true,azimuth:-45}), /facing right/);
  assert.doesNotMatch(cameraPrompt({enabled:true,azimuth:90}), /from front|from behind/);
  const frontLeft = cameraPrompt({enabled:true,azimuth:55,weight:1.4});
  assert.match(frontLeft, /from front/);
  assert.match(frontLeft, /facing left/);
  assert.doesNotMatch(frontLeft, /from behind|facing right/);
  const frontW = Number(frontLeft.match(/from front:([\d.]+)/)[1]);
  const faceW = Number(frontLeft.match(/facing left:([\d.]+)/)[1]);
  assert.ok(faceW > frontW);
  assert.ok(faceW < 2.5);
});

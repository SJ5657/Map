import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

globalThis.document = {
  createElementNS: () => ({
    addEventListener: () => {},
    removeEventListener: () => {}
  })
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDir = path.resolve(__dirname, '..');

// 1. Parse Unity .meta file skeleton T-pose rotations
function parseMetaSkeleton(metaPath) {
  const metaText = fs.readFileSync(metaPath, 'utf8');
  const skelSection = metaText.split('skeleton:')[1];
  const entries = skelSection.split('  - name: ').slice(1);
  const metaBones = {};
  for (const entry of entries) {
    const lines = entry.split(/\r?\n/);
    const name = lines[0].trim();
    const posLine = lines.find(l => l.trim().startsWith('position:'));
    const rotLine = lines.find(l => l.trim().startsWith('rotation:'));
    if (posLine && rotLine) {
      const pMatch = posLine.match(/x:\s*([-\d.eE]+),\s*y:\s*([-\d.eE]+),\s*z:\s*([-\d.eE]+)/);
      const rMatch = rotLine.match(/x:\s*([-\d.eE]+),\s*y:\s*([-\d.eE]+),\s*z:\s*([-\d.eE]+),\s*w:\s*([-\d.eE]+)/);
      if (pMatch && rMatch) {
        metaBones[name] = {
          p: [+pMatch[1], +pMatch[2], +pMatch[3]],
          q: [+rMatch[1], +rMatch[2], +rMatch[3], +rMatch[4]]
        };
      }
    }
  }
  return metaBones;
}

// 2. Parse VRM 1.0 glTF JSON chunk & build VRM rest hierarchy
function parseVRM(vrmPath) {
  const vrmBuf = fs.readFileSync(vrmPath);
  const jsonLen = vrmBuf.readUInt32LE(12);
  const gltf = JSON.parse(vrmBuf.toString('utf8', 20, 20 + jsonLen));

  const vrmParent = {};
  gltf.nodes.forEach((n, idx) => {
    if (n.children) {
      n.children.forEach(c => { vrmParent[c] = idx; });
    }
  });

  const vrmNodeByName = {};
  gltf.nodes.forEach((n, idx) => {
    vrmNodeByName[n.name] = { ...n, index: idx };
  });

  function getVRMWorldQuat(idx) {
    const chain = [];
    let cur = idx;
    while (cur !== undefined) {
      chain.unshift(cur);
      cur = vrmParent[cur];
    }
    const wq = new THREE.Quaternion();
    for (const i of chain) {
      const r = gltf.nodes[i].rotation || [0, 0, 0, 1];
      wq.multiply(new THREE.Quaternion(r[0], r[1], r[2], r[3]));
    }
    return wq;
  }

  function getVRMWorldPos(idx) {
    const chain = [];
    let cur = idx;
    while (cur !== undefined) {
      chain.unshift(cur);
      cur = vrmParent[cur];
    }
    const m = new THREE.Matrix4();
    for (const i of chain) {
      const n = gltf.nodes[i];
      const t = n.translation || [0, 0, 0];
      const r = n.rotation || [0, 0, 0, 1];
      const s = n.scale || [1, 1, 1];
      const lm = new THREE.Matrix4().compose(
        new THREE.Vector3(...t),
        new THREE.Quaternion(...r),
        new THREE.Vector3(...s)
      );
      m.multiply(lm);
    }
    return new THREE.Vector3().setFromMatrixPosition(m);
  }

  return {
    gltf,
    vrmParent,
    vrmNodeByName,
    getVRMWorldQuat,
    getVRMWorldPos
  };
}

// Humanoid Bone Mapping: [FBX Bone Name, VRM Bone Name]
const BONE_MAP = [
  ['pelvis', 'J_Bip_C_Hips'],
  ['spine_01', 'J_Bip_C_Spine'],
  ['spine_02', 'J_Bip_C_Chest'],
  ['spine_03', 'J_Bip_C_UpperChest'],
  ['neck_01', 'J_Bip_C_Neck'],
  ['head', 'J_Bip_C_Head'],

  ['clavicle_l', 'J_Bip_L_Shoulder'],
  ['upperarm_l', 'J_Bip_L_UpperArm'],
  ['lowerarm_l', 'J_Bip_L_LowerArm'],
  ['hand_l', 'J_Bip_L_Hand'],

  ['clavicle_r', 'J_Bip_R_Shoulder'],
  ['upperarm_r', 'J_Bip_R_UpperArm'],
  ['lowerarm_r', 'J_Bip_R_LowerArm'],
  ['hand_r', 'J_Bip_R_Hand'],

  ['thigh_l', 'J_Bip_L_UpperLeg'],
  ['calf_l', 'J_Bip_L_LowerLeg'],
  ['foot_l', 'J_Bip_L_Foot'],
  ['ball_l', 'J_Bip_L_ToeBase'],

  ['thigh_r', 'J_Bip_R_UpperLeg'],
  ['calf_r', 'J_Bip_R_LowerLeg'],
  ['foot_r', 'J_Bip_R_Foot'],
  ['ball_r', 'J_Bip_R_ToeBase'],

  // Fingers Left
  ['thumb_01_l', 'J_Bip_L_Thumb1'],
  ['thumb_02_l', 'J_Bip_L_Thumb2'],
  ['thumb_03_l', 'J_Bip_L_Thumb3'],
  ['index_01_l', 'J_Bip_L_Index1'],
  ['index_02_l', 'J_Bip_L_Index2'],
  ['index_03_l', 'J_Bip_L_Index3'],
  ['middle_01_l', 'J_Bip_L_Middle1'],
  ['middle_02_l', 'J_Bip_L_Middle2'],
  ['middle_03_l', 'J_Bip_L_Middle3'],
  ['ring_01_l', 'J_Bip_L_Ring1'],
  ['ring_02_l', 'J_Bip_L_Ring2'],
  ['ring_03_l', 'J_Bip_L_Ring3'],
  ['pinky_01_l', 'J_Bip_L_Little1'],
  ['pinky_02_l', 'J_Bip_L_Little2'],
  ['pinky_03_l', 'J_Bip_L_Little3'],

  // Fingers Right
  ['thumb_01_r', 'J_Bip_R_Thumb1'],
  ['thumb_02_r', 'J_Bip_R_Thumb2'],
  ['thumb_03_r', 'J_Bip_R_Thumb3'],
  ['index_01_r', 'J_Bip_R_Index1'],
  ['index_02_r', 'J_Bip_R_Index2'],
  ['index_03_r', 'J_Bip_R_Index3'],
  ['middle_01_r', 'J_Bip_R_Middle1'],
  ['middle_02_r', 'J_Bip_R_Middle2'],
  ['middle_03_r', 'J_Bip_R_Middle3'],
  ['ring_01_r', 'J_Bip_R_Ring1'],
  ['ring_02_r', 'J_Bip_R_Ring2'],
  ['ring_03_r', 'J_Bip_R_Ring3'],
  ['pinky_01_r', 'J_Bip_R_Little1'],
  ['pinky_02_r', 'J_Bip_R_Little2'],
  ['pinky_03_r', 'J_Bip_R_Little3'],
];

function applyMetaTPose(fbxGroup, metaBones) {
  const fbxNodeByName = {};
  fbxGroup.traverse(o => {
    fbxNodeByName[o.name] = o;
    const m = metaBones[o.name];
    if (m && o.name !== 'root') {
      // Convert Unity Left-Handed Quaternion to Three.js Right-Handed FBXLoader Quaternion
      o.quaternion.set(m.q[0], -m.q[1], -m.q[2], m.q[3]);
    }
  });
  fbxGroup.updateMatrixWorld(true);
  return fbxNodeByName;
}

function round4(val) {
  return Math.round(val * 10000) / 10000;
}

function retargetFBXClip(fbxPath, metaBones, vrmData, fps = 30) {
  const loader = new FBXLoader();
  const buf = fs.readFileSync(fbxPath);
  const fbxGroup = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');

  // 1. Capture T-pose World Quaternions for FBX skeleton
  const fbxNodeByName = applyMetaTPose(fbxGroup, metaBones);
  const fbxRestWorldQuat = {};
  const fbxRestParentWorldQuat = {};

  for (const [fbxName] of BONE_MAP) {
    const node = fbxNodeByName[fbxName];
    if (!node) continue;
    fbxRestWorldQuat[fbxName] = node.getWorldQuaternion(new THREE.Quaternion());
    fbxRestParentWorldQuat[fbxName] = node.parent
      ? node.parent.getWorldQuaternion(new THREE.Quaternion())
      : new THREE.Quaternion();
  }

  // Pelvis rest world position in FBX
  const pelvisNode = fbxNodeByName['pelvis'];
  const fbxPelvisRestWorldPos = pelvisNode.getWorldPosition(new THREE.Vector3());

  // VRM Hips rest position
  const vrmHipsNode = vrmData.vrmNodeByName['J_Bip_C_Hips'];
  const vrmHipsRestPos = vrmHipsNode.translation || [0, 0.901158, 0.003632];
  const hipsScale = vrmHipsRestPos[1] / fbxPelvisRestWorldPos.y;

  // 2. Precompute P_i and Q_i for each mapped bone
  // R_B_local(t) = P_i * R_A_local(t) * Q_i
  // P_i = inv(W_B_parent_rest) * W_A_parent_rest
  // Q_i = inv(W_A_rest) * W_B_rest
  const retargetMatrices = {};
  for (const [fbxName, vrmName] of BONE_MAP) {
    const vrmNode = vrmData.vrmNodeByName[vrmName];
    if (!vrmNode || !fbxRestWorldQuat[fbxName]) continue;

    const wA = fbxRestWorldQuat[fbxName];
    const wAp = fbxRestParentWorldQuat[fbxName];
    const wB = vrmData.getVRMWorldQuat(vrmNode.index);
    const parentIdx = vrmData.vrmParent[vrmNode.index];
    const wBp = parentIdx !== undefined ? vrmData.getVRMWorldQuat(parentIdx) : new THREE.Quaternion();

    const P = wBp.clone().invert().multiply(wAp);
    const Q = wA.clone().invert().multiply(wB);
    retargetMatrices[fbxName] = { vrmName, P, Q };
  }

  // 3. Sample animation clip at uniform FPS
  const clip = fbxGroup.animations[0];
  const duration = clip.duration;
  const numFrames = Math.max(2, Math.round(duration * fps) + 1);
  const mixer = new THREE.AnimationMixer(fbxGroup);
  const action = mixer.clipAction(clip);
  action.play();

  const boneTracks = {};
  for (const [, vrmName] of BONE_MAP) {
    boneTracks[vrmName] = [];
  }
  const hipsPositionTrack = [];

  // Record initial frame pelvis world position to compute relative motion
  mixer.setTime(0);
  fbxGroup.updateMatrixWorld(true);
  const initialPelvisWorldPos = pelvisNode.getWorldPosition(new THREE.Vector3());

  for (let f = 0; f < numFrames; f++) {
    const t = Math.min(duration, (f / (numFrames - 1)) * duration);
    mixer.setTime(t);
    fbxGroup.updateMatrixWorld(true);

    // Hips position (vertical bounce & lateral sway, keeping in-place Z)
    const curPelvisWorld = pelvisNode.getWorldPosition(new THREE.Vector3());
    const dx = (curPelvisWorld.x - initialPelvisWorldPos.x) * hipsScale;
    const dy = (curPelvisWorld.y - initialPelvisWorldPos.y) * hipsScale;
    hipsPositionTrack.push([
      round4(vrmHipsRestPos[0] + dx),
      round4(vrmHipsRestPos[1] + dy),
      round4(vrmHipsRestPos[2])
    ]);

    for (const [fbxName, vrmName] of BONE_MAP) {
      const rm = retargetMatrices[fbxName];
      const fbxNode = fbxNodeByName[fbxName];
      if (!rm || !fbxNode) continue;

      const rB = rm.P.clone().multiply(fbxNode.quaternion).multiply(rm.Q).normalize();

      // Ensure quaternion hemisphere continuity with previous frame
      const prevList = boneTracks[vrmName];
      if (prevList.length > 0) {
        const prev = prevList[prevList.length - 1];
        const dot = prev[0] * rB.x + prev[1] * rB.y + prev[2] * rB.z + prev[3] * rB.w;
        if (dot < 0) {
          rB.x = -rB.x;
          rB.y = -rB.y;
          rB.z = -rB.z;
          rB.w = -rB.w;
        }
      }

      prevList.push([round4(rB.x), round4(rB.y), round4(rB.z), round4(rB.w)]);
    }
  }

  return {
    duration: round4(duration),
    fps,
    numFrames,
    hipsPosition: hipsPositionTrack,
    bones: boneTracks
  };
}

function main() {
  const vrmSrcPath = path.join(clientDir, 'models', 'MapGirl.vrm');
  const publicModelsDir = path.join(clientDir, 'public', 'models');
  fs.mkdirSync(publicModelsDir, { recursive: true });

  // Copy MapGirl.vrm to public/models/MapGirl.vrm so Vite serves it in both dev and build
  const vrmDestPath = path.join(publicModelsDir, 'MapGirl.vrm');
  fs.copyFileSync(vrmSrcPath, vrmDestPath);
  console.log(`Copied MapGirl.vrm -> ${vrmDestPath}`);

  const metaPath = path.join(
    clientDir,
    'MoCapCentral',
    'MC_CoreMotion',
    'Animations',
    'LocomotionV2',
    'af_Walk',
    'MCU_af_Loco_Walk_Fwd_NoRM.FBX.meta'
  );
  const metaBones = parseMetaSkeleton(metaPath);
  const vrmData = parseVRM(vrmSrcPath);

  const animFiles = {
    idle: path.join(clientDir, 'MoCapCentral', 'MC_CoreMotion', 'Animations', 'Idle', 'MCU_af_Stand_Idle_01.FBX'),
    walk: path.join(clientDir, 'MoCapCentral', 'MC_CoreMotion', 'Animations', 'LocomotionV2', 'af_Walk', 'MCU_af_Loco_Walk_Fwd_NoRM.FBX'),
    run: path.join(clientDir, 'MoCapCentral', 'MC_CoreMotion', 'Animations', 'LocomotionV2', 'af_Run', 'MCU_af_Loco_Run_Fwd_NoRM.FBX'),
  };

  // Extract MToon material metadata from VRM 1.0 so Babylon can apply exact MToon colors & outlines
  const mtoonMaterials = {};
  for (const mat of vrmData.gltf.materials || []) {
    const mtoon = mat.extensions?.VRMC_materials_mtoon;
    const pbr = mat.pbrMetallicRoughness;
    mtoonMaterials[mat.name] = {
      alphaMode: mat.alphaMode || 'OPAQUE',
      alphaCutoff: mat.alphaCutoff ?? 0.5,
      doubleSided: !!mat.doubleSided,
      baseColorFactor: pbr?.baseColorFactor || [1, 1, 1, 1],
      shadeColorFactor: mtoon?.shadeColorFactor || [0.85, 0.85, 0.85],
      shadingShiftFactor: mtoon?.shadingShiftFactor ?? 0,
      shadingToonyFactor: mtoon?.shadingToonyFactor ?? 0.9,
      outlineWidthMode: mtoon?.outlineWidthMode || 'none',
      outlineWidthFactor: mtoon?.outlineWidthFactor ?? 0,
      outlineColorFactor: mtoon?.outlineColorFactor || [0, 0, 0],
      renderQueueOffsetNumber: mtoon?.renderQueueOffsetNumber ?? 0
    };
  }

  const output = {
    mtoonMaterials,
    clips: {}
  };

  for (const [clipName, fbxPath] of Object.entries(animFiles)) {
    console.log(`Retargeting [${clipName}] from ${path.basename(fbxPath)}...`);
    output.clips[clipName] = retargetFBXClip(fbxPath, metaBones, vrmData, 30);
    console.log(`  -> duration: ${output.clips[clipName].duration}s, frames: ${output.clips[clipName].numFrames}`);
  }

  const outJsonPath = path.join(publicModelsDir, 'animations.json');
  fs.writeFileSync(outJsonPath, JSON.stringify(output));
  const sizeKB = (fs.statSync(outJsonPath).size / 1024).toFixed(1);
  console.log(`Saved retargeted animations + MToon metadata to ${outJsonPath} (${sizeKB} KB)`);
}

main();

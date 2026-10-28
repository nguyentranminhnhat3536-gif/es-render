// .glb nhỏ tự làm cho test (không tải gì): hộp 24 đỉnh có pháp tuyến + vật liệu PBR. opt.ext = phần mở rộng giả (Draco…), opt.uri = buffer trỏ ra file ngoài.
export function glbBox({ size = [1, 1.4, 0.7], color = [0.9, 0.2, 0.25, 1], ext = null, uri = null } = {}) {
  const [x, y, z] = size.map((v) => v / 2); const P = []; const N = []; const I = [];
  const faces = [[[1, 0, 0], [[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]]], [[-1, 0, 0], [[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]]],
    [[0, 1, 0], [[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]]], [[0, -1, 0], [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]]],
    [[0, 0, 1], [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]]], [[0, 0, -1], [[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]]]];
  faces.forEach(([n, vs], f) => { for (const v of vs) { P.push(...v); N.push(...n); } const b = f * 4; I.push(b, b + 1, b + 2, b, b + 2, b + 3); });
  const pos = Buffer.from(new Float32Array(P).buffer); const nor = Buffer.from(new Float32Array(N).buffer); const idx = Buffer.from(new Uint16Array(I).buffer);
  const bin = Buffer.concat([pos, nor, idx, Buffer.alloc((4 - (idx.length % 4)) % 4)]);
  const json = {
    asset: { version: '2.0', generator: 'es-render test' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0.3, roughnessFactor: 0.4 } }],
    buffers: [uri ? { byteLength: bin.length, uri } : { byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length, target: 34962 }, { buffer: 0, byteOffset: pos.length, byteLength: nor.length, target: 34962 },
      { buffer: 0, byteOffset: pos.length + nor.length, byteLength: idx.length, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-x, -y, -z], max: [x, y, z] }, { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 36, type: 'SCALAR' }],
    ...(ext ? { extensionsUsed: [ext], extensionsRequired: [ext] } : {}),
  };
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const chunks = uri ? [[0x4E4F534A, js]] : [[0x4E4F534A, js], [0x004E4942, bin]];
  const total = 12 + chunks.reduce((s, [, b]) => s + 8 + b.length, 0);
  const head = Buffer.alloc(12); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  return Buffer.concat([head, ...chunks.flatMap(([t, b]) => { const h = Buffer.alloc(8); h.writeUInt32LE(b.length, 0); h.writeUInt32LE(t, 4); return [h, b]; })]);
}

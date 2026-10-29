// Sinh bản DÁN cho n8n (copy tất cả → bấm vào canvas → Ctrl+V): node n8n/es2/build.mjs → n8n/es2/es2-standard-nodes.json (commit cùng nguồn;
// npm run test:spec báo lỗi nếu file đã commit cũ hơn nguồn). Node Code = spec/core.cjs (nguyên văn, bỏ dòng module.exports) + node1/node2.
// Credential để trống (chọn sau khi dán). Muốn áp thẳng lên workflow đang chạy: build-ops.mjs (sinh thao tác update_workflow, không tự gọi n8n).
import fs from 'node:fs';
import path from 'node:path';
import { DIR, ROOT, ESC, standardNodes } from './nodes.mjs';

const { nodes, connections } = standardNodes();
const outFile = path.join(DIR, 'es2-standard-nodes.json');
fs.writeFileSync(outFile, JSON.stringify({ nodes, connections, pinData: {}, meta: { templateCredsSetupCompleted: false, generator: 'es-render/n8n/es2/build.mjs', core: ESC.CORE, spec: ESC.VERSION } }, null, 1) + '\n');
console.log('wrote', path.relative(ROOT, outFile), nodes.length, 'nodes,', fs.statSync(outFile).size, 'bytes; jsCode', nodes.filter((n) => n.parameters.jsCode).map((n) => n.name + ' ' + n.parameters.jsCode.length).join(', '));

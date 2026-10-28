# es3d — mã nguồn của `vendor/es3d.min.js`

Bundle IIFE (`window.ES3D = { mount, version, presets, three, versions }`) cho phần tử `3d` của es-render (`el3d.mjs`, `els.mjs`).

- `src/index.jsx` — `mount(canvas, spec, { bytes })` → `{ ready, seek(t) }`: `createRoot` của @react-three/fiber với `frameloop: "never"`, `dpr: 1`;
  `seek(t)` = vật lý bước 1/60 s tới `floor(t·60)` (`useRapier().step`), tư thế thuần theo `t` (`usePose`), `advance(t)` vẽ đồng bộ.
  Tua lùi khi có vật lý: đổi `key` của cây `<Physics>` → React dựng lại → chạy lại từ bước 0 (trả promise; es-render đẩy vào `ES.busy`).
- `src/presets.jsx` — `product-hero`, `logo-spin`. `src/util.js` — `mulberry32`, `usePose`, `useBeforeStep`.
- `build.mjs` — esbuild (IIFE, minify, `legalComments: "eof"`), thay `n8ao` / `maath` (react-postprocessing nạp sẵn, es3d không dùng) bằng module rỗng,
  ghi `vendor/es3d/VERSIONS.json` (gói thật sự có byte trong bundle + phiên bản + giấy phép + sha256) và `vendor/es3d/THIRD_PARTY_LICENSES.txt`
  (văn bản đầy đủ; gói npm thiếu file LICENSE lấy từ `licenses/`: react-three-fiber @ d74622e, react-three-rapier @ ae5c3fe — MIT © Poimandres;
  rapier3d-compat — Apache-2.0, văn bản chuẩn). Gói có trong bundle mà không có văn bản giấy phép → dừng (`E_LICENSE`).

```sh
cd vendor-src/es3d
npm ci --ignore-scripts   # không gói nào cần postinstall (esbuild lấy binary từ optionalDependencies @esbuild/linux-x64)
npm run build             # ghi ../../vendor/es3d.min.js + ../../vendor/es3d/*
npm run check             # dựng lại, so sha256 với bản đã commit
```

Các gói dựng chỉ nằm ở `package.json` / `package-lock.json` của thư mục này (không ở gốc es-render): CI chỉ dùng bundle đã commit.
Chỉ dựng lại khi nâng phiên bản hoặc sửa preset (mỗi lần thêm ~3 MB vào lịch sử git).

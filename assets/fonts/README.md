# assets/fonts — font kèm repo (SIL Open Font License 1.1)

| File | Họ font | Giấy phép |
|---|---|---|
| InterTight-700/800/900.ttf | Inter Tight (rsms/inter-tight) | OFL-InterTight.txt |
| InstrumentSerif-Italic.ttf | Instrument Serif (Instrument/instrument-serif) | OFL-InstrumentSerif.txt |
| JetBrainsMono-500.ttf | JetBrains Mono (JetBrains/JetBrainsMono) | OFL-JetBrainsMono.txt |

Dùng ở đâu:
- Trang của job CreativeSpec (`spec/layouts.mjs`) nạp thẳng các file này qua `@font-face file://` → khung hình không phụ thuộc mạng.
- `render.mjs` (phụ đề libass) chỉ dùng chúng làm **phương án cuối**: khi cả Google Fonts lẫn kho google/fonts đều không tải được.
  Job cũ có mạng vẫn dùng đúng file font như trước (không đổi số đo chữ, không đổi chỗ xuống dòng).

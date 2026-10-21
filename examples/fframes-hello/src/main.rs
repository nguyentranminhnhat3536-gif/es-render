use fframes::{EncoderOptions, RenderOptions, StaticMediaProvider, cli};
use fframes_hello::{FframesHelloMedia, FframesHelloVideo};
use fframes_skia_renderer::{SkiaPipelineConcurrencyPolicy, SkiaPipelineConfig, cli::SkiaRenderers};
use std::process::ExitCode;

// Dòng lệnh chuẩn của fframes (render, frame, strip, inspect, audio, preview…): `cargo run --release -- --help`.
// Khác bản mẫu `cargo fframes new`: GPU (Vulkan) chỉ mở khi cần nên máy không có GPU vẫn dựng được bằng
// `--renderer skia-cpu` hoặc `--renderer cpu` thay vì dừng ở "GPU context".
fn main() -> ExitCode {
    let media = FframesHelloMedia::prepare().expect("media");
    let video = FframesHelloVideo::new(&media);

    cli::new(
        &video,
        RenderOptions {
            media: Some(&media),
            video_encoder_options: EncoderOptions {
                preferred_encoder: Some("libx264"),
                codec_params: Some(&[("crf", "20"), ("preset", "medium"), ("tune", "animation")]),
                // BT.709 như video HD (mặc định BT.601 làm qa.mjs cảnh báo lệch màu trên điện thoại)
                color_matrix: fframes::pix_fmt::YuvMatrix::Bt709,
                ..Default::default()
            },
            ..Default::default()
        },
    )
    // mặc định Skia trên GPU (Vulkan; trên CI là lavapipe chạy bằng CPU)
    .renderers(SkiaRenderers::gpu(SkiaPipelineConfig {
        concurrency_policy: SkiaPipelineConcurrencyPolicy::MaxPerformance,
        ..Default::default()
    }))
    // `preview` mở cửa sổ xem trực tiếp có tiếng
    .preview(fframes_native_player::cli_preview)
    .run()
}

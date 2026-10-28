//! fframes-hello (ETHAN STUDIO): một khung 9:16 tự vẽ, đổi dạng sang 16:9 khi nút chọn trượt qua,
//! rồi "Dọc hay ngang, bạn chọn." — một cảnh 5,5 s.
//!
//! Mọi mốc hình và tiếng lấy từ các hằng `T_*` theo nhịp 120 BPM (0,5 s một phách) nên hình khớp tiếng.
//! Khổ video: mặc định dọc 1080×1920; `--features landscape` → ngang 1920×1080, bố cục tự đổi theo WIDTH/HEIGHT.
//! Âm thanh trong `media/` sinh bằng `node tools/sounds.mjs`; font Be Vietnam Pro (OFL, có dấu tiếng Việt).
use fframes::{
    AudioMap, AudioTimestamp::*, AudioTrack, Color, Duration, FFramesContext, FontQuery, Frame,
    Svgr, Transform, Video,
    animation::{Easing, KeyFramesAnimation},
    include_media_dir,
};
use std::f32::consts::{PI, TAU};
use std::sync::OnceLock;

// Mọi file trong media/ được nhúng vào binary; font gọi theo tên họ.
include_media_dir!(pub struct FframesHelloMedia, "media");

/// Bật bằng `--features landscape` (ff.mjs: FF_FORMAT=landscape).
pub const LANDSCAPE: bool = cfg!(feature = "landscape");
pub const WIDTH: usize = if LANDSCAPE { 1920 } else { 1080 };
pub const HEIGHT: usize = if LANDSCAPE { 1080 } else { 1920 };
const W: f32 = WIDTH as f32;
const H: f32 = HEIGHT as f32;

const FONT: &str = "Be Vietnam Pro";
// bảng màu ES Neon của ETHAN STUDIO
const BG: &str = "#0B0510";
const PANEL: &str = "#160B1E";
const LINE: &str = "#2C1A36";
const INK: &str = "#FFFFFF";
const MUTED: &str = "#A08FAA";
const ACCENT: &str = "#FF4FA3";

const BEAT: f32 = 0.5;
const T_RATIO: f32 = BEAT; // "9:16" đáp
const T_CTRL: f32 = 2. * BEAT; // nút chọn hiện
const T_MORPH: f32 = 3. * BEAT; // bấm 16:9, khung đổi dạng
const MORPH: f32 = 0.7;
const T_RATIO2: f32 = 4. * BEAT; // "16:9" đáp
const T_HEAD: f32 = 5. * BEAT; // dòng chữ
const T_MARK: f32 = 7. * BEAT; // ETHAN STUDIO
const T_END: f32 = 11. * BEAT;

const SOFT: Easing = Easing::Spring { mass: 1.0, stiffness: 170.0, damping: 19.0 };
const SNAPPY: Easing = Easing::Spring { mass: 1.0, stiffness: 300.0, damping: 26.0 };

const HEADLINE: [&str; 2] = ["Dọc hay ngang,", "bạn chọn."];
/// Từ cuối tô màu nhấn.
const ACCENT_WORD: &str = "chọn.";
const MARK: &str = "ETHAN STUDIO";
const MARK_SIZE: f32 = 30.;
const MARK_SPACING: f32 = 8.;
const CAPTION: f32 = 28.;

/// Vị trí theo khổ: dọc xếp chồng giữa màn, ngang chia hai cột (khung bên trái, chữ bên phải).
struct Layout {
    cx: f32,
    cy: f32,
    port: (f32, f32),
    land: (f32, f32),
    ctrl: (f32, f32),
    ctrl_w: f32,
    text_x: f32,
    center: bool,
    head_y: f32,
    head_size: f32,
    head_max: f32,
    mark_y: f32,
}

fn layout() -> Layout {
    if LANDSCAPE {
        let (ph, lw, text_x, ctrl_w) = (0.70 * H, 0.40 * W, 0.56 * W, 520.);
        Layout { cx: 0.30 * W, cy: 0.5 * H, port: (ph * 9. / 16., ph), land: (lw, lw * 9. / 16.), ctrl: (text_x + ctrl_w / 2., 0.30 * H), ctrl_w, text_x, center: false, head_y: 0.53 * H, head_size: 92., head_max: 0.92 * W - text_x, mark_y: 0.80 * H }
    } else {
        // nội dung trong y 12–78% vì giao diện nền tảng che trên/dưới
        let (ph, lw) = (0.34 * H, 0.80 * W);
        Layout { cx: 0.5 * W, cy: 0.32 * H, port: (ph * 9. / 16., ph), land: (lw, lw * 9. / 16.), ctrl: (0.5 * W, 0.56 * H), ctrl_w: 0.48 * W, text_x: 0.5 * W, center: true, head_y: 0.67 * H, head_size: 96., head_max: 0.84 * W, mark_y: 0.78 * H }
    }
}

/// Cỡ chữ và vị trí đo bằng font thật, một lần.
#[derive(Clone)]
struct Measured {
    ratio: f32,
    head: f32,
    line_w: [f32; 2],
    /// (dòng, x trong dòng) của từng từ
    words: Vec<(usize, f32)>,
    mark_w: f32,
    digit_w: f32,
}

type Anim = KeyFramesAnimation<f32>;

/// Timeline dựng một lần; vài cái có mốc theo dữ liệu (từng từ) nên không để svgr! tự gom.
struct Motion {
    draw: Anim,
    panel: Anim,
    marks: Vec<(Anim, Anim)>,
    morph: Anim,
    guide: Anim,
    r1_y: Anim,
    r1_o: Anim,
    r2_y: Anim,
    r2_o: Anim,
    caps: Anim,
    res1: Anim,
    res2: Anim,
    ctrl_y: Anim,
    ctrl_o: Anim,
    pill: Anim,
    words: Vec<(Anim, Anim)>,
    bar: Anim,
    wipe: Anim,
}

fn motion(word_count: usize) -> Motion {
    // từ trên dòng 2 vào sau một nhịp nhỏ để mắt đọc hết dòng 1
    let word_start = |k: usize| T_HEAD + k as f32 * 0.07 + if k >= 3 { 0.18 } else { 0. };
    Motion {
        // khung đầu đã có 18% viền: video mạng xã hội không được mở bằng màn trống
        draw: fframes::timeline!(at 0.0 => 0.75, animate 0.18_f32 => 1.0, Easing::EaseOut),
        panel: fframes::timeline!(at 0.1 => 0.7, animate 0.0_f32 => 1.0, Easing::EaseOut),
        marks: (0..4)
            .map(|i| {
                let s = 0.1 + i as f32 * 0.1;
                (fframes::timeline!(at s, animate 34.0_f32 => 0.0, SNAPPY), fframes::timeline!(at s => s + 0.25, animate 0.0_f32 => 1.0, Easing::EaseOut))
            })
            .collect(),
        morph: fframes::timeline!(at T_MORPH => T_MORPH + MORPH, animate 0.0_f32 => 1.0, Easing::EaseInOut),
        // dấu góc theo khung trễ 60 ms (cùng đường cong để không giật): hai vật phản ứng với nhau
        guide: fframes::timeline!(at T_MORPH + 0.06 => T_MORPH + MORPH + 0.12, animate 0.0_f32 => 1.0, Easing::EaseInOut),
        r1_y: fframes::timeline!(at T_RATIO, animate 70.0_f32 => 0.0, SOFT, at T_MORPH - 0.05 => T_MORPH + 0.2, animate 0.0_f32 => -60.0, Easing::EaseIn),
        r1_o: fframes::timeline!(at T_RATIO => T_RATIO + 0.3, animate 0.0_f32 => 1.0, Easing::EaseOut, at T_MORPH - 0.05 => T_MORPH + 0.2, animate 1.0_f32 => 0.0, Easing::EaseIn),
        r2_y: fframes::timeline!(at T_RATIO2, animate 70.0_f32 => 0.0, SOFT),
        r2_o: fframes::timeline!(at T_RATIO2 => T_RATIO2 + 0.3, animate 0.0_f32 => 1.0, Easing::EaseOut),
        caps: fframes::timeline!(at 0.6 => 0.9, animate 0.0_f32 => 1.0, Easing::EaseOut),
        res1: fframes::timeline!(at T_MORPH => T_MORPH + 0.2, animate 1.0_f32 => 0.0, Easing::EaseIn),
        res2: fframes::timeline!(at T_MORPH + 0.5 => T_MORPH + 0.8, animate 0.0_f32 => 1.0, Easing::EaseOut),
        ctrl_y: fframes::timeline!(at T_CTRL, animate 48.0_f32 => 0.0, SOFT),
        ctrl_o: fframes::timeline!(at T_CTRL => T_CTRL + 0.3, animate 0.0_f32 => 1.0, Easing::EaseOut),
        pill: fframes::timeline!(at T_MORPH, animate 0.0_f32 => 1.0, SNAPPY),
        words: (0..word_count)
            .map(|k| {
                let s = word_start(k);
                (fframes::timeline!(at s, animate 56.0_f32 => 0.0, SOFT), fframes::timeline!(at s => s + 0.28, animate 0.0_f32 => 1.0, Easing::EaseOut))
            })
            .collect(),
        bar: fframes::timeline!(at T_MARK => T_MARK + 0.35, animate 0.5_f32 => 40.0, Easing::EaseOut),
        wipe: fframes::timeline!(at T_MARK + 0.12 => T_MARK + 0.75, animate 0.0_f32 => 1.0, Easing::EaseOut),
    }
}

fn lerp(a: f32, b: f32, k: f32) -> f32 {
    a + (b - a) * k
}

pub struct FframesHelloVideo<'a> {
    pub media: &'a FframesHelloMedia,
    layout: Layout,
    motion: Motion,
    /// (dòng, từ, mọi chữ trước nó kể cả từ đó) để đo vị trí từng từ
    words: Vec<(usize, &'static str, String)>,
    measured: OnceLock<Measured>,
}

impl<'a> FframesHelloVideo<'a> {
    pub fn new(media: &'a FframesHelloMedia) -> Self {
        let words: Vec<(usize, &'static str, String)> = HEADLINE
            .iter()
            .enumerate()
            .flat_map(|(line, text)| {
                let parts: Vec<&'static str> = text.split(' ').collect();
                (0..parts.len()).map(move |k| (line, parts[k], parts[..=k].join(" "))).collect::<Vec<_>>()
            })
            .collect();
        Self { media, layout: layout(), motion: motion(words.len()), words, measured: OnceLock::new() }
    }

    fn try_measure<'b>(&'b self, frame: &mut Frame, ctx: &FFramesContext<'b, '_>) -> Option<Measured> {
        let q = |size: f32, weight: u16| FontQuery { family: FONT, size: size as usize, weight, ..Default::default() };
        // số tỉ lệ vừa 74% bề ngang khung dọc
        let r = frame.text_width(ctx, q(170., 800), "16:9")? as f32;
        let ratio = (170. * 0.74 * self.layout.port.0 / r).min(170.).floor();
        // tiêu đề thu nhỏ dần tới khi dòng dài nhất vừa cột chữ
        let mut head = self.layout.head_size;
        let line_w = loop {
            let a = frame.text_width(ctx, q(head, 800), HEADLINE[0])? as f32;
            let b = frame.text_width(ctx, q(head, 800), HEADLINE[1])? as f32;
            if a.max(b) <= self.layout.head_max || head <= 48. {
                break [a, b];
            }
            head -= 2.;
        };
        let mut words = Vec::with_capacity(self.words.len());
        for (line, word, upto) in &self.words {
            let x = frame.text_width(ctx, q(head, 800), upto.as_str())? as f32 - frame.text_width(ctx, q(head, 800), word)? as f32;
            words.push((*line, x));
        }
        let mark_w = frame.text_width(ctx, q(MARK_SIZE, 600), MARK)? as f32 + MARK_SPACING * (MARK.chars().count() - 1) as f32;
        let digit_w = frame.text_width(ctx, q(CAPTION, 500), "0")? as f32;
        Some(Measured { ratio, head, line_w, words, mark_w, digit_w })
    }

    fn measure<'b>(&'b self, frame: &mut Frame, ctx: &FFramesContext<'b, '_>) -> Measured {
        if let Some(m) = self.measured.get() {
            return m.clone();
        }
        match self.try_measure(frame, ctx) {
            Some(m) => self.measured.get_or_init(|| m).clone(),
            // font chưa nạp (trình sửa web): ước lượng, không nhớ lại
            None => Measured { ratio: 150., head: self.layout.head_size, line_w: [0.55 * 96. * 14., 0.55 * 96. * 9.], words: self.words.iter().map(|(l, _, upto)| (*l, 0.55 * 96. * (upto.chars().count() as f32 - 3.))).collect(), mark_w: 300., digit_w: 17. },
        }
    }
}

impl std::fmt::Debug for FframesHelloVideo<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FframesHelloVideo").field("width", &WIDTH).field("height", &HEIGHT).finish()
    }
}

impl Video for FframesHelloVideo<'_> {
    const FPS: usize = 30;
    const WIDTH: usize = WIDTH;
    const HEIGHT: usize = HEIGHT;
    const BACKGROUND_COLOR: Color = Color::hex("#0B0510");

    fn duration(&self) -> Duration<'_> {
        Duration::Seconds(T_END)
    }

    fn audio(&self) -> AudioMap<'_> {
        // tiếng đặt từ cùng hằng với hình: bụp khi số đáp, gió giữa lúc đổi khung, tách khi bấm, chuông cho chữ ký
        AudioMap::from([
            AudioTrack::new("bed.wav", Second(0.)..Eof).gain_db(-2.),
            AudioTrack::new("pop.wav", Second(T_RATIO)..Eof).gain_db(-10.),
            AudioTrack::new("whoosh.wav", Second(T_MORPH - 0.25)..Eof).gain_db(-11.),
            AudioTrack::new("tick.wav", Second(T_MORPH)..Eof).gain_db(-13.),
            AudioTrack::new("pop.wav", Second(T_RATIO2)..Eof).gain_db(-10.),
            AudioTrack::new("chime.wav", Second(T_MARK)..Eof).gain_db(-16.),
        ])
    }

    fn render_frame<'a>(&'a self, mut frame: Frame, ctx: &FFramesContext<'a, '_>) -> Svgr<'a> {
        let m = self.measure(&mut frame, ctx);
        let (l, mo, t) = (&self.layout, &self.motion, frame.seconds());

        // khung: kích thước nội suy 9:16 → 16:9
        let k = frame.animate(&mo.morph);
        let (w, h) = (lerp(l.port.0, l.land.0, k), lerp(l.port.1, l.land.1, k));
        let (x0, y0, r) = (l.cx - w / 2., l.cy - h / 2., 22.);
        let per = 2. * (w + h) - 8. * r + TAU * r;
        let draw = frame.animate(&mo.draw);
        let dash = if draw < 0.999 { format!("{per:.1} {per:.1}") } else { "none".to_owned() };
        // viền nảy nhẹ theo trống từ lúc nút hiện, chỉ nét viền — không giật cả khung
        let kick = if (T_CTRL..T_END - BEAT).contains(&t) { (-(t % BEAT) * 12.).exp() } else { 0. };
        let stroke_w = 5. + 2.5 * kick;

        // dấu góc: theo sau khung khi đổi khổ, thở ±3 px khi giữ
        let kl = frame.animate(&mo.guide);
        let (mw, mh) = (lerp(l.port.0, l.land.0, kl), lerp(l.port.1, l.land.1, kl));
        let caps = frame.animate(&mo.caps);
        let breathe = 3. * (TAU * t / 2.).sin() * caps;
        let marks: Vec<Svgr> = [(-1., -1.), (1., -1.), (1., 1.), (-1., 1.)]
            .iter()
            .zip(&mo.marks)
            .map(|(&(sx, sy), (slide, show))| {
                let g = 24. + frame.animate(slide) + breathe;
                let (px, py) = (l.cx + sx * (mw / 2. + g), l.cy + sy * (mh / 2. + g));
                let d = format!("M{:.1} {:.1}L{px:.1} {py:.1}L{:.1} {py:.1}", px, py - sy * 46., px - sx * 46.);
                fframes::svgr!(<path d={d} fill="none" stroke={INK} stroke-width="4" stroke-linecap="square" opacity={frame.animate(show)} />)
            })
            .collect();

        // số tỉ lệ trong khung (đường chuẩn dời xuống 0,35 cỡ chữ cho cân giữa)
        let ry = l.cy + m.ratio * 0.35;
        let (r1y, r1o, r2y, r2o) = (frame.animate(&mo.r1_y), frame.animate(&mo.r1_o), frame.animate(&mo.r2_y), frame.animate(&mo.r2_o));

        // chú thích góc khung: độ phân giải và số khung (mỗi chữ số một ô cố định cho khỏi rung)
        let (res1, res2) = (frame.animate(&mo.res1), frame.animate(&mo.res2));
        let digits: Vec<Svgr> = format!("{:03}", frame.index)
            .chars()
            .enumerate()
            .map(|(j, c)| {
                let x = x0 + w - 26. - (2.5 - j as f32) * m.digit_w * 1.05;
                fframes::svgr!(<text x={x} y={y0 + h - 26.} font-family={FONT} font-size={CAPTION} font-weight="500" fill={MUTED} text-anchor="middle">{c.to_string()}</text>)
            })
            .collect();

        // nút chọn 9:16 | 16:9: viên chọn trượt (dãn ra giữa đường), chữ đổi màu đúng chỗ viên đè qua
        let (ccx, ccy, cw, ch) = (l.ctrl.0, l.ctrl.1, l.ctrl_w, 96.);
        let (cx0, cy0) = (ccx - cw / 2., ccy - ch / 2.);
        let p = frame.animate(&mo.pill);
        let pw = cw / 2. - 8.;
        let stretch = (PI * p.clamp(0., 1.)).sin() * 0.28 * pw;
        let pill_x = cx0 + 8. + p * (cw / 2. - 8.) - stretch / 2.;
        let (lx1, lx2, ly) = (cx0 + cw / 4., cx0 + cw * 0.75, ccy + 14.);

        // tiêu đề từng từ
        let words: Vec<Svgr> = self
            .words
            .iter()
            .zip(&m.words)
            .zip(&mo.words)
            .map(|(((line, word, _), &(_, wx)), (rise, show))| {
                let lw = m.line_w[*line];
                let x = if l.center { l.text_x - lw / 2. } else { l.text_x } + wx;
                let y = l.head_y + *line as f32 * m.head * 1.12;
                let fill = if *word == ACCENT_WORD { ACCENT } else { INK };
                fframes::svgr!(
                    <g transform={Transform::translate(0, frame.animate(rise))} opacity={frame.animate(show)}>
                        <text x={x} y={y} font-family={FONT} font-size={m.head} font-weight="800" letter-spacing="-2" fill={fill}>{*word}</text>
                    </g>
                )
            })
            .collect();

        // chữ ký: vạch nhấn mọc ra rồi chữ hiện dần từ trái (mặt nạ quét, mép mềm 70 px cho chữ không bị cắt ngang)
        let mark_total = 40. + 18. + m.mark_w;
        let mx = if l.center { l.text_x - mark_total / 2. } else { l.text_x };
        let edge = mx + 54. + frame.animate(&mo.wipe) * (m.mark_w + 90.);

        // quầng sáng trôi chậm cho cảnh không bao giờ đứng hẳn
        let unit = W.min(H);
        let (gx, gy) = (l.cx + 0.12 * unit * (TAU * t / 11.).sin(), l.cy - 0.06 * H * (TAU * t / 9.).cos());

        fframes::svgr!(
            <svg xmlns="http://www.w3.org/2000/svg" viewBox={format!("0 0 {WIDTH} {HEIGHT}")} width={WIDTH} height={HEIGHT}>
                <defs>
                    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0" stop-color="#FF4FA3" stop-opacity="0.30" />
                        <stop offset="1" stop-color="#FF4FA3" stop-opacity="0" />
                    </radialGradient>
                    <clipPath id="pill">
                        <rect x={pill_x} y={cy0 + 8.} width={pw + stretch} height={ch - 16.} rx={(ch - 16.) / 2.} />
                    </clipPath>
                    <linearGradient id="wipeg" gradientUnits="userSpaceOnUse" x1={edge - 70.} y1="0" x2={edge} y2="0">
                        <stop offset="0" stop-color="#FFFFFF" />
                        <stop offset="1" stop-color="#FFFFFF" stop-opacity="0" />
                    </linearGradient>
                    <mask id="wipe">
                        <rect x={mx + 54.} y={l.mark_y - 36.} width={(edge - mx - 54.).max(0.5)} height="50" fill="url(#wipeg)" />
                    </mask>
                </defs>
                <rect width={WIDTH} height={HEIGHT} fill={BG} />
                <circle cx={gx} cy={gy} r={0.62 * unit} fill="url(#glow)" />

                <rect x={x0} y={y0} width={w} height={h} rx={r} fill={PANEL} opacity={frame.animate(&mo.panel)} />
                <rect x={x0} y={y0} width={w} height={h} rx={r} fill="none" stroke={ACCENT} stroke-width={stroke_w} stroke-dasharray={dash} stroke-dashoffset={per * (1. - draw)} />
                {marks}

                <text x={l.cx} y={ry + r1y} font-family={FONT} font-size={m.ratio} font-weight="800" letter-spacing="-4" fill={INK} text-anchor="middle" opacity={r1o}>"9:16"</text>
                <text x={l.cx} y={ry + r2y} font-family={FONT} font-size={m.ratio} font-weight="800" letter-spacing="-4" fill={INK} text-anchor="middle" opacity={r2o}>"16:9"</text>

                <g opacity={caps * 0.75}>
                    <text x={x0 + 26.} y={y0 + 48.} font-family={FONT} font-size={CAPTION} font-weight="500" letter-spacing="1" fill={MUTED} opacity={res1}>"1080 × 1920"</text>
                    <text x={x0 + 26.} y={y0 + 48.} font-family={FONT} font-size={CAPTION} font-weight="500" letter-spacing="1" fill={MUTED} opacity={res2}>"1920 × 1080"</text>
                    {digits}
                </g>

                <g transform={Transform::translate(0, frame.animate(&mo.ctrl_y))} opacity={frame.animate(&mo.ctrl_o)}>
                    <rect x={cx0} y={cy0} width={cw} height={ch} rx={ch / 2.} fill={PANEL} stroke={LINE} stroke-width="2" />
                    <text x={lx1} y={ly} font-family={FONT} font-size="40" font-weight="600" fill={MUTED} text-anchor="middle">"9:16"</text>
                    <text x={lx2} y={ly} font-family={FONT} font-size="40" font-weight="600" fill={MUTED} text-anchor="middle">"16:9"</text>
                    <rect x={pill_x} y={cy0 + 8.} width={pw + stretch} height={ch - 16.} rx={(ch - 16.) / 2.} fill={ACCENT} />
                    <g clip-path="url(#pill)">
                        <text x={lx1} y={ly} font-family={FONT} font-size="40" font-weight="600" fill={BG} text-anchor="middle">"9:16"</text>
                        <text x={lx2} y={ly} font-family={FONT} font-size="40" font-weight="600" fill={BG} text-anchor="middle">"16:9"</text>
                    </g>
                </g>

                {words}

                <rect x={mx} y={l.mark_y - 13.} width={frame.animate(&mo.bar)} height="4" rx="2" fill={ACCENT} />
                <g mask="url(#wipe)">
                    <text x={mx + 58.} y={l.mark_y} font-family={FONT} font-size={MARK_SIZE} font-weight="600" letter-spacing={MARK_SPACING} fill={INK} opacity="0.85">{MARK}</text>
                </g>
            </svg>
        )
    }
}

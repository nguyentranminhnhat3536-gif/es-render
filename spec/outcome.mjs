// es-render spec/outcome.mjs — the ONE place that turns a spec-job result into what n8n does next. n8n "Render xong?" only reads `outcome`:
//   post   → ✅ safe to publish         review → 👀 rendered but a human decides (standard / QA / brand rule)
//   retry  → 🔁 CI rejected the spec after measuring the real voice; the AI gets one more try (only while attempt < max_attempts)
//   fail   → ❌ nothing publishable (infrastructure error, rejected on the last attempt)
// Pure function, no I/O → unit-tested; spec/run.mjs and the render.yml fallback both use it.
export const POST_MIN_SCORE = 7; // QA score (10 − 4·errors − warnings) below this is never auto-posted
const VI = { S1: 'độ dài ngoài 30–60s', S2: 'hook nói xong sau 3s', S3: 'giọng vào chậm', S4: 'khung đầu trống/ít chữ', S4b: 'tiêu đề hook không đọc được ở khung đầu', S5: 'đầu video đứng yên', S6: 'cảnh đầu quá dài', S7: 'có đoạn hình đứng yên', S8: 'thiếu ảnh bìa', S13: 'bìa khác khung hook' };

export function outcome(res, { attempt = 1, max_attempts = 3, review = false, minScore = POST_MIN_SCORE } = {}) {
  const title = (res.spec && res.spec.title) || res.title || res.id || '';
  const dur = Number(res.duration) ? Math.round(res.duration) + 's' : '';
  if (res.status === 'rejected') {
    const last = attempt >= max_attempts;
    return { outcome: last ? 'fail' : 'retry', publishable: false,
      summary_vi: (last ? '❌ CI từ chối kịch bản lần cuối (' + attempt + '/' + max_attempts + ')' : '🔁 CI từ chối kịch bản (lần ' + attempt + '/' + max_attempts + ') — AI sẽ viết lại') + ' · ' + (res.errors || []).slice(0, 2).map((e) => e.vi || e.msg || e.code).join('; ') };
  }
  if (res.status !== 'done') return { outcome: 'fail', publishable: false, summary_vi: '❌ Chưa dựng được · ' + String(res.message || 'lỗi không rõ').slice(0, 200) };
  const qa = res.qa || {}; const std = res.standard || {}; const fails = (std.checks || []).filter((c) => !c.ok && c.level === 'error').map((c) => c.id);
  const issues = [...fails.map((id) => VI[id] || id), ...((qa.issues || []).filter((i) => i.level === 'error').map((i) => i.msg))];
  const ok = qa.pass !== false && std.pass !== false && (qa.score == null || qa.score >= minScore) && !review;
  const head = '"' + title + '" · ' + dur + (res.hook && res.hook.voice_end != null ? ' · hook ' + res.hook.voice_end + 's' : '') + (qa.score != null ? ' · QA ' + qa.score + '/10' : '');
  if (ok) return { outcome: 'post', publishable: true, summary_vi: '✅ Video ES·2 sẵn sàng · ' + head };
  const why = review ? ['vi phạm luật giọng thương hiệu (xem cảnh báo)'] : issues.length ? issues : (qa.score != null && qa.score < minScore ? ['điểm QA thấp (cần ≥ ' + minScore + ')'] : ['cần xem lại']);
  return { outcome: 'review', publishable: false, summary_vi: '👀 Cần duyệt · ' + head + ' · ' + why.slice(0, 3).join('; ') };
}

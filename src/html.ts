/**
 * Shared page layout for the few web pages this server shows
 * (setup checklist, consent page, sign-in errors).
 */

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A complete HTML page. `body` must already be escaped where needed. */
export function htmlPage(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,Arial,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#2F3A42;line-height:1.55;background:#fff}
  h1{font-size:1.45rem;margin-bottom:.4rem} h2{font-size:1.1rem;margin-top:2rem}
  button{font:inherit;padding:.55rem 1.05rem;border-radius:6px;border:0;background:#2F3A42;color:#fff;cursor:pointer;margin-right:.5rem}
  button.secondary{background:#e5e7eb;color:#2F3A42}
  .check{display:flex;gap:.7rem;padding:.7rem 0;border-bottom:1px solid #eceff1}
  .mark{font-weight:700;width:1.3rem;flex:none} .ok{color:#15803d} .bad{color:#b91c1c} .info{color:#6b7280}
  .copy{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;background:#f4f6f8;border-radius:6px;padding:.6rem .8rem;margin:.5rem 0}
  .copy code{word-break:break-all;flex:1;min-width:12rem}
  .copy button{padding:.35rem .8rem;font-size:.9rem}
  .banner{border-radius:8px;padding:1rem 1.2rem;margin:1rem 0}
  .banner.ok{background:#ecfdf3;color:#14532d} .banner.bad{background:#fff7ed;color:#7c2d12}
  table{border-collapse:collapse;width:100%;font-size:.93rem} td,th{text-align:left;padding:.45rem .4rem;border-bottom:1px solid #eceff1;vertical-align:top}
  code{font-family:ui-monospace,Menlo,monospace;font-size:.92em}
  small{color:#6b7280}
</style></head><body>${body}
<script>
  // Copy buttons: copy the text of the <code> next to the button.
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      navigator.clipboard.writeText(b.getAttribute('data-copy')).then(function () {
        b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      });
    });
  });
</script></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Frame-Options": "DENY", "Cache-Control": "no-store" },
  });
}

/** A value with a Copy button beside it. */
export function copyBox(value: string): string {
  const v = escapeHtml(value);
  return `<div class="copy"><code>${v}</code><button type="button" data-copy="${v}">Copy</button></div>`;
}

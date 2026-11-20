import { getReport, isValidId } from '@server/store'

export const dynamic = 'force-dynamic'

/**
 * GET /share/report/:id — shareable bridge for the audit report.
 *
 * Social crawlers (WhatsApp, Telegram, Facebook) don't run JavaScript, so the SPA's
 * client-side meta tags never reach them. This route answers with a server-rendered
 * HTML stub carrying the report's Open Graph tags and immediately redirects people
 * to the SPA page (/seo/audit?report=<id>). It only reads the JSON store: no outbound
 * fetches, no rate-limit involvement.
 */

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case '&':
				return '&amp;'
			case '<':
				return '&lt;'
			case '>':
				return '&gt;'
			case '"':
				return '&quot;'
			default:
				return '&#39;'
		}
	})
}

/** The SPA locale prefix for the person following the link: ru → /ru, hy → /hy, en → none. */
function localePrefix(acceptLanguage: string | null): string {
	const first = (acceptLanguage ?? '').split(',')[0]?.trim().toLowerCase() ?? ''
	if (first.startsWith('ru')) return '/ru'
	if (first.startsWith('hy')) return '/hy'

	return ''
}

/** The public origin, even when the app sits behind a proxy. */
function originOf(request: Request): string {
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
	if (!host) return new URL(request.url).origin
	const local = host.startsWith('localhost') || host.startsWith('127.')
	const proto = request.headers.get('x-forwarded-proto') ?? (local ? 'http' : 'https')

	return `${proto}://${host}`
}

export async function GET(
	request: Request,
	context: RouteContext<'/share/report/[id]'>
): Promise<Response> {
	const { id } = await context.params
	if (!isValidId(id)) return new Response('Report not found.', { status: 404 })
	const report = await getReport(id)
	if (!report) return new Response('Report not found.', { status: 404 })

	const origin = originOf(request)
	const target = `${origin}${localePrefix(request.headers.get('accept-language'))}/seo/audit?report=${encodeURIComponent(id)}`
	const title = `SEO report: ${report.domain} — grade ${report.grade} (${report.score}/100)`
	const checkedAt = new Date(report.createdAt).toISOString().slice(0, 10)
	const issues = report.checks.filter(
		(check) => check.status === 'fail' || check.status === 'warn'
	).length
	const description = `Checked ${checkedAt}. ${issues} ${issues === 1 ? 'issue' : 'issues'} to fix. Free website SEO audit by ProLeadly.`
	const ogImage = `${origin}/og-image.png`
	const esc = escapeHtml

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="ProLeadly">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(target)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
</head>
<body>
<script>location.replace(${JSON.stringify(target)})</script>
<p>Opening the SEO report… <a href="${esc(target)}">Open it here</a>.</p>
</body>
</html>`

	return new Response(html, {
		headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
	})
}

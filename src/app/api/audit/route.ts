import { AuditError, runAudit } from '@server/audit'
import { clientIp, takeRateLimit, withSlot } from '@server/limits'
import { hashRequester } from '@server/requester'
import { pagespeedConfig } from '@server/settings'
import { getSettings, saveReport } from '@server/store'
import { jsonError, streamEvents } from '@server/stream'
import type { AuditProgress, ReportSource } from '@shared/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SOURCES: ReportSource[] = ['web', 'api']

/**
 * POST /api/audit { url, source?, stream? }
 *
 * Streams progress as newline-delimited JSON and ends with { type: "done", id }. Send
 * stream: false to wait for the whole report as JSON instead.
 */
export async function POST(request: Request): Promise<Response> {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
	const url = typeof body.url === 'string' ? body.url : ''
	const visitor = typeof body.visitor === 'string' ? body.visitor : undefined
	const source = SOURCES.includes(body.source as ReportSource)
		? (body.source as ReportSource)
		: 'api'
	const settings = await getSettings()

	if (!url.trim()) return jsonError('Enter a website address to audit.', 400)
	const ip = clientIp(request)
	if (!takeRateLimit(ip)) {
		return jsonError("You've run a lot of audits. Try again in an hour.", 429)
	}

	const requester = hashRequester(visitor, ip)

	const audit = (onProgress?: (progress: AuditProgress) => void) =>
		withSlot(async () => {
			const report = await runAudit(url, {
				source,
				onProgress,
				pagespeed: pagespeedConfig(settings),
				brokenLinkLimit: settings.brokenLinkLimit
			})
			await saveReport(report, requester)

			return report
		})

	if (body.stream === false) {
		try {
			return Response.json(await audit())
		} catch (e) {
			return jsonError(e instanceof AuditError ? e.message : 'The audit failed.', 422)
		}
	}

	return streamEvents(async (send) => {
		send({ type: 'progress', step: 'queued', label: 'Starting the audit', pct: 1 })
		const report = await audit((p) => send({ type: 'progress', ...p }))
		send({ type: 'done', id: report.id, score: report.score, grade: report.grade })
	})
}

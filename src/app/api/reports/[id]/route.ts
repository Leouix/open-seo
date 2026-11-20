import { deleteReport, getReport } from '@server/store'
import { clientIp } from '@server/limits'
import { hashRequester } from '@server/requester'
import { jsonError } from '@server/stream'

export const dynamic = 'force-dynamic'

/** GET /api/reports/:id: one report as JSON. Reports are shareable, so this is public. */
export async function GET(
	_request: Request,
	context: RouteContext<'/api/reports/[id]'>
): Promise<Response> {
	const { id } = await context.params
	const report = await getReport(id)
	if (!report) return jsonError('Report not found.', 404)

	return Response.json(report, {
		headers: { 'content-disposition': `inline; filename="openseo-${report.domain}-${id}.json"` }
	})
}

export async function DELETE(
	request: Request,
	context: RouteContext<'/api/reports/[id]'>
): Promise<Response> {
	const { id } = await context.params
	const visitor = new URL(request.url).searchParams.get('visitor') ?? undefined
	const requester = hashRequester(visitor, clientIp(request))
	const { deleted, reason } = await deleteReport(id, requester)

	if (deleted) return new Response(null, { status: 204 })
	if (reason === 'forbidden') return jsonError('You can only delete your own reports.', 403)

	return jsonError('Report not found.', 404)
}

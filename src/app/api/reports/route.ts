import { clientIp } from '@server/limits'
import { hashRequester } from '@server/requester'
import { listReports } from '@server/store'

export const dynamic = 'force-dynamic'

/** GET /api/reports?domain=example.com&visitor=…: the audit history, newest first. */
export async function GET(request: Request): Promise<Response> {
	const url = new URL(request.url)
	const domain = url.searchParams.get('domain')
	const visitor = url.searchParams.get('visitor') ?? undefined
	const ip = clientIp(request)
	const requester = hashRequester(visitor, ip)
	const reports = (await listReports()).filter((r) => r.requester === requester)

	return Response.json(domain ? reports.filter((r) => r.domain === domain) : reports)
}

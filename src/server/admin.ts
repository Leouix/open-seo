import { createHash } from 'node:crypto'
import { processWide } from './process-wide'

/** How long a confirmed answer is reused before asking the main backend again. */
const TTL = 60 * 1000

/** How long the main backend gets to answer before we treat the visitor as anonymous. */
const TIMEOUT = 3000

/** Enough for the handful of admins and signed-in users who audit in an hour. */
const MAX_ENTRIES = 200

type Verdict = { admin: boolean; at: number }

const checks = processWide('admin-checks', () => new Map<string, Verdict>())

/** Where the main waBot backend answers "is this token an admin?". */
function checkUrl(): string {
	return process.env.OPENSEO_ADMIN_CHECK_URL || 'http://backend:8000/api/admin/check'
}

/**
 * The visitor's site session, from the `Authorization: Bearer …` header the frontend sends or,
 * when a plain browser request brings the site's HttpOnly cookie along, from `pl_token`.
 */
function sessionToken(headers: Headers): string | null {
	const authorization = headers.get('authorization') ?? ''
	if (authorization.startsWith('Bearer ')) {
		const token = authorization.slice('Bearer '.length).trim()

		return token || null
	}
	const cookie = headers.get('cookie')
	const match = cookie?.match(/(?:^|;\s*)pl_token=([^;]+)/)

	return match?.[1]?.trim() || null
}

function remember(key: string, verdict: Verdict): void {
	if (checks.size >= MAX_ENTRIES) {
		const oldest = checks.keys().next().value
		if (oldest) checks.delete(oldest)
	}
	checks.set(key, verdict)
}

async function confirm(token: string): Promise<boolean> {
	try {
		const response = await fetch(checkUrl(), {
			headers: { authorization: `Bearer ${token}` },
			cache: 'no-store',
			signal: AbortSignal.timeout(TIMEOUT)
		})

		return response.ok
	} catch {
		// The main backend is down or slow: treat the visitor as anonymous, so the limit holds.
		return false
	}
}

/**
 * Whether the audit request comes from a signed-in admin of the waBot site. Confirmed admins are
 * not counted against `OPENSEO_RATE_LIMIT`, so the owner can audit as often as needed. Anyone
 * else, and every failure to verify, keeps the regular per-IP limit.
 */
export async function isAdminRequest(request: Request): Promise<boolean> {
	const token = sessionToken(request.headers)
	if (!token) return false

	const key = createHash('sha256').update(token).digest('hex')
	const now = Date.now()
	const cached = checks.get(key)
	if (cached && now - cached.at < TTL) return cached.admin

	const admin = await confirm(token)
	remember(key, { admin, at: now })

	return admin
}

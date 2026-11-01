import { createHash } from 'node:crypto'

/**
 * Hashes a visitor id (or an IP fallback) into the short fingerprint stored
 * with each audit report. The same function is used when saving an audit and
 * when listing a visitor's history, so the result is stable even when the IP
 * changes between requests.
 */
export function hashRequester(visitor: string | undefined, ip: string): string {
	const input = visitor ? visitor : ip

	return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

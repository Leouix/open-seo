import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAdminRequest } from '@server/admin'

const CHECK_URL = 'https://backend.test/api/admin/check'

const fetchMock = vi.fn(
	async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 })
)

function request(headers: Record<string, string> = {}): Request {
	return new Request('https://seo.test/api/audit', { method: 'POST', headers })
}

beforeEach(() => {
	fetchMock.mockReset()
	fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
	process.env.OPENSEO_ADMIN_CHECK_URL = CHECK_URL
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	vi.unstubAllGlobals()
	delete process.env.OPENSEO_ADMIN_CHECK_URL
})

describe('isAdminRequest', () => {
	it('treats a request without a session as anonymous and asks nobody', async () => {
		expect(await isAdminRequest(request())).toBe(false)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('asks the main backend about the bearer token and accepts an admin', async () => {
		expect(await isAdminRequest(request({ authorization: 'Bearer bearer-admin-1' }))).toBe(true)
		expect(fetchMock).toHaveBeenCalledWith(
			CHECK_URL,
			expect.objectContaining({ headers: { authorization: 'Bearer bearer-admin-1' } })
		)
	})

	it('reads the site session cookie when there is no Authorization header', async () => {
		expect(
			await isAdminRequest(
				request({ cookie: 'theme=dark; pl_token=cookie-admin-1; other=1' })
			)
		).toBe(true)
		expect(fetchMock).toHaveBeenCalledWith(
			CHECK_URL,
			expect.objectContaining({ headers: { authorization: 'Bearer cookie-admin-1' } })
		)
	})

	it('ignores cookies that are not the site session', async () => {
		expect(await isAdminRequest(request({ cookie: 'theme=dark' }))).toBe(false)
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('keeps the rate limit for a signed-in user who is not an admin', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))

		expect(await isAdminRequest(request({ authorization: 'Bearer not-admin-1' }))).toBe(false)
	})

	it('keeps the rate limit when the main backend cannot be reached', async () => {
		fetchMock.mockRejectedValueOnce(new Error('offline'))

		expect(await isAdminRequest(request({ authorization: 'Bearer offline-1' }))).toBe(false)
	})

	it('remembers the answer for the same token instead of asking every time', async () => {
		const headers = { authorization: 'Bearer cached-admin-1' }

		expect(await isAdminRequest(request(headers))).toBe(true)
		expect(await isAdminRequest(request(headers))).toBe(true)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})

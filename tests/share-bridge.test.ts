import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// The store resolves its data folder at import time, so the variable goes in first.
// No KV variables here: without them the store works on files, which is what we set up.
vi.hoisted(() => {
	process.env.OPENSEO_DATA_DIR = 'openseo-share-test-data'
})

import { GET } from '../src/app/share/report/[id]/route'
import type { AuditReport } from '@shared/types'

const dataDir = process.env.OPENSEO_DATA_DIR as string

function report(id: string, overrides: Partial<AuditReport> = {}): AuditReport {
	return {
		id,
		url: 'https://fernhill.coffee/',
		finalUrl: 'https://fernhill.coffee/',
		domain: 'fernhill.coffee',
		createdAt: '2026-11-20T12:00:00.000Z',
		score: 82,
		grade: 'B',
		checks: [
			{ id: 'one', status: 'fail' },
			{ id: 'two', status: 'warn' },
			{ id: 'three', status: 'pass' }
		],
		...overrides
	} as unknown as AuditReport
}

async function writeReport(report: AuditReport): Promise<void> {
	await mkdir(join(dataDir, 'reports'), { recursive: true })
	await writeFile(join(dataDir, 'reports', `${report.id}.json`), JSON.stringify(report))
}

function request(id: string, headers: Record<string, string> = {}): Request {
	return new Request(`https://proleadly.com/share/report/${id}`, { headers })
}

const context = (id: string) => ({ params: Promise.resolve({ id }) }) as never

beforeEach(async () => {
	await rm(dataDir, { recursive: true, force: true })
	await mkdir(dataDir, { recursive: true })
})

afterEach(async () => {
	await rm(dataDir, { recursive: true, force: true })
})

describe('the share bridge', () => {
	it('answers with OG meta tags and a redirect to the report page', async () => {
		await writeReport(report('share-id-1'))

		const response = await GET(request('share-id-1'), context('share-id-1'))
		const html = await response.text()

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toContain('text/html')
		expect(html).toContain('og:title" content="SEO report: fernhill.coffee — grade B (82/100)"')
		expect(html).toContain('2 issues to fix')
		expect(html).toContain('https://proleadly.com/seo/audit?report=share-id-1')
		expect(html).toContain('http-equiv="refresh"')
		expect(html).toContain('og:image" content="https://proleadly.com/og-image.png')
	})

	it('localizes the redirect by Accept-Language', async () => {
		await writeReport(report('share-id-2'))

		const response = await GET(
			request('share-id-2', { 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.5' }),
			context('share-id-2')
		)

		expect(await response.text()).toContain('https://proleadly.com/ru/seo/audit?report=share-id-2')
	})

	it('redirects behind a proxy using forwarded headers', async () => {
		await writeReport(report('share-id-3'))

		const response = await GET(
			request('share-id-3', {
				'x-forwarded-host': 'proleadly.com',
				'x-forwarded-proto': 'https'
			}),
			context('share-id-3')
		)

		expect(await response.text()).toContain('https://proleadly.com/seo/audit?report=share-id-3')
	})

	it('escapes report fields into the HTML', async () => {
		await writeReport(report('share-id-4', { domain: 'evil"site<.com', grade: '<b>' }))

		const html = await (await GET(request('share-id-4'), context('share-id-4'))).text()

		expect(html).toContain('evil&quot;site&lt;.com')
		expect(html).toContain('grade &lt;b&gt; (82/100)')
	})

	it('answers 404 for an unknown report', async () => {
		expect((await GET(request('missing-id-1'), context('missing-id-1'))).status).toBe(404)
	})

	it('answers 404 for an invalid id', async () => {
		expect((await GET(request('badid!'), context('badid!'))).status).toBe(404)
	})
})

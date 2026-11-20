import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redisConfig, withRedisLock } from '@server/redis'
import {
	deleteReport,
	getReport,
	getSettings,
	listReports,
	saveReport,
	updateSettings
} from '@server/store'
import type { AuditReport } from '@shared/types'

// The store picks Redis when it loads, so the variables go in before any import runs.
vi.hoisted(() => {
	process.env.KV_REST_API_URL = 'https://fake-redis.upstash.io/'
	process.env.KV_REST_API_TOKEN = 'secret-token'
})

/** A stand-in for Upstash's REST API, keeping keys in a Map. */
const keys = new Map<string, string>()
let failNextGet = false

const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
	expect(String(url)).toBe('https://fake-redis.upstash.io')
	expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret-token')
	const [command, key, ...args] = JSON.parse(String(init?.body)) as string[]
	const reply = (result: unknown) => Response.json({ result })
	await new Promise((resolve) => setTimeout(resolve, 1))
	switch (command) {
		case 'GET':
			if (failNextGet) {
				failNextGet = false

				return Response.json({ error: 'ERR connection lost' }, { status: 500 })
			}

			return reply(keys.get(key) ?? null)
		case 'SET':
			if (args.includes('NX') && keys.has(key)) return reply(null)
			keys.set(key, args[0])

			return reply('OK')
		case 'DEL':
			return reply(keys.delete(key) ? 1 : 0)
		case 'EVAL': {
			// The lock release: EVAL <script> 1 <lock key> <token>
			const [, lock, token] = args
			if (keys.get(lock) !== token) return reply(0)
			keys.delete(lock)

			return reply(1)
		}
		default:
			return Response.json({ error: `ERR unknown command ${command}` }, { status: 400 })
	}
})
vi.stubGlobal('fetch', fetchMock)

function report(id: string): AuditReport {
	return {
		id,
		url: 'https://fernhill.coffee/',
		finalUrl: 'https://fernhill.coffee/',
		domain: 'fernhill.coffee',
		createdAt: '2026-10-31T12:00:00.000Z',
		score: 82,
		grade: 'B',
		overview: { title: 'Fernhill' },
		source: 'web'
	} as unknown as AuditReport
}

beforeEach(() => {
	keys.clear()
	failNextGet = false
	fetchMock.mockClear()
})

describe('redisConfig', () => {
	it('reads Upstash names first, then the ones Vercel sets', () => {
		expect(
			redisConfig({
				UPSTASH_REDIS_REST_URL: 'https://a.upstash.io',
				UPSTASH_REDIS_REST_TOKEN: 'a',
				KV_REST_API_URL: 'https://b.upstash.io',
				KV_REST_API_TOKEN: 'b'
			})
		).toEqual({ url: 'https://a.upstash.io', token: 'a' })
		expect(
			redisConfig({ KV_REST_API_URL: 'https://b.upstash.io/', KV_REST_API_TOKEN: 'b' })
		).toEqual({ url: 'https://b.upstash.io', token: 'b' })
	})

	it('is off without both a URL and a token', () => {
		expect(redisConfig({})).toBeNull()
		expect(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://a.upstash.io' })).toBeNull()
	})
})

describe('the store on Redis', () => {
	it('saves a report where another copy of the app can read it', async () => {
		await saveReport(report('report-one'))

		expect(JSON.parse(keys.get('openseo:reports/report-one.json')!)).toMatchObject({
			id: 'report-one'
		})
		expect(await getReport('report-one')).toMatchObject({ id: 'report-one', score: 82 })
		expect(await listReports()).toMatchObject([{ id: 'report-one', title: 'Fernhill' }])
		expect([...keys.keys()].some((k) => k.includes('lock'))).toBe(false)
	})

	it('keeps every index entry when audits finish at the same time', async () => {
		const ids = ['report-a1', 'report-b2', 'report-c3', 'report-d4', 'report-e5']
		await Promise.all(ids.map((id) => saveReport(report(id))))

		expect((await listReports()).map((r) => r.id).sort()).toEqual(ids)
	})

	it('deletes a report and its index entry', async () => {
		await saveReport(report('report-one'))

		expect(await deleteReport('report-one')).toEqual({ deleted: true })
		expect(keys.has('openseo:reports/report-one.json')).toBe(false)
		expect(await getReport('report-one')).toBeNull()
		expect(await listReports()).toEqual([])
	})

	it('deletes a report only for its owner', async () => {
		await saveReport(report('report-own'), 'hash-owner')

		expect(await deleteReport('report-own', 'hash-owner')).toEqual({ deleted: true })
		expect(await getReport('report-own')).toBeNull()
	})

	it("doesn't delete someone else's report", async () => {
		await saveReport(report('report-foreign'), 'hash-owner')

		expect(await deleteReport('report-foreign', 'hash-stranger')).toEqual({
			deleted: false,
			reason: 'forbidden'
		})
		expect(keys.has('openseo:reports/report-foreign.json')).toBe(true)
		expect((await listReports()).map((r) => r.id)).toEqual(['report-foreign'])
	})

	it('reports not-found for an unknown report', async () => {
		expect(await deleteReport('report-missing', 'hash-owner')).toEqual({
			deleted: false,
			reason: 'not-found'
		})
	})

	it("doesn't write over the history when Redis can't be read", async () => {
		await saveReport(report('report-one'))
		failNextGet = true

		await expect(saveReport(report('report-two'))).rejects.toThrow('ERR connection lost')
		expect((await listReports()).map((r) => r.id)).toEqual(['report-one'])
	})

	it('shows nothing instead of failing when a page reads Redis while it is down', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
		failNextGet = true

		expect(await listReports()).toEqual([])
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('ERR connection lost'))
		logged.mockRestore()
	})

	it('keeps settings', async () => {
		await updateSettings({ brandName: 'Silver Design' })

		expect((await getSettings()).brandName).toBe('Silver Design')
	})
})

describe('withRedisLock', () => {
	it('lets one holder in at a time', async () => {
		const config = { url: 'https://fake-redis.upstash.io', token: 'secret-token' }
		const order: string[] = []
		const hold = (name: string) =>
			withRedisLock(config, 'openseo:lock:test', async () => {
				order.push(`${name} in`)
				await new Promise((resolve) => setTimeout(resolve, 20))
				order.push(`${name} out`)
			})
		await Promise.all([hold('first'), hold('second')])

		expect(order).toEqual(['first in', 'first out', 'second in', 'second out'])
		expect(keys.has('openseo:lock:test')).toBe(false)
	})
})

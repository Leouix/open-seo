import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Monitor } from '@shared/monitors'
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '@shared/settings'
import type { AuditReport, CrawlReport, CrawlSummary, ReportSummary } from '@shared/types'
import { processWide } from './process-wide'
import { redis, redisConfig, withRedisLock } from './redis'

/**
 * Everything OpenSEO keeps, as plain JSON:
 *
 *   reports/<id>.json   one audit report each
 *   reports.json        the history index, newest first
 *   crawls/<id>.json    one crawl each
 *   crawls.json         the crawl index, newest first
 *   monitors.json       scheduled audits and their recent runs
 *   settings.json       branding and options
 *
 * They're files in the data folder (OPENSEO_DATA_DIR to keep them somewhere else), or keys
 * starting `openseo:` in Upstash Redis when its URL and token are set. Redis is for hosts like
 * Vercel, where files written by one request are gone, or on another machine, by the next.
 */
// The data folder is chosen at runtime, so the bundler mustn't try to trace it.
export const DATA_DIR = resolve(
	/* turbopackIgnore: true */ process.env.OPENSEO_DATA_DIR || join(process.cwd(), 'data')
)

/** Upstash Redis, when it's set up. */
const remote = redisConfig()

const KEY_PREFIX = 'openseo:'

const ID = /^[A-Za-z0-9_-]{6,40}$/

/** Writes to one file happen one at a time, so concurrent audits can't lose index entries. */
const locks = processWide('file-locks', () => new Map<string, Promise<unknown>>())

/**
 * Runs `work` once every earlier write to `name` in this process has finished. With Redis, it
 * also holds a lock in Redis, because other copies of the app write to the same keys.
 */
function withLock<T>(name: string, work: () => Promise<T>): Promise<T> {
	const locked = remote ? () => withRedisLock(remote, `${KEY_PREFIX}lock:${name}`, work) : work
	const previous = locks.get(name) ?? Promise.resolve()
	const next = previous.then(locked, locked)
	locks.set(
		name,
		next.catch(() => {})
	)

	return next
}

/** The text stored under `name`, or null when there's none. Redis errors are thrown. */
async function readText(name: string): Promise<string | null> {
	if (remote) {
		const text = await redis(remote, 'GET', KEY_PREFIX + name)

		return typeof text === 'string' ? text : null
	}
	try {
		return await readFile(join(DATA_DIR, name), 'utf8')
	} catch {
		return null
	}
}

/** What's stored under `name`, or `fallback` when there's nothing usable. Errors are thrown. */
async function loadJson<T>(name: string, fallback: T): Promise<T> {
	const text = await readText(name)
	if (text === null) return fallback
	try {
		return JSON.parse(text) as T
	} catch {
		return fallback
	}
}

/** Like loadJson, but a page that reads Redis while it's unreachable shows nothing instead of failing. */
async function readJson<T>(name: string, fallback: T): Promise<T> {
	try {
		return await loadJson(name, fallback)
	} catch (e) {
		console.error(`[store] Couldn't read ${name}: ${(e as Error).message}`)

		return fallback
	}
}

/** Files are written through a temporary file and a rename, so a crash never leaves half a file. */
async function writeJson(name: string, data: unknown): Promise<void> {
	const text = JSON.stringify(data)
	if (remote) {
		await redis(remote, 'SET', KEY_PREFIX + name, text)

		return
	}
	const file = join(DATA_DIR, name)
	await mkdir(dirname(file), { recursive: true })
	const temp = `${file}.${randomUUID()}.tmp`
	await writeFile(temp, text)
	await rename(temp, file)
}

async function removeJson(name: string): Promise<void> {
	if (remote) {
		await redis(remote, 'DEL', KEY_PREFIX + name)

		return
	}
	await rm(join(DATA_DIR, name), { force: true })
}

/**
 * Reads, changes and writes back one list under its lock. It reads with loadJson, so a Redis
 * hiccup stops the update instead of writing an empty list over the real one.
 */
function updateJson<T>(name: string, fallback: T, change: (current: T) => T): Promise<T> {
	return withLock(name, async () => {
		const next = change(await loadJson(name, fallback))
		await writeJson(name, next)

		return next
	})
}

export function isValidId(id: string): boolean {
	return ID.test(id)
}

const reportsIndex = 'reports.json'
const crawlsIndex = 'crawls.json'
const monitorsFile = 'monitors.json'
const settingsFile = 'settings.json'

export async function saveReport(report: AuditReport, requester?: string): Promise<void> {
	await writeJson(`reports/${report.id}.json`, report)
	const summary: ReportSummary = {
		id: report.id,
		url: report.url,
		finalUrl: report.finalUrl,
		domain: report.domain,
		title: report.overview.title,
		createdAt: report.createdAt,
		score: report.score,
		grade: report.grade,
		source: report.source,
		...(requester ? { requester } : {})
	}
	await updateJson<ReportSummary[]>(reportsIndex, [], (list) => [summary, ...list])
}

export async function getReport(id: string): Promise<AuditReport | null> {
	if (!isValidId(id)) return null

	return readJson<AuditReport | null>(`reports/${id}.json`, null)
}

export function listReports(): Promise<ReportSummary[]> {
	return readJson<ReportSummary[]>(reportsIndex, [])
}

export async function deleteReport(id: string): Promise<boolean> {
	if (!isValidId(id)) return false
	await removeJson(`reports/${id}.json`)
	let found = false
	await updateJson<ReportSummary[]>(reportsIndex, [], (list) => {
		found = list.some((r) => r.id === id)

		return list.filter((r) => r.id !== id)
	})

	return found
}

export async function saveCrawl(crawl: CrawlReport): Promise<void> {
	await writeJson(`crawls/${crawl.id}.json`, crawl)
	const summary: CrawlSummary = {
		id: crawl.id,
		startUrl: crawl.startUrl,
		domain: crawl.domain,
		createdAt: crawl.createdAt,
		pages: crawl.pages.length,
		health: crawl.health,
		issues: crawl.issues.reduce((n, i) => n + i.count, 0)
	}
	await updateJson<CrawlSummary[]>(crawlsIndex, [], (list) => [summary, ...list])
}

export async function getCrawl(id: string): Promise<CrawlReport | null> {
	if (!isValidId(id)) return null

	return readJson<CrawlReport | null>(`crawls/${id}.json`, null)
}

export function listCrawls(): Promise<CrawlSummary[]> {
	return readJson<CrawlSummary[]>(crawlsIndex, [])
}

export async function deleteCrawl(id: string): Promise<boolean> {
	if (!isValidId(id)) return false
	await removeJson(`crawls/${id}.json`)
	let found = false
	await updateJson<CrawlSummary[]>(crawlsIndex, [], (list) => {
		found = list.some((c) => c.id === id)

		return list.filter((c) => c.id !== id)
	})

	return found
}

/** Every monitor, newest first. */
export function listMonitors(): Promise<Monitor[]> {
	return readJson<Monitor[]>(monitorsFile, [])
}

export async function getMonitor(id: string): Promise<Monitor | null> {
	if (!isValidId(id)) return null

	return (await listMonitors()).find((m) => m.id === id) ?? null
}

export async function addMonitor(monitor: Monitor): Promise<void> {
	await updateJson<Monitor[]>(monitorsFile, [], (list) => [monitor, ...list])
}

/**
 * Changes one monitor in place, under the file's lock, so a run finishing while someone edits
 * the schedule keeps both changes. Returns the result, or null when the monitor is gone.
 */
export async function updateMonitor(
	id: string,
	change: (monitor: Monitor) => Monitor
): Promise<Monitor | null> {
	let updated: Monitor | null = null
	await updateJson<Monitor[]>(monitorsFile, [], (list) =>
		list.map((monitor) => {
			if (monitor.id !== id) return monitor
			updated = change(monitor)

			return updated
		})
	)

	return updated
}

export async function deleteMonitor(id: string): Promise<boolean> {
	let found = false
	await updateJson<Monitor[]>(monitorsFile, [], (list) => {
		found = list.some((m) => m.id === id)

		return list.filter((m) => m.id !== id)
	})

	return found
}

export async function getSettings(): Promise<Settings> {
	return mergeSettings(DEFAULT_SETTINGS, await readJson<unknown>(settingsFile, {}))
}

export function updateSettings(patch: unknown): Promise<Settings> {
	return withLock(settingsFile, async () => {
		const current = mergeSettings(DEFAULT_SETTINGS, await loadJson<unknown>(settingsFile, {}))
		const next = mergeSettings(current, patch)
		await writeJson(settingsFile, next)

		return next
	})
}

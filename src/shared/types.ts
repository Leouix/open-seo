/** How a check came out. "info" checks are shown but don't count towards the score. */
export type Status = 'pass' | 'warn' | 'fail' | 'info'

/** How much a failing check matters. */
export type Priority = 'high' | 'medium' | 'low'

export type CategoryId =
	'onpage' | 'links' | 'usability' | 'performance' | 'social' | 'security' | 'ai'

/** Structured evidence for a check, rendered by the report's detail blocks. */
export type Detail =
	| { kind: 'list'; items: string[]; more?: number }
	| { kind: 'table'; columns: string[]; rows: (string | number)[][]; more?: number }
	| { kind: 'kv'; items: [string, string][] }
	| { kind: 'code'; text: string }
	| { kind: 'serp'; title: string; url: string; description: string }
	| { kind: 'social'; title: string; description: string; image?: string; site: string }
	| { kind: 'screenshots'; items: { label: string; src: string }[] }
	| { kind: 'tags'; items: { label: string; tone?: Status }[] }
	| { kind: 'metrics'; items: Metric[] }

export interface Metric {
	label: string
	value: string
	tone?: Status
	hint?: string
}

export interface CheckResult {
	id: string
	category: CategoryId
	title: string
	status: Status
	/** Scoring weight; 0 for checks that are information only. */
	weight: number
	priority: Priority
	/** One line saying what we found. */
	summary: string
	/** How to fix it, when it isn't passing. */
	recommendation?: string
	details?: Detail[]
}

export interface CategoryResult {
	id: CategoryId
	name: string
	score: number
	grade: string
	counts: Record<Status, number>
}

export interface PageSpeedStrategyResult {
	strategy: 'mobile' | 'desktop'
	performance?: number
	accessibility?: number
	bestPractices?: number
	seo?: number
	metrics: Metric[]
	/** Real-user data from the Chrome UX Report, when Google has enough of it. */
	field?: Metric[]
	screenshot?: string
	consoleErrors?: number
}

export interface PageSpeedResult {
	mobile?: PageSpeedStrategyResult
	desktop?: PageSpeedStrategyResult
	error?: string
}

export interface Technology {
	name: string
	category: string
}

export interface AuditOverview {
	title: string
	description: string
	favicon?: string
	statusCode: number
	responseTimeMs: number
	loadTimeMs: number
	pageSizeBytes: number
	htmlBytes: number
	requests: number
	wordCount: number
	serverIp?: string
	technologies: Technology[]
	topKeywords: { term: string; count: number }[]
}

/** Where an audit was started. Only older reports have 'embed'. */
export type ReportSource = 'web' | 'embed' | 'api' | 'cli' | 'monitor' | 'mcp'

export interface AuditReport {
	id: string
	version: 1
	url: string
	finalUrl: string
	domain: string
	createdAt: string
	durationMs: number
	score: number
	grade: string
	categories: CategoryResult[]
	checks: CheckResult[]
	overview: AuditOverview
	pagespeed?: PageSpeedResult
	/** Share previews, images and icons. Missing on reports made before they existed. */
	sharing?: SharingReport
	source: ReportSource
}

/** One row in the history list: enough to show a report without loading it. */
export interface ReportSummary {
	id: string
	url: string
	finalUrl: string
	domain: string
	title: string
	createdAt: string
	score: number
	grade: string
	source: ReportSource
	/** Anonymous fingerprint of who requested the audit (hashed IP + optional visitor id). */
	requester?: string
}

export interface AuditProgress {
	step: string
	label: string
	pct: number
}

/** The lines streamed back while an audit or crawl runs (newline-delimited JSON). */
export type StreamEvent =
	| ({ type: 'progress' } & AuditProgress)
	| { type: 'done'; id: string; score: number; grade: string }
	| { type: 'error'; message: string }

export type CrawlIssueId =
	| 'http-error'
	| 'redirect'
	| 'missing-title'
	| 'title-length'
	| 'duplicate-title'
	| 'missing-description'
	| 'description-length'
	| 'duplicate-description'
	| 'missing-h1'
	| 'multiple-h1'
	| 'thin-content'
	| 'noindex'
	| 'canonicalized'
	| 'missing-canonical'
	| 'slow-response'
	| 'missing-alt'
	| 'links-to-broken'
	| 'missing-lang'

export interface CrawlPage {
	url: string
	finalUrl: string
	status: number | null
	error?: string
	contentType?: string
	responseMs?: number
	bytes?: number
	depth: number
	title?: string
	description?: string
	h1?: string
	h1Count?: number
	wordCount?: number
	canonical?: string
	noindex?: boolean
	lang?: string
	imagesMissingAlt?: number
	internalLinks?: number
	externalLinks?: number
	issues: CrawlIssueId[]
}

export interface CrawlIssueSummary {
	id: CrawlIssueId
	title: string
	priority: Priority
	count: number
}

export interface CrawlReport {
	id: string
	startUrl: string
	domain: string
	createdAt: string
	durationMs: number
	maxPages: number
	limitReached: boolean
	/** Share of crawled pages without a high-priority issue, 0–100. */
	health: number
	pages: CrawlPage[]
	issues: CrawlIssueSummary[]
}

export interface CrawlSummary {
	id: string
	startUrl: string
	domain: string
	createdAt: string
	pages: number
	health: number
	issues: number
}

export type SharePlatform =
	'google' | 'facebook' | 'x' | 'linkedin' | 'slack' | 'discord' | 'whatsapp' | 'imessage' | 'telegram'

/** An image we downloaded and measured: a share image or an icon. */
export interface ImageAsset {
	url: string
	status: number | null
	/** It loaded and is an image we could read. */
	ok: boolean
	contentType?: string
	format?: string
	width?: number
	height?: number
	/** Every size inside an .ico file. */
	sizes?: string[]
	bytes?: number
	error?: string
}

export type IconKind = 'favicon' | 'apple-touch-icon' | 'manifest' | 'mask-icon'

export interface IconAsset extends ImageAsset {
	kind: IconKind
	/** Where we found it, like `<link rel="icon">` or "Web app manifest". */
	source: string
	/** The sizes the page declares, which can differ from the real ones. */
	declaredSizes?: string
	purpose?: string
}

export type MetaGroup = 'Basics' | 'Open Graph' | 'X' | 'Icons and app'

export interface MetaTag {
	group: MetaGroup
	key: string
	value: string
}

export interface PreviewNote {
	tone: Status
	text: string
}

/** How a link to the page is likely to look on one platform. */
export interface SharePreview {
	platform: SharePlatform
	name: string
	title: string
	description?: string
	siteName: string
	domain: string
	/** The URL as the platform prints it (a breadcrumb on Google). */
	displayUrl: string
	image?: string
	/** A wide image across the card, a small thumbnail, or no image. */
	layout: 'large' | 'small' | 'none'
	/** The favicon or app icon the platform shows next to the site name. */
	icon?: string
	/** The theme color, which Discord uses for the embed's side bar. */
	accent?: string
	notes: PreviewNote[]
}

export interface WebManifest {
	url: string
	ok: boolean
	error?: string
	name?: string
	shortName?: string
	themeColor?: string
	backgroundColor?: string
	display?: string
	iconSizes: string[]
}

export interface SharingReport {
	previews: SharePreview[]
	icons: IconAsset[]
	ogImage?: ImageAsset
	twitterImage?: ImageAsset
	manifest?: WebManifest
	themeColor?: string
	/** Every social, icon and app tag on the page, for the tag table. */
	tags: MetaTag[]
}

/** The quick share check: previews, images and icons for one URL, without a full audit. */
export interface SharePreviewResult {
	url: string
	finalUrl: string
	title: string
	checkedAt: string
	sharing: SharingReport
}

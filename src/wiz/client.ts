import { requestUrl } from 'obsidian';
import { t } from '../i18n';
import type { WizFolderSyncSettings } from '../settings';
import {
	blocksToMarkdown,
	fetchCollaborationContent,
	markdownToBlocks,
	writeCollaborationBlocks,
} from './collaboration';
import {
	documentHtmlToMarkdown,
	markdownToDocumentHtml,
} from './document';
import { ensureMarkdownTitle, unwrapMarkdown, wrapMarkdown } from './markdown';
import { outlineToMarkdown } from './outline';

interface LoginResult {
	token: string;
	kbGuid: string;
	kbServer: string;
	userGuid?: string;
}

interface WizResponse<T> {
	returnCode?: number;
	code?: number;
	returnMessage?: string;
	result?: T;
	raw?: string;
}

interface WizNoteInfo {
	title?: string;
	category?: string;
	owner?: string;
	protected?: number;
	readCount?: number;
	attachmentCount?: number;
	type?: string;
	fileType?: string;
	created?: number;
	dataModified?: number;
	tags?: string;
	keywords?: string;
	url?: string;
}

interface WizNoteContent {
	info?: WizNoteInfo;
	html?: string;
	resources?: unknown[];
}

interface CreateNoteResult {
	docGuid: string;
}

export interface WizNoteSummary {
	docGuid: string;
	title: string;
	category: string;
	dataModified: number;
	type: string;
}

export interface WizRemoteNote {
	title: string;
	category: string;
	markdown: string;
	dataModified: number;
	type: string;
}

export interface WizNoteResource {
	name: string;
	url: string;
	size: number;
}

export interface WizNoteAttachment {
	attGuid: string;
	name: string;
	size: number;
}

interface ConnectionSummary {
	userId: string;
	kbGuid: string;
	kbServer: string;
}

export class WizApiError extends Error {
	code?: number;

	constructor(message: string, code?: number) {
		super(message);
		this.name = 'WizApiError';
		this.code = code;
	}
}

export class WizClient {
	private constructor(
		private readonly accountBaseUrl: string,
		private readonly userId: string,
		private readonly userGuid: string,
		private token: string,
		private kbGuid: string,
		private kbServer: string,
	) {}

	static async login(settings: WizFolderSyncSettings): Promise<WizClient> {
		validateCredentials(settings);

		const accountBaseUrl = normalizeBaseUrl(settings.accountBaseUrl);
		const result = await execRequest<LoginResult>({
			method: 'POST',
			url: `${accountBaseUrl}/as/user/login`,
			body: {
				userId: settings.userId,
				password: settings.password,
			},
		});

		return new WizClient(
			accountBaseUrl,
			settings.userId.trim(),
			result.userGuid ?? '',
			result.token,
			result.kbGuid,
			result.kbServer,
		);
	}

	getConnectionSummary(): ConnectionSummary {
		return {
			userId: this.userId,
			kbGuid: this.kbGuid,
			kbServer: this.kbServer,
		};
	}

	async getCategories(): Promise<Set<string>> {
		const response = await execRequest<unknown>({
			method: 'GET',
			url: `${this.kbServer}/ks/category/all/${this.kbGuid}`,
			token: this.token,
			returnFullResult: true,
		});

		const categories = new Set<string>();
		collectCategoryPaths(response, categories);
		return categories;
	}

	async createCategory(parent: string, child: string): Promise<void> {
		await execRequest<unknown>({
			method: 'POST',
			url: `${this.kbServer}/ks/category/create/${this.kbGuid}`,
			query: {
				clientType: 'web',
				clientVersion: '3.0',
				lang: 'zh-cn',
			},
			token: this.token,
			body: {
				parent,
				child,
				pos: 0,
			},
		});
	}

	async deleteCategory(category: string): Promise<void> {
		await execRequest<unknown>({
			method: 'DELETE',
			url: `${this.kbServer}/ks/category/delete/${this.kbGuid}`,
			token: this.token,
			query: {
				category: normalizeCategoryPath(category),
			},
		});
	}

	async createMarkdownNote(options: {
		title: string;
		category: string;
		markdown: string;
		modifiedTime?: number;
	}): Promise<CreateNoteResult> {
		const normalizedTitle = ensureMarkdownTitle(options.title);
		const created = await execRequest<CreateNoteResult>({
			method: 'POST',
			url: `${this.kbServer}/ks/note/create/${this.kbGuid}`,
			token: this.token,
			body: {
				kbGuid: this.kbGuid,
				owner: this.userId,
				category: options.category,
				title: normalizedTitle,
				type: 'lite/markdown',
				html: wrapMarkdown(options.markdown),
			},
		});

		await this.patchNoteInfo(created.docGuid, {
			title: normalizedTitle,
			category: options.category,
			type: 'lite/markdown',
			dataModified: options.modifiedTime,
			created: options.modifiedTime,
		});

		return created;
	}

	async updateMarkdownNote(options: {
		docGuid: string;
		title: string;
		category: string;
		markdown: string;
		resources?: string[];
		modifiedTime?: number;
	}): Promise<void> {
		const normalizedTitle = ensureMarkdownTitle(options.title);
		await this.patchNoteInfo(options.docGuid, {
			title: normalizedTitle,
			category: options.category,
			type: 'lite/markdown',
		});

		await execRequest<unknown>({
			method: 'PUT',
			url: `${this.kbServer}/ks/note/save/${this.kbGuid}/${options.docGuid}`,
			query: {
				clientType: 'web',
				clientVersion: '3.0',
				lang: 'zh-cn',
			},
			token: this.token,
			body: {
				kbGuid: this.kbGuid,
				docGuid: options.docGuid,
				html: wrapMarkdown(options.markdown),
				url: '',
				tags: '',
				author: this.userId,
				resources: options.resources ?? [],
			},
		});

		await this.patchNoteInfo(options.docGuid, {
			title: normalizedTitle,
			category: options.category,
			type: 'lite/markdown',
			dataModified: options.modifiedTime,
		});
	}

	async listCategoryNotes(category: string): Promise<WizNoteSummary[]> {
		const notes: WizNoteSummary[] = [];
		const pageSize = 100;
		let start = 0;

		for (;;) {
			const page = await execRequest<unknown[]>({
				method: 'GET',
				url: `${this.kbServer}/ks/note/list/category/${this.kbGuid}`,
				token: this.token,
				query: {
					category,
					start,
					count: pageSize,
					withAbstract: 'false',
					orderBy: 'modified',
					ascending: 'desc',
				},
			});

			const items = Array.isArray(page) ? page : [];
			for (const item of items) {
				const note = normalizeNoteSummary(item);
				if (note) {
					notes.push(note);
				}
			}

			if (items.length < pageSize) {
				break;
			}

			start += pageSize;
		}

		return notes;
	}

	async readMarkdownNote(docGuid: string): Promise<{
		title: string;
		category: string;
		markdown: string;
		dataModified: number;
	}> {
		const note = await this.readRemoteNote(docGuid);
		return {
			title: note.title,
			category: note.category,
			markdown: note.markdown,
			dataModified: note.dataModified,
		};
	}

	async readRemoteNote(docGuid: string): Promise<WizRemoteNote> {
		const detail = await execRequest<WizNoteContent>({
			method: 'GET',
			url: `${this.kbServer}/ks/note/download/${this.kbGuid}/${docGuid}`,
			query: {
				downloadInfo: 1,
				downloadData: 1,
			},
			token: this.token,
		});

		const info = detail.info ?? {};
		const type = normalizeNoteType(info.type);
		return {
			title: ensureMarkdownTitle(info.title ?? t('errorUntitled')),
			category: info.category ?? '',
			markdown: await this.readRemoteNoteMarkdown(docGuid, type, detail.html ?? ''),
			dataModified: toTimestamp(info.dataModified ?? info.created),
			type,
		};
	}

	async deleteNote(docGuid: string): Promise<void> {
		await execRequest<unknown>({
			method: 'DELETE',
			url: `${this.kbServer}/ks/note/delete/${this.kbGuid}/${docGuid}`,
			token: this.token,
		});
	}

	async updateRemoteNote(options: {
		docGuid: string;
		title: string;
		category: string;
		markdown: string;
		resources?: string[];
		modifiedTime?: number;
		type: string;
	}): Promise<void> {
		const type = normalizeNoteType(options.type);
		if (type === 'collaboration') {
			await this.updateCollaborationNote(options);
			return;
		}

		if (isDocumentLikeType(type)) {
			await this.updateDocumentLikeNote(options);
			return;
		}

		if (type === 'lite/markdown') {
			await this.updateMarkdownNote({
				docGuid: options.docGuid,
				title: options.title,
				category: options.category,
				markdown: options.markdown,
				resources: options.resources,
				modifiedTime: options.modifiedTime,
			});
			return;
		}

		throw new Error(t('errorRemoteNoteTypeReadonly', { type }));
	}

	async listNoteResources(docGuid: string): Promise<WizNoteResource[]> {
		const detail = await execRequest<WizNoteContent>({
			method: 'GET',
			url: `${this.kbServer}/ks/note/download/${this.kbGuid}/${docGuid}`,
			query: {
				downloadInfo: 1,
				downloadData: 1,
			},
			token: this.token,
		});

		return (detail.resources ?? [])
			.map((item) => normalizeResource(item))
			.filter((item): item is WizNoteResource => item !== null);
	}

	async uploadLegacyResource(
		docGuid: string,
		data: ArrayBuffer,
		name: string,
	): Promise<{ name: string; url: string }> {
		const form = new FormData();
		form.append('kbGuid', this.kbGuid);
		form.append('docGuid', docGuid);
		form.append('data', new Blob([data]), name);

		const result = await execFormRequest<{ name?: string; url?: string }>({
			method: 'POST',
			url: `${this.kbServer}/ks/resource/upload/${this.kbGuid}/${docGuid}`,
			token: this.token,
			query: {
				clientType: 'web',
				clientVersion: '4.0',
			},
			body: form,
		});

		const remoteName = readString(result.name);
		const url = readString(result.url);
		if (!remoteName || !url) {
			throw new Error(`Invalid resource upload response for ${name}`);
		}

		return { name: remoteName, url };
	}

	async downloadLegacyResource(url: string): Promise<ArrayBuffer> {
		const response = await requestUrl({
			url,
			method: 'GET',
			throw: false,
		});
		if (response.status >= 400) {
			throw new Error(`Legacy resource download failed: HTTP ${response.status}`);
		}
		return response.arrayBuffer;
	}

	async listNoteAttachments(docGuid: string): Promise<WizNoteAttachment[]> {
		const result = await execRequest<unknown[]>({
			method: 'GET',
			url: `${this.kbServer}/ks/note/attachments/${this.kbGuid}/${docGuid}`,
			query: {
				extra: 1,
				clientType: 'web',
				clientVersion: '4.0',
			},
			token: this.token,
		});

		return (Array.isArray(result) ? result : [])
			.map((item) => normalizeAttachment(item))
			.filter((item): item is WizNoteAttachment => item !== null);
	}

	async downloadNoteAttachment(
		docGuid: string,
		attGuid: string,
	): Promise<ArrayBuffer> {
		const url = withQuery(
			`${this.kbServer}/ks/attachment/download/${this.kbGuid}/${docGuid}/${attGuid}`,
			{
				clientType: 'web',
				clientVersion: '4.0',
			},
		);
		const response = await requestUrl({
			url,
			method: 'GET',
			headers: {
				'X-Wiz-Token': this.token,
			},
			throw: false,
		});
		if (response.status >= 400) {
			throw new Error(`Attachment download failed: HTTP ${response.status}`);
		}
		return response.arrayBuffer;
	}

	async listCollaborationResources(
		docGuid: string,
	): Promise<Array<{ name: string; blockType: string }>> {
		const editorToken = await this.getCollaborationEditorToken(docGuid);
		const raw = await fetchCollaborationContent({
			kbServer: this.kbServer,
			kbGuid: this.kbGuid,
			docGuid,
			userGuid: this.getRequiredUserGuid(),
			editorToken,
		});
		const parsed = safeJsonParse(raw);
		const blocks = readCollaborationBlocks(parsed);
		if (!blocks) {
			return [];
		}

		const resources = new Map<string, string>();
		for (const block of blocks) {
			const embedType = readString(block.embedType);
			const embedData = asRecord(block.embedData);
			const src = readString(embedData?.src);
			if (!src || !embedType) {
				continue;
			}
			if (['image', 'audio', 'file', 'drawio', 'video'].includes(embedType)) {
				resources.set(src, embedType);
			}
		}

		return [...resources.entries()].map(([name, blockType]) => ({
			name,
			blockType,
		}));
	}

	async downloadCollaborationResource(
		docGuid: string,
		name: string,
	): Promise<ArrayBuffer> {
		const { editorToken } = await this.getCollaborationHeaders(docGuid);
		const response = await window.fetch(
			`${this.kbServer}/editor/${this.kbGuid}/${docGuid}/resources/${encodeURIComponent(name)}`,
			{
				headers: {
					cookie: `x-live-editor-token=${editorToken}`,
					'user-agent': 'Mozilla/5.0',
				},
			},
		);
		if (!response.ok) {
			throw new Error(
				`Collaboration resource download failed: HTTP ${response.status}`,
			);
		}
		return await response.arrayBuffer();
	}

	async uploadCollaborationResource(
		docGuid: string,
		data: ArrayBuffer,
		fileName: string,
	): Promise<{ src: string }> {
		const bytes = new Uint8Array(data);
		const hash = await hashBytes(bytes);
		const mime = guessMime(fileName);
		const { base, headers } = await this.getCollaborationHeaders(docGuid);

		const registerResponse = await window.fetch(`${base}/resources/${hash}`, {
			method: 'POST',
			headers: {
				...headers,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				name: fileName,
				size: bytes.byteLength,
			}),
		});
		if (!registerResponse.ok) {
			throw new Error(
				`Collaboration upload step 1 failed: HTTP ${registerResponse.status}`,
			);
		}

		let src = extractCollaborationUploadName(await readJsonIfPresent(registerResponse));
		if (!src) {
			const form = new FormData();
			form.append('file-size', String(bytes.byteLength));
			form.append('file-hash', hash);
			form.append('file', new Blob([bytes], { type: mime }), fileName);
			const uploadResponse = await window.fetch(`${base}/resources`, {
				method: 'POST',
				headers,
				body: form,
			});
			if (!uploadResponse.ok) {
				throw new Error(
					`Collaboration upload step 2 failed: HTTP ${uploadResponse.status}`,
				);
			}
			src = extractCollaborationUploadName(await readJsonIfPresent(uploadResponse));
		}

		if (!src) {
			const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
			src = extension ? `${hash}.${extension}` : hash;
		}

		return { src };
	}

	private async patchNoteInfo(
		docGuid: string,
		patch: Partial<WizNoteInfo>,
	): Promise<void> {
		const detail = await execRequest<WizNoteContent>({
			method: 'GET',
			url: `${this.kbServer}/ks/note/download/${this.kbGuid}/${docGuid}`,
			query: {
				downloadInfo: 1,
				downloadData: 0,
			},
			token: this.token,
		});

		const info = detail.info ?? {};
		const noteType = patch.type ?? info.type ?? 'lite/markdown';
		const title = patch.title ?? info.title ?? '';
		const normalizedTitle =
			noteType === 'lite/markdown' && title
				? ensureMarkdownTitle(title)
				: title;
		await execRequest<unknown>({
			method: 'POST',
			url: `${this.kbServer}/ks/note/upload/${this.kbGuid}/${docGuid}`,
			token: this.token,
			body: {
				kbGuid: this.kbGuid,
				docGuid,
				title: normalizedTitle,
				category: info.category ?? '',
				owner: info.owner ?? this.userId,
				protected: info.protected ?? 0,
				readCount: info.readCount ?? 0,
				attachmentCount: info.attachmentCount ?? 0,
				type: noteType,
				fileType: info.fileType ?? '',
				created: info.created,
				dataModified: info.dataModified ?? info.created,
				tags: info.tags ?? '',
				keywords: info.keywords ?? '',
				url: info.url ?? '',
				...patch,
			},
		});
	}

	private async readRemoteNoteMarkdown(
		docGuid: string,
		type: string,
		html: string,
	): Promise<string> {
		switch (type) {
			case 'lite/markdown':
				return unwrapMarkdown(html);
			case 'collaboration':
				return await this.readCollaborationMarkdown(docGuid);
			case 'outline':
				return outlineToMarkdown(html);
			case 'document':
			case 'journal':
			case 'TemplateNote':
			case 'tasklist':
				return documentHtmlToMarkdown(html);
			default:
				return documentHtmlToMarkdown(html);
		}
	}

	private async readCollaborationMarkdown(docGuid: string): Promise<string> {
		const editorToken = await this.getCollaborationEditorToken(docGuid);
		const raw = await fetchCollaborationContent({
			kbServer: this.kbServer,
			kbGuid: this.kbGuid,
			docGuid,
			userGuid: this.getRequiredUserGuid(),
			editorToken,
		});
		return blocksToMarkdown(raw);
	}

	private async updateCollaborationNote(options: {
		docGuid: string;
		title: string;
		category: string;
		markdown: string;
		modifiedTime?: number;
	}): Promise<void> {
		await this.patchNoteInfo(options.docGuid, {
			title: ensureMarkdownTitle(options.title),
			category: options.category,
		});

		const editorToken = await this.getCollaborationEditorToken(options.docGuid);
		const { blocks, extras } = markdownToBlocks(options.markdown);
		await writeCollaborationBlocks({
			kbServer: this.kbServer,
			kbGuid: this.kbGuid,
			docGuid: options.docGuid,
			userGuid: this.getRequiredUserGuid(),
			editorToken,
			blocks,
			extras,
		});

		if (options.modifiedTime !== undefined) {
			await this.patchNoteInfo(options.docGuid, {
				dataModified: options.modifiedTime,
			});
		}
	}

	private async updateDocumentLikeNote(options: {
		docGuid: string;
		title: string;
		category: string;
		markdown: string;
		resources?: string[];
		modifiedTime?: number;
		type: string;
	}): Promise<void> {
		await this.patchNoteInfo(options.docGuid, {
			title: ensureMarkdownTitle(options.title),
			category: options.category,
		});

		await execRequest<unknown>({
			method: 'PUT',
			url: `${this.kbServer}/ks/note/save/${this.kbGuid}/${options.docGuid}`,
			query: {
				clientType: 'web',
				clientVersion: '3.0',
				lang: 'zh-cn',
			},
			token: this.token,
			body: {
				kbGuid: this.kbGuid,
				docGuid: options.docGuid,
				html: markdownToDocumentHtml(options.markdown),
				url: '',
				tags: '',
				author: this.userId,
				resources: options.resources ?? [],
			},
		});

		if (options.modifiedTime !== undefined) {
			await this.patchNoteInfo(options.docGuid, {
				dataModified: options.modifiedTime,
			});
		}
	}

	private async getCollaborationEditorToken(docGuid: string): Promise<string> {
		const result = await execRequest<unknown>({
			method: 'POST',
			url: `${this.kbServer}/ks/note/${this.kbGuid}/${docGuid}/tokens`,
			token: this.token,
			body: {},
		});

		if (typeof result === 'string' && result.trim()) {
			return result;
		}

		if (result && typeof result === 'object') {
			const candidate =
				readString((result as Record<string, unknown>).editorToken) ??
				readString((result as Record<string, unknown>).token);
			if (candidate) {
				return candidate;
			}
		}

		throw new Error(`Missing collaboration editor token for ${docGuid}`);
	}

	private getRequiredUserGuid(): string {
		if (!this.userGuid) {
			throw new Error(t('errorCollaborationUserGuidMissing'));
		}
		return this.userGuid;
	}

	private async getCollaborationHeaders(docGuid: string): Promise<{
		editorToken: string;
		base: string;
		headers: Record<string, string>;
	}> {
		const editorToken = await this.getCollaborationEditorToken(docGuid);
		const base = `${this.kbServer}/editor/${this.kbGuid}/${docGuid}`;
		return {
			editorToken,
			base,
			headers: {
				accept: 'application/json, text/plain, */*',
				origin: 'https://www.wiz.cn',
				referer: 'https://www.wiz.cn/',
				'user-agent': 'Mozilla/5.0',
				'x-live-editor-token': editorToken,
				'x-live-editor-base-url': btoa(base),
			},
		};
	}
}

export async function testWizConnection(
	settings: WizFolderSyncSettings,
): Promise<string> {
	const client = await WizClient.login(settings);
	const summary = client.getConnectionSummary();
	return t('noticeConnectionOk', {
		userId: summary.userId,
		kbGuid: summary.kbGuid,
		kbServer: summary.kbServer,
	});
}

const DELETED_ITEMS_CATEGORY = '/deleted items/';

export function listNestedCategories(
	categories: Set<string>,
	rootCategory: string,
): string[] {
	const normalizedRoot = normalizeCategoryPath(rootCategory, { allowRoot: true });

	if (normalizedRoot === '/') {
		return [...categories]
			.filter((category) => !isDeletedItemsCategory(category))
			.sort();
	}

	const result = new Set<string>([normalizedRoot]);

	for (const category of categories) {
		if (
			(category === normalizedRoot || category.startsWith(normalizedRoot)) &&
			!isDeletedItemsCategory(category)
		) {
			result.add(category);
		}
	}

	return [...result].sort();
}

function isDeletedItemsCategory(category: string): boolean {
	const normalized = normalizeCategoryPath(category, { allowRoot: true }).toLowerCase();
	return (
		normalized === DELETED_ITEMS_CATEGORY ||
		normalized.startsWith(DELETED_ITEMS_CATEGORY)
	);
}

export function isSupportedRemoteNoteType(type: string): boolean {
	return [
		'lite/markdown',
		'collaboration',
		'outline',
		'document',
		'journal',
		'TemplateNote',
		'tasklist',
	].includes(
		normalizeNoteType(type),
	);
}

function validateCredentials(settings: WizFolderSyncSettings) {
	if (!settings.userId.trim()) {
		throw new Error(t('errorWizAccountRequired'));
	}

	if (!settings.password) {
		throw new Error(t('errorWizPasswordRequired'));
	}
}

function normalizeBaseUrl(url: string): string {
	const normalized = (url.trim() || 'https://note.wiz.cn').replace(/\/+$/, '');
	try {
		return new URL(normalized).toString().replace(/\/+$/, '');
	} catch {
		throw new Error(t('errorAccountServerInvalid'));
	}
}

function collectCategoryPaths(value: unknown, categories: Set<string>) {
	if (typeof value === 'string') {
		if (value.startsWith('/') && value.endsWith('/')) {
			categories.add(normalizeCategoryPath(value));
		}
		return;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectCategoryPaths(item, categories);
		}
		return;
	}

	if (!value || typeof value !== 'object') {
		return;
	}

	for (const nestedValue of Object.values(value)) {
		collectCategoryPaths(nestedValue, categories);
	}
}

function normalizeNoteSummary(value: unknown): WizNoteSummary | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const item = value as Record<string, unknown>;
	const docGuid = readString(item.docGuid) ?? readString(item.guid);
	const title = readString(item.title);
	const category = readString(item.category);
	const type = normalizeNoteType(readString(item.type));
	const dataModified = toTimestamp(
		item.dataModified ?? item.modified ?? item.dtModified ?? item.created,
	);

	if (!docGuid || !title || !category) {
		return null;
	}

	return {
		docGuid,
		title: ensureMarkdownTitle(title),
		category,
		dataModified,
		type,
	};
}

function normalizeNoteType(type: string | null | undefined): string {
	return type?.trim() || 'document';
}

function isDocumentLikeType(type: string): boolean {
	return ['document', 'journal', 'TemplateNote', 'tasklist'].includes(type);
}

function normalizeResource(value: unknown): WizNoteResource | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const item = value as Record<string, unknown>;
	const name = readString(item.name);
	const url = readString(item.url);
	if (!name || !url) {
		return null;
	}

	return {
		name,
		url,
		size: toTimestamp(item.size),
	};
}

function normalizeAttachment(value: unknown): WizNoteAttachment | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const item = value as Record<string, unknown>;
	const name = readString(item.name);
	const attGuid =
		readString(item.attGuid) ?? readString(asRecord(item.att)?.attGuid);
	if (!name || !attGuid) {
		return null;
	}

	return {
		name,
		attGuid,
		size: toTimestamp(item.dataSize ?? item.size ?? asRecord(item.att)?.dataSize),
	};
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function toTimestamp(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim()) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric;
		}

		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return 0;
}

interface RequestOptions {
	method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	url: string;
	body?: Record<string, unknown>;
	query?: Record<string, string | number>;
	token?: string;
	returnFullResult?: boolean;
}

async function execRequest<T>(options: RequestOptions): Promise<T> {
	const finalUrl = withQuery(options.url, options.query);
	const headers: Record<string, string> = {};
	if (options.token) {
		headers['X-Wiz-Token'] = options.token;
	}

	const response = await requestUrl({
		url: finalUrl,
		method: options.method,
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
		contentType: options.body ? 'application/json' : undefined,
		throw: false,
	});

	const data = parseResponseBody<T>(response.json, response.text);

	if (response.status >= 400) {
		throw new WizApiError(
			data.returnMessage ?? `HTTP ${response.status}`,
			data.returnCode ?? data.code ?? response.status,
		);
	}

	if (data.returnCode !== undefined && data.returnCode !== 200) {
		throw new WizApiError(
			data.returnMessage ?? 'WizNote API error',
			data.returnCode,
		);
	}

	if (data.code !== undefined && data.code !== 200) {
		throw new WizApiError(data.returnMessage ?? 'WizNote API error', data.code);
	}

	if (options.returnFullResult) {
		return data as T;
	}

	if ('result' in data) {
		return (data.result ?? {}) as T;
	}

	return data as T;
}

interface FormRequestOptions {
	method: 'POST' | 'PUT';
	url: string;
	body: FormData;
	query?: Record<string, string | number>;
	token?: string;
}

async function execFormRequest<T>(options: FormRequestOptions): Promise<T> {
	const finalUrl = withQuery(options.url, options.query);
	const headers: Record<string, string> = {};
	if (options.token) {
		headers['X-Wiz-Token'] = options.token;
	}

	const response = await window.fetch(finalUrl, {
		method: options.method,
		headers,
		body: options.body,
	});
	const parsed = parseResponseBody<T>(await readJsonIfPresent(response), await response.text().catch(() => ''));

	if (!response.ok) {
		throw new WizApiError(
			parsed.returnMessage ?? `HTTP ${response.status}`,
			parsed.returnCode ?? parsed.code ?? response.status,
		);
	}

	if ('result' in parsed) {
		return (parsed.result ?? {}) as T;
	}

	return parsed as T;
}

function parseResponseBody<T>(
	json: unknown,
	text: string,
): WizResponse<T> {
	if (json && typeof json === 'object') {
		return json;
	}

	if (!text) {
		return {};
	}

	try {
		return JSON.parse(text) as WizResponse<T>;
	} catch {
		return { raw: text };
	}
}

async function readJsonIfPresent(response: Response): Promise<unknown> {
	const contentType = response.headers.get('content-type') ?? '';
	if (!contentType.includes('json')) {
		return null;
	}

	try {
		return await response.clone().json();
	} catch {
		return null;
	}
}

function withQuery(
	url: string,
	query: Record<string, string | number> | undefined,
): string {
	if (!query || Object.keys(query).length === 0) {
		return url;
	}

	const nextUrl = new URL(url);
	for (const [key, value] of Object.entries(query)) {
		nextUrl.searchParams.set(key, String(value));
	}
	return nextUrl.toString();
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function readCollaborationBlocks(
	value: unknown,
): Record<string, unknown>[] | null {
	const root = asRecord(value);
	const data = asRecord(root?.data);
	const inner = asRecord(data?.data);
	const blocks = inner?.blocks;
	if (!Array.isArray(blocks)) {
		return null;
	}
	return blocks.filter((item): item is Record<string, unknown> => !!asRecord(item));
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function extractCollaborationUploadName(value: unknown): string | null {
	if (!Array.isArray(value)) {
		return null;
	}

	const [first] = value as unknown[];
	return readString(first);
}

function guessMime(name: string): string {
	const extension = name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
	switch (extension) {
		case 'png':
			return 'image/png';
		case 'jpg':
		case 'jpeg':
			return 'image/jpeg';
		case 'gif':
			return 'image/gif';
		case 'webp':
			return 'image/webp';
		case 'svg':
			return 'image/svg+xml';
		case 'mp3':
			return 'audio/mpeg';
		case 'wav':
			return 'audio/wav';
		case 'ogg':
			return 'audio/ogg';
		case 'm4a':
			return 'audio/mp4';
		case 'mp4':
			return 'video/mp4';
		case 'webm':
			return 'video/webm';
		case 'pdf':
			return 'application/pdf';
		default:
			return 'application/octet-stream';
	}
}

async function hashBytes(data: Uint8Array): Promise<string> {
	const input = new Uint8Array(data.byteLength);
	input.set(data);
	const digest = await crypto.subtle.digest('SHA-256', input.buffer);
	return encodeBase64Url(new Uint8Array(digest));
}

function encodeBase64Url(data: Uint8Array): string {
	let binary = '';
	for (const byte of data) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizeCategoryPath(
	category: string,
	options?: { allowRoot?: boolean },
): string {
	const segments = category
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);

	if (segments.length === 0) {
		if (options?.allowRoot) {
			return '/';
		}
		throw new Error(t('errorTargetCategoryRequired'));
	}

	return `/${segments.join('/')}/`;
}

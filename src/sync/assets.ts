import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { sanitizeLocalPathSegment } from '../path';
import type { SyncedAssetRecord } from '../settings';
import type { WizClient } from '../wiz/client';

const ATTACHMENTS_START = '<!-- wiz-folder-sync:attachments:start -->';
const ATTACHMENTS_END = '<!-- wiz-folder-sync:attachments:end -->';
const MARKDOWN_LINK_RE = /(!?\[[^\]]*]\()(<[^>\n]+>|[^)\n]+?)(\))/g;
const WIKI_LINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g;
const HTML_ATTR_RE = /\b(src|href)=["']([^"']+)["']/g;

interface ReferenceMatch {
	start: number;
	end: number;
	target: string;
	replace: (nextTarget: string) => string;
}

interface LocalAssetReference extends ReferenceMatch {
	vaultPath: string;
	file: TFile;
}

interface RemoteAssetFile {
	name: string;
	data: ArrayBuffer;
}

interface Logger {
	(level: 'info' | 'warn' | 'error', scope: string, message: string, detail?: string): void;
}

export interface PreparedMarkdownResult {
	markdown: string;
	assetMappings?: Record<string, SyncedAssetRecord>;
	resourceNames: string[];
}

export async function prepareMarkdownForRemoteSync(options: {
	app: App;
	client: WizClient;
	file: TFile;
	docGuid: string;
	markdown: string;
	noteType: string;
	existingMappings?: Record<string, SyncedAssetRecord>;
	logger?: Logger;
}): Promise<PreparedMarkdownResult> {
	const transport =
		options.noteType === 'collaboration'
			? 'collaboration-resource'
			: 'legacy-resource';
	const markdown = stripManagedAttachmentsSection(options.markdown).trimEnd();
	const references = collectLocalAssetReferences(
		options.app,
		options.file,
		markdown,
		options.logger,
	);

	if (references.length === 0) {
		return {
			markdown,
			assetMappings: undefined,
			resourceNames: [],
		};
	}

	let rewritten = markdown;
	let offset = 0;
	const assetMappings: Record<string, SyncedAssetRecord> = {};
	const resourceNames = new Set<string>();

	for (const reference of references) {
		const currentFileMtime = reference.file.stat.mtime;
		const existing = options.existingMappings?.[reference.vaultPath];
		let remoteName: string | null =
			existing &&
			existing.fileMtime === currentFileMtime &&
			existing.transport === transport
				? existing.remoteName
				: null;

		if (!remoteName) {
			const data = await options.app.vault.readBinary(reference.file);
			if (transport === 'collaboration-resource') {
				const uploaded = await options.client.uploadCollaborationResource(
					options.docGuid,
					data,
					reference.file.name,
				);
				remoteName = uploaded.src;
			} else {
				const uploaded = await options.client.uploadLegacyResource(
					options.docGuid,
					data,
					reference.file.name,
				);
				remoteName = uploaded.name;
			}
			options.logger?.(
				'info',
				'assets',
				`Uploaded asset ${reference.file.path} -> ${remoteName}`,
			);
		}

		resourceNames.add(remoteName);
		assetMappings[reference.vaultPath] = {
			fileMtime: currentFileMtime,
			remoteName,
			transport,
		};

		const nextTarget =
			transport === 'collaboration-resource'
				? remoteName
				: `index_files/${remoteName}`;
		const replacement = reference.replace(nextTarget);
		const start = reference.start + offset;
		const end = reference.end + offset;
		rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(end)}`;
		offset += replacement.length - (reference.end - reference.start);
	}

	return {
		markdown: rewritten,
		assetMappings,
		resourceNames: [...resourceNames],
	};
}

export async function materializeRemoteAssets(options: {
	app: App;
	client: WizClient;
	docGuid: string;
	noteType: string;
	notePath: string;
	markdown: string;
	logger?: Logger;
}): Promise<string> {
	const cleanMarkdown = stripManagedAttachmentsSection(options.markdown).trimEnd();
	const assetDir = buildAssetDirPath(options.notePath);
	const resourceFiles = await collectRemoteResourceFiles(options);
	const attachmentFiles = await collectRemoteAttachmentFiles(options);
	const allFiles = filterWritableRemoteFiles(
		[...resourceFiles, ...attachmentFiles],
		options,
	);

	if (allFiles.length === 0) {
		await removeEmptyFolderIfExists(options.app, assetDir);
		return cleanMarkdown;
	}

	const pathMap = new Map<string, string>();
	for (const file of allFiles) {
		const localPath = await writeAssetFile(options.app, assetDir, file);
		const relative = toSiblingRelativePath(options.notePath, localPath);
		pathMap.set(file.name, relative);
	}

	let rewritten = rewriteRemoteAssetLinks(cleanMarkdown, resourceFiles, pathMap);
	const attachmentPaths = attachmentFiles
		.map((file) => pathMap.get(file.name))
		.filter((path): path is string => Boolean(path));
	if (attachmentFiles.length > 0) {
		rewritten = appendManagedAttachmentsSection(
			rewritten,
			attachmentPaths,
		);
	}

	options.logger?.(
		'info',
		'assets',
		`Downloaded ${allFiles.filter((file) => resourceFiles.includes(file)).length} resources and ${allFiles.filter((file) => attachmentFiles.includes(file)).length} attachments for ${options.notePath}`,
	);
	return rewritten;
}

function filterWritableRemoteFiles(
	files: RemoteAssetFile[],
	options: {
		docGuid: string;
		notePath: string;
		noteType: string;
		logger?: Logger;
	},
): RemoteAssetFile[] {
	return files.filter((file) => {
		if (file.data.byteLength > 0) {
			return true;
		}

		options.logger?.(
			'warn',
			'assets',
			`Skipped empty remote asset ${file.name}`,
			formatAssetLogDetail([
				['docGuid', options.docGuid],
				['noteType', options.noteType],
				['notePath', options.notePath],
				['assetName', file.name],
				['reason', 'empty payload'],
			]),
		);
		return false;
	});
}

export function stripManagedAttachmentsSection(markdown: string): string {
	return markdown
		.replace(
			new RegExp(
				`${escapeForRegex(ATTACHMENTS_START)}[\\s\\S]*?${escapeForRegex(ATTACHMENTS_END)}\\n?`,
				'g',
			),
			'',
		)
		.trimEnd();
}

function appendManagedAttachmentsSection(
	markdown: string,
	paths: string[],
): string {
	if (paths.length === 0) {
		return markdown;
	}

	const sectionLines = [
		ATTACHMENTS_START,
		'## WizNote attachments',
		...paths.map((path) => `- [${basename(path)}](${path})`),
		ATTACHMENTS_END,
	];
	return `${markdown}\n\n${sectionLines.join('\n')}\n`;
}

function collectLocalAssetReferences(
	app: App,
	file: TFile,
	markdown: string,
	logger?: Logger,
): LocalAssetReference[] {
	const references = collectReferenceMatches(markdown)
		.map((match) => resolveLocalReference(app, file, match))
		.filter((match): match is LocalAssetReference => match !== null);

	if (references.length === 0) {
		logger?.('info', 'assets', `No local assets found in ${file.path}`);
	}
	return references;
}

function resolveLocalReference(
	app: App,
	file: TFile,
	reference: ReferenceMatch,
): LocalAssetReference | null {
	const normalizedTarget = normalizeLinkTarget(reference.target);
	if (!normalizedTarget || isExternalTarget(normalizedTarget)) {
		return null;
	}

	const resolvedPath = resolveVaultPath(file.path, normalizedTarget);
	const asset = app.vault.getAbstractFileByPath(resolvedPath);
	if (!(asset instanceof TFile) || asset.extension === 'md') {
		return null;
	}

	return {
		...reference,
		vaultPath: asset.path,
		file: asset,
	};
}

function collectReferenceMatches(markdown: string): ReferenceMatch[] {
	const matches: ReferenceMatch[] = [];

	for (const match of markdown.matchAll(MARKDOWN_LINK_RE)) {
		const [full = '', prefix = '', rawTarget = '', suffix = ''] = match;
		const start = match.index ?? -1;
		if (start < 0) {
			continue;
		}
		matches.push({
			start,
			end: start + full.length,
			target: extractPrimaryTarget(rawTarget),
			replace: (nextTarget) => `${prefix}${wrapTarget(rawTarget, nextTarget)}${suffix}`,
		});
	}

	for (const match of markdown.matchAll(WIKI_LINK_RE)) {
		const [full = '', embedMarker = '', rawBody = ''] = match;
		const start = match.index ?? -1;
		if (start < 0) {
			continue;
		}

		const { target, alias } = parseWikiLinkBody(rawBody);
		const isEmbed = embedMarker === '!';
		matches.push({
			start,
			end: start + full.length,
			target,
			replace: (nextTarget) =>
				isEmbed
					? `![${alias ?? ''}](${nextTarget})`
					: `[${alias ?? basename(target)}](${nextTarget})`,
		});
	}

	for (const match of markdown.matchAll(HTML_ATTR_RE)) {
		const [full = '', attr = '', rawTarget = ''] = match;
		const start = match.index ?? -1;
		if (start < 0) {
			continue;
		}
		const quote = full.includes('"') ? '"' : "'";
		matches.push({
			start,
			end: start + full.length,
			target: rawTarget,
			replace: (nextTarget) => `${attr}=${quote}${nextTarget}${quote}`,
		});
	}

	return matches.sort((left, right) => left.start - right.start);
}

async function collectRemoteResourceFiles(options: {
	app: App;
	client: WizClient;
	docGuid: string;
	noteType: string;
	notePath: string;
	markdown: string;
	logger?: Logger;
}): Promise<RemoteAssetFile[]> {
	if (options.noteType === 'collaboration') {
		let resources: Array<{ name: string; blockType: string }>;
		try {
			resources = await options.client.listCollaborationResources(options.docGuid);
		} catch (error) {
			options.logger?.(
				'error',
				'assets',
				`Failed to list collaboration resources for ${options.docGuid}`,
				formatAssetLogDetail([
					['docGuid', options.docGuid],
					['noteType', options.noteType],
					['notePath', options.notePath],
					['stage', 'listCollaborationResources'],
					['error', error instanceof Error ? error.message : String(error)],
				]),
			);
			throw error;
		}
		return await Promise.all(
			resources.map(async (resource) => {
				try {
					return {
						name: resource.name,
						data: await options.client.downloadCollaborationResource(
							options.docGuid,
							resource.name,
						),
					};
				} catch (error) {
					options.logger?.(
						'error',
						'assets',
						`Failed to download collaboration resource ${resource.name}`,
						formatAssetLogDetail([
							['docGuid', options.docGuid],
							['noteType', options.noteType],
							['notePath', options.notePath],
							['stage', 'downloadCollaborationResource'],
							['resourceName', resource.name],
							['blockType', resource.blockType],
							['error', error instanceof Error ? error.message : String(error)],
						]),
					);
					throw error;
				}
			}),
		);
	}

	let resources;
	try {
		resources = await options.client.listNoteResources(options.docGuid);
	} catch (error) {
		options.logger?.(
			'error',
			'assets',
			`Failed to list remote resources for ${options.docGuid}`,
			formatAssetLogDetail([
				['docGuid', options.docGuid],
				['noteType', options.noteType],
				['notePath', options.notePath],
				['stage', 'listNoteResources'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		);
		throw error;
	}
	return await Promise.all(
		resources.map(async (resource) => {
			try {
				return {
					name: resource.name,
					data: await options.client.downloadLegacyResource(resource.url),
				};
			} catch (error) {
				options.logger?.(
					'error',
					'assets',
					`Failed to download remote resource ${resource.name}`,
					formatAssetLogDetail([
						['docGuid', options.docGuid],
						['noteType', options.noteType],
						['notePath', options.notePath],
						['stage', 'downloadLegacyResource'],
						['resourceName', resource.name],
						['resourceUrl', resource.url],
						['error', error instanceof Error ? error.message : String(error)],
					]),
				);
				throw error;
			}
		}),
	);
}

async function collectRemoteAttachmentFiles(options: {
	app: App;
	client: WizClient;
	docGuid: string;
	noteType: string;
	notePath: string;
	markdown: string;
	logger?: Logger;
}): Promise<RemoteAssetFile[]> {
	let attachments;
	try {
		attachments = await options.client.listNoteAttachments(options.docGuid);
	} catch (error) {
		options.logger?.(
			'error',
			'assets',
			`Failed to list note attachments for ${options.docGuid}`,
			formatAssetLogDetail([
				['docGuid', options.docGuid],
				['noteType', options.noteType],
				['notePath', options.notePath],
				['stage', 'listNoteAttachments'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		);
		throw error;
	}
	return await Promise.all(
		attachments.map(async (attachment) => {
			try {
				return {
					name: attachment.name,
					data: await options.client.downloadNoteAttachment(
						options.docGuid,
						attachment.attGuid,
					),
				};
			} catch (error) {
				options.logger?.(
					'error',
					'assets',
					`Failed to download note attachment ${attachment.name}`,
					formatAssetLogDetail([
						['docGuid', options.docGuid],
						['noteType', options.noteType],
						['notePath', options.notePath],
						['stage', 'downloadNoteAttachment'],
						['attachmentName', attachment.name],
						['attGuid', attachment.attGuid],
						['error', error instanceof Error ? error.message : String(error)],
					]),
				);
				throw error;
			}
		}),
	);
}

function rewriteRemoteAssetLinks(
	markdown: string,
	resources: RemoteAssetFile[],
	pathMap: Map<string, string>,
): string {
	let rewritten = markdown;
	const resourcesByName = new Map(resources.map((resource) => [resource.name, resource]));
	const references = collectReferenceMatches(markdown);
	let offset = 0;

	for (const reference of references) {
		const normalizedTarget = normalizeLinkTarget(reference.target);
		const resourceName = matchRemoteResourceName(normalizedTarget, resourcesByName);
		if (!resourceName) {
			continue;
		}

		const localPath = pathMap.get(resourceName);
		if (!localPath) {
			continue;
		}

		const replacement = reference.replace(localPath);
		const start = reference.start + offset;
		const end = reference.end + offset;
		rewritten = `${rewritten.slice(0, start)}${replacement}${rewritten.slice(end)}`;
		offset += replacement.length - (reference.end - reference.start);
	}

	return rewritten;
}

function matchRemoteResourceName(
	target: string,
	resourcesByName: Map<string, RemoteAssetFile>,
): string | null {
	if (!target) {
		return null;
	}

	if (resourcesByName.has(target)) {
		return target;
	}

	const legacyName = target.startsWith('index_files/')
		? target.slice('index_files/'.length)
		: null;
	if (legacyName && resourcesByName.has(legacyName)) {
		return legacyName;
	}

	try {
		const url = new URL(target);
		for (const name of resourcesByName.keys()) {
			if (url.pathname.endsWith(`/${name}`) || url.pathname.endsWith(`/index_files/${name}`)) {
				return name;
			}
		}
	} catch {
		// Ignore invalid URLs.
	}

	return null;
}

async function writeAssetFile(
	app: App,
	assetDir: string,
	file: RemoteAssetFile,
): Promise<string> {
	const localPath = normalizePath(
		`${assetDir}/${sanitizeLocalPathSegment(file.name)}`,
	);
	const existing = app.vault.getAbstractFileByPath(localPath);
	if (existing instanceof TFile) {
		await app.vault.modifyBinary(existing, file.data);
		return existing.path;
	}

	await ensureFolderExists(app, assetDir);
	const created = await app.vault.createBinary(localPath, file.data);
	return created.path;
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	if (!folderPath) {
		return;
	}

	const existing = app.vault.getAbstractFileByPath(folderPath);
	if (existing instanceof TFolder) {
		return;
	}

	const segments = normalizePath(folderPath).split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await app.vault.adapter.exists(current))) {
			await app.vault.adapter.mkdir(current);
		}
	}
}

async function removeEmptyFolderIfExists(app: App, folderPath: string): Promise<void> {
	if (!folderPath || !(await app.vault.adapter.exists(folderPath))) {
		return;
	}

	const listed = await app.vault.adapter.list(folderPath);
	if (listed.files.length > 0 || listed.folders.length > 0) {
		return;
	}

	await app.vault.adapter.remove(folderPath);
}

function resolveVaultPath(filePath: string, target: string): string {
	if (target.startsWith('/')) {
		return normalizePath(target.replace(/^\/+/, ''));
	}

	const noteFolder = parentFolder(filePath);
	return normalizePath(noteFolder ? `${noteFolder}/${target}` : target);
}

function normalizeLinkTarget(target: string): string {
	const trimmed = target.trim().replace(/^<|>$/g, '');
	const withoutMeta = trimmed.replace(/[?#].*$/, '');
	try {
		return decodeURI(withoutMeta);
	} catch {
		return withoutMeta;
	}
}

function extractPrimaryTarget(rawTarget: string): string {
	const trimmed = rawTarget.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return trimmed.slice(1, -1);
	}

	const titleMatch = trimmed.match(/^(.+?)\s+(['"(]).*$/);
	return titleMatch?.[1] ?? trimmed;
}

function parseWikiLinkBody(rawBody: string): {
	target: string;
	alias?: string;
} {
	const [rawTarget, rawAlias] = rawBody.split('|');
	const target = (rawTarget ?? '').trim();
	const alias = rawAlias?.trim() || undefined;
	return { target, alias };
}

function wrapTarget(original: string, nextTarget: string): string {
	const trimmed = original.trim();
	if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
		return `<${nextTarget}>`;
	}
	return nextTarget;
}

function buildAssetDirPath(notePath: string): string {
	const parent = parentFolder(notePath);
	const base = basenameWithoutExtension(notePath);
	return parent ? normalizePath(`${parent}/${base}.assets`) : `${base}.assets`;
}

function toSiblingRelativePath(notePath: string, assetPath: string): string {
	const noteFolder = parentFolder(notePath);
	if (!noteFolder) {
		return assetPath;
	}
	return normalizePath(assetPath.slice(noteFolder.length + 1));
}

function parentFolder(path: string): string {
	const parts = normalizePath(path).split('/');
	parts.pop();
	return parts.join('/');
}

function basename(path: string): string {
	return normalizePath(path).split('/').pop() ?? path;
}

function basenameWithoutExtension(path: string): string {
	const name = basename(path);
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

function escapeForRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isExternalTarget(target: string): boolean {
	return /^(https?:|mailto:|data:|#|ftp:|obsidian:)/i.test(target);
}

function formatAssetLogDetail(
	entries: Array<[string, string | number | undefined]>,
): string {
	return entries
		.filter(([, value]) => value !== undefined && value !== '')
		.map(([key, value]) => `${key}: ${String(value)}`)
		.join('\n');
}

import { App, normalizePath, TFile, TFolder } from 'obsidian';
import { formatLogDetail } from '../logging';
import { t } from '../i18n';
import { sanitizeLocalPathSegment } from '../path';
import type { PluginState, SyncRecord, WizFolderSyncSettings } from '../settings';
import {
	materializeRemoteAssets,
	prepareMarkdownForRemoteSync,
} from './assets';
import {
	isSupportedRemoteNoteType,
	listNestedCategories,
	type WizNoteSummary,
	type WizRemoteNote,
	WizClient,
	normalizeCategoryPath,
} from '../wiz/client';
import { ensureMarkdownTitle } from '../wiz/markdown';

interface SyncContext {
	app: App;
	settings: WizFolderSyncSettings;
	state: PluginState;
	onProgress?: (message: string) => void;
	onLog?: (entry: {
		level?: 'info' | 'warn' | 'error';
		scope?: string;
		message: string;
		detail?: string;
	}) => void;
	saveState: () => Promise<void>;
}

export interface SyncResult {
	scanned: number;
	created: number;
	updated: number;
	skipped: number;
	failed: number;
}

export async function syncFolderToWiz(
	context: SyncContext,
): Promise<SyncResult> {
	const sourceFolder = normalizeSourceFolder(context.settings.sourceFolder);
	const targetCategory = normalizeCategoryPath(
		context.settings.targetCategory,
		{ allowRoot: true },
	);
	const shouldPushLocal = context.settings.syncMode !== 'remote-to-local';
	const shouldPullRemote = context.settings.syncMode !== 'local-to-remote';
	validateSourceFolder(context.app, sourceFolder);

	const client = await WizClient.login(context.settings);
	const existingCategories = await client.getCategories();
	await ensureCategoryExists(client, existingCategories, targetCategory);
	if (shouldPushLocal) {
		await ensureRemoteFolderStructure(
			context.app,
			client,
			existingCategories,
			sourceFolder,
			targetCategory,
			context.onLog,
		);
	}
	const remoteNotes = shouldPullRemote
		? await collectRemoteNotes(client, existingCategories, targetCategory)
		: [];
	const dedupedRemoteNotes = shouldPullRemote
		? dedupeRemoteNotesByPath(
				remoteNotes,
				context.state.records,
				sourceFolder,
				targetCategory,
				context.onLog,
			)
		: remoteNotes;
	const remoteByDocGuid = new Map(
		dedupedRemoteNotes.map((note) => [note.docGuid, note]),
	);

	if (shouldPullRemote) {
		await ensureLocalFolderStructure(
			context.app,
			sourceFolder,
			targetCategory,
			listNestedCategories(existingCategories, targetCategory),
			context.onLog,
		);
	}

	const files = collectMarkdownFiles(
		context.app,
		sourceFolder,
		targetCategory,
	);
	const localByPath = new Map(files.map((file) => [file.path, file]));
	pruneMissingRecords(context.state.records, sourceFolder, new Set(localByPath.keys()));

	context.onProgress?.(
		t('progressPreparing', {
			local: files.length,
			remote: dedupedRemoteNotes.length,
		}),
	);

	const result: SyncResult = {
		scanned: files.length + dedupedRemoteNotes.length,
		created: 0,
		updated: 0,
		skipped: 0,
		failed: 0,
	};

	if (shouldPullRemote) {
		for (let index = 0; index < dedupedRemoteNotes.length; index += 1) {
			const remoteNote = dedupedRemoteNotes[index];
			if (!remoteNote) {
				continue;
			}

			context.onProgress?.(
				t('progressReconcilingRemote', {
					index: index + 1,
					total: dedupedRemoteNotes.length,
					title: remoteNote.title,
				}),
			);
			try {
				const outcome = await reconcileRemoteNote({
					...context,
					client,
					existingCategories,
					localByPath,
					remoteByDocGuid,
					sourceFolder,
					targetCategory,
					remoteNote,
				});
				result[outcome] += 1;
				await context.saveState();
			} catch (error) {
				result.failed += 1;
				context.onLog?.({
					level: 'error',
					scope: 'sync',
					message: `Failed to reconcile remote note ${remoteNote.docGuid}`,
					detail: formatLogDetail([
						['docGuid', remoteNote.docGuid],
						['title', remoteNote.title],
						['category', remoteNote.category],
						['type', remoteNote.type],
						['desiredPath', buildLocalPathFromRemote(
							sourceFolder,
							targetCategory,
							remoteNote.category,
							remoteNote.title,
						)],
						['error', error instanceof Error ? error.message : String(error)],
					]),
				});
				console.error(
					`[wiz-folder-sync] Failed to reconcile remote note ${remoteNote.docGuid}`,
					error,
				);
			}
		}
	}

	const localFiles = [...localByPath.values()].sort((left, right) =>
		left.path.localeCompare(right.path),
	);

	if (!shouldPushLocal) {
		await context.saveState();
		return result;
	}

	for (let index = 0; index < localFiles.length; index += 1) {
		const file = localFiles[index];
		if (!file) {
			continue;
		}

		context.onProgress?.(
			t('progressReconcilingLocal', {
				index: index + 1,
				total: localFiles.length,
				path: file.path,
			}),
		);

		try {
			const outcome =
				context.settings.syncMode === 'bidirectional'
					? await reconcileLocalFile({
							...context,
							client,
							existingCategories,
							remoteByDocGuid,
							sourceFolder,
							targetCategory,
							file,
						})
					: await syncMarkdownFile({
							...context,
							client,
							existingCategories,
							sourceFolder,
							targetCategory,
							file,
						});
			result[outcome] += 1;
			await context.saveState();
		} catch (error) {
			result.failed += 1;
			context.onLog?.({
				level: 'error',
				scope: 'sync',
				message: `Failed to reconcile local file ${file.path}`,
				detail: formatLogDetail([
					['path', file.path],
					['title', ensureMarkdownTitle(file.name)],
					['targetCategory', buildRemoteCategory(
						targetCategory,
						sourceFolder,
						file.path,
					)],
					['mtime', file.stat.mtime],
					['error', error instanceof Error ? error.message : String(error)],
				]),
			});
			console.error(
				`[wiz-folder-sync] Failed to reconcile local file ${file.path}`,
				error,
			);
		}
	}

	await context.saveState();
	return result;
}

export async function syncFileToWiz(
	context: SyncContext & { file: TFile },
): Promise<'created' | 'updated' | 'skipped'> {
	if (context.settings.syncMode === 'remote-to-local') {
		return 'skipped';
	}

	const sourceFolder = normalizeSourceFolder(context.settings.sourceFolder);
	if (!isFileInSourceFolder(context.file.path, sourceFolder)) {
		throw new Error(t('errorFileOutsideSourceFolder', { path: context.file.path }));
	}

	const targetCategory = normalizeCategoryPath(
		context.settings.targetCategory,
		{ allowRoot: true },
	);
	if (!isPathInSyncScope(context.file.path, sourceFolder, targetCategory)) {
		return 'skipped';
	}
	validateSourceFolder(context.app, sourceFolder);

	const client = await WizClient.login(context.settings);
	const existingCategories = await client.getCategories();
	await ensureCategoryExists(client, existingCategories, targetCategory);

	const outcome = await syncMarkdownFile({
		...context,
		client,
		existingCategories,
		sourceFolder,
		targetCategory,
	});
	await context.saveState();
	return outcome;
}

function validateSourceFolder(app: App, sourceFolder: string) {
	if (!sourceFolder) {
		return;
	}

	const folder = app.vault.getAbstractFileByPath(sourceFolder);
	if (!folder || !(folder instanceof TFolder)) {
		throw new Error(t('errorSourceFolderMissing', { folder: sourceFolder }));
	}
}

function collectMarkdownFiles(
	app: App,
	sourceFolder: string,
	targetCategory: string,
): TFile[] {
	const files = app.vault.getMarkdownFiles();
	return files
		.filter((file) => isPathInSyncScope(file.path, sourceFolder, targetCategory))
		.sort((left, right) => left.path.localeCompare(right.path));
}

function collectFolders(
	app: App,
	sourceFolder: string,
	targetCategory: string,
): TFolder[] {
	return app.vault
		.getAllLoadedFiles()
		.filter(
			(file): file is TFolder =>
				file instanceof TFolder &&
				file.path.length > 0 &&
				isPathInSyncScope(file.path, sourceFolder, targetCategory),
		)
		.sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeSourceFolder(folder: string): string {
	return folder
		.trim()
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

function pruneMissingRecords(
	records: Record<string, SyncRecord>,
	sourceFolder: string,
	existingPaths: Set<string>,
) {
	for (const path of Object.keys(records)) {
		if (!isInSourceFolder(path, sourceFolder)) {
			continue;
		}

		if (!existingPaths.has(path)) {
			delete records[path];
		}
	}
}

function isInSourceFolder(path: string, sourceFolder: string): boolean {
	if (!sourceFolder) {
		return true;
	}

	return path === sourceFolder || path.startsWith(`${sourceFolder}/`);
}

export function isFileInSourceFolder(
	path: string,
	sourceFolder: string,
): boolean {
	return isInSourceFolder(path, sourceFolder);
}

export function isPathInSyncScope(
	path: string,
	sourceFolder: string,
	targetCategory: string,
): boolean {
	return (
		isInSourceFolder(path, sourceFolder) &&
		!isExcludedWhenSyncingAllCategories(path, sourceFolder, targetCategory)
	);
}

function isExcludedWhenSyncingAllCategories(
	path: string,
	sourceFolder: string,
	targetCategory: string,
): boolean {
	if (normalizeCategoryPath(targetCategory, { allowRoot: true }) !== '/') {
		return false;
	}

	const relativePath =
		sourceFolder && path !== sourceFolder
			? path.slice(sourceFolder.length + 1)
			: sourceFolder
				? ''
				: path;
	if (!relativePath) {
		return false;
	}

	const [firstSegment] = relativePath
		.split('/')
		.map((segment) => segment.trim())
		.filter(Boolean);
	return firstSegment?.toLowerCase() === 'deleted items';
}

async function ensureCategoryExists(
	client: WizClient,
	knownCategories: Set<string>,
	category: string,
) {
	const normalized = normalizeCategoryPath(category, { allowRoot: true });
	if (normalized === '/') {
		return;
	}
	if (knownCategories.has(normalized)) {
		return;
	}

	const segments = normalized.split('/').filter(Boolean);
	if (segments.length === 0) {
		return;
	}

	let current = `/${segments[0]}/`;
	knownCategories.add(current);

	for (let index = 1; index < segments.length; index += 1) {
		const child = segments[index];
		if (!child) {
			continue;
		}

		const next = `${current}${child}/`;
		if (!knownCategories.has(next)) {
			await client.createCategory(current, child);
			knownCategories.add(next);
		}
		current = next;
	}
}

async function ensureRemoteFolderStructure(
	app: App,
	client: WizClient,
	knownCategories: Set<string>,
	sourceFolder: string,
	targetCategory: string,
	onLog?: SyncContext['onLog'],
) {
	const folders = collectFolders(app, sourceFolder, targetCategory);
	for (const folder of folders) {
		const remoteCategory = buildRemoteCategoryForFolder(
			targetCategory,
			sourceFolder,
			folder.path,
		);
		await ensureCategoryExists(client, knownCategories, remoteCategory);
		onLog?.({
			scope: 'folder',
			message: `Ensured remote category ${remoteCategory} for ${folder.path}`,
			detail: formatLogDetail([
				['localFolder', folder.path],
				['remoteCategory', remoteCategory],
			]),
		});
	}
}

async function ensureLocalFolderStructure(
	app: App,
	sourceFolder: string,
	targetCategory: string,
	remoteCategories: string[],
	onLog?: SyncContext['onLog'],
) {
	for (const remoteCategory of remoteCategories) {
		const localFolder = buildLocalFolderPathFromRemoteCategory(
			sourceFolder,
			targetCategory,
			remoteCategory,
		);
		if (!localFolder) {
			continue;
		}

		await ensureLocalFolderExists(app, localFolder);
		onLog?.({
			scope: 'folder',
			message: `Ensured local folder ${localFolder} for ${remoteCategory}`,
			detail: formatLogDetail([
				['remoteCategory', remoteCategory],
				['localFolder', localFolder],
			]),
		});
	}
}

function buildRemoteCategory(
	targetCategory: string,
	sourceFolder: string,
	filePath: string,
): string {
	const relativePath = sourceFolder
		? filePath.slice(sourceFolder.length + 1)
		: filePath;
	const segments = relativePath.split('/');
	segments.pop();

	if (segments.length === 0) {
		return targetCategory;
	}

	return normalizeCategoryPath(`${targetCategory}${segments.join('/')}`, {
		allowRoot: true,
	});
}

function buildRemoteCategoryForFolder(
	targetCategory: string,
	sourceFolder: string,
	folderPath: string,
): string {
	if (sourceFolder && folderPath === sourceFolder) {
		return targetCategory;
	}

	const relativePath = sourceFolder
		? folderPath.slice(sourceFolder.length + 1)
		: folderPath;
	if (!relativePath) {
		return targetCategory;
	}

	return normalizeCategoryPath(`${targetCategory}${relativePath}`, {
		allowRoot: true,
	});
}

function createRecord(
	docGuid: string,
	fileMtime: number,
	remoteModified: number,
	remoteCategory: string,
	remoteTitle: string,
	remoteType: string,
	assetMappings?: SyncRecord['assetMappings'],
): SyncRecord {
	return {
		docGuid,
		fileMtime,
		remoteModified,
		remoteCategory,
		remoteTitle,
		remoteType,
		assetMappings,
	};
}

interface SingleFileSyncContext extends SyncContext {
	client: WizClient;
	existingCategories: Set<string>;
	sourceFolder: string;
	targetCategory: string;
	file: TFile;
}

async function syncMarkdownFile(
	context: SingleFileSyncContext,
): Promise<'created' | 'updated' | 'skipped'> {
	const remoteCategory = buildRemoteCategory(
		context.targetCategory,
		context.sourceFolder,
		context.file.path,
	);
	const remoteTitle = ensureMarkdownTitle(context.file.name);
	const record = context.state.records[context.file.path];

	await ensureCategoryExists(
		context.client,
		context.existingCategories,
		remoteCategory,
	);

	if (
		record &&
		record.fileMtime === context.file.stat.mtime &&
		record.remoteCategory === remoteCategory &&
		record.remoteTitle === remoteTitle &&
		record.remoteType === 'lite/markdown'
	) {
		return 'skipped';
	}

	const markdown = await context.app.vault.cachedRead(context.file);

	if (record) {
		const prepared = await prepareMarkdownForRemoteSync({
			app: context.app,
			client: context.client,
			file: context.file,
			docGuid: record.docGuid,
			markdown,
			noteType: record.remoteType,
			existingMappings: record.assetMappings,
			logger: (level, scope, message, detail) =>
				context.onLog?.({ level, scope, message, detail }),
		});
		await context.client.updateRemoteNote({
			docGuid: record.docGuid,
			title: remoteTitle,
			category: remoteCategory,
			type: record.remoteType,
			markdown: prepared.markdown,
			resources: prepared.resourceNames,
			modifiedTime: context.file.stat.mtime,
		});
		context.state.records[context.file.path] = createRecord(
			record.docGuid,
			context.file.stat.mtime,
			context.file.stat.mtime,
			remoteCategory,
			remoteTitle,
			record.remoteType,
			prepared.assetMappings,
		);
		context.onLog?.({
			scope: 'sync',
			message: `Updated remote note for ${context.file.path}`,
			detail: formatLogDetail([
				['path', context.file.path],
				['docGuid', record.docGuid],
				['remoteTitle', remoteTitle],
				['remoteCategory', remoteCategory],
				['remoteType', record.remoteType],
				['resourceCount', prepared.resourceNames.length],
				['assetCount', Object.keys(prepared.assetMappings ?? {}).length],
				['mtime', context.file.stat.mtime],
			]),
		});
		return 'updated';
	}

	const created = await context.client.createMarkdownNote({
		title: remoteTitle,
		category: remoteCategory,
		markdown,
		modifiedTime: context.file.stat.mtime,
	});
	const prepared = await prepareMarkdownForRemoteSync({
		app: context.app,
		client: context.client,
		file: context.file,
		docGuid: created.docGuid,
		markdown,
		noteType: 'lite/markdown',
		logger: (level, scope, message, detail) =>
			context.onLog?.({ level, scope, message, detail }),
	});
	if (
		prepared.markdown !== markdown ||
		prepared.resourceNames.length > 0
	) {
		await context.client.updateRemoteNote({
			docGuid: created.docGuid,
			title: remoteTitle,
			category: remoteCategory,
			type: 'lite/markdown',
			markdown: prepared.markdown,
			resources: prepared.resourceNames,
			modifiedTime: context.file.stat.mtime,
		});
	}
	context.state.records[context.file.path] = createRecord(
		created.docGuid,
		context.file.stat.mtime,
		context.file.stat.mtime,
		remoteCategory,
		remoteTitle,
		'lite/markdown',
		prepared.assetMappings,
	);
	context.onLog?.({
		scope: 'sync',
		message: `Created remote note for ${context.file.path}`,
		detail: formatLogDetail([
			['path', context.file.path],
			['docGuid', created.docGuid],
			['remoteTitle', remoteTitle],
			['remoteCategory', remoteCategory],
			['remoteType', 'lite/markdown'],
			['resourceCount', prepared.resourceNames.length],
			['assetCount', Object.keys(prepared.assetMappings ?? {}).length],
			['mtime', context.file.stat.mtime],
		]),
	});
	return 'created';
}

interface RemoteReconcileContext extends SyncContext {
	client: WizClient;
	existingCategories: Set<string>;
	localByPath: Map<string, TFile>;
	remoteByDocGuid: Map<string, WizNoteSummary>;
	sourceFolder: string;
	targetCategory: string;
	remoteNote: WizNoteSummary;
}

interface LocalReconcileContext extends SyncContext {
	client: WizClient;
	existingCategories: Set<string>;
	remoteByDocGuid: Map<string, WizNoteSummary>;
	sourceFolder: string;
	targetCategory: string;
	file: TFile;
}

async function collectRemoteNotes(
	client: WizClient,
	categories: Set<string>,
	targetCategory: string,
): Promise<WizNoteSummary[]> {
	const notes: WizNoteSummary[] = [];
	for (const category of listNestedCategories(categories, targetCategory)) {
		const categoryNotes = await client.listCategoryNotes(category);
		for (const note of categoryNotes) {
			if (isSupportedRemoteNoteType(note.type)) {
				notes.push(note);
			}
		}
	}

	return notes;
}

function dedupeRemoteNotesByPath(
	notes: WizNoteSummary[],
	records: Record<string, SyncRecord>,
	sourceFolder: string,
	targetCategory: string,
	onLog?: SyncContext['onLog'],
): WizNoteSummary[] {
	const existingDocGuidByPath = new Map(
		Object.entries(records).map(([path, record]) => [path, record.docGuid]),
	);
	const selectedByPath = new Map<string, WizNoteSummary>();

	for (const note of notes) {
		const desiredPath = buildLocalPathFromRemote(
			sourceFolder,
			targetCategory,
			note.category,
			note.title,
		);
		const current = selectedByPath.get(desiredPath);
		if (!current) {
			selectedByPath.set(desiredPath, note);
			continue;
		}

		const existingDocGuid = existingDocGuidByPath.get(desiredPath);
		const currentMatchesExisting = current.docGuid === existingDocGuid;
		const nextMatchesExisting = note.docGuid === existingDocGuid;

		let winner = current;
		if (currentMatchesExisting !== nextMatchesExisting) {
			winner = nextMatchesExisting ? note : current;
		} else if (note.dataModified > current.dataModified) {
			winner = note;
		} else if (
			note.dataModified === current.dataModified &&
			note.docGuid.localeCompare(current.docGuid) > 0
		) {
			winner = note;
		}

		if (winner !== current) {
			selectedByPath.set(desiredPath, winner);
		}

		onLog?.({
			level: 'warn',
			scope: 'sync',
			message: `Skipped duplicate remote note for ${desiredPath}`,
			detail: formatLogDetail([
				['desiredPath', desiredPath],
				['keptDocGuid', winner.docGuid],
				['keptTitle', winner.title],
				['keptCategory', winner.category],
				['keptModified', winner.dataModified],
				['skippedDocGuid', winner === current ? note.docGuid : current.docGuid],
				['existingRecordDocGuid', existingDocGuid ?? '(none)'],
			]),
		});
	}

	return [...selectedByPath.values()];
}

async function reconcileRemoteNote(
	context: RemoteReconcileContext,
): Promise<'created' | 'updated' | 'skipped'> {
	const desiredPath = buildLocalPathFromRemote(
		context.sourceFolder,
		context.targetCategory,
		context.remoteNote.category,
		context.remoteNote.title,
	);
	const recordEntry = findRecordByDocGuid(
		context.state.records,
		context.remoteNote.docGuid,
	);
	let localFile = recordEntry
		? context.localByPath.get(recordEntry.path) ?? null
		: (context.localByPath.get(desiredPath) ?? null);

	if (localFile && localFile.path !== desiredPath) {
		localFile = await moveLocalFile(context.app, localFile, desiredPath);
		context.localByPath.delete(recordEntry?.path ?? '');
		context.localByPath.set(localFile.path, localFile);
	}

	if (!localFile) {
		const created = await createLocalFileFromRemote(context, desiredPath);
		context.localByPath.set(created.path, created);
		return 'created';
	}

	const localChangedSinceSync =
		!recordEntry || localFile.stat.mtime !== recordEntry.record.fileMtime;
	const remoteChangedSinceSync =
		!recordEntry ||
		context.remoteNote.dataModified !== recordEntry.record.remoteModified ||
		recordEntry.record.remoteCategory !== context.remoteNote.category ||
		recordEntry.record.remoteTitle !== context.remoteNote.title ||
		recordEntry.record.remoteType !== context.remoteNote.type;

	if (!localChangedSinceSync && !remoteChangedSinceSync) {
		return 'skipped';
	}

	if (context.remoteNote.dataModified > localFile.stat.mtime) {
		const updated = await writeRemoteToLocal(context, localFile, desiredPath);
		context.localByPath.set(updated.path, updated);
		return 'updated';
	}

	if (context.remoteNote.dataModified < localFile.stat.mtime) {
		if (context.settings.syncMode === 'remote-to-local') {
			const updated = await writeRemoteToLocal(context, localFile, desiredPath);
			context.localByPath.set(updated.path, updated);
			return 'updated';
		}

		await syncMarkdownFile({
			...context,
			file: localFile,
		});
		return 'updated';
	}

	const updated = await writeRemoteToLocal(context, localFile, desiredPath);
	context.localByPath.set(updated.path, updated);
	return 'updated';
}

async function reconcileLocalFile(
	context: LocalReconcileContext,
): Promise<'created' | 'updated' | 'skipped'> {
	const record = context.state.records[context.file.path];
	const remoteNote = record
		? context.remoteByDocGuid.get(record.docGuid) ?? null
		: null;

	if (remoteNote) {
		if (
			record &&
			record.fileMtime === context.file.stat.mtime &&
			record.remoteModified === remoteNote.dataModified &&
			record.remoteCategory === remoteNote.category &&
			record.remoteTitle === remoteNote.title
		) {
			return 'skipped';
		}

		if (context.file.stat.mtime > remoteNote.dataModified) {
			await syncMarkdownFile({
				...context,
				file: context.file,
			});
			return 'updated';
		}

		return 'skipped';
	}

	await syncMarkdownFile({
		...context,
		file: context.file,
	});
	return 'created';
}

async function createLocalFileFromRemote(
	context: RemoteReconcileContext,
	path: string,
): Promise<TFile> {
	let remote;
	try {
		remote = await context.client.readRemoteNote(context.remoteNote.docGuid);
	} catch (error) {
		context.onLog?.({
			level: 'error',
			scope: 'assets',
			message: `Failed to read remote note body ${context.remoteNote.docGuid}`,
			detail: formatLogDetail([
				['docGuid', context.remoteNote.docGuid],
				['remoteType', context.remoteNote.type],
				['desiredPath', path],
				['stage', 'readRemoteNote'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		});
		throw error;
	}
	let markdown;
	try {
		markdown = await materializeRemoteAssets({
			app: context.app,
			client: context.client,
			docGuid: context.remoteNote.docGuid,
			noteType: context.remoteNote.type,
			notePath: path,
			markdown: remote.markdown,
			logger: (level, scope, message, detail) =>
				context.onLog?.({ level, scope, message, detail }),
		});
	} catch (error) {
		context.onLog?.({
			level: 'error',
			scope: 'assets',
			message: `Failed to materialize remote assets for ${context.remoteNote.docGuid}`,
			detail: formatLogDetail([
				['docGuid', context.remoteNote.docGuid],
				['remoteType', context.remoteNote.type],
				['desiredPath', path],
				['stage', 'materializeRemoteAssets'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		});
		throw error;
	}
	await ensureLocalFolderExists(context.app, parentFolderOf(path));
	const created = await context.app.vault.create(path, markdown);
	context.state.records[path] = createRecordFromRemote(
		context.remoteNote.docGuid,
		created.stat.mtime,
		remote,
	);
	context.onLog?.({
		scope: 'sync',
		message: `Created local note from remote ${context.remoteNote.docGuid}`,
		detail: formatLogDetail([
			['docGuid', context.remoteNote.docGuid],
			['remoteTitle', remote.title],
			['remoteCategory', remote.category],
			['remoteType', remote.type],
			['localPath', created.path],
			['localMtime', created.stat.mtime],
		]),
	});
	return created;
}

async function writeRemoteToLocal(
	context: RemoteReconcileContext,
	file: TFile,
	desiredPath: string,
): Promise<TFile> {
	let target = file;
	if (file.path !== desiredPath) {
		target = await moveLocalFile(context.app, file, desiredPath);
	}

	let remote;
	try {
		remote = await context.client.readRemoteNote(context.remoteNote.docGuid);
	} catch (error) {
		context.onLog?.({
			level: 'error',
			scope: 'assets',
			message: `Failed to read remote note body ${context.remoteNote.docGuid}`,
			detail: formatLogDetail([
				['docGuid', context.remoteNote.docGuid],
				['remoteType', context.remoteNote.type],
				['desiredPath', target.path],
				['stage', 'readRemoteNote'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		});
		throw error;
	}
	let markdown;
	try {
		markdown = await materializeRemoteAssets({
			app: context.app,
			client: context.client,
			docGuid: context.remoteNote.docGuid,
			noteType: context.remoteNote.type,
			notePath: target.path,
			markdown: remote.markdown,
			logger: (level, scope, message, detail) =>
				context.onLog?.({ level, scope, message, detail }),
		});
	} catch (error) {
		context.onLog?.({
			level: 'error',
			scope: 'assets',
			message: `Failed to materialize remote assets for ${context.remoteNote.docGuid}`,
			detail: formatLogDetail([
				['docGuid', context.remoteNote.docGuid],
				['remoteType', context.remoteNote.type],
				['desiredPath', target.path],
				['stage', 'materializeRemoteAssets'],
				['error', error instanceof Error ? error.message : String(error)],
			]),
		});
		throw error;
	}
	await context.app.vault.modify(target, markdown);
	const refreshed = getFileByPath(context.app, target.path);
	context.state.records[refreshed.path] = createRecordFromRemote(
		context.remoteNote.docGuid,
		refreshed.stat.mtime,
		remote,
	);
	context.onLog?.({
		scope: 'sync',
		message: `Updated local note from remote ${context.remoteNote.docGuid}`,
		detail: formatLogDetail([
			['docGuid', context.remoteNote.docGuid],
			['remoteTitle', remote.title],
			['remoteCategory', remote.category],
			['remoteType', remote.type],
			['localPath', refreshed.path],
			['localMtime', refreshed.stat.mtime],
		]),
	});
	return refreshed;
}

function buildLocalPathFromRemote(
	sourceFolder: string,
	targetCategory: string,
	remoteCategory: string,
	title: string,
): string {
	const normalizedTitle = sanitizeLocalPathSegment(ensureMarkdownTitle(title));
	const rootSegments = normalizeCategoryPath(targetCategory, { allowRoot: true })
		.split('/')
		.filter(Boolean);
	const remoteSegments = normalizeCategoryPath(remoteCategory, { allowRoot: true })
		.split('/')
		.filter(Boolean);

	const relativeSegments =
		remoteSegments.length >= rootSegments.length &&
		rootSegments.every((segment, index) => remoteSegments[index] === segment)
			? remoteSegments.slice(rootSegments.length)
			: remoteSegments;

	const sanitizedSegments = relativeSegments.map((segment) =>
		sanitizeLocalPathSegment(segment),
	);
	const pathSegments = sourceFolder
		? [sourceFolder, ...sanitizedSegments, normalizedTitle]
		: [...sanitizedSegments, normalizedTitle];

	return normalizePath(pathSegments.filter(Boolean).join('/'));
}

function buildLocalFolderPathFromRemoteCategory(
	sourceFolder: string,
	targetCategory: string,
	remoteCategory: string,
): string {
	const rootSegments = normalizeCategoryPath(targetCategory, { allowRoot: true })
		.split('/')
		.filter(Boolean);
	const remoteSegments = normalizeCategoryPath(remoteCategory, { allowRoot: true })
		.split('/')
		.filter(Boolean);

	const relativeSegments =
		remoteSegments.length >= rootSegments.length &&
		rootSegments.every((segment, index) => remoteSegments[index] === segment)
			? remoteSegments.slice(rootSegments.length)
			: remoteSegments;

	const sanitizedSegments = relativeSegments.map((segment) =>
		sanitizeLocalPathSegment(segment),
	);
	const pathSegments = sourceFolder
		? [sourceFolder, ...sanitizedSegments]
		: [...sanitizedSegments];

	return normalizePath(pathSegments.filter(Boolean).join('/'));
}

async function ensureLocalFolderExists(app: App, folderPath: string) {
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

async function moveLocalFile(
	app: App,
	file: TFile,
	newPath: string,
): Promise<TFile> {
	await ensureLocalFolderExists(app, parentFolderOf(newPath));
	await app.vault.rename(file, newPath);
	return getFileByPath(app, newPath);
}

function getFileByPath(app: App, path: string): TFile {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(t('errorExpectedFileAtPath', { path }));
	}

	return file;
}

function parentFolderOf(path: string): string {
	const parts = normalizePath(path).split('/');
	parts.pop();
	return parts.join('/');
}

function findRecordByDocGuid(
	records: Record<string, SyncRecord>,
	docGuid: string,
): { path: string; record: SyncRecord } | null {
	for (const [path, record] of Object.entries(records)) {
		if (record.docGuid === docGuid) {
			return { path, record };
		}
	}

	return null;
}

function createRecordFromRemote(
	docGuid: string,
	fileMtime: number,
	remote: WizRemoteNote,
): SyncRecord {
	return createRecord(
		docGuid,
		fileMtime,
		remote.dataModified,
		remote.category,
		remote.title,
		remote.type,
		undefined,
	);
}

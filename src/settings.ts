export type SyncMode =
	| 'bidirectional'
	| 'local-to-remote'
	| 'remote-to-local';

export type DebugLogLevel = 'info' | 'warn' | 'error';

export interface DebugLogEntry {
	id: string;
	at: string;
	level: DebugLogLevel;
	scope: string;
	message: string;
	detail?: string;
}

export interface SyncedAssetRecord {
	fileMtime: number;
	remoteName: string;
	transport: 'legacy-resource' | 'collaboration-resource';
}

export interface WizFolderSyncSettings {
	accountBaseUrl: string;
	userId: string;
	password: string;
	sourceFolder: string;
	targetCategory: string;
	syncMode: SyncMode;
	autoSyncOnSave: boolean;
	autoSyncDebounceMs: number;
}

export interface SyncRecord {
	docGuid: string;
	fileMtime: number;
	remoteModified: number;
	remoteCategory: string;
	remoteTitle: string;
	remoteType: string;
	assetMappings?: Record<string, SyncedAssetRecord>;
}

export interface PluginState {
	records: Record<string, SyncRecord>;
	logs: DebugLogEntry[];
}

export const MAX_DEBUG_LOGS = 100;

export interface PersistedData {
	settings: WizFolderSyncSettings;
	state: PluginState;
}

export const DEFAULT_SETTINGS: WizFolderSyncSettings = {
	accountBaseUrl: 'https://note.wiz.cn',
	userId: '',
	password: '',
	sourceFolder: '',
	targetCategory: '/My Notes/Obsidian Sync/',
	syncMode: 'remote-to-local',
	autoSyncOnSave: false,
	autoSyncDebounceMs: 1500,
};

export function loadPersistedData(raw: unknown): PersistedData {
	const data = (raw ?? {}) as Partial<PersistedData> & Partial<WizFolderSyncSettings>;
	const settingsSource =
		data.settings && typeof data.settings === 'object' ? data.settings : data;
	const stateSource =
		data.state && typeof data.state === 'object' ? data.state : undefined;

	return {
		settings: {
			...DEFAULT_SETTINGS,
			...settingsSource,
			syncMode: normalizeSyncMode(settingsSource?.syncMode),
		},
		state: {
			records: Object.fromEntries(
				Object.entries(stateSource?.records ?? {}).map(([path, record]) => [
					path,
					{
						docGuid: record.docGuid,
						fileMtime: record.fileMtime,
						remoteModified: record.remoteModified ?? 0,
						remoteCategory: record.remoteCategory,
						remoteTitle: record.remoteTitle,
						remoteType: record.remoteType ?? 'lite/markdown',
						assetMappings: normalizeAssetMappings(record.assetMappings),
					},
				]),
			),
			logs: normalizeLogs(stateSource?.logs),
		},
	};
}

function normalizeSyncMode(value: unknown): SyncMode {
	if (
		value === 'bidirectional' ||
		value === 'local-to-remote' ||
		value === 'remote-to-local'
	) {
		return value;
	}

	return DEFAULT_SETTINGS.syncMode;
}

function normalizeAssetMappings(
	value: unknown,
): Record<string, SyncedAssetRecord> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const entries = Object.entries(value).flatMap(([path, item]) => {
		const record = asRecord(item);
		if (!record) {
			return [];
		}

		const fileMtime =
			typeof record.fileMtime === 'number' && Number.isFinite(record.fileMtime)
				? record.fileMtime
				: 0;
		const remoteName =
			typeof record.remoteName === 'string' ? record.remoteName : '';
		const transport =
			record.transport === 'collaboration-resource'
				? 'collaboration-resource'
				: 'legacy-resource';

		if (!path || !remoteName) {
			return [];
		}

		return [[path, { fileMtime, remoteName, transport }] as const];
	});

	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeLogs(value: unknown): DebugLogEntry[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.flatMap((item) => {
			const record = asRecord(item);
			if (!record) {
				return [];
			}

				const level: DebugLogLevel =
					record.level === 'warn' || record.level === 'error'
						? record.level
						: 'info';
			const id =
				typeof record.id === 'string' && record.id.length > 0
					? record.id
					: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
			const at =
				typeof record.at === 'string' && record.at.length > 0
					? record.at
					: new Date(0).toISOString();
			const scope = typeof record.scope === 'string' ? record.scope : 'sync';
			const message =
				typeof record.message === 'string' ? record.message : '';
			const detail =
				typeof record.detail === 'string' ? record.detail : undefined;

			if (!message) {
				return [];
			}

				return [{ id, at, level, scope, message, detail } satisfies DebugLogEntry];
			})
			.slice(-MAX_DEBUG_LOGS);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

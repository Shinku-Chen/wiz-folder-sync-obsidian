import { normalizePath, type Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MAX_DEBUG_LOGS,
	loadPersistedData,
	type PersistedData,
	type WizFolderSyncSettings,
} from './settings';

const ACCOUNT_FILE = 'account.json';
const SYNC_FILE = 'sync.json';
const LOGS_FILE = 'logs.json';
const KEY_FILE = 'account.key.json';
const LEGACY_DATA_FILE = 'data.json';
const PASSWORD_SCHEME = 'aes-gcm-v1';

interface StoredSecret {
	scheme: typeof PASSWORD_SCHEME;
	iv: string;
	ciphertext: string;
}

interface StoredKey {
	scheme: typeof PASSWORD_SCHEME;
	key: string;
}

interface StoredAccountData {
	accountBaseUrl?: unknown;
	userId?: unknown;
	password?: unknown;
}

interface StoredSyncData {
	sourceFolder?: unknown;
	targetCategory?: unknown;
	syncMode?: unknown;
	autoSyncOnSave?: unknown;
	autoSyncDebounceMs?: unknown;
	records?: unknown;
}

interface StoredLogsData {
	logs?: unknown;
}

export interface StorageWarning {
	code: 'legacy-migrated' | 'password-unavailable' | 'storage-file-invalid';
	level: 'info' | 'warn';
	detail?: string;
	fileName?: string;
}

export interface LoadPluginStorageResult {
	data: PersistedData;
	warnings: StorageWarning[];
}

export async function loadPluginStorage(
	plugin: Plugin,
): Promise<LoadPluginStorageResult> {
	const warnings: StorageWarning[] = [];
	const splitData = await loadSplitPersistedData(plugin, warnings);
	if (splitData) {
		await removeLegacyDataFile(plugin);
		return { data: splitData, warnings };
	}

	const legacyRaw: unknown = await plugin.loadData();
	const legacyData = loadPersistedData(legacyRaw);
	if (hasPersistedContent(legacyData)) {
		await savePluginStorage(plugin, legacyData);
		await plugin.saveData({});
		await removeLegacyDataFile(plugin);
		warnings.push({
			code: 'legacy-migrated',
			level: 'info',
			detail: `${LEGACY_DATA_FILE} -> ${ACCOUNT_FILE}, ${SYNC_FILE}, ${LOGS_FILE}`,
		});
	}

	return { data: legacyData, warnings };
}

export async function savePluginStorage(
	plugin: Plugin,
	data: PersistedData,
): Promise<void> {
	await ensureStorageRoot(plugin);

	const account = pickAccountSettings(data.settings);
	const encryptedPassword = account.password
		? await encryptSecret(plugin, account.password)
		: undefined;

	await Promise.all([
		writeJsonFile(plugin, ACCOUNT_FILE, {
			accountBaseUrl: account.accountBaseUrl,
			userId: account.userId,
			password: encryptedPassword,
		}),
		writeJsonFile(plugin, SYNC_FILE, {
			sourceFolder: data.settings.sourceFolder,
			targetCategory: data.settings.targetCategory,
			syncMode: data.settings.syncMode,
			autoSyncOnSave: data.settings.autoSyncOnSave,
			autoSyncDebounceMs: data.settings.autoSyncDebounceMs,
			records: data.state.records,
		}),
		writeJsonFile(plugin, LOGS_FILE, {
			logs: data.state.logs.slice(-MAX_DEBUG_LOGS),
		}),
	]);

	await plugin.saveData({});
	await removeLegacyDataFile(plugin);
}

function hasPersistedContent(data: PersistedData): boolean {
	return (
		data.settings.accountBaseUrl !== DEFAULT_SETTINGS.accountBaseUrl ||
		data.settings.userId !== DEFAULT_SETTINGS.userId ||
		data.settings.password.length > 0 ||
		data.settings.sourceFolder !== DEFAULT_SETTINGS.sourceFolder ||
		data.settings.targetCategory !== DEFAULT_SETTINGS.targetCategory ||
		data.settings.syncMode !== DEFAULT_SETTINGS.syncMode ||
		data.settings.autoSyncOnSave !== DEFAULT_SETTINGS.autoSyncOnSave ||
		data.settings.autoSyncDebounceMs !== DEFAULT_SETTINGS.autoSyncDebounceMs ||
		Object.keys(data.state.records).length > 0 ||
		data.state.logs.length > 0
	);
}

async function loadSplitPersistedData(
	plugin: Plugin,
	warnings: StorageWarning[],
): Promise<PersistedData | null> {
	const [hasAccount, hasSync, hasLogs] = await Promise.all([
		hasStorageFile(plugin, ACCOUNT_FILE),
		hasStorageFile(plugin, SYNC_FILE),
		hasStorageFile(plugin, LOGS_FILE),
	]);
	if (!hasAccount && !hasSync && !hasLogs) {
		return null;
	}

	const [accountRaw, syncRaw, logsRaw] = await Promise.all([
		readJsonFile<StoredAccountData>(plugin, ACCOUNT_FILE, warnings),
		readJsonFile<StoredSyncData>(plugin, SYNC_FILE, warnings),
		readJsonFile<StoredLogsData>(plugin, LOGS_FILE, warnings),
	]);

	const decryptedPassword = await loadStoredPassword(plugin, accountRaw?.password, warnings);
	return loadPersistedData({
		settings: {
			accountBaseUrl:
				typeof accountRaw?.accountBaseUrl === 'string'
					? accountRaw.accountBaseUrl
					: undefined,
			userId:
				typeof accountRaw?.userId === 'string' ? accountRaw.userId : undefined,
			password: decryptedPassword,
			sourceFolder:
				typeof syncRaw?.sourceFolder === 'string' ? syncRaw.sourceFolder : undefined,
			targetCategory:
				typeof syncRaw?.targetCategory === 'string'
					? syncRaw.targetCategory
					: undefined,
			syncMode: syncRaw?.syncMode,
			autoSyncOnSave: syncRaw?.autoSyncOnSave,
			autoSyncDebounceMs: syncRaw?.autoSyncDebounceMs,
		},
		state: {
			records: asRecord(syncRaw?.records),
			logs: Array.isArray(logsRaw?.logs) ? logsRaw.logs : undefined,
		},
	});
}

async function loadStoredPassword(
	plugin: Plugin,
	value: unknown,
	warnings: StorageWarning[],
): Promise<string | undefined> {
	if (!value) {
		return undefined;
	}

	if (!isStoredSecret(value)) {
		warnings.push({
			code: 'password-unavailable',
			level: 'warn',
			detail: `Invalid encrypted password payload in ${ACCOUNT_FILE}`,
		});
		return '';
	}

	try {
		return await decryptSecret(plugin, value);
	} catch (error) {
		warnings.push({
			code: 'password-unavailable',
			level: 'warn',
			detail: error instanceof Error ? error.message : String(error),
		});
		return '';
	}
}

function pickAccountSettings(settings: WizFolderSyncSettings) {
	return {
		accountBaseUrl: settings.accountBaseUrl,
		userId: settings.userId,
		password: settings.password,
	};
}

function isStoredSecret(value: unknown): value is StoredSecret {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	const record = value as Record<string, unknown>;
	return (
		record.scheme === PASSWORD_SCHEME &&
		typeof record.iv === 'string' &&
		typeof record.ciphertext === 'string'
	);
}

async function encryptSecret(
	plugin: Plugin,
	plaintext: string,
): Promise<StoredSecret> {
	const key = await getOrCreatePasswordKey(plugin);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encoded = new TextEncoder().encode(plaintext);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encoded,
	);
	return {
		scheme: PASSWORD_SCHEME,
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

async function decryptSecret(
	plugin: Plugin,
	payload: StoredSecret,
): Promise<string> {
	const key = await getOrCreatePasswordKey(plugin);
	const decrypted = await crypto.subtle.decrypt(
		{
			name: 'AES-GCM',
			iv: toArrayBuffer(base64ToBytes(payload.iv)),
		},
		key,
		toArrayBuffer(base64ToBytes(payload.ciphertext)),
	);
	return new TextDecoder().decode(decrypted);
}

async function getOrCreatePasswordKey(plugin: Plugin): Promise<CryptoKey> {
	const stored = await readJsonFile<StoredKey>(plugin, KEY_FILE, []);
	if (stored?.scheme === PASSWORD_SCHEME && typeof stored.key === 'string') {
		return crypto.subtle.importKey(
			'raw',
			toArrayBuffer(base64ToBytes(stored.key)),
			{ name: 'AES-GCM' },
			false,
			['encrypt', 'decrypt'],
		);
	}

	const key = await crypto.subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt'],
	);
	const rawKey = await crypto.subtle.exportKey('raw', key);
	await writeJsonFile(plugin, KEY_FILE, {
		scheme: PASSWORD_SCHEME,
		key: bytesToBase64(new Uint8Array(rawKey)),
	});
	return key;
}

async function readJsonFile<T>(
	plugin: Plugin,
	fileName: string,
	warnings: StorageWarning[],
): Promise<T | undefined> {
	const path = getStoragePath(plugin, fileName);
	if (!(await plugin.app.vault.adapter.exists(path))) {
		return undefined;
	}

	try {
		const raw = await plugin.app.vault.adapter.read(path);
		if (!raw.trim()) {
			return undefined;
		}
		return JSON.parse(raw) as T;
	} catch (error) {
		warnings.push({
			code: 'storage-file-invalid',
			level: 'warn',
			fileName,
			detail: error instanceof Error ? error.message : String(error),
		});
		return undefined;
	}
}

async function writeJsonFile(
	plugin: Plugin,
	fileName: string,
	data: unknown,
): Promise<void> {
	const path = getStoragePath(plugin, fileName);
	await plugin.app.vault.adapter.write(path, `${JSON.stringify(data, null, 2)}\n`);
}

async function hasStorageFile(plugin: Plugin, fileName: string): Promise<boolean> {
	return plugin.app.vault.adapter.exists(getStoragePath(plugin, fileName));
}

async function ensureStorageRoot(plugin: Plugin): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const root = getStorageRoot(plugin);
	if (await adapter.exists(root)) {
		return;
	}

	const segments = root.split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!(await adapter.exists(current))) {
			await adapter.mkdir(current);
		}
	}
}

async function removeLegacyDataFile(plugin: Plugin): Promise<void> {
	const path = getStoragePath(plugin, LEGACY_DATA_FILE);
	if (await plugin.app.vault.adapter.exists(path)) {
		await plugin.app.vault.adapter.remove(path);
	}
}

function getStorageRoot(plugin: Plugin): string {
	return normalizePath(`${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`);
}

function getStoragePath(plugin: Plugin, fileName: string): string {
	return normalizePath(`${getStorageRoot(plugin)}/${fileName}`);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

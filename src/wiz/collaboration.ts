interface TextAttributes {
	'style-bold'?: boolean;
	'style-italic'?: boolean;
	'style-strikethrough'?: boolean;
	'style-code'?: boolean;
	link?: string;
}

interface TextDelta {
	insert: string;
	attributes?: TextAttributes;
}

interface CollaborationBlock {
	id: string;
	type: string;
	text?: TextDelta[];
	heading?: number;
	quoted?: boolean;
	level?: number;
	checkbox?: 'checked' | 'unchecked';
	ordered?: boolean;
	start?: number;
	language?: string;
	children?: string[];
	embedType?: string;
	embedData?: Record<string, unknown>;
	[key: string]: unknown;
}

interface CollaborationDocData {
	blocks?: CollaborationBlock[];
	[key: string]: unknown;
}

interface Waiter {
	resolve: (message: string) => void;
	reject: (error: Error) => void;
	predicate?: (message: unknown) => boolean;
	timer: number;
}

interface WriteBlocksOptions {
	kbServer: string;
	kbGuid: string;
	docGuid: string;
	userGuid: string;
	editorToken: string;
	blocks: CollaborationBlock[];
	extras: Record<string, unknown>;
	version?: number;
	deleteFirst?: boolean;
}

const RE = {
	heading: /^(#{1,6})\s+(.+)$/,
	hr: /^(-{3,}|\*{3,}|_{3,})$/,
	check: /^(\s*)- \[([ xX])\] (.+)$/,
	ul: /^(\s*)[-*+]\s+(.+)$/,
	ol: /^(\s*)(\d+)\.\s+(.+)$/,
	img: /^!\[([^\]]*)\]\(([^)]+)\)$/,
	tableRow: /^\s*\|.+\|\s*$/,
	tableSep: /^\s*\|[\s\-:|]+\|\s*$/,
};

const INLINE = new RegExp(
	'(\\*\\*\\*(.+?)\\*\\*\\*)' +
		'|(\\*\\*(.+?)\\*\\*)' +
		'|(\\*(.+?)\\*)' +
		'|(~~(.+?)~~)' +
		'|(`([^`]+)`)' +
		'|(\\[([^\\]]+)\\]\\(([^)]+)\\))' +
		'|([^*~`\\[]+)',
	'g',
);

class WsSession {
	private readonly queue: string[] = [];
	private readonly waiters: Waiter[] = [];
	private closed = false;
	private error: Error | null = null;

	constructor(private readonly ws: WebSocket) {
		ws.addEventListener('message', (event) => {
			void this.handleMessage(event.data);
		});
		ws.addEventListener('close', () => {
			this.closed = true;
			this.pump();
		});
		ws.addEventListener('error', () => {
			this.error = new Error('Collaboration WebSocket error');
			this.pump();
		});
	}

	send(payload: unknown) {
		this.ws.send(JSON.stringify(payload));
	}

	recv(options?: {
		predicate?: (message: unknown) => boolean;
		timeoutMs?: number;
	}): Promise<string> {
		const timeoutMs = options?.timeoutMs ?? 10000;
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				resolve,
				reject,
				predicate: options?.predicate,
				timer: window.setTimeout(() => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) {
						this.waiters.splice(index, 1);
					}
					reject(
						new Error(`Collaboration WebSocket timeout after ${timeoutMs}ms`),
					);
				}, timeoutMs),
			};
			this.waiters.push(waiter);
			this.pump();
		});
	}

	close() {
		try {
			this.ws.close();
		} catch {
			// Ignore close errors on already-closed sockets.
		}
	}

	private async handleMessage(data: unknown) {
		this.queue.push(await toText(data));
		this.pump();
	}

	private pump() {
		while (this.waiters.length > 0) {
			const waiter = this.waiters[0];
			if (!waiter) {
				return;
			}

			const matchIndex = waiter.predicate
				? this.queue.findIndex((message) => {
						const predicate = waiter.predicate;
						return predicate ? matchesPredicate(predicate, message) : false;
					})
				: this.queue.length > 0
					? 0
					: -1;

			if (matchIndex >= 0) {
				this.waiters.shift();
				const [message] = this.queue.splice(matchIndex, 1);
				window.clearTimeout(waiter.timer);
				waiter.resolve(message ?? '');
				continue;
			}

			if (this.closed) {
				this.waiters.shift();
				window.clearTimeout(waiter.timer);
				waiter.reject(
					this.error ?? new Error('Collaboration WebSocket closed unexpectedly'),
				);
				continue;
			}

			return;
		}
	}
}

export function parseInline(text: string): TextDelta[] {
	if (!text) {
		return [{ insert: text }];
	}

	const output: TextDelta[] = [];
	INLINE.lastIndex = 0;
	let match: RegExpExecArray | null = INLINE.exec(text);
	while (match) {
		if (match[2] !== undefined) {
			output.push({
				insert: match[2],
				attributes: { 'style-bold': true, 'style-italic': true },
			});
		} else if (match[4] !== undefined) {
			output.push({
				insert: match[4],
				attributes: { 'style-bold': true },
			});
		} else if (match[6] !== undefined) {
			output.push({
				insert: match[6],
				attributes: { 'style-italic': true },
			});
		} else if (match[8] !== undefined) {
			output.push({
				insert: match[8],
				attributes: { 'style-strikethrough': true },
			});
		} else if (match[10] !== undefined) {
			output.push({
				insert: match[10],
				attributes: { 'style-code': true },
			});
		} else if (match[12] !== undefined) {
			output.push({
				insert: match[12],
				attributes: { link: match[13] },
			});
		} else if (match[14] !== undefined) {
			output.push({ insert: match[14] });
		}

		match = INLINE.exec(text);
	}

	return output.length > 0 ? output : [{ insert: text }];
}

export function markdownToBlocks(
	markdown: string,
): { blocks: CollaborationBlock[]; extras: Record<string, unknown> } {
	if (!markdown.trim()) {
		return { blocks: [], extras: {} };
	}

	const blocks: CollaborationBlock[] = [];
	const extras: Record<string, unknown> = {};
	const lines = markdown.split('\n');

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';

		if (!line.trim()) {
			continue;
		}

		if (line.trim().startsWith('```')) {
			const language = line.trim().slice(3).trim();
			const codeLines: string[] = [];
			index += 1;
			while (
				index < lines.length &&
				!(lines[index] ?? '').trim().startsWith('```')
			) {
				codeLines.push(lines[index] ?? '');
				index += 1;
			}
			const blockId = shortId();
			const childId = `_code_${blockId}_0`;
			blocks.push({
				id: blockId,
				type: 'code',
				language,
				children: [childId],
			});
			extras[childId] = {
				__id: childId,
				__type: 'code_cell',
				text: [{ insert: codeLines.join('\n') }],
			};
			continue;
		}

		const heading = RE.heading.exec(line);
		if (heading) {
			blocks.push({
				id: shortId(),
				type: 'text',
				text: parseInline(heading[2] ?? ''),
				heading: Math.min((heading[1] ?? '').length, 6),
			});
			continue;
		}

		if (RE.hr.test(line.trim())) {
			blocks.push({
				id: shortId(),
				type: 'embed',
				embedType: 'hr',
				embedData: {},
			});
			continue;
		}

		if (line.trim().startsWith('>')) {
			blocks.push({
				id: shortId(),
				type: 'text',
				text: parseInline(line.trim().replace(/^>\s*/, '')),
				quoted: true,
			});
			continue;
		}

		const checkbox = RE.check.exec(line);
		if (checkbox) {
			blocks.push({
				id: shortId(),
				type: 'list',
				text: parseInline(checkbox[3] ?? ''),
				level: Math.floor((checkbox[1] ?? '').length / 2) + 1,
				checkbox: checkbox[2] !== ' ' ? 'checked' : 'unchecked',
			});
			continue;
		}

		const unordered = RE.ul.exec(line);
		if (unordered) {
			blocks.push({
				id: shortId(),
				type: 'list',
				text: parseInline(unordered[2] ?? ''),
				level: Math.floor((unordered[1] ?? '').length / 2) + 1,
			});
			continue;
		}

		const ordered = RE.ol.exec(line);
		if (ordered) {
			blocks.push({
				id: shortId(),
				type: 'list',
				text: parseInline(ordered[3] ?? ''),
				level: Math.floor((ordered[1] ?? '').length / 2) + 1,
				ordered: true,
				start: Number.parseInt(ordered[2] ?? '1', 10),
			});
			continue;
		}

		if (
			line.includes('|') &&
			index + 1 < lines.length &&
			RE.tableSep.test(lines[index + 1] ?? '')
		) {
			const headers = splitTableLine(line);
			const rows: string[][] = [];
			index += 2;
			while (index < lines.length && RE.tableRow.test(lines[index] ?? '')) {
				rows.push(splitTableLine(lines[index] ?? ''));
				index += 1;
			}
			index -= 1;

			const columns = headers.length;
			const tableId = shortId();
			const cellIds: string[] = [];
			const allCells = headers.concat(
				...rows.map((row) => normalizeRow(row, columns)),
			);

			allCells.forEach((cell, cellIndex) => {
				const cellId = `_table_${tableId}_${cellIndex}`;
				cellIds.push(cellId);
				extras[cellId] = {
					__id: cellId,
					__type: 'table_cell',
					text: [{ insert: cell }],
				};
			});

			blocks.push({
				id: tableId,
				type: 'table',
				cols: columns,
				children: cellIds,
			});
			continue;
		}

		const image = RE.img.exec(line.trim());
		if (image) {
			blocks.push({
				id: shortId(),
				type: 'embed',
				embedType: 'image',
				embedData: {
					src: image[2] ?? '',
					alt: image[1] ?? '',
				},
			});
			continue;
		}

		blocks.push({
			id: shortId(),
			type: 'text',
			text: parseInline(line),
		});
	}

	return { blocks, extras };
}

export function blocksToMarkdown(raw: unknown): string {
	const parsed = typeof raw === 'string' ? tryParseJson(raw) : raw;
	const doc = extractCollaborationDoc(parsed);
	if (!doc?.blocks || !Array.isArray(doc.blocks)) {
		return typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
	}

	return doc.blocks
		.map((block) => renderBlock(doc, block))
		.filter(Boolean)
		.join('\n');
}

export async function fetchCollaborationContent(options: {
	kbServer: string;
	kbGuid: string;
	docGuid: string;
	userGuid: string;
	editorToken: string;
}): Promise<string> {
	const session = await openSession(options);
	try {
		session.send({
			a: 'f',
			c: options.kbGuid,
			d: options.docGuid,
			v: null,
		});
		return await session.recv({
			predicate: (message) =>
				typeof message === 'object' &&
				message !== null &&
				'data' in message,
			timeoutMs: 8000,
		});
	} finally {
		session.close();
	}
}

export async function writeCollaborationBlocks(
	options: WriteBlocksOptions,
): Promise<void> {
	const session = await openSession(options);
	try {
		session.send({
			a: 'f',
			c: options.kbGuid,
			d: options.docGuid,
			v: null,
		});

		let version = options.version ?? 0;
		let hasDocument = false;
		try {
			const syncRaw = await session.recv({
				predicate: (message) =>
					typeof message === 'object' &&
					message !== null &&
					'data' in message,
				timeoutMs: 5000,
			});
			const syncMessage = tryParseJson(syncRaw) as {
				data?: { v?: number; type?: string };
			} | null;
			const serverVersion = syncMessage?.data?.v ?? 0;
			if (serverVersion > version) {
				version = serverVersion;
			}
			hasDocument =
				syncMessage?.data?.type !== undefined && serverVersion > 0;
		} catch {
			// Empty collaboration note can skip the initial snapshot frame.
		}

		const source = uniqueClientId();
		let sequence = 1;
		const deleteFirst = options.deleteFirst ?? hasDocument;
		if (deleteFirst) {
			session.send({
				a: 'op',
				c: options.kbGuid,
				d: options.docGuid,
				v: version,
				src: source,
				seq: sequence,
				del: true,
			});
			await session.recv({ timeoutMs: 5000 });
			version += 1;
			sequence += 1;
		}

		const docData: Record<string, unknown> = {
			blocks: options.blocks,
			comments: [],
			meta: {},
			authors: [],
			commentators: [],
			...options.extras,
		};

		session.send({
			a: 'op',
			c: options.kbGuid,
			d: options.docGuid,
			v: version,
			src: source,
			seq: sequence,
			create: {
				type: 'http://sharejs.org/types/JSONv1',
				data: docData,
			},
		});

		try {
			await session.recv({
				predicate: (message) => {
					if (!message || typeof message !== 'object') {
						return false;
					}
					const op = message as { a?: string; src?: string; v?: number };
					return (
						(op.a === 'op' && (op.src === source || op.v === version)) ||
						(op.v ?? 0) > version
					);
				},
				timeoutMs: 8000,
			});
		} catch {
			session.send({
				a: 'f',
				c: options.kbGuid,
				d: options.docGuid,
				v: null,
			});
			await session
				.recv({
					predicate: (message) =>
						typeof message === 'object' &&
						message !== null &&
						'data' in message,
					timeoutMs: 5000,
				})
				.catch(() => undefined);
		}
	} finally {
		session.close();
	}
}

async function openSession(options: {
	kbServer: string;
	kbGuid: string;
	docGuid: string;
	userGuid: string;
	editorToken: string;
}): Promise<WsSession> {
	const socket = await openWebSocket(
		buildWsUrl(options.kbServer, options.kbGuid, options.docGuid),
	);
	const session = new WsSession(socket);
	session.send({
		a: 'hs',
		id: null,
		auth: {
			appId: options.kbGuid,
			docId: options.docGuid,
			userId: options.userGuid,
			permission: 'w',
			token: options.editorToken,
		},
	});
	await session.recv({
		predicate: (message) =>
			typeof message === 'object' &&
			message !== null &&
			(message as { a?: string }).a === 'hs',
		timeoutMs: 5000,
	});
	return session;
}

function buildWsUrl(kbServer: string, kbGuid: string, docGuid: string): string {
	const scheme = kbServer.startsWith('https') ? 'wss' : 'ws';
	const host = kbServer.replace(/^https?:\/\//, '').replace(/\/$/, '');
	return `${scheme}://${host}/editor/${kbGuid}/${docGuid}`;
}

function openWebSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const cleanup = () => {
			socket.removeEventListener('open', handleOpen);
			socket.removeEventListener('error', handleError);
		};
		const handleOpen = () => {
			cleanup();
			resolve(socket);
		};
		const handleError = () => {
			cleanup();
			reject(new Error(`Failed to open collaboration WebSocket: ${url}`));
		};
		socket.addEventListener('open', handleOpen);
		socket.addEventListener('error', handleError);
	});
}

function renderBlock(full: CollaborationDocData, block: CollaborationBlock): string {
	switch (block.type) {
		case 'text': {
			const text = renderText(block.text);
			if (block.heading) {
				return `${'#'.repeat(block.heading)} ${text}`;
			}
			if (block.quoted) {
				return `> ${text}`;
			}
			return text;
		}
		case 'list': {
			const text = renderText(block.text);
			const indent = '  '.repeat(Math.max(0, (block.level ?? 1) - 1));
			const checkbox =
				block.checkbox === 'checked'
					? '[x] '
					: block.checkbox === 'unchecked'
						? '[ ] '
						: '';
			return block.ordered
				? `${indent}${block.start ?? 1}. ${checkbox}${text}`
				: `${indent}- ${checkbox}${text}`;
		}
		case 'code': {
			const lines = (block.children ?? []).map((childId) =>
				extraLines(full, childId),
			);
			return `\`\`\`${block.language ?? ''}\n${lines.join('\n')}\n\`\`\``;
		}
		case 'table': {
			const columns =
				typeof block.cols === 'number' && Number.isFinite(block.cols)
					? block.cols
					: 0;
			if (!columns) {
				return '';
			}
			const cells = (block.children ?? []).map((childId) =>
				extraText(full, childId),
			);
			const header = `| ${cells.slice(0, columns).join(' | ')} |`;
			const separator = `| ${Array(columns).fill('---').join(' | ')} |`;
			const bodyCells = cells.slice(columns);
			const rows: string[] = [];
			for (let index = 0; index < bodyCells.length; index += columns) {
				const row = bodyCells.slice(index, index + columns);
				while (row.length < columns) {
					row.push('');
				}
				rows.push(`| ${row.join(' | ')} |`);
			}
			return [header, separator, ...rows].join('\n');
		}
		case 'embed': {
			if (block.embedType === 'hr') {
				return '---';
			}
			if (block.embedType === 'image') {
				const alt = readString(block.embedData?.alt) ?? '';
				const src = readString(block.embedData?.src) ?? '';
				return `![${alt}](${src})`;
			}
			return `<!-- embed: ${block.embedType ?? 'unknown'} -->`;
		}
		default:
			return '';
	}
}

function renderText(deltas?: TextDelta[]): string {
	return (deltas ?? [])
		.map((delta) => {
			const text = delta.insert ?? '';
			const attributes = delta.attributes ?? {};
			if (attributes['style-bold'] && attributes['style-italic']) {
				return `***${text}***`;
			}
			if (attributes['style-bold']) {
				return `**${text}**`;
			}
			if (attributes['style-italic']) {
				return `*${text}*`;
			}
			if (attributes['style-strikethrough']) {
				return `~~${text}~~`;
			}
			if (attributes['style-code']) {
				return `\`${text}\``;
			}
			if (attributes.link) {
				return `[${text}](${attributes.link})`;
			}
			return text;
		})
		.join('');
}

function extraText(full: CollaborationDocData, id: string): string {
	const raw = full[id];
	if (!raw) {
		return '';
	}

	if (Array.isArray(raw)) {
		return raw
			.map((item) => readNestedText(item))
			.map((text) => text.replace(/\s+/g, ' ').trim())
			.filter(Boolean)
			.join(' ');
	}

	if (isRecord(raw) && Array.isArray(raw.text)) {
		return renderText(raw.text as TextDelta[]);
	}

	return '';
}

function extraLines(full: CollaborationDocData, id: string): string {
	const raw = full[id];
	if (!raw) {
		return '';
	}

	if (Array.isArray(raw)) {
		return raw.map((item) => readNestedText(item)).join('\n');
	}

	if (isRecord(raw) && Array.isArray(raw.text) && raw.text.length > 0) {
		const [first] = raw.text as unknown[];
		if (isRecord(first) && typeof first.insert === 'string') {
			return first.insert;
		}
	}

	return '';
}

function readNestedText(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.text)) {
		return '';
	}
	return renderText(value.text as TextDelta[]);
}

function extractCollaborationDoc(value: unknown): CollaborationDocData | null {
	if (!isRecord(value)) {
		return null;
	}

	const outerData = value.data;
	if (!isRecord(outerData)) {
		return null;
	}

	const innerData = outerData.data;
	if (!isRecord(innerData)) {
		return null;
	}

	return innerData;
}

function tryParseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function normalizeRow(values: string[], columns: number): string[] {
	const row = values.slice(0, columns);
	while (row.length < columns) {
		row.push('');
	}
	return row;
}

function splitTableLine(line: string): string[] {
	return line
		.trim()
		.replace(/^\||\|$/g, '')
		.split('|')
		.map((value) => value.trim());
}

function matchesPredicate(
	predicate: (message: unknown) => boolean,
	message: string,
): boolean {
	const parsed = tryParseJson(message);
	try {
		return predicate(parsed);
	} catch {
		return false;
	}
}

async function toText(data: unknown): Promise<string> {
	if (typeof data === 'string') {
		return data;
	}

	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(data));
	}

	if (data instanceof Blob) {
		return await data.text();
	}

	if (ArrayBuffer.isView(data)) {
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		return new TextDecoder().decode(bytes);
	}

	if (typeof data === 'number' || typeof data === 'boolean' || data === null) {
		return String(data);
	}

	try {
		return JSON.stringify(data);
	} catch {
		return '';
	}
}

function shortId(): string {
	const uuid = crypto?.randomUUID?.();
	if (uuid) {
		return uuid.replace(/-/g, '').slice(0, 8);
	}
	return Math.random().toString(16).slice(2, 10);
}

function uniqueClientId(): string {
	const uuid = crypto?.randomUUID?.();
	if (uuid) {
		return uuid.replace(/-/g, '').slice(0, 20);
	}
	return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`.slice(
		0,
		20,
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null;
}

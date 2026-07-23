function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function outlineToMarkdown(input: string): string {
	const normalized = input.trim();
	if (!normalized) {
		return '';
	}

	const parsed = tryParseOutlineJson(normalized);
	if (parsed) {
		const lines = renderOutlineValue(parsed, 0);
		if (lines.length > 0) {
			return lines.join('\n');
		}
	}

	const text = htmlToText(normalized).trim();
	return text || normalized;
}

function tryParseOutlineJson(input: string): unknown {
	for (const candidate of [input, htmlToText(input).trim()]) {
		if (!candidate) {
			continue;
		}
		try {
			return JSON.parse(candidate);
		} catch {
			// Try the next representation.
		}
	}
	return null;
}

function renderOutlineValue(value: unknown, depth: number): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => renderOutlineValue(item, depth));
	}

	if (!isRecord(value)) {
		const text = formatLeafText(value);
		return text ? [`${indent(depth)}- ${text}`] : [];
	}

	const text = pickNodeText(value);
	const children = pickChildren(value);
	const lines: string[] = [];

	if (text) {
		lines.push(`${indent(depth)}- ${text}`);
	}

	for (const child of children) {
		lines.push(...renderOutlineValue(child, text ? depth + 1 : depth));
	}

	if (!text && children.length === 0) {
		const fallback = formatLeafText(value);
		if (fallback) {
			lines.push(`${indent(depth)}- ${fallback}`);
		}
	}

	return lines;
}

function pickNodeText(node: Record<string, unknown>): string {
	const value =
		readText(node.text) ??
		readText(node.title) ??
		readText(node.name) ??
		readText(node.label) ??
		readText(node.content) ??
		readText(node.summary);

	return value ? collapseWhitespace(value) : '';
}

function pickChildren(node: Record<string, unknown>): unknown[] {
	for (const key of [
		'children',
		'items',
		'nodes',
		'subNodes',
		'childNodes',
		'outline',
	]) {
		const value = node[key];
		if (Array.isArray(value)) {
			return value;
		}
	}
	return [];
}

function formatLeafText(value: unknown): string {
	if (typeof value === 'string') {
		return collapseWhitespace(value);
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	return '';
}

function readText(value: unknown): string | null {
	if (typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		const parts = value
			.map((item) => readText(item))
			.filter((item): item is string => Boolean(item));
		return parts.length > 0 ? parts.join(' ') : null;
	}
	if (isRecord(value)) {
		for (const key of ['text', 'value', 'plain', 'content']) {
			const nested = readText(value[key]);
			if (nested) {
				return nested;
			}
		}
	}
	return null;
}

function htmlToText(html: string): string {
	const parser = new DOMParser();
	const document = parser.parseFromString(html, 'text/html');
	return document.body.textContent ?? '';
}

function collapseWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function indent(depth: number): string {
	return '  '.repeat(Math.max(0, depth));
}

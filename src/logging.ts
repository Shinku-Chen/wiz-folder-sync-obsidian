export function formatLogDetail(
	fields: Array<[label: string, value: unknown]>,
): string | undefined {
	const lines = fields.flatMap(([label, value]) => {
		if (value === undefined || value === null || value === '') {
			return [];
		}

		return [`${label}: ${formatLogValue(value)}`];
	});

	return lines.length > 0 ? lines.join('\n') : undefined;
}

function formatLogValue(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}

	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value);
	}

	if (Array.isArray(value)) {
		return value.map((item) => formatLogValue(item)).join(', ');
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

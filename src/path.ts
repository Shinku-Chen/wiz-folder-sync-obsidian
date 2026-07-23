const INVALID_LOCAL_PATH_SEGMENT = /[\\/:]/g;

const LOCAL_PATH_REPLACEMENTS: Record<string, string> = {
	'\\': '＼',
	'/': '／',
	':': '：',
};

export function sanitizeLocalPathSegment(segment: string): string {
	return segment.replace(
		INVALID_LOCAL_PATH_SEGMENT,
		(character) => LOCAL_PATH_REPLACEMENTS[character] ?? '_',
	);
}

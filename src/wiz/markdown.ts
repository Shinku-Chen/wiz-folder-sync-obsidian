export function wrapMarkdown(markdown: string): string {
	return (
		'<!doctype html>\n<html>\n  <head>\n    <meta charset="utf-8">\n  </head>\n  <body>\n    <pre>' +
		escapeHtml(markdown) +
		'</pre>\n  </body>\n</html>'
	);
}

export function ensureMarkdownTitle(title: string): string {
	return /\.md$/i.test(title) ? title : `${title}.md`;
}

export function unwrapMarkdown(html: string): string {
	const match = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
	if (!match) {
		return html;
	}

	const content = match[1] ?? '';
	return content
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&quot;', '"')
		.replaceAll('&#39;', "'")
		.replaceAll('&amp;', '&');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

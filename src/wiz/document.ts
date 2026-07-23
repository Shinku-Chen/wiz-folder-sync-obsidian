function isElement(value: ChildNode): value is HTMLElement {
	return value.nodeType === Node.ELEMENT_NODE;
}

export function documentHtmlToMarkdown(html: string): string {
	if (!html.trim()) {
		return '';
	}

	const parser = new DOMParser();
	const document = parser.parseFromString(html, 'text/html');
	const root =
		document.querySelector('.wiz-note-html') ??
		document.body ??
		document.documentElement;
	const markdown = renderChildren(root.childNodes, 0)
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return markdown || root.textContent?.trim() || html;
}

export function markdownToDocumentHtml(markdown: string): string {
	const blocks = markdown.trim() ? markdown.trim().split(/\n{2,}/) : [];
	const htmlBlocks = blocks.map(renderMarkdownBlock).filter(Boolean).join('');
	return `<div class="wiz-note-body"><div class="wiz-note-html">${htmlBlocks}</div></div>`;
}

function renderChildren(nodes: NodeListOf<ChildNode> | ChildNode[], depth: number): string {
	const children: ChildNode[] = Array.from(nodes);
	return children
		.map((node) => renderNode(node, depth))
		.join('')
		.replace(/[ \t]+\n/g, '\n');
}

function renderNode(node: ChildNode, depth: number): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return collapseWhitespace(node.textContent ?? '');
	}

	if (!isElement(node)) {
		return '';
	}

	const tag = node.tagName.toLowerCase();
	switch (tag) {
		case 'br':
			return '\n';
		case 'hr':
			return '\n---\n\n';
		case 'h1':
		case 'h2':
		case 'h3':
		case 'h4':
		case 'h5':
		case 'h6':
			return `\n${'#'.repeat(Number(tag[1]))} ${inlineText(node).trim()}\n\n`;
		case 'p':
		case 'div': {
			const content = renderChildren(node.childNodes, depth).trim();
			return content ? `${content}\n\n` : '';
		}
		case 'strong':
		case 'b':
			return `**${inlineText(node)}**`;
		case 'em':
		case 'i':
			return `*${inlineText(node)}*`;
		case 'code':
			if (node.parentElement?.tagName.toLowerCase() === 'pre') {
				return inlineText(node);
			}
			return `\`${inlineText(node)}\``;
		case 'pre':
			return `\n\`\`\`\n${node.textContent?.trim() ?? ''}\n\`\`\`\n\n`;
		case 'a': {
			const text = inlineText(node).trim() || node.getAttribute('href') || '';
			const href = node.getAttribute('href') || '';
			return href ? `[${text}](${href})` : text;
		}
		case 'img': {
			const alt = node.getAttribute('alt') || '';
			const src = node.getAttribute('src') || '';
			return src ? `![${alt}](${src})` : '';
		}
		case 'ul':
			return renderList(node, depth, false);
		case 'ol':
			return renderList(node, depth, true);
		case 'li': {
			const content = renderChildren(node.childNodes, depth + 1).trim();
			const prefix = '  '.repeat(Math.max(depth, 0));
			return `${prefix}- ${content}\n`;
		}
		case 'blockquote': {
			const content = renderChildren(node.childNodes, depth)
				.trim()
				.split('\n')
				.map((line) => `> ${line}`)
				.join('\n');
			return `${content}\n\n`;
		}
		default:
			return renderChildren(node.childNodes, depth);
	}
}

function renderList(list: HTMLElement, depth: number, ordered: boolean): string {
	const children: Element[] = Array.from(list.children);
	const items = children.filter(
		(child): child is HTMLElement => child.tagName.toLowerCase() === 'li',
	);
	if (items.length === 0) {
		return '';
	}

	return (
		items
			.map((item, index) => {
				const content = renderChildren(item.childNodes, depth + 1).trim();
				const prefix = '  '.repeat(Math.max(depth, 0));
				return ordered
					? `${prefix}${index + 1}. ${content}\n`
					: `${prefix}- ${content}\n`;
			})
			.join('') + '\n'
	);
}

function inlineText(element: HTMLElement): string {
	return collapseWhitespace(renderChildren(element.childNodes, 0));
}

function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function renderMarkdownBlock(block: string): string {
	const lines = block.split('\n').map((line) => line.trimEnd());
	if (lines.length === 0) {
		return '';
	}

	if (lines[0]?.startsWith('```')) {
		const code = lines.slice(1, lines.at(-1)?.startsWith('```') ? -1 : undefined);
		return `<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`;
	}

	if (lines.every((line) => /^[-*]\s+/.test(line))) {
		const items = lines
			.map((line) => line.replace(/^[-*]\s+/, ''))
			.map((line) => `<li>${renderInlineMarkdown(line)}</li>`)
			.join('');
		return `<ul>${items}</ul>`;
	}

	const heading = /^(#{1,6})\s+(.+)$/.exec(lines[0] ?? '');
	if (heading) {
		const level = Math.min(heading[1]?.length ?? 1, 6);
		return `<h${level}>${renderInlineMarkdown(heading[2] ?? '')}</h${level}>`;
	}

	return `<p>${lines.map((line) => renderInlineMarkdown(line)).join('<br>')}</p>`;
}

function renderInlineMarkdown(text: string): string {
	return escapeHtml(text)
		.replace(/!\[([^\]]*)]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
		.replace(/\[([^\]]+)]\(([^)]+)\)/g, '<a href="$2">$1</a>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mdx from '@astrojs/mdx';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(__dirname, 'upstream', 'manifest.json');

function readManifest() {
	if (!existsSync(MANIFEST_PATH)) return null;
	try {
		return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Rewrite internal markdown links to Starlight doc routes.
 * Example: ../core/atom.mdx -> ../core/atom/
 */
function normalizeInternalMarkdownLinks() {
	/** @param {string} url */
	function normalizeUrl(url) {
		if (
			url.startsWith('http://') ||
			url.startsWith('https://') ||
			url.startsWith('mailto:') ||
			url.startsWith('tel:') ||
			url.startsWith('#')
		) {
			return url;
		}

		const [beforeHash, hash = ''] = url.split('#');
		const [pathname, query = ''] = beforeHash.split('?');
		if (!/\.mdx?$/i.test(pathname)) return url;

		const withoutExt = pathname.replace(/\.mdx?$/i, '');
		const normalizedPath = withoutExt
			.split('/')
			.map((segment) => {
				if (segment === '' || segment === '.' || segment === '..') return segment;
				return segment.toLowerCase();
			})
			.join('/');
		const withSlash = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`;
		const queryPart = query ? `?${query}` : '';
		const hashPart = hash ? `#${hash}` : '';
		return `${withSlash}${queryPart}${hashPart}`;
	}

	/** @param {any} node */
	function walk(node) {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'link' && typeof node.url === 'string') {
			node.url = normalizeUrl(node.url);
		}
		const children = Array.isArray(node.children) ? node.children : [];
		for (const child of children) {
			walk(child);
		}
	}

	return (/** @type {any} */ tree) => {
		walk(tree);
	};
}

const CATEGORY_ORDER = [
	'core',
	'basics',
	'guides',
	'recipes',
	'utilities',
	'extensions',
	'tools',
	'third-party',
];

/**
 * Build sidebar from manifest file list.
 * Jotai docs are organized as docs/<category>/<page>.mdx.
 * Each MDX file has a frontmatter `nav` field (e.g. 2.01) for ordering within its category.
 * We group by directory name and sort categories by CATEGORY_ORDER.
 *
 * @param {any} manifest
 */
function buildSidebar(manifest) {
	if (!manifest || !Array.isArray(manifest.files)) {
		return [{ label: 'Docs', autogenerate: { directory: '.' } }];
	}

	/** @type {Map<string, string[]>} */
	const groups = new Map();

	for (const file of manifest.files) {
		const parts = file.replace(/\.mdx?$/, '').split('/');
		if (parts.length === 1) continue;
		const category = parts[0];
		const slug = parts.join('/').replace(/\.mdx?$/, '');
		if (!groups.has(category)) groups.set(category, []);
		groups.get(category)?.push(slug);
	}

	const sortedCategories = [...groups.keys()].sort((a, b) => {
		const ai = CATEGORY_ORDER.indexOf(a);
		const bi = CATEGORY_ORDER.indexOf(b);
		return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
	});

	return sortedCategories.map((category) => ({
		label: category.charAt(0).toUpperCase() + category.slice(1).replace(/-/g, ' '),
		autogenerate: { directory: category },
	}));
}

const manifest = readManifest();
const sidebar = buildSidebar(manifest);

export default defineConfig({
	site: process.env.SITE_URL || 'https://example.com',
	markdown: {
		remarkPlugins: [normalizeInternalMarkdownLinks],
	},
	integrations: [
		starlight({
			title: 'Jotai Docs',
			description: 'Jotai documentation with Chinese translation and automated upstream synchronization.',
			components: {
				PageTitle: './src/components/starlight/PageTitle.astro',
			},
			defaultLocale: 'root',
			locales: {
				root: {
					label: 'English',
					lang: 'en',
				},
				zh: {
					label: '简体中文',
					lang: 'zh-CN',
				},
			},
			customCss: ['./src/styles/theme.css'],
			social: [
				{
					icon: 'github',
					label: 'Jotai Upstream',
					href: 'https://github.com/pmndrs/jotai',
				},
			],
			sidebar,
		}),
		mdx(),
	],
});

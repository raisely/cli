import path from 'path';
import fs from 'fs';

import Handlebars from 'handlebars';
import glob from 'glob-promise';

import api from './api.js';

const v3Handlebars = Handlebars.create();

export function compilePageBody(page) {
	const schema = {
		title: page.title,
		body: page.body,
	};
	return v3Handlebars.precompile(JSON.stringify(schema, null, null));
}

/**
 * Build a map of page uuid (or name for preview) -> precompiled template string.
 * @param {{ campaignUuid?: string }} [opts] If campaignUuid is set, only pages belonging to that campaign are compiled.
 */
export async function compileAllLocalPages({ campaignUuid } = {}) {
	const pagesDir = path.join(process.cwd(), 'pages');
	if (!fs.existsSync(pagesDir)) {
		return {};
	}

	const files = await glob('**/*.json', {
		cwd: pagesDir,
		nodir: true,
	});

	const map = {};
	for (const file of files) {
		const fullPath = path.join(pagesDir, file);
		const raw = fs.readFileSync(fullPath, 'utf8');
		let page;
		try {
			page = JSON.parse(raw);
		} catch (e) {
			console.error(`Invalid JSON in ${fullPath}:`, e.message);
			continue;
		}

		if (
			campaignUuid &&
			page.campaignUuid &&
			page.campaignUuid !== campaignUuid
		) {
			continue;
		}

		if (!page.body || page.title === undefined) {
			console.warn(
				`Skipping ${fullPath}: expected title and body for compilation`
			);
			continue;
		}

		const key = page.uuid || page.name;
		if (!key) {
			console.warn(`Skipping ${fullPath}: missing uuid and name`);
			continue;
		}

		map[key] = compilePageBody(page);
	}

	return map;
}

/**
 * Serialize a map for safe embedding inside a <script> tag.
 */
export function scriptSafeJsonForPageOverrides(map) {
	return JSON.stringify(map).replace(/</g, '\\u003c');
}

/**
 * Build the inline script that patches window.pageSchemas with local compilations.
 */
export function buildPageOverrideScript(compiledMap) {
	if (!compiledMap || !Object.keys(compiledMap).length) {
		return '';
	}

	const json = scriptSafeJsonForPageOverrides(compiledMap);
	return `
<script>
(function(){
	var lp = ${json};
	if (window.pageSchemas) {
		window.pageSchemas.forEach(function (p) {
			var k = p.uuid || p.name;
			if (k && Object.prototype.hasOwnProperty.call(lp, k)) {
				p.compiled = lp[k];
			}
		});
	}
})();
</script>`;
}

const PATCHABLE_FIELDS = [
	'body',
	'title',
	'internalTitle',
	'name',
	'path',
	'status',
	'provider',
	'condition',
	'image',
	'metaDescription',
	'socialTitle',
	'socialDescription',
	'protected',
	'public',
];

/**
 * PATCH /v3/pages/:uuid with updated page fields from local JSON.
 */
export async function uploadPage(pageData) {
	const { uuid, campaignUuid: _c, ...rest } = pageData;
	if (!uuid) {
		throw new Error('Page JSON must include uuid to deploy');
	}

	const data = {};
	for (const field of PATCHABLE_FIELDS) {
		if (rest[field] !== undefined) {
			data[field] = rest[field];
		}
	}

	return await api({
		path: `/pages/${uuid}?private=1`,
		method: 'PATCH',
		json: { data },
	});
}

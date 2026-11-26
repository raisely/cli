import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	api: vi.fn(),
	loadConfig: vi.fn(),
}));

vi.mock('../src/actions/api.js', () => ({
	default: mocks.api,
}));

vi.mock('../src/config.js', () => ({
	loadConfig: mocks.loadConfig,
}));

vi.mock('ora', () => ({
	default: () => ({
		start: () => ({ succeed: vi.fn(), fail: vi.fn() }),
	}),
}));

import {
	pageFileNames,
	removeStalePageFiles,
	syncPages,
} from '../src/actions/sync.js';

describe('pageFileNames', () => {
	test('names template pages by their unique name', () => {
		const pages = [
			{ uuid: 'u1', name: 'home', path: '/' },
			{ uuid: 'u2', name: 'dashboard', path: '/dashboard' },
			{ uuid: 'u3', name: 'profile', path: '/:id' },
		];
		expect(pageFileNames(pages)).toEqual([
			'home.json',
			'dashboard.json',
			'profile.json',
		]);
	});

	test('falls back to path when multiple pages share a name', () => {
		// Custom (page-builder) pages all share the name "legacy" — naming
		// files by name alone collapses them into a single legacy.json.
		const pages = [
			{ uuid: 'u1', name: 'legacy', path: '/cause-areas' },
			{ uuid: 'u2', name: 'legacy', path: '/terms' },
			{ uuid: 'u3', name: 'legacy', path: '/about/team' },
			{ uuid: 'u4', name: 'home', path: '/' },
		];
		expect(pageFileNames(pages)).toEqual([
			'cause-areas.json',
			'terms.json',
			'about-team.json',
			'home.json',
		]);
	});

	test('keeps name-based file for a name used by only one page', () => {
		const pages = [
			{ uuid: 'u1', name: 'legacy', path: '/only-custom-page' },
			{ uuid: 'u2', name: 'home', path: '/' },
		];
		expect(pageFileNames(pages)).toEqual(['legacy.json', 'home.json']);
	});

	test('uses path for pages without a name', () => {
		const pages = [
			{ uuid: 'u1', name: null, path: '/register' },
			{ uuid: 'u2', name: null, path: '/signup' },
		];
		expect(pageFileNames(pages)).toEqual(['register.json', 'signup.json']);
	});

	test('sanitizes special characters in paths', () => {
		const pages = [
			{ uuid: 'u1', name: null, path: '/reset/:passwordResetToken?' },
		];
		expect(pageFileNames(pages)).toEqual([
			'reset-_passwordResetToken_.json',
		]);
	});

	test('template filenames are reserved regardless of API order', () => {
		// A custom page at the literal path /profile must not take
		// profile.json from the profile template page (path /:id), even
		// when the API returns the custom page first.
		const pages = [
			{ uuid: 'cccccccc-3333', name: 'legacy', path: '/profile' },
			{ uuid: 'dddddddd-4444', name: 'legacy', path: '/terms' },
			{ uuid: 'eeeeeeee-5555', name: 'profile', path: '/:id' },
		];
		expect(pageFileNames(pages)).toEqual([
			'profile-cccccccc.json',
			'terms.json',
			'profile.json',
		]);
	});

	test('treats file names that differ only by case as a collision', () => {
		const pages = [
			{ uuid: 'aaaaaaaa-1111', name: 'legacy', path: '/magiclink' },
			{ uuid: 'bbbbbbbb-2222', name: 'legacy', path: '/terms' },
			{ uuid: 'cccccccc-3333', name: 'magicLink', path: '/magic-link' },
		];
		expect(pageFileNames(pages)).toEqual([
			'magiclink-aaaaaaaa.json',
			'terms.json',
			'magicLink.json',
		]);
	});

	test('disambiguates residual file name collisions with a uuid suffix', () => {
		const pages = [
			{ uuid: 'aaaaaaaa-1111', name: 'legacy', path: '/promo!' },
			{ uuid: 'bbbbbbbb-2222', name: 'legacy', path: '/promo?' },
		];
		expect(pageFileNames(pages)).toEqual([
			'promo_.json',
			'promo_-bbbbbbbb.json',
		]);
	});
});

describe('page file cleanup', () => {
	let tmpDir;

	const writeJson = (dir, name, value) =>
		fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

	beforeEach(() => {
		vi.clearAllMocks();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raisely-sync-'));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	test('removeStalePageFiles removes only old files of synced pages', () => {
		writeJson(tmpDir, 'magicLink.json', { uuid: 'a0a04680-1111' });
		writeJson(tmpDir, 'magic-link-a0a04680.json', {
			uuid: 'a0a04680-1111',
		});
		writeJson(tmpDir, 'archived.json', { uuid: 'not-synced' });
		writeJson(tmpDir, 'no-uuid.json', { title: 'Draft' });
		fs.writeFileSync(path.join(tmpDir, 'broken.json'), '{ not json');
		fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'a0a04680-1111');
		fs.mkdirSync(path.join(tmpDir, 'nested.json'));

		const removed = removeStalePageFiles(
			tmpDir,
			new Map([['a0a04680-1111', 'magic-link-a0a04680.json']])
		);

		expect(removed).toEqual(['magicLink.json']);
		expect(fs.readdirSync(tmpDir).sort()).toEqual([
			'archived.json',
			'broken.json',
			'magic-link-a0a04680.json',
			'nested.json',
			'no-uuid.json',
			'notes.txt',
		]);
	});

	test('removeStalePageFiles keeps one file when names differ only by case', () => {
		// On case-insensitive filesystems the second write lands in
		// Profile.json, so both names point to the same file.
		writeJson(tmpDir, 'Profile.json', { uuid: 'u-profile', body: 'old' });
		writeJson(tmpDir, 'profile.json', { uuid: 'u-profile', body: 'new' });

		removeStalePageFiles(tmpDir, new Map([['u-profile', 'profile.json']]));

		const files = fs.readdirSync(tmpDir);
		expect(files).toHaveLength(1);
		expect(files[0].toLowerCase()).toBe('profile.json');
		expect(
			JSON.parse(fs.readFileSync(path.join(tmpDir, files[0]), 'utf8'))
		).toEqual({ uuid: 'u-profile', body: 'new' });
	});

	test('syncPages replaces an old legacy.json with path-named files', async () => {
		const pagesDir = path.join(tmpDir, 'campaigns', 'my-campaign', 'pages');
		fs.mkdirSync(pagesDir, { recursive: true });
		writeJson(pagesDir, 'legacy.json', {
			uuid: 'u-renamed',
			body: 'stale content',
		});
		writeJson(pagesDir, 'home.json', { uuid: 'u-home', body: 'old home' });
		writeJson(pagesDir, 'deleted-page.json', { uuid: 'u-deleted' });
		fs.writeFileSync(path.join(pagesDir, 'scratch.json'), 'not json');

		vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
		mocks.loadConfig.mockResolvedValue({ campaigns: ['campaign-uuid'] });
		mocks.api.mockImplementation(async ({ path: apiPath }) => {
			if (apiPath.startsWith('/campaigns/campaign-uuid/pages')) {
				return {
					data: [
						{
							uuid: 'u-renamed',
							name: 'legacy',
							path: '/renamed-home-page',
							body: 'fresh content',
						},
						{ uuid: 'u-terms', name: 'legacy', path: '/terms' },
						{
							uuid: 'u-home',
							name: 'home',
							path: '/',
							body: 'new home',
						},
					],
				};
			}
			return { data: { path: 'my-campaign' } };
		});

		await syncPages();

		expect(fs.readdirSync(pagesDir).sort()).toEqual([
			'deleted-page.json',
			'home.json',
			'renamed-home-page.json',
			'scratch.json',
			'terms.json',
		]);
		const renamed = JSON.parse(
			fs.readFileSync(
				path.join(pagesDir, 'renamed-home-page.json'),
				'utf8'
			)
		);
		expect(renamed).toMatchObject({
			uuid: 'u-renamed',
			body: 'fresh content',
		});
		const home = JSON.parse(
			fs.readFileSync(path.join(pagesDir, 'home.json'), 'utf8')
		);
		expect(home).toMatchObject({ uuid: 'u-home', body: 'new home' });
	});
});

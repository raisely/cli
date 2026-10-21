import { describe, expect, test } from 'vitest';

import { pageFileNames } from '../src/actions/sync.js';

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

import { beforeEach, describe, expect, test, vi } from 'vitest';

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

import { createComponent } from '../src/actions/components.js';

const USERS_ME_404 =
	'https://api.raisely.com/v3/users/me (404) failed with message: user with uuid 5be64da0-xxxx... was not found';

describe('createComponent', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadConfig.mockResolvedValue({});
	});

	test('throws a clear error when organisation cannot be resolved', async () => {
		mocks.api.mockImplementation(async ({ path }) => {
			if (path === '/users/me') {
				throw USERS_ME_404;
			}
			if (path === '/authenticate') {
				return { data: {} };
			}
		});

		await expect(createComponent({ name: 'my-widget' })).rejects.toMatch(
			/could not resolve your Raisely organisation/i
		);
		await expect(createComponent({ name: 'my-widget' })).rejects.toMatch(
			/raisely logout/
		);
		await expect(createComponent({ name: 'my-widget' })).rejects.toMatch(
			/raisely login/
		);
		await expect(createComponent({ name: 'my-widget' })).rejects.toMatch(
			/raisely init/
		);
		await expect(createComponent({ name: 'my-widget' })).rejects.not.toBe(
			USERS_ME_404
		);
		expect(
			mocks.api.mock.calls.some(([opts]) => opts.path === '/users/me')
		).toBe(false);
	});

	test('uses organisationUuid from config without calling /users/me', async () => {
		mocks.loadConfig.mockResolvedValue({
			organisationUuid: 'org-from-config',
		});

		mocks.api.mockImplementation(async ({ path, method, json }) => {
			if (path === '/users/me') {
				throw new Error('/users/me should not be called');
			}
			if (path === '/components?private=1' && method === 'POST') {
				return { data: { uuid: 'component-1' } };
			}
			throw new Error(`Unexpected api call: ${method} ${path}`);
		});

		await createComponent({ name: 'my-widget' });

		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/components?private=1',
				method: 'POST',
				json: {
					data: {
						name: 'my-widget',
						organisationUuid: 'org-from-config',
					},
				},
			})
		);
		expect(
			mocks.api.mock.calls.some(([opts]) => opts.path === '/users/me')
		).toBe(false);
	});

	test('falls back to organisationUuid from /authenticate when config has none', async () => {
		mocks.loadConfig.mockResolvedValue({});

		mocks.api.mockImplementation(async ({ path, method }) => {
			if (path === '/users/me') {
				throw new Error('/users/me should not be called');
			}
			if (path === '/authenticate') {
				return { organisationUuid: 'org-from-auth' };
			}
			if (path === '/components?private=1' && method === 'POST') {
				return { data: { uuid: 'component-1' } };
			}
			throw new Error(`Unexpected api call: ${method} ${path}`);
		});

		await createComponent({ name: 'my-widget' });

		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({ path: '/authenticate' })
		);
		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/components?private=1',
				method: 'POST',
				json: {
					data: {
						name: 'my-widget',
						organisationUuid: 'org-from-auth',
					},
				},
			})
		);
	});

	test('ignores the OAuth metadata under data when reading /authenticate', async () => {
		mocks.loadConfig.mockResolvedValue({});

		mocks.api.mockImplementation(async ({ path, method }) => {
			if (path === '/authenticate') {
				return {
					userUuid: 'user-1',
					organisationUuid: 'org-from-auth',
					data: {
						type: 'oauth',
						scopes: ['campaigns'],
						appUuid: 'app-1',
						authorizationUuid: 'authorization-1',
					},
				};
			}
			if (path === '/components?private=1' && method === 'POST') {
				return { data: { uuid: 'component-1' } };
			}
			throw new Error(`Unexpected api call: ${method} ${path}`);
		});

		await createComponent({ name: 'my-widget' });

		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/components?private=1',
				method: 'POST',
				json: {
					data: {
						name: 'my-widget',
						organisationUuid: 'org-from-auth',
					},
				},
			})
		);
	});

	test('throws a clear error when /authenticate fails', async () => {
		const authenticateError =
			'https://api.raisely.com/v3/authenticate (401) failed with message: Unauthorized';

		mocks.api.mockImplementation(async ({ path }) => {
			if (path === '/authenticate') {
				throw authenticateError;
			}
		});

		await expect(createComponent({ name: 'my-widget' })).rejects.toMatch(
			/could not resolve your Raisely organisation/i
		);
		await expect(createComponent({ name: 'my-widget' })).rejects.not.toBe(
			authenticateError
		);
	});
});

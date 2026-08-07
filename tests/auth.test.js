import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const ora = vi.fn((label) => {
		const loader = {
			label,
			start: vi.fn(),
			succeed: vi.fn(),
			fail: vi.fn(),
			warn: vi.fn(),
		};
		loader.start.mockReturnValue(loader);
		return loader;
	});

	return {
		api: vi.fn(),
		updateConfig: vi.fn(),
		getCredentials: vi.fn(),
		inquirerPrompt: vi.fn(),
		log: vi.fn(),
		error: vi.fn(),
		ora,
	};
});

vi.mock('../src/actions/api.js', () => ({
	default: mocks.api,
}));

vi.mock('../src/config.js', () => ({
	updateConfig: mocks.updateConfig,
}));

vi.mock('../src/credentials.js', () => ({
	getCredentials: mocks.getCredentials,
}));

vi.mock('../src/helpers.js', () => ({
	log: mocks.log,
	error: mocks.error,
}));

vi.mock('inquirer', () => ({
	default: {
		prompt: mocks.inquirerPrompt,
	},
}));

vi.mock('ora', () => ({
	default: mocks.ora,
}));

import { getToken } from '../src/actions/auth.js';

/**
 * Shape observed from the live API: identity is flat at the top level, and the
 * `data` key holds OAuth authorization metadata rather than an envelope.
 */
function authenticateResponse({ organisationUuid, userUuid }) {
	return {
		campaigns: [],
		roles: [],
		userUuid,
		userEmail: 'fundraiser@example.org',
		organisationUuid,
		data: {
			type: 'oauth',
			scopes: ['campaigns'],
			appUuid: 'app-1',
			authorizationUuid: 'authorization-1',
		},
	};
}

describe('getToken', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getCredentials.mockResolvedValue({ token: 'token-123' });
	});

	test('does not offer to switch organisation when the authenticated organisation already matches the config', async () => {
		mocks.api.mockResolvedValue(
			authenticateResponse({
				organisationUuid: 'org-1',
				userUuid: 'user-1',
			})
		);

		await getToken({}, { organisationUuid: 'org-1' });

		expect(mocks.inquirerPrompt).not.toHaveBeenCalled();
		expect(
			mocks.api.mock.calls.some(([opts]) =>
				opts.path.startsWith('/users/')
			)
		).toBe(false);
	});

	test('moves the signed-in user by uuid when the organisation genuinely differs', async () => {
		mocks.api.mockImplementation(async ({ path }) => {
			if (path === '/authenticate') {
				return authenticateResponse({
					organisationUuid: 'org-other',
					userUuid: 'user-1',
				});
			}
			return {};
		});
		mocks.inquirerPrompt.mockResolvedValue({ confirm: true });

		await getToken({}, { organisationUuid: 'org-1' });

		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({
				path: '/users/user-1/move',
				method: 'PUT',
				json: { data: { organisationUuid: 'org-1' } },
			})
		);
	});

	test('never builds a move path from an undefined user uuid', async () => {
		mocks.api.mockImplementation(async ({ path }) => {
			if (path === '/authenticate') {
				return authenticateResponse({
					organisationUuid: 'org-other',
					userUuid: 'user-1',
				});
			}
			return {};
		});
		mocks.inquirerPrompt.mockResolvedValue({ confirm: true });

		await getToken({}, { organisationUuid: 'org-1' });

		expect(
			mocks.api.mock.calls.some(([opts]) =>
				opts.path.includes('undefined')
			)
		).toBe(false);
	});
});

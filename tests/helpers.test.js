import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	api: vi.fn(),
	inquirerPrompt: vi.fn(),
}));

vi.mock('../src/actions/api.js', () => ({
	default: mocks.api,
}));

vi.mock('inquirer', () => ({
	default: {
		prompt: mocks.inquirerPrompt,
	},
}));

import { informLocalDev } from '../src/helpers.js';

/**
 * Shape observed from the live API: identity is flat at the top level, the
 * `data` key holds OAuth authorization metadata, and there is no organisation
 * record anywhere in the payload.
 */
const AUTHENTICATE_RESPONSE = {
	campaigns: [],
	roles: [],
	userUuid: 'user-1',
	userEmail: 'fundraiser@example.org',
	organisationUuid: 'org-1',
	data: {
		type: 'oauth',
		scopes: ['campaigns'],
		appUuid: 'app-1',
		authorizationUuid: 'authorization-1',
	},
};

function mockApi({ organisation, organisationError }) {
	mocks.api.mockImplementation(async ({ path }) => {
		if (path === '/authenticate') return AUTHENTICATE_RESPONSE;
		if (path.startsWith('/organisations/')) {
			if (organisationError) throw organisationError;
			return { data: organisation };
		}
		throw new Error(`Unexpected api call: ${path}`);
	});
}

function captureConsole() {
	const lines = [];
	const spy = vi.spyOn(console, 'log').mockImplementation((message) => {
		lines.push(String(message));
	});
	return {
		lines,
		restore() {
			spy.mockRestore();
		},
	};
}

describe('informLocalDev', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('reads the localDevelopment flag from the organisation record, not from /authenticate', async () => {
		mockApi({ organisation: { uuid: 'org-1', private: {} } });

		await expect(
			informLocalDev({ organisationUuid: 'org-1' })
		).resolves.toBe(true);
		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({ path: '/organisations/org-1?private=1' })
		);
		expect(mocks.inquirerPrompt).not.toHaveBeenCalled();
	});

	test('falls back to the organisation uuid from /authenticate when config has none', async () => {
		mockApi({ organisation: { uuid: 'org-1', private: {} } });

		await expect(informLocalDev({})).resolves.toBe(true);
		expect(mocks.api).toHaveBeenCalledWith(
			expect.objectContaining({ path: '/organisations/org-1?private=1' })
		);
	});

	test('continues without warning when local development is not required', async () => {
		mockApi({ organisation: { uuid: 'org-1' } });

		await expect(
			informLocalDev({ organisationUuid: 'org-1' })
		).resolves.toBe(true);
		expect(mocks.inquirerPrompt).not.toHaveBeenCalled();
	});

	test('prompts when local development is required and user confirms', async () => {
		mockApi({
			organisation: {
				uuid: 'org-1',
				private: { localDevelopment: true },
			},
		});
		mocks.inquirerPrompt.mockResolvedValue({ confirm: true });

		await expect(
			informLocalDev({ organisationUuid: 'org-1' })
		).resolves.toBe(true);
		expect(mocks.inquirerPrompt).toHaveBeenCalledOnce();
	});

	test('aborts when local development is required and user declines', async () => {
		mockApi({
			organisation: {
				uuid: 'org-1',
				private: { localDevelopment: true },
			},
		});
		mocks.inquirerPrompt.mockResolvedValue({ confirm: false });

		await expect(
			informLocalDev({ organisationUuid: 'org-1' })
		).resolves.toBe(false);
		expect(mocks.inquirerPrompt).toHaveBeenCalledOnce();
	});

	test('continues when the organisation record cannot be fetched', async () => {
		mockApi({ organisationError: 'organisation lookup failed' });

		await expect(
			informLocalDev({ organisationUuid: 'org-1' })
		).resolves.toBe(true);
		expect(mocks.inquirerPrompt).not.toHaveBeenCalled();
	});

	test('does not crash when /authenticate carries no organisation record', async () => {
		mocks.api.mockImplementation(async ({ path }) => {
			if (path === '/authenticate') return AUTHENTICATE_RESPONSE;
			throw new Error('organisation unavailable');
		});

		await expect(informLocalDev({})).resolves.toBe(true);
	});
});

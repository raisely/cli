import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	fetch: vi.fn(),
	loadConfig: vi.fn(),
	resolveOrganisationContext: vi.fn(),
	getCredentials: vi.fn(),
	getPackageInfo: vi.fn(),
}));

vi.mock('node-fetch', () => ({
	default: mocks.fetch,
}));

vi.mock('../src/config.js', () => ({
	loadConfig: mocks.loadConfig,
}));

vi.mock('../src/credentials.js', () => ({
	resolveOrganisationContext: mocks.resolveOrganisationContext,
	getCredentials: mocks.getCredentials,
}));

vi.mock('../src/helpers.js', () => ({
	getPackageInfo: mocks.getPackageInfo,
}));

import {
	__resetTelemetryForTests,
	flushTelemetry,
	trackEvent,
} from '../src/telemetry.js';

function createJsonResponse(json, ok = true) {
	return {
		ok,
		json: async () => json,
	};
}

describe('telemetry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.RAISELY_NO_TELEMETRY;

		mocks.loadConfig.mockResolvedValue({
			apiUrl: 'https://api.raisely.com',
			organisationUuid: 'org-config',
			campaigns: ['campaign-a', 'campaign-b'],
		});
		mocks.resolveOrganisationContext.mockResolvedValue({
			apiUrl: 'https://api.raisely.com',
			organisationUuid: 'org-context',
		});
		mocks.getCredentials.mockResolvedValue({ token: 'token-123' });
		mocks.getPackageInfo.mockReturnValue({
			name: '@raisely/cli',
			version: '2.0.0-test',
		});
	});

	afterEach(async () => {
		await flushTelemetry();
		__resetTelemetryForTests();
	});

	test('sends telemetry with resolved metadata and reuses cached context', async () => {
		mocks.fetch
			.mockResolvedValueOnce(
				createJsonResponse({
					userUuid: 'user-1',
					organisationUuid: 'org-auth',
				})
			)
			.mockResolvedValueOnce(createJsonResponse({ ok: true }))
			.mockResolvedValueOnce(createJsonResponse({ ok: true }));

		trackEvent('cli.deploy', { outcome: 'success', durationMs: 33 });
		trackEvent('cli.update', { outcome: 'error', durationMs: 7, errorCode: 500 });
		await flushTelemetry();

		expect(mocks.fetch).toHaveBeenCalledTimes(3);
		expect(mocks.fetch).toHaveBeenNthCalledWith(
			1,
			'https://api.raisely.com/v3/authenticate',
			expect.objectContaining({
				method: 'GET',
				headers: expect.objectContaining({
					Authorization: 'Bearer token-123',
				}),
			})
		);
		expect(mocks.fetch).toHaveBeenNthCalledWith(
			2,
			'https://api.raisely.com/v3/t',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"event":"cli.deploy"'),
			})
		);
		expect(mocks.fetch).toHaveBeenNthCalledWith(
			3,
			'https://api.raisely.com/v3/t',
			expect.objectContaining({
				method: 'POST',
				body: expect.stringContaining('"event":"cli.update"'),
			})
		);

		const secondPayload = JSON.parse(mocks.fetch.mock.calls[1][1].body);
		expect(secondPayload.organisationUuid).toBe('org-auth');
		expect(secondPayload.userUuid).toBe('user-1');
		expect(secondPayload.campaignUuid).toBe('campaign-a');
		expect(secondPayload.sessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
		);
		expect(secondPayload.traits.campaignIds).toEqual(['campaign-a', 'campaign-b']);
		expect(secondPayload.traits.cliVersion).toBe('2.0.0-test');
		expect(secondPayload.traits.outcome).toBe('success');
		expect(secondPayload.traits.durationMs).toBe(33);

		const thirdPayload = JSON.parse(mocks.fetch.mock.calls[2][1].body);
		expect(thirdPayload.traits.errorCode).toBe(500);
		expect(thirdPayload.sessionId).toBe(secondPayload.sessionId);
		expect(mocks.resolveOrganisationContext).toHaveBeenCalledTimes(1);
	});

	test('flushTelemetry waits for in-flight telemetry promises', async () => {
		let resolveSend;
		const pendingSend = new Promise((resolve) => {
			resolveSend = resolve;
		});
		mocks.fetch
			.mockResolvedValueOnce(createJsonResponse({ userUuid: 'user-1' }))
			.mockReturnValueOnce(pendingSend);

		trackEvent('cli.local', { outcome: 'success', durationMs: 99 });
		const flushPromise = flushTelemetry();

		let settled = false;
		flushPromise.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		resolveSend(createJsonResponse({ ok: true }));
		await flushPromise;
		expect(settled).toBe(true);
	});

	test('RAISELY_NO_TELEMETRY disables telemetry', async () => {
		process.env.RAISELY_NO_TELEMETRY = 'true';

		trackEvent('cli.list', { outcome: 'success', durationMs: 2 });
		await flushTelemetry();

		expect(mocks.fetch).not.toHaveBeenCalled();
		expect(mocks.loadConfig).not.toHaveBeenCalled();
	});
});

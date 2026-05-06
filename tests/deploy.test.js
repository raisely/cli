import { describe, test } from 'vitest';
import assert from 'node:assert/strict';

import deploy from '../src/deploy.js';

function createLoaderFactory() {
	return () => ({
		start() {
			return {
				succeed() {},
				fail() {},
				warn() {},
			};
		},
	});
}

function createDirent(name) {
	return {
		name,
		isDirectory() {
			return true;
		},
	};
}

describe('deploy command', () => {
	test('validation failure prints all errors and blocks uploads', async () => {
		const messages = [];
		const uploads = [];
		const exitCodes = [];

		await deploy(
			{},
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => ({
					ok: false,
					error: 'SassError: Expected "}"',
				}),
				validateComponentFn: async () => ({
					ok: false,
					error: 'Unexpected token (4:9)',
				}),
				uploadStylesFn: async () => {
					uploads.push('styles');
				},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) {
							return [createDirent('hero')];
						}
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: (message) => messages.push(message),
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: (code) => exitCodes.push(code),
			}
		);

		assert.deepEqual(uploads, []);
		assert.deepEqual(exitCodes, [1]);
		assert.equal(
			messages.includes('Campaign my-campaign: SassError: Expected "}"'),
			true
		);
		assert.equal(
			messages.includes('Component hero: Unexpected token (4:9)'),
			true
		);
	});

	test('--no-validate skips the gate and continues deploy', async () => {
		let campaignValidationCalls = 0;
		let componentValidationCalls = 0;
		let styleUploads = 0;

		await deploy(
			{ validate: false },
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => {
					campaignValidationCalls += 1;
					return { ok: true };
				},
				validateComponentFn: async () => {
					componentValidationCalls += 1;
					return { ok: true };
				},
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				updateComponentConfigFn: async () => {},
				updateComponentFileFn: async () => {},
				uploadPageFn: async () => {},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) return [];
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: () => {},
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: () => {},
			}
		);

		assert.equal(campaignValidationCalls, 0);
		assert.equal(componentValidationCalls, 0);
		assert.equal(styleUploads, 1);
	});

	test('network failure during validation blocks deploy with exit code 1', async () => {
		const messages = [];
		let styleUploads = 0;
		const exitCodes = [];

		await deploy(
			{},
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => ({
					ok: false,
					error: 'socket hang up',
				}),
				validateComponentFn: async () => ({ ok: true }),
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) return [];
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: (message) => messages.push(message),
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: (code) => exitCodes.push(code),
			}
		);

		assert.equal(styleUploads, 0);
		assert.deepEqual(exitCodes, [1]);
		assert.equal(messages.includes('Campaign my-campaign: socket hang up'), true);
	});

	test('malformed validator result fails deploy gracefully', async () => {
		const messages = [];
		let styleUploads = 0;
		const exitCodes = [];

		await deploy(
			{},
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => undefined,
				validateComponentFn: async () => ({ ok: true }),
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) return [];
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: (message) => messages.push(message),
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: (code) => exitCodes.push(code),
			}
		);

		assert.equal(styleUploads, 0);
		assert.deepEqual(exitCodes, [1]);
		assert.equal(
			messages.includes(
				'Campaign my-campaign: SASS validator returned an invalid response.'
			),
			true
		);
	});

	test('cli=true still runs validation gate before uploads', async () => {
		let campaignValidationCalls = 0;
		let componentValidationCalls = 0;
		let styleUploads = 0;

		await deploy(
			{},
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => {
					campaignValidationCalls += 1;
					return { ok: true };
				},
				validateComponentFn: async () => {
					componentValidationCalls += 1;
					return { ok: true };
				},
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				updateComponentConfigFn: async () => {},
				updateComponentFileFn: async () => {},
				uploadPageFn: async () => {},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) return [];
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: () => {},
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: () => {},
			}
		);

		assert.equal(campaignValidationCalls, 1);
		assert.equal(componentValidationCalls, 0);
		assert.equal(styleUploads, 1);
	});

	test('--force still runs validation and blocks on failure', async () => {
		let campaignValidationCalls = 0;
		let styleUploads = 0;
		const exitCodes = [];

		await deploy(
			{ force: true },
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: false,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => {
					campaignValidationCalls += 1;
					return { ok: false, error: 'SassError: invalid selector' };
				},
				validateComponentFn: async () => ({ ok: true }),
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				fsModule: {
					existsSync() {
						return true;
					},
					readdirSync(_dir, options) {
						if (options && options.withFileTypes) return [];
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: () => {},
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: (code) => exitCodes.push(code),
			}
		);

		assert.equal(campaignValidationCalls, 1);
		assert.equal(styleUploads, 0);
		assert.deepEqual(exitCodes, [1]);
	});

	test('missing components directory does not crash deploy', async () => {
		let styleUploads = 0;
		let pageUploads = 0;
		const exitCodes = [];

		await deploy(
			{},
			{
				cwd: () => '/repo',
				loadConfigFn: async () => ({
					campaigns: ['campaign-uuid'],
					cli: true,
				}),
				getTokenFn: async () => 'token-123',
				getCampaignFn: async () => ({
					data: { uuid: 'campaign-uuid', path: 'my-campaign' },
				}),
				validateCampaignSassFn: async () => ({ ok: true }),
				validateComponentFn: async () => ({ ok: true }),
				uploadStylesFn: async () => {
					styleUploads += 1;
				},
				uploadPageFn: async () => {
					pageUploads += 1;
				},
				fsModule: {
					existsSync(filePath) {
						return filePath !== '/repo/components';
					},
					readdirSync() {
						return [];
					},
					readFileSync() {
						return '';
					},
				},
				globFn: async () => [],
				logFn: () => {},
				brFn: () => {},
				welcomeFn: () => {},
				informUpdateFn: async () => {},
				loaderFactory: createLoaderFactory(),
				consoleRef: {
					log() {},
					error() {},
				},
				setExitCode: (code) => exitCodes.push(code),
			}
		);

		assert.equal(styleUploads, 1);
		assert.equal(pageUploads, 0);
		assert.deepEqual(exitCodes, []);
	});
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
	handleCampaignChange,
	handleComponentChange,
	registerStartWatchers,
} from '../src/start.js';

function createOraHarness() {
	const loaders = [];
	const oraFn = (message) => ({
		start() {
			const loader = {
				message,
				succeeded: false,
				failed: null,
				succeed() {
					this.succeeded = true;
				},
				fail(errorMessage) {
					this.failed = errorMessage;
				},
			};
			loaders.push(loader);
			return loader;
		},
	});
	return { oraFn, loaders };
}

describe('start per-save validation', () => {
	test('bad SCSS save fails inline and skips upload', async () => {
		let uploadCalls = 0;
		const { oraFn, loaders } = createOraHarness();

		await handleCampaignChange('/repo/campaigns/acme/stylesheets/main.scss', {
			campaignsDir: '/repo/campaigns',
			token: 'token-123',
			validateCampaignSassFn: async ({ campaign, token }) => {
				assert.equal(campaign, 'acme');
				assert.equal(token, 'token-123');
				return { ok: false, error: 'SassError: expected "}"' };
			},
			uploadStylesFn: async () => {
				uploadCalls += 1;
			},
			oraFn,
		});

		assert.equal(uploadCalls, 0);
		assert.equal(loaders.length, 1);
		assert.equal(loaders[0].failed, 'SassError: expected "}"');
		assert.equal(loaders[0].succeeded, false);
	});

	test('bad component save fails inline and skips upload', async () => {
		let updateFileCalls = 0;
		const { oraFn, loaders } = createOraHarness();
		const componentFs = {
			readFileSync(filePath) {
				if (filePath === '/repo/components/Hero/Hero.js') {
					return 'export default () => <div />;';
				}
				if (filePath === '/repo/components/Hero/Hero.json') {
					return '{"uuid":"component-1","fields":[]}';
				}
				throw new Error(`Unexpected file read: ${filePath}`);
			},
		};

		await handleComponentChange('/repo/components/Hero/Hero.js', {
			componentsDir: '/repo/components',
			config: { token: 'token-123' },
			fsModule: componentFs,
			validateComponentFn: async ({ name }) => {
				assert.equal(name, 'Hero');
				return { ok: false, error: 'Unexpected token (1:25)' };
			},
			updateComponentFileFn: async () => {
				updateFileCalls += 1;
			},
			updateComponentConfigFn: async () => {
				throw new Error('Config update should not run for JS save');
			},
			oraFn,
		});

		assert.equal(updateFileCalls, 0);
		assert.equal(loaders.length, 1);
		assert.equal(loaders[0].failed, 'Unexpected token (1:25)');
		assert.equal(loaders[0].succeeded, false);
	});

	test('next valid save uploads after a failed validation', async () => {
		let validationCalls = 0;
		let updateFileCalls = 0;
		const { oraFn, loaders } = createOraHarness();
		const componentFs = {
			readFileSync(filePath) {
				if (filePath === '/repo/components/Hero/Hero.js') {
					return 'export default () => <div />;';
				}
				if (filePath === '/repo/components/Hero/Hero.json') {
					return '{"uuid":"component-1","fields":[]}';
				}
				throw new Error(`Unexpected file read: ${filePath}`);
			},
		};

		const invoke = () =>
			handleComponentChange('/repo/components/Hero/Hero.js', {
				componentsDir: '/repo/components',
				config: { token: 'token-123' },
				fsModule: componentFs,
				validateComponentFn: async () => {
					validationCalls += 1;
					if (validationCalls === 1) {
						return { ok: false, error: 'Unexpected token (1:25)' };
					}
					return { ok: true };
				},
				updateComponentFileFn: async () => {
					updateFileCalls += 1;
				},
				updateComponentConfigFn: async () => {
					throw new Error('Config update should not run for JS save');
				},
				oraFn,
			});

		await invoke();
		await invoke();

		assert.equal(validationCalls, 2);
		assert.equal(updateFileCalls, 1);
		assert.equal(loaders[0].failed, 'Unexpected token (1:25)');
		assert.equal(loaders[1].succeeded, true);
	});

	test('watcher callback stays active after failed validation', async () => {
		const callbacks = new Map();
		const watchFn = (target, _options, callback) => {
			callbacks.set(target, callback);
			return { close() {} };
		};
		const { oraFn, loaders } = createOraHarness();
		let validationCalls = 0;
		let uploadCalls = 0;

		registerStartWatchers(
			{
				campaignsDir: '/repo/campaigns',
				componentsDir: '/repo/components',
				config: { token: 'token-123' },
				watchFn,
			},
			{
				oraFn,
				validateCampaignSassFn: async () => {
					validationCalls += 1;
					if (validationCalls === 1) {
						return { ok: false, error: 'SassError: expected "}"' };
					}
					return { ok: true };
				},
				uploadStylesFn: async () => {
					uploadCalls += 1;
				},
				validateComponentFn: async () => ({ ok: true }),
				updateComponentFileFn: async () => {},
				updateComponentConfigFn: async () => {},
				fsModule: {
					readFileSync() {
						return '{}';
					},
				},
			}
		);

		const campaignCallback = callbacks.get('/repo/campaigns');
		assert.equal(typeof campaignCallback, 'function');

		await campaignCallback('update', '/repo/campaigns/acme/stylesheets/main.scss');
		await campaignCallback('update', '/repo/campaigns/acme/stylesheets/main.scss');

		assert.equal(validationCalls, 2);
		assert.equal(uploadCalls, 1);
		assert.equal(loaders[0].failed, 'SassError: expected "}"');
		assert.equal(loaders[1].succeeded, true);
	});
});

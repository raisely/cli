import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
	validateCampaignSass,
	validateComponent,
} from '../src/actions/validate.js';

function response(status, body = '', statusText = '') {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText,
		async text() {
			return body;
		},
	};
}

describe('validateCampaignSass', () => {
	test('returns ok=true when transpiler accepts styles', async () => {
		const calls = [];
		const result = await validateCampaignSass(
			{
				campaign: { uuid: 'campaign-uuid', path: 'my-campaign' },
				token: 'token-1',
			},
			{
				getBaseStylesFn: async () => '.base{}',
				processStylesFn: async () => '.local{}',
				fetchImpl: async (url, options) => {
					calls.push({ url, options });
					return response(200, '.compiled{}');
				},
			}
		);

		assert.deepEqual(result, { ok: true });
		assert.equal(calls.length, 1);
		assert.equal(calls[0].options.body, '.base{}.local{}');
	});

	test('returns transpiler error body for invalid scss', async () => {
		const result = await validateCampaignSass(
			{
				campaign: { uuid: 'campaign-uuid', path: 'my-campaign' },
				token: 'token-1',
			},
			{
				getBaseStylesFn: async () => '.base{}',
				processStylesFn: async () => '.local{}',
				fetchImpl: async () =>
					response(422, 'Expected ";" after property value'),
			}
		);

		assert.deepEqual(result, {
			ok: false,
			error: 'Expected ";" after property value',
		});
	});

	test('refreshes once on first 401 and retries successfully', async () => {
		let attempts = 0;
		let refreshCount = 0;
		const result = await validateCampaignSass(
			{
				campaign: { uuid: 'campaign-uuid', path: 'my-campaign' },
				token: 'expired-token',
			},
			{
				getBaseStylesFn: async () => '.base{}',
				processStylesFn: async () => '.local{}',
				refreshCredentialsFn: async () => {
					refreshCount += 1;
				},
				getCredentialsFn: async () => ({ token: 'fresh-token' }),
				fetchImpl: async (_url, options) => {
					attempts += 1;
					if (attempts === 1) {
						assert.equal(options.headers.Authorization, 'Bearer expired-token');
						return response(401, 'Unauthorized');
					}
					assert.equal(options.headers.Authorization, 'Bearer fresh-token');
					return response(200, '.compiled{}');
				},
			}
		);

		assert.deepEqual(result, { ok: true });
		assert.equal(refreshCount, 1);
		assert.equal(attempts, 2);
	});

	test('returns auth-failure shape after second 401', async () => {
		let refreshCount = 0;
		const result = await validateCampaignSass(
			{
				campaign: { uuid: 'campaign-uuid', path: 'my-campaign' },
				token: 'expired-token',
			},
			{
				getBaseStylesFn: async () => '.base{}',
				processStylesFn: async () => '.local{}',
				refreshCredentialsFn: async () => {
					refreshCount += 1;
				},
				getCredentialsFn: async () => ({ token: 'still-expired-token' }),
				fetchImpl: async () => response(401, 'Unauthorized'),
			}
		);

		assert.deepEqual(result, {
			ok: false,
			error: 'Authentication failed; run `raisely login`.',
		});
		assert.equal(refreshCount, 1);
	});

	test('returns blocking error on network failures', async () => {
		const result = await validateCampaignSass(
			{
				campaign: { uuid: 'campaign-uuid', path: 'my-campaign' },
				token: 'token-1',
			},
			{
				getBaseStylesFn: async () => '.base{}',
				processStylesFn: async () => '.local{}',
				fetchImpl: async () => {
					throw new Error('socket hang up');
				},
			}
		);

		assert.deepEqual(result, {
			ok: false,
			error: 'socket hang up',
		});
	});
});

describe('validateComponent', () => {
	test('returns ok=true for valid component source', async () => {
		let transformed = 0;
		const result = await validateComponent(
			{ name: 'SignupForm' },
			{
				cwd: () => '/repo',
				fsModule: {
					readFileSync(filePath) {
						assert.equal(
							filePath,
							'/repo/components/SignupForm/SignupForm.js'
						);
						return 'export default () => <div />;';
					},
				},
				loadBabelCoreFn: async () => ({
					Babel: {
						async transformAsync() {
							transformed += 1;
							return { code: 'ok' };
						},
					},
					presetEnv: Symbol('presetEnv'),
					presetReact: Symbol('presetReact'),
					classProps: Symbol('classProps'),
				}),
			}
		);

		assert.deepEqual(result, { ok: true });
		assert.equal(transformed, 1);
	});

	test('returns babel error for invalid component syntax', async () => {
		const result = await validateComponent(
			{ name: 'BrokenComponent' },
			{
				cwd: () => '/repo',
				fsModule: {
					readFileSync() {
						return 'export default () => <div>';
					},
				},
				loadBabelCoreFn: async () => ({
					Babel: {
						async transformAsync() {
							throw new Error('Unexpected token (1:25)');
						},
					},
					presetEnv: Symbol('presetEnv'),
					presetReact: Symbol('presetReact'),
					classProps: Symbol('classProps'),
				}),
			}
		);

		assert.deepEqual(result, {
			ok: false,
			error: 'Unexpected token (1:25)',
		});
	});

	test('returns babel error for unsupported language feature', async () => {
		const result = await validateComponent(
			{ name: 'UnsupportedSyntax' },
			{
				cwd: () => '/repo',
				fsModule: {
					readFileSync() {
						return 'export default () => null;';
					},
				},
				loadBabelCoreFn: async () => ({
					Babel: {
						async transformAsync() {
							throw new Error(
								'Support for the experimental syntax is not currently enabled'
							);
						},
					},
					presetEnv: Symbol('presetEnv'),
					presetReact: Symbol('presetReact'),
					classProps: Symbol('classProps'),
				}),
			}
		);

		assert.deepEqual(result, {
			ok: false,
			error: 'Support for the experimental syntax is not currently enabled',
		});
	});
});

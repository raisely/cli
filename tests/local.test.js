import { describe, test } from 'vitest';
import assert from 'node:assert/strict';

import { createStylesRouteHandler } from '../src/local.js';

function makeTranspilerResponse({ status, body = '', statusText = '' }) {
	return {
		status,
		ok: status >= 200 && status < 300,
		statusText,
		text: async () => body,
	};
}

function makeResponseHarness() {
	return {
		headers: {},
		statusCode: 200,
		body: undefined,
		set(name, value) {
			this.headers[name] = value;
			return this;
		},
		status(code) {
			this.statusCode = code;
			return this;
		},
		send(payload) {
			this.body = payload;
			return this;
		},
		sendStatus(code) {
			this.statusCode = code;
			this.body = undefined;
			return this;
		},
	};
}

function createLogger() {
	return {
		errors: [],
		warns: [],
		error(value) {
			this.errors.push(value);
		},
		warn(value) {
			this.warns.push(value);
		},
	};
}

function hasLogMessage(entries, expectedMessage) {
	return entries.some(
		(entry) =>
			typeof entry === 'string' &&
			entry.includes(expectedMessage)
	);
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('local styles route', () => {
	test('cold cache 4xx returns 502 with transpiler error as css comment', async () => {
		const logs = createLogger();
		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () =>
				makeTranspilerResponse({
					status: 422,
					body: 'Error: expected "}" on line 2',
					statusText: 'Unprocessable Entity',
				}),
			logs,
		});

		const res = makeResponseHarness();
		await handler({}, res);

		assert.equal(res.statusCode, 502);
		assert.equal(
			res.body,
			'/*\nError: expected "}" on line 2\n*/'
		);
		assert.deepEqual(logs.errors, ['Error: expected "}" on line 2']);
	});

	test('warm cache 4xx serves last good css and logs transpiler error', async () => {
		const logs = createLogger();
		const queue = [
			makeTranspilerResponse({
				status: 200,
				body: '.fresh { color: green; }',
				statusText: 'OK',
			}),
			makeTranspilerResponse({
				status: 400,
				body: 'SassError: invalid selector',
				statusText: 'Bad Request',
			}),
		];

		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () => queue.shift(),
			logs,
		});

		const firstRes = makeResponseHarness();
		await handler({}, firstRes);
		assert.equal(firstRes.statusCode, 200);
		assert.equal(firstRes.body, '.fresh { color: green; }');

		const secondRes = makeResponseHarness();
		await handler({}, secondRes);
		assert.equal(secondRes.statusCode, 200);
		assert.equal(secondRes.body, '.fresh { color: green; }');
		assert.deepEqual(logs.errors, ['SassError: invalid selector']);
	});

	test('401 warns and keeps serving from cache on later requests', async () => {
		const logs = createLogger();
		const queue = [
			makeTranspilerResponse({
				status: 200,
				body: '.cached { color: blue; }',
				statusText: 'OK',
			}),
			makeTranspilerResponse({
				status: 401,
				body: 'Unauthorized',
				statusText: 'Unauthorized',
			}),
			makeTranspilerResponse({
				status: 200,
				body: '.new { color: purple; }',
				statusText: 'OK',
			}),
		];

		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () => queue.shift(),
			logs,
		});

		const firstRes = makeResponseHarness();
		await handler({}, firstRes);
		assert.equal(firstRes.body, '.cached { color: blue; }');

		const secondRes = makeResponseHarness();
		await handler({}, secondRes);
		assert.equal(secondRes.statusCode, 200);
		assert.equal(secondRes.body, '.cached { color: blue; }');

		const thirdRes = makeResponseHarness();
		await handler({}, thirdRes);
		assert.equal(thirdRes.statusCode, 200);
		assert.equal(thirdRes.body, '.new { color: purple; }');
		assert.equal(logs.warns.length, 1);
		assert.equal(hasLogMessage(logs.errors, 'Unauthorized'), true);
	});

	test('5xx retries once after 500ms before falling back', async () => {
		const logs = createLogger();
		let fetchCalls = 0;
		let waitCalls = 0;
		const queue = [
			makeTranspilerResponse({
				status: 200,
				body: '.baseline { color: black; }',
				statusText: 'OK',
			}),
			makeTranspilerResponse({
				status: 503,
				body: 'Service unavailable',
				statusText: 'Service Unavailable',
			}),
			makeTranspilerResponse({
				status: 503,
				body: 'Still unavailable',
				statusText: 'Service Unavailable',
			}),
		];

		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () => {
				fetchCalls += 1;
				return queue.shift();
			},
			waitFn: async () => {
				waitCalls += 1;
			},
			logs,
		});

		const firstRes = makeResponseHarness();
		await handler({}, firstRes);
		assert.equal(firstRes.body, '.baseline { color: black; }');

		const secondRes = makeResponseHarness();
		await handler({}, secondRes);
		assert.equal(secondRes.statusCode, 200);
		assert.equal(secondRes.body, '.baseline { color: black; }');
		assert.equal(waitCalls, 1);
		assert.equal(fetchCalls, 3);
		assert.equal(hasLogMessage(logs.errors, 'Still unavailable'), true);
		assert.equal(
			logs.errors.some(
				(entry) =>
					typeof entry === 'string' &&
					entry.includes('SASS transpiler failed after retry: 503')
			),
			true
		);
	});

	test('network error then 5xx only retries once total', async () => {
		const logs = createLogger();
		let fetchCalls = 0;
		let waitCalls = 0;
		const firstError = new Error('socket hang up');
		const queue = [
			'throw',
			makeTranspilerResponse({
				status: 503,
				body: 'Service unavailable',
				statusText: 'Service Unavailable',
			}),
		];

		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () => {
				fetchCalls += 1;
				const next = queue.shift();
				if (next === 'throw') {
					throw firstError;
				}
				return next;
			},
			waitFn: async () => {
				waitCalls += 1;
			},
			logs,
		});

		const res = makeResponseHarness();
		await handler({}, res);

		assert.equal(waitCalls, 1);
		assert.equal(fetchCalls, 2);
		assert.equal(res.statusCode, 502);
		assert.equal(
			logs.errors.some(
				(entry) =>
					typeof entry === 'string' &&
					entry.includes('SASS transpiler failed after retry: 503')
			),
			true
		);
	});

	test('older in-flight success does not overwrite newer cached css', async () => {
		const logs = createLogger();
		const firstFetch = createDeferred();
		const secondFetch = createDeferred();
		let fetchCalls = 0;

		const handler = createStylesRouteHandler({
			campaignPath: 'my-campaign',
			baseStyles: '',
			token: 'token-123',
			processStylesFn: async () => '.hero { color: red; }',
			fetchFn: async () => {
				fetchCalls += 1;
				if (fetchCalls === 1) return firstFetch.promise;
				if (fetchCalls === 2) return secondFetch.promise;
				return makeTranspilerResponse({
					status: 400,
					body: 'SassError: broken',
					statusText: 'Bad Request',
				});
			},
			logs,
		});

		const firstRes = makeResponseHarness();
		const secondRes = makeResponseHarness();

		const firstRequest = handler({}, firstRes);
		const secondRequest = handler({}, secondRes);

		secondFetch.resolve(
			makeTranspilerResponse({
				status: 200,
				body: '.newest { color: green; }',
				statusText: 'OK',
			})
		);
		firstFetch.resolve(
			makeTranspilerResponse({
				status: 200,
				body: '.stale { color: red; }',
				statusText: 'OK',
			})
		);

		await Promise.all([firstRequest, secondRequest]);

		assert.equal(secondRes.body, '.newest { color: green; }');
		assert.equal(firstRes.body, '.stale { color: red; }');

		const fallbackRes = makeResponseHarness();
		await handler({}, fallbackRes);

		assert.equal(fallbackRes.statusCode, 200);
		assert.equal(fallbackRes.body, '.newest { color: green; }');
	});
});

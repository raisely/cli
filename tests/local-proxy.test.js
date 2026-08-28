import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';

import express from 'express';

import { createCampaignProxy, injectPageOverride } from '../src/local.js';
import { buildPageOverrideScript } from '../src/actions/pages.js';

/** Campaign HTML shaped like the real one: pageSchemas bootstrap, then the small window.campaign script. */
function campaignHtml(bodyCopy = 'hello') {
	return [
		'<!doctype html><html><head><title>t</title></head><body>',
		`<script>window.pageSchemas = [{"uuid":"page-1","body":${JSON.stringify(
			bodyCopy
		)}}];</script>`,
		'<script>\n\t\t\tif (window.campaign) { console.log(1); }</script>',
		'</body></html>',
	].join('\n');
}

async function listen(server) {
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	return server.address().port;
}

describe('injectPageOverride', () => {
	test('inserts the payload between the bootstrap and the window.campaign script', () => {
		const out = injectPageOverride(campaignHtml(), '<script>PAYLOAD</script>');
		assert.ok(out.includes('];</script><script>PAYLOAD</script>'));
		assert.ok(
			out.indexOf('PAYLOAD') > out.indexOf('window.pageSchemas'),
			'payload must come after the pageSchemas bootstrap'
		);
		assert.ok(
			out.indexOf('PAYLOAD') < out.indexOf('if (window.campaign)'),
			'payload must come before the window.campaign script'
		);
	});

	test('returns the html untouched when there is no payload', () => {
		const html = campaignHtml();
		assert.equal(injectPageOverride(html, ''), html);
	});

	// Regression: page copy legitimately contains dollar amounts. `$1`..`$9`, `$&`,
	// backtick-$ and `$'` are all special in a String.replace REPLACEMENT string, so
	// interpolating the payload into a template literal silently rewrites it and the
	// injected <script> stops parsing.
	for (const token of ['$2', '$1', '$&', "$'", '$$', '$`']) {
		test(`preserves a literal ${token} in the payload`, () => {
			const payload = `<script>var copy = "less than ${token} a day";</script>`;
			const out = injectPageOverride(campaignHtml(), payload);
			assert.ok(
				out.includes(payload),
				`payload was rewritten by String.replace: ${out.slice(
					out.indexOf('var copy'),
					out.indexOf('var copy') + 120
				)}`
			);
		});
	}

	test('a compiled page containing "$2" still yields a parseable script', () => {
		// Full path: real compiled-template payload -> injection -> must still parse.
		const script = buildPageOverrideScript({
			'page-1': 'return "surviving on less than $2 a day";',
		});
		const out = injectPageOverride(campaignHtml(), script);

		assert.ok(out.includes(script), 'payload must survive injection byte-for-byte');

		const inner = script
			.replace(/^\s*<script>/, '')
			.replace(/<\/script>\s*$/, '');
		assert.doesNotThrow(
			() => new vm.Script(inner),
			'injected page-override script must be syntactically valid JavaScript'
		);
		assert.ok(out.includes('less than $2 a day'));
	});

	test('falls back to the footer marker, then </body>', () => {
		const footer = '<html><body><!-- _footer_integrations_ --></body></html>';
		assert.ok(injectPageOverride(footer, '<b>$1</b>').includes('<b>$1</b>'));

		const plain = '<html><body>hi</body></html>';
		const out = injectPageOverride(plain, '<b>$&</b>');
		assert.ok(out.includes('<b>$&</b>\n</body>'));
	});
});

describe('createCampaignProxy', () => {
	// Regression: the response handler must be registered under `on: { proxyRes }`.
	// http-proxy-middleware v3 ignores the v2 `onProxyRes` option while still
	// honouring selfHandleResponse, so nothing ever writes to the response and
	// every proxied request hangs until the client gives up.
	test('returns the transformed upstream body instead of hanging', async () => {
		const upstream = http.createServer((req, res) => {
			res.writeHead(200, { 'Content-Type': 'text/html' });
			res.end(campaignHtml());
		});
		const upstreamPort = await listen(upstream);

		const app = express();
		app.use(
			'/',
			createCampaignProxy({
				target: `http://127.0.0.1:${upstreamPort}`,
				secure: false,
				onHtml: async (html) => html.replace('<title>t</title>', '<title>local</title>'),
			})
		);
		const proxy = http.createServer(app);
		const proxyPort = await listen(proxy);

		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 5000);

			let res;
			try {
				res = await fetch(`http://127.0.0.1:${proxyPort}/`, {
					signal: controller.signal,
				});
			} catch (e) {
				if (e.name === 'AbortError') {
					assert.fail(
						'proxied request never returned — the response handler is not ' +
							'registered (http-proxy-middleware v3 needs `on: { proxyRes }`, ' +
							'not the v2 `onProxyRes`), while selfHandleResponse is still set'
					);
				}
				throw e;
			}
			const body = await res.text();
			clearTimeout(timer);

			assert.equal(res.status, 200);
			assert.ok(body.includes('<title>local</title>'), 'onHtml must be applied');
			assert.ok(body.includes('window.pageSchemas'), 'upstream body must pass through');
		} finally {
			await new Promise((r) => proxy.close(r));
			await new Promise((r) => upstream.close(r));
		}
	}, 20000);
});

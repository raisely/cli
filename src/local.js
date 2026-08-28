import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import express from 'express';
import open from 'open';
import fetch from 'node-fetch';
import { hashElement } from 'folder-hash';
import zlib from 'zlib';
import * as fzstd from 'fzstd';

import {
	createProxyMiddleware,
	responseInterceptor,
} from 'http-proxy-middleware';

import { welcome, log, br, error, informUpdate } from './helpers.js';

import {
	processStyles,
	getBaseStyles,
	getCampaigns,
	getCampaign,
} from './actions/campaigns.js';
import { compileComponents } from './actions/components.js';
import {
	compileAllLocalPages,
	buildPageOverrideScript,
} from './actions/pages.js';
import { sleep } from './actions/sleep.js';
import { getToken } from './actions/auth.js';
import { loadConfig } from './config.js';
import {
	detectLayout,
	shouldRefuseLayoutForCommand,
	getLegacyLayoutRefusalMessage,
} from './actions/layout.js';

// local development config
const DEFAULT_PORT = 8015;
const DEFAULT_API_URL = 'https://api.raisely.com';
const DEFAULT_SASS_TRANSPILER_URL = 'https://sass-transpiler.raisely.com';
const DEFAULT_TRANSPILE_RETRY_DELAY_MS = 500;

/**
 * Build a small script that, only when the user has opted into a non-prod API,
 * rewrites browser API calls from https://api.raisely.com to config.apiUrl.
 *
 * The campaign's frontend bundle picks its API host from window.location.hostname,
 * so when it's loaded over localhost it falls through to api.raisely.com.
 * Patching fetch/XHR sidesteps that resolver without changing the bundle.
 *
 * Returns an empty string when apiUrl is the production default, so prod/staging
 * users get exactly the previous behavior.
 */
function buildApiRedirectScript(apiUrl) {
	if (!apiUrl || apiUrl === DEFAULT_API_URL) return '';
	const target = apiUrl.replace(/\/$/, '');
	return `
<script>
(function () {
	var FROM = ${JSON.stringify(DEFAULT_API_URL)};
	var TO = ${JSON.stringify(target)};
	function rewrite(url) {
		if (typeof url !== 'string') return url;
		return url.indexOf(FROM) === 0 ? TO + url.slice(FROM.length) : url;
	}
	var originalFetch = window.fetch;
	if (originalFetch) {
		window.fetch = function (input, init) {
			if (typeof input === 'string') {
				return originalFetch(rewrite(input), init);
			}
			if (input && typeof input.url === 'string' && input.url.indexOf(FROM) === 0) {
				return originalFetch(new Request(rewrite(input.url), input), init);
			}
			return originalFetch(input, init);
		};
	}
	var XHR = window.XMLHttpRequest;
	if (XHR && XHR.prototype && XHR.prototype.open) {
		var originalOpen = XHR.prototype.open;
		XHR.prototype.open = function (method, url) {
			arguments[1] = rewrite(url);
			return originalOpen.apply(this, arguments);
		};
	}
})();
</script>
`;
}

function decompressZstdBuffer(responseBuffer) {
	return new Promise((resolve, reject) => {
		const decompressedChunks = [];
		const decompressStream = new fzstd.Decompress((chunk, isLast) => {
			decompressedChunks.push(chunk);
			if (isLast) {
				resolve(Buffer.concat(decompressedChunks).toString('utf8'));
			}
		});
		try {
			decompressStream.push(responseBuffer);
			decompressStream.push(new Uint8Array(0), true);
		} catch (error) {
			reject(error);
		}
	});
}

/** Decode proxied body; encoding may be zstd, br, gzip, or plain (already decompressed). */
async function decodeProxyResponseBuffer(responseBuffer, proxyRes) {
	const enc = String(proxyRes.headers['content-encoding'] || '').toLowerCase();
	try {
		if (enc.includes('zstd')) {
			return await decompressZstdBuffer(responseBuffer);
		}
		if (enc.includes('br')) {
			return zlib.brotliDecompressSync(responseBuffer).toString('utf8');
		}
		if (enc.includes('gzip')) {
			return zlib.gunzipSync(responseBuffer).toString('utf8');
		}
	} catch {
		// Middleware may have already decompressed while leaving a stale encoding header.
	}
	return responseBuffer.toString('utf8');
}

// window.pageSchemas is set in the first large <script> in <body>. Inject after
// that </script> but before later bundles (and before the small
// `if (window.campaign)` script). Edge strips <!-- _footer_integrations_ -->
// before HTML is sent, and injecting before </body> runs too late (React has
// already read pageSchemas).
const AFTER_CAMPAIGN_BOOTSTRAP =
	/(<\/script>)(\s*<script>\s*if\s*\(\s*window\.campaign\s*\)\s*\{)/;

/**
 * Insert a generated <script> into the campaign HTML.
 *
 * The payload embeds page copy verbatim, so it can legitimately contain `$1`,
 * `$&`, `` $` ``, `$'` or `$$` — for example the copy "less than $2 a day".
 * Those sequences are special inside a String.prototype.replace REPLACEMENT
 * STRING, so the payload must always be supplied via a replacer FUNCTION.
 * Passing it as a template literal silently rewrites the payload and produces
 * an unparseable <script> ("SyntaxError: Invalid or unexpected token").
 */
export function injectPageOverride(output, pageOverride) {
	if (!pageOverride) {
		return output;
	}

	if (AFTER_CAMPAIGN_BOOTSTRAP.test(output)) {
		return output.replace(
			AFTER_CAMPAIGN_BOOTSTRAP,
			(match, bootstrapEnd, nextScript) =>
				`${bootstrapEnd}${pageOverride}${nextScript}`
		);
	}

	if (output.includes('<!-- _footer_integrations_ -->')) {
		return output.replace(
			'<!-- _footer_integrations_ -->',
			() => `${pageOverride}\n<!-- _footer_integrations_ -->`
		);
	}

	return output.replace('</body>', () => `${pageOverride}\n</body>`);
}

/**
 * Build the proxy that serves the campaign locally.
 *
 * `onHtml` receives the decoded upstream body and returns the HTML to send.
 *
 * NOTE: the response handler MUST be registered under `on: { proxyRes }`.
 * http-proxy-middleware v3 ignores the v2 `onProxyRes` option, and because
 * `selfHandleResponse` is still honoured nothing would ever write to the
 * response — every proxied request would hang until the client times out.
 */
export function createCampaignProxy({ target, secure, onHtml }) {
	return createProxyMiddleware({
		target,
		changeOrigin: true,
		secure,
		autoRewrite: true,
		cookieDomainRewrite: true,
		followRedirects: true,
		selfHandleResponse: true,
		on: {
			proxyRes: responseInterceptor(
				async (responseBuffer, proxyRes, req, res) =>
					onHtml(
						await decodeProxyResponseBuffer(responseBuffer, proxyRes),
						{ proxyRes, req, res }
					)
			),
		},
	});
}

function buildCssErrorComment(errorMessage) {
	return `/*\n${errorMessage}\n*/`;
}

function hasLastGoodCss(css) {
	return typeof css === 'string' && css.length > 0;
}

export function createStylesRouteHandler({
	campaignPath,
	baseStyles,
	token,
	processStylesFn = processStyles,
	fetchFn = fetch,
	logs = console,
	retryDelayMs = DEFAULT_TRANSPILE_RETRY_DELAY_MS,
	waitFn = sleep,
	transpilerUrl = process.env.SASS_TRANSPILER_URL?.trim() || DEFAULT_SASS_TRANSPILER_URL,
}) {
	let lastGoodCss = '';
	let nextStylesRequestId = 0;
	let lastAppliedStylesRequestId = 0;

	const transpileEndpoint = `${transpilerUrl.replace(/\/$/, '')}/transpile`;

	function sendFallback(res, errorText = '') {
		if (hasLastGoodCss(lastGoodCss)) {
			res.send(lastGoodCss);
			return;
		}

		if (errorText) {
			res.status(502).send(buildCssErrorComment(errorText));
			return;
		}

		res.sendStatus(502);
	}

	async function transpileStyles(fullStyles) {
		const response = await fetchFn(transpileEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/scss',
				Authorization: `Bearer ${token}`,
			},
			body: fullStyles,
		});
		const bodyText = await response.text();
		return { response, bodyText };
	}

	async function transpileStylesWithSingleRetry(fullStyles) {
		let firstError = null;
		let firstResult = null;

		try {
			firstResult = await transpileStyles(fullStyles);
		} catch (err) {
			firstError = err;
		}

		const shouldRetry =
			firstError !== null ||
			(firstResult !== null && firstResult.response.status >= 500);

		if (!shouldRetry) {
			if (firstResult !== null) {
				return firstResult;
			}
			throw new Error(
				'Unexpected transpile state: missing result and error before retry'
			);
		}

		await waitFn(retryDelayMs);

		try {
			return await transpileStyles(fullStyles);
		} catch (retryErr) {
			if (firstError) {
				logs.error(firstError);
			}
			throw retryErr;
		}
	}

	return async function stylesRouteHandler(req, res) {
		res.set('Content-Type', 'text/css');
		const stylesRequestId = ++nextStylesRequestId;

		let styles;
		try {
			styles = await processStylesFn({ campaign: campaignPath });
		} catch (err) {
			logs.error(err);
			sendFallback(res);
			return;
		}

		const fullStyles = baseStyles + styles;
		let transpileResult;
		try {
			transpileResult = await transpileStylesWithSingleRetry(fullStyles);
		} catch (err) {
			logs.error(err);
			sendFallback(res);
			return;
		}

		const { response, bodyText } = transpileResult;

		if (response.ok) {
			if (stylesRequestId >= lastAppliedStylesRequestId) {
				lastGoodCss = bodyText;
				lastAppliedStylesRequestId = stylesRequestId;
			}
			res.send(bodyText);
			return;
		}

		if (response.status >= 400 && response.status < 500) {
			if (response.status === 401) {
				logs.warn(
					'SASS transpiler returned 401; your token may be stale. Run `raisely login` if this keeps happening.'
				);
			}
			if (bodyText) {
				logs.error(bodyText);
			}
			sendFallback(res, bodyText);
			return;
		}

		if (bodyText) {
			logs.error(bodyText);
		}
		logs.error(
			`SASS transpiler failed after retry: ${response.status} ${response.statusText}`
		);
		sendFallback(res);
	};
}

export default async function start(options = {}) {
	const layout = detectLayout(process.cwd());
	if (shouldRefuseLayoutForCommand('local', layout)) {
		br();
		log(getLegacyLayoutRefusalMessage('local', layout), 'red');
		process.exitCode = 1;
		return;
	}

	welcome();
	const port = options.port || DEFAULT_PORT;

	// load config
	const config = await loadConfig();

	// Load token, which will prompt a login if the token is expired
	config.token = await getToken(program, config, true);

	await informUpdate();

	let campaignPath;
	let campaignUuid;

	if (options.uuid) {
		const loader = ora(`Loading campaign ${options.uuid}...`).start();
		try {
			const { data: campaign } = await getCampaign({ uuid: options.uuid });
			loader.succeed(`Using campaign: ${campaign.name} (${campaign.path})`);
			campaignPath = campaign.path;
			campaignUuid = campaign.uuid;
		} catch (e) {
			return error(e, loader);
		}
	} else {
		// in-memory state object
		const data = {};

		// load the campaigns
		const campaignsLoader = ora('Loading your campaigns...').start();
		try {
			data.campaigns = await getCampaigns();
			campaignsLoader.succeed();
		} catch (e) {
			return error(e, campaignsLoader);
		}

		// select the campaigns to sync
		const campaign = await inquirer.prompt([
			{
				type: 'list',
				name: 'path',
				message: 'Select the campaign to open:',
				choices: data.campaigns.data.map((c) => ({
					name: `${c.name} (${c.path})`,
					value: c.path,
					short: c.path,
				})),
			},
		]);
		campaignPath = campaign.path;
		campaignUuid = data.campaigns.data.find(
			(c) => c.path === campaign.path
		).uuid;
	}

	// fetch base styles from the API
	const base = await getBaseStyles({
		uuid: campaignUuid,
	});

	// determine proxy target
	const target = config.proxyUrl
		? config.proxyUrl.replace('https://', `https://${campaignPath}.`)
		: `https://${campaignPath}.raisely.com`;

	const app = express();

	app.use('/reload', async (req, res) => {
		const hash = await hashElement('.', {
			files: {
				include: ['**/*.js', '**/*.scss', '**/*.json'],
			},
			folders: {
				exclude: ['.*', 'node_modules', 'src', '.git', 'bin'],
			},
		});
		res.send({ hash: hash.hash });
	});

	// locally compile css files
	app.use(
		`/v3/campaigns/${campaignUuid}/styles.css`,
		createStylesRouteHandler({
			campaignPath,
			baseStyles: base,
			token: config.token,
		})
	);

	// locally compile components
	app.use(`/v3/campaigns/${campaignUuid}/components.js`, async (req, res) => {
		res.set('Content-Type', 'application/javascript');
		try {
			const compiled = await compileComponents();
			res.send(compiled);
		} catch (e) {
			console.error(e);
			res.sendStatus(500);
		}
	});

	// set up the Raisely proxy
	app.use(
		'/',
		createCampaignProxy({
			target,
			secure: !config.proxyUrl,
			onHtml: async (response) => {
				let pageOverride = '';
				if (response.includes('window.pageSchemas')) {
					try {
						const compiledMap = await compileAllLocalPages({
							campaignUuid,
						});
						pageOverride = buildPageOverrideScript(compiledMap);
					} catch (e) {
						console.error(e);
					}
				}

				// Match by path so it works regardless of whether the upstream
				// embeds api.raisely.com, api.raisely.test:2999, or any other host.
				const stylesPath = `/v3/campaigns/${campaignUuid}/styles.css`;
				const componentsPath = `/v3/campaigns/${campaignUuid}/components.js`;
				const localBase = `http://localhost:${port}`;
				const upstreamUrlRe = (path) =>
					new RegExp(
						`https?://[^"'\\s)]+${path.replace(/[/.]/g, '\\$&')}`,
						'g'
					);

				let output = response
					.replace(upstreamUrlRe(stylesPath), `${localBase}${stylesPath}`)
					.replace(
						upstreamUrlRe(componentsPath),
						`${localBase}${componentsPath}`
					);

				output = injectPageOverride(output, pageOverride);

				const apiRedirectScript = buildApiRedirectScript(config.apiUrl);
				if (apiRedirectScript) {
					output = output.replace(
						/<head([^>]*)>/i,
						(match, attrs) => `<head${attrs}>${apiRedirectScript}`
					);
				}

				return output.replace(
					'</head>',
					() => `
									<script>
										const check = () => {
											fetch('/reload')
											.then(res => res.json())
											.then(data => {
												if (!window.versionHash) {
													window.versionHash = data.hash;
												} else if (window.versionHash !== data.hash) {
													clearInterval(raiselyReload)
													window.location.reload();
												}
											})
										}
										var raiselyReload = setInterval(check, 500);
									</script>
								</head>`
				);
			},
		})
	);

	app.listen(port);

	log(`Local development for ${target} has been set up in:`, 'white');
	br();
	console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
	br();
	if (config.apiUrl) {
		br();
		console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
		br();
	}
	if (options.open) {
		log(`Opening your development site now...`, 'white');
	} else {
		log(`Your development site:`, 'white');
	}
	log(`http://localhost:${port}`, 'white');
	br();
	log(`Use CTRL + C to stop`, 'white');

	if (options.open) {
		open(`http://localhost:${port}`, {
			background: true,
		});
	}
}

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import express from 'express';
import open from 'open';
import sass from 'node-sass';
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
import { getToken } from './actions/auth.js';
import { loadConfig } from './config.js';

// local development config
const PORT = 8015;

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

export default async function start(options = {}) {
	welcome();

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
	app.use(`/v3/campaigns/${campaignUuid}/styles.css`, async (req, res) => {
		res.set('Content-Type', 'text/css');

		try {
			// get the local styles to append
			const styles = await processStyles({
				campaign: campaignPath,
			});

			// run through SASS
			const compiled = sass.renderSync({
				data: base + styles,
				outputStyle: 'expanded',
			});

			res.send(compiled.css);
		} catch (e) {
			console.error(e);
			res.sendStatus(500);
		}
	});

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
		createProxyMiddleware({
			target,
			changeOrigin: true,
			secure: !config.proxyUrl,
			autoRewrite: true,
			cookieDomainRewrite: true,
			followRedirects: true,
			selfHandleResponse: true,
			onProxyRes: responseInterceptor(
				async (responseBuffer, proxyRes, req, res) => {
					const response = await decodeProxyResponseBuffer(
						responseBuffer,
						proxyRes
					);

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

					let output = response
						.replace(
							`${
								config.apiUrl || 'https://api.raisely.com'
							}/v3/campaigns/${campaignUuid}/styles.css`,
							`http://localhost:${PORT}/v3/campaigns/${campaignUuid}/styles.css`
						)
						.replace(
							`${
								config.apiUrl || 'https://api.raisely.com'
							}/v3/campaigns/${campaignUuid}/components.js`,
							`http://localhost:${PORT}/v3/campaigns/${campaignUuid}/components.js`
						);

					// window.pageSchemas is set in the first large <script> in <body>.
					// Inject after that </script> but before later bundles (and before the small
					// `if (window.campaign)` script). Edge strips <!-- _footer_integrations_ -->
					// before HTML is sent, and injecting before </body> runs too late (React
					// already read pageSchemas).
					if (pageOverride) {
						const afterCampaignBootstrap =
							/(<\/script>)(\s*<script>\s*if\s*\(\s*window\.campaign\s*\)\s*\{)/;
						if (afterCampaignBootstrap.test(output)) {
							output = output.replace(
								afterCampaignBootstrap,
								`$1${pageOverride}$2`
							);
						} else if (
							output.includes('<!-- _footer_integrations_ -->')
						) {
							output = output.replace(
								'<!-- _footer_integrations_ -->',
								`${pageOverride}\n<!-- _footer_integrations_ -->`
							);
						} else {
							output = output.replace(
								'</body>',
								`${pageOverride}\n</body>`
							);
						}
					}

					return output.replace(
						'</head>',
						`
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
				}
			),
		})
	);

	app.listen(PORT);

	log(`Local development for ${target} has been set up in:`, 'white');
	br();
	console.log(`    ${chalk.inverse(`${process.cwd()}`)}`);
	br();
	if (config.apiUrl) {
		br();
		console.log(`Using custom API: ${chalk.inverse(config.apiUrl)}`);
		br();
	}
	log(`Opening your development site now...`, 'white');
	log(`Use CTRL + C to stop`, 'white');

	open(`http://localhost:${PORT}`, {
		background: true,
	});
}

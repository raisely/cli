import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import inquirer from 'inquirer';
import express from 'express';
import open from 'open';
import sass from 'node-sass';
import { hashElement } from 'folder-hash';
import * as fzstd from 'fzstd';

import {
	createProxyMiddleware,
	responseInterceptor,
} from 'http-proxy-middleware';

import { welcome, log, br, error, informUpdate } from './helpers.js';

import { processStyles, getBaseStyles } from './actions/campaigns.js';
import { compileComponents } from './actions/components.js';
import { getCampaigns } from './actions/campaigns.js';
import { getToken } from './actions/auth.js';
import { loadConfig } from './config.js';

// local development config
const PORT = 8015;

export default async function start() {
	welcome();

	// load config
	const config = await loadConfig();

	// Load token, which will prompt a login if the token is expired
	config.token = await getToken(program, config, true);

	await informUpdate();

	// in-memory state object
	const data = {};

	// load the campaigns
	const campaignsLoader = ora('Loading your campaigns...').start();
	try {
		data.campaigns = await getCampaigns({}, config.token, {
			apiUrl: program.api,
			...config,
		});
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
	const campaignUuid = data.campaigns.data.find(
		(c) => c.path === campaign.path
	).uuid;

	// fetch base styles from the API
	const base = await getBaseStyles({
		uuid: campaignUuid,
	});

	// determine proxy target
	const target = config.proxyUrl
		? config.proxyUrl.replace('https://', `https://${campaign.path}.`)
		: `https://${campaign.path}.raiselysite.com`;

	const app = express();

	app.use('/reload', async (req, res) => {
		const hash = await hashElement('.', {
			files: {
				include: ['**/*.js', '**/*.scss'],
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
				campaign: campaign.path,
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
					// convert zstd compressed buffer to string
					const response = await new Promise((resolve, reject) => {
						// trans
						const decompressedChunks = [];
						const decompressStream = new fzstd.Decompress((chunk, isLast) => {
							// Add to list of decompressed chunks
							decompressedChunks.push(chunk);
							if (isLast) {
								resolve(Buffer.concat(decompressedChunks).toString('utf8'));
							}
						});
						try {
							decompressStream.push(responseBuffer);
							decompressStream.push(new Uint8Array(0), true); // Need to tell the stream that it's ended
						} catch (error) {
							reject(error)
						}
					});
					return response
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
						)
						.replace(
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

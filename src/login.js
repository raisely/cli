import { randomBytes, createHash } from 'crypto';
import express from 'express';
import open from 'open';

import { welcome, log, br, error, informUpdate } from './helpers.js';
import { loadConfig, defaults } from './config.js';
import {
	oauthRequestToken,
	saveCredentials,
	getOAuthClientId,
	getOAuthScopes,
} from './credentials.js';

const CALLBACK_PORTS = [8765, 8766, 8767];
const LOGIN_TIMEOUT_MS = 2 * 60 * 1000;

function shutdownOAuthServer(server) {
	if (!server) return;
	try {
		if (typeof server.closeAllConnections === 'function') {
			server.closeAllConnections();
		}
		server.close();
	} catch {
		// noop
	}
}

function base64url(buf) {
	return buf
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=/g, '');
}

/**
 * OAuth 2.0 Authorization Code + PKCE (loopback). Opens the browser, waits for the callback,
 * exchanges the code, and stores tokens in the OS keychain.
 * @returns {Promise<object>} Token response from `/v1/oauth/token`
 */
export async function runOAuthLogin() {
	const config = await loadConfig({ allowEmpty: true });
	const apiUrl = (config.apiUrl || defaults.apiUrl).replace(/\/$/, '');

	const code_verifier = base64url(randomBytes(32));
	const code_challenge = base64url(
		createHash('sha256').update(code_verifier).digest()
	);
	const state = base64url(randomBytes(32));

	let server;
	let redirect_uri;
	const app = express();

	const paramsBase = {
		response_type: 'code',
		client_id: getOAuthClientId(),
		scope: getOAuthScopes(),
		state,
		code_challenge,
		code_challenge_method: 'S256',
	};

	const loginPromise = new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			shutdownOAuthServer(server);
			reject(
				new Error(
					'Login timed out after 2 minutes. Run `raisely login` again.'
				)
			);
		}, LOGIN_TIMEOUT_MS);

		const finish = (err, data) => {
			clearTimeout(timer);
			shutdownOAuthServer(server);
			if (err) reject(err);
			else resolve(data);
		};

		app.get('/callback', async (req, res) => {
			res.set('Connection', 'close');
			const q = req.query;
			if (q.error) {
				res.status(400).send(
					`<!DOCTYPE html><html><body><p>${escapeHtml(
						String(q.error_description || q.error)
					)}</p></body></html>`
				);
				return finish(
					new Error(String(q.error_description || q.error || 'OAuth error'))
				);
			}
			if (q.state !== state) {
				res.status(400).send(
					'<!DOCTYPE html><html><body><p>Invalid state parameter</p></body></html>'
				);
				return finish(new Error('OAuth state mismatch'));
			}
			if (!q.code) {
				res.status(400).send(
					'<!DOCTYPE html><html><body><p>Missing authorization code</p></body></html>'
				);
				return finish(new Error('Missing authorization code'));
			}

			try {
				const data = await oauthRequestToken(apiUrl, {
					grant_type: 'authorization_code',
					client_id: getOAuthClientId(),
					code: q.code,
					code_verifier,
					redirect_uri,
				});

				await saveCredentials({
					apiUrl,
					organisation_uuid: data.organisation_uuid,
					access_token: data.access_token,
					refresh_token: data.refresh_token,
					expires_in: data.expires_in,
				});

				res.send(
					`<!DOCTYPE html><html><body><p>You're signed in. You can close this tab and return to the terminal.</p></body></html>`
				);
				finish(null, data);
			} catch (e) {
				res.status(500).send(
					`<!DOCTYPE html><html><body><p>Token exchange failed</p></body></html>`
				);
				finish(e);
			}
		});
	});

	for (const port of CALLBACK_PORTS) {
		redirect_uri = `http://127.0.0.1:${port}/callback`;

		try {
			await new Promise((resolve, reject) => {
				server = app.listen(port, '127.0.0.1', () => resolve());
				server.once('error', reject);
			});
			break;
		} catch {
			if (server) {
				try {
					server.close();
				} catch {
					// noop
				}
			}
			server = null;
			redirect_uri = null;
		}
	}

	if (!server || !redirect_uri) {
		throw new Error(
			`Could not bind to any of ports ${CALLBACK_PORTS.join(
				', '
			)}. Close other apps using those ports and try again.`
		);
	}

	const params = new URLSearchParams({
		...paramsBase,
		redirect_uri,
	});

	const authorizeUrl = `${apiUrl}/v1/oauth/authorize?${params.toString()}`;

	try {
		await open(authorizeUrl, { background: true });
	} catch {
		br();
		log('Open this URL in your browser to sign in:', 'yellow');
		log(authorizeUrl, 'white');
		br();
	}

	return loginPromise;
}

function escapeHtml(s) {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/'/g, '&#39;')
		.replace(/"/g, '&quot;');
}

export default async function loginAction() {
	welcome();
	br();
	log('Opening the browser to sign you in...', 'white');
	br();

	try {
		await runOAuthLogin();
		log('You are signed in. Credentials are stored in your OS keychain.', 'green');
		br();
		await informUpdate();
	} catch (e) {
		error(e);
		process.exitCode = 1;
	}
}

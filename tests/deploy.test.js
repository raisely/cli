import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	const fs = {
		existsSync: vi.fn(),
		readdirSync: vi.fn(),
		readFileSync: vi.fn(),
		statSync: vi.fn(),
	};

	const ora = vi.fn((label) => {
		const loader = {
			label,
			start: vi.fn(),
			succeed: vi.fn(),
			fail: vi.fn(),
			warn: vi.fn(),
		};
		loader.start.mockReturnValue(loader);
		return loader;
	});

	return {
		detectLayout: vi.fn(),
		shouldRefuseLayoutForCommand: vi.fn(),
		getLegacyLayoutRefusalMessage: vi.fn(),
		loadConfig: vi.fn(),
		getToken: vi.fn(),
		getCampaign: vi.fn(),
		uploadStyles: vi.fn(),
		updateComponentConfig: vi.fn(),
		updateComponentFile: vi.fn(),
		uploadPage: vi.fn(),
		validateCampaignSass: vi.fn(),
		validateComponent: vi.fn(),
		inquirerPrompt: vi.fn(),
		glob: vi.fn(),
		welcome: vi.fn(),
		log: vi.fn(),
		br: vi.fn(),
		informUpdate: vi.fn(),
		ora,
		fs,
	};
});

vi.mock('inquirer', () => ({
	default: {
		prompt: mocks.inquirerPrompt,
	},
}));

vi.mock('ora', () => ({
	default: mocks.ora,
}));

vi.mock('glob-promise', () => ({
	default: mocks.glob,
}));

vi.mock('fs', () => ({
	default: mocks.fs,
	...mocks.fs,
}));

vi.mock('../src/helpers.js', () => ({
	welcome: mocks.welcome,
	log: mocks.log,
	br: mocks.br,
	informUpdate: mocks.informUpdate,
}));

vi.mock('../src/actions/layout.js', () => ({
	detectLayout: mocks.detectLayout,
	shouldRefuseLayoutForCommand: mocks.shouldRefuseLayoutForCommand,
	getLegacyLayoutRefusalMessage: mocks.getLegacyLayoutRefusalMessage,
}));

vi.mock('../src/config.js', () => ({
	loadConfig: mocks.loadConfig,
}));

vi.mock('../src/actions/auth.js', () => ({
	getToken: mocks.getToken,
}));

vi.mock('../src/actions/campaigns.js', () => ({
	getCampaign: mocks.getCampaign,
	uploadStyles: mocks.uploadStyles,
}));

vi.mock('../src/actions/components.js', () => ({
	updateComponentConfig: mocks.updateComponentConfig,
	updateComponentFile: mocks.updateComponentFile,
}));

vi.mock('../src/actions/pages.js', () => ({
	uploadPage: mocks.uploadPage,
}));

vi.mock('../src/actions/validate.js', () => ({
	validateCampaignSass: mocks.validateCampaignSass,
	validateComponent: mocks.validateComponent,
}));

import deploy from '../src/deploy.js';

function createDirent(name) {
	return {
		name,
		isDirectory() {
			return true;
		},
	};
}

function setDefaultMocks() {
	mocks.detectLayout.mockReturnValue('v2');
	mocks.shouldRefuseLayoutForCommand.mockReturnValue(false);
	mocks.getLegacyLayoutRefusalMessage.mockReturnValue('layout message');
	mocks.loadConfig.mockResolvedValue({
		campaigns: ['campaign-uuid'],
		cli: true,
	});
	mocks.getToken.mockResolvedValue('token-123');
	mocks.getCampaign.mockResolvedValue({
		data: { uuid: 'campaign-uuid', path: 'my-campaign' },
	});
	mocks.uploadStyles.mockResolvedValue(undefined);
	mocks.updateComponentConfig.mockResolvedValue(undefined);
	mocks.updateComponentFile.mockResolvedValue(undefined);
	mocks.uploadPage.mockResolvedValue(undefined);
	mocks.validateCampaignSass.mockResolvedValue({ ok: true });
	mocks.validateComponent.mockResolvedValue({ ok: true });
	mocks.inquirerPrompt.mockResolvedValue({ confirm: true });
	mocks.glob.mockResolvedValue([]);
	mocks.informUpdate.mockResolvedValue(undefined);
	mocks.fs.existsSync.mockReturnValue(true);
	mocks.fs.readFileSync.mockReturnValue('');
	mocks.fs.readdirSync.mockImplementation((target, options) => {
		if (options && options.withFileTypes) return [];
		if (target === '/repo/components') return [];
		return [];
	});
	mocks.fs.statSync.mockReturnValue({ isDirectory: () => true });
}

describe('deploy command', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, 'cwd').mockReturnValue('/repo');
		process.exitCode = undefined;
		setDefaultMocks();
	});

	test('validation failure prints all errors and blocks uploads', async () => {
		mocks.fs.readdirSync.mockImplementation((target, options) => {
			if (options && options.withFileTypes) return [createDirent('hero')];
			if (target === '/repo/components') return [];
			return [];
		});
		mocks.validateCampaignSass.mockResolvedValue({
			ok: false,
			error: 'SassError: Expected "}"',
		});
		mocks.validateComponent.mockResolvedValue({
			ok: false,
			error: 'Unexpected token (4:9)',
		});

		await deploy({});

		expect(mocks.uploadStyles).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(mocks.log).toHaveBeenCalledWith(
			'Campaign my-campaign: SassError: Expected "}"',
			'red'
		);
		expect(mocks.log).toHaveBeenCalledWith(
			'Component hero: Unexpected token (4:9)',
			'red'
		);
	});

	test('--no-validate skips the gate and continues deploy', async () => {
		await deploy({ validate: false });

		expect(mocks.validateCampaignSass).not.toHaveBeenCalled();
		expect(mocks.validateComponent).not.toHaveBeenCalled();
		expect(mocks.uploadStyles).toHaveBeenCalledTimes(1);
	});

	test('network failure during validation blocks deploy with exit code 1', async () => {
		mocks.validateCampaignSass.mockResolvedValue({
			ok: false,
			error: 'socket hang up',
		});

		await deploy({});

		expect(mocks.uploadStyles).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(mocks.log).toHaveBeenCalledWith(
			'Campaign my-campaign: socket hang up',
			'red'
		);
	});

	test('campaign lookup failure fails validation gracefully', async () => {
		mocks.getCampaign.mockRejectedValue(new Error('gateway timeout'));

		await deploy({});

		expect(process.exitCode).toBe(1);
		expect(mocks.validateCampaignSass).not.toHaveBeenCalled();
		expect(mocks.uploadStyles).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith(
			'Campaign lookup failed: gateway timeout',
			'red'
		);
	});

	test('malformed validator result fails deploy gracefully', async () => {
		mocks.validateCampaignSass.mockResolvedValue(undefined);

		await deploy({});

		expect(mocks.uploadStyles).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
		expect(mocks.log).toHaveBeenCalledWith(
			'Campaign my-campaign: SASS validator returned an invalid response.',
			'red'
		);
	});

	test('cli=true still runs validation gate before uploads', async () => {
		await deploy({});

		expect(mocks.validateCampaignSass).toHaveBeenCalledTimes(1);
		expect(mocks.validateComponent).not.toHaveBeenCalled();
		expect(mocks.uploadStyles).toHaveBeenCalledTimes(1);
	});

	test('--force still runs validation and blocks on failure', async () => {
		mocks.loadConfig.mockResolvedValue({
			campaigns: ['campaign-uuid'],
			cli: false,
		});
		mocks.validateCampaignSass.mockResolvedValue({
			ok: false,
			error: 'SassError: invalid selector',
		});

		await deploy({ force: true });

		expect(mocks.validateCampaignSass).toHaveBeenCalledTimes(1);
		expect(mocks.uploadStyles).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	test('missing components directory does not crash deploy', async () => {
		mocks.fs.existsSync.mockImplementation(
			(target) => target !== '/repo/components'
		);

		await deploy({});

		expect(mocks.uploadStyles).toHaveBeenCalledTimes(1);
		expect(mocks.uploadPage).not.toHaveBeenCalled();
		expect(process.exitCode).toBeUndefined();
	});

	test('skips non-directory entries (e.g. .DS_Store) in the components directory', async () => {
		mocks.fs.readdirSync.mockImplementation((target, options) => {
			if (options && options.withFileTypes) return [];
			if (target === '/repo/components') return ['.DS_Store', 'hero'];
			return [];
		});
		mocks.fs.statSync.mockImplementation((target) => ({
			isDirectory: () => !String(target).endsWith('.DS_Store'),
		}));
		mocks.fs.readFileSync.mockImplementation((target) => {
			if (String(target).endsWith('hero.json')) return '{}';
			return '';
		});

		await deploy({});

		expect(mocks.fs.readFileSync).not.toHaveBeenCalledWith(
			expect.stringContaining('.DS_Store'),
			expect.anything()
		);
		expect(mocks.updateComponentConfig).toHaveBeenCalledTimes(1);
		expect(mocks.updateComponentFile).toHaveBeenCalledTimes(1);
		expect(process.exitCode).toBeUndefined();
	});

	test('skips pages without campaignUuid', async () => {
		mocks.fs.existsSync.mockImplementation(
			(target) => target !== '/repo/components'
		);
		mocks.glob.mockResolvedValue(['campaigns/other/pages/home.json']);
		mocks.fs.readFileSync.mockImplementation((target) => {
			if (String(target).endsWith('home.json')) {
				return JSON.stringify({ uuid: 'page-1', body: [] });
			}
			return '';
		});

		await deploy({});

		expect(mocks.uploadPage).not.toHaveBeenCalled();
	});

	test('skips pages whose campaignUuid is not configured', async () => {
		mocks.fs.existsSync.mockImplementation(
			(target) => target !== '/repo/components'
		);
		mocks.glob.mockResolvedValue(['campaigns/other/pages/home.json']);
		mocks.fs.readFileSync.mockImplementation((target) => {
			if (String(target).endsWith('home.json')) {
				return JSON.stringify({
					uuid: 'page-1',
					campaignUuid: 'some-other-campaign',
					body: [],
				});
			}
			return '';
		});

		await deploy({});

		expect(mocks.uploadPage).not.toHaveBeenCalled();
	});

	test('uploads pages whose campaignUuid is configured', async () => {
		mocks.fs.existsSync.mockImplementation(
			(target) => target !== '/repo/components'
		);
		mocks.glob.mockResolvedValue(['campaigns/my-campaign/pages/home.json']);
		mocks.fs.readFileSync.mockImplementation((target) => {
			if (String(target).endsWith('home.json')) {
				return JSON.stringify({
					uuid: 'page-1',
					campaignUuid: 'campaign-uuid',
					body: [],
				});
			}
			return '';
		});

		await deploy({});

		expect(mocks.uploadPage).toHaveBeenCalledTimes(1);
		expect(mocks.uploadPage).toHaveBeenCalledWith(
			expect.objectContaining({
				uuid: 'page-1',
				campaignUuid: 'campaign-uuid',
			})
		);
	});
});

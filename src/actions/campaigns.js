import glob from "glob-promise";
import path from "path";
import fs from "fs";
import api from "./api.js";

export async function getCampaigns() {
	return await api({
		path: "/campaigns",
		method: "GET",
	});
}

export async function getCampaign({ uuid }) {
	return await api({
		path: `/campaigns/${uuid}`,
		method: "GET",
	});
}

export async function getBaseStyles({ uuid }) {
	return await api({
		path: `/campaigns/${uuid}/base.css?asSass=1`,
		method: "GET",
	});
}

export async function fetchStyles({ campaign, filename, config }) {
	const stylesDir = path.join(process.cwd(), "stylesheets");
	const filePath = campaign || filename.split(path.sep)[0];

	const fullPath = path.join(stylesDir, filePath);
	const files = await glob(`${fullPath}/**/*.scss`);

	const configFiles = {};
	for (const file of files) {
		const fileName = file
			// `glob` above returns paths with forward slashes only,
			// so we need to replace potential Windows-style back slashes
			// before attempting to find and remove the full path.
			.replace(`${fullPath.replace(/\\/g, "/")}/`, "");

		// continue if this is the main stylesheet

		if (fileName === `${filePath}.scss`) continue;

		configFiles[fileName] = fs.readFileSync(file, "utf8");
	}

	return {
		filePath,
		configFiles,
		css: fs.readFileSync(
			path.join(stylesDir, filePath, `${filePath}.scss`),
			"utf8"
		),
	};
}

export async function processStyles({ campaign, config }) {
	const { configFiles, css } = await fetchStyles({ campaign, config });

	let output = css;

	for (const file of Object.keys(configFiles).sort()) {
		output += configFiles[file];
	}

	return output;
}

export async function uploadStyles(filename, config) {
	const { filePath, configFiles, css } = await fetchStyles({
		filename,
		config,
	});

	await updateStyles(
		{
			path: filePath,
			files: configFiles,
			css,
		},
		config
	);
}

export async function updateStyles({ path, files, css }, config) {
	const campaign = await api({
		path: `/campaigns/${path}?private=1`,
		method: "GET",
	});

	const data = Object.assign({}, campaign.data.config.css, {
		files,
		custom_css: css,
	});

	return await api({
		path: `/campaigns/${path}/config/css?private=1`,
		method: "PATCH",
	});
}

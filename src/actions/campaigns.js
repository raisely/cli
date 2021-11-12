import glob from "glob-promise";
import path from "path";
import fs from "fs";
import api from "./api";

export async function getCampaigns({ organisationId }, token, opts = {}) {
	return await api(
		{
			path: "/campaigns",
			method: "GET",
			auth: {
				bearer: token,
			},
		},
		opts.apiUrl
	);
}

export async function getCampaign({ uuid }, token, opts = {}) {
	return await api(
		{
			path: `/campaigns/${uuid}`,
			method: "GET",
			auth: {
				bearer: token,
			},
		},
		opts.apiUrl
	);
}

export async function buildStyles(filename, config) {
	const stylesDir = path.join(process.cwd(), "stylesheets");
	const filePath = filename.split(path.sep)[0];

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

	await updateStyles(
		{
			path: filePath,
			files: configFiles,
			css: fs.readFileSync(
				path.join(stylesDir, filePath, `${filePath}.scss`),
				"utf8"
			),
		},
		config
	);
}

export async function updateStyles({ path, files, css }, config) {
	const campaign = await api(
		{
			path: `/campaigns/${path}`,
			qs: { private: 1 },
			method: "GET",
			auth: {
				bearer: config.token,
			},
		},
		config.apiUrl
	);

	const data = Object.assign({}, campaign.data.config.css, {
		files,
		custom_css: css,
	});

	return await api(
		{
			path: `/campaigns/${path}/config/css`,
			qs: { private: 1 },
			method: "PATCH",
			json: {
				data,
			},
			auth: {
				bearer: config.token,
			},
		},
		config.apiUrl
	);
}

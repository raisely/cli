import chalk from "chalk";
import _ from "lodash";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

let updatePromise;
let latestVersion;

export function getPackageInfo() {
	const pkg = JSON.parse(
		fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
	);
	return {
		name: pkg.name,
		version: pkg.version,
	};
}

function checkUpdate() {
	const pkg = getPackageInfo();
	if (!updatePromise) {
		const url = `https://registry.npmjs.org/-/package/${pkg.name}/dist-tags`;
		updatePromise = fetch(url)
			.then((result) => result.json())
			.then((result) => {
				latestVersion = result.latest;
			})
			.catch((e) => {
				// noop
			});
	}
}

export function log(message, color) {
	console.log(chalk[color || "white"](message));
}

export function br() {
	return console.log("");
}

export function welcome() {
	const pkg = getPackageInfo();
	checkUpdate();
	log(
		`
******************************
Raisely CLI (${pkg.version})
******************************
        `,
		"magenta"
	);
}

export async function informUpdate() {
	const pkg = getPackageInfo();
	if (updatePromise) {
		await updatePromise;
		if (latestVersion > pkg.version) {
			log(
				`
A new version of the Raisely cli is available (${latestVersion}),
See changes at: https://github.com/raisely/cli/blob/master/CHANGELOG.md
To update, run:
		npm update @raisely/cli
`,

				"white"
			);
		}
	}
}

export function error(e, loader) {
	const message =
		_.get(e, "response.body.errors[0].message") || e.message || e;
	if (loader) {
		loader.fail(message);
	} else {
		console.log(`${chalk.bgRed("Error:")} ${chalk.red(message)}`);
	}
}

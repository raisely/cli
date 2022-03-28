import program from "commander";

import init from "./init.js";
import update from "./update.js";
import start from "./start.js";
import create from "./create.js";
import deploy from "./deploy.js";
import login from "./login.js";
import local from "./local.js";
import { getPackageInfo } from "./helpers.js";

export async function cli(args) {
	const pkg = getPackageInfo();
	program.version(pkg.version);

	init(program);
	update(program);
	start(program);
	create(program);
	deploy(program);
	login(program);
	local(program);

	program.parse(process.argv);
}

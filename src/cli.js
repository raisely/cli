import program from "commander";

import init from "./init";
import update from "./update";
import start from "./start";
import create from "./create";
import deploy from "./deploy";
import login from "./login";

import { version } from '../package.json';

export async function cli(args) {
	program.version(version);
	program.option("-a, --api <api>", "custom api url");

	init(program);
	update(program);
	start(program);
	create(program);
	deploy(program);
	login(program);

	program.parse(process.argv);
}

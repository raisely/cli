import api from "./api.js";
import Babel from "@babel/core";
import presetEnv from "@babel/preset-env";
import presetReact from "@babel/preset-react";
import classProps from "@babel/plugin-proposal-class-properties";
import path from "path";
import fs from "fs";

Babel.createConfigItem(presetEnv);
Babel.createConfigItem(presetReact);
Babel.createConfigItem(classProps);

async function getComponent(uuid, opts = {}) {
	return await api({
		path: `/components/${uuid}`,
		qs: { private: 1 },
		method: "GET",
		auth: {
			bearer: opts.token,
		},
	});
}

export async function createComponent({ name, apiUrl }, opts = {}) {
	// fetch the organisation ID
	const user = await api({
		path: "/users/me",
	});

	return await api({
		path: `/components?private=1`,
		method: "POST",
		json: {
			data: {
				name,
				organisationUuid: user.data.organisationUuid,
			},
		},
	});
}

export async function updateComponentConfig({ file, config }, opts = {}) {
	const component = await getComponent(config.uuid, opts);
	return await api({
		path: `/components/${config.uuid}?private=1`,
		method: "PATCH",
		json: {
			data: {
				latestSchema: {
					...component.data.latestSchema,
					data: {
						...component.data.latestSchema.data,
						editable: config.fields,
					},
				},
				latestVersion: component.data.latestVersion + 1,
			},
		},
	});
}

export async function updateComponentFile({ file, config }, opts = {}) {
	const component = await getComponent(config.uuid, opts);
	return await api({
		path: `/components/${config.uuid}?private=1`,
		method: "PATCH",
		json: {
			data: {
				latestHtml: file,
				latestSchema: {
					...component.data.latestSchema,
					data: {
						...component.data.latestSchema.data,
						editable: config.fields,
					},
				},
				latestVersion: component.data.latestVersion + 1,
			},
		},
	});
}

/**
 * Convert Raisely component definition to a String value (pre-compilation)
 * @param  {ComponentModel}  component           The component-like Object to compile
 * @param  {Boolean} [ensureRuntimeSafety=true] If specified, ensures runtime safety
 *   by opting for global closure
 * @return {String}
 */
function toRawJavaScript(component, ensureRuntimeSafety = true) {
	// generate raw javascript body without surroundinf IFFE
	const functionBody = `function() {
		const React = window.React;
		const RaiselyComponents = window.RaiselyComponents;
		const name = '${component.name}';
		const component = ${component.latestHtml};
		const html = component(RaiselyComponents, React);
		const schema = ${JSON.stringify(component.latestSchema)};
		window['CustomComponent' + name] = { html, name, schema };
		window.RaiselyPrivateComponents.push({ status: 'PRIVATE', html, name, latestSchema: schema });
	}`;

	if (!ensureRuntimeSafety) {
		// Wrap in simple IFFE (for editor errors)
		return `(${functionBody})();`;
	}

	// otherwise wrap in closure builder ref
	return `window.buildRaiselyComponent(${functionBody}, "${component.name}");`;
}

export async function compileComponents() {
	let output = `if (!window.RaiselyPrivateComponents) window.RaiselyPrivateComponents = [];`;
	const componentsDir = path.join(process.cwd(), "components");
	const components = [];
	for (const file of fs.readdirSync(componentsDir)) {
		const component = {
			name: file,
			latestHtml: fs.readFileSync(
				path.join(componentsDir, file, `${file}.js`),
				"utf8"
			),
			latestSchema: JSON.parse(
				fs.readFileSync(
					path.join(componentsDir, file, `${file}.json`),
					"utf8"
				)
			),
		};
		components.push(
			[
				"",
				`/** RaiselyComponent [${component.name}] **/`,
				toRawJavaScript(component),
				"",
			].join("\n")
		);
	}
	let converted = await Babel.transformAsync(components.join("\n"), {
		presets: [presetEnv, presetReact],
		plugins: [classProps],
	});
	output += converted.code;
	return output;
}

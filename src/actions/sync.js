import ora from 'ora';
import path from 'path';
import fs from 'fs';

import api from './api';
import { error } from '../helpers';

export async function syncStyles(config, workDir) {
    const directory = path.join(workDir, 'stylesheets')
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    const loader = ora('Downloading campaign stylesheets...').start();
    try {
        for (const uuid of config.campaigns) {
            const campaign = await api({
                path: `/campaigns/${uuid}?private=true`,
                auth: {
                    bearer: config.token
                }
            });

            fs.writeFileSync(path.join(directory, `${campaign.data.path}.scss`), campaign.data.config.css.custom_css);
        }
        loader.succeed();
    } catch (e) {
        return error(e, loader);
    }
}

export async function syncComponents(config, workDir, filter) {
    const directory = path.join(workDir, 'components')
    if (!fs.existsSync(directory)) {
        fs.mkdirSync(directory);
    }

    const loader = ora(filter ? `Downloading ${filter}...` : 'Downloading custom components...').start();
    try {
        const components = await api({
            path: `/components`,
            qs: {
                private: 1,
                limit: 100
            },
            auth: {
                bearer: config.token
            }
        });
        
        for (const component of components.data) {

            if (filter && component.name !== filter) continue;

            // make component directory
            const componentDir = path.join(directory, component.name);
            if (!fs.existsSync(componentDir)) {
                fs.mkdirSync(componentDir);
            }

            // save the files
            fs.writeFileSync(path.join(componentDir, `${component.name}.js`), component.latestHtml);
            fs.writeFileSync(
                path.join(componentDir, `${component.name}.json`), 
                JSON.stringify({
                    fields: component.latestSchema.data.editable,
                    uuid: component.uuid
                }, null, 4)
            );

        }

        loader.succeed();
    } catch (e) {
        return error(e, loader);
    }
}
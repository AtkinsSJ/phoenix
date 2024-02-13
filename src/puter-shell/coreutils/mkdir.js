/*
 * Copyright (C) 2024  Puter Technologies Inc.
 *
 * This file is part of Phoenix Shell.
 *
 * Phoenix Shell is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
import path from "path-browserify";
import { validate_string } from "./coreutil_lib/validate.js";
import { EMPTY } from "../../util/singleton.js";

// DRY: very similar to `cd`
export default {
    name: 'mkdir',
    args: {
        $: 'simple-parser',
        allowPositionals: true,
        options: {
            parents: {
                type: 'boolean',
                short: 'p'
            }
        }
    },
    decorators: { errors: EMPTY },
    execute: async ctx => {
        // ctx.params to access processed args
        // ctx.args to access raw args
        const { positionals, values } = ctx.locals;
        const { filesystem } = ctx.platform;

        let [ target ] = positionals;

        validate_string(target, { name: 'path' });

        if ( ! target.startsWith('/') ) {
            target = path.resolve(ctx.vars.pwd, target);
        }

        const result = await filesystem.mkdir(target);

        if ( result.$ === 'error' ) {
            throw new Error(result.message);
        }
    }
};

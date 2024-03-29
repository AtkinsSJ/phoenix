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
import path_ from "path-browserify";
import { signals } from '../../ansi-shell/signals.js';
import { Exit } from '../coreutils/coreutil_lib/exit.js';
import pty from 'node-pty';

function makeCommand(id, executablePath) {
    return {
        name: id,
        path: executablePath,
        async execute(ctx) {
            const child = pty.spawn(executablePath, ctx.locals.args, {
                name: 'xterm-color',
                rows: ctx.env.ROWS,
                cols: ctx.env.COLS,
                cwd: ctx.vars.pwd,
                env: ctx.env
            });
            child.onData(chunk => {
                ctx.externs.out.write(chunk);
            });

            const sigint_promise = new Promise((resolve, reject) => {
                ctx.externs.sig.on((signal) => {
                    if ( signal === signals.SIGINT ) {
                        child.kill('SIGINT'); // FIXME: Docs say this will throw when used on Windows
                        reject(new Exit(130));
                    }
                });
            });

            const exit_promise = new Promise((resolve, reject) => {
                child.onExit(({code, signal}) => {
                    ctx.externs.out.write(`Exited with code ${code || 0} and signal ${signal || 0}\n`);
                    if ( signal ) {
                        reject(new Exit(1));
                    } else if ( code ) {
                        reject(new Exit(code));
                    } else {
                        resolve({ done: true });
                    }
                });
            });

            // Repeatedly copy data from stdin to the child, while it's running.
            let data, done;
            const next_data = async () => {
                // FIXME: This waits for one more read() after we finish.
                ({ value: data, done } = await Promise.race([
                    exit_promise, sigint_promise, ctx.externs.in_.read(),
                ]));
                if ( data ) {
                    child.write(data);
                    if ( ! done ) setTimeout(next_data, 0);
                }
            }
            setTimeout(next_data, 0);

            return Promise.race([ exit_promise, sigint_promise ]);
        }
    };
}

async function findCommandsInPath(id, ctx, firstOnly) {
    const PATH = ctx.env['PATH'];
    if (!PATH)
        return;
    const pathDirectories = PATH.split(':');

    const results = [];

    for (const dir of pathDirectories) {
        const executablePath = path_.resolve(dir, id);
        let stat;
        try {
            stat = await ctx.platform.filesystem.stat(executablePath);
        } catch (e) {
            // Stat failed -> file does not exist
            continue;
        }
        // TODO: Detect if the file is executable, and ignore it if not.
        const command = makeCommand(id, executablePath);

        if ( firstOnly ) return command;
        results.push(command);
    }

    return results;
}

export class PathCommandProvider {
    async lookup (id, { ctx }) {
        return findCommandsInPath(id, ctx, true);
    }

    async lookupAll(id, { ctx }) {
        return findCommandsInPath(id, ctx, false);
    }
}

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
import { Context } from 'contextlink';
import { launchPuterShell } from './puter-shell/main.js';
import { NodeStdioPTT } from './pty/NodeStdioPTT.js';
import { CreateFilesystemProvider } from './platform/node/filesystem.js';
import { CreateEnvProvider } from './platform/node/env.js';

const ctx = new Context({
    ptt: new NodeStdioPTT(),
    config: {},
    platform: new Context({
        name: 'node',
        filesystem: CreateFilesystemProvider(),
        env: CreateEnvProvider(),
    }),
});

await launchPuterShell(ctx);

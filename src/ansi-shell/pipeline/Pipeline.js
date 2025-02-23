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
import { SyncLinesReader } from "../ioutil/SyncLinesReader.js";
import { TOKENS } from "../readline/readtoken.js";
import { ByteWriter } from "../ioutil/ByteWriter.js";
import { Coupler } from "./Coupler.js";
import { CommandStdinDecorator } from "./iowrappers.js";
import { Pipe } from "./Pipe.js";
import { MemReader } from "../ioutil/MemReader.js";
import { MemWriter } from "../ioutil/MemWriter.js";
import { MultiWriter } from "../ioutil/MultiWriter.js";
import { NullifyWriter } from "../ioutil/NullifyWriter.js";
import { ConcreteSyntaxError } from "../ConcreteSyntaxError.js";
import { SignalReader } from "../ioutil/SignalReader.js";
import { Exit } from "../../puter-shell/coreutils/coreutil_lib/exit.js";
import { resolveRelativePath } from '../../util/path.js';

class Token {
    static createFromAST (ctx, ast) {
        if ( ast.$ !== 'token' ) {
            throw new Error('expected token node');
        }

        console.log('ast has cst?',
            ast,
            ast.components?.[0]?.$cst
        )

        return new Token(ast);
    }
    constructor (ast) {
        this.ast = ast;
        this.$cst = ast.components?.[0]?.$cst;
    }
    maybeStaticallyResolve (ctx) {
        // If the only components are of type 'symbol' and 'string.segment'
        // then we can statically resolve the value of the token.

        console.log('checking viability of static resolve', this.ast)

        const isStatic = this.ast.components.every(c => {
            return c.$ === 'symbol' || c.$ === 'string.segment';
        });

        if ( ! isStatic ) return;

        console.log('doing static thing', this.ast)

        // TODO: Variables can also be statically resolved, I think...
        let value = '';
        for ( const component of this.ast.components ) {
            console.log('component', component);
            value += component.text;
        }

        return value;
    }

    async resolve (ctx) {
        let value = '';
        for ( const component of this.ast.components ) {
            if ( component.$ === 'string.segment' || component.$ === 'symbol' ) {
                value += component.text;
                continue;
            }
            if ( component.$ === 'pipeline' ) {
                const pipeline = await Pipeline.createFromAST(ctx, component);
                const memWriter = new MemWriter();
                const cmdCtx = { externs: { out: memWriter } }
                const subCtx = ctx.sub(cmdCtx);
                await pipeline.execute(subCtx);
                value += memWriter.getAsString().trimEnd();
                continue;
            }
        }
        // const name_subst = await PreparedCommand.createFromAST(this.ctx, command);
        // const memWriter = new MemWriter();
        // const cmdCtx = { externs: { out: memWriter } }
        // const ctx = this.ctx.sub(cmdCtx);
        // name_subst.setContext(ctx);
        // await name_subst.execute();
        // const cmd = memWriter.getAsString().trimEnd();
        return value;
    }
}

export class PreparedCommand {
    static async createFromAST (ctx, ast) {
        if ( ast.$ !== 'command' ) {
            throw new Error('expected command node');
        }

        ast = { ...ast };
        const command_token = Token.createFromAST(ctx, ast.tokens.shift());

        
        // TODO: check that node for command name is of a
        //       supported type - maybe use adapt pattern
        console.log('ast?', ast);
        const cmd = command_token.maybeStaticallyResolve(ctx);

        const { commands } = ctx.registries;
        const { commandProvider } = ctx.externs;

        const command = cmd
            ? await commandProvider.lookup(cmd, { ctx })
            : command_token;

        if ( command === undefined ) {
            console.log('command token?', command_token);
            throw new ConcreteSyntaxError(
                `no command: ${JSON.stringify(cmd)}`,
                command_token.$cst,
            );
            throw new Error('no command: ' + JSON.stringify(cmd));
        }

        // TODO: test this
        console.log('ast?', ast);
        const inputRedirect = ast.inputRedirects.length > 0 ? (() => {
            const token = Token.createFromAST(ctx, ast.inputRedirects[0]);
            return token.maybeStaticallyResolve(ctx) ?? token;
        })() : null;
        // TODO: test this
        const outputRedirects = ast.outputRedirects.map(rdirNode => {
            const token = Token.createFromAST(ctx, rdirNode);
            return token.maybeStaticallyResolve(ctx) ?? token;
        });

        return new PreparedCommand({
            command,
            args: ast.tokens.map(node => Token.createFromAST(ctx, node)),
            // args: ast.args.map(node => node.text),
            inputRedirect,
            outputRedirects,
        });
    }

    constructor ({ command, args, inputRedirect, outputRedirects }) {
        this.command = command;
        this.args = args;
        this.inputRedirect = inputRedirect;
        this.outputRedirects = outputRedirects;
    }

    setContext (ctx) {
        this.ctx = ctx;
    }

    async execute () {
        let { command, args } = this;

        // If we have an AST node of type `command` it means we
        // need to run that command to get the name of the
        // command to run.
        if ( command instanceof Token ) {
            const cmd = await command.resolve(this.ctx);
            console.log('RUNNING CMD?', cmd)
            const { commandProvider } = this.ctx.externs;
            command = await commandProvider.lookup(cmd, { ctx: this.ctx });
            if ( command === undefined ) {
                throw new Error('no command: ' + JSON.stringify(cmd));
            }
        }

        args = await Promise.all(args.map(async node => {
            if ( node instanceof Token ) {
                return await node.resolve(this.ctx);
            }

            return node.text;
        }));

        const { argparsers } = this.ctx.registries;
        const { decorators } = this.ctx.registries;

        let in_ = this.ctx.externs.in_;
        if ( this.inputRedirect ) {
            const { filesystem } = this.ctx.platform;
            const dest_path = this.inputRedirect instanceof Token
                ? await this.inputRedirect.resolve(this.ctx)
                : this.inputRedirect;
            const response = await filesystem.read(
                resolveRelativePath(this.ctx.vars, dest_path));
            in_ = new MemReader(response);
        }

        // simple naive implementation for now
        const sig = {
            listeners_: [],
            emit (signal) {
                for ( const listener of this.listeners_ ) {
                    listener(signal);
                }
            },
            on (listener) {
                this.listeners_.push(listener);
            }
        };

        in_ = new SignalReader({ delegate: in_, sig });

        if ( command.input?.syncLines ) {
            in_ = new SyncLinesReader({ delegate: in_ });
        }
        in_ = new CommandStdinDecorator(in_);

        let out = this.ctx.externs.out;
        const outputMemWriters = [];
        if ( this.outputRedirects.length > 0 ) {
            for ( let i=0 ; i < this.outputRedirects.length ; i++ ) {
                outputMemWriters.push(new MemWriter());
            }
            out = new NullifyWriter({ delegate: out });
            out = new MultiWriter({
                delegates: [...outputMemWriters, out],
            });
        }

        const ctx = this.ctx.sub({
            externs: {
                in_,
                out,
                sig,
            },
            cmdExecState: {
                valid: true
            },
            locals: {
                command,
                args
            }
        });

        if ( command.args ) {
            const argProcessorId = command.args.$;
            const argProcessor = argparsers[argProcessorId];
            const spec = { ...command.args };
            delete spec.$;
            argProcessor.process(ctx, spec);
        }

        if ( ! ctx.cmdExecState.valid ) {
            ctx.locals.exit = -1;
            ctx.externs.out.close();
            return;
        }

        let execute = command.execute.bind(command);
        if ( command.decorators ) {
            for ( const decoratorId in command.decorators ) {
                const params = command.decorators[decoratorId];
                const decorator = decorators[decoratorId];
                execute = decorator.decorate(execute, {
                    command, params, ctx
                });
            }
        }
        
        let exit_code = 0;
        try {
            await execute(ctx);
        } catch (e) {
            if ( e instanceof Exit ) {
                exit_code = e.code;
            } else if ( e.code ) {
                await ctx.externs.err.write(
                    '\x1B[31;1m' +
                    command.name + ': ' +
                    e.message + '\x1B[0m\n'
                );
            } else {
                await ctx.externs.err.write(
                    '\x1B[31;1m' +
                    command.name + ': ' +
                    e.toString() + '\x1B[0m\n'
                );
                ctx.locals.exit = -1;
            }
        }

        // ctx.externs.in?.close?.();
        // ctx.externs.out?.close?.();
        ctx.externs.out.close();

        // TODO: need write command from puter-shell before this can be done
        for ( let i=0 ; i < this.outputRedirects.length ; i++ ) {
            console.log('output redirect??', this.outputRedirects[i]);
            const { filesystem } = this.ctx.platform;
            const outputRedirect = this.outputRedirects[i];
            const dest_path = outputRedirect instanceof Token
                ? await outputRedirect.resolve(this.ctx)
                : outputRedirect;
            const path = resolveRelativePath(ctx.vars, dest_path);
            console.log('it should work?', {
                path,
                outputMemWriters,
            })
            // TODO: error handling here

            await filesystem.write(path, outputMemWriters[i].getAsBlob());
        }

        console.log('OUTPUT WRITERS', outputMemWriters);
    }
}

export class Pipeline {
    static async createFromAST (ctx, ast) {
        if ( ast.$ !== 'pipeline' ) {
            throw new Error('expected pipeline node');
        }

        const preparedCommands = [];

        for ( const cmdNode of ast.commands ) {
            const command = await PreparedCommand.createFromAST(ctx, cmdNode);
            preparedCommands.push(command);
        }

        return new Pipeline({ preparedCommands });
    }
    constructor ({ preparedCommands }) {
        this.preparedCommands = preparedCommands;
    }
    async execute (ctx) {
        const preparedCommands = this.preparedCommands;

        let nextIn = ctx.externs.in;
        let lastPipe = null;

        // TOOD: this will eventually defer piping of certain
        //       sub-pipelines to the Puter Shell.

        for ( let i=0 ; i < preparedCommands.length ; i++ ) {
            const command = preparedCommands[i];

            // if ( command.command.input?.syncLines ) {
            //     nextIn = new SyncLinesReader({ delegate: nextIn });
            // }

            const cmdCtx = { externs: { in_: nextIn } };

            const pipe = new Pipe();
            lastPipe = pipe;
            let cmdOut = pipe.in;
            cmdOut = new ByteWriter({ delegate: cmdOut });
            cmdCtx.externs.out = cmdOut;
            nextIn = pipe.out;

            // TODO: need to consider redirect from out to err
            cmdCtx.externs.err = ctx.externs.out;
            command.setContext(ctx.sub(cmdCtx));
        }


        const coupler = new Coupler(lastPipe.out, ctx.externs.out);

        const commandPromises = [];
        for ( let i = preparedCommands.length - 1 ; i >= 0 ; i-- ) {
            const command = preparedCommands[i];
            commandPromises.push(command.execute());
        }
        await Promise.all(commandPromises);
        console.log('PIPELINE DONE');

        await coupler.isDone;
    }
}
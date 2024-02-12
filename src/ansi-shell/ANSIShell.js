import { ConcreteSyntaxError } from "./ConcreteSyntaxError.js";
import { MultiWriter } from "./ioutil/MultiWriter.js";
import { Coupler } from "./pipeline/Coupler.js";
import { Pipe } from "./pipeline/Pipe.js";
import { Pipeline } from "./pipeline/Pipeline.js";

export class ANSIShell extends EventTarget {
    constructor (ctx) {
        super();

        this.ctx = ctx;
        this.variables_ = {};
        this.config = ctx.externs.config;

        this.debugFeatures = {};

        const self = this;
        this.variables = new Proxy(this.variables_, {
            get (target, k) {
                return Reflect.get(target, k);
            },
            set (target, k, v) {
                const oldval = target[k];
                const retval = Reflect.set(target, k, v);
                self.dispatchEvent(new CustomEvent('shell-var-change', {
                    key: k,
                    oldValue: oldval,
                    newValue: target[k],
                }))
                return retval;
            }
        })

        this.addEventListener('signal.window-resize', evt => {
            this.variables.size = evt.detail;
        })

        this.env = {};

        this.initializeReasonableDefaults();
    }

    export_ (k, v) {
        if ( typeof v === 'function' ) {
            Object.defineProperty(this.env, k, {
                enumerable: true,
                get: v
            })
            return;
        }
        this.env[k] = v;
    }

    initializeReasonableDefaults() {
        const home = '/' + this.config['puter.auth.username'];
        const user = this.config['puter.auth.username'];
        this.variables.pwd = home;
        this.variables.home = home;
        this.variables.user = user;

        // Computed values
        Object.defineProperty(this.env, 'PWD', {
            enumerable: true,
            get: () => this.variables.pwd,
            set: v => this.variables.pwd = v
        })
        Object.defineProperty(this.env, 'ROWS', {
            enumerable: true,
            get: () => this.variables.size?.rows ?? 0
        })
        Object.defineProperty(this.env, 'COLS', {
            enumerable: true,
            get: () => this.variables.size?.cols ?? 0
        })

        // Default values
        this.export_('HOME', () => this.variables.home);
        this.export_('USER', () => this.variables.user);
        this.export_('TERM', 'xterm-256color');
        this.export_('TERM_PROGRAM', 'puter-ansi');
        this.export_('PS1', '[\\u@puter.com \\w]\\$ ');
        // TODO: determine how localization will affect this
        this.export_('LANG', 'en_US.UTF-8');
        // TODO: add TERM_PROGRAM_VERSION
        // TODO: add OLDPWD
    }

    async doPromptIteration() {
        console.log('prompt iteration');
        const { readline } = this.ctx.externs;
        // DRY: created the same way in runPipeline
        const executionCtx = this.ctx.sub({
            vars: this.variables,
            env: this.env,
            locals: {
                pwd: this.variables.pwd,
            }
        });
        this.ctx.externs.echo.off();
        const input = await readline(
            this.expandPromptString(this.env.PS1),
            executionCtx,
        );
        this.ctx.externs.echo.on();

        if ( input.trim() === '' ) {
            this.ctx.externs.out.write('');
            return;
        }

        // Specially-processed inputs for debug features
        if ( input.startsWith('%%%') ) {
            this.ctx.externs.out.write('%%%: interpreting as debug instruction\n');
            const [prefix, flag, onOff] = input.split(' ');
            const isOn = onOff === 'on' ? true : false;
            this.ctx.externs.out.write(
                `%%%: Setting ${JSON.stringify(flag)} to ` +
                (isOn ? 'ON' : 'OFF') + '\n'
            )
            this.debugFeatures[flag] = isOn;
            return; // don't run as a pipeline
        }

        // TODO: catch here, but errors need to be more structured first
        try {
            await this.runPipeline(input);
        } catch (e) {
            if ( e instanceof ConcreteSyntaxError ) {
                const here = e.print_here(input);
                this.ctx.externs.out.write(here + '\n');
            }
            this.ctx.externs.out.write('error: ' + e.message + '\n');
            console.log(e);
            return;
        }
    }

    readtoken (str) {
        return this.ctx.externs.parser.parseLineForProcessing(str);
    }

    async runPipeline (cmdOrTokens) {
        const tokens = typeof cmdOrTokens === 'string'
            ? (() => {
                // TODO: move to doPromptIter with better error objects
                try {
                    return this.readtoken(cmdOrTokens)
                } catch (e) {
                    this.ctx.externs.out.write('error: ' +
                        e.message + '\n');
                    return;
                }
            })()
            : cmdOrTokens ;

        if ( tokens.length === 0 ) return;

        if ( tokens.length > 1 ) {
            // TODO: as exception instead, and more descriptive
            this.ctx.externs.out.write(
                "something went wrong...\n"
            );
            return;
        }

        let ast = tokens[0];

        // Left the code below here (commented) because I think it's
        // interesting; the AST now always has a pipeline at the top
        // level after recent changes to the parser.

        // // wrap an individual command in a pipeline
        // // TODO: should this be done here, or elsewhere?
        // if ( ast.$ === 'command' ) {
        //     ast = {
        //         $: 'pipeline',
        //         components: [ast]
        //     };
        // }
        
        if ( this.debugFeatures['show-ast'] ) {
            this.ctx.externs.out.write(
                JSON.stringify(tokens, undefined, '  ') + '\n'
            );
            return;
        }

        const executionCtx = this.ctx.sub({
            vars: this.variables,
            env: this.env,
            locals: {
                pwd: this.variables.pwd,
            }
        });
        
        const pipeline = await Pipeline.createFromAST(executionCtx, ast);
        
        await pipeline.execute(executionCtx);
    }

    expandPromptString (str) {
        str = str.replace('\\u', this.variables.user);
        str = str.replace('\\w', this.variables.pwd);
        str = str.replace('\\$', '$');
        return str;
    }

    async outputANSI (ctx) {
        await ctx.iterate(async item => {
            ctx.externs.out.write(item.name + '\n');
        });
    }
}

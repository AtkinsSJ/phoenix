const encoder = new TextEncoder();

const CHAR_LF = '\n'.charCodeAt(0);
const CHAR_CR = '\r'.charCodeAt(0);

export class BetterReader {
    constructor ({ delegate }) {
        this.delegate = delegate;
        this.chunks_ = [];
    }

    async read (opt_buffer) {
        if ( ! opt_buffer && this.chunks_.length === 0 ) {
            return await this.delegate.read();
        }

        const chunk = await this.getChunk_();

        if ( ! opt_buffer ) {
            return chunk;
        }

        this.chunks_.push(chunk);

        while ( this.getTotalBytesReady_() < opt_buffer.length ) {
            this.chunks_.push(await this.getChunk_())
        }

        let offset = 0;
        for (;;) {
            let item = this.chunks_.shift();
            if ( item === undefined ) {
                throw new Error('calculation is wrong')
            }
            if ( offset + item.length > opt_buffer.length ) {
                const diff = opt_buffer.length - offset;
                this.chunks_.unshift(item.subarray(diff));
                item = item.subarray(0, diff);
            }
            opt_buffer.set(item, offset);
            offset += item.length;

            if ( offset == opt_buffer.length ) break;
        }
    }

    async getChunk_() {
        if ( this.chunks_.length === 0 ) {
            const { value } = await this.delegate.read();
            return value;
        }

        const len = this.getTotalBytesReady_();
        const merged = new Uint8Array(len);
        let offset = 0;
        for ( const item of this.chunks_ ) {
            merged.set(item, offset);
            offset += item.length;
        }

        this.chunks_ = [];

        return merged;
    }

    getTotalBytesReady_ () {
        return this.chunks_.reduce((sum, chunk) => sum + chunk.length, 0);
    }
}

/**
 * PTT: pseudo-terminal target; called "slave" in POSIX
 */
export class PTT {
    constructor(pty) {
        this.readableStream = new ReadableStream({
            start: controller => {
                this.readController = controller;
            }
        });
        this.writableStream = new WritableStream({
            start: controller => {
                this.writeController = controller;
            },
            write: chunk => {
                if (typeof chunk === 'string') {
                    chunk = encoder.encode(chunk);
                }
                if ( pty.outputModeflags?.outputNLCR ) {
                    chunk = pty.LF_to_CRLF(chunk);
                }
                pty.readController.enqueue(chunk);
            }
        });
        this.out = this.writableStream.getWriter();
        this.in = this.readableStream.getReader();
    }
}

/**
 * PTY: pseudo-terminal
 * 
 * This implements the PTY device driver.
 */
export class PTY {
    constructor () {
        this.outputModeflags = {
            outputNLCR: true
        };
        this.readableStream = new ReadableStream({
            start: controller => {
                this.readController = controller;
            }
        });
        this.writableStream = new WritableStream({
            start: controller => {
                this.writeController = controller;
            },
            write: chunk => {
                if ( typeof chunk === 'string' ) {
                    chunk = encoder.encode(chunk);
                }
                for ( const target of this.targets ) {
                    target.readController.enqueue(chunk);
                }
            }
        });
        this.out = this.writableStream.getWriter();
        this.in = this.readableStream.getReader();
        this.targets = [];
    }

    getPTT () {
        const target = new PTT(this);
        this.targets.push(target);
        return target;
    }

    LF_to_CRLF (input) {
        let lfCount = 0;
        for (let i = 0; i < input.length; i++) {
            if (input[i] === 0x0A) {
                lfCount++;
            }
        }

        const output = new Uint8Array(input.length + lfCount);

        let outputIndex = 0;
        for (let i = 0; i < input.length; i++) {
            // If LF is encountered, insert CR (0x0D) before LF (0x0A)
            if (input[i] === 0x0A) {
                output[outputIndex++] = 0x0D;
            }
            output[outputIndex++] = input[i];
        }

        return output;
    }
}

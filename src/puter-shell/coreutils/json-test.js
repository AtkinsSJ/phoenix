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
import {
    ContextSwitchingPStratumImpl,
    FirstRecognizedPStratumImpl,
    ParserBuilder,
    ParserFactory,
    StrataParseFacade,
    StrataParser,
    StringPStratumImpl, TerminalPStratumImplType,
} from 'strataparse';

// TODO: get these values from a common place
// DRY: Copied from echo_escapes.js
const BS  = String.fromCharCode(8);
const FF  = String.fromCharCode(0x0C);

class TokenTypeParserImpl {
    static meta = {
        inputs: 'node',
        outputs: 'node'
    }
    constructor ({ value }) {
        this.value = value;
    }
    parse (lexer) {
        let { done, value } = lexer.next();
        if ( done ) return;
        if (value.$ !== this.value) return;
        return value;
    }
}

// DRY: Copied from the library WhitespaceParserImpl, except we include \n
class WhitespaceParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static data = {
        whitespaceCharCodes: ' \n\r\t'.split('')
            .map(chr => chr.charCodeAt(0))
    }
    parse (lexer) {
        const { whitespaceCharCodes } = this.constructor.data;

        let text = '';

        for ( ;; ) {
            const { done, value } = lexer.look();
            if ( done ) break;
            if ( ! whitespaceCharCodes.includes(value) ) break;
            text += String.fromCharCode(value);
            lexer.next();
        }

        if ( text.length === 0 ) return;
        return { $: 'whitespace', text };
    }
}

class NumberParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static data = {
        startDigit: /[1-9]/,
        digit: /[0-9]/,
    }
    parse (lexer) {
        const { startDigit, digit } = this.constructor.data;

        let { done, value } = lexer.look();
        if ( done ) return;

        let text = '';
        let char = String.fromCharCode(value);

        // Returns true if there is a next character
        const consume = () => {
            text += char;
            lexer.next();
            ({ done, value } = lexer.look());
            char = String.fromCharCode(value);

            return !done;
        };

        // Returns the number of consumed characters
        const consumeDigitSequence = () => {
            let consumed = 0;
            while (!done && digit.test(char)) {
                consumed++;
                consume();
            }
            return consumed;
        };

        // Sign
        if ( char === '-' ) {
            if ( !consume() ) return;
        }

        // Digits
        if (char === '0') {
            if ( !consume() ) return;
        } else if (startDigit.test(char)) {
            if (consumeDigitSequence() === 0) return;
        }

        // Decimal + digits
        if (char === '.') {
            if ( !consume() ) return;
            if (consumeDigitSequence() === 0) return;
        }

        // Exponent
        if (char === 'e' || char === 'E') {
            if ( !consume() ) return;

            if (char === '+' || char === '-') {
                if ( !consume() ) return;
            }
            if (consumeDigitSequence() === 0) return;
        }

        if ( text.length === 0 ) return;
        return { $: 'number', text };
    }
}

class StringParserImpl {
    static meta = {
        inputs: 'bytes',
        outputs: 'node'
    }
    static data = {
        escapes: {
            '"': '"',
            '\\': '\\',
            '/': '/',
            'b': BS,
            'f': FF,
            '\n': '\n',
            '\r': '\r',
            '\t': '\t',
        },
        hexDigit: /[0-9A-Fa-f]/,
    }
    parse (lexer) {
        const { escapes, hexDigit } = this.constructor.data;

        let { done, value } = lexer.look();
        if ( done ) return;

        let text = '';
        let char = String.fromCharCode(value);

        // Returns true if there is a next character
        const next = () => {
            lexer.next();
            ({ done, value } = lexer.look());
            char = String.fromCharCode(value);

            return !done;
        };

        // Opening "
        if (char === '"') {
            text += char;
            next();
        } else {
            return;
        }

        let insideString = true;
        while (insideString) {
            if (char === '"')
                break;

            // Escape sequences
            if (char === '\\') {
                if (!next()) return;
                const escape = escapes[char];
                if (escape) {
                    text += escape;
                    if (!next()) return;
                    continue;
                }

                if (char === 'u') {
                    if (!next()) return;

                    // Consume 4 hex digits, and decode as a unicode codepoint
                    let hexString = '';
                    while (!done && hexString.length < 4) {
                        if (hexDigit.test(char)) {
                            hexString += char;
                            if (!next()) return;
                            continue;
                        }
                        // Less than 4 hex digits read
                        return;
                    }
                    let codepoint = Number.parseInt(hexString, 16);
                    text += String.fromCodePoint(codepoint);
                    continue;
                }

                // Otherwise, it's an invalid escape sequence
                return;
            }

            // Anything else is valid string content
            text += char;
            if (!next()) return;
        }

        // Closing "
        if (char === '"') {
            text += char;
            next();
        } else {
            return;
        }

        if ( text.length === 0 ) return;
        return { $: 'string', text };
    }
}

class JsonPStratumImpl {
    static meta = {
        inputs: 'node',
        outputs: 'node',
    };

    constructor() {
    }

    next (api) {
        let value, done;
        do {
            ({value, done} = api.delegate.next());
            console.log(`Got ${JSON.stringify(value)}`);
        } while (!done);
        return { value: {hello: 'world'}, done: true };
    }
}

function parseJSON(input) {
    const parserFactory = new ParserFactory();

    const parserRegistry = StrataParseFacade.getDefaultParserRegistry();
    parserRegistry.register('whitespace', WhitespaceParserImpl);
    parserRegistry.register('token', TokenTypeParserImpl);

    const parserBuilder = new ParserBuilder({ parserFactory, parserRegistry });

    const sp = new StrataParser();
    sp.add(new StringPStratumImpl(input));
    // Break into tokens
    // sp.add(new FirstRecognizedPStratumImpl({
    //     parsers: [
    //         parserFactory.create(WhitespaceParserImpl),
    //         parserFactory.create(NumberParserImpl),
    //         parserFactory.create(StringParserImpl),
    //         parserBuilder.def(a => a.literal('{').assign({ $: 'open-brace' })),
    //         parserBuilder.def(a => a.literal('}').assign({ $: 'close-brace' })),
    //         parserBuilder.def(a => a.literal('[').assign({ $: 'open-bracket' })),
    //         parserBuilder.def(a => a.literal(']').assign({ $: 'close-bracket' })),
    //         parserBuilder.def(a => a.literal(':').assign({ $: 'colon' })),
    //         parserBuilder.def(a => a.literal(',').assign({ $: 'comma' })),
    //         parserBuilder.def(a => a.literal('true').assign({ $: 'true' })),
    //         parserBuilder.def(a => a.literal('false').assign({ $: 'false' })),
    //         parserBuilder.def(a => a.literal('null').assign({ $: 'null' })),
    //     ]
    // }));
    // Parse tokens
    sp.add(new ContextSwitchingPStratumImpl(({
        entry: 'element',
        contexts: {
            element: [
                parserFactory.create(WhitespaceParserImpl),
                {
                    parser: parserBuilder.def(a => a.none()),
                    transition: { to: 'value' },
                },
            ],
            elements: [
                parserBuilder.def(a => {
                    a.sequence(
                        // TODO: parse `element`
                        a.repeat(
                            a.sequence(
                                parserBuilder.def(a => a.literal(',').assign({ $: 'comma' })),
                                // TODO: parse `element`
                            )
                        )
                    )
                }),
            ],
            value: [
                {
                    parser: parserBuilder.def(a => a.literal('{').assign({ $: 'open-brace' })),
                    transition: { to: 'object' },
                },
                {
                    parser: parserBuilder.def(a => a.literal('[').assign({ $: 'open-bracket' })),
                    transition: { to: 'array' },
                },
                {
                    parser: parserFactory.create(NumberParserImpl),
                    transition: { pop: true },
                },
                {
                    parser: parserFactory.create(StringParserImpl),
                    transition: { pop: true },
                },
                {
                    parser: parserBuilder.def(a => a.literal('true').assign({ $: 'true' })),
                    transition: { pop: true },
                },
                {
                    parser: parserBuilder.def(a => a.literal('false').assign({ $: 'false' })),
                    transition: { pop: true },
                },
                {
                    parser: parserBuilder.def(a => a.literal('null').assign({ $: 'null' })),
                    transition: { pop: true },
                },
            ],
            object: [
                {
                    parser: parserBuilder.def(a => a.literal('}').assign({ $: 'close-brace' })),
                    transition: { pop: true },
                },
            ],
            array: [
                {
                    parser: parserBuilder.def(a => a.literal(']').assign({ $: 'close-bracket' })),
                    transition: { pop: true },
                },
            ],
        }
    })));
    // sp.add(new JsonPStratumImpl());

    const result = sp.parse();
    if (sp.error) {
        throw new Error(sp.error);
    }
    return result;
}

export default {
    name: 'json-test',
    usage: 'json-test INPUT',
    description: 'Test app that parses INPUT as json using Strata.',
    args: {
        $: 'simple-parser',
        allowPositionals: true
    },
    execute: async ctx => {
        const { in_, out, err } = ctx.externs;
        const { positionals, values } = ctx.locals;
        // const { filesystem } = ctx.platform;
        // const path = positionals.shift();
        // const fileContents = await filesystem.read(path);

        const input = positionals.shift();
        try {
            const json = parseJSON(input);
            await out.write(`${JSON.stringify(json, null, 2)}\n`);
        } catch(e) {
            await err.write(`Failed to parse JSON: ${e}\n`);
        }
    }
};

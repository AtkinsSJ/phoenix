// This function comprehends the readline input and returns something
// called a "readline input state" - this includes any information needed

import { readtoken, TOKENS } from "./readtoken";

// REMINDER: input state will be sent to readline first,
//   then readline will use the input state to determine
//   what component to ask for tab completion

// to perform autocomplete functions
export const readline_comprehend = (ctx) => {
    const { input, cursor } = ctx.params;

    // TODO: CST for input tokens might be a good idea
    // for now, tokens up to the current cursor position
    // will be considered.

    const relevantInput = input.slice(0, cursor);

    const endsWithWhitespace = (() => {
        const lastChar = relevantInput[relevantInput.length - 1];
        return lastChar === ' ' ||
            lastChar === '\t' ||
            lastChar === '\r' ||
            lastChar === '\n'
    })();

    let tokens = readtoken(relevantInput);
    let tokensStart = 0;

    // We now go backwards through the tokens, looking for:
    // - a redirect token immediately to the left
    // - a pipe token to the left

    if ( tokens.length === 0 ) return { $: 'empty' };

    // Remove tokens for previous commands
    for ( let i=tokens.length ; i >= 0 ; i-- ) {
        const token = tokens[i];
        const isCommandSeparator =
            token === TOKENS['|'] ||
            token === TOKENS[';'] ;
        if ( isCommandSeparator ) {
            tokens = tokens.slice(i + 1);
            break;
        }
    }

    // Check if current input is for a redirect operator
    const resultIfRedirectOperator = (() => {
        if ( tokens.length < 1 ) return;

        const lastToken = tokens[tokens.length - 1];
        if (
            lastToken === TOKENS['<'] ||
            lastToken === TOKENS['>']
        ) {
            return {
                $: 'redirect'
            };
        }

        if ( tokens.length < 2 ) return;
        if ( endsWithWhitespace ) return;

        const secondFromLastToken = tokens[tokens.length - 2];
        if (
            secondFromLastToken === TOKENS['<'] ||
            secondFromLastToken === TOKENS['>']
        ) {
            return {
                $: 'redirect',
                input: lastToken
            };
        }

    })();

    if ( resultIfRedirectOperator ) return resultIfRedirectOperator;

    if ( tokens.length === 0 ) {
        return { $: 'empty' };
    }

    // If the first token is not a command name, then
    // this input is not considered comprehensible
    if ( typeof tokens[0] !== 'string' ) {
        return {
            $: 'unrecognized'
        };
    }

    // DRY: command arguments are parsed by readline
    const argTokens = [];
    for ( let i=0 ; i < tokens.length ; i++ ) {
        if (
            tokens[i] === TOKENS['<'] ||
            tokens[i] === TOKENS['>']
        ) {
            // skip this token and the next one
            i++; continue;
        }

        argTokens.push(tokens[i]);
    }

    return {
        $: 'command',
        id: tokens[0],
        tokens: argTokens,
        endsWithWhitespace,
    };
};

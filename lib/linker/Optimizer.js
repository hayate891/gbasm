// Dependencies ---------------------------------------------------------------
// ----------------------------------------------------------------------------
var Token = require('../parser/Lexer').Token;


// Assembly Instruction Optimizer ---------------------------------------------
// ----------------------------------------------------------------------------
function Optimizer(instr) {

    var opCode = instr.raw[0];
    switch(opCode) {

        // ld a,[someLabel] -> ldh a,$XX
        case 0xFA:
            // Transform memory loads into high loads if argument is
            // in the range of 0xff00-0xffff
            if (instr.resolvedArg >= 0xff00 && instr.resolvedArg <= 0xffff) {
                instr.rewrite(
                    'ldh', 12, [0xF0],
                    new Token('NUMBER', instr.resolvedArg & 0xff),
                    true
                );
            }
            break;

        // ld [someLabel],a -> ldh $XX,a
        case 0xEA:
            // Transform memory loads into high loads if argument is
            // in the range of 0xff00-0xffff
            if (instr.resolvedArg >= 0xff00 && instr.resolvedArg <= 0xffff) {
                instr.rewrite(
                    'ldh', 12, [0xE0],
                    new Token('NUMBER', instr.resolvedArg & 0xff),
                    true
                );
            }
            break;

        // Extended instructions
        case 0xCB:
            break;
    }

}


// Exports --------------------------------------------------------------------
module.exports = Optimizer;

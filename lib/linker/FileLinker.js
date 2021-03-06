// Dependencies ---------------------------------------------------------------
// ----------------------------------------------------------------------------
var Instruction = require('../data/Instruction'),
    optimize = require('./Optimizer'),
    Expression = require('../parser/Expression'),
    Linker = require('./Linker'),
    Errors = require('../Errors');


// Source File Linking Logic --------------------------------------------------
// ----------------------------------------------------------------------------
var FileLinker = {

    // Static Methods ---------------------------------------------------------
    init: function(file) {

        // Recursively expand macros in all sections
        file.sections.forEach(FileLinker.expandMacros);

        // Resolve any outstanding sizes for data and variables
        if (file.unresolvedSizes.length) {

            file.unresolvedSizes.forEach(function(entry) {

                var size = Linker.resolveValue(
                    file,
                    entry.size,
                    entry.offset,
                    entry.index,
                    false,
                    []
                );

                entry.size = typeof size === 'string' ? size.length : size;

            });

            // Clear the list
            file.unresolvedSizes.length = 0;

        }

        // Now recalculate the offsets of all entries within all sections
        file.sections.forEach(function(section) {
            section.calculateOffsets();
        });

        // For relative jumps, we check if the target is a OFFSET and switch
        // it with the actual instruction it points to.
        // This is required to preserve relative jump target through code
        // optimization were instructions and thus their size and address might
        // be altered.
        if (file.relativeJumpTargets.length) {

            file.relativeJumpTargets.forEach(function(instr) {

                var target = findInstructionByOffset(file, instr.offset, instr.arg.value);
                if (!target) {
                    new Errors.AddressError(
                        file,
                        'Invalid jump offset, must point at the address of a valid instruction',
                        instr.index
                    );

                } else {
                    instr.arg = target;
                }

            });

            // Clear the list
            file.relativeJumpTargets.length = 0;

        }

    },

    link: function(file) {
        FileLinker.resolveInstructions(file);
        FileLinker.resolveDataBlocks(file);
    },

    expandMacros: function(section) {

        var expanded,
            depth = 0;

        do {

            expanded = false;

            for(var i = 0, l = section.entries.length; i < l; i++) {

                var entry = section.entries[i];
                if (entry instanceof Expression.Call) {

                    // Remove the macro entry
                    section.entries.splice(i, 1);
                    i--;

                    var macro = Linker.resolveMacro(entry, section.file, 0, []);
                    if (macro.isBuiltin) {
                        new Errors.ArgumentError(
                            section.file,
                            'Cannot expand built-in MACRO ' + macro.name,
                            entry.callee.index
                        );

                    } else if (macro.isExpression) {
                        new Errors.ArgumentError(
                            section.file,
                            'Cannot expand user defined expression MACRO ' + macro.name,
                            entry.callee.index
                        );

                    } else {
                        // Parse and expand the macro body into the current position in the file
                        expanded = true;
                        macro.callee.expand(
                            macro.name, section, i + 1, macro.args
                        );
                    }


                    // Break out when there are too many levels of recursion
                    if (depth > 32) {
                        new Errors.MacroError(
                            section.file,
                            'Maximum macro expansion depth reached (32 levels)',
                            entry.callee.index
                        );
                    }

                }

            }

            depth++;

        } while(expanded);

    },


    // Name Resolution --------------------------------------------------------
    resolveInstructions: function(file) {

        for(var i = 0, l = file.instructions.length; i < l; i++) {

            var instr = file.instructions[i];
            if (!instr.arg) {
                continue;
            }

            // Handle targets of relative jump instructions
            var value;
            if (instr.arg instanceof Instruction) {
                value = instr.arg.offset - instr.offset;

            // Resolve the value of the instructions argument
            } else {
                value = Linker.resolveValue(
                    file,
                    instr.arg,
                    instr.offset,
                    instr.arg.index,
                    instr.mnemonic === 'jr',
                    []
                );
            }

            // Check if we could resolve the value
            if (value === null) {
                new Errors.ReferenceError(
                    file,
                    '"' + instr.arg.value + '" could not be resolved',
                    instr.index
                );

            // Validate signed argument range
            } else if (instr.isSigned && (value < -127 || value > 128)) {

                if (instr.mnemonic === 'jr') {
                    new Errors.AddressError(
                        file,
                        'Invalid relative jump value of ' + value + ' bytes, must be -127 to 128 bytes',
                        instr.index
                    );

                } else {
                    new Errors.ArgumentError(
                        file,
                        'Invalid signed byte argument value of ' + value + ', must be between -127 and 128',
                        instr.index
                    );
                }

            } else if (instr.isBit && (value < 0 || value > 7)) {
                new Errors.ArgumentError(
                    file,
                    'Invalid bit index value of ' + value + ', must be between 0 and 7',
                    instr.index
                );

            } else if (instr.bits === 8 && (value < -127 || value > 255)) {
                new Errors.ArgumentError(
                    file,
                    'Invalid byte argument value of ' + value + ', must be between -128 and 255',
                    instr.index
                );

            } else if (instr.bits === 16 && (value < -32767 || value > 65535)) {
                if (instr.mnemonic === 'jp' || instr.mnemonic === 'call') {
                    new Errors.AddressError(
                        file,
                        'Invalid jump address value of ' + value + ', must be between 0 and 65535',
                        instr.index
                    );

                } else {
                    new Errors.ArgumentError(
                        file,
                        'Invalid word argument value of ' + value + ', must be between -32767 and 65535',
                        instr.index
                    );
                }

            // Convert signed values to twos complement
            } else if (value < 0) {
                if (instr.bits === 8) {

                    // Correct jump offsets for relative jumps
                    if (instr.mnemonic === 'jr') {
                        if (value < 0) {
                            value -= 2;
                        }
                    }

                    value = 256 - Math.abs(value);

                } else {
                    value = 65536 - Math.abs(value);
                }

            } else {

                // Correct jump offsets for relative jumps
                if (instr.mnemonic === 'jr') {
                    if (value > 0) {
                        value -= 2;
                    }
                }

            }

            // Replace arg with resolved value
            instr.resolvedArg = value;

        }

    },

    resolveDataBlocks: function(file) {

        file.dataBlocks.forEach(function(data) {

            for(var i = 0, l = data.values.length; i < l; i++) {

                var value = data.values[i];

                // Resolve the correct value
                var resolved = Linker.resolveValue(
                    file,
                    value,
                    value.offset,
                    value.index,
                    false,
                    []
                );

                // DS can also store strings by splitting them
                if (data.isFixedSize) {

                    // Only strings can be contained in fixed sized sections
                    if (typeof resolved !== 'string') {
                        new Errors.ArgumentError(
                            file,
                            'Only string values are allow for fixed sized data storage',
                            data.index
                        );

                    } else if (resolved.length > data.size) {
                        new Errors.ArgumentError(
                            file,
                            'String length of ' + resolved.length
                            + ' exceeds allocated storage size of ' + data.size + ' bytes',
                            data.index
                        );
                    }

                    // Pad strings with 0x00
                    value = new Array(data.size);
                    for(var e = 0; e < data.size; e++) {
                        if (e < resolved.length) {
                            value[e] = resolved.charCodeAt(e);

                        } else {
                            value[e] = 0;
                        }
                    }

                    data.resolvedValues = value;

                // Check bit width
                } else if (data.bits === 8 && (resolved < -127 || resolved > 255)) {
                    new Errors.ArgumentError(
                        file,
                        'Invalid byte argument value of ' + resolved
                        + ' for data storage, must be between -128 and 255',
                        data.index
                    );

                } else if (data.bits === 16 && (resolved < -32767 || resolved > 65535)) {
                    new Errors.ArgumentError(
                        file,
                        'Invalid word argument value of ' + resolved
                        + ' for data storage, must be between -32767 and 65535',
                        data.index
                    );

                // Convert signed values to twos complement
                } else if (resolved < 0) {
                    if (data.bits === 8) {
                        data.resolvedValues[i] = 256 - Math.abs(resolved);

                    } else {
                        data.resolvedValues[i] = 65536 - Math.abs(resolved);
                    }

                } else {
                    data.resolvedValues[i] = resolved;
                }

            }

        });

    },

    resolveLocalLabel: function(file, localLabel) {

        // Find the first global label which sits infront of the target localLabel
        var i, l, parent = null;
        for(i = 0, l = file.labels.length; i < l; i++) {

            var label = file.labels[i];
            if (!label.parent) {
                if (label.index > localLabel.index) {
                    break;

                } else {
                    parent = label;
                }
            }

        }

        if (parent) {

            // Now find the first children with the labels name
            for(i = 0, l = parent.children.length; i < l; i++) {
                if (parent.children[i].name === localLabel.value) {
                    return parent.children[i];
                }
            }

        }

        return null;

    },


    // Optimization -----------------------------------------------------------
    optimize: function(file, unsafe) {

        var optimized,
            droppedInstructions = 0;

        do {

            optimized = false;

            for(var i = 0, l = file.instructions.length; i < l; i++) {

                var affectedInstructions = optimize(
                    file.instructions[i],
                    unsafe,
                    i < l - 1 ? file.instructions[i + 1] : null,
                    i < l - 2 ? file.instructions[i + 2] : null,
                    i < l - 3 ? file.instructions[i + 3] : null
                );

                if (affectedInstructions > 0) {

                    optimized = true;

                    // If more than 1 instruction is affected remove
                    // the superfluous ones
                    if (affectedInstructions > 1) {

                        // Reduce total instruction count
                        l -= affectedInstructions - 1;

                        file.instructions.splice(
                            i + 1,
                            affectedInstructions - 1

                        ).forEach(function(instr) {
                            instr.remove();
                        });

                        droppedInstructions += affectedInstructions - 1;

                    }

                }

            }

        } while(optimized);

        // If we dropped any instructions recalculate the offsets of all
        // entries within all sections
        if (droppedInstructions > 0) {
            file.sections.forEach(function(section) {
                section.calculateOffsets();
            });
        }

    }

};


// Helpers --------------------------------------------------------------------
function findInstructionByOffset(file, address, offset) {

    // Correct for instruction size
    if (offset < 0) {
        offset -= 1;
    }

    var target = address + offset,
        min = 0,
        max = file.instructions.length;

    while(max >= min) {

        var mid = min + Math.round((max - min) * 0.5),
            instr = file.instructions[mid];

        if (instr.offset === target) {
            return instr;

        } else if (instr.offset < target) {
            min = mid + 1;

        } else if (instr.offset > target) {
            max = mid - 1;
        }

    }

    return null;

}


// Exports --------------------------------------------------------------------
module.exports = FileLinker;


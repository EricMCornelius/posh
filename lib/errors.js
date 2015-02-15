var util = require('util');

// Does what it says... constructs a custom error constructor
function ErrorConstructorConstructor(name) {
  function ErrorType(args) {
    Error.captureStackTrace(this, this.constructor);

    this.name = name;
    this.message = args.message;
  }

  util.inherits(ErrorType, Error);
  return ErrorType;
}

module.exports.CycleError = ErrorConstructorConstructor('CycleError');

module.exports.UnhandledError = ErrorConstructorConstructor('UnhandledNode');

module.exports.DuplicateIdError = ErrorConstructorConstructor('DuplicateId');

module.exports.DuplicateTargetError = ErrorConstructorConstructor('DuplicateTarget');

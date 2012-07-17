var util = require('util');

// Does what it says... constructs a custom error constructor
ErrorConstructorConstructor = function(name) {
  function ErrorType(args) {
    Error.captureStackTrace(this, this.constructor);

    this.name = name;
    this.message = args.message;
    this.cycle = args.cycle;
  };

  util.inherits(ErrorType, Error);
  return ErrorType;
};

CycleError = ErrorConstructorConstructor('CycleError');

UnhandledError = ErrorConstructorConstructor('UnhandledNode');

DuplicateIdError = ErrorConstructorConstructor('DuplicateId');

DuplicateTargetError = ErrorConstructorConstructor('DuplicateTarget');

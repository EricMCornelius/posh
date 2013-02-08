var util = require('./util');

require.public = function(args, module) {
  args.forEach(function(arg) {
    if (util.isFunction(arg))
      module.exports[arg.name] = arg;
    else {
      for (key in arg) 
        module.exports[key] = arg[key];
    }
  });
}
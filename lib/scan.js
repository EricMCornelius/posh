var vm = require('vm');
var glob = require('glob');
var fs = require('fs');
var async = require('async');
var path = require('path');
var clone = require('clone');

// context for vm execution
function Context(registry) {
  var ctx = {
    console: console,
    require: require,
    process: process,
    setTimeout: setTimeout,
    setInterval: setInterval,
    env: {},
  };

  // decorator for register call, which stores env at registration time 
  // and dispatches a copy of the node to the registry's register operation
  ctx.register = function(node) {
    node.env = ctx.env;
    registry.register(clone(node));
  }
  return ctx;
};

function execute(registry, scripts) {
  async.map(
    scripts,
    fs.readFile,
    function(err, contents) {
      if (err)
        throw err;

      async.forEach(
        contents,
        function(code, cb) {
          try {
            vm.runInNewContext(code, new Context(registry));
          } 
          catch (e) {
            return cb(e);
          } 
          cb();
        },
        function(err) {
          if (err)
            throw err;
        }
      )
    }
  );
}

function scan(registry, root, pattern) {
  registry = registry || [];
  root = root || __dirname;
  pattern = pattern || '**/.dep';

  async.waterfall([
    async.apply(glob.Glob, pattern, root),
    async.apply(execute, registry)
  ]);
}

module.exports.scan = scan;
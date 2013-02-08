var vm = require('vm');
var glob = require('glob');
var fs = require('fs');
var async = require('async');
var clone = require('clone');
var util = require('util');
var path = require('path');

require('./extensions/extensions');

// context for vm execution
function Context(registry, file) {
  var ctx = {
    console: console,
    require: require,
    process: process,
    module: module,
    setTimeout: setTimeout,
    setInterval: setInterval,
    env: {
      file: file,
      base: path.dirname(file)
    },
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

      // create pairs [filename, contents]
      var pairs = util.zip(scripts, contents);

      async.forEach(
        pairs,
        function(pair, cb) {
          try {
            // execute code inside new context object
            vm.runInNewContext(pair[1], new Context(registry, pair[0]));
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
  root = root || process.cwd;
  pattern = pattern || '**/*.dep';

  // lookup files matching the glob, resolve them to the root, and execute them
  async.waterfall([
    async.apply(glob.Glob, pattern, root),
    function(files, cb) { cb(null, files.map(async.apply(path.resolve,root))); },
    async.apply(execute, registry)
  ]);
}

module.exports.scan = scan;
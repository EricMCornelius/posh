require('node_extensions');

var vm = require('vm');
var glob = require('glob');
var fs = require('fs');
var async = require('async');
var util = require('util');
var path = require('path');
var colors = require('colors');

var clone = util.clone;
var exists = util.exists;

var default_env_name = 'defaults.dep';
var default_cache = {};

// global which is to parent environment before require calls
env = {};

// recurse up the directory hierarchy and find first default_env file (if any exist)
function get_defaults(from) {
  // dirname will trim a single directory level per recursion
  from = path.resolve(path.dirname(from));

  // if we've reached the root, return a null environment
  if (from.length < process.cwd().length)
    return {};

  // check the cached environment values for this path first
  var cached = default_cache[from];
  if (exists(cached))
    return clone(cached);

  // filename to check for in this directory
  var filename = path.join(from, default_env_name);
  if (fs.existsSync(filename)) {
    // set the env global variable to the parent environment before processing
    // this allows reference to inherited environment via global.env
    env = get_defaults(from);

    // process the defaults file and cache the result
    require(filename);
    default_cache[from] = env;
    return clone(env);
  }

  // recurse
  return get_defaults(from);
}

// context for vm execution
function Context(registry, file) {
  var ctx_env = get_defaults(file);
  ctx_env.file = file;
  ctx_env.base = path.dirname(file);

  var ctx = {
    console: console,
    require: require,
    process: process,
    module: module,
    setTimeout: setTimeout,
    setInterval: setInterval,
    env: ctx_env
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
            console.log('Processing'.cyan, pair[0].toString().yellow);
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
    function(files, cb) { cb(null, files.filter(
       function (file){ return path.basename(file) !== default_env_name; }).
       map(async.apply(path.resolve,root))); },
    async.apply(execute, registry)
  ]);
}

process.on('uncaughtException', function(err) {
  console.error(err.message.red);
});

module.exports.scan = scan;

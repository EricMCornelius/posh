require('node_extensions');

var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var colors = require('colors');

// disable colors if output is not going to terminal
if (!require('tty').isatty(process.stdout.fd))
  colors.mode = 'none';

var dgraph = require('../../dependency_graph');

var exists = util.exists;
var public = util.public;

function register(node, registry, cb) {
  if (node.language !== 'coffeescript')
    return cb();

  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'lib', 'test'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid coffeescript project type: ' + node.type);

  // resolve all paths to base
  var resolve_base = async.apply(path.resolve, node.base).only(1);

  node.srcdir = path.resolve(node.base, node.srcdir || node.env.srcdir || 'src');
  node.libdir = path.resolve(node.base, node.libdir || node.env.libdir || 'lib');
  node.bindir = path.resolve(node.base, node.bindir || node.env.bindir || 'bin');
  node.testdir = path.resolve(node.base, node.testdir || node.env.testdir || 'test');
  node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'install');

  node.generate = function(graph, cb) {
    processors['coffee'].generate(graph, this, cb);
  }

  node.compiler = node.compiler || node.env.compiler || 'coffee';
  node.compiler_flags = node.compiler_flags || node.env.compiler_flags || [];

  switch (node.type) {
    case 'test':
      node.targetdir = node.testdir
      break;
    case 'application':
      node.targetdir = node.bindir
      break;
    case 'lib':
      node.targetdir = node.libdir
      break;
    default:
  }

  node.sources = util.isArray(node.sources) ? node.sources :  
                 exists(node.sources) ? [node.sources] : [path.join(node.srcdir, '**/*.coffee')];

  async.parallel([
    async.apply(register['sources'], node),
  ], function(err) {
    cb(err);
  });
}

register.sources = function(node, cb) {
  var sources = node.sources.map(async.apply(path.resolve, node.base).only(1));
  async.map(
    sources,
    function(source, cb) { glob.Glob(source, {}, cb); },
    function(err, results) {
      node.sources = results.reduce(function(prev, curr) { return prev.concat(curr); }, []);
      cb();
    }
  );
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var directories = [node.bindir, node.libdir];

  var directory_cmds = directories.map(create_directory_command);
  var compile_cmds = node.sources.map(async.apply(create_compile_command, node));

  graph.generated.push({
    id: node.id + '.gen_dirs',
    cmds: directory_cmds,
    deps: [],
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.compile',
    cmds: compile_cmds,
    deps: [],
    base: node.base
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: node.deps.concat(node.id + '.compile'),
    base: node.base
  });

  if (exists(node.test) || node.type === 'test') {
    graph.generated.push({
      id: node.id + '.test',
      cmds: [create_test_command(node)],
      deps: [],
      base: node.base
    });
  }

  cb();
}

function create_compile_command(node, source) {
  var name = path.basename(source, '.coffee');
  var rel = path.dirname(path.relative(node.srcdir, source));

  var cmd = node.compiler;
  var flags = node.compiler_flags;

  var input = ['-c ', source];
  var output = ['-o ' + node.targetdir];
  var target = path.resolve(node.targetdir, name + '.js');

  if (node.type === 'test')
    node.test = target;

  var args = flags.concat(output).concat(input);
  return {
    sources: [source],
    target: target,
    cmd: cmd,
    args: args
  };
}

var create_directory_command = require('../common.js').create_directory_command;

function create_test_command(node) {
  var testfile = path.resolve(node.targetdir, node.test);
  return {
    cmd: 'node',
    args: ['--harmony', testfile],
    action: 'test'
  };
}

var exports = [register, generate, {name: 'coffee'}];
public(exports, module);

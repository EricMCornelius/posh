var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var colors = require('colors');

var dgraph = require('../../dependency_graph');

var utils = require('../../utils');
var exists = utils.exists;
var public = utils.public;
var isArray = utils.isArray;

var exec = require('child_process').exec;

function register(node, registry, cb) {
  if (node.language !== 'rust')
    return cb();

  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib', 'external', 'test'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid rust project type: ' + node.type);

  node.libs = node.libs || node.env.libs || [];
  node.libdirs = node.libdirs || node.env.libdirs || [];
  node.rpaths = node.rpaths || node.env.rpaths || node.libdirs;
  node.defines = node.defines || node.env.defines || [];

  node.libdirs = node.libdirs.map(async.apply(path.resolve, node.base).only(1));
  node.rpaths = node.rpaths.map(async.apply(path.resolve, node.base).only(1));

  if (node.type === 'external') {
    node.generate = function(graph, cb) {
      graph.generated.push({
        id: this.id + '.publish',
        cmds: [],
        deps: this.deps
      });

      graph.generated.push({
        id: this.id + '.link',
        cmds: [],
        deps: this.deps
      });

      graph.generated.push({
        id: this.id,
        deps: [this.id + '.publish', this.id + '.link'].concat(this.deps),
        cmds: []
      });
      cb();
    };
    return cb();
  }

  node.srcdir = path.resolve(node.base, node.srcdir || node.env.srcdir || 'src');
  node.objdir = path.resolve(node.base, node.objdir || node.env.objdir || 'obj');
  node.libdir = path.resolve(node.base, node.libdir || node.env.libdir || 'lib');
  node.bindir = path.resolve(node.base, node.bindir || node.env.bindir || 'bin');
  node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'dist');

  node.target = node.target || node.id;
  node.targetname = node.target;

  node.generate = function(graph, cb) {
    processors['rust'].generate(graph, this, cb);
  }

  node.compiler = node.compiler || node.env.compiler || 'rustc';
  node.linker = node.linker || node.env.linker || 'gcc';

  node.compiler_flags = node.compiler_flags || node.env.compiler_flags || [];
  node.linker_flags = node.linker_flags || node.env.linker_flags || [];

  switch (node.type) {
    case 'test':
    case 'application':
      node.target = path.resolve(node.bindir, node.target + '.tsk');
      break;
    case 'shared_lib':
      node.target = path.resolve(node.libdir, 'lib' + node.target + '.so');
      node.compiler_flags.push('-fPIC');
      node.linker_flags.push('-shared');
      break;
    case 'static_lib':
      node.target = path.resolve(node.libdir, 'lib' + node.target + '.a');
      node.linker = 'ar';
      node.linker_flags = ['rvs'];
      break;
    default:
  }

  node.sources = isArray(node.sources) ? node.sources :
                 exists(node.sources) ? [node.sources] : [path.join(node.srcdir, '**.rs')];

  node.commands = {};
  register['sources'](node, cb);
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

function dependent_info(g, node) {
  var libs = [];
  var libdirs = [];
  var rpaths = [];
  var sources = [];

  dgraph.recursive_visit(g, node, function(node) {
    if (node.language !== 'rust')
      return true;

    switch (node.type) {
      case 'static_lib':
        sources.push(node.target);
      case 'shared_lib':
        rpaths.push(node.libdir);
        libs.push(node.targetname);
        libdirs.push(node.libdir);
        break;
      case 'external':
        libs = libs.concat(node.libs);
        libdirs = libdirs.concat(node.libdirs);
        rpaths = rpaths.concat(node.rpaths);
        break;
      default:
    }
  });

  return {
    libs: libs,
    libdirs: libdirs,
    rpaths: rpaths,
    sources: sources
  };
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var directories = [node.objdir, node.bindir, node.libdir];
  var depinfo = dependent_info(graph, node);

  async.map(node.sources, async.apply(create_compile_command, depinfo, node),
    function(err, compile_cmds) {
      if (err) return cb(err);
      if (compile_cmds.length === 0) return cb(null);

      var directory_cmds = directories.map(create_directory_command);
      var link_cmds = [create_link_command(depinfo, node, compile_cmds)];

      graph.generated.push({
        id: node.id + '.gen_dirs',
        cmds: directory_cmds,
        deps: [],
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.compile',
        cmds: compile_cmds,
        deps: node.deps.map(function(dep) { return dep + '.publish'; }).concat([node.id + '.gen_dirs']),
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.link',
        cmds: link_cmds,
        deps: node.deps.map(function(dep) { return dep + '.link'; }).concat([node.id + '.compile']),
        base: node.base
      });

      graph.generated.push({
        id: node.id,
        cmds: [],
        deps: node.deps.concat(node.id + '.link'),
        base: node.base
      });

      if (node.type === 'test') {
        graph.generated.push({
          id: node.id + '.test',
          cmds: [create_test_command(node)],
          deps: [],
          base: node.base
        });
      }

      cb();
    }
  );
}

function create_compile_command(depinfo, node, source, cb) {
  var cmd = node.compiler;
  var defines = node.defines.map(function(def){return '-D' + def;});
  var flags = node.compiler_flags.concat(defines);

  var target = path.resolve(node.objdir, path.basename(source, path.extname(source)));
  var target = target + '.o';

  var input = ['-c', source];
  var output = ['-o', target];

  var args = input.concat(output);
  cb(null, {
    sources: node.sources,
    target: target,
    cmd: cmd,
    args: args,
    action: 'build'
  });
}

var create_directory_command = require('../common.js').create_directory_command;

function create_link_command(depinfo, node, compile_cmds) {
  var sources = compile_cmds.map(function(cmd) { return cmd.target; }).concat(depinfo.sources);
  var libdirs = node.libdirs.concat(depinfo.libdirs).map(function(dir) { return '-L' + dir; });
  var rpath_prefix = (node.linker === 'ld') ? '-rpath ' : '-Wl,-rpath,'
  var rpaths = node.rpaths.concat(depinfo.rpaths).map(function(dir) { return rpath_prefix + dir});
  var libs = node.libs.concat(depinfo.libs).map(function(lib) { return '-l' + lib; });

  var cmd = node.linker;

  var args = (node.type === 'static_lib') ?
    node.linker_flags.concat(node.target).concat(sources) :
    sources.concat(['-o', node.target]).concat(node.linker_flags).concat(libdirs).concat(libs).concat(rpaths);

  return {
    sources: sources,
    target: node.target,
    cmd: cmd,
    args: args,
    action: 'build'
  };
}

function create_test_command(node) {
  return {
    cmd: node.target,
    action: 'test'
  };
}

var exports = [register, generate, {name: 'rust'}];
public(exports, module);

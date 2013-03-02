var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var uuid = require('uuid');

var dgraph = require('../../dependency_graph');

var exists = util.exists;
var public = util.public;
var exec = require('child_process').exec;

function register(node, registry, cb) {
  var valid_languages = ['C++', 'c++', 'cplusplus', 'cpp'];
  if (valid_languages.indexOf(node.language) === -1)
    return cb();

  node.language = 'c++';
  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib', 'external'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid c++ project type: ' + node.type);

  node.includedirs = node.includedirs || node.env.includedirs || [];
  node.libs = node.libs || node.env.libs || [];
  node.libdirs = node.libdirs || node.env.libdirs || [];
  node.rpaths = node.rpaths || node.env.rpaths || node.libdirs;

  if (node.type === 'external') {
    node.generate = function(graph, cb) { cb(); };
    node.build = function(graph, cb) { cb(); };
    node.install = function(graph, cb) { cb(); };
    return cb();
  }

  node.generate = function(graph, cb) {
    processors['cplusplus'].generate(graph, this, cb);
  }

  node.target = node.target || node.id;
  node.targetname = node.target;
  node.headerdir = node.headerdir || node.env.headerdir || 'include';
  node.sourcedir = node.sourcedir || node.env.sourcedir || 'src';
  node.installdir = node.installdir || node.env.installdir || 'install';
  node.objectdir = node.objectdir || node.env.objectdir || 'obj';

  node.headerdir = path.resolve(node.env.base, node.headerdir);
  node.sourcedir = path.resolve(node.env.base, node.sourcedir);
  node.installdir = path.resolve(node.env.base, node.installdir);
  node.objectdir = path.resolve(node.env.base, node.objectdir);

  node.installdirs = node.installdirs || {};
  node.installdirs.bindir = path.resolve(node.installdir, node.installdirs.bindir || 'bin');
  node.installdirs.libdir = path.resolve(node.installdir, node.installdirs.libdir || 'lib');
  node.installdirs.includedir = path.resolve(node.installdir, node.installdirs.includedir || 'include');

  node.compiler = node.compiler || node.env.compiler || '';
  node.linker = node.linker || node.env.linker || node.compiler || '';

  node.includedirs.push(node.headerdir);

  node.compiler_flags = node.compiler_flags || node.env.compiler_flags || [];
  node.linker_flags = node.linker_flags || node.env.linker_flags || [];

  switch (node.type) {
    case 'application':
      node.target = path.resolve(node.installdirs.bindir, node.target + '.tsk');
      break;
    case 'shared_lib':
      node.target = path.resolve(node.installdirs.libdir, 'lib' + node.target + '.so');
      node.compiler_flags.push('-fPIC');
      node.linker_flags.push('-shared');
      break;
    case 'static_lib':
      node.target = path.resolve(node.installdirs.libdir, 'lib' + node.target + '.a');
      node.linker = 'ar';
      break;
    default:
  }

  node.sources = util.isArray(node.sources) ? node.sources :  
                 exists(node.sources) ? [node.sources] : [path.join(node.sourcedir, '**.{cpp,c,C,cxx}')];

  node.headers = util.isArray(node.headers) ? node.headers :
                  exists(node.headers) ? [node.headers] : [path.join(node.headerdir, '**.{hpp,h,H,hxx}')];

  node.commands = {};
 
  async.parallel([
    async.apply(register['sources'], node),
    async.apply(register['headers'], node)
  ], function(err) {
    cb(err);
  });
}

register.sources = function(node, cb) {
  var sources = node.sources.map(async.apply(path.resolve, node.env.base));
  async.map(
    sources,
    function(source, cb) { glob.Glob(source, {}, cb); },
    function(err, results) {
      if (results.length > 0 && results[0].length > 0)
        node.sources = results;
      else
        node.sources = [];
      cb();
    }
  );
}

register.headers = function(node, cb) {
  var headers = node.headers.map(async.apply(path.resolve, node.env.base));
  async.map(
    headers,
    function(include, cb) { glob.Glob(include, {}, cb); },
    function(err, results) {
      node.headers = results;
      cb();
    }
  );
}

function dependent_info(g, node) {
  var libs = [];
  var libdirs = [];
  var includedirs = [];
  var rpaths = [];
  var sources = [];

  dgraph.recursive_visit(g, node, function(node) {
    if (node.language !== 'c++')
      return true;

    if (exists(node.target))
      sources.push(node.target);

    switch (node.type) {
      case 'shared_lib':
        rpaths.push(node.installdirs.libdir);
      case 'static_lib':
        libs.push(node.targetname);
        libdirs.push(node.installdirs.libdir);
        includedirs.push(node.headerdir);
        break;
      case 'external':
        libs = libs.concat(node.libs);
        libdirs = libdirs.concat(node.libdirs);
        includedirs = includedirs.concat(node.includedirs);
        break
      default:
    }
  });

  return {
    libs: libs,
    libdirs: libdirs,
    rpaths: rpaths,
    includedirs: includedirs,
    sources: sources
  };
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var directories = [node.objectdir, node.installdirs.bindir, node.installdirs.libdir, node.installdirs.includedir];
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
        deps: []
      });

      graph.generated.push({
        id: node.id + '.compile',
        cmds: compile_cmds,
        deps: node.deps.map(function(dep) { return dep + '.publish'; }).concat([node.id + '.gen_dirs'])
      });

      graph.generated.push({
        id: node.id + '.link',
        cmds: link_cmds,
        deps: node.deps.map(function(dep) { return dep + '.link'; }).concat([node.id + '.compile'])
      });

      cb();
    }
  );
}

function parse_dependencies(compile_cmd, cb) {
  var cmd = compile_cmd.concat('-MM').join(' ');
  exec(cmd, function(err, stdout, stderr) {
    if (err) return cb(err);

    var deps = stdout.replace(/[\\\n]/g, '').split(/ +/g);
    deps.shift();
    cb(null, deps);
  });
}

function create_compile_command(depinfo, node, source, cb) {
  var cmd = node.compiler;
  var includes = node.includedirs.concat(depinfo.includedirs).map(function(dir){return '-I' + dir});
  var flags = node.compiler_flags;

  var target = path.resolve(node.objectdir, path.basename(source, path.extname(source)));
  var target = target + '.o';

  var input = ['-c', source];
  var output = ['-o', target];

  var cmd = [cmd].concat(flags).concat(includes).concat(input);

  parse_dependencies(cmd, function(err, deps) {
    if (err) return cb(err);

    var compile = cmd.concat(output).join(' ');

    cb(null, {
      sources: deps,
      target: target,
      cmd: compile
    });
  });
}

function create_directory_command(path) {
  return {
    sources: [],
    target: path,
    cmd: 'mkdir -p ' + path
  };
}

function create_link_command(depinfo, node, compile_cmds) {
  var sources = compile_cmds.map(function(cmd) { return cmd.target; }).concat(depinfo.sources);
  var libdirs = node.libdirs.concat(depinfo.libdirs).map(function(dir) { return '-L' + dir; });
  var rpaths = node.rpaths.concat(depinfo.rpaths).map(function(dir) { return '-Wl,-rpath,' + dir});
  var libs = node.libs.concat(depinfo.libs).map(function(lib) { return '-l' + lib; });
  var cmd = [node.linker].concat(node.linker_flags).concat(libdirs).concat(libs).concat(rpaths).concat(sources).concat(['-o', node.target]).join(' ');

  return {
    sources: sources,
    target: node.target,
    cmd: cmd
  };
}

var exports = [register, generate, {name: 'cplusplus'}];
public(exports, module);

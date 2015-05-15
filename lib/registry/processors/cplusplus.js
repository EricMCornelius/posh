var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var colors = require('colors');
var _ = require('lodash');

// disable colors if output is not going to terminal
if (!require('tty').isatty(process.stdout.fd))
  colors.mode = 'none';

var dgraph = require('../../dependency_graph');

var utils = require('../../utils');
var exists = utils.exists;
var public = utils.public;
var isArray = utils.isArray;

var exec = require('child_process').exec;

function resolve(resolver, path) {
  return resolver(path);
}

// returns pkg_config information for a given package
function pkg_config(pkg, cb) {
  console.log('Registering pkgconfig dependencies for:'.cyan, pkg.yellow);

  function empty(arg) {
    return arg.length > 0;
  }

  function eliminate(match, arg) {
    return arg.replace(match, '');
  }

  function tokenize(str) {
    return str.toString().split(/\s+/g).filter(empty);
  }

  var compiler_flags = [];
  var linker_flags = [];
  var includedirs = [];
  var libs = [];
  var libdirs = [];

  function get_compiler_flags(cb) {
    exec('pkg-config --cflags-only-other ' + pkg, function(err, stdout, stderr) {
      compiler_flags = tokenize(stdout);
      cb(err);
    });
  }

  function get_linker_flags(cb) {
    exec('pkg-config --libs-only-other ' + pkg, function(err, stdout, stderr) {
      linker_flags = tokenize(stdout);
      cb(err);
    });
  }

  function get_includedirs(cb) {
    exec('pkg-config --cflags-only-I ' + pkg, function(err, stdout, stderr) {
      includedirs = tokenize(stdout).map(async.apply(eliminate, /^\-I/g));
      cb(err);
    });
  }

  function get_libdirs(cb) {
    exec('pkg-config --libs-only-L ' + pkg, function(err, stdout, stderr) {
      libs = tokenize(stdout).map(async.apply(eliminate, /^\-L/g));
      cb(err);
    });
  }

  function get_libs(cb) {
    exec('pkg-config --libs-only-l ' + pkg, function(err, stdout, stderr) {
      libs = tokenize(stdout).map(async.apply(eliminate, /^\-l/g));
      cb(err);
    });
  }

  async.series([
    get_compiler_flags,
    get_linker_flags,
    get_includedirs,
    get_libdirs,
    get_libs
  ], function(err) {
    cb(err, {
      compiler_flags: compiler_flags,
      linker_flags: linker_flags,
      includedirs: includedirs,
      libdirs: libdirs,
      libs: libs
    });
  });
}

function register(node, registry, cb) {
  var valid_languages = ['C++', 'c++', 'cplusplus', 'cpp'];
  if (!valid_languages.some(function(elem) { return elem === node.language; }))
    return cb();

  node.language = 'c++';
  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib', 'header_only', 'external', 'cmake', 'make', 'pkgconfig', 'test'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid c++ project type: ' + node.type);

  node.includedirs = node.includedirs || node.env.includedirs || [];
  node.libs = node.libs || node.env.libs || [];
  node.libdirs = node.libdirs || node.env.libdirs || [];
  node.rpaths = node.rpaths || node.env.rpaths || node.libdirs;
  node.defines = node.defines || node.env.defines || [];

  var resolver = _.partial(resolve, _.partial(path.resolve, node.base));
  node.includedirs = node.includedirs.map(resolver);
  node.libdirs = node.libdirs.map(resolver);
  node.rpaths = node.rpaths.map(resolver);

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

  if (node.type === 'pkgconfig') {
    node.type = 'external';
    node.generate = function(graph, cb) { cb(); };

    pkg_config(node.id, function(err, config) {
      if (err) return cb(err);

      node.libs = node.libs.concat(config.libs);
      node.libdirs = node.libdirs.concat(config.libdirs);
      node.rpaths = node.libdirs;
      node.includedirs = node.includedirs.concat(config.includedirs);
      return cb();
    });
    return;
  }

  if (node.type === 'cmake' || node.type === 'make') {
    if (node.type === 'cmake') {
      node.generate = function(graph, cb) {
        processors['cmake'].generate(graph, this, cb);
      }
    }
    else if (node.type === 'make') {
      node.generate = function(graph, cb) {
        processors['make'].generate(graph, this, cb);
      }
    }

    node.type = 'external';
    node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'dist');
    node.libdirs = [path.resolve(node.installdir, 'lib')];
    node.rpaths = node.libdirs;
    node.includedirs = [path.resolve(node.installdir, 'include')];
    return cb();
  }

  node.incdir = path.resolve(node.base, node.incdir || node.env.incdir || 'include');
  node.srcdir = path.resolve(node.base, node.srcdir || node.env.srcdir || 'src');
  node.objdir = path.resolve(node.base, node.objdir || node.env.objdir || 'obj');
  node.libdir = path.resolve(node.base, node.libdir || node.env.libdir || 'lib');
  node.bindir = path.resolve(node.base, node.bindir || node.env.bindir || 'bin');
  node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'dist');

  node.includedirs.push(node.incdir);

  if (node.type === 'header_only') {
    node.generate = function(graph, cb) { cb(); };
    return cb();
  }

  node.target = node.target || node.id;
  node.targetname = node.target;

  node.generate = function(graph, cb) {
    processors['cplusplus'].generate(graph, this, cb);
  }

  node.compiler = node.compiler || node.env.compiler || 'g++';
  node.linker = node.linker || node.env.linker || node.compiler;

  node.compiler_flags = node.compiler_flags || node.env.compiler_flags || [];
  node.linker_flags = node.linker_flags || node.env.linker_flags || [];
  node.prelink_flags = node.prelink_flags || node.env.prelink_flags || [];
  node.postlink_flags = node.postlink_flags || node.env.postlink_flags || [];

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
                 exists(node.sources) ? [node.sources] : [path.join(node.srcdir, '**.{cpp,c,C,cxx}')];

  node.headers = isArray(node.headers) ? node.headers :
                  exists(node.headers) ? [node.headers] : [path.join(node.incdir, '**.{hpp,h,H,hxx}')];

  node.commands = {};

  async.parallel([
    async.apply(register['sources'], node),
    async.apply(register['headers'], node)
  ], function(err) {
    cb(err);
  });
}

register.sources = function(node, cb) {
  var resolver = _.partial(resolve, _.partial(path.resolve, node.base));
  var sources = node.sources.map(resolver);
  async.map(
    sources,
    function(source, cb) { glob.Glob(source, {}, cb); },
    function(err, results) {
      node.sources = results.reduce(function(prev, curr) { return prev.concat(curr); }, []);
      cb();
    }
  );
}

register.headers = function(node, cb) {
  var resolver = _.partial(resolve, _.partial(path.resolve, node.base));
  var headers = node.headers.map(resolver);
  async.map(
    headers,
    function(include, cb) { glob.Glob(include, {}, cb); },
    function(err, results) {
      node.headers = results;
      cb();
    }
  );
}

function make_dynamic_link_cmd(dirs, libs) {
  var parts = [];
  if (dirs) {
    var libpaths = [].concat(dirs).map(function(dir) { return '-L' + dir; }).join(' ');
    var rpaths = [].concat(dirs).map(function(dir) { return '-Wl,-rpath,' + dir; }).join(' ');
    parts.push(libpaths);
    parts.push(rpaths);
  }
  if (libs) {
    var libs = [].concat(libs).map(function(lib) { return '-l' + lib; }).join(' ');
    parts.push(libs);
  }
  return parts.join(' ');
}

function dependent_info(g, node) {
  var libs = [];
  var libdirs = [];
  var includedirs = [];
  var rpaths = [];
  var sources = [];
  var linkcmds = [];

  dgraph.recursive_visit(g, node, function(node) {
    if (node.language !== 'c++')
      return true;

    var prelink_flags = [].concat(node.prelink_flags).join(' ');
    var postlink_flags = [].concat(node.postlink_flags).join(' ');

    switch (node.type) {
      case 'static_lib':
        sources.push(node.target);
        includedirs.push(node.incdir);
        break;
      case 'shared_lib':
        rpaths.push(node.libdir);
        libs.push(node.targetname);
        libdirs.push(node.libdir);
        linkcmds.push([prelink_flags, make_dynamic_link_cmd(node.libdir, node.targetname), postlink_flags].join(' ').trim());
        includedirs.push(node.incdir);
        break;
      case 'application':
        includedirs.push(node.incdir);
        break;
      case 'external':
        libs = libs.concat(node.libs);
        libdirs = libdirs.concat(node.libdirs);
        rpaths = rpaths.concat(node.rpaths);
        linkcmds.push([prelink_flags, make_dynamic_link_cmd(libdirs, node.libs), postlink_flags].join(' ').trim());
      case 'header_only':
        includedirs = includedirs.concat(node.includedirs);
        break;
      default:
    }
  });

  return {
    libs: libs,
    libdirs: libdirs,
    rpaths: rpaths,
    includedirs: includedirs,
    sources: sources,
    linkcmds: linkcmds
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

var is_windows = process.platform.indexOf('win') !== -1;
function parse_dependencies(compile_cmd, cb) {
  var cmd = compile_cmd.concat(['-MM', '-MG']).join(' ');
  exec(cmd, function(err, stdout, stderr) {
    console.log('Generating C++ dependencies:'.cyan);
    if (err) {
      console.log(cmd.red);
      console.error(stderr.red);
      return cb(err);
    }
    console.log(cmd.green);

    var deps = is_windows ? stdout.replace(/[\\\r\n]/g, '').split(/ +/g)
                          : stdout.replace(/[\\\n]/g, '').split(/ +/g);
    deps.shift();
    cb(null, deps);
  });
}

function create_compile_command(depinfo, node, source, cb) {
  var cmd = node.compiler;
  var includes = node.includedirs.concat(depinfo.includedirs).map(function(dir){return '-I' + dir});
  var defines = node.defines.map(function(def){return '-D' + def;});
  var flags = node.compiler_flags.concat(defines);

  var target = path.resolve(node.objdir, path.basename(source, path.extname(source)));
  var target = target + '.o';

  var input = ['-c', source];
  var output = ['-o', target];

  var args = flags.concat(includes).concat(input);

  parse_dependencies([cmd].concat(args), function(err, deps) {
    if (err) return cb(err);

    args = args.concat(output);

    cb(null, {
      sources: deps,
      target: target,
      cmd: cmd,
      args: args,
      action: 'build'
    });
  });
}

var create_directory_command = require('../common.js').create_directory_command;

function create_link_command(depinfo, node, compile_cmds) {
  var sources = compile_cmds.map(function(cmd) { return cmd.target; }).concat(depinfo.sources);
  var link_cmds = make_dynamic_link_cmd(node.libdirs, node.libs) + ' ' + depinfo.linkcmds.join(' ');
  /*
  var libdirs = node.libdirs.concat(depinfo.libdirs).map(function(dir) { return '-L' + dir; });
  var rpath_prefix = (node.linker === 'ld') ? '-rpath ' : '-Wl,-rpath,'
  var rpaths = node.rpaths.concat(depinfo.rpaths).map(function(dir) { return rpath_prefix + dir});
  var libs = node.libs.concat(depinfo.libs).map(function(lib) { return '-l' + lib; });
  */

  var cmd = node.linker;

  var args = (node.type === 'static_lib') ?
    node.linker_flags.concat(node.target).concat(sources) :
    sources.concat(['-o', node.target]).concat(node.linker_flags).concat(link_cmds);

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

var exports = [register, generate, {name: 'cplusplus'}];
public(exports, module);

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
var exec = require('child_process').exec;

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
  if (valid_languages.indexOf(node.language) === -1)
    return cb();

  node.language = 'c++';
  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib', 'header_only', 'external', 'cmake', 'pkgconfig', 'test'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid c++ project type: ' + node.type);

  node.includedirs = node.includedirs || node.env.includedirs || [];
  node.libs = node.libs || node.env.libs || [];
  node.libdirs = node.libdirs || node.env.libdirs || [];
  node.rpaths = node.rpaths || node.env.rpaths || node.libdirs;
  node.defines = node.defines || node.env.defines || [];

  if (node.type === 'external') {
    node.generate = function(graph, cb) { cb(); };
    return cb();
  }

  if (node.type === 'pkgconfig') {
    node.type = 'external';
    node.generate = function(graph, cb) { cb(); };

    pkg_config(node.id, function(err, config) {
      if (err) return cb(err);
 
      node.libs = node.libs.concat(config.libs);
      node.libdirs = node.libdirs.concat(config.libdirs);
      node.includedirs = node.includedirs.concat(config.includedirs);
      return cb();
    });
    return;
  }

  if (node.type === 'cmake') {
    node.type = 'external';
    node.generate = function(graph, cb) { 
      processors['cmake'].generate(graph, this, cb);
    }
    node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'install');
    node.libdirs = path.resolve(node.installdir, 'lib');
    node.includedirs = path.resolve(node.installdir, 'include');
    return cb();
  }

  node.incdir = path.resolve(node.base, node.incdir || node.env.incdir || 'include');
  node.srcdir = path.resolve(node.base, node.srcdir || node.env.srcdir || 'src');
  node.objdir = path.resolve(node.base, node.objdir || node.env.objdir || 'obj');
  node.libdir = path.resolve(node.base, node.libdir || node.env.libdir || 'lib');
  node.bindir = path.resolve(node.base, node.bindir || node.env.bindir || 'bin');
  node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'install');

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

  node.sources = util.isArray(node.sources) ? node.sources :  
                 exists(node.sources) ? [node.sources] : [path.join(node.srcdir, '**.{cpp,c,C,cxx}')];

  node.headers = util.isArray(node.headers) ? node.headers :
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
  var sources = node.sources.map(async.apply(path.resolve, node.base));
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
  var headers = node.headers.map(async.apply(path.resolve, node.base));
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

    switch (node.type) {
      case 'shared_lib':
        rpaths.push(node.libdir);
      case 'static_lib':
        libs.push(node.targetname);
        libdirs.push(node.libdir);
        sources.push(node.target);
      case 'application':
        includedirs.push(node.incdir);
        break;
      case 'external':
        libs = libs.concat(node.libs);
        libdirs = libdirs.concat(node.libdirs);
        includedirs = includedirs.concat(node.includedirs);
        break
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

      graph.generated.push({
        id: node.id,
        cmds: [],
        deps: node.deps.concat(node.id + '.link')
      });

      if (node.type === 'test') {
        graph.generated.push({
          id: node.id + '.test',
          cmds: [create_test_command(node)],
          deps: []
        });
      }

      cb();
    }
  );
}

function parse_dependencies(compile_cmd, cb) {
  var cmd = compile_cmd.concat('-MM -MG').join(' ');
  exec(cmd, function(err, stdout, stderr) {
    console.log('Generating C++ dependencies:'.cyan);
    if (err) {
      console.log(cmd.red);
      console.error(stderr.red);
      return cb(err);
    }
    console.log(cmd.green);

    var deps = stdout.replace(/[\\\n]/g, '').split(/ +/g);
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

  var cmd = [cmd].concat(flags).concat(includes).concat(input);

  parse_dependencies(cmd, function(err, deps) {
    if (err) return cb(err);

    var compile = cmd.concat(output).join(' ');

    cb(null, {
      sources: deps,
      target: target,
      cmd: compile,
      action: 'build'
    });
  });
}

function create_directory_command(path) {
  return {
    sources: [],
    target: path,
    cmd: 'mkdir -p ' + path,
    action: 'build'
  };
}

function create_link_command(depinfo, node, compile_cmds) {
  var sources = compile_cmds.map(function(cmd) { return cmd.target; }).concat(depinfo.sources);
  var libdirs = node.libdirs.concat(depinfo.libdirs).map(function(dir) { return '-L' + dir; });
  var rpaths = node.rpaths.concat(depinfo.rpaths).map(function(dir) { return '-Wl,-rpath,' + dir});
  var libs = node.libs.concat(depinfo.libs).map(function(lib) { return '-l' + lib; });

  var cmd = (node.type === 'static_lib') ?
    [node.linker].concat(node.linker_flags).concat(node.target).concat(sources).join(' ') :
    [node.linker].concat(sources).concat(['-o', node.target]).concat(node.linker_flags).concat(libdirs).concat(libs).concat(rpaths).join(' ');

  return {
    sources: sources,
    target: node.target,
    cmd: cmd,
    action: 'build'
  };
}

function create_test_command(node) {
  return {
    cmd: node.target,
    action: 'test',
    cwd: node.base
  };
}

var exports = [register, generate, {name: 'cplusplus'}];
public(exports, module);

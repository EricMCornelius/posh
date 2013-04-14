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
  var valid_languages = ['D', 'd', 'dlang'];
  if (valid_languages.indexOf(node.language) === -1)
    return cb();

  node.language = 'd';
  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib', 'test', 'external'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid d project type: ' + node.type);

  node.importdirs = node.importdirs || node.env.importdirs || [];
  node.stringimportdirs = node.stringimportdirs || node.env.stringimportdirs || [];
  node.libs = node.libs || node.env.libs || [];
  node.libdirs = node.libdirs || node.env.libdirs || [];
  node.rpaths = node.rpaths || node.env.rpaths || node.libdirs;

  // resolve all paths to base
  var resolve_base = async.apply(path.resolve, node.base).only(1);
  node.importdirs = node.importdirs.map(resolve_base);
  node.stringimportdirs = node.stringimportdirs.map(resolve_base);
  node.libdirs = node.libdirs.map(resolve_base);
  node.rpaths = node.rpaths.map(resolve_base);

  node.version = node.version || node.env.version || 'Release';

  node.unittest = node.unittest || true;
  node.release = node.release || true;
  node.docs = node.docs || true;
  node.imports = node.imports || true;
  node.json = node.json || true;

  node.docdir = path.resolve(node.base, node.docdir || node.env.docdir || 'docs');
  node.importdir = path.resolve(node.base, node.importdir || node.env.importdir || 'import');
  node.srcdir = path.resolve(node.base, node.srcdir || node.env.srcdir || 'src');
  node.objdir = path.resolve(node.base, node.objdir || node.env.objdir || 'obj');
  node.libdir = path.resolve(node.base, node.libdir || node.env.libdir || 'lib');
  node.bindir = path.resolve(node.base, node.bindir || node.env.bindir || 'bin');
  node.installdir = path.resolve(node.base, node.installdir || node.env.installdir || 'install');

  if (node.type === 'external') {
    node.generate = function(graph, cb) { cb(); };
    return cb();
  }

  node.target = node.target || node.id;
  node.targetname = node.target;

  node.generate = function(graph, cb) {
    processors['dlang'].generate(graph, this, cb);
  }

  node.compiler = node.compiler || node.env.compiler || 'ldc2';
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
      if (node.compiler === 'ldc2')
        node.compiler_flags.push('-relocation-model=pic');
      else
        node.compiler_flags.push('-fPIC');
      node.linker_flags.push('-shared');
      break;
    case 'static_lib':
      node.target = path.resolve(node.libdir, 'lib' + node.target + '.a');
      node.linker_flags = ['-lib'];
      break;
    default:
  }

  node.sources = util.isArray(node.sources) ? node.sources :  
                 exists(node.sources) ? [node.sources] : [path.join(node.srcdir, '**/*.d')];

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

function dependent_info(g, node) {
  var libs = [];
  var libdirs = [];
  var importdirs = [];
      stringimportdirs = [];
  var rpaths = [];
  var sources = [];

  dgraph.recursive_visit(g, node, function(node) {
    if (node.language !== 'd')
      return true;

    switch (node.type) {
      case 'static_lib':
        sources.push(node.target);
      case 'shared_lib':
        rpaths.push(node.libdir);
        libs.push(node.targetname);
        libdirs.push(node.libdir);
      case 'application':
        importdirs.push(node.importdir);
        stringimportdirs.push(node.importdir);
        break;
      case 'external':
        libs = libs.concat(node.libs);
        libdirs = libdirs.concat(node.libdirs);
        rpaths = rpaths.concat(node.rpaths);
      case 'header_only':
        importdirs = importdirs.concat(node.importdirs);
        stringimportdirs = stringimportdirs.concat(node.stringimportdirs);
        break;
      default:
    }
  });

  return {
    libs: libs,
    libdirs: libdirs,
    rpaths: rpaths,
    importdirs: importdirs,
    stringimportdirs: stringimportdirs,
    sources: sources
  };
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var directories = [node.objdir, node.bindir, node.libdir];
  if (node.imports)
    directories.push(node.importdir);
  if (node.docs)
    directories.push(node.docdir);

  var depinfo = dependent_info(graph, node);

  var directory_cmds = directories.map(create_directory_command);
  var compile_cmds = node.sources.map(async.apply(create_compile_command, depinfo, node));
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

function create_compile_command(depinfo, node, source) {
  var name = path.basename(source, '.d');
  var rel = path.dirname(path.relative(node.srcdir, source));

  var cmd = node.compiler;
  var imports = node.importdirs.concat(depinfo.importdirs).map(function(dir){return '-I' + dir});
  var stringimports = node.stringimportdirs.concat(depinfo.stringimportdirs).map(function(dir){return '-J' + dir});
  var args = [];
  if (node.imports)
    args = args.concat(['-H', '-Hd' + path.resolve(node.importdir, rel)]);
  if (node.json)
    args = args.concat(['-X', '-Xf' + path.resolve(node.importdir, rel, name + '.json')]);
  if (node.docs)
    args = args.concat(['-D', '-Dd' + node.docdir]);
  if (node.version.length > 0 && node.compiler === 'ldc2')
    args = args.concat('-d-version', node.version);
  else if(node.version.length > 0 && node.compiler === 'dmd')
    args = args.concat('-version=' + node.version);
  var flags = node.compiler_flags;

  var target = path.resolve(node.objdir, rel, name + '.o');

  var input = ['-c', source];
  var output = ['-of' + target];

  var args = flags.concat(imports).concat(stringimports).concat(input).concat(args).concat(output);
  return {
    sources: [source],
    target: target,
    cmd: cmd,
    args: args
  };
}

function create_directory_command(path) {
  return {
    sources: [],
    target: path,
    cmd: 'mkdir',
    args: ['-p', path]
  };
}

function create_link_command(depinfo, node, compile_cmds) {
  var sources = compile_cmds.map(function(cmd) { return cmd.target; }).concat(depinfo.sources);
  var libdirs = node.libdirs.concat(depinfo.libdirs).map(function(dir) { return '-L-L' + dir; });
  //var rpaths = node.rpaths.concat(depinfo.rpaths).map(function(dir) { return '-L-rpath' + dir});
  var rpaths = [];
  var libs = node.libs.concat(depinfo.libs).map(function(lib) { return '-L-l' + lib; });

  var cmd = node.linker;
  var args = sources.concat(['-of' + node.target]).concat(node.linker_flags).concat(libdirs).concat(libs).concat(rpaths);

  return {
    sources: sources,
    target: node.target,
    cmd: cmd,
    args: args
  };
}

function create_test_command(node) {
  return {
    cmd: node.target,
    action: 'test'
  };
}

var exports = [register, generate, {name: 'dlang'}];
public(exports, module);

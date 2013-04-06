require('node_extensions');

var os = require('os');
var path = require('path');

function register(node, registry, cb) {
  node.builddir = path.resolve(node.base, node.builddir || node.env.builddir || 'build');
  cb();
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  node.defines = node.defines || {};
  if (node.installdir)
    node.defines.CMAKE_INSTALL_PREFIX = node.defines.CMAKE_INSTALL_PREFIX || node.installdir;

  var defines = Object.keys(node.defines).map(function(key) {
    return '-D' + key + '=' + node.defines[key];
  });
  
  var args = [node.base].concat(defines);

  graph.generated.push({
    id: node.id + '.gen_dir',
    cmds: [create_directory_command(node.builddir)],
    deps: node.deps,
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.cmake_gen',
    cmds: [{cmd: 'cmake', args: args, sources: ['CMakeLists.txt']}],
    deps: [node.id + '.gen_dir'],
    base: node.builddir
  });

  graph.generated.push({
    id: node.id + '.cmake_build',
    cmds: [{cmd: 'make', args: ['-j', os.cpus().length], sources: ['Makefile']}],
    deps: [node.id + '.cmake_gen'],
    base: node.builddir
  });

  graph.generated.push({
    id: node.id + '.publish',
    cmds: [{cmd: 'make', args: ['install'], sources: ['Makefile']}],
    deps: [node.id + '.cmake_build'],
    base: node.builddir
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: [node.id + '.cmake_install'],
    base: node.builddir
  });

  cb();
}

function create_directory_command(path) {
  return {
    sources: [],
    target: path,
    cmd: 'mkdir',
    args: ['-p', path],
  };
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'cmake';
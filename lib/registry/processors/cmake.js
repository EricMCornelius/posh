require('node_extensions');

var os = require('os');

function register(node, registry, cb) {
  cb();
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  graph.generated.push({
    id: node.id + '.cmake_gen',
    cmds: [{cmd: 'cmake -DCMAKE_INSTALL_PREFIX=' + node.installdir, sources: ['CMakeLists.txt']}],
    deps: node.deps,
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.cmake_build',
    cmds: [{cmd: 'gmake -j' + os.cpus().length, sources: ['Makefile']}],
    deps: [node.id + '.cmake_gen'],
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.publish',
    cmds: [{cmd: 'gmake install', sources: ['Makefile']}],
    deps: [node.id + '.cmake_build'],
    base: node.base
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: [node.id + '.cmake_install'],
    base: node.base
  });

  cb();
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'cmake';
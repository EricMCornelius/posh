require('node_extensions');

var os = require('os');

function register(node, registry, cb) {
  cb();
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var buildcmd = node.buildcmd || ('make -j' + os.cpus().length);
  graph.generated.push({
    id: node.id + '.make_build',
    cmds: [{cmd: buildcmd, sources: ['Makefile']}],
    deps: node.deps,
    base: node.base
  });

  var installcmd = node.installcmd || ('make install prefix=' + node.installdir);
  graph.generated.push({
    id: node.id + '.publish',
    cmds: [{cmd: installcmd, sources: ['Makefile']}],
    deps: [node.id + '.make_build'],
    base: node.base
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: [node.id + '.publish'],
    base: node.base
  });

  cb();
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'make';

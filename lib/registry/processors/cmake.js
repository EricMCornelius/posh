require('node_extensions');

var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');
var mkdirp = require('mkdirp');
var fs = require('fs');
var colors = require('colors');
var os = require('os');

function register(node, registry, cb) {
  cb();
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  graph.generated.push({
    id: node.id + '.cmake_gen',
    cmds: [{cmd: 'cmake -DCMAKE_INSTALL_PREFIX=' + node.installdir, cwd: node.base, action: 'update'}],
    deps: node.deps
  });

  graph.generated.push({
    id: node.id + '.cmake_build',
    cmds: [{cmd: 'gmake -j' + os.cpus(), cwd: node.base, action: 'update'}],
    deps: [node.id + '.cmake_gen']
  });

  graph.generated.push({
    id: node.id + '.cmake_install',
    cmds: [{cmd: 'gmake install', cwd: node.base, action: 'update'}],
    deps: [node.id + '.cmake_build']
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: [node.id + '.cmake_install']
  });

  cb();
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'cmake';
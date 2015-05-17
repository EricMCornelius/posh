var assert = require('assert');
var util = require('util');
var path = require('path');
var fs = require('fs');

var utils = require('../../utils');
var exists = utils.exists;

var os = require('os');

function register(node, registry, cb) {
  if (!exists(node.type) || node.type.toLowerCase() !== 'make') return cb();

  node.generate = function(graph, cb) {
    processors['make'].generate(graph, this, cb);
  }

  cb();
}

// prepare the command list corresponding to this node
function generate(graph, node, cb) {
  var buildcmd = node.buildcmd || 'make';
  var buildargs = ['-j', os.cpus().length];
  graph.generated.push({
    id: node.id + '.make_build',
    cmds: [{cmd: buildcmd, args: buildargs, sources: ['Makefile']}],
    deps: node.deps,
    base: node.base
  });

  var installcmd = node.installcmd || 'make';
  var installargs = ['install', 'prefix=' + node.installdir];
  graph.generated.push({
    id: node.id + '.make_install',
    cmds: [{cmd: installcmd, args: installargs, sources: ['Makefile']}],
    deps: [node.id + '.make_build'],
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.publish',
    cmds: [],
    deps: [node.id + '.make_install']
  });

  graph.generated.push({
    id: node.id + '.link',
    cmds: [],
    deps: [node.id + '.make_install']
  });

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: [node.id + '.publish', node.id + '.link']
  });

  cb();
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'make';

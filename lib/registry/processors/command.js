require('node_extensions');

var util = require('util');
var path = require('path');
var assert = require('assert');

var exists = util.exists;
var public = util.public;
var isArray = util.isArray;

function register(node, registry, cb) {
  if (!exists(node.type) || node.type.toLowerCase() !== 'command') return cb();

  function validate_cmd(cmd) {
    cmd.sources = cmd.sources || [];
    cmd.action = cmd.action || 'build';
    assert(exists(cmd.cmd), 'Invalid command for command node: ' + node.id);
  }

  if (exists(node.commands)) {
    if (isArray(node.commands))
      node.commands.forEach(validate_cmd);
    else {
      if (exists(node.commands.parallel))
        node.commands.parallel.forEach(validate_cmd);
      if (exists(node.commands.series))
        node.commands.series.forEach(validate_cmd);
    }
  }

  node.generate = function(graph, cb) {
    processors['command'].generate(graph, this, cb);
  }

  cb();
}

function generate(graph, node, cb) {
  if (!exists(node.commands)) return cb();

  var parallel_cmds = [];
  var serial_cmds = [];

  if (isArray(node.commands))
    serial_cmds = node.commands;
  else {
    parallel_cmds = node.commands.parallel || [];
    serial_cmds = node.commands.series || [];
  }

  var new_deps = [];

  if (parallel_cmds.length > 0) {
    var id = node.id + ':parallel';
    new_deps.push(id);

    graph.generated.push({
      id: node.id + ':parallel',
      cmds: parallel_cmds,
      deps: node.deps
    });
  }

  if (serial_cmds.length > 0) {
    var counter = 0;
    var last = null;
    serial_cmds.forEach(function(cmd) {
      var deps = last ? [last] : node.deps;
      var id = node.id + ':series:' + (++counter);
      new_deps.push(id);
      last = id;

      graph.generated.push({
        id: id,
        cmds: [cmd],
        deps: deps
      });
    });
  }

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: new_deps
  });

  cb();
}

var exports = [register, generate, {name: 'command'}];
public(exports, module);

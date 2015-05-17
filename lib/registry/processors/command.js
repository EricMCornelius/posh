var util = require('util');
var path = require('path');
var assert = require('assert');
var async = require('async');

var utils = require('../../utils');
var exists = utils.exists;
var public = utils.public;
var isArray = utils.isArray;

function register(node, registry, cb) {
  if (!exists(node.type) || node.type.toLowerCase() !== 'command') return cb();

  function validate_cmd(cmd) {
    cmd.sources = cmd.sources || [];
    cmd.args = cmd.args || [];
    cmd.cwd = cmd.cwd || node.base || [];
    assert(exists(cmd.cmd), 'Invalid command for command node: ' + node.id);

    cmd.sources = cmd.sources.map(function(source) {
      return path.resolve(cmd.cwd, source);
    });
    if (cmd.target)
      cmd.target = path.resolve(cmd.cwd, cmd.target);
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
      deps: node.deps,
      base: node.base
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
        deps: deps,
        base: node.base
      });
    });
  }

  graph.generated.push({
    id: node.id,
    cmds: [],
    deps: new_deps,
    base: node.base
  });

  cb();
}

var exports = [register, generate, {name: 'command'}];
public(exports, module);

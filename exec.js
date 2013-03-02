#!/usr/bin/env node

var graph = require('./graph.gen').graph;
var dgraph = require('./lib/dependency_graph');

var async = require('async');
var exec = require('child_process').exec;

function execute_cmd(cmd, cb) {
  console.log(cmd.cmd);
  exec(cmd.cmd, null, cb);
}

function print_sources(cmd, cb) {
  async.forEach(cmd.sources, function(source, cb) { console.log(source);  cb(); }, cb);
}

function print_target(cmd, cb) {
  console.log(cmd.target);
  cb();
}

function clean(cmd, cb) {
  var cmd = 'rm -rf ' + cmd.target;
  exec(cmd, cb);
}

var action = process.argv[2];

switch(action) {
  case 'build':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, execute_cmd, cb); }});
    break;
  case 'print_sources':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_sources, cb); }});
    break;
  case 'print_targets':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_target, cb); }});
    break;
}
//dgraph.execute(graph, {action: process.argv[2]});

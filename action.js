#!/usr/bin/env node

require('node_extensions');

var fs = require('fs');
var vm = require('vm');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;
var async = require('async');
var util = require('util');
var path = require('path');

var exists = util.exists;

var dgraph = require('./lib/dependency_graph');
var DependencyGraph = dgraph.DependencyGraph;
var execute = dgraph.execute;
var write_graph = dgraph.write_graph;

function get_nodes() {
  var module_path = path.resolve(__dirname, 'nodes.gen');
  util.invalidate_module(module_path);
  return require(module_path).nodes;
}

function register(cb) {
  cb = cb || function() {};
  spawn('./lib/register.js', null, {stdio: 'inherit'});
}

function generate(cb) {
  cb = cb || function() {};

  // construct dependency graph of nodes which have the specified action name
  var nodes = get_nodes().filter(function(node) { return exists(node.generate); });
  var graph = new DependencyGraph(nodes);
  graph.generated = [];

  execute(graph, {action: 'generate', begin: function(node) { console.log('Started: ', node.id); }}, function(cb) {
    var cmd_graph = new DependencyGraph(graph.generated, true);
    write_graph(cmd_graph);
  });
}

function action(name, cb) {
  cb = cb || function() { };

  // construct dependency graph of nodes which have the specified action name
  nodes = get_nodes().filter(function(node) { return exists(node[name]); });
  var graph = new DependencyGraph(nodes);

  execute(graph, {action: name});
  write_graph(graph);
}

var name = process.argv[2];

switch (name) {
  case 'scan': {
    register();
    break;
  }
  case 'generate': {
    generate();
    break;
  }
  default: {
    action(name);
  }
}

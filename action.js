#!/usr/bin/env node

var fs = require('fs');
var vm = require('vm');
var exec = require('child_process').exec;
var async = require('async');
var util = require('util');
var path = require('path');

require('./lib/extensions/extensions');

function get_nodes() {
  var module_path = path.resolve(__dirname, 'nodes.gen');
  delete require.cache[module_path];
  return require(module_path).nodes;
}

function register(cb) {
  exec('./lib/register.js', function(err, stdout, stderr) {
    if (err) throw stderr;
    nodes = get_nodes();
    cb();
  });
}

var nodes = [];
function method(name, cb) {
  nodes = get_nodes();
  
  async.forEachSeries(
    nodes,
    function(item, cb) { if (item[name]) item[name](util.force(cb, 'registered cb')); else cb(); },
    function(err) {
      if (err) throw err;
      cb();
    }
  );
}

var action = process.argv[2];

switch (action) {
  case 'generate': {
    register(function() { });
    break;
  }
  case 'update': {
    var old_nodes = [];
    async.series([
      register,
      async.apply(async.whilst,
        function() {
          var result = nodes.length !== old_nodes.length; 
          old_nodes = nodes;
          return result;
        },
        async.apply(async.series, [async.apply(method, 'update'), register]),
        function(err) { }
      )]
    );
    break;
  }
  default: {
    method(action);
  }
}
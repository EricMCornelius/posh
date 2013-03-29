require('node_extensions');

var glob = require('glob');
var async = require('async');
var path = require('path');

function load(root, pattern) {
  root = root || __dirname;
  pattern = pattern || '*.js';

  var plugins = glob.sync(pattern, {cwd: root});
  var files = plugins.map(async.apply(path.resolve, root).only(1));
  var modules = files.map(require);
  
  return modules;
}

function create_map(root, pattern) {
  var plugins = load(root, pattern);
  var map = {};
  plugins.forEach(function(plugin) {
    map[plugin.name] = plugin;
  });
  return map;
}

module.exports.load = create_map;

var glob = require('glob');
var path = require('path');
var _ = require('lodash');

function load(root, pattern) {
  root = root || __dirname;
  pattern = pattern || '*.js';

  var plugins = glob.sync(pattern, {cwd: root});
  var files = plugins.map(function(file) {
    return path.resolve(root, file);
  });
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

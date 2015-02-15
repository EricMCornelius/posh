var path = require('path');

var scan = require('./scan').scan;
var registry = require('./registry/registry').registry;

var node_registry = new registry();

var output = path.resolve('.posh/nodes.gen');

scan(node_registry);

process.on('exit', function() {
  node_registry.write(output);
});

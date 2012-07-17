var assert = require('assert');

RegistryType = function() {
  this.nodes = [],
  this.process_actions = [],
  this.register_actions = []
};

RegistryType.prototype.register_node = function(node) {
  assert(exists(node.id), 'Node must specify an id');

  this.register(node);
};

RegistryType.prototype.add_process_action = function(action) {
  assert(exists(action.type), 'Action must specify a type');

  this.process_actions.push(action);
};

RegistryType.prototype.add_register_action = function(action) {
  assert(exists(action.type), 'Action must specify a type');

  this.register_actions.push(action);
};

RegistryType.prototype.register = function(node) {
  this.register_actions.forEach(function(action) {
    if (action.type === node.type || action.type === '*') {
      action.exec(node);
    }
  });
  this.nodes.push(node);
};

RegistryType.prototype.process = function(args) {
  var executed = false;
  this.process_actions.forEach(function(action) {
    if (action.type === args.node.type || action.type === '*') {
      executed = true;
      action.exec(args);
    }
  });

  if (!executed) {
    //throw new UnhandledError({message: 'No matching action type detected', node: node});
    args.cb();
  }
};

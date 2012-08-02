
require('./lib/build_system.js');

function initialize(args) {
  return BuildSystem(args);
}

exports.initialize = initialize;
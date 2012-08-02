// add require to the global namespace
global.require = require;

// global used to track name of currently processed file
__file = __filename;

// active global build system
__build_system = null;

// global updated list
__updated = {};

// global used to track current file env
__env = {
  file: __filename,
  toolchain: 'gcc'
};

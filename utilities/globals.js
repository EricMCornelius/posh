// add require to the global namespace
global.require = require;

// global used to track name of currently processed file
__file = __filename;

// global build root
__build_root = '/var/tmp/build';

// global used to track current file env
__env = {
  file: __filename,
  build_root: '/var/tmp/build',
  toolchain: 'gcc'
};

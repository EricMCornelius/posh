var is_windows = (process.platform === 'win32');

function create_directory_command(path) {
  return is_windows ? {
    sources: [],
    target: path,
    cmd: 'mkdir',
    args: [path],
    action: 'build'
  } :
  {
  	sources: [],
  	target: path,
  	cmd: 'mkdir',
  	args: ['-p', path],
  	action: 'build'
  };
}

module.exports.create_directory_command = create_directory_command;

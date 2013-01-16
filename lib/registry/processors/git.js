function process(node, cb) {
  if (node.git)
    console.log(node);
  cb(null, true);
}

module.exports.process = process;